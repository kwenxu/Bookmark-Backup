// 书签树右键菜单功能
// 提供类似Chrome原生书签管理器的功能

// 全局变量
let contextMenu = null;
let currentContextNode = null;
let bookmarkClipboard = null; // 剪贴板 { action: 'cut'|'copy', nodeId, nodeData }

// 防抖机制：防止重复打开书签
const bookmarkOpenDebounce = {
    lastActionTime: 0,
    lastActionKey: null,
    debounceDelay: 300 // 300ms防抖延迟
};

// 检查是否应该执行操作（防抖）
function shouldAllowBookmarkOpen(actionKey) {
    const now = Date.now();
    const timeSinceLastAction = now - bookmarkOpenDebounce.lastActionTime;

    // 如果是相同的操作且时间间隔小于防抖延迟，则忽略
    if (bookmarkOpenDebounce.lastActionKey === actionKey && timeSinceLastAction < bookmarkOpenDebounce.debounceDelay) {
        console.log(`[防抖] 忽略重复的书签打开操作: ${actionKey}, 距离上次 ${timeSinceLastAction}ms`);
        return false;
    }

    // 更新最后操作时间和key
    bookmarkOpenDebounce.lastActionTime = now;
    bookmarkOpenDebounce.lastActionKey = actionKey;
    return true;
}

// 全局：默认打开方式与特定窗口/分组ID
let defaultOpenMode = 'scoped-group'; // 默认：'scoped-group'（in Specific Group）。可选：'new-tab' | 'new-window' | 'incognito' | 'specific-window' | 'specific-group' | 'scoped-window' | 'scoped-group' | 'same-window-specific-group'
let specificWindowId = null; // chrome.windows Window ID
let specificTabGroupId = null; // chrome.tabGroups Group ID（在“特定标签组”模式下复用）
let specificGroupWindowId = null; // 保存分组所在窗口，确保新开的标签在同一窗口

// 超链接系统：独立的打开方式与窗口/分组ID（与书签系统完全隔离）
let hyperlinkDefaultOpenMode = 'specific-group'; // 超链接的默认打开方式：'specific-group'（in Same Group）
let hyperlinkSpecificWindowId = null; // 超链接专用的窗口ID
let hyperlinkSpecificTabGroupId = null; // 超链接专用的分组ID
let hyperlinkSpecificGroupWindowId = null; // 超链接分组所在窗口
let hyperlinkSameWindowSpecificGroupWindowId = null; // 超链接的同窗特定组窗口ID
let hyperlinkSameWindowSpecificGroupScopes = {}; // 超链接的同窗特定组作用域
let hyperlinkGroupCounter = 0; // 超链接分组计数器（用于命名 Hyperlink 1, 2, 3...）
// 注意：超链接的窗口计数器使用独立的注册表系统，通过 allocateNextHyperlinkWindowNumber() 动态分配

const PLUGIN_GROUP_REGISTRY_KEY = 'pluginTabGroupsRegistry';
const PLUGIN_WINDOW_REGISTRY_KEY = 'pluginWindowsRegistry';
const PLUGIN_SCOPED_GROUP_REGISTRY_KEY = 'pluginScopedTabGroupsRegistry';
const PLUGIN_SCOPED_WINDOW_REGISTRY_KEY = 'pluginScopedWindowsRegistry';
const SAME_WINDOW_SPECIFIC_GROUP_WINDOW_KEY = 'bookmarkSameWindowSpecificGroupWindowId';
const SAME_WINDOW_SPECIFIC_GROUP_SCOPES_KEY = 'bookmarkSameWindowSpecificGroupScopes';

// 超链接系统专用注册表键
const HYPERLINK_WINDOW_REGISTRY_KEY = 'hyperlinkWindowsRegistry';

const LIVE_GROUP_SEED_CACHE_TTL = 1200; // ms

let scopedCurrentGroups = {}; // { [scopeKey: string]: { groupId: number, windowId: number|null } }
let scopedWindows = {}; // { [scopeKey: string]: number /* windowId */ }
let sameWindowSpecificGroupWindowId = null;
let sameWindowSpecificGroupScopes = {}; // { [scopeKey: string]: { groupId, windowId, number, updatedAt } }
let lifecycleGuardsRegistered = false;
let liveGroupSeedCache = null;
let liveGroupSeedCacheTs = 0;
// 暴露给其他脚本（如 history.js）
window.getDefaultOpenMode = () => defaultOpenMode;

// 读取持久化默认打开方式（书签系统）
(async function initDefaultOpenMode() {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get([
                'bookmarkDefaultOpenMode',
                'bookmarkSpecificWindowId',
                'bookmarkSpecificGroupId',
                'bookmarkSpecificGroupWindowId',
                'bookmarkScopedCurrentGroups',
                'bookmarkScopedWindows',
                SAME_WINDOW_SPECIFIC_GROUP_WINDOW_KEY,
                SAME_WINDOW_SPECIFIC_GROUP_SCOPES_KEY
            ]);
            if (data && typeof data.bookmarkDefaultOpenMode === 'string') {
                defaultOpenMode = data.bookmarkDefaultOpenMode;
            }
            if (data && Number.isInteger(data.bookmarkSpecificWindowId)) {
                specificWindowId = data.bookmarkSpecificWindowId;
            }
            if (data && Number.isInteger(data.bookmarkSpecificGroupId)) {
                specificTabGroupId = data.bookmarkSpecificGroupId;
            }
            if (data && Number.isInteger(data.bookmarkSpecificGroupWindowId)) {
                specificGroupWindowId = data.bookmarkSpecificGroupWindowId;
            }
            if (data && Number.isInteger(data[SAME_WINDOW_SPECIFIC_GROUP_WINDOW_KEY])) {
                sameWindowSpecificGroupWindowId = data[SAME_WINDOW_SPECIFIC_GROUP_WINDOW_KEY];
            }
            // 初始化作用域映射（分栏位）
            if (data && data.bookmarkScopedCurrentGroups && typeof data.bookmarkScopedCurrentGroups === 'object') {
                try { scopedCurrentGroups = data.bookmarkScopedCurrentGroups || {}; } catch (_) { }
            }
            if (data && data.bookmarkScopedWindows && typeof data.bookmarkScopedWindows === 'object') {
                try { scopedWindows = data.bookmarkScopedWindows || {}; } catch (_) { }
            }
            if (data && data[SAME_WINDOW_SPECIFIC_GROUP_SCOPES_KEY] && typeof data[SAME_WINDOW_SPECIFIC_GROUP_SCOPES_KEY] === 'object') {
                try { sameWindowSpecificGroupScopes = data[SAME_WINDOW_SPECIFIC_GROUP_SCOPES_KEY] || {}; } catch (_) { }
            }
        } else {
            const mode = localStorage.getItem('bookmarkDefaultOpenMode');
            const winId = parseInt(localStorage.getItem('bookmarkSpecificWindowId') || '', 10);
            if (mode) defaultOpenMode = mode;
            if (Number.isInteger(winId)) specificWindowId = winId;
            const gid = parseInt(localStorage.getItem('bookmarkSpecificGroupId') || '', 10);
            const gwid = parseInt(localStorage.getItem('bookmarkSpecificGroupWindowId') || '', 10);
            if (Number.isInteger(gid)) specificTabGroupId = gid;
            if (Number.isInteger(gwid)) specificGroupWindowId = gwid;
            const combinedWinId = parseInt(localStorage.getItem(SAME_WINDOW_SPECIFIC_GROUP_WINDOW_KEY) || '', 10);
            if (Number.isInteger(combinedWinId)) sameWindowSpecificGroupWindowId = combinedWinId;
            try { scopedCurrentGroups = JSON.parse(localStorage.getItem('bookmarkScopedCurrentGroups') || '{}'); } catch (_) { }
            try { scopedWindows = JSON.parse(localStorage.getItem('bookmarkScopedWindows') || '{}'); } catch (_) { }
            try {
                const storedScopes = localStorage.getItem(SAME_WINDOW_SPECIFIC_GROUP_SCOPES_KEY);
                if (storedScopes) {
                    sameWindowSpecificGroupScopes = JSON.parse(storedScopes) || {};
                }
            } catch (_) { }
        }
        try { window.defaultOpenMode = defaultOpenMode; } catch (_) { }
    } catch (_) { }
})();

// 读取持久化默认打开方式（超链接系统）
(async function initHyperlinkSettings() {
    try {
        console.log('[超链接初始化] 开始加载持久化设置...');
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get([
                'hyperlinkDefaultOpenMode',
                'hyperlinkSpecificWindowId',
                'hyperlinkSpecificGroupId',
                'hyperlinkSpecificGroupWindowId'
            ]);
            console.log('[超链接初始化] 从 chrome.storage 读取:', data);
            if (data && typeof data.hyperlinkDefaultOpenMode === 'string') {
                hyperlinkDefaultOpenMode = data.hyperlinkDefaultOpenMode;
                console.log('[超链接初始化] 设置 hyperlinkDefaultOpenMode =', hyperlinkDefaultOpenMode);
            }
            if (data && Number.isInteger(data.hyperlinkSpecificWindowId)) {
                hyperlinkSpecificWindowId = data.hyperlinkSpecificWindowId;
                console.log('[超链接初始化] 设置 hyperlinkSpecificWindowId =', hyperlinkSpecificWindowId);
            }
            if (data && Number.isInteger(data.hyperlinkSpecificGroupId)) {
                hyperlinkSpecificTabGroupId = data.hyperlinkSpecificGroupId;
                console.log('[超链接初始化] 设置 hyperlinkSpecificTabGroupId =', hyperlinkSpecificTabGroupId);
            }
            if (data && Number.isInteger(data.hyperlinkSpecificGroupWindowId)) {
                hyperlinkSpecificGroupWindowId = data.hyperlinkSpecificGroupWindowId;
                console.log('[超链接初始化] 设置 hyperlinkSpecificGroupWindowId =', hyperlinkSpecificGroupWindowId);
            }
        } else {
            console.log('[超链接初始化] 使用 localStorage');
            const mode = localStorage.getItem('hyperlinkDefaultOpenMode');
            if (mode) {
                hyperlinkDefaultOpenMode = mode;
                console.log('[超链接初始化] 设置 hyperlinkDefaultOpenMode =', hyperlinkDefaultOpenMode);
            }
            const winId = parseInt(localStorage.getItem('hyperlinkSpecificWindowId') || '', 10);
            if (Number.isInteger(winId)) {
                hyperlinkSpecificWindowId = winId;
                console.log('[超链接初始化] 设置 hyperlinkSpecificWindowId =', hyperlinkSpecificWindowId);
            }
            const gid = parseInt(localStorage.getItem('hyperlinkSpecificGroupId') || '', 10);
            if (Number.isInteger(gid)) {
                hyperlinkSpecificTabGroupId = gid;
                console.log('[超链接初始化] 设置 hyperlinkSpecificTabGroupId =', hyperlinkSpecificTabGroupId);
            }
            const gwid = parseInt(localStorage.getItem('hyperlinkSpecificGroupWindowId') || '', 10);
            if (Number.isInteger(gwid)) {
                hyperlinkSpecificGroupWindowId = gwid;
                console.log('[超链接初始化] 设置 hyperlinkSpecificGroupWindowId =', hyperlinkSpecificGroupWindowId);
            }
        }
        console.log('[超链接初始化] 完成。当前状态:', {
            hyperlinkDefaultOpenMode,
            hyperlinkSpecificWindowId,
            hyperlinkSpecificTabGroupId,
            hyperlinkSpecificGroupWindowId
        });
    } catch (err) {
        console.error('[超链接初始化] 失败:', err);
    }
})();

async function setDefaultOpenMode(mode) {
    defaultOpenMode = mode;
    try { window.defaultOpenMode = mode; } catch (_) { }
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ bookmarkDefaultOpenMode: mode });
        } else {
            localStorage.setItem('bookmarkDefaultOpenMode', mode);
        }
    } catch (_) { }
}

async function setSpecificWindowId(winId) {
    specificWindowId = winId;
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ bookmarkSpecificWindowId: winId });
        } else {
            localStorage.setItem('bookmarkSpecificWindowId', String(winId));
        }
    } catch (_) { }
}

async function resetSpecificWindowId() {
    specificWindowId = null;
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.remove(['bookmarkSpecificWindowId']);
        } else {
            localStorage.removeItem('bookmarkSpecificWindowId');
        }
    } catch (_) { }
}

async function setSpecificGroupInfo(groupId, windowId) {
    specificTabGroupId = groupId;
    specificGroupWindowId = windowId;
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({
                bookmarkSpecificGroupId: groupId,
                bookmarkSpecificGroupWindowId: windowId
            });
        } else {
            localStorage.setItem('bookmarkSpecificGroupId', String(groupId));
            localStorage.setItem('bookmarkSpecificGroupWindowId', String(windowId));
        }
    } catch (_) { }
}

async function resetSpecificGroupInfo() {
    specificTabGroupId = null;
    specificGroupWindowId = null;
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.remove(['bookmarkSpecificGroupId', 'bookmarkSpecificGroupWindowId']);
        } else {
            localStorage.removeItem('bookmarkSpecificGroupId');
            localStorage.removeItem('bookmarkSpecificGroupWindowId');
        }
    } catch (_) { }
}

// ====== 超链接系统：持久化函数（独立于书签系统） ======

async function setHyperlinkSpecificWindowId(winId) {
    hyperlinkSpecificWindowId = winId;
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ hyperlinkSpecificWindowId: winId });
        } else {
            localStorage.setItem('hyperlinkSpecificWindowId', String(winId));
        }
    } catch (_) { }
}

async function resetHyperlinkSpecificWindowId() {
    hyperlinkSpecificWindowId = null;
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.remove(['hyperlinkSpecificWindowId']);
        } else {
            localStorage.removeItem('hyperlinkSpecificWindowId');
        }
    } catch (_) { }
}

async function setHyperlinkSpecificGroupInfo(groupId, windowId) {
    hyperlinkSpecificTabGroupId = groupId;
    hyperlinkSpecificGroupWindowId = windowId;
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({
                hyperlinkSpecificGroupId: groupId,
                hyperlinkSpecificGroupWindowId: windowId
            });
        } else {
            localStorage.setItem('hyperlinkSpecificGroupId', String(groupId));
            localStorage.setItem('hyperlinkSpecificGroupWindowId', String(windowId));
        }
    } catch (_) { }
}

async function resetHyperlinkSpecificGroupInfo() {
    hyperlinkSpecificTabGroupId = null;
    hyperlinkSpecificGroupWindowId = null;
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.remove(['hyperlinkSpecificGroupId', 'hyperlinkSpecificGroupWindowId']);
        } else {
            localStorage.removeItem('hyperlinkSpecificGroupId');
            localStorage.removeItem('hyperlinkSpecificGroupWindowId');
        }
    } catch (_) { }
}


function getScopeFromContext(context) {
    const type = context && context.treeType ? context.treeType : 'permanent';
    if (type === 'temporary' && context && context.sectionId) {
        try {
            const sec = (typeof CanvasModule !== 'undefined' && CanvasModule && CanvasModule.temp && typeof CanvasModule.temp.getSection === 'function')
                ? CanvasModule.temp.getSection(context.sectionId)
                : null;
            const toAlphaLabel = (n) => {
                let num = parseInt(n, 10);
                if (!Number.isFinite(num) || num <= 0) return '';
                let s = '';
                while (num > 0) {
                    const rem = (num - 1) % 26;
                    s = String.fromCharCode(65 + rem) + s;
                    num = Math.floor((num - 1) / 26);
                }
                return s;
            };
            const alpha = sec && sec.sequenceNumber ? toAlphaLabel(sec.sequenceNumber) : '';
            return { key: `temp:${alpha || context.sectionId}`, prefix: alpha };
        } catch (_) {
            return { key: `temp:${context.sectionId}`, prefix: '' };
        }
    }
    return { key: 'permanent', prefix: '' };
}

async function readScopedGroupRegistry() {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get([PLUGIN_SCOPED_GROUP_REGISTRY_KEY]);
            return Array.isArray(data[PLUGIN_SCOPED_GROUP_REGISTRY_KEY]) ? data[PLUGIN_SCOPED_GROUP_REGISTRY_KEY] : [];
        }
        const raw = localStorage.getItem(PLUGIN_SCOPED_GROUP_REGISTRY_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
}

async function writeScopedGroupRegistry(reg) {
    const safe = Array.isArray(reg) ? reg : [];
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ [PLUGIN_SCOPED_GROUP_REGISTRY_KEY]: safe });
        } else {
            localStorage.setItem(PLUGIN_SCOPED_GROUP_REGISTRY_KEY, JSON.stringify(safe));
        }
    } catch (_) { }
}

async function readScopedWindowRegistry() {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get([PLUGIN_SCOPED_WINDOW_REGISTRY_KEY]);
            return Array.isArray(data[PLUGIN_SCOPED_WINDOW_REGISTRY_KEY]) ? data[PLUGIN_SCOPED_WINDOW_REGISTRY_KEY] : [];
        }
        const raw = localStorage.getItem(PLUGIN_SCOPED_WINDOW_REGISTRY_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
}

async function writeScopedWindowRegistry(reg) {
    const safe = Array.isArray(reg) ? reg : [];
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ [PLUGIN_SCOPED_WINDOW_REGISTRY_KEY]: safe });
        } else {
            localStorage.setItem(PLUGIN_SCOPED_WINDOW_REGISTRY_KEY, JSON.stringify(safe));
        }
    } catch (_) { }
}

function getSameWindowSpecificGroupEntry(scopeKey) {
    if (!scopeKey || !sameWindowSpecificGroupScopes) return null;
    const entry = sameWindowSpecificGroupScopes[scopeKey];
    if (!entry || typeof entry !== 'object') return null;
    if (entry.windowId !== sameWindowSpecificGroupWindowId) return null;
    return entry;
}

async function persistSameWindowSpecificGroupScopes() {
    const payload = (sameWindowSpecificGroupScopes && typeof sameWindowSpecificGroupScopes === 'object')
        ? sameWindowSpecificGroupScopes
        : {};
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ [SAME_WINDOW_SPECIFIC_GROUP_SCOPES_KEY]: payload });
        } else {
            localStorage.setItem(SAME_WINDOW_SPECIFIC_GROUP_SCOPES_KEY, JSON.stringify(payload));
        }
    } catch (_) { }
}

async function setSameWindowSpecificGroupScope(scopeKey, groupId, windowId, number) {
    if (!scopeKey) return;
    sameWindowSpecificGroupScopes[scopeKey] = {
        groupId,
        windowId: windowId || null,
        number: Number.isFinite(number) ? number : null,
        updatedAt: Date.now()
    };
    await persistSameWindowSpecificGroupScopes();
}

async function clearSameWindowSpecificGroupScope(scopeKey) {
    if (!scopeKey || !sameWindowSpecificGroupScopes) return;
    if (sameWindowSpecificGroupScopes[scopeKey]) {
        delete sameWindowSpecificGroupScopes[scopeKey];
        await persistSameWindowSpecificGroupScopes();
    }
}

async function resetSameWindowSpecificGroupScopes() {
    sameWindowSpecificGroupScopes = {};
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.remove([SAME_WINDOW_SPECIFIC_GROUP_SCOPES_KEY]);
        } else {
            localStorage.removeItem(SAME_WINDOW_SPECIFIC_GROUP_SCOPES_KEY);
        }
    } catch (_) { }
}

async function setSameWindowSpecificGroupWindowId(winId) {
    sameWindowSpecificGroupWindowId = winId;
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ [SAME_WINDOW_SPECIFIC_GROUP_WINDOW_KEY]: winId });
        } else {
            localStorage.setItem(SAME_WINDOW_SPECIFIC_GROUP_WINDOW_KEY, String(winId));
        }
    } catch (_) { }
}

async function resetSameWindowSpecificGroupState() {
    sameWindowSpecificGroupWindowId = null;
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.remove([SAME_WINDOW_SPECIFIC_GROUP_WINDOW_KEY]);
        } else {
            localStorage.removeItem(SAME_WINDOW_SPECIFIC_GROUP_WINDOW_KEY);
        }
    } catch (_) { }
    await resetSameWindowSpecificGroupScopes();
}

function invalidateLiveGroupSeeds() {
    liveGroupSeedCache = null;
    liveGroupSeedCacheTs = 0;
}

function parseGroupFingerprint(title) {
    if (!title || typeof title !== 'string') return null;
    const trimmed = title.trim();
    if (!trimmed) return null;
    const sameWindowPermanent = /^A-Z\s+(\d+)$/.exec(trimmed);
    if (sameWindowPermanent) {
        return { kind: 'scoped', scopeKey: 'permanent', number: parseInt(sameWindowPermanent[1], 10) };
    }
    const scopedTemp = /^([A-Z]+)(\d+)$/.exec(trimmed);
    if (scopedTemp && scopedTemp[1] !== 'A-Z') {
        const prefix = scopedTemp[1];
        return {
            kind: 'scoped',
            scopeKey: `temp:${prefix}`,
            number: parseInt(scopedTemp[2], 10)
        };
    }
    const globalMatch = /^(\d+)$/.exec(trimmed);
    if (globalMatch) {
        return { kind: 'global', number: parseInt(globalMatch[1], 10) };
    }
    return null;
}

function queryAllTabGroups(filter = {}) {
    if (typeof chrome === 'undefined' || !chrome.tabGroups || typeof chrome.tabGroups.query !== 'function') {
        return Promise.resolve([]);
    }
    return new Promise((resolve) => {
        try {
            chrome.tabGroups.query(filter, (groups) => {
                if (chrome.runtime && chrome.runtime.lastError) {
                    console.warn('[tabGroups.query] failed:', chrome.runtime.lastError);
                    resolve([]);
                    return;
                }
                resolve(Array.isArray(groups) ? groups : []);
            });
        } catch (err) {
            console.warn('[tabGroups.query] exception:', err);
            resolve([]);
        }
    });
}

async function getLiveGroupSeeds(force = false) {
    const now = Date.now();
    if (!force && liveGroupSeedCache && (now - liveGroupSeedCacheTs) < LIVE_GROUP_SEED_CACHE_TTL) {
        return liveGroupSeedCache;
    }
    const seeds = { globalMax: 0, scopedMax: {} };
    if (typeof chrome === 'undefined' || !chrome.tabGroups || typeof chrome.tabGroups.query !== 'function') {
        liveGroupSeedCache = seeds;
        liveGroupSeedCacheTs = now;
        return seeds;
    }
    try {
        const groups = await queryAllTabGroups({});
        (groups || []).forEach(group => {
            if (!group || !group.title) return;
            const info = parseGroupFingerprint(group.title);
            if (!info || !Number.isFinite(info.number) || info.number <= 0) return;
            if (info.kind === 'global') {
                if (info.number > seeds.globalMax) seeds.globalMax = info.number;
            } else if (info.kind === 'scoped' && info.scopeKey) {
                const prev = seeds.scopedMax[info.scopeKey] || 0;
                if (info.number > prev) seeds.scopedMax[info.scopeKey] = info.number;
            }
        });
    } catch (err) {
        console.warn('[LiveGroupSeeds] query failed:', err);
    }
    liveGroupSeedCache = seeds;
    liveGroupSeedCacheTs = Date.now();
    return seeds;
}

async function isWindowAlive(windowId) {
    if (!Number.isInteger(windowId)) return false;
    if (typeof chrome === 'undefined' || !chrome.windows || !chrome.windows.get) return false;
    try {
        const win = await chrome.windows.get(windowId, { populate: false });
        return !!(win && win.id === windowId);
    } catch (_) {
        return false;
    }
}

async function isTabGroupAlive(groupId) {
    if (!Number.isInteger(groupId)) return false;
    if (typeof chrome === 'undefined' || !chrome.tabGroups || !chrome.tabGroups.get) return false;
    try {
        const group = await chrome.tabGroups.get(groupId);
        return !!(group && group.id === groupId);
    } catch (_) {
        return false;
    }
}

async function refreshTrackedOpenTargets() {
    if (typeof chrome === 'undefined') return;
    try {
        if (specificWindowId && !(await isWindowAlive(specificWindowId))) {
            await resetSpecificWindowId();
        }
        if (specificTabGroupId) {
            const aliveGroup = await isTabGroupAlive(specificTabGroupId);
            const aliveWindow = specificGroupWindowId ? await isWindowAlive(specificGroupWindowId) : true;
            if (!aliveGroup || !aliveWindow) {
                await resetSpecificGroupInfo();
            }
        }
        if (sameWindowSpecificGroupWindowId && !(await isWindowAlive(sameWindowSpecificGroupWindowId))) {
            await resetSameWindowSpecificGroupState();
        }

        const scopedGroupEntries = Object.entries(scopedCurrentGroups || {});
        for (const [scopeKey, entry] of scopedGroupEntries) {
            if (!entry || !Number.isInteger(entry.groupId)) {
                await removeScopedCurrentGroup(scopeKey);
                continue;
            }
            const groupAlive = await isTabGroupAlive(entry.groupId);
            const windowAlive = entry.windowId ? await isWindowAlive(entry.windowId) : true;
            if (!groupAlive || !windowAlive) {
                await removeScopedCurrentGroup(scopeKey);
            }
        }

        const scopedWindowEntries = Object.entries(scopedWindows || {});
        for (const [scopeKey, winId] of scopedWindowEntries) {
            if (!Number.isInteger(winId)) {
                await removeScopedWindowEntry(scopeKey);
                continue;
            }
            if (!(await isWindowAlive(winId))) {
                await removeScopedWindowEntry(scopeKey);
            }
        }

        const combinedEntries = Object.entries(sameWindowSpecificGroupScopes || {});
        for (const [scopeKey, entry] of combinedEntries) {
            if (!entry) {
                await clearSameWindowSpecificGroupScope(scopeKey);
                continue;
            }
            const windowAlive = entry.windowId ? await isWindowAlive(entry.windowId) : false;
            const groupAlive = entry.groupId ? await isTabGroupAlive(entry.groupId) : false;
            if (!windowAlive || !groupAlive) {
                await clearSameWindowSpecificGroupScope(scopeKey);
            }
        }
    } catch (refreshError) {
        console.warn('[OpenTargets] refresh failed:', refreshError);
    }
}

async function handleTrackedWindowRemoved(windowId) {
    if (!Number.isInteger(windowId)) return;
    try {
        // 书签系统
        if (specificWindowId === windowId) {
            await resetSpecificWindowId();
        }
        if (sameWindowSpecificGroupWindowId === windowId) {
            await resetSameWindowSpecificGroupState();
        }
        if (specificGroupWindowId === windowId) {
            await resetSpecificGroupInfo();
        }

        // 超链接系统：窗口关闭时重置
        if (hyperlinkSpecificWindowId === windowId) {
            await resetHyperlinkSpecificWindowId();
            // 注意：不重置计数器，计数器由注册表系统管理
            console.log('[超链接 LifecycleGuards] 窗口已关闭，重置 ID');
        }
        if (hyperlinkSpecificGroupWindowId === windowId) {
            await resetHyperlinkSpecificGroupInfo();
            hyperlinkGroupCounter = 0; // 重置分组计数器
            console.log('[超链接 LifecycleGuards] 分组所在窗口已关闭，重置分组信息和计数器');
        }
        if (hyperlinkSameWindowSpecificGroupWindowId === windowId) {
            hyperlinkSameWindowSpecificGroupWindowId = null;
            hyperlinkSameWindowSpecificGroupScopes = {};
            console.log('[超链接 LifecycleGuards] 同窗特定组窗口已关闭，重置');
        }

        const scopedWindowEntries = Object.entries(scopedWindows || {});
        for (const [scopeKey, winId] of scopedWindowEntries) {
            if (winId === windowId) {
                await removeScopedWindowEntry(scopeKey);
            }
        }
        const scopedGroupEntries = Object.entries(scopedCurrentGroups || {});
        for (const [scopeKey, entry] of scopedGroupEntries) {
            if (entry && entry.windowId === windowId) {
                await removeScopedCurrentGroup(scopeKey);
            }
        }
        const combinedEntries = Object.entries(sameWindowSpecificGroupScopes || {});
        for (const [scopeKey, entry] of combinedEntries) {
            if (entry && entry.windowId === windowId) {
                await clearSameWindowSpecificGroupScope(scopeKey);
            }
        }
        invalidateLiveGroupSeeds();
    } catch (err) {
        console.warn('[LifecycleGuards] windowRemoved handler failed:', err);
    }
}

async function handleTrackedGroupRemoved(groupInfo) {
    let groupId = null;
    if (groupInfo && typeof groupInfo === 'object') {
        if (Number.isInteger(groupInfo.groupId)) groupId = groupInfo.groupId;
        if (Number.isInteger(groupInfo.id)) groupId = groupInfo.id;
    } else if (Number.isInteger(groupInfo)) {
        groupId = groupInfo;
    }
    if (!Number.isInteger(groupId)) return;
    try {
        // 书签系统
        if (specificTabGroupId === groupId) {
            await resetSpecificGroupInfo();
        }

        // 超链接系统：分组关闭时重置
        if (hyperlinkSpecificTabGroupId === groupId) {
            hyperlinkSpecificTabGroupId = null;
            hyperlinkSpecificGroupWindowId = null;
            hyperlinkGroupCounter = 0; // 重置分组计数器
            console.log('[超链接 LifecycleGuards] 分组已关闭，重置 ID 和计数器');
        }

        // 检查超链接的同窗特定组作用域
        const hyperlinkScopeEntries = Object.entries(hyperlinkSameWindowSpecificGroupScopes || {});
        for (const [scopeKey, entry] of hyperlinkScopeEntries) {
            if (entry && entry.groupId === groupId) {
                delete hyperlinkSameWindowSpecificGroupScopes[scopeKey];
                console.log(`[超链接 LifecycleGuards] 作用域 ${scopeKey} 的分组已关闭`);
            }
        }

        const scopedGroupEntries = Object.entries(scopedCurrentGroups || {});
        for (const [scopeKey, entry] of scopedGroupEntries) {
            if (entry && entry.groupId === groupId) {
                await removeScopedCurrentGroup(scopeKey);
            }
        }
        const combinedEntries = Object.entries(sameWindowSpecificGroupScopes || {});
        for (const [scopeKey, entry] of combinedEntries) {
            if (entry && entry.groupId === groupId) {
                await clearSameWindowSpecificGroupScope(scopeKey);
            }
        }
        invalidateLiveGroupSeeds();
    } catch (err) {
        console.warn('[LifecycleGuards] groupRemoved handler failed:', err);
    }
}

function registerLifecycleGuards() {
    if (lifecycleGuardsRegistered) return;
    if (typeof chrome === 'undefined') return;
    try {
        if (chrome.windows && chrome.windows.onRemoved && typeof chrome.windows.onRemoved.addListener === 'function') {
            chrome.windows.onRemoved.addListener((windowId) => {
                handleTrackedWindowRemoved(windowId);
            });
        }
        if (chrome.tabGroups && chrome.tabGroups.onRemoved && typeof chrome.tabGroups.onRemoved.addListener === 'function') {
            chrome.tabGroups.onRemoved.addListener((group) => {
                handleTrackedGroupRemoved(group);
            });
        }
        lifecycleGuardsRegistered = true;
    } catch (err) {
        console.warn('[LifecycleGuards] 注册失败:', err);
    }
}

try { registerLifecycleGuards(); } catch (_) { }

async function pruneDeadScopedWindows() {
    let reg = await readScopedWindowRegistry();
    const alive = [];
    for (const entry of reg) {
        const { windowId } = entry || {};
        if (!Number.isInteger(windowId)) continue;
        let ok = false;
        try {
            if (chrome && chrome.windows && chrome.windows.get) {
                const w = await chrome.windows.get(windowId, { populate: false });
                ok = !!(w && w.id === windowId);
            }
        } catch (_) { ok = false; }
        if (ok) alive.push(entry);
    }
    await writeScopedWindowRegistry(alive);
    return alive;
}

async function allocateNextScopedWindowNumber(scopeKey) {
    const alive = await pruneDeadScopedWindows();
    let maxN = 0;
    alive.forEach(e => { if (e && e.scope === scopeKey && Number.isInteger(e.number) && e.number > 0 && e.number > maxN) maxN = e.number; });
    return maxN + 1;
}

async function registerScopedWindow(scopeKey, windowId, number) {
    const reg = await pruneDeadScopedWindows();
    reg.push({ scope: scopeKey, windowId, number, createdAt: Date.now() });
    await writeScopedWindowRegistry(reg);
}

async function pruneDeadScopedGroups() {
    let reg = await readScopedGroupRegistry();
    const alive = [];
    for (const entry of reg) {
        const { groupId } = entry || {};
        if (!Number.isInteger(groupId)) continue;
        let ok = false;
        try {
            if (chrome && chrome.tabGroups && chrome.tabGroups.get) {
                const g = await chrome.tabGroups.get(groupId);
                ok = !!(g && g.id === groupId);
            }
        } catch (_) { ok = false; }
        if (ok) alive.push(entry);
    }
    await writeScopedGroupRegistry(alive);
    return alive;
}

async function allocateNextScopedNumber(scopeKey) {
    const seeds = await getLiveGroupSeeds();
    const alive = await pruneDeadScopedGroups();
    let maxN = (seeds && seeds.scopedMax && scopeKey) ? (seeds.scopedMax[scopeKey] || 0) : 0;
    alive.forEach(e => {
        if (e && e.scope === scopeKey && Number.isInteger(e.number) && e.number > maxN) {
            maxN = e.number;
        }
    });
    return maxN + 1;
}

async function registerScopedGroup(scopeKey, groupId, windowId, number) {
    const reg = await pruneDeadScopedGroups();
    reg.push({ scope: scopeKey, groupId, windowId, number, createdAt: Date.now() });
    await writeScopedGroupRegistry(reg);
    invalidateLiveGroupSeeds();
}

async function setScopedCurrentGroup(scopeKey, groupId, windowId) {
    scopedCurrentGroups[scopeKey] = { groupId, windowId: windowId || null };
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ bookmarkScopedCurrentGroups: scopedCurrentGroups });
        } else {
            localStorage.setItem('bookmarkScopedCurrentGroups', JSON.stringify(scopedCurrentGroups));
        }
    } catch (_) { }
}

async function removeScopedCurrentGroup(scopeKey) {
    if (!scopeKey || !scopedCurrentGroups || !scopedCurrentGroups[scopeKey]) return;
    delete scopedCurrentGroups[scopeKey];
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ bookmarkScopedCurrentGroups: scopedCurrentGroups });
        } else {
            localStorage.setItem('bookmarkScopedCurrentGroups', JSON.stringify(scopedCurrentGroups));
        }
    } catch (_) { }
}

async function setScopedWindow(scopeKey, windowId) {
    scopedWindows[scopeKey] = windowId;
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ bookmarkScopedWindows: scopedWindows });
        } else {
            localStorage.setItem('bookmarkScopedWindows', JSON.stringify(scopedWindows));
        }
    } catch (_) { }
}

async function removeScopedWindowEntry(scopeKey) {
    if (!scopeKey || !scopedWindows || typeof scopedWindows[scopeKey] === 'undefined') return;
    delete scopedWindows[scopeKey];
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ bookmarkScopedWindows: scopedWindows });
        } else {
            localStorage.setItem('bookmarkScopedWindows', JSON.stringify(scopedWindows));
        }
    } catch (_) { }
}

async function readPluginGroupRegistry() {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get([PLUGIN_GROUP_REGISTRY_KEY]);
            return Array.isArray(data[PLUGIN_GROUP_REGISTRY_KEY]) ? data[PLUGIN_GROUP_REGISTRY_KEY] : [];
        }
        const raw = localStorage.getItem(PLUGIN_GROUP_REGISTRY_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
}

async function writePluginGroupRegistry(reg) {
    const safe = Array.isArray(reg) ? reg : [];
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ [PLUGIN_GROUP_REGISTRY_KEY]: safe });
        } else {
            localStorage.setItem(PLUGIN_GROUP_REGISTRY_KEY, JSON.stringify(safe));
        }
    } catch (_) { }
}

// ==== 插件生成的（全局"同一窗口"）窗口登记簿 ====
async function readPluginWindowRegistry() {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get([PLUGIN_WINDOW_REGISTRY_KEY]);
            return Array.isArray(data[PLUGIN_WINDOW_REGISTRY_KEY]) ? data[PLUGIN_WINDOW_REGISTRY_KEY] : [];
        }
        const raw = localStorage.getItem(PLUGIN_WINDOW_REGISTRY_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
}

async function writePluginWindowRegistry(reg) {
    const safe = Array.isArray(reg) ? reg : [];
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ [PLUGIN_WINDOW_REGISTRY_KEY]: safe });
        } else {
            localStorage.setItem(PLUGIN_WINDOW_REGISTRY_KEY, JSON.stringify(safe));
        }
    } catch (_) { }
}

async function pruneDeadPluginWindows() {
    let reg = await readPluginWindowRegistry();
    const alive = [];
    for (const entry of reg) {
        const { windowId } = entry || {};
        if (!Number.isInteger(windowId)) continue;
        let ok = false;
        try {
            if (chrome && chrome.windows && chrome.windows.get) {
                const w = await chrome.windows.get(windowId, { populate: false });
                ok = !!(w && w.id === windowId);
            }
        } catch (_) { ok = false; }
        if (ok) alive.push(entry);
    }
    await writePluginWindowRegistry(alive);
    return alive;
}

async function allocateNextWindowNumber() {
    const alive = await pruneDeadPluginWindows();
    let maxN = 0;
    alive.forEach(e => { if (Number.isInteger(e.number) && e.number > 0 && e.number > maxN) maxN = e.number; });
    return maxN + 1;
}

async function registerPluginWindow(windowId, number) {
    const reg = await pruneDeadPluginWindows();
    reg.push({ windowId, number, createdAt: Date.now() });
    await writePluginWindowRegistry(reg);
}

// ==== 超链接系统专用窗口登记簿 ====
async function readHyperlinkWindowRegistry() {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get([HYPERLINK_WINDOW_REGISTRY_KEY]);
            return Array.isArray(data[HYPERLINK_WINDOW_REGISTRY_KEY]) ? data[HYPERLINK_WINDOW_REGISTRY_KEY] : [];
        }
        const raw = localStorage.getItem(HYPERLINK_WINDOW_REGISTRY_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
}

async function writeHyperlinkWindowRegistry(reg) {
    const safe = Array.isArray(reg) ? reg : [];
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ [HYPERLINK_WINDOW_REGISTRY_KEY]: safe });
        } else {
            localStorage.setItem(HYPERLINK_WINDOW_REGISTRY_KEY, JSON.stringify(safe));
        }
    } catch (_) { }
}

async function pruneDeadHyperlinkWindows() {
    let reg = await readHyperlinkWindowRegistry();
    const alive = [];
    for (const entry of reg) {
        const { windowId } = entry || {};
        if (!Number.isInteger(windowId)) continue;
        let ok = false;
        try {
            if (chrome && chrome.windows && chrome.windows.get) {
                const w = await chrome.windows.get(windowId, { populate: false });
                ok = !!(w && w.id === windowId);
            }
        } catch (_) { ok = false; }
        if (ok) alive.push(entry);
    }
    await writeHyperlinkWindowRegistry(alive);
    return alive;
}

async function allocateNextHyperlinkWindowNumber() {
    const alive = await pruneDeadHyperlinkWindows();
    let maxN = 0;
    alive.forEach(e => { if (Number.isInteger(e.number) && e.number > 0 && e.number > maxN) maxN = e.number; });
    return maxN + 1;
}

async function registerHyperlinkWindow(windowId, number) {
    const reg = await pruneDeadHyperlinkWindows();
    reg.push({ windowId, number, createdAt: Date.now() });
    await writeHyperlinkWindowRegistry(reg);
}

async function pruneDeadPluginGroups() {
    let reg = await readPluginGroupRegistry();
    const alive = [];
    for (const entry of reg) {
        const { groupId } = entry || {};
        if (!Number.isInteger(groupId)) continue;
        let ok = false;
        try {
            if (chrome && chrome.tabGroups && chrome.tabGroups.get) {
                const g = await chrome.tabGroups.get(groupId);
                ok = !!(g && g.id === groupId);
            }
        } catch (_) {
            ok = false;
        }
        if (ok) alive.push(entry);
    }
    await writePluginGroupRegistry(alive);
    return alive;
}

async function allocateNextGroupNumber() {
    const seeds = await getLiveGroupSeeds();
    const alive = await pruneDeadPluginGroups();
    let maxN = seeds && Number.isFinite(seeds.globalMax) ? seeds.globalMax : 0;
    alive.forEach(e => {
        if (Number.isInteger(e.number) && e.number > maxN) {
            maxN = e.number;
        }
    });
    return maxN + 1;
}

async function registerPluginGroup(groupId, windowId, number) {
    const reg = await pruneDeadPluginGroups();
    reg.push({ groupId, windowId, number, createdAt: Date.now() });
    await writePluginGroupRegistry(reg);
    invalidateLiveGroupSeeds();
}
let clipboardOperation = null; // 'cut' | 'copy'
let selectedNodes = new Set(); // 多选节点集合
let selectedNodeMeta = new Map(); // 节点元信息：nodeId -> { treeType, sectionId }
let lastClickedNode = null; // 上次点击的节点（用于Shift选择）
let selectMode = false; // 是否处于Select模式

const BATCH_PANEL_STATE_MAP_KEY = 'batchPanelStateMap';
const BATCH_PANEL_LEGACY_KEY = 'batchPanelState';
const PERMANENT_SECTION_ANCHOR_ID = 'permanent-root';
let currentBatchPanelAnchorInfo = null; // 当前批量面板定位信息
let lastBatchSelectionInfo = null; // 最近一次选择所属栏目

function clampValue(value, min, max) {
    if (!Number.isFinite(value)) return min;
    if (min > max) return min;
    return Math.min(Math.max(value, min), max);
}

function getCurrentBatchPanelZoom() {
    let zoom = 1;
    try {
        if (typeof CanvasState !== 'undefined' && CanvasState && typeof CanvasState.zoom === 'number' && CanvasState.zoom > 0) {
            zoom = CanvasState.zoom;
        } else {
            const container = document.querySelector('.canvas-main-container');
            if (container) {
                const inlineZoom = parseFloat(container.style.getPropertyValue('--canvas-scale'));
                if (Number.isFinite(inlineZoom) && inlineZoom > 0) {
                    zoom = inlineZoom;
                } else {
                    const computed = getComputedStyle(container).getPropertyValue('--canvas-scale');
                    const computedZoom = parseFloat(computed);
                    if (Number.isFinite(computedZoom) && computedZoom > 0) {
                        zoom = computedZoom;
                    }
                }
            }
        }
    } catch (err) {
        console.warn('[批量面板] 读取缩放比例失败:', err);
    }
    return clampValue(zoom, 0.2, 3);
}

function computeBatchPanelSizing(anchorRect, zoom, viewportWidth, viewportHeight, margin) {
    const normalizedZoom = clampValue(zoom, 0.25, 2.5);
    const safeViewportWidth = Math.max(viewportWidth || 1280, 320);
    const safeViewportHeight = Math.max(viewportHeight || 720, 320);
    const baseMinWidth = 240;
    const baseMaxWidth = 640;
    const baseMinHeight = 200;
    const baseMaxHeight = safeViewportHeight - margin * 2;
    const baseDefaultWidth = 280;
    const baseDefaultHeight = 360;

    const minWidth = clampValue(baseMinWidth * normalizedZoom, 140, safeViewportWidth - margin * 2);
    const maxWidth = clampValue(baseMaxWidth * normalizedZoom, Math.max(minWidth + 1, 200), safeViewportWidth - margin * 2);
    const minHeight = clampValue(baseMinHeight * normalizedZoom, 140, baseMaxHeight);
    const maxHeight = clampValue(baseMaxHeight, Math.max(minHeight + 1, 140), safeViewportHeight - margin);

    const widthFromAnchor = anchorRect ? anchorRect.width * 0.52 : baseDefaultWidth * normalizedZoom;
    const heightFromAnchor = anchorRect ? Math.max(anchorRect.height - 48, baseMinHeight * 0.75) : baseDefaultHeight * normalizedZoom;

    const defaultWidth = clampValue(widthFromAnchor, minWidth, maxWidth);
    const defaultHeight = clampValue(heightFromAnchor, minHeight, maxHeight);
    const gap = Math.max(8, 12 * normalizedZoom);

    return {
        minWidth,
        maxWidth,
        minHeight,
        maxHeight,
        defaultWidth,
        defaultHeight,
        gap,
        normalizedZoom
    };
}

function applyBatchPanelTransform(panel, options = {}) {
    if (!panel) return;
    const baseTransform = options.baseTransform !== undefined
        ? (options.baseTransform || 'none')
        : (panel.dataset.baseTransform || 'none');
    panel.dataset.baseTransform = baseTransform;
    panel.style.transformOrigin = 'top left';
    panel.style.transform = baseTransform && baseTransform !== 'none' ? baseTransform : 'none';
}

function fitBatchPanelToContent(panel, options = {}) {
    if (!panel) return;
    const delay = options.delay || 0;
    const margin = options.margin || 16;
    const retries = options.retries !== undefined ? options.retries : 2;
    const attemptFit = () => {
        const content = panel.querySelector('.batch-panel-content');
        if (!content) return;
        const viewportWidth = window.innerWidth || 1920;
        const viewportHeight = window.innerHeight || 1080;
        const panelRect = panel.getBoundingClientRect();
        const contentRect = content.getBoundingClientRect();
        const widthPadding = panelRect.width - contentRect.width;
        const heightPadding = panelRect.height - contentRect.height;
        let desiredWidth = panelRect.width;
        let desiredHeight = panelRect.height;

        if (content.scrollWidth > content.clientWidth + 1) {
            desiredWidth = Math.min(content.scrollWidth + widthPadding, viewportWidth - margin * 2);
        }
        if (content.scrollHeight > content.clientHeight + 1) {
            desiredHeight = Math.min(content.scrollHeight + heightPadding, viewportHeight - margin * 2);
        }

        const minWidth = parseFloat(panel.style.minWidth) || 200;
        const maxWidth = parseFloat(panel.style.maxWidth) || (viewportWidth - margin * 2);
        const minHeight = parseFloat(panel.style.minHeight) || 200;
        const maxHeight = parseFloat(panel.style.maxHeight) || (viewportHeight - margin * 2);

        desiredWidth = Math.max(minWidth, Math.min(maxWidth, desiredWidth));
        desiredHeight = Math.max(minHeight, Math.min(maxHeight, desiredHeight));

        if (Math.abs(desiredWidth - panelRect.width) > 1) {
            panel.style.width = `${desiredWidth.toFixed(2)}px`;
        }
        if (Math.abs(desiredHeight - panelRect.height) > 1) {
            panel.style.height = `${desiredHeight.toFixed(2)}px`;
        }

        const updatedRect = panel.getBoundingClientRect();
        let left = updatedRect.left;
        let top = updatedRect.top;
        if (updatedRect.right > viewportWidth - margin) {
            left = Math.max(margin, viewportWidth - margin - updatedRect.width);
        }
        if (updatedRect.left < margin) {
            left = margin;
        }
        if (updatedRect.bottom > viewportHeight - margin) {
            top = Math.max(margin, viewportHeight - margin - updatedRect.height);
        }
        if (updatedRect.top < margin) {
            top = margin;
        }
        if (left !== updatedRect.left) {
            panel.style.left = `${left}px`;
            panel.style.right = 'auto';
        }
        if (top !== updatedRect.top) {
            panel.style.top = `${top}px`;
            panel.style.bottom = 'auto';
        }
        if (retries > 0) {
            setTimeout(() => fitBatchPanelToContent(panel, {
                delay: 0,
                margin,
                retries: retries - 1
            }), 60);
        }
    };

    if (delay > 0) {
        setTimeout(attemptFit, delay);
    } else {
        requestAnimationFrame(attemptFit);
    }
}

function getBatchPanelAnchorKey(info) {
    if (!info) return 'global';
    const type = info.treeType || 'permanent';
    const sectionId = info.sectionId || (type === 'permanent' ? PERMANENT_SECTION_ANCHOR_ID : 'global');
    return `${type}:${sectionId}`;
}

function findBatchPanelColumnElement(treeType, sectionId) {
    if (treeType === 'temporary' && sectionId) {
        return document.getElementById(sectionId) ||
            document.querySelector(`.temp-canvas-node[data-section-id="${sectionId}"]`) ||
            document.querySelector(`.bookmark-tree[data-section-id="${sectionId}"][data-tree-type="temporary"]`);
    }
    if (treeType === 'permanent') {
        return document.querySelector('.permanent-bookmark-section') ||
            document.getElementById('bookmarkTree')?.closest('.permanent-bookmark-section') ||
            document.getElementById('bookmarkTree');
    }
    return document.getElementById('bookmarkTree') ||
        document.querySelector('.bookmark-tree');
}

function getBatchPanelAnchorInfoFromElement(element) {
    if (!element) return null;

    const tempColumn = element.closest('.temp-canvas-node[data-section-id]');
    if (tempColumn) {
        return {
            treeType: 'temporary',
            sectionId: tempColumn.dataset.sectionId,
            element: tempColumn
        };
    }

    const tempTree = element.closest('.bookmark-tree[data-tree-type="temporary"][data-section-id]');
    if (tempTree) {
        const column = tempTree.closest('.temp-canvas-node[data-section-id]') || tempTree;
        return {
            treeType: 'temporary',
            sectionId: tempTree.dataset.sectionId,
            element: column
        };
    }

    const permanentColumn = element.closest('.permanent-bookmark-section');
    if (permanentColumn) {
        return {
            treeType: 'permanent',
            sectionId: PERMANENT_SECTION_ANCHOR_ID,
            element: permanentColumn
        };
    }

    const permanentTree = element.closest('#bookmarkTree, .bookmark-tree[data-tree-type="permanent"]');
    if (permanentTree) {
        const column = permanentTree.closest('.permanent-bookmark-section') || permanentTree;
        return {
            treeType: 'permanent',
            sectionId: PERMANENT_SECTION_ANCHOR_ID,
            element: column
        };
    }

    return null;
}

function getBatchPanelAnchorInfoFromSelection() {
    if (lastClickedNode) {
        const clickedElement = document.querySelector(`.tree-item[data-node-id="${lastClickedNode}"]`);
        const info = getBatchPanelAnchorInfoFromElement(clickedElement);
        if (info) return info;
    }

    if (lastBatchSelectionInfo) {
        const element = findBatchPanelColumnElement(lastBatchSelectionInfo.treeType, lastBatchSelectionInfo.sectionId);
        if (element) {
            return {
                treeType: lastBatchSelectionInfo.treeType,
                sectionId: lastBatchSelectionInfo.sectionId,
                element
            };
        }
    }

    const firstSelectedEntry = selectedNodes.values().next();
    if (!firstSelectedEntry.done) {
        const firstSelectedId = firstSelectedEntry.value;
        const nodeElement = document.querySelector(`.tree-item[data-node-id="${firstSelectedId}"]`);
        const info = getBatchPanelAnchorInfoFromElement(nodeElement);
        if (info) return info;
    }

    const permanentColumn = findBatchPanelColumnElement('permanent', PERMANENT_SECTION_ANCHOR_ID);
    if (permanentColumn) {
        return {
            treeType: 'permanent',
            sectionId: PERMANENT_SECTION_ANCHOR_ID,
            element: permanentColumn
        };
    }
    return null;
}

function resolveBatchPanelAnchorInfo(event) {
    let info = null;
    if (event && event.target) {
        info = getBatchPanelAnchorInfoFromElement(event.target);
    }

    if (!info && event && typeof event.clientX === 'number' && typeof event.clientY === 'number') {
        const elementBelow = document.elementFromPoint(event.clientX, event.clientY);
        info = getBatchPanelAnchorInfoFromElement(elementBelow);
    }

    if (!info) {
        info = getBatchPanelAnchorInfoFromSelection();
    }

    if (info && !info.element) {
        info.element = findBatchPanelColumnElement(info.treeType, info.sectionId);
    }

    return info;
}

function rememberBatchSelection(nodeElement) {
    if (!nodeElement) return;
    const treeType = nodeElement.dataset.treeType || 'permanent';
    const sectionId = treeType === 'temporary'
        ? (nodeElement.dataset.sectionId || null)
        : PERMANENT_SECTION_ANCHOR_ID;
    lastBatchSelectionInfo = {
        treeType,
        sectionId
    };
}

// 绑定超链接的右键菜单和左键点击（用于描述区域中的链接）
function attachHyperlinkContextMenu() {
    // 1. 右键菜单：使用事件委托，监听整个文档的右键点击
    document.addEventListener('contextmenu', (e) => {
        const targetEl = (e.target && e.target.nodeType === Node.ELEMENT_NODE)
            ? e.target
            : (e.target && e.target.parentElement ? e.target.parentElement : null);
        if (!targetEl) return;
        const linkElement = targetEl.closest('a[href]');
        if (!linkElement) return;

        // 检查是否在描述区域内
        const inPermanentTip = linkElement.closest('.permanent-section-tip, .permanent-section-tip-editor');
        const inTempDescription = linkElement.closest('.temp-node-description, .temp-node-description-editor');
        const inMdNodeContent = linkElement.closest('.md-canvas-text, .md-canvas-editor');

        if (inPermanentTip || inTempDescription || inMdNodeContent) {
            // 阻止默认右键菜单
            e.preventDefault();
            e.stopPropagation();

            console.log('[右键菜单] 检测到超链接右键:', {
                url: linkElement.href,
                text: linkElement.textContent,
                inPermanentTip: !!inPermanentTip,
                inTempDescription: !!inTempDescription,
                inMdNodeContent: !!inMdNodeContent
            });

            // 显示超链接专用菜单
            if (typeof showHyperlinkContextMenu === 'function') {
                showHyperlinkContextMenu(e, linkElement);
            } else {
                console.error('[右键菜单] showHyperlinkContextMenu 函数未定义');
            }
        }
    }, true); // 使用捕获阶段，优先处理

    // 2. 左键点击：按照勾选的默认方式打开
    document.addEventListener('click', async (e) => {
        const targetEl = (e.target && e.target.nodeType === Node.ELEMENT_NODE)
            ? e.target
            : (e.target && e.target.parentElement ? e.target.parentElement : null);
        if (!targetEl) return;
        const linkElement = targetEl.closest('a[href]');
        if (!linkElement) return;

        // 检查是否在描述区域内
        const inPermanentTip = linkElement.closest('.permanent-section-tip, .permanent-section-tip-editor');
        const inTempDescription = linkElement.closest('.temp-node-description, .temp-node-description-editor');
        const inMdNodeContent = linkElement.closest('.md-canvas-text, .md-canvas-editor');

        if (inPermanentTip || inTempDescription || inMdNodeContent) {
            // 编辑模式下不拦截（允许光标定位/修改链接文本）
            const inEditingArea = linkElement.closest('.md-canvas-node.editing, .temp-node-description-container.editing, .permanent-section-tip-container.editing');
            if (inEditingArea) return;

            // 如果有系统快捷键，走浏览器默认行为
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
                return;
            }

            // 阻止默认行为
            e.preventDefault();
            e.stopPropagation();

            const url = linkElement.href;
            const context = {
                url: url,
                title: linkElement.textContent || linkElement.title || url,
                isHyperlink: true,
                treeType: linkElement.closest('.temp-canvas-node') ? 'temporary' : 'permanent',
                sectionId: linkElement.closest('.temp-canvas-node')?.dataset.sectionId || null
            };

            console.log('[超链接] 左键点击，使用模式:', hyperlinkDefaultOpenMode);

            // 根据超链接的默认模式打开（6个选项）
            try {
                switch (hyperlinkDefaultOpenMode) {
                    case 'new-tab':
                        await openHyperlinkNewTab(url);
                        break;

                    case 'new-window':
                        await openHyperlinkNewWindow(url);
                        break;

                    case 'specific-window':
                        await openHyperlinkInSpecificWindow(url);
                        break;

                    case 'specific-group':
                        await openHyperlinkInSpecificTabGroup(url);
                        break;

                    case 'manual-select':
                        // 使用手动选择的窗口/组打开
                        await openBookmarkWithManualSelection(url);
                        break;

                    case 'incognito':
                        // 无痕窗口
                        await openHyperlinkIncognito(url);
                        break;

                    default:
                        // 默认使用新标签页
                        await openHyperlinkNewTab(url);
                }
            } catch (error) {
                console.error('[超链接] 左键打开失败:', error);
                window.open(url, '_blank'); // 失败时回退
            }
        }
    }, true); // 使用捕获阶段

    console.log('[右键菜单] 超链接右键菜单和左键点击已绑定');
}

// 初始化右键菜单
function initContextMenu() {
    // 创建菜单容器
    contextMenu = document.createElement('div');
    contextMenu.id = 'bookmark-context-menu';
    contextMenu.className = 'bookmark-context-menu';
    contextMenu.style.display = 'none';

    // 如果默认是横向布局，添加 horizontal-layout 类
    if (contextMenuHorizontal) {
        contextMenu.classList.add('horizontal-layout');
    }

    // 初始挂载到body，使用时会动态插入到目标节点附近
    document.body.appendChild(contextMenu);

    // 绑定超链接的右键菜单
    attachHyperlinkContextMenu();

    // 【修复】添加滚轮事件监听器，允许在菜单上滚动栏目
    // 当鼠标在菜单上滚动时，将事件传递给滚动容器
    contextMenu.addEventListener('wheel', (e) => {
        // 查找最近的滚动容器
        const scrollContainer = contextMenu.closest('.permanent-section-body, .temp-node-body');
        if (scrollContainer) {
            // 阻止菜单本身的默认滚动行为（因为菜单不是滚动容器）
            e.preventDefault();

            // 手动触发滚动容器的滚动
            // 使用 deltaY 和 deltaX 来支持纵向和横向滚动
            scrollContainer.scrollTop += e.deltaY;
            scrollContainer.scrollLeft += e.deltaX;

            // 注意：不调用 e.stopPropagation()，保持事件冒泡
        }
    }, { passive: false }); // 使用 passive: false 以允许 preventDefault()

    // 点击其他地方关闭菜单（使用捕获阶段，优先处理）
    document.addEventListener('click', (e) => {
        // 如果点击的不是菜单内部，关闭菜单
        if (contextMenu && !contextMenu.contains(e.target)) {
            hideContextMenu();
        }
    }, true);  // 使用捕获阶段

    // 也监听右键事件，关闭已打开的菜单
    document.addEventListener('contextmenu', (e) => {
        // 检查是否是超链接
        const linkElement = e.target.closest('a[href]');
        if (linkElement) {
            const inPermanentTip = linkElement.closest('.permanent-section-tip, .permanent-section-tip-editor');
            const inTempDescription = linkElement.closest('.temp-node-description, .temp-node-description-editor');
            const inMdNodeContent = linkElement.closest('.md-canvas-text, .md-canvas-editor'); // 修复：使用 md-canvas-text

            // 如果是描述区域的超链接，不要关闭菜单（由超链接处理器处理）
            if (inPermanentTip || inTempDescription || inMdNodeContent) {
                return;
            }
        }

        // 如果不是在树节点上右键，关闭菜单
        if (!e.target.closest('.tree-item[data-node-id]')) {
            hideContextMenu();
        }
    }, true);

    // ESC键关闭菜单
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideContextMenu();
        }
    });

    // Resize时不调整菜单位置（保持嵌入式相对定位）
    // 嵌入式菜单会随DOM自然调整，无需手动处理

    console.log('[右键菜单] 初始化完成');
}

function getNodeContext(node) {
    if (!node) return null;
    return {
        node,
        nodeId: node.dataset.nodeId,
        nodeTitle: node.dataset.nodeTitle,
        nodeUrl: node.dataset.nodeUrl,
        isFolder: node.dataset.nodeType === 'folder',
        treeType: node.dataset.treeType || 'permanent',
        sectionId: node.dataset.sectionId || null
    };
}

// 显示超链接右键菜单（用于描述中的链接）
async function showHyperlinkContextMenu(e, linkElement) {
    console.log('[超链接菜单] ========== 开始显示超链接菜单 ==========');
    console.log('[超链接菜单] linkElement:', linkElement);
    console.log('[超链接菜单] event:', e);

    e.preventDefault();
    e.stopPropagation();

    const url = linkElement.href;
    console.log('[超链接菜单] URL:', url);

    if (!url) {
        console.warn('[右键菜单] 超链接URL无效');
        return;
    }

    // 移除链接元素的title属性，避免显示浏览器默认tooltip
    if (linkElement.hasAttribute('title')) {
        linkElement.removeAttribute('title');
    }

    // 获取上下文（判断是永久栏目还是临时栏目）
    const permanentSection = linkElement.closest('#permanentSection, .permanent-bookmark-section');
    const tempNode = linkElement.closest('.temp-canvas-node');

    const context = {
        url: url,
        title: linkElement.textContent || linkElement.title || url,
        isHyperlink: true,
        treeType: tempNode ? 'temporary' : 'permanent',
        sectionId: tempNode ? tempNode.dataset.sectionId : null
    };

    console.log('[右键菜单] 显示超链接菜单:', context);

    // 刷新跟踪的打开目标
    await refreshTrackedOpenTargets();

    // 构建超链接菜单项
    const menuItems = buildHyperlinkMenuItems(context);

    // 渲染菜单
    const lang = currentLang || 'zh_CN';
    contextMenu.classList.remove('lang-zh', 'lang-en');
    contextMenu.classList.add(lang === 'zh_CN' ? 'lang-zh' : 'lang-en');

    // 超链接菜单始终使用紧凑的纵向布局
    contextMenu.classList.remove('horizontal-layout');
    contextMenu.classList.add('density-sm');

    let menuHTML = menuItems.map(item => {
        if (item.separator) {
            return '<div class="context-menu-separator"></div>';
        }

        const icon = item.icon ? `<i class="fas fa-${item.icon}"></i>` : '';
        const disabled = item.disabled ? 'disabled' : '';
        const selected = item.selected ? 'selected-open' : '';
        const colorClass = item.action === 'hyperlink-open-label' ? 'section-label' : '';
        const hiddenStyle = item.hidden ? 'style="display:none;"' : '';
        const labelContent = item.labelHTML ? item.labelHTML : `<span>${item.label || ''}</span>`;

        // 添加空title属性以防止浏览器默认tooltip
        return `
            <div class="context-menu-item ${disabled} ${colorClass} ${selected}" data-action="${item.action}" ${hiddenStyle} title="">
                ${icon}
                <span class="context-menu-item-label">${labelContent}</span>
            </div>
        `;
    }).join('');

    contextMenu.innerHTML = menuHTML;

    // 绑定sub-badge点击事件（超链接专用的强制新建操作）
    contextMenu.querySelectorAll('.sub-badge[data-sub-action]').forEach(badge => {
        badge.addEventListener('click', async (event) => {
            const subAction = badge.dataset.subAction;
            if (!subAction || !context || !context.url) return;
            event.preventDefault();
            event.stopPropagation();
            try {
                switch (subAction) {
                    // 同一标签组的"新分组"徽标
                    case 'hyperlink-same-group-new':
                        await openHyperlinkInSpecificTabGroup(context.url, { forceNew: true });
                        await setHyperlinkDefaultOpenMode('specific-group');
                        break;
                    // 同一窗口的"新窗口"徽标
                    case 'hyperlink-same-window-new':
                        await openHyperlinkInSpecificWindow(context.url, { forceNew: true });
                        await setHyperlinkDefaultOpenMode('specific-window');
                        break;
                    default:
                        console.warn('[超链接菜单] 未知的 sub-action:', subAction);
                }
            } catch (badgeError) {
                console.warn('[超链接菜单] sub-badge 操作失败:', badgeError);
            }
            hideContextMenu();
        });
    });

    // 绑定点击事件
    contextMenu.querySelectorAll('.context-menu-item:not(.disabled)').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = item.dataset.action;

            if (action === 'hyperlink-open-label') {
                return;
            }

            handleHyperlinkMenuAction(action, context);
            hideContextMenu();
        });
    });

    // 超链接使用固定定位（浮动菜单），不嵌入DOM，避免破坏文档流和蓝色条纹问题
    positionHyperlinkContextMenu(e, linkElement);
    contextMenu.style.display = 'block';
}

// 为超链接菜单使用固定定位（浮动在鼠标位置）
function positionHyperlinkContextMenu(event, linkElement) {
    // 确保菜单在body中
    if (contextMenu.parentElement !== document.body) {
        document.body.appendChild(contextMenu);
    }

    // 使用固定定位
    contextMenu.style.cssText = `
        position: fixed !important;
        display: block !important;
        margin: 0 !important;
        z-index: 10001 !important;
    `;

    // 获取点击位置
    const clickX = event.clientX;
    const clickY = event.clientY;

    // 获取菜单尺寸（先显示以获取真实尺寸）
    contextMenu.style.visibility = 'hidden';
    contextMenu.style.display = 'block';
    const menuRect = contextMenu.getBoundingClientRect();
    contextMenu.style.visibility = 'visible';

    // 视口尺寸
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 8;

    // 计算最佳位置（默认在鼠标右下方）
    let left = clickX + 2;
    let top = clickY + 2;

    // 防止超出右边界
    if (left + menuRect.width > viewportWidth - margin) {
        left = clickX - menuRect.width - 2;
    }

    // 防止超出左边界
    if (left < margin) {
        left = margin;
    }

    // 防止超出底部边界
    if (top + menuRect.height > viewportHeight - margin) {
        top = clickY - menuRect.height - 2;
    }

    // 防止超出顶部边界
    if (top < margin) {
        top = margin;
    }

    contextMenu.style.left = `${left}px`;
    contextMenu.style.top = `${top}px`;
    contextMenu.style.right = 'auto';
    contextMenu.style.bottom = 'auto';

    console.log('[超链接菜单] 使用固定定位:', {
        clickX,
        clickY,
        menuWidth: menuRect.width,
        menuHeight: menuRect.height,
        finalLeft: left,
        finalTop: top
    });
}

// 构建超链接菜单项（独立系统，6个选项 - 与书签系统隔离）
function buildHyperlinkMenuItems(context) {
    const lang = currentLang || 'zh_CN';
    const items = [];

    // 标题：打开超链接
    items.push({
        action: 'hyperlink-open-label',
        label: lang === 'zh_CN' ? '打开超链接：' : 'Open Hyperlink:',
        icon: '',
        disabled: true
    });

    // === 第一组：新建（新标签页 + 新窗口） ===

    // 1. in New Tab（新标签页）
    items.push({
        action: 'hyperlink-open-new-tab',
        label: lang === 'zh_CN' ? '新标签页' : 'in New Tab',
        icon: 'window-maximize',
        selected: hyperlinkDefaultOpenMode === 'new-tab'
    });

    // 2. in New Window（新窗口）
    items.push({
        action: 'hyperlink-open-new-window',
        label: lang === 'zh_CN' ? '新窗口' : 'in New Window',
        icon: 'window-restore',
        selected: hyperlinkDefaultOpenMode === 'new-window'
    });

    items.push({ separatorShort: true });

    // === 第二组：复用（同一标签组 + 同一窗口） ===

    // 3. in Same Group（同一标签组）- 带可点击的"新分组"徽标
    (() => {
        const showBadge = !!hyperlinkSpecificTabGroupId;
        const baseLabelZh = '同一标签组';
        const baseLabelEn = 'in Same Group';
        // 添加 data-sub-action 使徽标可点击，用于强制新建分组
        const badge = showBadge ? (lang === 'zh_CN' ? ' <span class="sub-badge" data-sub-action="hyperlink-same-group-new">新分组</span>' : ' <span class="sub-badge" data-sub-action="hyperlink-same-group-new">New Group</span>') : '';

        items.push({
            action: 'hyperlink-open-same-group',
            label: (lang === 'zh_CN' ? baseLabelZh : baseLabelEn) + badge,
            icon: 'object-group',
            selected: hyperlinkDefaultOpenMode === 'specific-group'
        });
    })();

    // 4. in Same Window（同一窗口）- 带可点击的"新窗口"徽标
    (() => {
        const showBadge = !!hyperlinkSpecificWindowId;
        const baseLabelZh = '同一窗口';
        const baseLabelEn = 'in Same Window';
        // 添加 data-sub-action 使徽标可点击，用于强制新建窗口
        const badge = showBadge ? (lang === 'zh_CN' ? ' <span class="sub-badge" data-sub-action="hyperlink-same-window-new">新窗口</span>' : ' <span class="sub-badge" data-sub-action="hyperlink-same-window-new">New Window</span>') : '';

        items.push({
            action: 'hyperlink-open-specific-window',
            label: (lang === 'zh_CN' ? baseLabelZh : baseLabelEn) + badge,
            icon: 'window-restore',
            selected: hyperlinkDefaultOpenMode === 'specific-window'
        });
    })();

    items.push({ separatorShort: true });

    // === 第三组：其他选项 ===

    // 5. 手动选择窗口+组（可勾选）
    items.push({
        action: 'hyperlink-open-manual-select',
        label: lang === 'zh_CN' ? '手动选择...' : 'Manual Select...',
        icon: 'crosshairs',
        selected: hyperlinkDefaultOpenMode === 'manual-select'
    });

    // 6. 无痕窗口
    items.push({
        action: 'hyperlink-open-incognito',
        label: lang === 'zh_CN' ? '无痕窗口' : 'in Incognito',
        icon: 'user-secret',
        selected: hyperlinkDefaultOpenMode === 'incognito'
    });

    return items;
}


// 处理超链接菜单操作（独立系统，6个选项）
async function handleHyperlinkMenuAction(action, context) {
    const url = context.url;
    const lang = currentLang || 'zh_CN';

    try {
        switch (action) {
            case 'hyperlink-open-new-tab':
                await openHyperlinkNewTab(url);
                await setHyperlinkDefaultOpenMode('new-tab');
                break;

            case 'hyperlink-open-new-window':
                await openHyperlinkNewWindow(url);
                await setHyperlinkDefaultOpenMode('new-window');
                break;

            case 'hyperlink-open-same-group':
                // 右键点击 = 勾选模式 + 复用已有分组打开（点击 sub-badge 才强制新建）
                await openHyperlinkInSpecificTabGroup(url);
                await setHyperlinkDefaultOpenMode('specific-group');
                break;

            case 'hyperlink-open-specific-window':
                // 右键点击 = 勾选模式 + 复用已有窗口打开（点击 sub-badge 才强制新建）
                await openHyperlinkInSpecificWindow(url);
                await setHyperlinkDefaultOpenMode('specific-window');
                break;

            case 'hyperlink-open-manual-select':
                // 打开手动选择窗口+组的选择器（超链接模式）
                await showManualWindowGroupSelector({ nodeUrl: url, isHyperlink: true });
                await setHyperlinkDefaultOpenMode('manual-select');
                break;


            case 'hyperlink-open-incognito':
                // 无痕窗口
                await openHyperlinkIncognito(url);
                await setHyperlinkDefaultOpenMode('incognito');
                break;

            default:
                console.warn('[超链接菜单] 未处理的操作:', action);
        }
    } catch (error) {
        console.error('[超链接菜单] 操作失败:', error);
        alert((lang === 'zh_CN' ? '操作失败: ' : 'Failed: ') + error.message);
    }
}

// 设置超链接默认打开方式（独立于书签系统）
async function setHyperlinkDefaultOpenMode(mode) {
    console.log('[超链接] setHyperlinkDefaultOpenMode:', mode);
    hyperlinkDefaultOpenMode = mode;
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ hyperlinkDefaultOpenMode: mode });
            console.log('[超链接] 已保存到 chrome.storage');
        } else {
            localStorage.setItem('hyperlinkDefaultOpenMode', mode);
            console.log('[超链接] 已保存到 localStorage');
        }
    } catch (err) {
        console.error('[超链接] 保存失败:', err);
    }
}

// 显示右键菜单
async function showContextMenu(e, node) {
    e.preventDefault();
    e.stopPropagation();

    currentContextNode = node;

    // 移除之前的右键选中标识
    document.querySelectorAll('.tree-item.context-selected').forEach(item => {
        item.classList.remove('context-selected');
    });

    // 添加右键选中标识
    node.classList.add('context-selected');

    // 获取节点信息
    const context = getNodeContext(node);
    if (!context || !context.nodeId) {
        console.warn('[右键菜单] 节点上下文无效');
        return;
    }

    const { nodeId, nodeTitle, nodeUrl, isFolder } = context;
    console.log('[右键菜单] 显示菜单:', { nodeId, nodeTitle, isFolder, treeType: context.treeType, sectionId: context.sectionId });

    // 菜单展示前刷新一次所有受管理的窗口/分组指针，避免引用失效对象
    await refreshTrackedOpenTargets();

    // 根据容器大小自适应布局与密度（若用户手动选择过布局，则尊重“按类型”用户设置）
    const container = node.closest('#permanentSection, .permanent-bookmark-section, .temp-canvas-node, .md-canvas-node, .canvas-main-container') || document.body;
    const rect = container.getBoundingClientRect();
    const availableWidth = Math.max(0, rect.width || window.innerWidth || 1024);

    // 宽度阈值：根据栏目的类型（永久/临时）做不同规划
    const scope = context.treeType === 'temporary' ? 'temporary' : 'permanent';
    // 永久栏目通常更宽：阈值更高；临时卡片更窄：阈值更低
    const H_BREAK_PERMANENT = 640; // >= 横向
    const H_BREAK_TEMP = 520;      // >= 横向
    const baseBreak = scope === 'permanent' ? H_BREAK_PERMANENT : H_BREAK_TEMP;

    // 密度阈值：<420 极窄（竖向+紧凑），<640 紧凑横向，其它横向舒适
    let density = 'md';
    if (availableWidth < 420) density = 'xs';
    else if (availableWidth < 640) density = 'sm';
    else if (availableWidth > 980) density = 'lg';

    // 自动切换布局；如果localStorage有“按类型”的显式偏好，则优先使用
    try {
        const savedTypeLayout = localStorage.getItem(`contextMenuLayout_${scope}`);
        if (savedTypeLayout === 'horizontal') contextMenuHorizontal = true;
        else if (savedTypeLayout === 'vertical') contextMenuHorizontal = false;
        else contextMenuHorizontal = availableWidth >= baseBreak;
    } catch (_) {
        contextMenuHorizontal = availableWidth >= baseBreak;
    }

    // 更新容器类名，并写入作用域，供切换按钮使用
    contextMenu.classList.toggle('horizontal-layout', contextMenuHorizontal);
    contextMenu.classList.remove('density-xs', 'density-sm', 'density-md', 'density-lg');
    contextMenu.classList.add(`density-${density}`);
    contextMenu.dataset.menuScope = scope;

    // 构建菜单项
    const menuItems = buildMenuItems(context);

    // 渲染菜单
    const lang = currentLang || 'zh_CN';

    // 添加语言class，用于CSS中区分中英文样式
    contextMenu.classList.remove('lang-zh', 'lang-en');
    contextMenu.classList.add(lang === 'zh_CN' ? 'lang-zh' : 'lang-en');

    let menuHTML;

    if (contextMenuHorizontal) {
        // 横向布局：按分组渲染
        const groups = {};
        const groupOrder = [];

        // 分组菜单项
        menuItems.forEach(item => {
            if (item.separator || item.separatorShort) return; // 横向布局忽略分隔符

            const groupName = item.group || 'default';
            if (!groups[groupName]) {
                groups[groupName] = [];
                groupOrder.push(groupName);
            }
            groups[groupName].push(item);
        });

        // 指定横向布局行次：
        // 行1：select；行2：open；行3：其余（delete/settings/structure等）
        const explicitOrder = [];
        if (groups.select) explicitOrder.push('select');
        if (groups.open) explicitOrder.push('open');
        // 其余分组保持出现顺序
        groupOrder.forEach(g => { if (!['select', 'open'].includes(g)) explicitOrder.push(g); });

        const groupElements = explicitOrder.map((groupName, idx) => {
            const groupItems = groups[groupName];
            const inner = groupItems.map(item => {
                const icon = item.icon ? `<i class="fas fa-${item.icon}"></i>` : '';
                const disabled = item.disabled ? 'disabled' : '';
                const selected = item.selected ? 'selected-open' : '';
                const labelClass = item.action === 'open-label' ? 'section-label' : '';
                const colorClass = item.action === 'select-item' ? 'color-blue' : item.action === 'delete' ? 'color-red' : '';
                const hiddenStyle = item.hidden ? 'style="display:none;"' : '';
                const extraClass = item.className ? item.className : '';
                const labelContent = item.labelHTML ? item.labelHTML : `<span>${item.label || ''}</span>`;
                return `
                    <div class="context-menu-item ${disabled} ${colorClass} ${selected} ${labelClass} ${extraClass}" data-action="${item.action}" ${hiddenStyle}>
                        ${icon}
                        <span class="context-menu-item-label">${labelContent}</span>
                    </div>`;
            }).join('');
            const html = `<div class="context-menu-group" data-group="${groupName}">${inner}</div>`;
            // 在第1组和第2组之后插入换行占位，使 delete/settings 固定到第3行
            if (idx === 0 || idx === 1) {
                return html + '<div class="context-menu-break"></div>';
            }
            return html;
        }).join('');

        menuHTML = groupElements;
    } else {
        // 纵向布局：原始格式
        menuHTML = menuItems.map(item => {
            if (item.separator) {
                return '<div class="context-menu-separator"></div>';
            }
            if (item.separatorShort) {
                return '<div class="context-menu-separator short"></div>';
            }

            const icon = item.icon ? `<i class="fas fa-${item.icon}"></i>` : '';
            const disabled = item.disabled ? 'disabled' : '';
            const selected = item.selected ? 'selected-open' : '';
            const labelClass = item.action === 'open-label' ? 'section-label' : '';
            const colorClass = item.action === 'select-item' ? 'color-blue' : item.action === 'delete' ? 'color-red' : '';
            const hiddenStyle = item.hidden ? 'style="display:none;"' : '';
            const extraClass = item.className ? item.className : '';
            const labelContent = item.labelHTML ? item.labelHTML : `<span>${item.label || ''}</span>`;

            return `
                <div class="context-menu-item ${disabled} ${colorClass} ${selected} ${labelClass} ${extraClass}" data-action="${item.action}" ${hiddenStyle}>
                    ${icon}
                    <span class="context-menu-item-label">${labelContent}</span>
                </div>
            `;
        }).filter(html => html !== '').join('');
    }

    contextMenu.innerHTML = menuHTML;

    contextMenu.querySelectorAll('.sub-badge[data-sub-action]').forEach(badge => {
        badge.addEventListener('click', async (event) => {
            const subAction = badge.dataset.subAction;
            if (!subAction || !context || !context.nodeUrl) return;
            event.preventDefault();
            event.stopPropagation();
            try {
                await openInSameWindowSpecificGroup(context.nodeUrl, {
                    context,
                    forceNewGroup: subAction === 'swsg-new-group' || subAction === 'swsg-new-window',
                    forceNewWindow: subAction === 'swsg-new-window'
                });
                await setDefaultOpenMode('same-window-specific-group');
            } catch (badgeError) {
                console.warn('[右键菜单] swsg badge failed', badgeError);
            }
            hideContextMenu();
        });
    });

    // 绑定点击事件
    contextMenu.querySelectorAll('.context-menu-item:not(.disabled)').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = item.dataset.action;

            // 切换布局时，不关闭菜单
            if (action === 'toggle-context-menu-layout') {
                toggleContextMenuLayout();
                // 重新渲染菜单以更新按钮文字
                showContextMenu(e, currentContextNode);
                return;
            }
            // 分组标题不处理
            if (action === 'open-label') {
                return;
            }

            handleMenuAction(action, context);
            hideContextMenu();
        });
    });

    // 将菜单嵌入到DOM中（插入到被右键的节点后面）
    embedContextMenu(node);

    contextMenu.style.display = 'block';
}

// 构建菜单项
function buildMenuItems(context) {
    const nodeId = context.nodeId;
    const nodeTitle = context.nodeTitle;
    const nodeUrl = context.nodeUrl;
    const isFolder = context.isFolder;
    const treeType = context.treeType || 'permanent';
    const lang = currentLang || 'zh_CN';
    const items = [];

    // 检查是否有选中项
    const hasSelection = selectedNodes.size > 0;

    // 检查当前右键的项是否已被选中
    const isNodeSelected = selectedNodes.has(nodeId);

    // 如果右键的是已选中的项，且有多个选中项，显示批量操作菜单
    if (isNodeSelected && selectedNodes.size > 0) {
        items.push(
            { action: 'batch-open', label: lang === 'zh_CN' ? `打开选中的 ${selectedNodes.size} 项` : `Open ${selectedNodes.size} Selected`, icon: 'folder-open' },
            { action: 'batch-open-tab-group', label: lang === 'zh_CN' ? '在新标签页组中打开' : 'Open in New Tab Group', icon: 'object-group' },
            { separator: true },
            { action: 'batch-cut', label: lang === 'zh_CN' ? '剪切选中项' : 'Cut Selected', icon: 'cut' },
            { action: 'batch-delete', label: lang === 'zh_CN' ? '删除选中项' : 'Delete Selected', icon: 'trash-alt' },
            { action: 'batch-rename', label: lang === 'zh_CN' ? '批量重命名' : 'Batch Rename', icon: 'edit' },
            { separator: true },
            { action: 'batch-export-html', label: lang === 'zh_CN' ? '导出为HTML' : 'Export to HTML', icon: 'file-code' },
            { action: 'batch-export-json', label: lang === 'zh_CN' ? '导出为JSON' : 'Export to JSON', icon: 'file-alt' },
            { action: 'batch-merge-folder', label: lang === 'zh_CN' ? '合并为新文件夹' : 'Merge to New Folder', icon: 'folder-plus' },
            { separator: true },
            { action: 'deselect-all', label: lang === 'zh_CN' ? '取消全选' : 'Deselect All', icon: 'times' }
        );
        return items;
    }

    // 普通单项菜单
    if (isFolder) {
        // 文件夹菜单 - 按分组组织
        items.push(
            // 选择组
            { action: 'select-item', label: lang === 'zh_CN' ? '选择（批量操作）' : 'Select (Batch)', icon: 'check-square', group: 'select' },

            // 编辑组 - 紧跟在select后面
            { action: 'rename', label: lang === 'zh_CN' ? '重命名' : 'Rename', icon: 'edit', group: 'select' },
            { action: 'cut', label: lang === 'zh_CN' ? '剪切' : 'Cut', icon: 'cut', group: 'select' },
            { action: 'copy', label: lang === 'zh_CN' ? '复制' : 'Copy', icon: 'copy', group: 'select' },
            { action: 'paste', label: lang === 'zh_CN' ? '粘贴到文件夹内' : 'Paste into Folder', icon: 'paste', disabled: !hasClipboard(), group: 'select' },
            { separator: true },

            // 打开组
            { action: 'open-all', label: lang === 'zh_CN' ? '打开全部' : 'Open All', icon: 'folder-open', group: 'open' },
            { action: 'open-all-tab-group', label: lang === 'zh_CN' ? '标签页组' : 'Tab Group', icon: 'object-group', group: 'open' },
            { action: 'open-all-new-window', label: lang === 'zh_CN' ? '新窗口' : 'New Window', icon: 'window-restore', group: 'open' },
            { action: 'open-all-incognito', label: lang === 'zh_CN' ? '无痕窗口' : 'Incognito', icon: 'user-secret', group: 'open' },
            { separator: true },

            // 结构/设置组（合并第三组）
            { action: 'add-page', label: lang === 'zh_CN' ? '添加网页' : 'Add Page', icon: 'plus-circle', group: 'structure' },
            { action: 'add-folder', label: lang === 'zh_CN' ? '添加文件夹' : 'Add Folder', icon: 'folder-plus', group: 'structure' },
            { action: 'delete', label: lang === 'zh_CN' ? '删除' : 'Delete', icon: 'trash-alt', group: 'structure' },
            { action: 'toggle-context-menu-layout', label: contextMenuHorizontal ? (lang === 'zh_CN' ? '纵向布局' : 'Vertical') : (lang === 'zh_CN' ? '横向布局' : 'Horizontal'), icon: 'exchange-alt', group: 'structure' }
        );
    } else {
        // 书签菜单 - 按分组组织
        items.push(
            // 选择组
            { action: 'select-item', label: lang === 'zh_CN' ? '选择（批量操作）' : 'Select (Batch)', icon: 'check-square', group: 'select' },

            // 编辑组 - 紧跟在select后面
            { action: 'edit', label: lang === 'zh_CN' ? '编辑' : 'Edit', icon: 'edit', group: 'select' },
            { action: 'cut', label: lang === 'zh_CN' ? '剪切' : 'Cut', icon: 'cut', group: 'select' },
            { action: 'copy', label: lang === 'zh_CN' ? '复制' : 'Copy', icon: 'copy', group: 'select' },
            // 将 Copy Link 放到 Copy 后面
            { action: 'copy-url', label: lang === 'zh_CN' ? '复制链接' : 'Copy Link', icon: 'link', group: 'select' },
            { action: 'paste', label: lang === 'zh_CN' ? '粘贴到下方' : 'Paste Below', icon: 'paste', disabled: !hasClipboard(), hidden: !hasClipboard(), group: 'select' },
            { separator: true },

            // 打开组（移除可点击的 Open，改为标题；英文改为 in ...）
            { action: 'open-label', label: lang === 'zh_CN' ? '打开：' : 'Open:', icon: '', group: 'open', disabled: true },
            (() => {
                const scope = getScopeFromContext(context);
                const hasWindow = Number.isInteger(sameWindowSpecificGroupWindowId);
                const scopeEntry = getSameWindowSpecificGroupEntry(scope.key);
                const canShowNewGroup = hasWindow && scopeEntry && scopeEntry.windowId === sameWindowSpecificGroupWindowId && Number.isInteger(scopeEntry.groupId);
                const badges = [];
                if (canShowNewGroup) {
                    badges.push(`<span class="sub-badge" data-sub-action="swsg-new-group">${lang === 'zh_CN' ? '新分组' : 'New Group'}</span>`);
                }
                if (hasWindow) {
                    badges.push(`<span class="sub-badge" data-sub-action="swsg-new-window">${lang === 'zh_CN' ? '新窗口' : 'New Window'}</span>`);
                }
                const baseLabelZh = '同窗特定组';
                const baseLabelEn = 'In Same Window & Specific Group';
                const badgeHtml = badges.length ? `<div class="swsg-badge-row">${badges.join('')}</div>` : '';
                const titleClass = lang === 'zh_CN' ? 'swsg-title' : 'swsg-title swsg-title-compact';
                const titleHtml = `<span class="${titleClass}">${lang === 'zh_CN' ? baseLabelZh : baseLabelEn}</span>`;
                return {
                    action: 'open-same-window-specific-group',
                    labelHTML: `${titleHtml}${badgeHtml}`,
                    label: lang === 'zh_CN' ? baseLabelZh : baseLabelEn,
                    icon: 'layer-group',
                    group: 'open',
                    className: 'swsg-option',
                    selected: defaultOpenMode === 'same-window-specific-group'
                };
            })(),
            // 新增：手动选择窗口+组（可勾选）
            {
                action: 'open-manual-select',
                label: lang === 'zh_CN' ? '手动选择...' : 'Manual Select...',
                icon: 'crosshairs',
                group: 'open',
                selected: defaultOpenMode === 'manual-select'
            },
            { separatorShort: true },
            { action: 'open-new-tab', label: lang === 'zh_CN' ? '新标签页' : 'in New Tab', icon: 'window-maximize', group: 'open', selected: defaultOpenMode === 'new-tab' },
            // 改名：原“特定标签组”改为“同一标签组”/“In Same Group”（带提示徽标）
            (() => {
                const showBadge = !!specificTabGroupId;
                const baseLabelZh = '同一标签组';
                const baseLabelEn = 'in Same Group';
                const badge = showBadge ? (lang === 'zh_CN' ? ' <span class="sub-badge">新分组</span>' : ' <span class="sub-badge">New Group</span>') : '';
                return { action: 'open-specific-group', label: (lang === 'zh_CN' ? baseLabelZh : baseLabelEn) + badge, icon: 'object-group', group: 'open', selected: defaultOpenMode === 'specific-group' };
            })(),
            // 新增：分栏“特定标签组”（放在“同一标签组”之下）
            (() => {
                const scope = getScopeFromContext(context);
                const showBadge = (scope.key === 'permanent') && !!(scopedCurrentGroups && scopedCurrentGroups[scope.key]);
                const baseLabelZh = '特定标签组';
                const baseLabelEn = 'in Specific Group';
                const badge = showBadge ? (lang === 'zh_CN' ? ' <span class="sub-badge">新分组</span>' : ' <span class="sub-badge">New Group</span>') : '';
                return { action: 'open-scoped-group', label: (lang === 'zh_CN' ? baseLabelZh : baseLabelEn) + badge, icon: 'object-group', group: 'open', selected: defaultOpenMode === 'scoped-group' };
            })(),
            // 纵向菜单在“标签组区域”后插入短分隔线（横向布局会被忽略）
            { separatorShort: true },
            // 第三行：窗口相关
            { action: 'open-new-window', label: lang === 'zh_CN' ? '新窗口' : 'in New Window', icon: 'window-restore', group: 'open2', selected: defaultOpenMode === 'new-window' },
            // 改名：原“特定窗口打开”改为“同一窗口”/“In Same Window”（带提示徽标）
            (() => {
                const showBadge = !!specificWindowId;
                const baseLabelZh = '同一窗口';
                const baseLabelEn = 'in Same Window';
                const badge = showBadge ? (lang === 'zh_CN' ? ' <span class="sub-badge">新窗口</span>' : ' <span class="sub-badge">New Window</span>') : '';
                return { action: 'open-specific-window', label: (lang === 'zh_CN' ? baseLabelZh : baseLabelEn) + badge, icon: 'window-restore', group: 'open2', selected: defaultOpenMode === 'specific-window' };
            })(),
            (() => {
                const scope = getScopeFromContext(context);
                const showBadge = (scope.key === 'permanent') && !!(scopedWindows && scopedWindows[scope.key]);
                const baseLabelZh = '特定窗口';
                const baseLabelEn = 'in Specific Window';
                const badge = showBadge ? (lang === 'zh_CN' ? ' <span class="sub-badge">新窗口</span>' : ' <span class="sub-badge">New Window</span>') : '';
                return { action: 'open-scoped-window', label: (lang === 'zh_CN' ? baseLabelZh : baseLabelEn) + badge, icon: 'window-restore', group: 'open2', selected: defaultOpenMode === 'scoped-window' };
            })(),
            { action: 'open-incognito', label: lang === 'zh_CN' ? '无痕窗口' : 'in Incognito', icon: 'user-secret', group: 'open2', selected: defaultOpenMode === 'incognito' },
            { separator: true },

            // 删除组
            { action: 'delete', label: lang === 'zh_CN' ? '删除' : 'Delete', icon: 'trash-alt', group: 'delete' },
            { separator: true },

            // 设置组
            { action: 'toggle-context-menu-layout', label: contextMenuHorizontal ? (lang === 'zh_CN' ? '纵向布局' : 'Vertical') : (lang === 'zh_CN' ? '横向布局' : 'Horizontal'), icon: 'exchange-alt', group: 'settings' }
        );
    }

    return items;
}

// 将菜单嵌入到DOM中（插入到树节点后面）
function embedContextMenu(node) {
    // 从当前位置移除菜单
    if (contextMenu.parentElement) {
        contextMenu.parentElement.removeChild(contextMenu);
    }

    // 找到合适的插入位置
    // 将菜单插入到被右键的节点后面
    const parent = node.parentElement;
    const nextSibling = node.nextSibling;

    if (nextSibling) {
        parent.insertBefore(contextMenu, nextSibling);
    } else {
        parent.appendChild(contextMenu);
    }

    // 使用相对定位，嵌入文档流
    contextMenu.style.cssText = `
        position: relative !important;
        display: block !important;
        margin-left: 20px !important;
        margin-top: 5px !important;
        margin-bottom: 5px !important;
    `;

    console.log('[右键菜单] 嵌入到DOM:', {
        parent: parent.className,
        position: 'relative',
        note: '嵌入式菜单，跟随元素滚动'
    });
}

// 隐藏菜单
function hideContextMenu() {
    if (contextMenu) {
        contextMenu.style.display = 'none';

        // 将菜单移回body，避免影响DOM结构
        if (contextMenu.parentElement !== document.body) {
            document.body.appendChild(contextMenu);
        }
    }

    // 移除右键选中标识
    document.querySelectorAll('.tree-item.context-selected').forEach(item => {
        item.classList.remove('context-selected');
    });

    currentContextNode = null;
}

// 显示粘贴按钮
function showPasteButton() {
    const pasteBtn = contextMenu.querySelector('[data-action="paste"]');
    if (pasteBtn) {
        pasteBtn.style.display = 'inline-flex';
        pasteBtn.classList.remove('paste-hidden');
        console.log('[右键菜单] 已显示粘贴按钮');
    }
}

// 隐藏粘贴按钮
function hidePasteButton() {
    const pasteBtn = contextMenu.querySelector('[data-action="paste"]');
    if (pasteBtn) {
        pasteBtn.style.display = 'none';
        pasteBtn.classList.add('paste-hidden');
        console.log('[右键菜单] 已隐藏粘贴按钮');
    }
}

// 检查是否有剪贴板内容
function hasClipboard() {
    return bookmarkClipboard !== null;
}

function getTempManager() {
    return (window.CanvasModule && window.CanvasModule.temp) ? window.CanvasModule.temp : null;
}

function ensureTempManager() {
    const manager = getTempManager();
    if (!manager) {
        throw new Error('临时栏目管理器不可用');
    }
    return manager;
}

function getSelectedTempNodes() {
    const nodes = [];
    selectedNodes.forEach(nodeId => {
        const meta = selectedNodeMeta.get(nodeId);
        if (!meta || meta.treeType !== 'temporary') return;
        const element = document.querySelector(`.tree-item[data-node-id="${nodeId}"]`);
        const isFolder = element ? element.dataset.nodeType === 'folder' : false;
        const title = element ? element.dataset.nodeTitle : '';
        nodes.push({
            id: nodeId,
            sectionId: meta.sectionId,
            element,
            isFolder,
            title,
            url: element ? element.dataset.nodeUrl : ''
        });
    });
    return nodes;
}

function getSelectedPermanentNodeIds() {
    const ids = [];
    selectedNodes.forEach(nodeId => {
        const meta = selectedNodeMeta.get(nodeId);
        const treeType = meta ? meta.treeType : 'permanent';
        if (treeType === 'permanent') {
            ids.push(nodeId);
        }
    });
    return ids;
}

function collectTempUrls(sectionId, nodeId) {
    const manager = getTempManager();
    if (!manager) return [];
    const entry = manager.findItem(sectionId, nodeId);
    if (!entry || !entry.item) return [];

    const urls = [];
    const traverse = (item) => {
        if (!item) return;
        if (item.type === 'bookmark' && item.url) {
            urls.push(item.url);
        }
        if (item.children && item.children.length) {
            item.children.forEach(traverse);
        }
    };

    traverse(entry.item);
    return urls;
}

async function openUrlList(urls, { newWindow = false, incognito = false, tabGroup = false } = {}) {
    if (!urls || !urls.length) {
        const lang = currentLang || 'zh_CN';
        alert(lang === 'zh_CN' ? '没有可打开的书签' : 'No bookmarks to open');
        return;
    }

    if (urls.length > 10) {
        const lang = currentLang || 'zh_CN';
        const message = lang === 'zh_CN'
            ? `确定要打开 ${urls.length} 个书签吗？`
            : `Open ${urls.length} bookmarks?`;
        if (!confirm(message)) return;
    }

    if (newWindow) {
        if (chrome && chrome.windows) {
            try {
                await chrome.windows.create({ url: urls, incognito });
            } catch (error) {
                if (incognito && error.message && error.message.includes('Incognito mode is disabled')) {
                    const lang = currentLang || 'zh_CN';
                    const message = lang === 'zh_CN'
                        ? '无痕模式已被禁用。将在普通窗口中打开。\n\n若要使用无痕模式，请在扩展管理页面启用"在无痕模式下启用"。'
                        : 'Incognito mode is disabled. Opening in normal window.\n\nTo use incognito mode, enable "Allow in Incognito" in extension settings.';
                    alert(message);
                    // 降级为普通新窗口
                    await chrome.windows.create({ url: urls, incognito: false });
                } else {
                    console.error('[openUrlList] 新窗口失败:', error);
                    urls.forEach(url => window.open(url, '_blank'));
                }
            }
        } else {
            urls.forEach(url => window.open(url, '_blank'));
        }
        return;
    }

    const openedTabIds = [];
    if (chrome && chrome.tabs) {
        for (const url of urls) {
            try {
                const tab = await chrome.tabs.create({ url, active: false });
                if (tab && typeof tab.id === 'number') {
                    openedTabIds.push(tab.id);
                }
            } catch (error) {
                console.warn('[临时栏目] 打开标签失败:', error);
            }
        }

        if (tabGroup && openedTabIds.length && chrome.tabs.group) {
            try {
                const groupId = await chrome.tabs.group({ tabIds: openedTabIds });
                if (chrome.tabGroups && chrome.tabGroups.update) {
                    await chrome.tabGroups.update(groupId, { title: 'Temp Bookmarks' });
                }
            } catch (error) {
                console.warn('[临时栏目] 创建标签页组失败:', error);
            }
        }
    } else {
        urls.forEach(url => window.open(url, '_blank'));
    }
}

async function openTempUrls(sectionId, nodeId, options = {}) {
    const urls = collectTempUrls(sectionId, nodeId);
    if (!urls.length) {
        const lang = currentLang || 'zh_CN';
        alert(lang === 'zh_CN' ? '文件夹中没有书签' : 'No bookmarks in folder');
        return;
    }
    await openUrlList(urls, options);
}

function getTempPasteTarget(context) {
    const manager = ensureTempManager();
    const sectionId = context.sectionId;
    if (!sectionId) throw new Error('未找到临时栏目');

    // 如果没有 nodeId，说明是在空白处粘贴，粘贴到根目录
    if (!context.nodeId) {
        return { sectionId, parentId: null, index: null };
    }

    let parentId = context.nodeId;
    let index = null;

    // 如果是文件夹，粘贴到文件夹内部
    if (context.isFolder) {
        parentId = context.nodeId;
        index = null; // 添加到文件夹末尾
    } else {
        // 如果是书签，粘贴到书签的下面
        const entry = manager.findItem(sectionId, context.nodeId);
        if (entry && entry.parent) {
            parentId = entry.parent.id || null;
            index = entry.index + 1; // 插入到当前书签的下一个位置
        } else {
            // 如果找不到父节点，粘贴到根目录
            parentId = null;
            index = null;
        }
    }

    return { sectionId, parentId, index };
}

async function editTempNode(context) {
    const manager = ensureTempManager();
    const { sectionId, nodeId, nodeTitle, nodeUrl, isFolder } = context;
    const lang = currentLang || 'zh_CN';

    if (isFolder) {
        const newTitle = prompt(
            lang === 'zh_CN' ? '重命名文件夹:' : 'Rename folder:',
            nodeTitle || ''
        );
        if (newTitle && newTitle !== nodeTitle) {
            manager.renameItem(sectionId, nodeId, newTitle.trim());
        }
        return;
    }

    const newTitle = prompt(
        lang === 'zh_CN' ? '书签名称:' : 'Bookmark name:',
        nodeTitle || ''
    );
    if (newTitle === null) return;

    const newUrl = prompt(
        lang === 'zh_CN' ? '书签地址:' : 'Bookmark URL:',
        nodeUrl || 'https://'
    );
    if (newUrl === null) return;

    manager.updateBookmark(sectionId, nodeId, {
        title: newTitle.trim(),
        url: newUrl.trim()
    });
}

async function addTempBookmarkAction(context) {
    const manager = ensureTempManager();
    const { sectionId, nodeId, isFolder } = context;
    const target = isFolder ? nodeId : getTempPasteTarget(context).parentId;
    const lang = currentLang || 'zh_CN';

    const title = prompt(
        lang === 'zh_CN' ? '新书签名称:' : 'New bookmark name:',
        ''
    );
    if (title === null) return;

    const url = prompt(
        lang === 'zh_CN' ? '新书签地址:' : 'New bookmark URL:',
        'https://'
    );
    if (url === null) return;

    manager.createBookmark(sectionId, target, title.trim(), url.trim());
}

async function addTempFolderAction(context) {
    const manager = ensureTempManager();
    const { sectionId, nodeId, isFolder } = context;
    const target = isFolder ? nodeId : getTempPasteTarget(context).parentId;
    const lang = currentLang || 'zh_CN';

    const title = prompt(
        lang === 'zh_CN' ? '新文件夹名称:' : 'New folder name:',
        ''
    );
    if (title === null) return;

    manager.createFolder(sectionId, target, title.trim());
}

async function deleteTempNodes(nodeIds, sectionId, nodeTitle, isFolder) {
    const manager = ensureTempManager();
    const ids = Array.isArray(nodeIds) ? nodeIds : [nodeIds];

    // 普通删除不需要二次确认，直接删除
    manager.removeItems(sectionId, ids);
}

function copyTempNodes(sectionId, nodeIds) {
    const manager = ensureTempManager();
    const ids = Array.isArray(nodeIds) ? nodeIds : [nodeIds];
    const payload = manager.extractPayload(sectionId, ids);

    bookmarkClipboard = {
        action: 'copy',
        source: 'temporary',
        sectionId,
        nodeIds: ids,
        payload,
        timestamp: Date.now()
    };
    clipboardOperation = 'copy';
    unmarkCutNode();
    showPasteButton();

    console.log('[临时栏目] 已复制节点:', ids.length);
}

async function cutTempNodes(sectionId, nodeIds) {
    const manager = ensureTempManager();
    const ids = Array.isArray(nodeIds) ? nodeIds : [nodeIds];
    const payload = manager.extractPayload(sectionId, ids);

    bookmarkClipboard = {
        action: 'cut',
        source: 'temporary',
        sectionId,
        nodeIds: ids,
        payload,
        timestamp: Date.now()
    };
    clipboardOperation = 'cut';

    unmarkCutNode();
    ids.forEach(id => markCutNode(id));
    showPasteButton();

    console.log('[临时栏目] 已剪切节点:', ids.length);
}

async function pasteIntoTemp(context) {
    if (!bookmarkClipboard) return;
    const manager = ensureTempManager();
    const target = getTempPasteTarget(context);

    try {
        if (bookmarkClipboard.source === 'temporary') {
            if (bookmarkClipboard.action === 'copy') {
                manager.insertFromPayload(target.sectionId, target.parentId, bookmarkClipboard.payload, target.index);
            } else if (bookmarkClipboard.action === 'cut') {
                if (bookmarkClipboard.sectionId === target.sectionId) {
                    manager.moveWithin(target.sectionId, bookmarkClipboard.nodeIds, target.parentId, target.index);
                } else {
                    manager.moveAcross(bookmarkClipboard.sectionId, target.sectionId, bookmarkClipboard.nodeIds, target.parentId, target.index);
                }
                bookmarkClipboard = null;
                clipboardOperation = null;
                unmarkCutNode();
            }
            return;
        }

        if (bookmarkClipboard.source === 'permanent') {
            let payload = bookmarkClipboard.payload;
            if (!payload || !payload.length) {
                payload = [];
                if (chrome && chrome.bookmarks && bookmarkClipboard.nodeIds) {
                    for (const id of bookmarkClipboard.nodeIds) {
                        const nodes = await chrome.bookmarks.getSubTree(id);
                        if (nodes && nodes[0]) {
                            payload.push(serializeBookmarkNode(nodes[0]));
                        }
                    }
                }
            }

            if (payload && payload.length) {
                manager.insertFromPayload(target.sectionId, target.parentId, payload, target.index);
            }

            if (bookmarkClipboard.action === 'cut' && bookmarkClipboard.nodeIds) {
                for (const id of bookmarkClipboard.nodeIds) {
                    try {
                        if (chrome && chrome.bookmarks) {
                            await chrome.bookmarks.removeTree(id);
                        }
                    } catch (error) {
                        console.warn('[临时栏目] 移除原始书签失败:', error);
                    }
                }
                // 不调用 refreshBookmarkTree()，让 onRemoved 事件触发增量更新
                bookmarkClipboard = null;
                clipboardOperation = null;
                unmarkCutNode();
            }
        }
    } catch (error) {
        console.error('[临时栏目] 粘贴失败:', error);
        const lang = currentLang || 'zh_CN';
        alert(lang === 'zh_CN' ? `粘贴失败: ${error.message}` : `Paste failed: ${error.message}`);
    }
}

function serializeBookmarkNode(node) {
    if (!node) return null;
    return {
        title: node.title,
        url: node.url || '',
        type: node.url ? 'bookmark' : 'folder',
        children: (node.children || []).map(serializeBookmarkNode)
    };
}

async function handleTempMenuAction(action, context) {
    switch (action) {
        case 'open':
            await openBookmark(context.nodeUrl);
            break;
        case 'open-new-tab':
            if (!shouldAllowBookmarkOpen(`${action}-${context.nodeUrl}`)) return;
            await openBookmarkNewTab(context.nodeUrl);
            await setDefaultOpenMode('new-tab');
            break;
        case 'open-new-window':
            if (!shouldAllowBookmarkOpen(`${action}-${context.nodeUrl}`)) return;
            await openBookmarkNewWindow(context.nodeUrl, false);
            await setDefaultOpenMode('new-window');
            break;
        case 'open-incognito':
            if (!shouldAllowBookmarkOpen(`${action}-${context.nodeUrl}`)) return;
            await openBookmarkNewWindow(context.nodeUrl, true);
            await setDefaultOpenMode('incognito');
            break;
        case 'open-specific-window':
            if (!shouldAllowBookmarkOpen(`${action}-${context.nodeUrl}`)) return;
            await openInSpecificWindow(context.nodeUrl, { forceNew: true, context });
            await setDefaultOpenMode('specific-window');
            break;
        case 'open-specific-group':
            if (!shouldAllowBookmarkOpen(`${action}-${context.nodeUrl}`)) return;
            await openInSpecificTabGroup(context.nodeUrl, { forceNew: true });
            await setDefaultOpenMode('specific-group');
            break;
        case 'open-same-window-specific-group':
            if (!shouldAllowBookmarkOpen(`${action}-${context.nodeUrl}`)) return;
            await openInSameWindowSpecificGroup(context.nodeUrl, { context });
            await setDefaultOpenMode('same-window-specific-group');
            break;
        case 'open-manual-select':
            // 打开手动选择窗口+组的选择器
            await showManualWindowGroupSelector(context);
            break;
        case 'open-scoped-window':
            if (!shouldAllowBookmarkOpen(`${action}-${context.nodeUrl}`)) return;
            await openInScopedWindow(context.nodeUrl, { context, forceNew: true });
            await setDefaultOpenMode('scoped-window');
            break;
        case 'open-scoped-group':
            if (!shouldAllowBookmarkOpen(`${action}-${context.nodeUrl}`)) return;
            await openInScopedTabGroup(context.nodeUrl, { context, forceNew: true });
            await setDefaultOpenMode('scoped-group');
            break;
        case 'open-all':
            await openTempUrls(context.sectionId, context.nodeId, { newWindow: false, incognito: false });
            break;
        case 'open-all-new-window':
            await openTempUrls(context.sectionId, context.nodeId, { newWindow: true, incognito: false });
            break;
        case 'open-all-incognito':
            await openTempUrls(context.sectionId, context.nodeId, { newWindow: true, incognito: true });
            break;
        case 'open-all-tab-group':
            await openTempUrls(context.sectionId, context.nodeId, { tabGroup: true });
            break;
        case 'edit':
        case 'rename':
            await editTempNode(context);
            break;
        case 'add-page':
            await addTempBookmarkAction(context);
            break;
        case 'add-folder':
            await addTempFolderAction(context);
            break;
        case 'delete':
            await deleteTempNodes(context.nodeId, context.sectionId, context.nodeTitle, context.isFolder);
            break;
        case 'cut':
            await cutTempNodes(context.sectionId, context.nodeId);
            break;
        case 'copy':
            copyTempNodes(context.sectionId, context.nodeId);
            break;
        case 'paste':
            await pasteIntoTemp(context);
            break;
        case 'select-item':
            // 进入Select模式并切换当前节点的选中状态
            if (!selectMode) {
                enterSelectMode();
            }
            if (context.nodeId) {
                toggleSelectItem(context.nodeId, context.node);
            }
            updateBatchToolbar();
            break;
        case 'deselect-all':
            deselectAll();
            updateBatchToolbar();
            break;
        case 'batch-open':
            await batchOpenTemp();
            break;
        case 'batch-open-tab-group':
            await batchOpenTemp({ tabGroup: true });
            break;
        case 'batch-cut':
            await batchCutTemp();
            break;
        case 'batch-delete':
            await batchDeleteTemp();
            break;
        case 'batch-rename':
            await batchRenameTemp();
            break;
        case 'batch-export-html':
        case 'batch-export-json':
        case 'batch-merge-folder':
            alert('该功能暂未在临时栏目中实现');
            break;
        default:
            console.warn('[临时栏目] 未处理的菜单操作:', action);
    }
}

async function batchOpenTemp(options = {}) {
    const tempNodes = getSelectedTempNodes();
    if (!tempNodes.length) {
        const lang = currentLang || 'zh_CN';
        alert(lang === 'zh_CN' ? '请先选择临时栏目中的书签或文件夹' : 'Select temporary bookmarks first');
        return;
    }
    const urlSet = new Set();
    tempNodes.forEach(node => {
        if (node.isFolder) {
            collectTempUrls(node.sectionId, node.id).forEach(url => urlSet.add(url));
        } else if (node.url) {
            urlSet.add(node.url);
        }
    });
    await openUrlList(Array.from(urlSet), options);
}

async function batchCutTemp() {
    const tempNodes = getSelectedTempNodes();
    if (!tempNodes.length) return;
    const sectionId = tempNodes[0].sectionId;
    const allSameSection = tempNodes.every(node => node.sectionId === sectionId);
    if (!allSameSection) {
        const lang = currentLang || 'zh_CN';
        alert(lang === 'zh_CN' ? '剪切操作仅支持同一临时栏目内的节点' : 'Cut only supports nodes within the same temporary section');
        return;
    }
    const ids = tempNodes.map(node => node.id);
    await cutTempNodes(sectionId, ids);
}

async function batchDeleteTemp() {
    const tempNodes = getSelectedTempNodes();
    if (!tempNodes.length) return;
    const lang = currentLang || 'zh_CN';
    const message = lang === 'zh_CN'
        ? `确定要删除选中的 ${tempNodes.length} 项吗？`
        : `Delete ${tempNodes.length} selected items?`;
    if (!confirm(message)) return;
    const manager = ensureTempManager();
    const sectionGroups = new Map();
    tempNodes.forEach(node => {
        if (!sectionGroups.has(node.sectionId)) {
            sectionGroups.set(node.sectionId, []);
        }
        sectionGroups.get(node.sectionId).push(node.id);
    });
    sectionGroups.forEach((ids, sectionId) => {
        manager.removeItems(sectionId, ids);
    });
    deselectAll();
}

async function batchRenameTemp() {
    const tempNodes = getSelectedTempNodes();
    if (!tempNodes.length) return;
    const manager = ensureTempManager();
    const lang = currentLang || 'zh_CN';
    for (const node of tempNodes) {
        if (node.isFolder) {
            const newTitle = prompt(
                lang === 'zh_CN' ? `重命名文件夹 (${node.title}):` : `Rename folder (${node.title}):`,
                node.title || ''
            );
            if (newTitle !== null && newTitle.trim() !== '' && newTitle !== node.title) {
                manager.renameItem(node.sectionId, node.id, newTitle.trim());
            }
        } else {
            const newTitle = prompt(
                lang === 'zh_CN' ? `重命名书签 (${node.title}):` : `Rename bookmark (${node.title}):`,
                node.title || ''
            );
            if (newTitle === null) continue;
            const newUrl = prompt(
                lang === 'zh_CN' ? '更新书签地址:' : 'Update bookmark URL:',
                node.url || 'https://'
            );
            if (newUrl === null) continue;
            manager.updateBookmark(node.sectionId, node.id, {
                title: newTitle.trim(),
                url: newUrl.trim()
            });
        }
    }
}
// 处理菜单操作
async function handleMenuAction(action, context) {
    if (!context) return;
    const { nodeId, nodeTitle, nodeUrl, isFolder, treeType } = context;
    console.log('[右键菜单] 执行操作:', action, { nodeId, nodeTitle, isFolder, treeType });
    if (treeType === 'temporary' && action !== 'toggle-context-menu-layout') {
        await handleTempMenuAction(action, context);
        return;
    }

    try {
        switch (action) {
            case 'open':
                await openBookmark(nodeUrl);
                break;

            case 'open-new-tab':
                if (!shouldAllowBookmarkOpen(`${action}-${nodeUrl}`)) return;
                await openBookmarkNewTab(nodeUrl);
                await setDefaultOpenMode('new-tab');
                break;

            case 'open-new-window':
                if (!shouldAllowBookmarkOpen(`${action}-${nodeUrl}`)) return;
                await openBookmarkNewWindow(nodeUrl, false);
                await setDefaultOpenMode('new-window');
                break;

            case 'open-incognito':
                if (!shouldAllowBookmarkOpen(`${action}-${nodeUrl}`)) return;
                await openBookmarkNewWindow(nodeUrl, true);
                await setDefaultOpenMode('incognito');
                break;

            case 'open-specific-group':
                if (!shouldAllowBookmarkOpen(`${action}-${nodeUrl}`)) return;
                await openInSpecificTabGroup(nodeUrl, { forceNew: true });
                await setDefaultOpenMode('specific-group');
                break;

            case 'open-same-window-specific-group':
                if (!shouldAllowBookmarkOpen(`${action}-${nodeUrl}`)) return;
                await openInSameWindowSpecificGroup(nodeUrl, { context });
                await setDefaultOpenMode('same-window-specific-group');
                break;

            case 'open-specific-window':
                if (!shouldAllowBookmarkOpen(`${action}-${nodeUrl}`)) return;
                await openInSpecificWindow(nodeUrl, { forceNew: true, context });
                await setDefaultOpenMode('specific-window');
                break;

            case 'open-scoped-group':
                if (!shouldAllowBookmarkOpen(`${action}-${nodeUrl}`)) return;
                await openInScopedTabGroup(nodeUrl, { context, forceNew: true });
                await setDefaultOpenMode('scoped-group');
                break;

            case 'open-scoped-window':
                if (!shouldAllowBookmarkOpen(`${action}-${nodeUrl}`)) return;
                await openInScopedWindow(nodeUrl, { context, forceNew: true });
                await setDefaultOpenMode('scoped-window');
                break;

            case 'open-all':
                await openAllBookmarks(nodeId, false, false);
                break;

            case 'open-all-new-window':
                await openAllBookmarks(nodeId, true, false);
                break;

            case 'open-all-incognito':
                await openAllBookmarks(nodeId, true, true);
                break;

            case 'open-all-tab-group':
                await openAllInTabGroup(nodeId);
                break;

            case 'open-selected':
                await openSelectedBookmarks();
                break;

            case 'open-selected-tab-group':
                await openSelectedInTabGroup();
                break;

            // 批量操作
            case 'batch-open':
                await batchOpen();
                break;

            case 'batch-open-tab-group':
                await batchOpenTabGroup();
                break;

            case 'batch-open-manual-select':
                await batchOpenWithManualSelection();
                break;

            case 'batch-cut':
                await batchCut();
                break;

            case 'batch-delete':
                await batchDelete();
                break;

            case 'batch-rename':
                await batchRename();
                break;

            case 'batch-export-html':
                await batchExportHTML();
                break;

            case 'batch-export-json':
                await batchExportJSON();
                break;

            case 'batch-merge-folder':
                await batchMergeFolder();
                break;

            case 'select-item':
                enterSelectMode();
                // 切换当前右键点击的节点的选中状态
                if (nodeId) {
                    toggleSelectItem(nodeId);
                }
                break;

            case 'deselect-all':
                deselectAll();
                updateBatchToolbar();
                break;

            case 'edit':
            case 'rename':
                await editBookmark(nodeId, nodeTitle, nodeUrl, isFolder);
                break;

            case 'add-page':
                await addBookmark(nodeId);
                break;

            case 'add-folder':
                await addFolder(nodeId);
                break;

            case 'cut':
                await cutBookmark(nodeId, nodeTitle, isFolder);
                showPasteButton();
                break;

            case 'copy':
                await copyBookmark(nodeId, nodeTitle, isFolder);
                showPasteButton();
                break;

            case 'paste':
                await pasteBookmark(nodeId, isFolder);
                break;

            case 'copy-url':
                await copyUrl(nodeUrl);
                break;

            case 'delete':
                await deleteBookmark(nodeId, nodeTitle, isFolder);
                break;

            case 'toggle-context-menu-layout':
                toggleContextMenuLayout();
                break;

            case 'open-manual-select':
                // 打开手动选择窗口+组的选择器
                await showManualWindowGroupSelector(context);
                break;

            default:
                console.warn('[右键菜单] 未知操作:', action);
        }
    } catch (error) {
        console.error('[右键菜单] 操作失败:', error);
        const lang = currentLang || 'zh_CN';
        alert(lang === 'zh_CN' ? `操作失败: ${error.message}` : `Operation failed: ${error.message}`);
    }
}

// 打开书签（根据defaultOpenMode决定打开方式）
async function openBookmark(url) {
    if (!url) return;

    // 如果默认打开方式是手动选择，使用保存的窗口/组打开
    if (defaultOpenMode === 'manual-select') {
        await openBookmarkWithManualSelection(url);
        return;
    }

    window.open(url, '_blank');
}

// 在新标签页中打开
async function openBookmarkNewTab(url) {
    if (!url) return;
    if (chrome && chrome.tabs) {
        chrome.tabs.create({ url: url });
    } else {
        window.open(url, '_blank');
    }
}

// 在新标签页中打开（统一接口，支持超链接标识）
async function openInNewTab(url, opts = {}) {
    const { context = null, isHyperlink = false } = opts || {};
    if (!url) return;

    if (isHyperlink) {
        // 超链接打开：暂不添加特殊标识，直接打开
        // 未来可以考虑创建带标识的组
        await openBookmarkNewTab(url);
    } else {
        await openBookmarkNewTab(url);
    }
}

// 在新窗口中打开（统一接口，支持超链接标识）
async function openInNewWindow(url, opts = {}) {
    const { context = null, isHyperlink = false, incognito = false } = opts || {};
    if (!url) return;

    if (isHyperlink) {
        // 超链接在新窗口打开：创建带"超链接"标记的窗口
        try {
            if (typeof chrome !== 'undefined' && chrome.windows && chrome.tabs) {
                const lang = currentLang || 'zh_CN';
                const hyperlinkTitle = lang === 'zh_CN' ? '超链接' : 'Hyperlink';
                const created = await chrome.windows.create({ url });

                // 添加标记页
                if (created && created.id) {
                    try {
                        const params = new URLSearchParams();
                        params.set('t', hyperlinkTitle);
                        const markerUrl = (chrome && chrome.runtime && chrome.runtime.getURL)
                            ? chrome.runtime.getURL(`history_html/window_marker.html?${params.toString()}`)
                            : null;
                        if (markerUrl) {
                            const markerTab = await chrome.tabs.create({
                                windowId: created.id,
                                url: markerUrl,
                                pinned: false,
                                active: false
                            });
                            try {
                                if (markerTab && markerTab.id != null) {
                                    await chrome.tabs.move(markerTab.id, { index: 0 });
                                }
                            } catch (_) { }
                        }
                    } catch (_) { }
                }
            } else {
                window.open(url, '_blank');
            }
        } catch (error) {
            console.error('[超链接新窗口] 打开失败:', error);
            window.open(url, '_blank');
        }
    } else {
        await openBookmarkNewWindow(url, incognito);
    }
}

// 在同一标签组中打开（统一接口，支持超链接标识）
async function openInSameGroup(url, opts = {}) {
    const { context = null, isHyperlink = false, forceNew = false } = opts || {};
    if (!url) return;

    if (isHyperlink) {
        // 超链接在标签组打开：使用"超链接"标题
        if (typeof chrome === 'undefined' || !chrome.tabs) {
            window.open(url, '_blank');
            return;
        }

        try {
            const lang = currentLang || 'zh_CN';
            const hyperlinkTitle = lang === 'zh_CN' ? '超链接' : 'Hyperlink';

            // 检查是否已有超链接专用组（使用特殊标识）
            const HYPERLINK_GROUP_KEY = '_hyperlink_group_id';
            let hyperlinkGroupId = null;

            try {
                const stored = localStorage.getItem(HYPERLINK_GROUP_KEY);
                if (stored) {
                    hyperlinkGroupId = parseInt(stored, 10);
                    // 验证组是否仍然存在
                    if (chrome.tabGroups && chrome.tabGroups.get) {
                        await chrome.tabGroups.get(hyperlinkGroupId);
                    }
                }
            } catch (_) {
                hyperlinkGroupId = null;
                localStorage.removeItem(HYPERLINK_GROUP_KEY);
            }

            if (hyperlinkGroupId) {
                // 复用现有超链接组
                const tab = await chrome.tabs.create({ url, active: false });
                await chrome.tabs.group({ groupId: hyperlinkGroupId, tabIds: tab.id });
            } else {
                // 创建新的超链接组
                const tab = await chrome.tabs.create({ url, active: false });
                const groupId = await chrome.tabs.group({ tabIds: tab.id });
                if (chrome.tabGroups && chrome.tabGroups.update) {
                    try {
                        await chrome.tabGroups.update(groupId, {
                            title: hyperlinkTitle,
                            color: 'cyan'
                        });
                    } catch (_) { }
                }
                localStorage.setItem(HYPERLINK_GROUP_KEY, String(groupId));
            }
        } catch (error) {
            console.warn('[超链接标签组] 打开失败:', error);
            window.open(url, '_blank');
        }
    } else {
        await openInSpecificTabGroup(url, { forceNew });
    }
}

// 在新窗口中打开
async function openBookmarkNewWindow(url, incognito = false) {
    if (!url) return;
    if (chrome && chrome.windows) {
        try {
            await chrome.windows.create({ url: url, incognito: incognito });
        } catch (error) {
            // 处理无痕模式被禁用的错误
            if (incognito && error.message && error.message.includes('Incognito mode is disabled')) {
                const lang = currentLang || 'zh_CN';
                const message = lang === 'zh_CN'
                    ? '无痕模式已被禁用。\n\n请在扩展管理页面启用"在无痕模式下启用"选项：\n1. 右键点击扩展图标\n2. 选择"管理扩展程序"\n3. 启用"在无痕模式下启用"'
                    : 'Incognito mode is disabled.\n\nPlease enable "Allow in Incognito" in extension settings:\n1. Right-click extension icon\n2. Select "Manage extensions"\n3. Enable "Allow in Incognito"';
                alert(message);
                // 降级为普通新窗口
                await chrome.windows.create({ url: url, incognito: false });
            } else {
                console.error('[新窗口] 打开失败:', error);
                window.open(url, '_blank');
            }
        }
    } else {
        window.open(url, '_blank');
    }
}

// 在特定标签页组中打开：首次创建标签组，后续复用
async function openInSpecificTabGroup(url, options = {}) {
    const { forceNew = false } = options;
    if (!url) return;
    if (typeof chrome === 'undefined' || !chrome.tabs) {
        // 回退
        window.open(url, '_blank');
        return;
    }
    try {
        if (forceNew) {
            await resetSpecificGroupInfo();
        }

        // 如果已有分组，先校验分组与窗口是否有效
        if (specificTabGroupId && Number.isInteger(specificTabGroupId)) {
            try {
                // 校验组是否存在
                if (chrome.tabGroups && chrome.tabGroups.get) {
                    await chrome.tabGroups.get(specificTabGroupId);
                }
                // 校验窗口是否存在
                if (specificGroupWindowId && chrome.windows && chrome.windows.get) {
                    await chrome.windows.get(specificGroupWindowId, { populate: false });
                }
                const tab = await chrome.tabs.create({ url, active: false, windowId: specificGroupWindowId || undefined });
                await chrome.tabs.group({ groupId: specificTabGroupId, tabIds: tab.id });
                return;
            } catch (err) {
                // 可能分组或窗口失效，重置后走创建逻辑
                await resetSpecificGroupInfo();
            }
        }

        // 创建新标签并建立新的分组
        const nextNumber = await allocateNextGroupNumber();
        const tab = await chrome.tabs.create({ url, active: false });
        const groupId = await chrome.tabs.group({ tabIds: tab.id });
        await setSpecificGroupInfo(groupId, tab.windowId || null);
        if (chrome.tabGroups && chrome.tabGroups.update) {
            try { await chrome.tabGroups.update(groupId, { title: String(nextNumber), color: 'blue' }); } catch (_) { }
        }
        await registerPluginGroup(groupId, tab.windowId || null, nextNumber);
    } catch (error) {
        console.warn('[特定标签组] 打开失败:', error);
        // 兜底回退
        try { window.open(url, '_blank'); } catch (_) { }
    }
}

// 在特定窗口中打开：首次创建窗口A，后续复用
async function openInSpecificWindow(url, options = {}) {
    const { forceNew = false, context = null } = options;
    if (!url) return;
    try {
        if (typeof chrome !== 'undefined' && chrome.windows && chrome.tabs) {
            // 若切换回“特定窗口”，则重置，创建一个全新的窗口
            if (forceNew) {
                specificWindowId = null;
            }

            // 检查窗口是否存在（且未被关闭）
            if (specificWindowId) {
                try {
                    const win = await chrome.windows.get(specificWindowId, { populate: false });
                    if (win && win.id) {
                        await chrome.tabs.create({ windowId: specificWindowId, url });
                        return;
                    }
                } catch (_) {
                    // 窗口不存在，创建新的
                }
            }
            const created = await chrome.windows.create({ url });
            if (created && created.id) {
                await setSpecificWindowId(created.id);
                // 为“同一窗口”创建可见标记页（用于命名），标题使用连续编号
                try {
                    const nextNum = await allocateNextWindowNumber();
                    await registerPluginWindow(created.id, nextNum);
                    const lt = (context && context.treeType === 'temporary') ? 'temporary' : 'permanent';
                    const sid = (lt === 'temporary' && context && context.sectionId) ? context.sectionId : '';
                    const nid = (lt === 'permanent' && context && context.nodeId) ? context.nodeId : '';
                    const params = new URLSearchParams();
                    params.set('t', String(nextNum));
                    if (lt) params.set('lt', lt);
                    if (sid) params.set('sid', sid);
                    if (nid) params.set('nid', nid);
                    const markerUrl = (chrome && chrome.runtime && chrome.runtime.getURL)
                        ? chrome.runtime.getURL(`history_html/window_marker.html?${params.toString()}`)
                        : null;
                    if (markerUrl && chrome && chrome.tabs && chrome.tabs.create) {
                        const markerTab = await chrome.tabs.create({ windowId: created.id, url: markerUrl, pinned: false, active: false });
                        try { if (markerTab && markerTab.id != null) await chrome.tabs.move(markerTab.id, { index: 0 }); } catch (_) { }
                    }
                } catch (_) { }
            }
        } else {
            // 非扩展环境：退回到新窗口
            window.open(url, '_blank');
        }
    } catch (error) {
        console.error('[特定窗口] 打开失败:', error);
    }
}

// ===== 分栏作用域化：在特定（按栏目区分）标签组中打开 =====
async function openInScopedTabGroup(url, opts = {}) {
    const { context = null, forceNew = false } = opts || {};
    if (!url) return;
    if (typeof chrome === 'undefined' || !chrome.tabs) {
        window.open(url, '_blank');
        return;
    }
    const scope = getScopeFromContext(context || {});
    try {
        // 尝试复用当前作用域的组
        if (!forceNew) {
            const entry = scopedCurrentGroups[scope.key];
            if (entry && Number.isInteger(entry.groupId)) {
                try {
                    if (chrome.tabGroups && chrome.tabGroups.get) await chrome.tabGroups.get(entry.groupId);
                    if (entry.windowId && chrome.windows && chrome.windows.get) await chrome.windows.get(entry.windowId, { populate: false });
                    const tab = await chrome.tabs.create({ url, active: false, windowId: entry.windowId || undefined });
                    await chrome.tabs.group({ groupId: entry.groupId, tabIds: tab.id });
                    return;
                } catch (_) {
                    // 失效：清除指针，落到新建逻辑
                    try {
                        delete scopedCurrentGroups[scope.key];
                        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                            await chrome.storage.local.set({ bookmarkScopedCurrentGroups: scopedCurrentGroups });
                        } else {
                            localStorage.setItem('bookmarkScopedCurrentGroups', JSON.stringify(scopedCurrentGroups));
                        }
                    } catch (_) { }
                }
            }
        }

        // 新建：分配本作用域下一可用编号
        const nextNumber = await allocateNextScopedNumber(scope.key);
        const tab = await chrome.tabs.create({ url, active: false });
        const groupId = await chrome.tabs.group({ tabIds: tab.id });
        const windowId = tab.windowId || null;
        const title = (scope.key === 'permanent')
            ? `A-Z ${nextNumber}`
            : `${scope.prefix || ''}${nextNumber}`;
        if (chrome.tabGroups && chrome.tabGroups.update) {
            try { await chrome.tabGroups.update(groupId, { title, color: 'blue' }); } catch (_) { }
        }
        await setScopedCurrentGroup(scope.key, groupId, windowId);
        await registerScopedGroup(scope.key, groupId, windowId, nextNumber);
    } catch (error) {
        console.warn('[分栏特定标签组] 打开失败:', error);
        try { window.open(url, '_blank'); } catch (_) { }
    }
}

// ===== 分栏作用域化：在特定（按栏目区分）窗口中打开 =====
async function openInScopedWindow(url, opts = {}) {
    const { context = null, forceNew = false } = opts || {};
    if (!url) return;
    try {
        const scope = getScopeFromContext(context || {});
        if (!forceNew) {
            const winId = scopedWindows[scope.key];
            if (Number.isInteger(winId)) {
                try {
                    const win = await chrome.windows.get(winId, { populate: false });
                    if (win && win.id) {
                        await chrome.tabs.create({ windowId: win.id, url });
                        return;
                    }
                } catch (_) {
                    try {
                        delete scopedWindows[scope.key];
                        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                            await chrome.storage.local.set({ bookmarkScopedWindows: scopedWindows });
                        } else {
                            localStorage.setItem('bookmarkScopedWindows', JSON.stringify(scopedWindows));
                        }
                    } catch (_) { }
                }
            }
        }
        const created = await chrome.windows.create({ url });
        if (created && created.id) {
            await setScopedWindow(scope.key, created.id);
            // 为不同作用域添加可见标记页：
            // permanent -> 标题 "A-Z <n>"；temporary(alpha) -> 标题 "<alpha><n>"
            const markerTitleNumber = await allocateNextScopedWindowNumber(scope.key);
            await registerScopedWindow(scope.key, created.id, markerTitleNumber);
            try {
                const titleStr = (scope.key === 'permanent')
                    ? `A-Z ${markerTitleNumber}`
                    : `${(scope.prefix || '')}${markerTitleNumber}`;
                const lt = (scope.key === 'permanent') ? 'permanent' : 'temporary';
                const sid = (lt === 'temporary' && context && context.sectionId) ? context.sectionId : '';
                const nid = (lt === 'permanent' && context && context.nodeId) ? context.nodeId : '';
                const p = new URLSearchParams();
                p.set('t', titleStr);
                if (lt) p.set('lt', lt);
                if (sid) p.set('sid', sid);
                if (nid) p.set('nid', nid);
                const markerUrl = (chrome && chrome.runtime && chrome.runtime.getURL)
                    ? chrome.runtime.getURL(`history_html/window_marker.html?${p.toString()}`)
                    : null;
                if (markerUrl && chrome && chrome.tabs && chrome.tabs.create) {
                    const markerTab = await chrome.tabs.create({ windowId: created.id, url: markerUrl, pinned: false, active: false });
                    try { if (markerTab && markerTab.id != null) await chrome.tabs.move(markerTab.id, { index: 0 }); } catch (_) { }
                }
            } catch (_) { }
        }
    } catch (error) {
        console.error('[分栏特定窗口] 打开失败:', error);
        try { window.open(url, '_blank'); } catch (_) { }
    }
}

async function ensureSameWindowSpecificGroupWindow(context) {
    if (sameWindowSpecificGroupWindowId && chrome && chrome.windows && chrome.windows.get) {
        try {
            const existing = await chrome.windows.get(sameWindowSpecificGroupWindowId, { populate: false });
            if (existing && existing.id) {
                return existing.id;
            }
        } catch (_) {
            await resetSameWindowSpecificGroupState();
        }
    }
    return await createSameWindowSpecificGroupWindow(context);
}

async function createSameWindowSpecificGroupWindow(context) {
    if (typeof chrome === 'undefined' || !chrome.windows) {
        throw new Error('chrome.windows unavailable');
    }
    const nextNumber = await allocateNextWindowNumber();
    let markerUrl = null;
    try {
        const params = new URLSearchParams();
        params.set('t', String(nextNumber));
        const treeType = context && context.treeType === 'temporary' ? 'temporary' : 'permanent';
        if (treeType) params.set('lt', treeType);
        if (context && context.sectionId) params.set('sid', context.sectionId);
        if (context && context.nodeId) params.set('nid', context.nodeId);
        if (chrome.runtime && chrome.runtime.getURL) {
            markerUrl = chrome.runtime.getURL(`history_html/window_marker.html?${params.toString()}`);
        }
    } catch (_) { }
    const createArgs = markerUrl ? { url: markerUrl } : {};
    const created = await chrome.windows.create(createArgs);
    if (!created || created.id == null) {
        throw new Error('failed to create combined window');
    }
    await registerPluginWindow(created.id, nextNumber);
    await setSameWindowSpecificGroupWindowId(created.id);
    return created.id;
}

async function openInSameWindowSpecificGroup(url, opts = {}) {
    const { context = null, forceNewWindow = false, forceNewGroup = false, isHyperlink = false } = opts || {};
    if (!url) return;
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.windows) {
        window.open(url, '_blank');
        return;
    }
    try {
        if (forceNewWindow) {
            await resetSameWindowSpecificGroupState();
        }

        // 如果是超链接，使用特殊的作用域键
        const scope = isHyperlink
            ? { key: '_hyperlink_swsg', prefix: '' }
            : getScopeFromContext(context || {});

        const windowId = await ensureSameWindowSpecificGroupWindow(context);
        if (forceNewGroup) {
            await clearSameWindowSpecificGroupScope(scope.key);
        }

        let reuseGroupId = null;
        if (!forceNewGroup) {
            const entry = getSameWindowSpecificGroupEntry(scope.key);
            if (entry && Number.isInteger(entry.groupId) && entry.windowId === windowId) {
                try {
                    if (chrome.tabGroups && chrome.tabGroups.get) {
                        await chrome.tabGroups.get(entry.groupId);
                    }
                    reuseGroupId = entry.groupId;
                } catch (_) {
                    await clearSameWindowSpecificGroupScope(scope.key);
                    reuseGroupId = null;
                }
            }
        }

        const tab = await chrome.tabs.create({ url, active: true, windowId });
        if (!tab || tab.id == null) {
            throw new Error('无法创建标签页');
        }

        // 激活窗口，确保显示最新打开的书签页面（而不是书签画布标识页）
        try {
            await chrome.windows.update(windowId, { focused: true });
        } catch (_) { }

        if (reuseGroupId) {
            await chrome.tabs.group({ groupId: reuseGroupId, tabIds: tab.id });
            return;
        }

        // 创建标签组
        const groupId = await chrome.tabs.group({ tabIds: tab.id, createProperties: { windowId } });

        // 如果是超链接，使用特殊的标题
        let title;
        let groupNumber = null;

        if (isHyperlink) {
            const lang = currentLang || 'zh_CN';
            title = lang === 'zh_CN' ? '超链接' : 'Hyperlink';
        } else {
            groupNumber = await allocateNextScopedNumber(scope.key);
            title = scope.key === 'permanent'
                ? `A-Z ${groupNumber}`
                : `${scope.prefix || ''}${groupNumber}`;
            await registerScopedGroup(scope.key, groupId, windowId, groupNumber);
        }

        if (chrome.tabGroups && chrome.tabGroups.update) {
            try {
                await chrome.tabGroups.update(groupId, {
                    title,
                    color: isHyperlink ? 'cyan' : 'blue'
                });
            } catch (_) { }
        }

        await setSameWindowSpecificGroupScope(scope.key, groupId, windowId, groupNumber);
    } catch (error) {
        console.error('[同窗特定标签组] 打开失败:', error);
        try { window.open(url, '_blank'); } catch (_) { }
    }
}

// 暴露新函数给全局（供临时栏目的左键处理调用）
try {
    window.openInScopedTabGroup = openInScopedTabGroup;
    window.openInScopedWindow = openInScopedWindow;
    window.openInSameWindowSpecificGroup = openInSameWindowSpecificGroup;
} catch (_) { }

// 打开文件夹中所有书签
async function openAllBookmarks(folderId, newWindow = false, incognito = false) {
    if (!chrome || !chrome.bookmarks) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    // 获取文件夹中的所有书签（递归）
    async function getAllUrls(folderId) {
        const urls = [];
        const children = await chrome.bookmarks.getChildren(folderId);

        for (const child of children) {
            if (child.url) {
                urls.push(child.url);
            } else if (child.children) {
                // 递归获取子文件夹中的书签
                const subUrls = await getAllUrls(child.id);
                urls.push(...subUrls);
            }
        }

        return urls;
    }

    const urls = await getAllUrls(folderId);

    if (urls.length === 0) {
        const lang = currentLang || 'zh_CN';
        alert(lang === 'zh_CN' ? '文件夹中没有书签' : 'No bookmarks in folder');
        return;
    }

    // 确认是否打开大量书签
    if (urls.length > 10) {
        const lang = currentLang || 'zh_CN';
        const message = lang === 'zh_CN'
            ? `确定要打开 ${urls.length} 个书签吗？`
            : `Open ${urls.length} bookmarks?`;
        if (!confirm(message)) return;
    }

    if (newWindow) {
        // 在新窗口中打开
        if (chrome.windows) {
            try {
                await chrome.windows.create({ url: urls, incognito: incognito });
            } catch (error) {
                if (incognito && error.message && error.message.includes('Incognito mode is disabled')) {
                    const lang = currentLang || 'zh_CN';
                    const message = lang === 'zh_CN'
                        ? '无痕模式已被禁用。将在普通窗口中打开。\n\n若要使用无痕模式，请在扩展管理页面启用"在无痕模式下启用"。'
                        : 'Incognito mode is disabled. Opening in normal window.\n\nTo use incognito mode, enable "Allow in Incognito" in extension settings.';
                    alert(message);
                    // 降级为普通新窗口
                    await chrome.windows.create({ url: urls, incognito: false });
                } else {
                    console.error('[打开全部] 新窗口失败:', error);
                    urls.forEach(url => window.open(url, '_blank'));
                }
            }
        }
    } else {
        // 在新标签页中打开
        if (chrome.tabs) {
            for (const url of urls) {
                chrome.tabs.create({ url: url, active: false });
            }
        }
    }
}

// 编辑书签 - 使用自定义模态框
async function editBookmark(nodeId, currentTitle, currentUrl, isFolder) {
    const lang = currentLang || 'zh_CN';

    // 获取模态框元素
    const modal = document.getElementById('editBookmarkModal');
    const titleInput = document.getElementById('editBookmarkTitle');
    const urlInput = document.getElementById('editBookmarkUrl');
    const urlField = document.getElementById('editBookmarkUrlField');
    const modalTitle = document.getElementById('editBookmarkModalTitle');
    const titleLabel = document.getElementById('editBookmarkTitleLabel');
    const urlLabel = document.getElementById('editBookmarkUrlLabel');
    const saveBtn = document.getElementById('editBookmarkSaveBtn');
    const cancelBtn = document.getElementById('editBookmarkCancelBtn');
    const closeBtn = document.getElementById('editBookmarkModalClose');

    if (!modal) {
        console.error('[编辑] 未找到编辑模态框');
        return;
    }

    // 设置标题和标签文本
    if (isFolder) {
        modalTitle.textContent = lang === 'zh_CN' ? '编辑文件夹' : 'Edit Folder';
        titleLabel.textContent = lang === 'zh_CN' ? '文件夹名称' : 'Folder Name';
        urlField.style.display = 'none';
    } else {
        modalTitle.textContent = lang === 'zh_CN' ? '编辑书签' : 'Edit Bookmark';
        titleLabel.textContent = lang === 'zh_CN' ? '书签名称' : 'Bookmark Name';
        urlLabel.textContent = lang === 'zh_CN' ? '书签地址' : 'Bookmark URL';
        urlField.style.display = 'flex';
    }

    // 设置按钮文本
    saveBtn.textContent = lang === 'zh_CN' ? '保存' : 'Save';
    cancelBtn.textContent = lang === 'zh_CN' ? '取消' : 'Cancel';

    // 设置输入框占位符
    titleInput.placeholder = lang === 'zh_CN' ? '输入名称...' : 'Enter name...';
    urlInput.placeholder = 'https://...';

    // 填入当前值
    titleInput.value = currentTitle || '';
    urlInput.value = currentUrl || '';

    // 显示模态框
    modal.classList.add('show');

    // 聚焦到标题输入框
    setTimeout(() => titleInput.focus(), 100);

    // 创建 Promise 来等待用户操作
    return new Promise((resolve) => {
        // 清理之前的事件监听器
        const newSaveBtn = saveBtn.cloneNode(true);
        const newCancelBtn = cancelBtn.cloneNode(true);
        const newCloseBtn = closeBtn.cloneNode(true);
        saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
        cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
        closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);

        const closeModal = () => {
            modal.classList.remove('show');
            resolve();
        };

        const handleSave = async () => {
            const newTitle = titleInput.value.trim();
            const newUrl = urlInput.value.trim();

            if (!newTitle) {
                titleInput.focus();
                return;
            }

            if (!isFolder && !newUrl) {
                urlInput.focus();
                return;
            }

            try {
                if (chrome && chrome.bookmarks) {
                    if (isFolder) {
                        if (newTitle !== currentTitle) {
                            await chrome.bookmarks.update(nodeId, { title: newTitle });
                        }
                    } else {
                        const updates = {};
                        if (newTitle !== currentTitle) updates.title = newTitle;
                        if (newUrl !== currentUrl) updates.url = newUrl;

                        if (Object.keys(updates).length > 0) {
                            await chrome.bookmarks.update(nodeId, updates);
                        }
                    }
                }
            } catch (error) {
                console.error('[编辑] 保存失败:', error);
                alert(lang === 'zh_CN' ? `保存失败: ${error.message}` : `Save failed: ${error.message}`);
            }

            closeModal();
        };

        // 绑定事件
        newSaveBtn.addEventListener('click', handleSave);
        newCancelBtn.addEventListener('click', closeModal);
        newCloseBtn.addEventListener('click', closeModal);

        // Enter 键保存
        const handleKeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleSave();
            } else if (e.key === 'Escape') {
                closeModal();
            }
        };

        titleInput.addEventListener('keydown', handleKeydown);
        urlInput.addEventListener('keydown', handleKeydown);

        // 点击背景关闭
        const handleBackgroundClick = (e) => {
            if (e.target === modal) {
                closeModal();
            }
        };
        modal.addEventListener('click', handleBackgroundClick);
    });
}

// 添加书签 - 使用自定义模态框
async function addBookmark(parentId) {
    const lang = currentLang || 'zh_CN';

    // 获取模态框元素
    const modal = document.getElementById('editBookmarkModal');
    const titleInput = document.getElementById('editBookmarkTitle');
    const urlInput = document.getElementById('editBookmarkUrl');
    const urlField = document.getElementById('editBookmarkUrlField');
    const modalTitle = document.getElementById('editBookmarkModalTitle');
    const titleLabel = document.getElementById('editBookmarkTitleLabel');
    const urlLabel = document.getElementById('editBookmarkUrlLabel');
    const saveBtn = document.getElementById('editBookmarkSaveBtn');
    const cancelBtn = document.getElementById('editBookmarkCancelBtn');
    const closeBtn = document.getElementById('editBookmarkModalClose');

    if (!modal) {
        console.error('[添加书签] 未找到模态框');
        return;
    }

    // 设置标题和标签文本
    modalTitle.textContent = lang === 'zh_CN' ? '添加书签' : 'Add Bookmark';
    titleLabel.textContent = lang === 'zh_CN' ? '书签名称' : 'Bookmark Name';
    urlLabel.textContent = lang === 'zh_CN' ? '书签地址' : 'Bookmark URL';
    urlField.style.display = 'flex';

    // 设置按钮文本
    saveBtn.textContent = lang === 'zh_CN' ? '添加' : 'Add';
    cancelBtn.textContent = lang === 'zh_CN' ? '取消' : 'Cancel';

    // 设置输入框占位符并清空
    titleInput.placeholder = lang === 'zh_CN' ? '输入书签名称...' : 'Enter bookmark name...';
    urlInput.placeholder = 'https://...';
    titleInput.value = '';
    urlInput.value = 'https://';

    // 显示模态框
    modal.classList.add('show');

    // 聚焦到标题输入框
    setTimeout(() => titleInput.focus(), 100);

    // 创建 Promise 来等待用户操作
    return new Promise((resolve) => {
        // 清理之前的事件监听器
        const newSaveBtn = saveBtn.cloneNode(true);
        const newCancelBtn = cancelBtn.cloneNode(true);
        const newCloseBtn = closeBtn.cloneNode(true);
        saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
        cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
        closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);

        const closeModal = () => {
            modal.classList.remove('show');
            resolve();
        };

        const handleSave = async () => {
            const newTitle = titleInput.value.trim();
            const newUrl = urlInput.value.trim();

            if (!newTitle) {
                titleInput.focus();
                return;
            }

            if (!newUrl) {
                urlInput.focus();
                return;
            }

            try {
                if (chrome && chrome.bookmarks) {
                    await chrome.bookmarks.create({
                        parentId: parentId,
                        title: newTitle,
                        url: newUrl
                    });
                }
            } catch (error) {
                console.error('[添加书签] 失败:', error);
                alert(lang === 'zh_CN' ? `添加失败: ${error.message}` : `Add failed: ${error.message}`);
            }

            closeModal();
        };

        // 绑定事件
        newSaveBtn.addEventListener('click', handleSave);
        newCancelBtn.addEventListener('click', closeModal);
        newCloseBtn.addEventListener('click', closeModal);

        // Enter 键保存
        const handleKeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleSave();
            } else if (e.key === 'Escape') {
                closeModal();
            }
        };

        titleInput.addEventListener('keydown', handleKeydown);
        urlInput.addEventListener('keydown', handleKeydown);

        // 点击背景关闭
        const handleBackgroundClick = (e) => {
            if (e.target === modal) {
                closeModal();
            }
        };
        modal.addEventListener('click', handleBackgroundClick);
    });
}

// 添加文件夹 - 使用自定义模态框
async function addFolder(parentId) {
    const lang = currentLang || 'zh_CN';

    // 获取模态框元素
    const modal = document.getElementById('editBookmarkModal');
    const titleInput = document.getElementById('editBookmarkTitle');
    const urlField = document.getElementById('editBookmarkUrlField');
    const modalTitle = document.getElementById('editBookmarkModalTitle');
    const titleLabel = document.getElementById('editBookmarkTitleLabel');
    const saveBtn = document.getElementById('editBookmarkSaveBtn');
    const cancelBtn = document.getElementById('editBookmarkCancelBtn');
    const closeBtn = document.getElementById('editBookmarkModalClose');

    if (!modal) {
        console.error('[添加文件夹] 未找到模态框');
        return;
    }

    // 设置标题和标签文本
    modalTitle.textContent = lang === 'zh_CN' ? '添加文件夹' : 'Add Folder';
    titleLabel.textContent = lang === 'zh_CN' ? '文件夹名称' : 'Folder Name';
    urlField.style.display = 'none';

    // 设置按钮文本
    saveBtn.textContent = lang === 'zh_CN' ? '添加' : 'Add';
    cancelBtn.textContent = lang === 'zh_CN' ? '取消' : 'Cancel';

    // 设置输入框占位符并清空
    titleInput.placeholder = lang === 'zh_CN' ? '输入文件夹名称...' : 'Enter folder name...';
    titleInput.value = '';

    // 显示模态框
    modal.classList.add('show');

    // 聚焦到标题输入框
    setTimeout(() => titleInput.focus(), 100);

    // 创建 Promise 来等待用户操作
    return new Promise((resolve) => {
        // 清理之前的事件监听器
        const newSaveBtn = saveBtn.cloneNode(true);
        const newCancelBtn = cancelBtn.cloneNode(true);
        const newCloseBtn = closeBtn.cloneNode(true);
        saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
        cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
        closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);

        const closeModal = () => {
            modal.classList.remove('show');
            resolve();
        };

        const handleSave = async () => {
            const newTitle = titleInput.value.trim();

            if (!newTitle) {
                titleInput.focus();
                return;
            }

            try {
                if (chrome && chrome.bookmarks) {
                    await chrome.bookmarks.create({
                        parentId: parentId,
                        title: newTitle
                    });
                }
            } catch (error) {
                console.error('[添加文件夹] 失败:', error);
                alert(lang === 'zh_CN' ? `添加失败: ${error.message}` : `Add failed: ${error.message}`);
            }

            closeModal();
        };

        // 绑定事件
        newSaveBtn.addEventListener('click', handleSave);
        newCancelBtn.addEventListener('click', closeModal);
        newCloseBtn.addEventListener('click', closeModal);

        // Enter 键保存
        const handleKeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleSave();
            } else if (e.key === 'Escape') {
                closeModal();
            }
        };

        titleInput.addEventListener('keydown', handleKeydown);

        // 点击背景关闭
        const handleBackgroundClick = (e) => {
            if (e.target === modal) {
                closeModal();
            }
        };
        modal.addEventListener('click', handleBackgroundClick);
    });
}

// 复制URL
async function copyUrl(url) {
    if (!url) return;

    try {
        await navigator.clipboard.writeText(url);
        const lang = currentLang || 'zh_CN';
        console.log(lang === 'zh_CN' ? 'URL已复制' : 'URL copied');
        // 可以显示一个toast提示
    } catch (err) {
        console.error('复制失败:', err);
    }
}

// 删除书签/文件夹（普通删除不需要二次确认）
// 不调用refreshBookmarkTree，让onRemoved事件的增量更新处理红色标识
async function deleteBookmark(nodeId, nodeTitle, isFolder) {
    if (chrome && chrome.bookmarks) {
        if (isFolder) {
            await chrome.bookmarks.removeTree(nodeId);
        } else {
            await chrome.bookmarks.remove(nodeId);
        }
    }
}

// 剪切书签
async function cutBookmark(nodeId, nodeTitle, isFolder) {
    if (!chrome || !chrome.bookmarks) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    try {
        const nodes = await chrome.bookmarks.getSubTree(nodeId);
        const node = nodes && nodes[0];

        bookmarkClipboard = {
            action: 'cut',
            source: 'permanent',
            nodeIds: [nodeId],
            nodeData: node,
            payload: node ? [serializeBookmarkNode(node)] : [],
            timestamp: Date.now()
        };
        clipboardOperation = 'cut';

        console.log('[剪切] 已剪切:', nodeTitle);

        markCutNode(nodeId);

    } catch (error) {
        console.error('[剪切] 失败:', error);
    }
}

// 复制书签
async function copyBookmark(nodeId, nodeTitle, isFolder) {
    if (!chrome || !chrome.bookmarks) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    try {
        const [node] = await chrome.bookmarks.getSubTree(nodeId);

        bookmarkClipboard = {
            action: 'copy',
            source: 'permanent',
            nodeIds: [nodeId],
            nodeData: node,
            payload: node ? [serializeBookmarkNode(node)] : [],
            timestamp: Date.now()
        };
        clipboardOperation = 'copy';
        showPasteButton();

        console.log('[复制] 已复制:', nodeTitle);

    } catch (error) {
        console.error('[复制] 失败:', error);
    }
}

// 粘贴书签
async function pasteBookmark(targetNodeId, isFolder) {
    if (!chrome || !chrome.bookmarks) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    if (!bookmarkClipboard) {
        return;
    }

    try {
        // 确定目标文件夹ID
        let targetFolderId;

        if (isFolder) {
            // 如果目标是文件夹，粘贴到文件夹内
            targetFolderId = targetNodeId;
        } else {
            // 如果目标是书签，获取其父文件夹ID，粘贴到书签下方
            const nodes = await chrome.bookmarks.get(targetNodeId);
            if (nodes && nodes[0] && nodes[0].parentId) {
                targetFolderId = nodes[0].parentId;
            } else {
                throw new Error('无法找到父文件夹');
            }
        }

        if (bookmarkClipboard.source === 'temporary') {
            const payload = bookmarkClipboard.payload || [];
            if (payload.length) {
                for (const item of payload) {
                    await duplicateNode(item, targetFolderId);
                }
            }
            if (bookmarkClipboard.action === 'cut' && bookmarkClipboard.sectionId && bookmarkClipboard.nodeIds) {
                const manager = getTempManager();
                if (manager) {
                    manager.removeItems(bookmarkClipboard.sectionId, bookmarkClipboard.nodeIds);
                }
                bookmarkClipboard = null;
                clipboardOperation = null;
                unmarkCutNode();
            }
        } else if (bookmarkClipboard.source === 'permanent') {
            if (bookmarkClipboard.action === 'cut' && bookmarkClipboard.nodeIds) {
                for (const id of bookmarkClipboard.nodeIds) {
                    await chrome.bookmarks.move(id, {
                        parentId: targetFolderId
                    });
                }
                bookmarkClipboard = null;
                clipboardOperation = null;
                unmarkCutNode();
            } else if (bookmarkClipboard.action === 'copy') {
                const payload = bookmarkClipboard.payload || (bookmarkClipboard.nodeData ? [bookmarkClipboard.nodeData] : []);
                for (const node of payload) {
                    await duplicateNode(node, targetFolderId);
                }
            }
        }

        // 不调用 refreshBookmarkTree()，让 onMoved/onCreated 事件触发增量更新

    } catch (error) {
        console.error('[粘贴] 失败:', error);
        const lang = currentLang || 'zh_CN';
        alert(lang === 'zh_CN' ? `粘贴失败: ${error.message}` : `Paste failed: ${error.message}`);
    }
}

// 递归复制节点
async function duplicateNode(node, parentId) {
    const newNode = {
        parentId: parentId,
        title: node.title
    };

    if (node.url) {
        newNode.url = node.url;
    }

    // 创建节点
    const created = await chrome.bookmarks.create(newNode);

    // 如果有子节点，递归复制
    if (node.children) {
        for (const child of node.children) {
            await duplicateNode(child, created.id);
        }
    }

    return created;
}

// 标记被剪切的节点
function markCutNode(nodeId) {
    const node = document.querySelector(`.tree-item[data-node-id="${nodeId}"]`);
    if (node) {
        node.classList.add('cut-marked');
    }
}

// 取消标记
function unmarkCutNode() {
    document.querySelectorAll('.cut-marked').forEach(node => {
        node.classList.remove('cut-marked');
    });
}

// ==================== 标签页组功能 ====================

// 在新标签页组中打开所有书签
async function openAllInTabGroup(folderId) {
    if (!chrome || !chrome.bookmarks || !chrome.tabs) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    try {
        // 获取所有URL
        const urls = await getAllUrlsFromFolder(folderId);

        if (urls.length === 0) {
            const lang = currentLang || 'zh_CN';
            alert(lang === 'zh_CN' ? '文件夹中没有书签' : 'No bookmarks in folder');
            return;
        }

        // 确认是否打开大量书签
        if (urls.length > 10) {
            const lang = currentLang || 'zh_CN';
            const message = lang === 'zh_CN'
                ? `确定要打开 ${urls.length} 个书签吗？`
                : `Open ${urls.length} bookmarks?`;
            if (!confirm(message)) return;
        }

        // 获取文件夹信息作为组名
        const [folder] = await chrome.bookmarks.get(folderId);
        const groupTitle = folder.title;

        // 创建标签页
        const tabIds = [];
        for (const url of urls) {
            const tab = await chrome.tabs.create({ url: url, active: false });
            tabIds.push(tab.id);
        }

        // 创建标签页组
        if (chrome.tabs.group) {
            const groupId = await chrome.tabs.group({ tabIds: tabIds });

            // 设置组标题和颜色
            if (chrome.tabGroups) {
                await chrome.tabGroups.update(groupId, {
                    title: groupTitle,
                    collapsed: false
                });
            }
        }

        console.log('[标签页组] 已创建:', groupTitle, tabIds.length, '个标签页');

    } catch (error) {
        console.error('[标签页组] 打开失败:', error);
        const lang = currentLang || 'zh_CN';
        alert(lang === 'zh_CN' ? `打开失败: ${error.message}` : `Failed to open: ${error.message}`);
    }
}

// 辅助函数：递归获取文件夹中的所有URL
async function getAllUrlsFromFolder(folderId) {
    const urls = [];
    const children = await chrome.bookmarks.getChildren(folderId);

    for (const child of children) {
        if (child.url) {
            urls.push(child.url);
        } else if (child.children) {
            const subUrls = await getAllUrlsFromFolder(child.id);
            urls.push(...subUrls);
        }
    }

    return urls;
}

// ==================== 多选功能 ====================

// 切换节点选中状态
function toggleNodeSelection(nodeId, nodeElement) {
    if (!nodeElement) {
        nodeElement = document.querySelector(`.tree-item[data-node-id="${nodeId}"]`);
    }

    if (selectedNodes.has(nodeId)) {
        selectedNodes.delete(nodeId);
        selectedNodeMeta.delete(nodeId);
        if (nodeElement) nodeElement.classList.remove('selected');
        if (selectedNodes.size === 0) {
            lastBatchSelectionInfo = null;
        }
    } else {
        selectedNodes.add(nodeId);
        if (nodeElement) {
            nodeElement.classList.add('selected');
            selectedNodeMeta.set(nodeId, {
                treeType: nodeElement.dataset.treeType || 'permanent',
                sectionId: nodeElement.dataset.sectionId || null
            });
            rememberBatchSelection(nodeElement);
        } else {
            selectedNodeMeta.delete(nodeId);
        }
    }

    console.log('[多选] 当前选中:', selectedNodes.size, '个');
}

// 范围选择（Shift+Click）
function selectRange(startNodeId, endNodeId) {
    const allNodes = Array.from(document.querySelectorAll('.tree-item[data-node-id]'));
    const startIndex = allNodes.findIndex(n => n.dataset.nodeId === startNodeId);
    const endIndex = allNodes.findIndex(n => n.dataset.nodeId === endNodeId);

    if (startIndex === -1 || endIndex === -1) return;

    const start = Math.min(startIndex, endIndex);
    const end = Math.max(startIndex, endIndex);

    // 选中范围内的所有节点
    for (let i = start; i <= end; i++) {
        const node = allNodes[i];
        const nodeId = node.dataset.nodeId;
        selectedNodes.add(nodeId);
        selectedNodeMeta.set(nodeId, {
            treeType: node.dataset.treeType || 'permanent',
            sectionId: node.dataset.sectionId || null
        });
        node.classList.add('selected');
    }

    rememberBatchSelection(allNodes[end]);

    console.log('[多选] 范围选择:', selectedNodes.size, '个');
}

// 全选
function selectAll() {
    document.querySelectorAll('.tree-item[data-node-id]').forEach(node => {
        selectedNodes.add(node.dataset.nodeId);
        selectedNodeMeta.set(node.dataset.nodeId, {
            treeType: node.dataset.treeType || 'permanent',
            sectionId: node.dataset.sectionId || null
        });
        node.classList.add('selected');
    });

    const firstNode = document.querySelector('.tree-item[data-node-id]');
    rememberBatchSelection(firstNode);

    console.log('[多选] 全选:', selectedNodes.size, '个');
}

// 取消全选
function deselectAll() {
    document.querySelectorAll('.tree-item[data-node-id]').forEach(node => {
        node.classList.remove('selected');
    });
    selectedNodes.clear();
    selectedNodeMeta.clear();
    lastBatchSelectionInfo = null;

    console.log('[多选] 已取消全选');
}

// 打开选中的书签
async function openSelectedBookmarks() {
    if (!chrome || !chrome.tabs) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    try {
        const permanentIds = getSelectedPermanentNodeIds();
        const tempNodes = getSelectedTempNodes();
        const urlSet = new Set();
        if (permanentIds.length) {
            const permanentUrls = await getSelectedUrls(permanentIds);
            permanentUrls.forEach(url => urlSet.add(url));
        }
        tempNodes.forEach(node => {
            if (node.isFolder) {
                collectTempUrls(node.sectionId, node.id).forEach(url => urlSet.add(url));
            } else if (node.url) {
                urlSet.add(node.url);
            }
        });
        const urls = Array.from(urlSet);

        if (urls.length === 0) {
            const lang = currentLang || 'zh_CN';
            alert(lang === 'zh_CN' ? '没有选中书签' : 'No bookmarks selected');
            return;
        }

        // 打开所有URL
        await openUrlList(urls, {});

        console.log('[多选] 已打开:', urls.length, '个书签');

    } catch (error) {
        console.error('[多选] 打开失败:', error);
    }
}

// 在新标签页组中打开选中的书签
async function openSelectedInTabGroup() {
    if (!chrome || !chrome.tabs) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    try {
        const permanentIds = getSelectedPermanentNodeIds();
        const tempNodes = getSelectedTempNodes();
        const urlSet = new Set();
        if (permanentIds.length) {
            const permanentUrls = await getSelectedUrls(permanentIds);
            permanentUrls.forEach(url => urlSet.add(url));
        }
        tempNodes.forEach(node => {
            if (node.isFolder) {
                collectTempUrls(node.sectionId, node.id).forEach(url => urlSet.add(url));
            } else if (node.url) {
                urlSet.add(node.url);
            }
        });
        const urls = Array.from(urlSet);

        if (urls.length === 0) {
            const lang = currentLang || 'zh_CN';
            alert(lang === 'zh_CN' ? '没有选中书签' : 'No bookmarks selected');
            return;
        }

        await openUrlList(urls, { tabGroup: true });
        console.log('[多选] 已在标签页组中打开:', urls.length, '个书签');

    } catch (error) {
        console.error('[多选] 打开失败:', error);
        const lang = currentLang || 'zh_CN';
        alert(lang === 'zh_CN' ? `打开失败: ${error.message}` : `Failed to open: ${error.message}`);
    }
}

// 剪切选中的项
async function cutSelected() {
    await batchCut();
}

// 复制选中的项
async function copySelected() {
    const tempNodes = getSelectedTempNodes();
    const permanentIds = getSelectedPermanentNodeIds();
    if (!tempNodes.length && !permanentIds.length) {
        const lang = currentLang || 'zh_CN';
        alert(lang === 'zh_CN' ? '没有选中的项目' : 'No items selected');
        return;
    }
    if (tempNodes.length && permanentIds.length) {
        const lang = currentLang || 'zh_CN';
        alert(lang === 'zh_CN' ? '暂不支持同时复制永久与临时栏目' : 'Copying mixed permanent and temporary items is not supported');
        return;
    }
    if (tempNodes.length) {
        const sectionId = tempNodes[0].sectionId;
        const sameSection = tempNodes.every(node => node.sectionId === sectionId);
        if (!sameSection) {
            const lang = currentLang || 'zh_CN';
            alert(lang === 'zh_CN' ? '复制操作仅支持同一临时栏目内的节点' : 'Copy only supports nodes within the same temporary section');
            return;
        }
        copyTempNodes(sectionId, tempNodes.map(node => node.id));
        return;
    }
    try {
        const payload = [];
        for (const nodeId of permanentIds) {
            const nodes = await chrome.bookmarks.getSubTree(nodeId);
            if (nodes && nodes[0]) {
                payload.push(serializeBookmarkNode(nodes[0]));
            }
        }
        bookmarkClipboard = {
            action: 'copy',
            source: 'permanent',
            nodeIds: permanentIds,
            payload,
            timestamp: Date.now()
        };
        clipboardOperation = 'copy';
        unmarkCutNode();
        showPasteButton();
        console.log('[多选] 已复制:', permanentIds.length, '个');
    } catch (error) {
        console.error('[多选] 复制失败:', error);
    }
}

// 删除选中的项
async function deleteSelected() {
    await batchDelete();
}

// 获取选中节点的所有URL
async function getSelectedUrls(nodeIdList) {
    const urls = [];
    const ids = nodeIdList || Array.from(selectedNodes);

    for (const nodeId of ids) {
        try {
            const [node] = await chrome.bookmarks.get(nodeId);
            if (node.url) {
                urls.push(node.url);
            } else {
                // 如果是文件夹，递归获取
                const folderUrls = await getAllUrlsFromFolder(nodeId);
                urls.push(...folderUrls);
            }
        } catch (error) {
            console.error('[多选] 获取URL失败:', nodeId, error);
        }
    }

    return urls;
}

// 刷新书签树（批量操作后专用，不显示变更标记）
async function refreshBookmarkTree() {
    console.log('[批量操作] 开始刷新书签树（无diff模式）');

    if (typeof renderTreeView === 'function') {
        // 临时清空旧数据，避免显示变更标记
        await chrome.storage.local.set({ lastBookmarkData: null });
        console.log('[批量操作] 已临时清除旧数据，避免diff');

        // 渲染当前书签树（不会检测变更）
        await renderTreeView(true);

        // 获取当前书签数据并更新为新的基准数据（重要：这样下次对比就基于删除后的状态）
        if (chrome && chrome.bookmarks) {
            const bookmarkTree = await chrome.bookmarks.getTree();
            await chrome.storage.local.set({ lastBookmarkData: bookmarkTree });
            console.log('[批量操作] 已将当前状态设为新的基准数据，避免后续误标记为moved');
        }
    } else {
        console.warn('[批量操作] renderTreeView 函数不存在');
    }
}

// ==================== Select模式 ====================

// 进入Select模式
function enterSelectMode() {
    selectMode = true;

    // 显示全局蓝框和提示
    showSelectModeOverlay();

    // 隐藏顶部工具栏
    const toolbar = document.getElementById('batch-toolbar');
    if (toolbar) {
        toolbar.style.display = 'none';
        console.log('[Select模式] 隐藏顶部工具栏');
    }

    // 更新批量工具栏（但不显示，因为我们要显示批量菜单）
    updateBatchToolbar();

    // 关闭右键菜单
    hideContextMenu();

    // 检查上次的显示状态，决定是显示批量菜单还是工具栏
    try {
        const savedState = localStorage.getItem('batchPanelState');
        if (savedState) {
            const state = JSON.parse(savedState);
            if (state.visible === false) {
                // 上次是隐藏状态，显示工具栏
                console.log('[Select模式] 恢复上次状态：显示工具栏');
                updateBatchToolbar();
                if (toolbar) {
                    toolbar.style.display = 'flex';
                }
                return;
            }
        }
    } catch (e) {
        console.error('[Select模式] 读取保存状态失败:', e);
    }

    // 默认或上次是显示状态，自动显示批量菜单
    setTimeout(() => {
        const fakeEvent = { preventDefault: () => { }, stopPropagation: () => { } };
        showBatchContextMenu(fakeEvent);
        console.log('[Select模式] 自动显示批量菜单');
    }, 100);

    console.log('[Select模式] 已进入');
}

// 退出Select模式
function exitSelectMode() {
    selectMode = false;

    // 隐藏蓝框
    hideSelectModeOverlay();

    // 隐藏批量操作面板
    hideBatchActionPanel();

    // 清空选中
    deselectAll();
    updateBatchToolbar();

    console.log('[Select模式] 已退出');
}

// 隐藏批量操作面板
function hideBatchActionPanel() {
    const batchPanel = document.getElementById('batch-action-panel');
    if (batchPanel) {
        batchPanel.style.display = 'none';
        console.log('[批量面板] 已隐藏');
    }
}

// 显示Select模式蓝框（不再显示顶部提示）
function showSelectModeOverlay() {
    // 检查是否已存在
    let overlay = document.getElementById('select-mode-overlay');
    if (overlay) {
        overlay.style.display = 'block';
        return;
    }

    // 创建蓝框（不包含顶部提示）
    overlay = document.createElement('div');
    overlay.id = 'select-mode-overlay';
    overlay.className = 'select-mode-overlay';

    // 找到树容器
    const treeContainer = document.getElementById('bookmarkTree') ||
        document.querySelector('.bookmark-tree') ||
        document.querySelector('.tree-view-container') ||
        document.body;
    treeContainer.style.position = 'relative';
    treeContainer.appendChild(overlay);

    console.log('[Select模式] 蓝框已添加到:', treeContainer.id || treeContainer.className);

    // 允许拖动穿透：按住左键准备拖动时，让事件传递给下方的书签项
    // 但单击已选中的书签应该取消选中，而不是穿透
    overlay.addEventListener('mousedown', (e) => {
        // 仅处理左键
        if (e.button !== 0) return;
        // 探测下方元素
        let elementBelow;
        try {
            overlay.style.pointerEvents = 'none';
            elementBelow = document.elementFromPoint(e.clientX, e.clientY);
        } finally {
            overlay.style.pointerEvents = 'auto';
        }
        const treeItem = elementBelow && elementBelow.closest ? elementBelow.closest('.tree-item[data-node-id]') : null;
        const isTreeItem = !!treeItem;
        const hasMultiSelection = (typeof selectedNodes !== 'undefined' && selectedNodes && selectedNodes.size > 1);
        const isSelectedItem = !!(treeItem && treeItem.classList && treeItem.classList.contains('selected'));

        // 如果没有多选，不进行拖拽穿透，让点击事件正常处理（可以取消选中）
        if (!isTreeItem || !hasMultiSelection) return;

        // 多选情况下，使用移动阈值来区分点击和拖拽
        const startX = e.clientX;
        const startY = e.clientY;
        let dragging = false;
        const DRAG_THRESHOLD = 4;
        const onMove = (ev) => {
            if (dragging) return;
            const dx = Math.abs(ev.clientX - startX);
            const dy = Math.abs(ev.clientY - startY);
            if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
                dragging = true;
                overlay.style.pointerEvents = 'none';
            }
        };
        const restore = () => {
            overlay.style.pointerEvents = 'auto';
            document.removeEventListener('mousemove', onMove, true);
            document.removeEventListener('mouseup', restore, true);
            document.removeEventListener('dragend', restore, true);
        };
        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('mouseup', restore, true);
        document.addEventListener('dragend', restore, true);
    }, true);

    // 绑定点击事件 - 点击overlay上的位置，找到下面的书签元素
    overlay.addEventListener('click', (e) => {
        console.log('[Select模式] overlay点击事件:', e.target);

        // 暂时隐藏overlay以获取下面的元素
        overlay.style.pointerEvents = 'none';
        const elementBelow = document.elementFromPoint(e.clientX, e.clientY);
        overlay.style.pointerEvents = 'auto';

        console.log('[Select模式] 下面的元素:', elementBelow);

        // 检查是否点击折叠按钮或其附近区域
        const toggleBtn = elementBelow?.closest('.tree-toggle');
        if (toggleBtn) {
            console.log('[Select模式] 点击折叠按钮，触发展开/收起');
            // 触发折叠按钮的点击
            toggleBtn.click();
            return;
        }

        // 检查是否点击在折叠按钮右侧30px范围内
        const treeItem = elementBelow?.closest('.tree-item[data-node-id]');
        if (treeItem) {
            const toggle = treeItem.querySelector('.tree-toggle');
            if (toggle) {
                const toggleRect = toggle.getBoundingClientRect();
                // 点击位置在折叠按钮右侧30px范围内，也触发折叠
                if (e.clientX >= toggleRect.left && e.clientX <= toggleRect.right + 30 &&
                    e.clientY >= toggleRect.top && e.clientY <= toggleRect.bottom) {
                    console.log('[Select模式] 点击折叠按钮附近区域，触发展开/收起');
                    toggle.click();
                    return;
                }
            }
        }

        // 找到最近的tree-item
        if (!treeItem) {
            console.log('[Select模式] 未找到tree-item');
            return;
        }

        const nodeId = treeItem.dataset.nodeId;
        console.log('[Select模式] 找到节点:', nodeId);

        // Ctrl/Cmd + Click: 多选
        if (e.ctrlKey || e.metaKey) {
            toggleSelectItem(nodeId);
            lastClickedNode = nodeId;
            console.log('[Select模式] Ctrl+Click多选');
            return;
        }

        // Shift + Click: 范围选择
        if (e.shiftKey && lastClickedNode) {
            selectRange(lastClickedNode, nodeId);
            console.log('[Select模式] Shift+Click范围选择');
            return;
        }

        // 普通点击: 切换选择
        toggleSelectItem(nodeId);
        lastClickedNode = nodeId;
        console.log('[Select模式] 普通点击');
    });

    // 绑定右键事件 - 在蓝框区域右键显示批量菜单
    overlay.addEventListener('contextmenu', (e) => {
        console.log('[Select模式] 右键事件:', { selectedCount: selectedNodes.size });
        if (selectedNodes.size > 0) {
            e.preventDefault();
            e.stopPropagation();
            showBatchContextMenu(e);
        }
    });

    // 使overlay可以接收点击和右键事件
    overlay.style.pointerEvents = 'auto';
}

// 隐藏Select模式蓝框
function hideSelectModeOverlay() {
    const overlay = document.getElementById('select-mode-overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

// 显示批量操作固定面板
function showBatchContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();

    console.log('[批量菜单] 显示固定面板');

    let anchorInfo = resolveBatchPanelAnchorInfo(e);
    if (!anchorInfo) {
        anchorInfo = {
            treeType: 'permanent',
            sectionId: PERMANENT_SECTION_ANCHOR_ID,
            element: findBatchPanelColumnElement('permanent', PERMANENT_SECTION_ANCHOR_ID)
        };
    }
    currentBatchPanelAnchorInfo = anchorInfo;
    const anchorKey = getBatchPanelAnchorKey(anchorInfo);

    // 检查是否已存在批量面板
    let batchPanel = document.getElementById('batch-action-panel');
    if (batchPanel) {
        // 如果已存在，只需确保显示
        batchPanel.style.display = 'block';
        if (batchPanel.parentNode !== document.body) {
            document.body.appendChild(batchPanel);
        }
        batchPanel.dataset.anchorKey = anchorKey;
        batchPanel.dataset.treeType = anchorInfo.treeType || 'permanent';
        if (anchorInfo.sectionId) {
            batchPanel.dataset.sectionId = anchorInfo.sectionId;
        } else {
            delete batchPanel.dataset.sectionId;
        }
        restoreBatchPanelState(batchPanel, anchorInfo);
        console.log('[批量菜单] 面板已存在，直接显示并更新定位');
        return;
    }

    // 创建固定位置的批量操作面板
    batchPanel = document.createElement('div');
    batchPanel.id = 'batch-action-panel';
    batchPanel.className = 'batch-action-panel vertical-batch-layout'; // 默认纵向布局
    batchPanel.dataset.anchorKey = anchorKey;
    batchPanel.dataset.treeType = anchorInfo.treeType || 'permanent';
    if (anchorInfo.sectionId) {
        batchPanel.dataset.sectionId = anchorInfo.sectionId;
    }

    const lang = currentLang || 'zh_CN';

    // 构建批量菜单 - 分组显示（简化版本）
    const itemGroups = [
        // 打开组
        {
            name: lang === 'zh_CN' ? '打开' : 'Open',
            items: [
                { action: 'batch-open', label: lang === 'zh_CN' ? `打开(${selectedNodes.size})` : `Open(${selectedNodes.size})`, icon: 'folder-open' },
                { action: 'batch-open-tab-group', label: lang === 'zh_CN' ? '标签组' : 'Group', icon: 'object-group' },
                { action: 'batch-open-manual-select', label: lang === 'zh_CN' ? '手动选择...' : 'Manual...', icon: 'hand-pointer' }
            ]
        },
        // 编辑组
        {
            name: lang === 'zh_CN' ? '编辑' : 'Edit',
            items: [
                { action: 'batch-cut', label: lang === 'zh_CN' ? '剪切' : 'Cut', icon: 'cut' },
                { action: 'batch-delete', label: lang === 'zh_CN' ? '删除' : 'Del', icon: 'trash-alt' },
                { action: 'batch-rename', label: lang === 'zh_CN' ? '改名' : 'Rename', icon: 'edit' }
            ]
        },
        // 导出组
        {
            name: lang === 'zh_CN' ? '导出' : 'Export',
            items: [
                { action: 'batch-export-html', label: 'HTML', icon: 'file-code' },
                { action: 'batch-export-json', label: 'JSON', icon: 'file-alt' },
                { action: 'batch-merge-folder', label: lang === 'zh_CN' ? '合并' : 'Merge', icon: 'folder-plus' }
            ]
        },
        // 控制组
        {
            name: lang === 'zh_CN' ? '控制' : 'Control',
            items: [
                { action: 'toggle-batch-layout', label: lang === 'zh_CN' ? '横向' : 'Horiz', icon: 'exchange-alt' },
                { action: 'hide-batch-panel', label: lang === 'zh_CN' ? '隐藏' : 'Hide', icon: 'eye-slash' }
            ]
        }
    ];

    batchPanel.innerHTML = `
        <div class="batch-panel-header" id="batch-panel-header">
            <span class="batch-panel-title" title="${lang === 'zh_CN' ? '拖动移动窗口' : 'Drag to move'}">${lang === 'zh_CN' ? '批量操作' : 'Batch Actions'}</span>
            <span class="batch-panel-count" id="batch-panel-count">${selectedNodes.size} ${lang === 'zh_CN' ? '项已选' : 'selected'}</span>
            <button class="batch-panel-exit-btn" data-action="exit-select-mode" title="${lang === 'zh_CN' ? '退出Select模式' : 'Exit Select Mode'}">
                <i class="fas fa-times"></i> ${lang === 'zh_CN' ? '退出' : 'Exit'}
            </button>
        </div>
        <div class="batch-panel-resize-handles">
            <div class="resize-handle resize-n" data-direction="n"></div>
            <div class="resize-handle resize-s" data-direction="s"></div>
            <div class="resize-handle resize-w" data-direction="w"></div>
            <div class="resize-handle resize-e" data-direction="e"></div>
            <div class="resize-handle resize-nw" data-direction="nw"></div>
            <div class="resize-handle resize-ne" data-direction="ne"></div>
            <div class="resize-handle resize-sw" data-direction="sw"></div>
            <div class="resize-handle resize-se" data-direction="se"></div>
        </div>
        <div class="batch-panel-content">
            ${itemGroups.map((group, groupIndex) => {
        const groupItems = group.items.map(item => {
            const icon = item.icon ? `<i class="fas fa-${item.icon}"></i>` : '';
            const exitClass = item.isExit ? 'exit-item' : '';
            return `
                        <div class="context-menu-item ${exitClass}" data-action="${item.action}">
                            ${icon}
                            <span>${item.label}</span>
                        </div>
                    `;
        }).join('');

        return `
                    <div class="batch-menu-group" data-group="${group.name}">
                        <div class="batch-group-label">${group.name}</div>
                        <div class="batch-group-items">
                            ${groupItems}
                        </div>
                    </div>
                `;
    }).join('')}
        </div>
    `;

    // 绑定点击事件
    batchPanel.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', async (e) => {
            e.stopPropagation();
            const action = item.dataset.action;
            console.log('[批量菜单] 点击操作:', action);

            if (action === 'exit-select-mode') {
                exitSelectMode();
            } else if (action === 'hide-batch-panel') {
                hideBatchPanel();
            } else if (action === 'toggle-batch-layout') {
                toggleBatchPanelLayout();
            } else if (action === 'batch-open') {
                await batchOpen();
            } else if (action === 'batch-open-tab-group') {
                await batchOpenTabGroup();
            } else if (action === 'batch-open-manual-select') {
                await batchOpenWithManualSelection();
            } else if (action === 'batch-cut') {
                await batchCut();
            } else if (action === 'batch-delete') {
                await batchDelete();
            } else if (action === 'batch-rename') {
                await batchRename();
            } else if (action === 'batch-export-html') {
                await batchExportHTML();
            } else if (action === 'batch-export-json') {
                await batchExportJSON();
            } else if (action === 'batch-merge-folder') {
                await batchMergeFolder();
            } else {
                // 其他操作通过handleMenuAction处理（需要context）
                await handleMenuAction(action, null, null, null, false);
            }
        });
    });

    // 绑定标题栏退出按钮事件
    const headerExitBtn = batchPanel.querySelector('.batch-panel-exit-btn');
    if (headerExitBtn) {
        headerExitBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            try {
                exitSelectMode();
            } catch (_) {
                // 兜底：显式关闭面板与蓝框并清空选择
                try { selectMode = false; } catch (_) { }
                try { hideBatchActionPanel(); } catch (_) { }
                try { hideSelectModeOverlay(); } catch (_) { }
                try { if (typeof deselectAll === 'function') deselectAll(); } catch (_) { }
                try { updateBatchToolbar(); } catch (_) { }
            }
            console.log('[批量菜单] 点击标题栏退出按钮');
        });
    }

    // 添加拖拽移动功能
    initBatchPanelDrag(batchPanel);

    // 添加调整大小功能（四边和四角）
    initBatchPanelResize(batchPanel);

    // 添加窗口大小变化监听器（用于横向布局自适应）
    initBatchPanelWindowResize(batchPanel);

    // 始终挂载到 body，避免祖先 transform 影响定位
    if (batchPanel.parentNode !== document.body) {
        document.body.appendChild(batchPanel);
        console.log('[批量菜单] 固定面板已添加到body');
    }

    // 恢复保存的位置和大小，或设置初始定位
    restoreBatchPanelState(batchPanel, anchorInfo);
}

// ==================== 批量操作功能 ====================

// 切换选择单个项目
function toggleSelectItem(nodeId) {
    const nodeElement = document.querySelector(`.tree-item[data-node-id="${nodeId}"]`);
    if (!nodeElement) {
        console.log('[批量] 未找到节点元素:', nodeId);
        return;
    }

    if (selectedNodes.has(nodeId)) {
        selectedNodes.delete(nodeId);
        selectedNodeMeta.delete(nodeId);
        nodeElement.classList.remove('selected');
        console.log('[批量] 取消选中:', nodeId);
        if (selectedNodes.size === 0) {
            lastBatchSelectionInfo = null;
        }
    } else {
        selectedNodes.add(nodeId);
        selectedNodeMeta.set(nodeId, {
            treeType: nodeElement.dataset.treeType || 'permanent',
            sectionId: nodeElement.dataset.sectionId || null
        });
        nodeElement.classList.add('selected');
        rememberBatchSelection(nodeElement);
        console.log('[批量] 选中:', nodeId);
    }

    updateBatchToolbar();
    updateBatchPanelCount(); // 实时更新批量面板计数
    console.log('[批量] 选中状态:', selectedNodes.size, '个');
}

// 批量打开
async function batchOpen() {
    if (!chrome || !chrome.tabs) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    const lang = currentLang || 'zh_CN';
    const permanentIds = getSelectedPermanentNodeIds();
    if (!permanentIds.length) {
        await batchOpenTemp();
        return;
    }
    const urls = await getSelectedUrls(permanentIds);

    if (urls.length === 0) {
        alert(lang === 'zh_CN' ? '没有可打开的书签' : 'No bookmarks to open');
        return;
    }

    if (urls.length > 10) {
        const message = lang === 'zh_CN'
            ? `确定要打开 ${urls.length} 个书签吗？`
            : `Open ${urls.length} bookmarks?`;
        if (!confirm(message)) return;
    }

    for (const url of urls) {
        await chrome.tabs.create({ url: url, active: false });
    }

    console.log('[批量] 已打开:', urls.length, '个书签');
}

// 批量打开（标签页组）
async function batchOpenTabGroup() {
    if (!chrome || !chrome.tabs) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    const lang = currentLang || 'zh_CN';
    const permanentIds = getSelectedPermanentNodeIds();
    if (!permanentIds.length) {
        await batchOpenTemp({ tabGroup: true });
        return;
    }
    const urls = await getSelectedUrls(permanentIds);

    if (urls.length === 0) {
        alert(lang === 'zh_CN' ? '没有可打开的书签' : 'No bookmarks to open');
        return;
    }

    try {
        // 创建标签页
        const tabIds = [];
        for (const url of urls) {
            const tab = await chrome.tabs.create({ url: url, active: false });
            tabIds.push(tab.id);
        }

        // 创建标签页组
        if (chrome.tabs.group) {
            const groupId = await chrome.tabs.group({ tabIds: tabIds });

            if (chrome.tabGroups) {
                await chrome.tabGroups.update(groupId, {
                    title: lang === 'zh_CN' ? `选中的书签 (${urls.length})` : `Selected (${urls.length})`,
                    collapsed: false
                });
            }
        }

        console.log('[批量] 已在标签页组中打开:', urls.length, '个书签');
    } catch (error) {
        console.error('[批量] 打开失败:', error);
        alert(lang === 'zh_CN' ? `打开失败: ${error.message}` : `Failed to open: ${error.message}`);
    }
}

// 批量打开（手动选择窗口/组）
async function batchOpenWithManualSelection() {
    console.log('[批量手动选择] 开始执行 batchOpenWithManualSelection');

    if (!chrome || !chrome.tabs) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    const lang = currentLang || 'zh_CN';

    // 获取所有选中项的详细信息（不只是URL，还需要知道是书签还是文件夹）
    const permanentIds = getSelectedPermanentNodeIds();
    const tempNodes = getSelectedTempNodes();

    // 收集选中项的详细信息
    const selectionInfo = {
        folders: [],      // { id, title, type: 'permanent'|'temporary', sectionId? }
        bookmarks: [],    // { url, title }
        hasFolders: false,
        hasBookmarks: false
    };

    // 处理永久书签
    for (const nodeId of permanentIds) {
        try {
            const [node] = await chrome.bookmarks.get(nodeId);
            if (node.url) {
                selectionInfo.bookmarks.push({ url: node.url, title: node.title });
                selectionInfo.hasBookmarks = true;
            } else {
                selectionInfo.folders.push({
                    id: nodeId,
                    title: node.title,
                    type: 'permanent'
                });
                selectionInfo.hasFolders = true;
            }
        } catch (error) {
            console.error('[批量手动选择] 获取节点失败:', nodeId, error);
        }
    }

    // 处理临时书签
    const tempManager = (window.CanvasModule && window.CanvasModule.temp) ? window.CanvasModule.temp : null;
    tempNodes.forEach(node => {
        if (node.url && !node.isFolder) {
            selectionInfo.bookmarks.push({ url: node.url, title: node.title });
            selectionInfo.hasBookmarks = true;
        } else if (node.isFolder) {
            selectionInfo.folders.push({
                id: node.id,
                title: node.title,
                type: 'temporary',
                sectionId: node.sectionId
            });
            selectionInfo.hasFolders = true;
        }
    });

    if (!selectionInfo.hasFolders && !selectionInfo.hasBookmarks) {
        alert(lang === 'zh_CN' ? '没有选中任何书签或文件夹' : 'No bookmarks or folders selected');
        return;
    }

    // 显示手动选择对话框（传递详细信息）
    await showBatchManualWindowGroupSelector(selectionInfo, lang);
}

/**
 * 显示批量手动选择窗口+组的选择器
 */
async function showBatchManualWindowGroupSelector(selectionInfo, lang) {
    try {
        lang = lang || currentLang || 'zh_CN';

        // 计算初始书签数量（单层模式）
        let initialCount = selectionInfo.bookmarks.length;
        for (const folder of selectionInfo.folders) {
            const urls = await getFolderUrls(folder, 1); // 单层
            initialCount += urls.length;
        }

        // 创建遮罩层
        const overlay = document.createElement('div');
        overlay.className = 'manual-selector-overlay';

        // 创建对话框
        const dialog = document.createElement('div');
        dialog.className = 'manual-selector-dialog';

        // 头部（包含层级选项）
        const header = document.createElement('div');
        header.className = 'manual-selector-header';
        header.innerHTML = `
            <h3>${lang === 'zh_CN' ? '批量打开 - 选择目标窗口/标签组' : 'Batch Open - Select Target Window/Group'}</h3>
            <div class="manual-selector-header-right">
                <span class="manual-selector-count" id="batch-bookmark-count">${initialCount} ${lang === 'zh_CN' ? '个书签' : 'bookmarks'}</span>
                ${selectionInfo.hasFolders ? `
                    <div class="manual-selector-depth-control">
                        <label class="manual-selector-depth-checkbox">
                            <input type="checkbox" id="include-subfolders-checkbox">
                            <span>${lang === 'zh_CN' ? '包含子文件夹' : 'Include subfolders'}</span>
                        </label>
                        <select id="depth-level-select" class="manual-selector-depth-select" disabled>
                            <option value="all">${lang === 'zh_CN' ? '全部层级' : 'All levels'}</option>
                            <option value="1">${lang === 'zh_CN' ? '1层' : '1 level'}</option>
                            <option value="2">${lang === 'zh_CN' ? '2层' : '2 levels'}</option>
                            <option value="3">${lang === 'zh_CN' ? '3层' : '3 levels'}</option>
                            <option value="4">${lang === 'zh_CN' ? '4层' : '4 levels'}</option>
                            <option value="5">${lang === 'zh_CN' ? '5层' : '5 levels'}</option>
                        </select>
                    </div>
                ` : ''}
                <button class="manual-selector-close">&times;</button>
            </div>
        `;

        // 内容区 - 使用DOM方式创建以便绑定帮助提示事件
        const body = document.createElement('div');
        body.className = 'manual-selector-body';

        // 左侧：窗口列表面板
        const windowPanel = document.createElement('div');
        windowPanel.className = 'manual-selector-panel';
        windowPanel.id = 'batch-window-panel';
        windowPanel.style.position = 'relative';
        windowPanel.innerHTML = `
            <div class="manual-selector-panel-title">
                <span>${lang === 'zh_CN' ? '窗口' : 'Windows'}</span>
                <span style="position: relative; display: inline-flex; align-items: center;">
                    <i class="fas fa-question-circle manual-selector-help-icon"></i>
                </span>
            </div>
            <div class="manual-selector-help-tooltip">
                <p>${lang === 'zh_CN'
                ? 'Chrome/Edge扩展API无法获取窗口的自定义名称（即使您在浏览器中设置了"命名窗口"）。'
                : 'Chrome/Edge extension API cannot access custom window names (even if you set "Name Window" in browser).'}</p>
                <p>${lang === 'zh_CN'
                ? '显示的是活动标签页标题，您可以点击编辑按钮（<i class="fas fa-edit"></i>）设置自定义名称。'
                : 'Showing active tab title, you can click edit button (<i class="fas fa-edit"></i>) to set custom name.'}</p>
            </div>
            <div class="manual-selector-list" data-type="windows"></div>
        `;

        // 绑定帮助图标hover事件
        const helpIcon = windowPanel.querySelector('.manual-selector-help-icon');
        const helpTooltip = windowPanel.querySelector('.manual-selector-help-tooltip');

        // 动态计算箭头位置
        const updateArrowPosition = () => {
            const panelRect = windowPanel.getBoundingClientRect();
            const iconRect = helpIcon.getBoundingClientRect();
            const arrowOffset = iconRect.left - panelRect.left + (iconRect.width / 2);
            helpTooltip.style.setProperty('--arrow-offset', `${arrowOffset}px`);
        };

        helpIcon.addEventListener('mouseenter', () => {
            updateArrowPosition();
            helpTooltip.style.opacity = '1';
            helpTooltip.style.visibility = 'visible';
        });

        helpIcon.addEventListener('mouseleave', () => {
            helpTooltip.style.opacity = '0';
            helpTooltip.style.visibility = 'hidden';
        });

        helpTooltip.addEventListener('mouseenter', () => {
            helpTooltip.style.opacity = '1';
            helpTooltip.style.visibility = 'visible';
        });

        helpTooltip.addEventListener('mouseleave', () => {
            helpTooltip.style.opacity = '0';
            helpTooltip.style.visibility = 'hidden';
        });

        // 右侧：标签组列表面板
        const groupPanel = document.createElement('div');
        groupPanel.className = 'manual-selector-panel';
        groupPanel.id = 'batch-group-panel';
        groupPanel.innerHTML = `
            <div class="manual-selector-panel-title">
                <span>${lang === 'zh_CN' ? '标签组' : 'Tab Groups'}</span>
                ${selectionInfo.hasFolders ? `
                    <span class="manual-selector-panel-hint" id="group-panel-hint">
                        ${lang === 'zh_CN' ? '(不选择则文件夹自动成组)' : '(Folders become groups if none selected)'}
                    </span>
                ` : ''}
            </div>
            <div class="manual-selector-list" data-type="groups"></div>
        `;

        // 创建panels容器并添加两个面板
        const panelsContainer = document.createElement('div');
        panelsContainer.className = 'manual-selector-panels';
        panelsContainer.appendChild(windowPanel);
        panelsContainer.appendChild(groupPanel);

        body.appendChild(panelsContainer);

        // 特色功能说明区域
        const featuresSection = document.createElement('div');
        featuresSection.className = 'manual-selector-features';
        featuresSection.innerHTML = `
            <div class="manual-selector-features-title">
                <i class="fas fa-lightbulb"></i>
                <span>${lang === 'zh_CN' ? '特色功能' : 'Features'}</span>
            </div>
            <div class="manual-selector-features-grid">
                <div class="manual-selector-feature-item">
                    <i class="fas fa-check-square"></i>
                    <span>${lang === 'zh_CN' ? '多选模式：右键 → 选择（批量操作），支持跨栏目多选' : 'Multi-select: Right-click → Select, supports cross-column selection'}</span>
                </div>
                <div class="manual-selector-feature-item">
                    <i class="fas fa-folder-open"></i>
                    <span>${lang === 'zh_CN' ? '文件夹智能分组：不选择标签组时，每个文件夹自动创建对应标签组' : 'Smart grouping: Each folder auto-creates its own tab group when none selected'}</span>
                </div>
                <div class="manual-selector-feature-item">
                    <i class="fas fa-sitemap"></i>
                    <span>${lang === 'zh_CN' ? '层级控制：可选择包含子文件夹，并控制递归深度' : 'Depth control: Include subfolders with customizable depth'}</span>
                </div>
                <div class="manual-selector-feature-item">
                    <i class="fas fa-window-restore"></i>
                    <span>${lang === 'zh_CN' ? '灵活目标：选择窗口+标签组，或仅选窗口让文件夹自动成组' : 'Flexible target: Choose window + group, or just window for auto-grouping'}</span>
                </div>
            </div>
        `;
        body.appendChild(featuresSection);

        // 底部
        const footer = document.createElement('div');
        footer.className = 'manual-selector-footer';
        footer.innerHTML = `
            <button class="manual-selector-btn manual-selector-btn-clear">${lang === 'zh_CN' ? '清除选择' : 'Clear'}</button>
            <button class="manual-selector-btn manual-selector-btn-cancel">${lang === 'zh_CN' ? '取消' : 'Cancel'}</button>
            <button class="manual-selector-btn manual-selector-btn-confirm">${lang === 'zh_CN' ? '打开' : 'Open'}</button>
        `;

        // 组装
        dialog.appendChild(header);
        dialog.appendChild(body);
        dialog.appendChild(footer);
        overlay.appendChild(dialog);

        // 将overlay添加到画布工作区或body
        const canvasWorkspace = document.getElementById('canvasWorkspace');
        const canvasContainer = canvasWorkspace || document.body;
        canvasContainer.appendChild(overlay);

        // 存储批量选择的临时状态
        let batchSelectedWindowId = null;
        let batchSelectedGroupId = null;
        let includeSubfolders = false;
        let depthLevel = 'all';

        // 设置层级选择事件
        const checkbox = overlay.querySelector('#include-subfolders-checkbox');
        const depthSelect = overlay.querySelector('#depth-level-select');
        const countDisplay = overlay.querySelector('#batch-bookmark-count');

        const updateBookmarkCount = async () => {
            let count = selectionInfo.bookmarks.length;
            const depth = includeSubfolders ? (depthLevel === 'all' ? Infinity : parseInt(depthLevel)) : 1;

            for (const folder of selectionInfo.folders) {
                const urls = await getFolderUrls(folder, depth);
                count += urls.length;
            }

            countDisplay.textContent = `${count} ${lang === 'zh_CN' ? '个书签' : 'bookmarks'}`;
        };

        if (checkbox) {
            checkbox.addEventListener('change', async () => {
                includeSubfolders = checkbox.checked;
                if (depthSelect) {
                    depthSelect.disabled = !includeSubfolders;
                }
                await updateBookmarkCount();
            });
        }

        if (depthSelect) {
            depthSelect.addEventListener('change', async () => {
                depthLevel = depthSelect.value;
                await updateBookmarkCount();
            });
        }

        // 加载窗口和组列表
        await loadBatchWindowsAndGroups(overlay, lang, (windowId, groupId) => {
            batchSelectedWindowId = windowId;
            batchSelectedGroupId = groupId;
        });

        // 设置事件
        setupBatchSelectorEventsV2(overlay, selectionInfo, lang, () => ({
            windowId: batchSelectedWindowId,
            groupId: batchSelectedGroupId,
            includeSubfolders,
            depthLevel
        }));

    } catch (error) {
        console.error('[批量手动选择器] 创建失败:', error);
    }
}

/**
 * 获取文件夹的URL列表（支持层级限制）
 */
async function getFolderUrls(folder, maxDepth = 1) {
    const urls = [];

    if (folder.type === 'permanent') {
        await collectPermanentFolderUrls(folder.id, urls, 1, maxDepth);
    } else if (folder.type === 'temporary') {
        const tempManager = (window.CanvasModule && window.CanvasModule.temp) ? window.CanvasModule.temp : null;
        if (tempManager) {
            try {
                const itemEntry = tempManager.findItem(folder.sectionId, folder.id);
                if (itemEntry && itemEntry.item) {
                    collectTempFolderUrls(itemEntry.item, urls, 1, maxDepth);
                }
            } catch (err) {
                console.warn('[批量手动选择] 获取临时文件夹内容失败:', err);
            }
        }
    }

    return urls;
}

/**
 * 递归收集永久文件夹的URL（带层级限制）
 */
async function collectPermanentFolderUrls(folderId, urls, currentDepth, maxDepth) {
    if (currentDepth > maxDepth) return;

    try {
        const children = await chrome.bookmarks.getChildren(folderId);
        for (const child of children) {
            if (child.url) {
                urls.push(child.url);
            } else if (currentDepth < maxDepth) {
                await collectPermanentFolderUrls(child.id, urls, currentDepth + 1, maxDepth);
            }
        }
    } catch (error) {
        console.error('[批量手动选择] 获取文件夹子项失败:', error);
    }
}

/**
 * 递归收集临时文件夹的URL（带层级限制）
 */
function collectTempFolderUrls(item, urls, currentDepth, maxDepth) {
    if (!item || currentDepth > maxDepth) return;

    if (item.children && Array.isArray(item.children)) {
        for (const child of item.children) {
            if (child.url && child.type !== 'folder') {
                urls.push(child.url);
            } else if (child.type === 'folder' && currentDepth < maxDepth) {
                collectTempFolderUrls(child, urls, currentDepth + 1, maxDepth);
            }
        }
    }
}

/**
 * 设置批量选择器事件（V2版本，支持智能分组）
 */
function setupBatchSelectorEventsV2(overlay, selectionInfo, lang, getSelection) {
    // 关闭按钮
    const closeBtn = overlay.querySelector('.manual-selector-close');
    closeBtn.addEventListener('click', () => {
        overlay.remove();
    });

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
        }
    });

    // 取消按钮
    const cancelBtn = overlay.querySelector('.manual-selector-btn-cancel');
    cancelBtn.addEventListener('click', () => {
        overlay.remove();
    });

    // 清除按钮
    const clearBtn = overlay.querySelector('.manual-selector-btn-clear');
    clearBtn.addEventListener('click', () => {
        overlay.querySelectorAll('.manual-selector-item.selected').forEach(item => {
            item.classList.remove('selected');
        });
    });

    // 确认按钮
    const confirmBtn = overlay.querySelector('.manual-selector-btn-confirm');
    confirmBtn.addEventListener('click', async () => {
        const selection = getSelection();
        const { windowId, groupId, includeSubfolders, depthLevel } = selection;

        console.log('[批量手动选择器] 确认打开:', { windowId, groupId, includeSubfolders, depthLevel });

        // 关闭选择器
        overlay.remove();

        // 批量打开书签（使用新的智能打开逻辑）
        await batchOpenWithSmartGrouping(selectionInfo, windowId, groupId, includeSubfolders, depthLevel, lang);
    });
}

/**
 * 智能分组打开书签
 * - 如果选择了标签组：所有书签打开到该组
 * - 如果只选择了窗口：文件夹各自成组，单个书签作为独立标签
 */
async function batchOpenWithSmartGrouping(selectionInfo, windowId, groupId, includeSubfolders, depthLevel, lang) {
    try {
        const depth = includeSubfolders ? (depthLevel === 'all' ? Infinity : parseInt(depthLevel)) : 1;

        // 情况1：选择了标签组 - 所有书签打开到该组
        if (groupId) {
            const allUrls = [];

            // 收集单个书签
            selectionInfo.bookmarks.forEach(b => allUrls.push(b.url));

            // 收集文件夹中的书签
            for (const folder of selectionInfo.folders) {
                const urls = await getFolderUrls(folder, depth);
                allUrls.push(...urls);
            }

            if (allUrls.length > 0) {
                await batchOpenUrlsWithSelection(allUrls, windowId, groupId, lang);
            }
        }
        // 情况2：只选择了窗口或都不选 - 文件夹各自成组，单个书签独立
        else {
            const targetWindowId = windowId || (await chrome.windows.getCurrent()).id;

            // 1. 先处理文件夹 - 每个文件夹创建一个标签组
            for (const folder of selectionInfo.folders) {
                const urls = await getFolderUrls(folder, depth);
                if (urls.length > 0) {
                    const tabIds = [];
                    for (const url of urls) {
                        const tab = await chrome.tabs.create({ url, windowId: targetWindowId, active: false });
                        tabIds.push(tab.id);
                    }

                    // 创建标签组，以文件夹名命名
                    if (tabIds.length > 0 && chrome.tabs.group) {
                        const newGroupId = await chrome.tabs.group({ tabIds });
                        if (chrome.tabGroups) {
                            await chrome.tabGroups.update(newGroupId, {
                                title: folder.title || (lang === 'zh_CN' ? '文件夹' : 'Folder'),
                                collapsed: false
                            });
                        }
                        console.log('[批量手动选择器] 创建标签组:', folder.title, '包含', tabIds.length, '个标签');
                    }
                }
            }

            // 2. 处理单个书签 - 作为独立标签页
            for (const bookmark of selectionInfo.bookmarks) {
                await chrome.tabs.create({ url: bookmark.url, windowId: targetWindowId, active: false });
            }

            console.log('[批量手动选择器] 已打开:', selectionInfo.folders.length, '个文件夹组,', selectionInfo.bookmarks.length, '个独立书签');
        }

    } catch (error) {
        console.error('[批量手动选择器] 智能分组打开失败:', error);
        alert(lang === 'zh_CN' ? `打开失败: ${error.message}` : `Failed to open: ${error.message}`);
    }
}

/**
 * 加载批量选择器的窗口和组列表
 */
async function loadBatchWindowsAndGroups(overlay, lang, onSelectionChange) {
    try {
        // 获取所有窗口
        const windows = await chrome.windows.getAll({ populate: true });
        const windowsList = overlay.querySelector('.manual-selector-list[data-type="windows"]');

        // 重置窗口序号映射
        windowIdToIndexMap = {};

        if (windows.length === 0) {
            windowsList.innerHTML = `<div class="manual-selector-empty">${lang === 'zh_CN' ? '没有窗口' : 'No windows'}</div>`;
        } else {
            windowsList.innerHTML = '';

            // 获取当前窗口ID
            const currentWindow = await chrome.windows.getCurrent();
            const currentWindowId = currentWindow.id;

            // 构建窗口ID到序号的映射
            windows.forEach((win, index) => {
                windowIdToIndexMap[win.id] = index + 1;
            });

            // 当前选中的窗口ID（用于状态管理）
            let selectedWindowId = null;

            windows.forEach((win, index) => {
                const windowIndex = index + 1;  // 窗口序号（从1开始）
                const isCurrent = win.id === currentWindowId;
                const tabCount = win.tabs ? win.tabs.length : 0;

                // 获取活动标签页标题
                const activeTab = win.tabs ? win.tabs.find(tab => tab.active) : null;
                const activeTabTitle = activeTab ? activeTab.title : `Window #${win.id}`;

                // 获取显示名称（优先使用自定义名称）
                const displayName = getWindowDisplayName(win.id, activeTabTitle);
                const hasCustomName = !!customWindowNames[win.id];

                // 窗口状态
                const stateIcon = {
                    'maximized': '<i class="fas fa-window-maximize"></i>',
                    'minimized': '<i class="fas fa-window-minimize"></i>',
                    'fullscreen': '<i class="fas fa-expand"></i>',
                    'normal': '<i class="fas fa-window-restore"></i>'
                }[win.state] || '';

                const stateText = {
                    'maximized': lang === 'zh_CN' ? '最大化' : 'Maximized',
                    'minimized': lang === 'zh_CN' ? '最小化' : 'Minimized',
                    'fullscreen': lang === 'zh_CN' ? '全屏' : 'Fullscreen',
                    'normal': lang === 'zh_CN' ? '正常' : 'Normal'
                }[win.state] || '';

                const item = document.createElement('div');
                item.className = 'manual-selector-item';
                item.dataset.windowId = win.id;
                item.dataset.windowIndex = windowIndex;

                item.innerHTML = `
                    <div class="manual-selector-item-header">
                        <div class="manual-selector-item-title">
                            <span class="manual-selector-window-index">${windowIndex}</span>
                            ${win.incognito ? '🕶️' : '🪟'} ${displayName}
                            ${isCurrent ? `<span class="manual-selector-item-badge">${lang === 'zh_CN' ? '当前' : 'Current'}</span>` : ''}
                            ${hasCustomName ? `<span class="manual-selector-item-badge" style="background: var(--accent-primary);">✓</span>` : ''}
                        </div>
                        <div class="manual-selector-item-actions">
                            <button class="manual-selector-edit-btn" data-window-id="${win.id}" title="${lang === 'zh_CN' ? '编辑名称' : 'Edit name'}">
                                <i class="fas fa-edit"></i>
                            </button>
                        </div>
                    </div>
                    <div class="manual-selector-item-info">
                        <span class="manual-selector-item-meta">${stateIcon} ${stateText}</span>
                        <span class="manual-selector-item-meta"><i class="fas fa-layer-group"></i> ${tabCount} ${lang === 'zh_CN' ? '个标签页' : 'tabs'}</span>
                        ${win.incognito ? `<span class="manual-selector-item-meta"><i class="fas fa-user-secret"></i> ${lang === 'zh_CN' ? '无痕模式' : 'Incognito'}</span>` : ''}
                    </div>
                `;

                // 绑定编辑按钮事件
                const editBtn = item.querySelector('.manual-selector-edit-btn');
                editBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await showWindowNameEditor(item, win.id, displayName, lang);
                });

                // 点击选择窗口
                item.addEventListener('click', async (e) => {
                    // 如果处于编辑模式，不触发选择
                    if (item.dataset.editing === 'true') {
                        return;
                    }
                    // 如果点击的是编辑按钮或输入框，不触发选择
                    if (e.target.closest('.manual-selector-edit-btn') || e.target.closest('.manual-selector-item-input')) {
                        return;
                    }

                    // 切换选中状态
                    const wasSelected = item.classList.contains('selected');
                    overlay.querySelectorAll('.manual-selector-list[data-type="windows"] .manual-selector-item').forEach(i => {
                        i.classList.remove('selected');
                    });

                    if (!wasSelected) {
                        item.classList.add('selected');
                        selectedWindowId = win.id;
                        onSelectionChange(win.id, null);
                        // 加载该窗口的组
                        await loadBatchGroupsForWindow(overlay, win.id, lang, onSelectionChange);
                    } else {
                        selectedWindowId = null;
                        onSelectionChange(null, null);
                        // 清除组选择
                        overlay.querySelectorAll('.manual-selector-list[data-type="groups"] .manual-selector-item').forEach(i => {
                            i.classList.remove('selected');
                        });
                        // 加载所有组
                        await loadBatchGroupsForWindow(overlay, null, lang, onSelectionChange);
                    }
                });

                windowsList.appendChild(item);
            });
        }

        // 加载所有组
        await loadBatchGroupsForWindow(overlay, null, lang, onSelectionChange);

    } catch (error) {
        console.error('[批量手动选择器] 加载失败:', error);
    }
}

/**
 * 加载批量选择器的组列表
 */
async function loadBatchGroupsForWindow(overlay, windowId, lang, onSelectionChange) {
    try {
        const groupsList = overlay.querySelector('.manual-selector-list[data-type="groups"]');

        // 查询组
        const query = windowId ? { windowId } : {};
        const groups = await chrome.tabGroups.query(query);

        if (groups.length === 0) {
            groupsList.innerHTML = `<div class="manual-selector-empty">${windowId
                ? (lang === 'zh_CN' ? '该窗口没有标签组' : 'No groups in this window')
                : (lang === 'zh_CN' ? '选择窗口以查看其标签组，或直接选择所有组' : 'Select a window to see its groups, or choose from all groups')}</div>`;

            // 如果没有选择窗口，显示所有组
            if (!windowId) {
                const allGroups = await chrome.tabGroups.query({});
                if (allGroups.length > 0) {
                    renderBatchGroups(overlay, allGroups, lang, onSelectionChange);
                }
            }
        } else {
            renderBatchGroups(overlay, groups, lang, onSelectionChange);
        }
    } catch (error) {
        console.error('[批量手动选择器] 加载组失败:', error);
    }
}

/**
 * 渲染批量选择器的组列表
 */
function renderBatchGroups(overlay, groups, lang, onSelectionChange) {
    const groupsList = overlay.querySelector('.manual-selector-list[data-type="groups"]');
    groupsList.innerHTML = '';

    // 按窗口分组显示
    const groupsByWindow = {};
    groups.forEach(group => {
        if (!groupsByWindow[group.windowId]) {
            groupsByWindow[group.windowId] = [];
        }
        groupsByWindow[group.windowId].push(group);
    });

    // 获取窗口ID列表（如果有多个窗口的组，显示窗口分隔）
    const windowIds = Object.keys(groupsByWindow);
    const showWindowHeaders = windowIds.length > 1;

    windowIds.forEach(winId => {
        // 获取窗口序号
        const windowIndex = windowIdToIndexMap[winId] || winId;

        // 如果有多个窗口，显示窗口标题
        if (showWindowHeaders) {
            const header = document.createElement('div');
            header.className = 'manual-selector-item-info';
            header.style.padding = '8px 16px';
            header.style.fontWeight = '600';
            header.style.borderBottom = '1px solid var(--border-color)';
            header.style.marginBottom = '6px';
            header.innerHTML = `<i class="fas fa-window-restore"></i> ${lang === 'zh_CN' ? '窗口' : 'Window'} ${windowIndex}`;
            groupsList.appendChild(header);
        }

        groupsByWindow[winId].forEach(group => {
            const colorMap = {
                'grey': '⚪',
                'blue': '🔵',
                'red': '🔴',
                'yellow': '🟡',
                'green': '🟢',
                'pink': '🟣',
                'purple': '🟣',
                'cyan': '🔵',
                'orange': '🟠'
            };
            const colorIcon = colorMap[group.color] || '⚪';

            const item = document.createElement('div');
            item.className = 'manual-selector-item';
            item.dataset.groupId = group.id;
            item.dataset.windowId = group.windowId;

            const title = group.title || (lang === 'zh_CN' ? '(无标题)' : '(Untitled)');
            const groupWindowIndex = windowIdToIndexMap[group.windowId] || group.windowId;

            item.innerHTML = `
                <div class="manual-selector-item-title">
                    ${colorIcon} ${title}
                </div>
                <div class="manual-selector-item-info">${lang === 'zh_CN' ? '窗口' : 'Window'} ${groupWindowIndex}</div>
            `;

            // 点击选择组
            item.addEventListener('click', () => {
                const wasSelected = item.classList.contains('selected');
                overlay.querySelectorAll('.manual-selector-list[data-type="groups"] .manual-selector-item').forEach(i => {
                    i.classList.remove('selected');
                });

                if (!wasSelected) {
                    item.classList.add('selected');
                    // 获取当前选中的窗口
                    const selectedWindowItem = overlay.querySelector('.manual-selector-list[data-type="windows"] .manual-selector-item.selected');
                    const currentWindowId = selectedWindowItem ? parseInt(selectedWindowItem.dataset.windowId) : null;
                    onSelectionChange(currentWindowId, group.id);
                } else {
                    const selectedWindowItem = overlay.querySelector('.manual-selector-list[data-type="windows"] .manual-selector-item.selected');
                    const currentWindowId = selectedWindowItem ? parseInt(selectedWindowItem.dataset.windowId) : null;
                    onSelectionChange(currentWindowId, null);
                }
            });

            groupsList.appendChild(item);
        });
    });
}

/**
 * 设置批量选择器事件
 */
function setupBatchSelectorEvents(overlay, urls, lang, getSelection) {
    // 关闭按钮
    const closeBtn = overlay.querySelector('.manual-selector-close');
    closeBtn.addEventListener('click', () => {
        overlay.remove();
    });

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
        }
    });

    // 取消按钮
    const cancelBtn = overlay.querySelector('.manual-selector-btn-cancel');
    cancelBtn.addEventListener('click', () => {
        overlay.remove();
    });

    // 清除按钮
    const clearBtn = overlay.querySelector('.manual-selector-btn-clear');
    clearBtn.addEventListener('click', () => {
        overlay.querySelectorAll('.manual-selector-item.selected').forEach(item => {
            item.classList.remove('selected');
        });
    });

    // 确认按钮
    const confirmBtn = overlay.querySelector('.manual-selector-btn-confirm');
    confirmBtn.addEventListener('click', async () => {
        const selection = getSelection();
        const { windowId, groupId } = selection;

        console.log('[批量手动选择器] 确认打开, 窗口:', windowId, ', 组:', groupId, ', 书签数:', urls.length);

        // 关闭选择器
        overlay.remove();

        // 批量打开书签
        await batchOpenUrlsWithSelection(urls, windowId, groupId, lang);
    });
}

/**
 * 使用选择的窗口/组批量打开URL
 */
async function batchOpenUrlsWithSelection(urls, windowId, groupId, lang) {
    try {
        const tabIds = [];

        // 情况1: 窗口 + 组
        if (windowId && groupId) {
            // 验证组是否存在且在指定窗口中
            try {
                const group = await chrome.tabGroups.get(groupId);
                if (group.windowId !== windowId) {
                    throw new Error('组不在指定窗口中');
                }

                // 在指定窗口的指定组中打开
                for (const url of urls) {
                    const tab = await chrome.tabs.create({ url, windowId, active: false });
                    tabIds.push(tab.id);
                }

                // 添加到组
                if (tabIds.length > 0) {
                    await chrome.tabs.group({ groupId, tabIds });
                }

            } catch (error) {
                console.warn('[批量手动选择器] 组不存在，在窗口中创建新标签组:', error);
                // 在窗口中创建新标签和组
                for (const url of urls) {
                    const tab = await chrome.tabs.create({ url, windowId, active: false });
                    tabIds.push(tab.id);
                }
                if (tabIds.length > 0 && chrome.tabs.group) {
                    const newGroupId = await chrome.tabs.group({ tabIds });
                    if (chrome.tabGroups) {
                        await chrome.tabGroups.update(newGroupId, {
                            title: lang === 'zh_CN' ? `批量打开 (${urls.length})` : `Batch (${urls.length})`,
                            collapsed: false
                        });
                    }
                }
            }
        }
        // 情况2: 仅窗口
        else if (windowId) {
            for (const url of urls) {
                await chrome.tabs.create({ url, windowId, active: false });
            }
        }
        // 情况3: 仅组
        else if (groupId) {
            try {
                const group = await chrome.tabGroups.get(groupId);
                for (const url of urls) {
                    const tab = await chrome.tabs.create({ url, windowId: group.windowId, active: false });
                    tabIds.push(tab.id);
                }
                if (tabIds.length > 0) {
                    await chrome.tabs.group({ groupId, tabIds });
                }
            } catch (error) {
                console.warn('[批量手动选择器] 组不存在，在新标签中打开:', error);
                for (const url of urls) {
                    await chrome.tabs.create({ url, active: false });
                }
            }
        }
        // 情况4: 都不选（新标签页）
        else {
            for (const url of urls) {
                await chrome.tabs.create({ url, active: false });
            }
        }

        console.log('[批量手动选择器] 已打开:', urls.length, '个书签');

    } catch (error) {
        console.error('[批量手动选择器] 打开书签失败:', error);
        alert(lang === 'zh_CN' ? `打开失败: ${error.message}` : `Failed to open: ${error.message}`);
    }
}

// 批量剪切
async function batchCut() {
    const permanentIds = getSelectedPermanentNodeIds();
    if (!permanentIds.length) {
        await batchCutTemp();
        return;
    }
    try {
        const payload = [];
        for (const nodeId of permanentIds) {
            const nodes = await chrome.bookmarks.getSubTree(nodeId);
            if (nodes && nodes[0]) {
                payload.push(serializeBookmarkNode(nodes[0]));
            }
        }
        bookmarkClipboard = {
            action: 'cut',
            source: 'permanent',
            nodeIds: permanentIds,
            payload,
            timestamp: Date.now()
        };
        clipboardOperation = 'cut';
        unmarkCutNode();
        permanentIds.forEach(id => markCutNode(id));
        showPasteButton();
        console.log('[批量] 剪切节点:', permanentIds.length);
    } catch (error) {
        console.error('[批量] 剪切失败:', error);
    }
}

// 批量删除
async function batchDelete() {
    if (!chrome || !chrome.bookmarks) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    const lang = currentLang || 'zh_CN';
    const permanentIds = getSelectedPermanentNodeIds();
    if (!permanentIds.length) {
        await batchDeleteTemp();
        return;
    }
    const count = permanentIds.length;

    // 二次确认
    const message = lang === 'zh_CN'
        ? `确定要删除选中的 ${count} 项吗？此操作不可撤销！`
        : `Delete ${count} selected items? This cannot be undone!`;

    if (!confirm(message)) return;

    try {
        let successCount = 0;
        let failCount = 0;
        const affectedParentIds = new Set(); // 记录受影响的父文件夹ID

        // 先收集所有要删除的节点的父ID
        for (const nodeId of permanentIds) {
            try {
                const [node] = await chrome.bookmarks.get(nodeId);
                if (node.parentId) {
                    affectedParentIds.add(node.parentId);
                }
            } catch (error) {
                console.error('[批量] 获取节点信息失败:', nodeId, error);
            }
        }

        // 执行删除
        for (const nodeId of permanentIds) {
            try {
                const [node] = await chrome.bookmarks.get(nodeId);
                if (node.url) {
                    await chrome.bookmarks.remove(nodeId);
                } else {
                    await chrome.bookmarks.removeTree(nodeId);
                }
                successCount++;
            } catch (error) {
                console.error('[批量] 删除失败:', nodeId, error);
                failCount++;
            }
        }

        // 先清空选择状态（重要：避免残留蓝色标记）
        deselectAll();
        updateBatchToolbar();

        // 存储受影响的父文件夹列表到临时存储，供比较算法使用
        if (affectedParentIds.size > 0) {
            await chrome.storage.local.set({
                tempDeletedParents: Array.from(affectedParentIds),
                tempDeleteTimestamp: Date.now()
            });
            console.log('[批量删除] 已记录受影响的父文件夹:', Array.from(affectedParentIds));
        }

        // 不调用 refreshBookmarkTree()，让 onRemoved 事件触发增量更新
        // 增量更新会添加删除标记，用户可以通过"清理变动标识"功能来清除

        // 清除临时标记（延迟清除，给渲染留出更长时间，从1秒增加到5秒）
        setTimeout(async () => {
            await chrome.storage.local.remove(['tempDeletedParents', 'tempDeleteTimestamp']);
            console.log('[批量删除] 已清除临时标记');
        }, 5000);

        const result = lang === 'zh_CN'
            ? `已删除 ${successCount} 项${failCount > 0 ? `，失败 ${failCount} 项` : ''}`
            : `Deleted ${successCount} items${failCount > 0 ? `, failed ${failCount}` : ''}`;

        alert(result);
        console.log('[批量] 删除完成:', { successCount, failCount });

    } catch (error) {
        console.error('[批量] 删除失败:', error);
        alert(lang === 'zh_CN' ? `删除失败: ${error.message}` : `Delete failed: ${error.message}`);
    }
}

// 批量重命名
async function batchRename() {
    const lang = currentLang || 'zh_CN';
    const permanentIds = getSelectedPermanentNodeIds();
    if (!permanentIds.length) {
        await batchRenameTemp();
        return;
    }

    const prefix = prompt(
        lang === 'zh_CN' ? '请输入统一前缀（可选）:' : 'Enter prefix (optional):',
        ''
    );

    const suffix = prompt(
        lang === 'zh_CN' ? '请输入统一后缀（可选）:' : 'Enter suffix (optional):',
        ''
    );

    if (prefix === null && suffix === null) return;

    if (!chrome || !chrome.bookmarks) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    try {
        let count = 0;
        for (const nodeId of permanentIds) {
            const [node] = await chrome.bookmarks.get(nodeId);
            const newTitle = `${prefix || ''}${node.title}${suffix || ''}`;
            await chrome.bookmarks.update(nodeId, { title: newTitle });
            count++;
        }

        // 不调用 refreshBookmarkTree()，让 onChanged 事件触发增量更新
        alert(lang === 'zh_CN' ? `已重命名 ${count} 项` : `Renamed ${count} items`);
        console.log('[批量] 重命名完成:', count);

    } catch (error) {
        console.error('[批量] 重命名失败:', error);
        alert(lang === 'zh_CN' ? `重命名失败: ${error.message}` : `Rename failed: ${error.message}`);
    }
}

// 导出为HTML
async function batchExportHTML() {
    if (!chrome || !chrome.bookmarks) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    const lang = currentLang || 'zh_CN';

    try {
        let html = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n';
        html += '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n';
        html += '<TITLE>Bookmarks</TITLE>\n';
        html += '<H1>Bookmarks</H1>\n';
        html += '<DL><p>\n';

        for (const nodeId of selectedNodes) {
            const [node] = await chrome.bookmarks.get(nodeId);
            if (node.url) {
                html += `    <DT><A HREF="${node.url}">${node.title}</A>\n`;
            } else {
                html += `    <DT><H3>${node.title}</H3>\n`;
                html += `    <DL><p>\n`;
                // 递归获取子项
                const children = await chrome.bookmarks.getChildren(nodeId);
                for (const child of children) {
                    if (child.url) {
                        html += `        <DT><A HREF="${child.url}">${child.title}</A>\n`;
                    }
                }
                html += `    </DL><p>\n`;
            }
        }

        html += '</DL><p>\n';

        // 下载文件
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'bookmarks.html';
        a.click();
        URL.revokeObjectURL(url);

        alert(lang === 'zh_CN' ? '导出成功！' : 'Export successful!');
        console.log('[批量] 导出HTML完成');

    } catch (error) {
        console.error('[批量] 导出HTML失败:', error);
        alert(lang === 'zh_CN' ? `导出失败: ${error.message}` : `Export failed: ${error.message}`);
    }
}

// 导出为JSON
async function batchExportJSON() {
    if (!chrome || !chrome.bookmarks) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    const lang = currentLang || 'zh_CN';

    try {
        const bookmarks = [];

        for (const nodeId of selectedNodes) {
            const [node] = await chrome.bookmarks.get(nodeId);
            const bookmark = {
                id: node.id,
                title: node.title,
                url: node.url || null,
                dateAdded: node.dateAdded,
                dateGroupModified: node.dateGroupModified
            };

            if (!node.url) {
                // 如果是文件夹，获取子项
                const children = await chrome.bookmarks.getChildren(nodeId);
                bookmark.children = children.map(child => ({
                    id: child.id,
                    title: child.title,
                    url: child.url || null
                }));
            }

            bookmarks.push(bookmark);
        }

        const json = JSON.stringify(bookmarks, null, 2);

        // 下载文件
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'bookmarks.json';
        a.click();
        URL.revokeObjectURL(url);

        alert(lang === 'zh_CN' ? '导出成功！' : 'Export successful!');
        console.log('[批量] 导出JSON完成');

    } catch (error) {
        console.error('[批量] 导出JSON失败:', error);
        alert(lang === 'zh_CN' ? `导出失败: ${error.message}` : `Export failed: ${error.message}`);
    }
}

// 合并为新文件夹
async function batchMergeFolder() {
    if (!chrome || !chrome.bookmarks) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    const lang = currentLang || 'zh_CN';

    const folderName = prompt(
        lang === 'zh_CN' ? '请输入新文件夹名称:' : 'Enter new folder name:',
        lang === 'zh_CN' ? '合并的文件夹' : 'Merged Folder'
    );

    if (!folderName) return;

    try {
        // 创建新文件夹（默认在根目录的"其他书签"中）
        const bookmarkBar = (await chrome.bookmarks.getTree())[0].children.find(n => n.id === '1');
        const newFolder = await chrome.bookmarks.create({
            parentId: bookmarkBar.id,
            title: folderName
        });

        // 移动所有选中项到新文件夹
        let count = 0;
        for (const nodeId of selectedNodes) {
            try {
                await chrome.bookmarks.move(nodeId, { parentId: newFolder.id });
                count++;
            } catch (error) {
                console.error('[批量] 移动失败:', nodeId, error);
            }
        }

        deselectAll();
        updateBatchToolbar();
        // 不调用 refreshBookmarkTree()，让 onCreated/onMoved 事件触发增量更新

        alert(lang === 'zh_CN' ? `已将 ${count} 项合并到新文件夹` : `Merged ${count} items to new folder`);
        console.log('[批量] 合并完成:', count);

    } catch (error) {
        console.error('[批量] 合并失败:', error);
        alert(lang === 'zh_CN' ? `合并失败: ${error.message}` : `Merge failed: ${error.message}`);
    }
}

// ==================== 顶部批量操作工具栏 ====================

// 初始化批量操作工具栏
function initBatchToolbar() {
    // 查找书签树视图的标题
    const pageTitle = document.querySelector('#treeViewTitle') ||
        document.querySelector('#treeView h2') ||
        document.querySelector('h2');
    if (!pageTitle) {
        console.warn('[批量工具栏] 未找到页面标题');
        return;
    }

    console.log('[批量工具栏] 找到标题:', pageTitle.textContent);

    // 创建工具栏容器（在标题同一行）
    const titleContainer = pageTitle.parentElement;
    titleContainer.style.display = 'flex';
    titleContainer.style.alignItems = 'center';
    titleContainer.style.gap = '20px';
    titleContainer.style.flexWrap = 'wrap';

    // 创建工具栏
    const toolbar = document.createElement('div');
    toolbar.id = 'batch-toolbar';
    toolbar.className = 'batch-toolbar';
    toolbar.style.display = 'none';
    const lang = currentLang || 'zh_CN';
    toolbar.innerHTML = `
        <span class="selected-count">已选中 0 项</span>
        <button class="batch-btn" data-action="show-batch-panel" title="${lang === 'zh_CN' ? '显示悬浮窗菜单' : 'Show Floating Panel'}">
            <i class="fas fa-window-restore"></i> ${lang === 'zh_CN' ? '悬浮窗' : 'Float'}
        </button>
        <button class="batch-btn" data-action="batch-open"><i class="fas fa-folder-open"></i> 打开</button>
        <button class="batch-btn" data-action="batch-open-tab-group"><i class="fas fa-object-group"></i> 标签组</button>
        <button class="batch-btn" data-action="batch-cut"><i class="fas fa-cut"></i> 剪切</button>
        <button class="batch-btn" data-action="batch-delete"><i class="fas fa-trash-alt"></i> 删除</button>
        <button class="batch-btn" data-action="batch-rename"><i class="fas fa-edit"></i> 重命名</button>
        <button class="batch-btn" data-action="batch-export-html"><i class="fas fa-file-code"></i> HTML</button>
        <button class="batch-btn" data-action="batch-export-json"><i class="fas fa-file-alt"></i> JSON</button>
        <button class="batch-btn" data-action="batch-merge-folder"><i class="fas fa-folder-plus"></i> 合并</button>
        <button class="batch-btn exit-select-btn" data-action="exit-select-mode"><i class="fas fa-times"></i> 退出</button>
    `;

    // 插入到标题旁边
    titleContainer.appendChild(toolbar);

    // 绑定按钮事件
    toolbar.querySelectorAll('.batch-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const action = btn.dataset.action;
            if (action === 'exit-select-mode') {
                exitSelectMode();
            } else if (action === 'show-batch-panel') {
                showBatchPanel();
            } else {
                await handleMenuAction(action, null, null, null, false);
            }
        });
    });

    console.log('[批量工具栏] 初始化完成');
}

// 更新批量操作工具栏
function updateBatchToolbar() {
    const toolbar = document.getElementById('batch-toolbar');
    if (!toolbar) {
        console.warn('[批量工具栏] 未找到工具栏元素');
        return;
    }

    const lang = currentLang || 'zh_CN';
    const count = selectedNodes.size;

    console.log('[批量工具栏] 更新:', { selectMode, count });

    // 在Select模式下，默认不显示工具栏（显示批量菜单）
    // 除非用户点击了"隐藏批量菜单"按钮
    // 如果不在Select模式，也隐藏
    if (!selectMode) {
        toolbar.style.display = 'none';
        console.log('[批量工具栏] 已隐藏（非Select模式）');
        return;
    }

    // 更新计数文本
    const countText = lang === 'zh_CN' ? `已选中 ${count} 项` : `${count} Selected`;
    const countElement = toolbar.querySelector('.selected-count');
    if (countElement) {
        countElement.textContent = countText;
    }

    console.log('[批量工具栏] 已更新计数:', countText);
}

// ==================== 快捷键支持 ====================

// 初始化快捷键
function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // ESC - 退出Select模式
        if (e.key === 'Escape' && selectMode) {
            exitSelectMode();
            return;
        }

        // 只在Select模式下响应其他快捷键
        if (!selectMode) return;

        // Ctrl/Cmd + A - 全选
        if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
            e.preventDefault();
            selectAll();
        }
    });

    console.log('[快捷键] 初始化完成');
}

// 初始化点击选择 - 现在改为在overlay上处理，不需要这个函数了
function initClickSelect() {
    console.log('[点击选择] 初始化完成（点击事件现在在overlay上处理）');
}

// 更新批量面板的选择计数
function updateBatchPanelCount() {
    const batchPanel = document.getElementById('batch-action-panel');
    if (!batchPanel) return;

    const countElement = batchPanel.querySelector('#batch-panel-count');
    if (!countElement) return;

    const lang = currentLang || 'zh_CN';
    const count = selectedNodes.size;
    countElement.textContent = `${count} ${lang === 'zh_CN' ? '项已选' : 'selected'}`;

    console.log('[批量面板] 更新计数:', count);
}

// 初始化批量面板的拖拽移动功能
function initBatchPanelDrag(panel) {
    const header = panel.querySelector('#batch-panel-header');
    if (!header) return;

    let dragState = null;
    let rafId = null;

    const shouldIgnoreTarget = (target) => {
        if (!target) return false;
        return target.closest('.batch-panel-exit-btn') ||
            target.closest('.context-menu-item') ||
            target.closest('button') ||
            target.closest('a') ||
            target.closest('input') ||
            target.closest('.resize-handle');
    };

    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

    header.style.cursor = 'grab';
    header.style.touchAction = 'none';

    const applyDragPosition = () => {
        if (!dragState) return;
        rafId = null;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const panelWidth = panel.offsetWidth || 280;
        const panelHeight = panel.offsetHeight || 200;
        const margin = 8;
        const maxLeft = viewportWidth - panelWidth - margin;
        const maxTop = viewportHeight - panelHeight - margin;
        const newLeft = clamp(dragState.pendingLeft, margin, Math.max(margin, maxLeft));
        const newTop = clamp(dragState.pendingTop, margin, Math.max(margin, maxTop));
        panel.style.left = `${newLeft}px`;
        panel.style.top = `${newTop}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
    };

    const scheduleUpdate = () => {
        if (rafId !== null) return;
        rafId = requestAnimationFrame(applyDragPosition);
    };

    const finishDrag = () => {
        if (!dragState) return;
        try {
            header.releasePointerCapture(dragState.pointerId);
        } catch (_) {
            // ignore
        }
        header.style.cursor = 'grab';
        if (dragState.previousBaseTransform !== undefined) {
            applyBatchPanelTransform(panel, { baseTransform: dragState.previousBaseTransform });
        }
        panel.dataset.manualPosition = 'true';
        saveBatchPanelState(panel, currentBatchPanelAnchorInfo);
        dragState = null;
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        console.log('[批量面板] 拖动完成');
    };

    header.addEventListener('pointerdown', (e) => {
        if (shouldIgnoreTarget(e.target)) return;
        const rect = panel.getBoundingClientRect();
        dragState = {
            pointerId: e.pointerId,
            offsetX: e.clientX - rect.left,
            offsetY: e.clientY - rect.top,
            pendingLeft: rect.left,
            pendingTop: rect.top,
            previousBaseTransform: panel.dataset.baseTransform || 'none'
        };
        applyBatchPanelTransform(panel, { baseTransform: 'none' });
        panel.style.left = `${rect.left}px`;
        panel.style.top = `${rect.top}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';

        try {
            header.setPointerCapture(e.pointerId);
        } catch (_) {
            // ignore capture failures
        }

        header.style.cursor = 'grabbing';
        applyDragPosition();
        e.preventDefault();
        console.log('[批量面板] 开始拖动');
    });

    header.addEventListener('pointermove', (e) => {
        if (!dragState || e.pointerId !== dragState.pointerId) return;
        dragState.pendingLeft = e.clientX - dragState.offsetX;
        dragState.pendingTop = e.clientY - dragState.offsetY;
        scheduleUpdate();
    });

    const onPointerUp = (e) => {
        if (!dragState || e.pointerId !== dragState.pointerId) return;
        finishDrag();
    };

    header.addEventListener('pointerup', onPointerUp);
    header.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('pointerup', onPointerUp);

    console.log('[批量面板] 拖拽移动功能已初始化');
}

// 根据高度更新tall-layout类（横向布局专用）
function updateTallLayoutClass(panel, height) {
    const threshold = 200; // 高度阈值：200px

    if (height >= threshold) {
        if (!panel.classList.contains('tall-layout')) {
            panel.classList.add('tall-layout');
            console.log('[批量面板] 高度>=200px，切换到纵向单列布局');
        }
    } else {
        if (panel.classList.contains('tall-layout')) {
            panel.classList.remove('tall-layout');
            console.log('[批量面板] 高度<200px，切换到横向多列布局');
        }
    }
}

// 初始化批量面板的调整大小功能（四边和四角）
function initBatchPanelResize(panel) {
    const handles = panel.querySelectorAll('.resize-handle');
    if (handles.length === 0) return;

    let isResizing = false;
    let startX, startY, startWidth, startHeight, startLeft, startTop;
    let direction = '';

    handles.forEach(handle => {
        handle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;

            const rect = panel.getBoundingClientRect();
            startWidth = rect.width;
            startHeight = rect.height;
            startLeft = rect.left;
            startTop = rect.top;

            direction = handle.dataset.direction;

            // 防止文字选中
            e.preventDefault();
            e.stopPropagation();

            console.log('[批量面板] 开始调整大小:', direction);
        });
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        const isVertical = panel.classList.contains('vertical-batch-layout');
        const minWidth = isVertical ? 200 : 800;
        const maxWidth = isVertical ? 500 : Math.min((window.innerWidth || 1920) * 0.95, 2000);
        const minHeight = isVertical ? 200 : 10;
        const maxHeight = (window.innerHeight || 1080) * 0.8;

        let newWidth = startWidth;
        let newHeight = startHeight;
        let newLeft = startLeft;
        let newTop = startTop;

        // 根据方向调整
        if (direction.includes('e')) {
            newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + deltaX));
        }
        if (direction.includes('w')) {
            newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth - deltaX));
            newLeft = startLeft + (startWidth - newWidth);
        }
        if (direction.includes('s')) {
            newHeight = Math.min(maxHeight, Math.max(minHeight, startHeight + deltaY));
        }
        if (direction.includes('n')) {
            newHeight = Math.min(maxHeight, Math.max(minHeight, startHeight - deltaY));
            newTop = startTop + (startHeight - newHeight);
        }

        panel.style.width = newWidth + 'px';
        panel.style.height = newHeight + 'px';  // 始终设置高度为计算值，实现无极调整

        // 根据高度动态切换横向/纵向布局（只对横向布局生效）
        if (!isVertical) {
            updateTallLayoutClass(panel, newHeight);
        }

        if (direction.includes('w')) {
            panel.style.left = newLeft + 'px';
            panel.style.right = 'auto';
        }
        if (direction.includes('n')) {
            panel.style.top = newTop + 'px';
            panel.style.bottom = 'auto';
        }
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            // 最终确认布局类型
            const isVertical = panel.classList.contains('vertical-batch-layout');
            if (!isVertical) {
                const currentHeight = parseFloat(panel.style.height) || panel.offsetHeight;
                updateTallLayoutClass(panel, currentHeight);
            }

            // 保存大小
            saveBatchPanelState(panel);
            console.log('[批量面板] 调整大小完成，当前高度:', panel.style.height);
        }
    });

    console.log('[批量面板] 四边四角调整大小功能已初始化');
}

// 初始化窗口大小变化监听器（横向布局自适应）
function initBatchPanelWindowResize(panel) {
    let resizeTimer;
    window.addEventListener('resize', () => {
        // 使用防抖，避免频繁触发
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            const batchPanel = document.getElementById('batch-action-panel');
            if (!batchPanel) return;

            // 只在横向布局时自动调整宽度
            if (batchPanel.classList.contains('horizontal-batch-layout')) {
                const viewportWidth = window.innerWidth;
                const maxPanelWidth = Math.min(viewportWidth * 0.95, 2000);
                const currentWidth = parseFloat(batchPanel.style.width) || 1000;
                if (currentWidth > maxPanelWidth) {
                    batchPanel.style.width = `${maxPanelWidth}px`;
                    console.log('[批量面板] 窗口缩小，自动调整宽度:', maxPanelWidth);
                }
                batchPanel.style.left = '50%';
                applyBatchPanelTransform(batchPanel, { baseTransform: 'translateX(-50%)' });
            }
        }, 200); // 防抖延迟200ms
    });

    console.log('[批量面板] 窗口大小变化监听器已初始化');
}

// 切换批量面板布局（横向/纵向）
let batchPanelHorizontal = false; // 默认纵向
function toggleBatchPanelLayout() {
    const batchPanel = document.getElementById('batch-action-panel');
    if (!batchPanel) return;

    batchPanelHorizontal = !batchPanelHorizontal;

    if (batchPanelHorizontal) {
        batchPanel.classList.add('horizontal-batch-layout');
        batchPanel.classList.remove('vertical-batch-layout');

        // 根据当前窗口大小计算合适的宽度
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const maxPanelWidthScreen = Math.min(viewportWidth * 0.95, 2000);
        const defaultWidthScreen = Math.min(1000, maxPanelWidthScreen);

        // 恢复横向布局的默认样式
        batchPanel.style.width = `${defaultWidthScreen}px`;
        batchPanel.style.height = 'auto'; // 初始高度自适应，之后可无极调整
        batchPanel.style.minWidth = '800px';
        batchPanel.style.maxWidth = `${maxPanelWidthScreen}px`;
        batchPanel.style.minHeight = '10px';
        batchPanel.style.maxHeight = `${(viewportHeight || 1080) * 0.8}px`;
        batchPanel.style.left = '50%';
        batchPanel.style.right = 'auto';
        batchPanel.style.bottom = '80px';
        batchPanel.style.top = 'auto';
        applyBatchPanelTransform(batchPanel, { baseTransform: 'translateX(-50%)' });

        console.log('[批量面板] 横向布局宽度自适应:', { viewportWidth, defaultWidth: defaultWidthScreen, maxPanelWidth: maxPanelWidthScreen });

        // 延迟检查高度并设置tall-layout类
        setTimeout(() => {
            const currentHeight = batchPanel.offsetHeight || 0;
            updateTallLayoutClass(batchPanel, currentHeight);
            fitBatchPanelToContent(batchPanel, { delay: 0, retries: 2 });
        }, 50);
        fitBatchPanelToContent(batchPanel, { delay: 0, retries: 2 });

        console.log('[批量面板] 切换到横向布局');
        // 更新按钮文字
        const btn = batchPanel.querySelector('[data-action="toggle-batch-layout"] span');
        if (btn) {
            const lang = currentLang || 'zh_CN';
            btn.textContent = lang === 'zh_CN' ? '纵向' : 'Vert';
        }
    } else {
        batchPanel.classList.remove('horizontal-batch-layout');
        batchPanel.classList.add('vertical-batch-layout');
        batchPanel.classList.remove('tall-layout'); // 纵向布局不需要tall-layout

        // 设置纵向布局的默认样式
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth || 1920;
        const margin = 16;
        const availableWidth = Math.max(200, viewportWidth - margin * 2);
        const minWidthPx = Math.max(240, Math.min(320, availableWidth));
        const maxWidthPx = Math.max(minWidthPx, Math.min(640, viewportWidth * 0.6));
        const targetWidth = Math.min(Math.max(minWidthPx, parseFloat(batchPanel.style.width) || 320), maxWidthPx);
        batchPanel.style.width = `${targetWidth}px`;
        batchPanel.style.height = 'auto'; // 初始高度自适应，之后可无极调整
        batchPanel.style.minWidth = `${minWidthPx}px`;
        batchPanel.style.maxWidth = `${maxWidthPx}px`;
        batchPanel.style.minHeight = '200px';
        batchPanel.style.maxHeight = `${(viewportHeight || 1080) * 0.8}px`;
        batchPanel.style.left = 'auto';
        batchPanel.style.right = '20px';
        batchPanel.style.bottom = '80px';
        batchPanel.style.top = 'auto';
        applyBatchPanelTransform(batchPanel, { baseTransform: 'none' });

        console.log('[批量面板] 切换到纵向布局');
        // 更新按钮文字
        const btn = batchPanel.querySelector('[data-action="toggle-batch-layout"] span');
        if (btn) {
            const lang = currentLang || 'zh_CN';
            btn.textContent = lang === 'zh_CN' ? '横向' : 'Horiz';
        }
        fitBatchPanelToContent(batchPanel, { delay: 0, retries: 2 });
    }

    // 保存状态
    try {
        localStorage.setItem('batchPanelLayout', batchPanelHorizontal ? 'horizontal' : 'vertical');
        // 保存当前位置和大小
        saveBatchPanelState(batchPanel);
    } catch (e) {
        console.error('[批量面板] 保存布局状态失败:', e);
    }
}

// 保存批量面板的位置和大小
function saveBatchPanelState(panel, anchorInfo) {
    try {
        if (!panel) return;
        const info = anchorInfo || currentBatchPanelAnchorInfo || getBatchPanelAnchorInfoFromSelection();
        const inferredKey = getBatchPanelAnchorKey(info);
        const anchorKey = panel.dataset.anchorKey || inferredKey;
        if (!anchorKey) return;
        const anchorRect = info && info.element && typeof info.element.getBoundingClientRect === 'function'
            ? info.element.getBoundingClientRect()
            : null;
        const currentZoom = getCurrentBatchPanelZoom();

        const isVertical = panel.classList.contains('vertical-batch-layout');
        const isVisible = panel && panel.style.display !== 'none';
        const state = {
            left: panel.style.left,
            top: panel.style.top,
            bottom: panel.style.bottom,
            right: panel.style.right,
            width: panel.style.width,
            height: panel.style.height,
            transform: panel.style.transform,
            layout: isVertical ? 'vertical' : 'horizontal',
            visible: isVisible,
            treeType: (info && info.treeType) || panel.dataset.treeType || 'permanent',
            sectionId: (info && info.sectionId) || panel.dataset.sectionId || null,
            anchorKey,
            baseTransform: panel.dataset.baseTransform || (isVertical ? 'none' : 'translateX(-50%)'),
            manualPosition: panel.dataset.manualPosition === 'true',
            zoom: currentZoom,
            anchorRect: anchorRect ? {
                left: anchorRect.left,
                top: anchorRect.top,
                width: anchorRect.width,
                height: anchorRect.height,
                right: anchorRect.right,
                bottom: anchorRect.bottom
            } : null
        };

        const stateMapRaw = localStorage.getItem(BATCH_PANEL_STATE_MAP_KEY);
        const stateMap = stateMapRaw ? JSON.parse(stateMapRaw) : {};
        stateMap[anchorKey] = state;
        localStorage.setItem(BATCH_PANEL_STATE_MAP_KEY, JSON.stringify(stateMap));
        localStorage.setItem(BATCH_PANEL_LEGACY_KEY, JSON.stringify(state));
        console.log('[批量面板] 状态已保存:', anchorKey, state);
    } catch (e) {
        console.error('[批量面板] 保存状态失败:', e);
    }
}

// 恢复批量面板的位置和大小
function restoreBatchPanelState(panel, anchorInfo) {
    try {
        if (!panel) return;
        const info = anchorInfo || currentBatchPanelAnchorInfo || getBatchPanelAnchorInfoFromSelection();
        if (!info) {
            console.warn('[批量面板] 缺少定位信息，维持默认位置');
            return;
        }

        const resolvedElement = info.element || findBatchPanelColumnElement(info.treeType, info.sectionId);
        const anchorKey = getBatchPanelAnchorKey({ treeType: info.treeType, sectionId: info.sectionId });

        currentBatchPanelAnchorInfo = {
            treeType: info.treeType || 'permanent',
            sectionId: info.sectionId || (info.treeType === 'permanent' ? PERMANENT_SECTION_ANCHOR_ID : null),
            element: resolvedElement
        };

        panel.dataset.anchorKey = anchorKey;
        panel.dataset.treeType = currentBatchPanelAnchorInfo.treeType;
        if (currentBatchPanelAnchorInfo.sectionId) {
            panel.dataset.sectionId = currentBatchPanelAnchorInfo.sectionId;
        } else {
            delete panel.dataset.sectionId;
        }

        panel.style.position = 'fixed';
        const margin = 16;

        const anchorRect = resolvedElement && typeof resolvedElement.getBoundingClientRect === 'function'
            ? resolvedElement.getBoundingClientRect()
            : null;
        const viewportWidth = window.innerWidth || 1920;
        const viewportHeight = window.innerHeight || 1080;
        const currentZoom = getCurrentBatchPanelZoom();
        const sizing = computeBatchPanelSizing(anchorRect, currentZoom, viewportWidth, viewportHeight, margin);
        const {
            minWidth,
            maxWidth,
            minHeight,
            maxHeight,
            defaultWidth,
            defaultHeight,
            gap,
            normalizedZoom
        } = sizing;
        panel.dataset.anchorZoom = String(normalizedZoom);

        const computeAnchorAlignedPosition = (rect, panelWidth, panelHeight) => {
            let left = clampValue(viewportWidth - panelWidth - margin, margin, viewportWidth - panelWidth - margin);
            let top = clampValue(margin, margin, viewportHeight - panelHeight - margin);
            if (!rect) {
                return { left, top };
            }
            const spaceOnRight = viewportWidth - rect.right - margin;
            const spaceOnLeft = rect.left - margin;
            if (spaceOnRight >= panelWidth + gap || spaceOnRight >= spaceOnLeft) {
                left = clampValue(rect.right + gap, margin, viewportWidth - panelWidth - margin);
            } else if (spaceOnLeft >= panelWidth + gap) {
                left = clampValue(rect.left - gap - panelWidth, margin, viewportWidth - panelWidth - margin);
            } else {
                left = clampValue(rect.right + gap, margin, viewportWidth - panelWidth - margin);
            }
            const idealTop = rect.top;
            top = clampValue(idealTop, margin, viewportHeight - panelHeight - margin);
            return { left, top };
        };

        const deriveManualCoordinate = (primary, secondary, viewportSize, panelSize) => {
            if (primary && primary !== 'auto') {
                const numeric = parseFloat(primary);
                if (Number.isFinite(numeric)) {
                    return clampValue(numeric, margin, viewportSize - panelSize - margin);
                }
            }
            if (secondary && secondary !== 'auto') {
                const numeric = parseFloat(secondary);
                if (Number.isFinite(numeric)) {
                    const inferred = viewportSize - panelSize - numeric;
                    return clampValue(inferred, margin, viewportSize - panelSize - margin);
                }
            }
            return null;
        };

        let state = null;
        const stateMapRaw = localStorage.getItem(BATCH_PANEL_STATE_MAP_KEY);
        if (stateMapRaw) {
            try {
                const stateMap = JSON.parse(stateMapRaw);
                state = stateMap ? stateMap[anchorKey] : null;
            } catch (err) {
                console.warn('[批量面板] 状态映射解析失败，忽略:', err);
            }
        }

        if (!state) {
            const legacyRaw = localStorage.getItem(BATCH_PANEL_LEGACY_KEY);
            if (legacyRaw) {
                try {
                    const legacyState = JSON.parse(legacyRaw);
                    if (!legacyState.anchorKey || legacyState.anchorKey === anchorKey) {
                        state = legacyState;
                    }
                } catch (err) {
                    console.warn('[批量面板] 兼容状态解析失败，忽略:', err);
                }
            }
        }

        if (state) {
            console.log('[批量面板] 恢复状态:', anchorKey, state);
            const storedWidth = parseFloat(state.width);
            const storedHeight = parseFloat(state.height);
            const storedBaseTransform = state.baseTransform
                || (state.transform && state.transform.includes('translateX(-50%)') ? 'translateX(-50%)' : 'none');
            const storedZoom = Number.isFinite(state.zoom) && state.zoom > 0 ? clampValue(state.zoom, 0.2, 3) : normalizedZoom;
            const zoomDelta = Math.abs(normalizedZoom - storedZoom);
            const zoomRatio = storedZoom > 0 ? normalizedZoom / storedZoom : 1;
            const storedManual = state.manualPosition === true;
            const previousAnchorRect = state.anchorRect || null;
            const anchorShift = anchorRect && previousAnchorRect
                ? Math.hypot(
                    (anchorRect.left || 0) - (previousAnchorRect.left || 0),
                    (anchorRect.top || 0) - (previousAnchorRect.top || 0)
                )
                : 0;
            const sizeShift = anchorRect && previousAnchorRect
                ? Math.abs((anchorRect.width || 0) - (previousAnchorRect.width || 0))
                : 0;
            const shouldSnapToAnchor = !storedManual || zoomDelta > 0.05 || sizeShift > 24 || anchorShift > 48 || !anchorRect;

            if (state.layout === 'vertical') {
                batchPanelHorizontal = false;
                panel.classList.remove('horizontal-batch-layout', 'tall-layout');
                panel.classList.add('vertical-batch-layout');
                let widthCandidate = Number.isFinite(storedWidth) ? storedWidth * zoomRatio : defaultWidth;
                let heightCandidate = Number.isFinite(storedHeight) ? storedHeight * zoomRatio : defaultHeight;
                if (shouldSnapToAnchor) {
                    widthCandidate = defaultWidth;
                    heightCandidate = defaultHeight;
                }
                const widthValue = clampValue(widthCandidate, minWidth, maxWidth);
                const heightValue = Number.isFinite(heightCandidate)
                    ? clampValue(heightCandidate, minHeight, maxHeight)
                    : null;
                panel.style.width = `${widthValue}px`;
                panel.style.minWidth = `${minWidth}px`;
                panel.style.maxWidth = `${maxWidth}px`;
                panel.style.minHeight = `${minHeight}px`;
                panel.style.maxHeight = `${maxHeight}px`;
                if (!Number.isFinite(heightValue) || shouldSnapToAnchor || !storedManual) {
                    panel.style.height = 'auto';
                } else {
                    panel.style.height = `${heightValue}px`;
                }

                let left;
                let top;
                const alignHeight = Number.isFinite(heightValue) ? heightValue : minHeight;
                if (shouldSnapToAnchor) {
                    panel.dataset.manualPosition = 'false';
                    const aligned = computeAnchorAlignedPosition(anchorRect, widthValue, alignHeight);
                    left = aligned.left;
                    top = aligned.top;
                } else {
                    let usedManualPosition = storedManual;
                    left = deriveManualCoordinate(state.left, state.right, viewportWidth, widthValue);
                    top = deriveManualCoordinate(state.top, state.bottom, viewportHeight, alignHeight);
                    if (left === null || top === null) {
                        const fallback = computeAnchorAlignedPosition(anchorRect, widthValue, alignHeight);
                        if (left === null) left = fallback.left;
                        if (top === null) top = fallback.top;
                        usedManualPosition = false;
                    }
                    panel.dataset.manualPosition = usedManualPosition ? 'true' : 'false';
                }
                panel.style.left = `${left}px`;
                panel.style.top = `${top}px`;
                panel.style.right = 'auto';
                panel.style.bottom = 'auto';
                applyBatchPanelTransform(panel, { baseTransform: storedBaseTransform || 'none' });
            } else {
                batchPanelHorizontal = true;
                panel.classList.add('horizontal-batch-layout');
                panel.classList.remove('vertical-batch-layout');
                panel.dataset.manualPosition = storedManual ? 'true' : 'false';
                const ratioWidth = Number.isFinite(storedWidth) ? storedWidth * zoomRatio : parseFloat(state.width);
                const ratioHeight = Number.isFinite(storedHeight) ? storedHeight * zoomRatio : parseFloat(state.height);
                if (Number.isFinite(ratioWidth)) {
                    panel.style.width = `${ratioWidth.toFixed(2)}px`;
                } else {
                    panel.style.width = state.width || '1000px';
                }
                if (Number.isFinite(ratioHeight)) {
                    panel.style.height = `${ratioHeight.toFixed(2)}px`;
                } else {
                    panel.style.height = state.height || 'auto';
                }
                const horizontalMaxWidth = Math.min(viewportWidth * 0.95, 2000);
                panel.style.minWidth = '800px';
                panel.style.maxWidth = `${horizontalMaxWidth}px`;
                panel.style.minHeight = '150px';
                panel.style.maxHeight = `${viewportHeight * 0.8}px`;
                if (shouldSnapToAnchor) {
                    panel.style.left = '50%';
                    panel.style.right = 'auto';
                    panel.style.top = 'auto';
                    panel.style.bottom = '80px';
                    panel.dataset.manualPosition = 'false';
                } else {
                    panel.style.left = state.left || '50%';
                    panel.style.right = 'auto';
                    panel.style.top = state.top || 'auto';
                    panel.style.bottom = state.bottom || '80px';
                }
                applyBatchPanelTransform(panel, {
                    baseTransform: storedBaseTransform || 'translateX(-50%)'
                });
                if (panel.classList.contains('horizontal-batch-layout')) {
                    const currentHeight = parseFloat(panel.style.height) || panel.offsetHeight;
                    updateTallLayoutClass(panel, currentHeight);
                }
            }
            fitBatchPanelToContent(panel);
            return;
        }

        console.log('[批量面板] 没有保存的状态，使用默认定位');
        batchPanelHorizontal = false;
        panel.classList.remove('horizontal-batch-layout', 'tall-layout');
        panel.classList.add('vertical-batch-layout');
        panel.dataset.manualPosition = 'false';
        const widthValue = defaultWidth;
        const heightValue = defaultHeight;
        const alignHeight = Number.isFinite(heightValue) ? heightValue : minHeight;
        panel.style.width = `${widthValue}px`;
        panel.style.height = 'auto';
        panel.style.minWidth = `${minWidth}px`;
        panel.style.maxWidth = `${maxWidth}px`;
        panel.style.minHeight = `${minHeight}px`;
        panel.style.maxHeight = `${maxHeight}px`;
        const aligned = computeAnchorAlignedPosition(anchorRect, widthValue, alignHeight);
        panel.style.left = `${aligned.left}px`;
        panel.style.top = `${aligned.top}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        applyBatchPanelTransform(panel, { baseTransform: 'none' });

        console.log('[批量面板] 默认定位完成:', { left: aligned.left, top: aligned.top, anchorKey });
        fitBatchPanelToContent(panel, { delay: 0 });
    } catch (e) {
        console.error('[批量面板] 恢复状态失败:', e);
    }
}

// 隐藏批量面板，显示顶部工具栏
function hideBatchPanel() {
    const batchPanel = document.getElementById('batch-action-panel');
    if (batchPanel) {
        batchPanel.style.display = 'none';
        // 保存隐藏状态
        saveBatchPanelState(batchPanel);
    }

    // 显示顶部工具栏
    updateBatchToolbar();
    const toolbar = document.getElementById('batch-toolbar');
    if (toolbar) {
        toolbar.style.display = 'flex';
    }

    console.log('[批量面板] 已隐藏，显示顶部工具栏');
}

// 显示批量面板，隐藏顶部工具栏
function showBatchPanel() {
    const batchPanel = document.getElementById('batch-action-panel');

    // 如果面板不存在，创建它
    if (!batchPanel) {
        const fakeEvent = { preventDefault: () => { }, stopPropagation: () => { } };
        showBatchContextMenu(fakeEvent);
        console.log('[批量面板] 重新创建批量菜单');
    } else {
        // 如果面板已存在，直接显示
        batchPanel.style.display = 'block';
        const anchorInfo = getBatchPanelAnchorInfoFromSelection();
        if (anchorInfo) {
            currentBatchPanelAnchorInfo = anchorInfo;
            restoreBatchPanelState(batchPanel, anchorInfo);
        }
        console.log('[批量面板] 显示已有面板');
        // 保存显示状态
        saveBatchPanelState(batchPanel);
        fitBatchPanelToContent(batchPanel, { delay: 0 });
    }

    // 隐藏顶部工具栏
    const toolbar = document.getElementById('batch-toolbar');
    if (toolbar) {
        toolbar.style.display = 'none';
    }

    console.log('[批量面板] 已显示，隐藏顶部工具栏');
}

// 切换右键菜单布局（横向/纵向）
let contextMenuHorizontal = true;  // 默认横向（根据阈值自动，再可被用户覆盖）
function toggleContextMenuLayout() {
    const contextMenu = document.getElementById('bookmark-context-menu');
    if (!contextMenu) return;
    // 读作用域：permanent | temporary
    const scope = contextMenu.dataset.menuScope || 'permanent';
    contextMenuHorizontal = !contextMenuHorizontal;

    if (contextMenuHorizontal) {
        contextMenu.classList.add('horizontal-layout');
        console.log('[右键菜单] 切换到横向布局');
    } else {
        contextMenu.classList.remove('horizontal-layout');
        console.log('[右键菜单] 切换到纵向布局');
    }

    // 保存“按类型”的状态到localStorage
    try {
        localStorage.setItem(`contextMenuLayout_${scope}`, contextMenuHorizontal ? 'horizontal' : 'vertical');
    } catch (e) {
        console.error('[右键菜单] 保存布局状态失败:', e);
    }
}

// 恢复保存的右键菜单布局状态
function restoreContextMenuLayout() {
    try {
        const contextMenu = document.getElementById('bookmark-context-menu');
        if (!contextMenu) return;
        const scope = contextMenu.dataset.menuScope || 'permanent';
        const savedLayout = localStorage.getItem(`contextMenuLayout_${scope}`);
        if (savedLayout === 'vertical') {
            contextMenuHorizontal = false;
            contextMenu.classList.remove('horizontal-layout');
            console.log('[右键菜单] 恢复纵向布局（scope=', scope, ')');
        } else if (savedLayout === 'horizontal') {
            contextMenuHorizontal = true;
            contextMenu.classList.add('horizontal-layout');
            console.log('[右键菜单] 恢复横向布局（scope=', scope, ')');
        } else {
            // 未指定，保持当前（由自动阈值决定）
        }
    } catch (e) {
        console.error('[右键菜单] 恢复布局状态失败:', e);
    }
}

// 显示空白区域右键菜单
function showBlankAreaContextMenu(e, sectionId, treeType) {
    e.preventDefault();
    e.stopPropagation();

    const lang = currentLang || 'zh_CN';
    const menuItems = [];

    // 粘贴选项（如果剪贴板有内容）
    if (hasClipboard()) {
        menuItems.push({
            action: 'paste-blank',
            label: lang === 'zh_CN' ? '粘贴' : 'Paste',
            icon: 'paste',
            sectionId,
            treeType
        });
    }

    // 新建文件夹选项
    if (treeType === 'temporary') {
        menuItems.push({
            action: 'create-folder-blank',
            label: lang === 'zh_CN' ? '新建文件夹' : 'New Folder',
            icon: 'folder-plus',
            sectionId
        });
        menuItems.push({
            action: 'create-bookmark-blank',
            label: lang === 'zh_CN' ? '新建书签' : 'New Bookmark',
            icon: 'bookmark',
            sectionId
        });
    } else if (treeType === 'permanent') {
        // 永久栏目暂不支持在空白处创建，因为需要 parentId
        // 用户可以右键文件夹来创建
    }

    if (menuItems.length === 0) {
        return; // 没有可用的菜单项
    }

    // 渲染菜单
    const contextMenu = document.getElementById('bookmark-context-menu');
    if (!contextMenu) return;

    const menuHTML = menuItems.map(item => {
        const icon = item.icon ? `<i class="fas fa-${item.icon}"></i>` : '';
        return `
            <div class="context-menu-item" data-action="${item.action}" data-section-id="${item.sectionId || ''}" data-tree-type="${item.treeType || ''}">
                ${icon}
                <span>${item.label}</span>
            </div>
        `;
    }).join('');

    contextMenu.innerHTML = menuHTML;

    // 绑定点击事件
    contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', async (clickEvent) => {
            clickEvent.stopPropagation();
            const action = item.dataset.action;
            const sid = item.dataset.sectionId;
            const ttype = item.dataset.treeType;

            hideContextMenu();

            if (action === 'paste-blank') {
                if (ttype === 'temporary' && sid) {
                    await pasteIntoTemp({ sectionId: sid, parentId: null, index: null });
                } else if (ttype === 'permanent') {
                    // 粘贴到书签栏根目录
                    if (chrome && chrome.bookmarks) {
                        const tree = await chrome.bookmarks.getTree();
                        const bookmarkBar = tree[0].children.find(child => child.title === '书签栏' || child.id === '1');
                        if (bookmarkBar) {
                            await pasteBookmark(bookmarkBar.id, true); // true 表示是文件夹
                        }
                    }
                }
            } else if (action === 'create-folder-blank' && sid) {
                const manager = ensureTempManager();
                const title = prompt(lang === 'zh_CN' ? '文件夹名称:' : 'Folder name:');
                if (title) {
                    manager.createFolder(sid, null, title.trim());
                }
            } else if (action === 'create-bookmark-blank' && sid) {
                const manager = ensureTempManager();
                const title = prompt(lang === 'zh_CN' ? '书签名称:' : 'Bookmark name:');
                const url = prompt(lang === 'zh_CN' ? '书签链接:' : 'Bookmark URL:', 'https://');
                if (title && url) {
                    manager.createBookmark(sid, null, title.trim(), url.trim());
                }
            }
        });
    });

    // 使用固定定位显示菜单（不嵌入DOM）
    contextMenu.style.position = 'fixed';
    contextMenu.style.left = e.clientX + 'px';
    contextMenu.style.top = e.clientY + 'px';
    contextMenu.style.display = 'block';

    // 移除之前的嵌入样式
    contextMenu.style.position = 'fixed';
    if (contextMenu.parentElement && contextMenu.parentElement !== document.body) {
        document.body.appendChild(contextMenu);
    }
}

// 导出函数
if (typeof window !== 'undefined') {
    window.initContextMenu = initContextMenu;
    window.showContextMenu = showContextMenu;
    window.showBlankAreaContextMenu = showBlankAreaContextMenu;
    window.hideContextMenu = hideContextMenu;
    window.toggleNodeSelection = toggleNodeSelection;
    window.selectRange = selectRange;
    window.selectAll = selectAll;
    window.deselectAll = deselectAll;
    window.initBatchToolbar = initBatchToolbar;
    window.updateBatchToolbar = updateBatchToolbar;
    window.showBatchPanel = showBatchPanel;
    window.hideBatchPanel = hideBatchPanel;
    window.initKeyboardShortcuts = initKeyboardShortcuts;
    window.initClickSelect = initClickSelect;
    window.enterSelectMode = enterSelectMode;
    window.exitSelectMode = exitSelectMode;
    window.toggleContextMenuLayout = toggleContextMenuLayout;
    window.restoreContextMenuLayout = restoreContextMenuLayout;

    // 页面加载时恢复布局
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', restoreContextMenuLayout);
    } else {
        restoreContextMenuLayout();
    }
}

// ========== 超链接系统：独立的打开函数（不与书签共享状态） ==========

// 超链接：新标签页打开
async function openHyperlinkNewTab(url) {
    if (!url) return;
    try {
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
            await chrome.tabs.create({ url, active: true });
        } else {
            window.open(url, '_blank');
        }
    } catch (error) {
        console.error('[超链接] 新标签页打开失败:', error);
        window.open(url, '_blank');
    }
}

// 超链接：新窗口打开
async function openHyperlinkNewWindow(url) {
    if (!url) return;
    try {
        if (typeof chrome !== 'undefined' && chrome.windows && chrome.windows.create) {
            await chrome.windows.create({ url, focused: true });
        } else {
            window.open(url, '_blank');
        }
    } catch (error) {
        console.error('[超链接] 新窗口打开失败:', error);
        window.open(url, '_blank');
    }
}

// 超链接：无痕窗口打开（独立于书签系统）
async function openHyperlinkIncognito(url) {
    if (!url) return;
    const lang = currentLang || 'zh_CN';

    try {
        if (typeof chrome !== 'undefined' && chrome.windows && chrome.windows.create) {
            try {
                await chrome.windows.create({ url, incognito: true, focused: true });
            } catch (error) {
                if (error.message && error.message.includes('Incognito mode is disabled')) {
                    const msg = lang === 'zh_CN'
                        ? '无痕模式已禁用。正在普通窗口中打开。\n\n如需使用无痕模式，请在扩展程序设置中启用"在无痕模式下运行"。'
                        : 'Incognito mode is disabled. Opening in normal window.\n\nTo use incognito mode, enable "Allow in Incognito" in extension settings.';
                    alert(msg);
                    await chrome.windows.create({ url, incognito: false, focused: true });
                } else {
                    throw error;
                }
            }
        } else {
            window.open(url, '_blank');
        }
    } catch (error) {
        console.error('[超链接] 无痕窗口打开失败:', error);
        window.open(url, '_blank');
    }
}

// 超链接：同窗特定组（独立于书签系统）
async function openHyperlinkInSameWindowSpecificGroup(url, options = {}) {
    const { forceNew = false, forceNewGroup = false, forceNewWindow = false } = options;
    const lang = currentLang || 'zh_CN';

    if (!url) return;
    if (typeof chrome === 'undefined' || !chrome.tabs) {
        window.open(url, '_blank');
        return;
    }

    try {
        // 使用超链接专用的作用域键
        const scopeKey = 'hyperlink';

        if (forceNewWindow) {
            hyperlinkSameWindowSpecificGroupWindowId = null;
            hyperlinkSameWindowSpecificGroupScopes = {};
        }

        if (forceNewGroup || forceNew) {
            if (hyperlinkSameWindowSpecificGroupScopes && hyperlinkSameWindowSpecificGroupScopes[scopeKey]) {
                delete hyperlinkSameWindowSpecificGroupScopes[scopeKey];
            }
        }

        // 检查已有窗口是否有效
        let windowOk = false;
        if (hyperlinkSameWindowSpecificGroupWindowId && Number.isInteger(hyperlinkSameWindowSpecificGroupWindowId)) {
            try {
                if (chrome.windows && chrome.windows.get) {
                    await chrome.windows.get(hyperlinkSameWindowSpecificGroupWindowId, { populate: false });
                    windowOk = true;
                }
            } catch (_) {
                hyperlinkSameWindowSpecificGroupWindowId = null;
                hyperlinkSameWindowSpecificGroupScopes = {};
            }
        }

        // 如果没有有效窗口，创建新窗口
        if (!windowOk) {
            const newWin = await chrome.windows.create({ url, focused: true });
            hyperlinkSameWindowSpecificGroupWindowId = newWin.id;
            hyperlinkSameWindowSpecificGroupScopes = {};

            // 创建分组
            if (newWin.tabs && newWin.tabs.length > 0 && chrome.tabs.group) {
                hyperlinkGroupCounter++;
                const groupName = `Hyperlink ${hyperlinkGroupCounter}`;
                const groupId = await chrome.tabs.group({
                    tabIds: [newWin.tabs[0].id],
                    createProperties: { windowId: newWin.id }
                });
                if (chrome.tabGroups && chrome.tabGroups.update) {
                    await chrome.tabGroups.update(groupId, {
                        title: groupName,
                        color: 'purple'
                    });
                }
                hyperlinkSameWindowSpecificGroupScopes[scopeKey] = { groupId, windowId: newWin.id };
            }
            return;
        }

        // 有效窗口存在，检查作用域的分组
        const scopeEntry = hyperlinkSameWindowSpecificGroupScopes && hyperlinkSameWindowSpecificGroupScopes[scopeKey];
        let groupOk = false;

        if (scopeEntry && scopeEntry.groupId && Number.isInteger(scopeEntry.groupId)) {
            try {
                if (chrome.tabGroups && chrome.tabGroups.get) {
                    await chrome.tabGroups.get(scopeEntry.groupId);
                    groupOk = true;
                }
            } catch (_) {
                if (hyperlinkSameWindowSpecificGroupScopes[scopeKey]) {
                    delete hyperlinkSameWindowSpecificGroupScopes[scopeKey];
                }
            }
        }

        if (groupOk && scopeEntry) {
            // 分组有效，在该分组中创建标签
            const tab = await chrome.tabs.create({
                url,
                windowId: hyperlinkSameWindowSpecificGroupWindowId,
                active: true
            });

            if (chrome.tabs.group) {
                await chrome.tabs.group({
                    tabIds: [tab.id],
                    groupId: scopeEntry.groupId
                });
            }

            if (chrome.windows && chrome.windows.update) {
                await chrome.windows.update(hyperlinkSameWindowSpecificGroupWindowId, { focused: true });
            }
        } else {
            // 需要创建新分组
            const tab = await chrome.tabs.create({
                url,
                windowId: hyperlinkSameWindowSpecificGroupWindowId,
                active: true
            });

            if (chrome.tabs.group) {
                hyperlinkGroupCounter++;
                const groupName = `Hyperlink ${hyperlinkGroupCounter}`;
                const groupId = await chrome.tabs.group({
                    tabIds: [tab.id],
                    createProperties: { windowId: hyperlinkSameWindowSpecificGroupWindowId }
                });
                if (chrome.tabGroups && chrome.tabGroups.update) {
                    await chrome.tabGroups.update(groupId, {
                        title: groupName,
                        color: 'purple'
                    });
                }
                hyperlinkSameWindowSpecificGroupScopes[scopeKey] = { groupId, windowId: hyperlinkSameWindowSpecificGroupWindowId };
            }

            if (chrome.windows && chrome.windows.update) {
                await chrome.windows.update(hyperlinkSameWindowSpecificGroupWindowId, { focused: true });
            }
        }
    } catch (error) {
        console.error('[超链接] 同窗特定组打开失败:', error);
        window.open(url, '_blank');
    }
}

// 超链接：在特定标签组中打开（Group名："Hyperlink 1", "Hyperlink 2"...）
async function openHyperlinkInSpecificTabGroup(url, options = {}) {
    const { forceNew = false } = options;
    const lang = currentLang || 'zh_CN';

    if (!url) return;
    if (typeof chrome === 'undefined' || !chrome.tabs) {
        window.open(url, '_blank');
        return;
    }

    try {
        if (forceNew) {
            await resetHyperlinkSpecificGroupInfo();
        }

        // 检查已有分组是否有效
        if (hyperlinkSpecificTabGroupId && Number.isInteger(hyperlinkSpecificTabGroupId)) {
            try {
                if (chrome.tabGroups && chrome.tabGroups.get) {
                    await chrome.tabGroups.get(hyperlinkSpecificTabGroupId);
                }
                if (hyperlinkSpecificGroupWindowId && chrome.windows && chrome.windows.get) {
                    await chrome.windows.get(hyperlinkSpecificGroupWindowId, { populate: false });
                }

                // 分组有效，在该分组中创建标签
                const tab = await chrome.tabs.create({
                    url,
                    windowId: hyperlinkSpecificGroupWindowId || undefined,
                    active: true
                });

                if (chrome.tabs.group) {
                    await chrome.tabs.group({
                        tabIds: [tab.id],
                        groupId: hyperlinkSpecificTabGroupId
                    });
                }

                console.log(`[超链接] 在现有分组中打开: ${url}`);
                return;
            } catch (error) {
                console.warn('[超链接] 分组已失效，创建新分组');
                await resetHyperlinkSpecificGroupInfo();
            }
        }

        // 创建新分组，递增计数器
        hyperlinkGroupCounter++;
        const groupTitle = `Hyperlink ${hyperlinkGroupCounter}`;

        const currentWindow = await chrome.windows.getCurrent({ populate: false });
        const tab = await chrome.tabs.create({
            url,
            windowId: currentWindow.id,
            active: true
        });

        if (chrome.tabs.group && chrome.tabGroups && chrome.tabGroups.update) {
            const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
            await chrome.tabGroups.update(groupId, {
                title: groupTitle,
                collapsed: false
            });

            await setHyperlinkSpecificGroupInfo(groupId, currentWindow.id);

            console.log(`[超链接] 创建新分组"${groupTitle}": ${url}`);
        }
    } catch (error) {
        console.error('[超链接] 分组打开失败:', error);
        window.open(url, '_blank');
    }
}

// 超链接：在特定窗口中打开（带书签画布tab + Window名："Hyperlink 1", "Hyperlink 2"...）
async function openHyperlinkInSpecificWindow(url, options = {}) {
    const { forceNew = false } = options;
    const lang = currentLang || 'zh_CN';

    if (!url) return;
    try {
        if (typeof chrome !== 'undefined' && chrome.windows && chrome.tabs) {
            if (forceNew) {
                await resetHyperlinkSpecificWindowId();
            }

            // 检查窗口是否存在
            if (hyperlinkSpecificWindowId) {
                try {
                    const win = await chrome.windows.get(hyperlinkSpecificWindowId, { populate: false });
                    if (win && win.id) {
                        // 在现有窗口中打开新标签
                        await chrome.tabs.create({
                            url,
                            windowId: hyperlinkSpecificWindowId,
                            active: true
                        });
                        await chrome.windows.update(hyperlinkSpecificWindowId, { focused: true });
                        console.log('[超链接] 在现有窗口中打开:', url);
                        return;
                    }
                } catch (error) {
                    console.warn('[超链接] 窗口已失效，创建新窗口');
                    await resetHyperlinkSpecificWindowId();
                }
            }

            // 创建新窗口，使用独立的注册表系统
            const nextNumber = await allocateNextHyperlinkWindowNumber();
            const windowTitle = `Hyperlink ${nextNumber}`;

            // 构建window_marker.html的URL（用于标识窗口）
            let markerUrl = null;
            try {
                const params = new URLSearchParams();
                params.set('t', String(nextNumber));
                params.set('type', 'hyperlink'); // 标识这是超链接系统的窗口
                if (chrome.runtime && chrome.runtime.getURL) {
                    markerUrl = chrome.runtime.getURL(`history_html/window_marker.html?${params.toString()}`);
                }
            } catch (_) { }

            // 先创建窗口，默认打开目标URL
            const created = await chrome.windows.create({
                url: url,
                focused: true
            });
            await setHyperlinkSpecificWindowId(created.id);

            // 注册到超链接窗口注册表
            await registerHyperlinkWindow(created.id, nextNumber);

            // 创建书签画布标识tab（固定在第一位）
            if (markerUrl) {
                try {
                    const markerTab = await chrome.tabs.create({
                        windowId: created.id,
                        url: markerUrl,
                        pinned: false,
                        active: false
                    });
                    // 移动到第一位
                    if (markerTab && markerTab.id != null) {
                        await chrome.tabs.move(markerTab.id, { index: 0 });
                    }
                } catch (markerError) {
                    console.warn('[超链接] 创建标识标签失败:', markerError);
                }
            }

            console.log(`[超链接] 创建新窗口"${windowTitle}": ${url}`);
        } else {
            window.open(url, '_blank');
        }
    } catch (error) {
        console.error('[超链接] 特定窗口打开失败:', error);
        window.open(url, '_blank');
    }
}

// 超链接：同窗特定组打开（Group名："超链接" / "Hyperlink"）
async function openHyperlinkInSameWindowSpecificGroup(url) {
    const lang = currentLang || 'zh_CN';
    const groupTitle = lang === 'zh_CN' ? '超链接' : 'Hyperlink';

    if (!url) return;
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.windows) {
        window.open(url, '_blank');
        return;
    }

    try {
        // 确保窗口存在
        let windowId = hyperlinkSameWindowSpecificGroupWindowId;
        if (!windowId) {
            const currentWindow = await chrome.windows.getCurrent({ populate: false });
            windowId = currentWindow.id;
            hyperlinkSameWindowSpecificGroupWindowId = windowId;
        }

        // 检查窗口是否有效
        try {
            await chrome.windows.get(windowId, { populate: false });
        } catch (error) {
            const currentWindow = await chrome.windows.getCurrent({ populate: false });
            windowId = currentWindow.id;
            hyperlinkSameWindowSpecificGroupWindowId = windowId;
        }

        // 检查作用域中的分组
        const scopeEntry = hyperlinkSameWindowSpecificGroupScopes['_hyperlink'];
        let groupId = null;

        if (scopeEntry && scopeEntry.windowId === windowId && Number.isInteger(scopeEntry.groupId)) {
            try {
                if (chrome.tabGroups && chrome.tabGroups.get) {
                    await chrome.tabGroups.get(scopeEntry.groupId);
                }
                groupId = scopeEntry.groupId;
            } catch (error) {
                console.warn('[超链接] 分组已失效');
                groupId = null;
            }
        }

        // 创建标签
        const tab = await chrome.tabs.create({
            url,
            windowId: windowId,
            active: true
        });

        if (chrome.tabs.group && chrome.tabGroups && chrome.tabGroups.update) {
            if (groupId) {
                // 复用现有分组
                await chrome.tabs.group({
                    tabIds: [tab.id],
                    groupId: groupId
                });
            } else {
                // 创建新分组
                groupId = await chrome.tabs.group({ tabIds: [tab.id] });
                await chrome.tabGroups.update(groupId, {
                    title: groupTitle,
                    collapsed: false
                });

                // 保存到作用域
                hyperlinkSameWindowSpecificGroupScopes['_hyperlink'] = {
                    groupId: groupId,
                    windowId: windowId,
                    updatedAt: Date.now()
                };
            }
        }

        console.log(`[超链接] 同窗特定组打开: ${url}`);
    } catch (error) {
        console.error('[超链接] 同窗特定组打开失败:', error);
        window.open(url, '_blank');
    }
}

// =====================================================================
// 手动选择窗口+组功能
// =====================================================================

// 存储手动选择的窗口和组
let manualSelectedWindowId = null;
let manualSelectedGroupId = null;

// 存储自定义窗口名称
let customWindowNames = {};

// 存储窗口ID到序号的映射（用于在标签组中显示友好序号）
let windowIdToIndexMap = {};

/**
 * 显示手动选择窗口+组的选择器
 */
async function showManualWindowGroupSelector(context) {
    try {
        const lang = currentLang || 'zh_CN';

        // 创建遮罩层
        const overlay = document.createElement('div');
        overlay.className = 'manual-selector-overlay';

        // 创建对话框
        const dialog = document.createElement('div');
        dialog.className = 'manual-selector-dialog';

        // 头部
        const header = document.createElement('div');
        header.className = 'manual-selector-header';
        header.innerHTML = `
            <div class="manual-selector-title">${lang === 'zh_CN' ? '选择窗口和标签组' : 'Select Window and Tab Group'}</div>
            <button class="manual-selector-close">×</button>
        `;

        // 主体
        const body = document.createElement('div');
        body.className = 'manual-selector-body';

        // 左侧：窗口列表
        const windowPanel = document.createElement('div');
        windowPanel.className = 'manual-selector-panel';
        windowPanel.style.position = 'relative';
        windowPanel.innerHTML = `
            <div class="manual-selector-panel-title">
                <span>${lang === 'zh_CN' ? '窗口' : 'Windows'}</span>
                <span style="position: relative; display: inline-flex; align-items: center;">
                    <i class="fas fa-question-circle manual-selector-help-icon"></i>
                </span>
            </div>
            <div class="manual-selector-help-tooltip">
                <p>${lang === 'zh_CN'
                ? 'Chrome/Edge扩展API无法获取窗口的自定义名称（即使您在浏览器中设置了"命名窗口"）。'
                : 'Chrome/Edge extension API cannot access custom window names (even if you set "Name Window" in browser).'}</p>
                <p>${lang === 'zh_CN'
                ? '显示的是活动标签页标题，您可以点击编辑按钮（<i class="fas fa-edit"></i>）设置自定义名称。'
                : 'Showing active tab title, you can click edit button (<i class="fas fa-edit"></i>) to set custom name.'}</p>
            </div>
            <div class="manual-selector-list" data-type="windows"></div>
        `;

        // 绑定帮助图标hover事件
        const helpIcon = windowPanel.querySelector('.manual-selector-help-icon');
        const helpTooltip = windowPanel.querySelector('.manual-selector-help-tooltip');

        // 动态计算箭头位置
        const updateArrowPosition = () => {
            const panelRect = windowPanel.getBoundingClientRect();
            const iconRect = helpIcon.getBoundingClientRect();
            const arrowOffset = iconRect.left - panelRect.left + (iconRect.width / 2);
            helpTooltip.style.setProperty('--arrow-offset', `${arrowOffset}px`);
        };

        helpIcon.addEventListener('mouseenter', () => {
            updateArrowPosition();
            helpTooltip.style.opacity = '1';
            helpTooltip.style.visibility = 'visible';
        });

        helpIcon.addEventListener('mouseleave', () => {
            helpTooltip.style.opacity = '0';
            helpTooltip.style.visibility = 'hidden';
        });

        helpTooltip.addEventListener('mouseenter', () => {
            helpTooltip.style.opacity = '1';
            helpTooltip.style.visibility = 'visible';
        });

        helpTooltip.addEventListener('mouseleave', () => {
            helpTooltip.style.opacity = '0';
            helpTooltip.style.visibility = 'hidden';
        });

        // 右侧：组列表
        const groupPanel = document.createElement('div');
        groupPanel.className = 'manual-selector-panel';
        groupPanel.innerHTML = `
            <div class="manual-selector-panel-title">${lang === 'zh_CN' ? '标签组' : 'Tab Groups'}</div>
            <div class="manual-selector-list" data-type="groups"></div>
        `;

        body.appendChild(windowPanel);
        body.appendChild(groupPanel);

        // 底部按钮
        const footer = document.createElement('div');
        footer.className = 'manual-selector-footer';
        footer.innerHTML = `
            <button class="manual-selector-btn manual-selector-btn-clear">${lang === 'zh_CN' ? '清除选择' : 'Clear'}</button>
            <button class="manual-selector-btn manual-selector-btn-confirm">${lang === 'zh_CN' ? '确认' : 'Confirm'}</button>
        `;

        // 组装
        dialog.appendChild(header);
        dialog.appendChild(body);
        dialog.appendChild(footer);
        overlay.appendChild(dialog);

        // 将overlay添加到画布工作区，而不是body
        const canvasWorkspace = document.getElementById('canvasWorkspace');
        const canvasContainer = canvasWorkspace || document.body;
        canvasContainer.appendChild(overlay);

        // 如果添加到画布工作区，确保容器是relative定位
        if (canvasWorkspace) {
            const originalPosition = canvasWorkspace.style.position;
            if (!originalPosition || originalPosition === 'static') {
                canvasWorkspace.style.position = 'relative';
            }
        }

        // 加载窗口和组数据
        await loadWindowsAndGroups(overlay, lang);

        // 阻止选择器内的所有滚动相关事件冒泡到画布
        const preventBubble = (e) => {
            e.stopPropagation();
        };

        // 滚轮事件
        dialog.addEventListener('wheel', preventBubble, { passive: false });

        // 触摸事件
        dialog.addEventListener('touchmove', preventBubble, { passive: false });

        // 鼠标拖动事件（可能影响滚动）
        dialog.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });

        // 防止点击事件冒泡导致画布交互
        dialog.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // 事件处理
        setupSelectorEvents(overlay, context, lang);

    } catch (error) {
        console.error('[手动选择器] 显示失败:', error);
    }
}

/**
 * 加载所有窗口和组
 */
async function loadWindowsAndGroups(overlay, lang) {
    try {
        // 获取所有窗口
        const windows = await chrome.windows.getAll({ populate: true });
        const windowsList = overlay.querySelector('.manual-selector-list[data-type="windows"]');

        // 重置窗口序号映射
        windowIdToIndexMap = {};

        if (windows.length === 0) {
            windowsList.innerHTML = `<div class="manual-selector-empty">${lang === 'zh_CN' ? '没有窗口' : 'No windows'}</div>`;
        } else {
            windowsList.innerHTML = '';

            // 获取当前窗口ID
            const currentWindow = await chrome.windows.getCurrent();
            const currentWindowId = currentWindow.id;

            // 构建窗口ID到序号的映射
            windows.forEach((win, index) => {
                windowIdToIndexMap[win.id] = index + 1;
            });

            windows.forEach((win, index) => {
                const windowIndex = index + 1;  // 窗口序号（从1开始）
                const isCurrent = win.id === currentWindowId;
                const tabCount = win.tabs ? win.tabs.length : 0;

                // 获取活动标签页标题
                const activeTab = win.tabs ? win.tabs.find(tab => tab.active) : null;
                const activeTabTitle = activeTab ? activeTab.title : `Window #${win.id}`;

                // 获取显示名称（优先使用自定义名称）
                const displayName = getWindowDisplayName(win.id, activeTabTitle);
                const hasCustomName = !!customWindowNames[win.id];


                // 窗口状态
                const stateIcon = {
                    'maximized': '<i class="fas fa-window-maximize"></i>',
                    'minimized': '<i class="fas fa-window-minimize"></i>',
                    'fullscreen': '<i class="fas fa-expand"></i>',
                    'normal': '<i class="fas fa-window-restore"></i>'
                }[win.state] || '';

                const stateText = {
                    'maximized': lang === 'zh_CN' ? '最大化' : 'Maximized',
                    'minimized': lang === 'zh_CN' ? '最小化' : 'Minimized',
                    'fullscreen': lang === 'zh_CN' ? '全屏' : 'Fullscreen',
                    'normal': lang === 'zh_CN' ? '正常' : 'Normal'
                }[win.state] || '';

                const item = document.createElement('div');
                item.className = 'manual-selector-item';
                item.dataset.windowId = win.id;
                item.dataset.windowIndex = windowIndex;

                // 如果是当前选中的窗口，添加选中样式
                if (manualSelectedWindowId === win.id) {
                    item.classList.add('selected');
                }

                item.innerHTML = `
                    <div class="manual-selector-item-header">
                        <div class="manual-selector-item-title">
                            <span class="manual-selector-window-index">${windowIndex}</span>
                            ${win.incognito ? '🕶️' : '🪟'} ${displayName}
                            ${isCurrent ? `<span class="manual-selector-item-badge">${lang === 'zh_CN' ? '当前' : 'Current'}</span>` : ''}
                            ${hasCustomName ? `<span class="manual-selector-item-badge" style="background: var(--accent-primary);">✓</span>` : ''}
                        </div>
                        <div class="manual-selector-item-actions">
                            <button class="manual-selector-edit-btn" data-window-id="${win.id}" title="${lang === 'zh_CN' ? '编辑名称' : 'Edit name'}">
                                <i class="fas fa-edit"></i>
                            </button>
                        </div>
                    </div>
                    <div class="manual-selector-item-info">
                        <span class="manual-selector-item-meta">${stateIcon} ${stateText}</span>
                        <span class="manual-selector-item-meta"><i class="fas fa-layer-group"></i> ${tabCount} ${lang === 'zh_CN' ? '个标签页' : 'tabs'}</span>
                        ${win.incognito ? `<span class="manual-selector-item-meta"><i class="fas fa-user-secret"></i> ${lang === 'zh_CN' ? '无痕模式' : 'Incognito'}</span>` : ''}
                    </div>
                `;

                // 绑定编辑按钮事件
                const editBtn = item.querySelector('.manual-selector-edit-btn');
                editBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await showWindowNameEditor(item, win.id, displayName, lang);
                });

                // 点击选择窗口
                item.addEventListener('click', async (e) => {
                    // 如果处于编辑模式，不触发选择
                    if (item.dataset.editing === 'true') {
                        return;
                    }
                    // 如果点击的是编辑按钮或输入框，不触发选择
                    if (e.target.closest('.manual-selector-edit-btn') || e.target.closest('.manual-selector-item-input')) {
                        return;
                    }
                    // 切换选择
                    const wasSelected = item.classList.contains('selected');
                    overlay.querySelectorAll('.manual-selector-list[data-type="windows"] .manual-selector-item').forEach(i => {
                        i.classList.remove('selected');
                    });

                    if (!wasSelected) {
                        item.classList.add('selected');
                        manualSelectedWindowId = win.id;
                    } else {
                        manualSelectedWindowId = null;
                    }

                    // 更新组列表
                    await loadGroupsForWindow(overlay, manualSelectedWindowId, lang);
                });

                windowsList.appendChild(item);
            });
        }

        // 初始加载组列表
        await loadGroupsForWindow(overlay, manualSelectedWindowId, lang);

    } catch (error) {
        console.error('[手动选择器] 加载窗口和组失败:', error);
    }
}

/**
 * 加载指定窗口的组（如果未指定窗口，显示所有组）
 */
async function loadGroupsForWindow(overlay, windowId, lang) {
    try {
        const groupsList = overlay.querySelector('.manual-selector-list[data-type="groups"]');

        // 查询组
        const query = windowId ? { windowId } : {};
        const groups = await chrome.tabGroups.query(query);

        if (groups.length === 0) {
            groupsList.innerHTML = `<div class="manual-selector-empty">${windowId ? (lang === 'zh_CN' ? '该窗口没有标签组' : 'No groups in this window') : (lang === 'zh_CN' ? '选择窗口以查看其标签组，或直接选择所有组' : 'Select a window to see its groups, or choose from all groups')}</div>`;

            // 如果没有选择窗口，显示所有组
            if (!windowId) {
                const allGroups = await chrome.tabGroups.query({});
                if (allGroups.length > 0) {
                    renderGroups(overlay, allGroups, lang);
                }
            }
        } else {
            renderGroups(overlay, groups, lang);
        }
    } catch (error) {
        console.error('[手动选择器] 加载组失败:', error);
    }
}

/**
 * 渲染组列表
 */
function renderGroups(overlay, groups, lang) {
    const groupsList = overlay.querySelector('.manual-selector-list[data-type="groups"]');
    groupsList.innerHTML = '';

    // 按窗口分组显示
    const groupsByWindow = {};
    groups.forEach(group => {
        if (!groupsByWindow[group.windowId]) {
            groupsByWindow[group.windowId] = [];
        }
        groupsByWindow[group.windowId].push(group);
    });

    // 获取窗口ID列表（如果有多个窗口的组，显示窗口分隔）
    const windowIds = Object.keys(groupsByWindow);
    const showWindowHeaders = windowIds.length > 1;

    windowIds.forEach(winId => {
        // 获取窗口序号
        const windowIndex = windowIdToIndexMap[winId] || winId;

        // 如果有多个窗口，显示窗口标题
        if (showWindowHeaders) {
            const header = document.createElement('div');
            header.className = 'manual-selector-item-info';
            header.style.padding = '8px 16px';
            header.style.fontWeight = '600';
            header.style.borderBottom = '1px solid var(--border-color)';
            header.style.marginBottom = '6px';
            header.innerHTML = `<i class="fas fa-window-restore"></i> ${lang === 'zh_CN' ? '窗口' : 'Window'} ${windowIndex}`;
            groupsList.appendChild(header);
        }

        groupsByWindow[winId].forEach(group => {
            const colorMap = {
                'grey': '⚪',
                'blue': '🔵',
                'red': '🔴',
                'yellow': '🟡',
                'green': '🟢',
                'pink': '🟣',
                'purple': '🟣',
                'cyan': '🔵',
                'orange': '🟠'
            };
            const colorIcon = colorMap[group.color] || '⚪';

            const item = document.createElement('div');
            item.className = 'manual-selector-item';
            item.dataset.groupId = group.id;
            item.dataset.windowId = group.windowId;

            // 如果是当前选中的组，添加选中样式
            if (manualSelectedGroupId === group.id) {
                item.classList.add('selected');
            }

            const title = group.title || (lang === 'zh_CN' ? '(无标题)' : '(Untitled)');
            const groupWindowIndex = windowIdToIndexMap[group.windowId] || group.windowId;

            item.innerHTML = `
                <div class="manual-selector-item-title">
                    ${colorIcon} ${title}
                </div>
                <div class="manual-selector-item-info">${lang === 'zh_CN' ? '窗口' : 'Window'} ${groupWindowIndex}</div>
            `;

            // 点击选择组
            item.addEventListener('click', () => {
                // 切换选择
                const wasSelected = item.classList.contains('selected');
                overlay.querySelectorAll('.manual-selector-list[data-type="groups"] .manual-selector-item').forEach(i => {
                    i.classList.remove('selected');
                });

                if (!wasSelected) {
                    item.classList.add('selected');
                    manualSelectedGroupId = group.id;
                } else {
                    manualSelectedGroupId = null;
                }
            });

            groupsList.appendChild(item);
        });
    });
}

/**
 * 设置选择器事件
 */
function setupSelectorEvents(overlay, context, lang) {
    // 关闭按钮
    const closeBtn = overlay.querySelector('.manual-selector-close');
    closeBtn.addEventListener('click', () => {
        overlay.remove();
    });

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
        }
    });

    // 清除按钮
    const clearBtn = overlay.querySelector('.manual-selector-btn-clear');
    clearBtn.addEventListener('click', () => {
        manualSelectedWindowId = null;
        manualSelectedGroupId = null;

        // 清除选中样式
        overlay.querySelectorAll('.manual-selector-item').forEach(item => {
            item.classList.remove('selected');
        });

        // 重新加载组列表
        loadGroupsForWindow(overlay, null, lang);

        // 保存到storage
        saveManualSelection();
    });

    // 确认按钮
    const confirmBtn = overlay.querySelector('.manual-selector-btn-confirm');
    confirmBtn.addEventListener('click', async () => {
        // 保存选择
        await saveManualSelection();

        // 设置为默认打开方式
        if (context && context.isHyperlink) {
            await setHyperlinkDefaultOpenMode('manual-select');
        } else {
            await setDefaultOpenMode('manual-select');
        }

        // 关闭选择器
        overlay.remove();

        // 如果有书签URL，立即使用选择的窗口/组打开
        if (context && context.nodeUrl) {
            await openBookmarkWithManualSelection(context.nodeUrl);
        }
    });
}

/**
 * 保存手动选择到storage
 */
async function saveManualSelection() {
    try {
        await chrome.storage.local.set({
            manualSelectedWindowId,
            manualSelectedGroupId,
            customWindowNames
        });
        console.log('[手动选择器] 已保存:', { windowId: manualSelectedWindowId, groupId: manualSelectedGroupId });
    } catch (error) {
        console.error('[手动选择器] 保存失败:', error);
    }
}

/**
 * 设置窗口自定义名称
 */
async function setCustomWindowName(windowId, customName) {
    if (customName && customName.trim()) {
        customWindowNames[windowId] = customName.trim();
    } else {
        delete customWindowNames[windowId];
    }
    await saveManualSelection();
}

/**
 * 获取窗口显示名称（优先使用自定义名称）
 */
function getWindowDisplayName(windowId, activeTabTitle) {
    return customWindowNames[windowId] || activeTabTitle;
}

/**
 * 显示窗口名称编辑器
 */
async function showWindowNameEditor(item, windowId, currentName, lang) {
    const titleDiv = item.querySelector('.manual-selector-item-title');
    const actionsDiv = item.querySelector('.manual-selector-item-actions');

    // 保存原始HTML
    const originalTitleHTML = titleDiv.innerHTML;
    const originalActionsHTML = actionsDiv.innerHTML;

    // 标记为编辑模式，防止item的click事件触发
    item.dataset.editing = 'true';

    // 创建输入框
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'manual-selector-item-input';
    input.value = currentName;
    input.placeholder = lang === 'zh_CN' ? '输入自定义名称' : 'Enter custom name';

    // 创建操作按钮
    const saveBtn = document.createElement('button');
    saveBtn.className = 'manual-selector-edit-btn';
    saveBtn.innerHTML = '<i class="fas fa-check"></i>';
    saveBtn.title = lang === 'zh_CN' ? '保存' : 'Save';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'manual-selector-edit-btn';
    cancelBtn.innerHTML = '<i class="fas fa-times"></i>';
    cancelBtn.title = lang === 'zh_CN' ? '取消' : 'Cancel';

    const clearBtn = document.createElement('button');
    clearBtn.className = 'manual-selector-edit-btn';
    clearBtn.innerHTML = '<i class="fas fa-undo"></i>';
    clearBtn.title = lang === 'zh_CN' ? '还原为默认名称' : 'Restore default name';
    clearBtn.style.color = '#dc3545';

    // 替换内容
    titleDiv.innerHTML = '';
    titleDiv.appendChild(input);

    actionsDiv.innerHTML = '';
    actionsDiv.appendChild(saveBtn);
    actionsDiv.appendChild(clearBtn);
    actionsDiv.appendChild(cancelBtn);
    actionsDiv.style.opacity = '1'; // 始终显示

    // 聚焦并选中文本
    input.focus();
    input.select();

    // 保存函数
    const save = async () => {
        const newName = input.value.trim();
        await setCustomWindowName(windowId, newName);

        // 重新加载窗口列表以刷新显示
        const overlay = item.closest('.manual-selector-overlay');
        if (overlay) {
            await loadWindowsAndGroups(overlay, lang);
        }
    };

    // 取消函数
    const cancel = () => {
        // 移除编辑模式标记
        delete item.dataset.editing;

        titleDiv.innerHTML = originalTitleHTML;
        actionsDiv.innerHTML = originalActionsHTML;
        actionsDiv.style.opacity = '';

        // 重新绑定编辑按钮
        const editBtn = actionsDiv.querySelector('.manual-selector-edit-btn');
        if (editBtn) {
            editBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await showWindowNameEditor(item, windowId, currentName, lang);
            });
        }
    };

    // 清除函数
    const clear = async () => {
        await setCustomWindowName(windowId, '');
        const overlay = item.closest('.manual-selector-overlay');
        if (overlay) {
            await loadWindowsAndGroups(overlay, lang);
        }
    };

    // 绑定事件
    saveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        save();
    });

    cancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        cancel();
    });

    clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clear();
    });

    // Enter保存，Escape取消
    input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
            save();
        } else if (e.key === 'Escape') {
            cancel();
        }
    });

    // 阻止点击输入框时触发窗口选择
    input.addEventListener('click', (e) => {
        e.stopPropagation();
    });
}

/**
 * 加载手动选择
 */
async function loadManualSelection() {
    try {
        const data = await chrome.storage.local.get(['manualSelectedWindowId', 'manualSelectedGroupId', 'customWindowNames']);
        manualSelectedWindowId = data.manualSelectedWindowId || null;
        manualSelectedGroupId = data.manualSelectedGroupId || null;
        customWindowNames = data.customWindowNames || {};
    } catch (error) {
        console.error('[手动选择器] 加载失败:', error);
    }
}

/**
 * 使用手动选择的窗口/组打开书签
 */
async function openBookmarkWithManualSelection(url) {
    try {
        if (!url) return;

        const windowId = manualSelectedWindowId;
        const groupId = manualSelectedGroupId;

        console.log('[手动选择器] 打开书签:', { url, windowId, groupId });

        // 情况1: 窗口 + 组
        if (windowId && groupId) {
            // 验证组是否存在且在指定窗口中
            try {
                const group = await chrome.tabGroups.get(groupId);
                if (group.windowId !== windowId) {
                    throw new Error('组不在指定窗口中');
                }

                // 在指定窗口的指定组中打开
                const tab = await chrome.tabs.create({ url, windowId, active: true });
                await chrome.tabs.group({ groupId, tabIds: [tab.id] });

            } catch (error) {
                console.warn('[手动选择器] 组不存在，在窗口中创建新标签:', error);
                await chrome.tabs.create({ url, windowId, active: true });
            }
        }
        // 情况2: 仅窗口
        else if (windowId) {
            await chrome.tabs.create({ url, windowId, active: true });
        }
        // 情况3: 仅组
        else if (groupId) {
            try {
                const group = await chrome.tabGroups.get(groupId);
                const tab = await chrome.tabs.create({ url, windowId: group.windowId, active: true });
                await chrome.tabs.group({ groupId, tabIds: [tab.id] });
            } catch (error) {
                console.warn('[手动选择器] 组不存在，在新标签页打开:', error);
                await chrome.tabs.create({ url, active: true });
            }
        }
        // 情况4: 都不选（新标签页）
        else {
            await chrome.tabs.create({ url, active: true });
        }

    } catch (error) {
        console.error('[手动选择器] 打开书签失败:', error);
        window.open(url, '_blank');
    }
}

// 初始化时加载手动选择
loadManualSelection();

// 导出到全局供其他模块调用
try {
    window.openBookmarkWithManualSelection = openBookmarkWithManualSelection;
} catch (_) { }
