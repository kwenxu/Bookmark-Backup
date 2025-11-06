// =============================================================================
// Bookmark Canvas Module - 基于原有Bookmark Tree改造的Canvas功能
// =============================================================================

// Canvas状态管理
const CanvasState = {
    tempSections: [],
    tempSectionCounter: 0,
    tempItemCounter: 0,
    tempSectionSequenceNumber: 0,
    colorCursor: 0,
    // 纯 Markdown 文本卡片（Obsidian Canvas 风格）
    mdNodes: [],
    mdNodeCounter: 0,
    // 栏目休眠管理（性能优化）- 阶梯式性能模式
    performanceMode: 'balanced', // 性能模式：'maximum' | 'balanced' | 'smooth' | 'unlimited'
    performanceSettings: {
        maximum: {
            name: '极致性能',
            margin: 0,
            description: '仅渲染视口内可见栏目，最省资源'
        },
        balanced: {
            name: '平衡模式',
            margin: 50,
            description: '平衡性能和体验（推荐）'
        },
        smooth: {
            name: '流畅模式',
            margin: 200,
            description: '预加载更多栏目，滚动更流畅'
        },
        unlimited: {
            name: '无限制',
            margin: Infinity,
            description: '渲染所有栏目，适合少量栏目'
        }
    },
    // 延迟休眠机制
    dormancyTimers: new Map(), // 存储每个栏目的休眠定时器 sectionId -> { type, timer, scheduledAt }
    dormancyDelays: {
        viewport: 120000,  // 离开视口2分钟后休眠
        occlusion: 120000  // 被遮挡2分钟后休眠（暂未启用）
    },
    // 防重复创建
    isCreatingTempNode: false, // 标记是否正在创建临时节点
    lastDragEndTime: 0, // 上次 dragend 事件的时间戳
    dragState: {
        isDragging: false,
        draggedElement: null,
        draggedData: null,
        dragStartX: 0,
        dragStartY: 0,
        nodeStartX: 0,
        nodeStartY: 0,
        dragSource: null, // 'permanent' or 'temporary'
        treeDragItem: null,
        treeDragCleanupTimeout: null
    },
    // 画布缩放和平移
    zoom: 1,
    panOffsetX: 0,
    panOffsetY: 0,
    isPanning: false,
    panStartX: 0,
    panStartY: 0,
    isSpacePressed: false,
    isFullscreen: false,
    fullscreenHandlersBound: false,
    scrollState: {
        vertical: {
            hidden: true,
            disabled: false,
            dragging: false,
            dragOffset: 0
        },
        horizontal: {
            hidden: true,
            disabled: false,
            dragging: false,
            dragOffset: 0
        },
        activeDragAxis: null,
        dragInfo: null,
        handlersAttached: false
    },
    scrollBounds: {
        vertical: { min: -600, max: 600 },
        horizontal: { min: -800, max: 800 }
    },
    scrollAnimation: {
        frameId: null,
        targetX: null,
        targetY: null
    },
    contentBounds: {
        minX: -400,
        maxX: 400,
        minY: -300,
        maxY: 300
    },
    dropCleanupBound: false,
    // 选中状态（仅 Markdown 空白栏目）
    selectedMdNodeId: null,
    // 连接线
    edges: [],
    edgeCounter: 0,
    isConnecting: false,
    connectionStart: null, // { nodeId, side, anchorEl }
    selectedEdgeId: null
};

let panSaveTimeout = null;
const CANVAS_SCROLL_MARGIN = 120;
const CANVAS_SCROLL_EXTRA_SPACE = 2000; // 允许滚动到内容外2000px的空白区域
let suppressScrollSync = false;
let zoomSaveTimeout = null;
let zoomUpdateFrame = null;
let pendingZoomRequest = null;
const scrollbarHoverState = new WeakMap();

// 性能优化：滚动条更新去抖
let scrollbarUpdateFrame = null;
let scrollbarUpdatePending = false;
let boundsUpdateFrame = null;
let boundsUpdatePending = false;

// 性能优化：滚动/缩放停止检测
let scrollStopTimer = null;
let isScrolling = false;
const SCROLL_STOP_DELAY = 150; // 滚动停止后延迟加载时间

// 性能优化：缓存 DOM 元素引用，避免重复查询
let cachedCanvasContainer = null;
let cachedCanvasContent = null;

// 性能优化：休眠管理节流
let dormancyUpdateTimer = null;
let dormancyUpdatePending = false;

function getCachedContainer() {
    if (!cachedCanvasContainer) {
        cachedCanvasContainer = document.querySelector('.canvas-main-container');
    }
    return cachedCanvasContainer;
}

function getCachedContent() {
    if (!cachedCanvasContent) {
        cachedCanvasContent = document.getElementById('canvasContent');
    }
    return cachedCanvasContent;
}
const TEMP_SECTION_STORAGE_KEY = 'bookmark-canvas-temp-sections';
const LEGACY_TEMP_NODE_STORAGE_KEY = 'bookmark-canvas-temp-nodes';
const TEMP_SECTION_DEFAULT_WIDTH = 360;
const TEMP_SECTION_DEFAULT_HEIGHT = 280;
const TEMP_SECTION_DEFAULT_COLOR = '#2563eb';
// Obsidian Canvas 文本节点默认尺寸（参考 sample.canvas）
const MD_NODE_DEFAULT_WIDTH = 250;
const MD_NODE_DEFAULT_HEIGHT = 160;
function formatTimestampForTitle(date = new Date()) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function getDefaultTempSectionTitle() {
    try {
        return formatTimestampForTitle();
    } catch (_) {
        return new Date().toLocaleString();
    }
}

function pickTempSectionColor() {
    CanvasState.colorCursor = (CanvasState.colorCursor + 1) % 1;
    return TEMP_SECTION_DEFAULT_COLOR;
}

function cloneBookmarkNode(node) {
    if (!node) return null;
    const clone = {
        id: node.id || null,
        title: node.title || '',
        url: node.url || null,
        parentId: node.parentId || null,
        type: node.url ? 'bookmark' : 'folder'
    };
    if (node.children && Array.isArray(node.children)) {
        clone.children = node.children.map(child => cloneBookmarkNode(child)).filter(Boolean);
    } else {
        clone.children = [];
    }
    return clone;
}

function markTreeItemDragging(treeItem) {
    if (!treeItem || !treeItem.classList) return;
    treeItem.classList.add('tree-drag-out');
    CanvasState.dragState.treeDragItem = treeItem;
}

function scheduleClearTreeItemDragging(delay = 160) {
    if (CanvasState.dragState.treeDragCleanupTimeout) {
        clearTimeout(CanvasState.dragState.treeDragCleanupTimeout);
    }
    CanvasState.dragState.treeDragCleanupTimeout = setTimeout(() => {
        clearTreeItemDragging();
    }, delay);
}

function clearTreeItemDragging() {
    if (CanvasState.dragState.treeDragCleanupTimeout) {
        clearTimeout(CanvasState.dragState.treeDragCleanupTimeout);
        CanvasState.dragState.treeDragCleanupTimeout = null;
    }
    if (CanvasState.dragState.treeDragItem && CanvasState.dragState.treeDragItem.classList) {
        CanvasState.dragState.treeDragItem.classList.remove('tree-drag-out');
        CanvasState.dragState.treeDragItem.classList.remove('tree-drag-leaving');
    }
    CanvasState.dragState.treeDragItem = null;
}

async function resolveBookmarkNode(data) {
    if (!data) {
        throw new Error('缺少拖拽数据');
    }
    
    // 数据已经是完整节点
    if (data.children || data.url) {
        return cloneBookmarkNode(data);
    }
    
    const targetId = data.id || data.nodeId;
    if (!targetId) {
        throw new Error('拖拽数据缺少ID');
    }
    
    if (browserAPI && browserAPI.bookmarks && browserAPI.bookmarks.getSubTree) {
        const nodes = await browserAPI.bookmarks.getSubTree(targetId);
        if (nodes && nodes.length > 0) {
            return cloneBookmarkNode(nodes[0]);
        }
    }
    
    throw new Error('无法获取书签数据，请确保扩展具有访问书签的权限');
}

function allocateTempItemId(sectionId) {
    return `temp-${sectionId}-${++CanvasState.tempItemCounter}`;
}

function convertBookmarkNodeToTempItem(node, sectionId) {
    if (!node) return null;
    
    const itemId = allocateTempItemId(sectionId);
    const item = {
        id: itemId,
        sectionId,
        title: node.title || (node.url || '未命名'),
        url: node.url || '',
        type: node.url ? 'bookmark' : 'folder',
        children: [],
        originalId: node.id || null,
        createdAt: Date.now()
    };
    
    if (node.children && node.children.length) {
        item.children = node.children
            .map(child => convertBookmarkNodeToTempItem(child, sectionId))
            .filter(Boolean);
    }
    
    return item;
}

function convertLegacyTempNode(legacyNode, index) {
    if (!legacyNode) return null;
    const sectionId = (legacyNode.id && typeof legacyNode.id === 'string')
        ? legacyNode.id
        : `temp-section-${index + 1}`;
    
    const section = {
        id: sectionId,
        title: (legacyNode.data && legacyNode.data.title) ? legacyNode.data.title : getDefaultTempSectionTitle(),
        color: pickTempSectionColor(),
        x: legacyNode.x || 0,
        y: legacyNode.y || 0,
        width: legacyNode.width || TEMP_SECTION_DEFAULT_WIDTH,
        height: legacyNode.height || TEMP_SECTION_DEFAULT_HEIGHT,
        createdAt: Date.now(),
        items: []
    };
    
    if (legacyNode.data) {
        const mapped = convertBookmarkNodeToTempItem(legacyNode.data, sectionId);
        if (mapped) {
            section.items.push(mapped);
        }
    }
    
    return section;
}

function refreshTempSectionCounters() {
    let maxSection = CanvasState.tempSectionCounter || 0;
    let maxItem = CanvasState.tempItemCounter || 0;
    
    const traverseItems = (items) => {
        if (!Array.isArray(items)) return;
        items.forEach(item => {
            if (item && typeof item.id === 'string') {
                const matchItem = item.id.match(/temp-[^-]+-(\d+)/);
                if (matchItem) {
                    const numericId = parseInt(matchItem[1], 10);
                    if (!Number.isNaN(numericId)) {
                        maxItem = Math.max(maxItem, numericId);
                    }
                }
            }
            if (item && item.children) {
                traverseItems(item.children);
            }
        });
    };
    
    CanvasState.tempSections.forEach(section => {
        if (section && typeof section.id === 'string') {
            const matchSection = section.id.match(/temp-section-(\d+)/);
            if (matchSection) {
                const numericId = parseInt(matchSection[1], 10);
                if (!Number.isNaN(numericId)) {
                    maxSection = Math.max(maxSection, numericId);
                }
            }
        }
        traverseItems(section.items);
    });
    
    CanvasState.tempSectionCounter = Math.max(CanvasState.tempSectionCounter, maxSection);
    CanvasState.tempItemCounter = Math.max(CanvasState.tempItemCounter, maxItem);
}

function getTempSection(sectionId) {
    if (!sectionId) return null;
    return CanvasState.tempSections.find(section => section.id === sectionId) || null;
}

function findTempItemEntry(sectionId, itemId) {
    const section = getTempSection(sectionId);
    if (!section || !itemId) return null;
    
    const stack = [{ items: section.items, parent: null }];
    
    while (stack.length) {
        const { items, parent } = stack.pop();
        for (let index = 0; index < items.length; index++) {
            const item = items[index];
            if (item.id === itemId) {
                return { section, item, parent, items, index };
            }
            if (item.children && item.children.length) {
                stack.push({ items: item.children, parent: item });
            }
        }
    }
    
    return null;
}

function serializeTempItemForClipboard(item) {
    if (!item) return null;
    return {
        title: item.title,
        url: item.url || '',
        type: item.type,
        children: (item.children || []).map(child => serializeTempItemForClipboard(child))
    };
}

function createTempItemFromPayload(sectionId, payload) {
    if (!payload) return null;
    const item = {
        id: allocateTempItemId(sectionId),
        sectionId,
        title: payload.title || (payload.url || '未命名'),
        url: payload.url || '',
        type: payload.type === 'folder' ? 'folder' : (payload.url ? 'bookmark' : 'folder'),
        children: [],
        originalId: null,
        createdAt: Date.now()
    };
    
    if (payload.children && payload.children.length) {
        item.children = payload.children
            .map(child => createTempItemFromPayload(sectionId, child))
            .filter(Boolean);
    }
    
    return item;
}

function reassignTempItemIds(sectionId, item) {
    if (!item) return;
    item.id = allocateTempItemId(sectionId);
    item.sectionId = sectionId;
    if (item.children && item.children.length) {
        item.children.forEach(child => reassignTempItemIds(sectionId, child));
    }
}

function insertTempItems(sectionId, parentId, items, index = null) {
    const section = getTempSection(sectionId);
    if (!section) throw new Error('未找到临时栏目');
    const targetItems = parentId 
        ? (findTempItemEntry(sectionId, parentId)?.item?.children || (() => { throw new Error('未找到目标文件夹'); })())
        : section.items;
    
    if (typeof index !== 'number' || index < 0 || index > targetItems.length) {
        index = targetItems.length;
    }
    
    items.forEach((item, offset) => {
        targetItems.splice(index + offset, 0, item);
    });
    
    renderTempNode(section);
    saveTempNodes();
}

function removeTempItemsById(sectionId, itemIds) {
    const removed = [];
    const ids = Array.isArray(itemIds) ? itemIds : [itemIds];
    
    ids.forEach(id => {
        const entry = findTempItemEntry(sectionId, id);
        if (entry) {
            const [item] = entry.items.splice(entry.index, 1);
            removed.push(item);
        }
    });
    
    const section = getTempSection(sectionId);
    if (section) {
        renderTempNode(section);
        saveTempNodes();
    }
    
    return removed;
}

function moveTempItemsWithinSection(sectionId, itemIds, targetParentId, index = null) {
    const section = getTempSection(sectionId);
    if (!section) throw new Error('未找到临时栏目');
    
    const ids = Array.isArray(itemIds) ? itemIds : [itemIds];
    const movingItems = ids
        .map(id => findTempItemEntry(sectionId, id))
        .filter(Boolean)
        .sort((a, b) => a.index - b.index);
    
    if (!movingItems.length) return;
    
    const targetEntry = targetParentId ? findTempItemEntry(sectionId, targetParentId) : null;
    const targetArray = targetEntry ? targetEntry.item.children : section.items;
    
    // Remove items from original positions (from bottom to top to keep indexes)
    for (let i = movingItems.length - 1; i >= 0; i--) {
        const entry = movingItems[i];
        entry.items.splice(entry.index, 1);
    }
    
    if (typeof index !== 'number' || index < 0 || index > targetArray.length) {
        index = targetArray.length;
    }
    
    movingItems.forEach((entry, offset) => {
        entry.item.sectionId = sectionId;
        targetArray.splice(index + offset, 0, entry.item);
    });
    
    renderTempNode(section);
    saveTempNodes();
}

function moveTempItemsAcrossSections(sourceSectionId, targetSectionId, itemIds, targetParentId, index = null) {
    const sourceSection = getTempSection(sourceSectionId);
    const targetSection = getTempSection(targetSectionId);
    if (!sourceSection || !targetSection) {
        throw new Error('移动失败：临时栏目不存在');
    }
    
    const ids = Array.isArray(itemIds) ? itemIds : [itemIds];
    const removedItems = [];
    ids.forEach(id => {
        const entry = findTempItemEntry(sourceSectionId, id);
        if (entry) {
            const [item] = entry.items.splice(entry.index, 1);
            if (item) {
                removedItems.push(item);
            }
        }
    });
    
    const targetArray = targetParentId ? (findTempItemEntry(targetSectionId, targetParentId)?.item?.children) : targetSection.items;
    if (!targetArray) {
        throw new Error('目标文件夹不存在');
    }
    
    if (typeof index !== 'number' || index < 0 || index > targetArray.length) {
        index = targetArray.length;
    }
    
    removedItems.forEach(item => reassignTempItemIds(targetSectionId, item));
    removedItems.forEach((item, offset) => {
        targetArray.splice(index + offset, 0, item);
    });
    
    renderTempNode(sourceSection);
    renderTempNode(targetSection);
    saveTempNodes();
}

function renameTempItem(sectionId, itemId, newTitle) {
    const entry = findTempItemEntry(sectionId, itemId);
    if (!entry) throw new Error('未找到临时节点');
    entry.item.title = newTitle;
    const section = entry.section;
    renderTempNode(section);
    saveTempNodes();
}

function updateTempBookmark(sectionId, itemId, updates) {
    const entry = findTempItemEntry(sectionId, itemId);
    if (!entry) throw new Error('未找到临时节点');
    
    if (typeof updates.title === 'string') {
        entry.item.title = updates.title;
    }
    if (typeof updates.url === 'string') {
        entry.item.url = updates.url;
        entry.item.type = updates.url ? 'bookmark' : entry.item.type;
    }
    
    renderTempNode(entry.section);
    saveTempNodes();
}

function ensureTempSectionRendered(sectionId) {
    const section = getTempSection(sectionId);
    if (section) {
        renderTempNode(section);
        saveTempNodes();
    }
}

function extractTempItemsPayload(sectionId, itemIds) {
    const ids = Array.isArray(itemIds) ? itemIds : [itemIds];
    const payload = [];
    ids.forEach(id => {
        const entry = findTempItemEntry(sectionId, id);
        if (entry) {
            payload.push(serializeTempItemForClipboard(entry.item));
        }
    });
    return payload;
}

function insertTempItemsFromPayload(sectionId, parentId, payloadItems, index = null) {
    const items = (payloadItems || []).map(item => createTempItemFromPayload(sectionId, item)).filter(Boolean);
    if (!items.length) return;
    insertTempItems(sectionId, parentId, items, index);
}

function createTempBookmark(sectionId, parentId, title, url) {
    const item = createTempItemFromPayload(sectionId, {
        title: title || '新建书签',
        url: url || 'https://',
        type: 'bookmark',
        children: []
    });
    insertTempItems(sectionId, parentId, [item]);
}

function createTempFolder(sectionId, parentId, title) {
    const item = createTempItemFromPayload(sectionId, {
        title: title || '新建文件夹',
        type: 'folder',
        children: []
    });
    insertTempItems(sectionId, parentId, [item]);
}

// =============================================================================
// 初始化Canvas视图
// =============================================================================

function initCanvasView() {
    console.log('[Canvas] 初始化Obsidian风格的Canvas');
    
    // 清除缓存的 DOM 引用（防止过期）
    cachedCanvasContainer = null;
    cachedCanvasContent = null;
    
    // 加载性能模式设置
    loadPerformanceMode();
    
    // 初始化连接线层
    setupCanvasEdgesLayer();
    
    // 显示缩放控制器
    const zoomIndicator = document.getElementById('canvasZoomIndicator');
    if (zoomIndicator) {
        zoomIndicator.style.display = 'block';
    }
    
    // 注意：永久栏目已经在renderCurrentView中从template创建并添加到canvas-content
    // bookmarkTree已经由renderTreeView()渲染了
    // 我们只需要增强它的拖拽功能
    
    enhanceBookmarkTreeForCanvas();
    
    // 让永久栏目可以拖动
    makePermanentSectionDraggable();
    
    // 设置Canvas缩放和平移
    setupCanvasZoomAndPan();
    
    // 加载临时节点
    loadTempNodes();
    
    // 初始化滚动条状态和事件
    loadCanvasScrollPreferences();
    setupCanvasScrollbars();
    updateCanvasScrollBounds(true);
    updateScrollbarThumbs();
    // 设置Canvas事件监听
    setupCanvasEventListeners();
    setupCanvasDropFeedback();
    setupPermanentSectionEdgeFeedback();
    
    // 设置永久栏目提示关闭按钮
    setupPermanentSectionTipClose();
    
    // 设置永久栏目置顶按钮
    setupPermanentSectionPinButton();
    
    // 设置连接线交互
    setupCanvasConnectionInteractions();
    addAnchorsToNode(document.getElementById('permanentSection'), 'permanent-section');
}

function setupCanvasDropFeedback() {
    const workspace = document.getElementById('canvasWorkspace');
    if (!workspace) return;
    workspace.addEventListener('dragenter', (e) => {
        if (CanvasState.dragState.dragSource === 'permanent') {
            workspace.classList.add('canvas-drop-active');
        }
    });
    workspace.addEventListener('dragleave', (e) => {
        if (!workspace.contains(e.relatedTarget)) {
            workspace.classList.remove('canvas-drop-active');
        }
    });
    workspace.addEventListener('dragover', (e) => {
        if (CanvasState.dragState.dragSource === 'permanent') {
            e.preventDefault();
            try { if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; } catch(_) {}
            workspace.classList.add('canvas-drop-active');
            const rect = workspace.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 100;
            const y = ((e.clientY - rect.top) / rect.height) * 100;
            workspace.style.setProperty('--drop-x', `${x}%`);
            workspace.style.setProperty('--drop-y', `${y}%`);
        }
    });
    workspace.addEventListener('drop', (e) => {
        try { e.preventDefault(); } catch(_) {}
        workspace.classList.remove('canvas-drop-active');
    });
}

// 当从永久栏目边界拖出时，给原条目切换为“替代UI”样式
function setupPermanentSectionEdgeFeedback() {
    const permanentSection = document.getElementById('permanentSection');
    if (!permanentSection) return;

    permanentSection.addEventListener('dragover', (e) => {
        if (CanvasState.dragState.dragSource === 'permanent' && CanvasState.dragState.treeDragItem) {
            CanvasState.dragState.treeDragItem.classList.remove('tree-drag-leaving');
        }
    });

    permanentSection.addEventListener('dragleave', (e) => {
        if (!permanentSection.contains(e.relatedTarget)) {
            if (CanvasState.dragState.dragSource === 'permanent' && CanvasState.dragState.treeDragItem) {
                CanvasState.dragState.treeDragItem.classList.add('tree-drag-leaving');
            }
        }
    });
}

// 复用的透明拖拽图片（1x1透明像素），用于隐藏原生回弹动画
let __transparentDragImg;
function getTransparentDragImage() {
    if (__transparentDragImg) return __transparentDragImg;
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    __transparentDragImg = canvas;
    return __transparentDragImg;
}

// =============================================================================
// 增强现有书签树的Canvas拖拽功能
// =============================================================================

function enhanceBookmarkTreeForCanvas() {
    const bookmarkTree = document.getElementById('bookmarkTree');
    if (!bookmarkTree) return;
    
    console.log('[Canvas] 为书签树添加Canvas拖拽功能');
    
    // 重要：不要覆盖原有的拖拽事件！
    // 原有的拖拽功能（bookmark_tree_drag_drop.js）已经通过 attachTreeEvents() 绑定了
    // 我们只需要添加额外的事件监听器来支持拖出到Canvas即可
    
    // 使用正确的选择器：.tree-item（不是.bookmark-item）
    const treeItems = bookmarkTree.querySelectorAll('.tree-item[data-node-id]');
    treeItems.forEach(item => {
        // 添加dragstart监听器，收集节点数据（不干扰原有拖拽）
        item.addEventListener('dragstart', function(e) {
            const nodeId = item.dataset.nodeId;
            const nodeTitle = item.dataset.nodeTitle;
            const nodeUrl = item.dataset.nodeUrl;
            const isFolder = item.dataset.nodeType === 'folder';
            
            // 保存到Canvas状态，仅存储必要的标识信息，完整数据稍后获取
            CanvasState.dragState.draggedData = {
                id: nodeId,
                title: nodeTitle,
                url: nodeUrl,
                type: isFolder ? 'folder' : 'bookmark',
                source: 'permanent',
                hasSnapshot: false
            };
            CanvasState.dragState.dragSource = 'permanent';
            
            // 设置拖拽数据（供外部系统识别）
            try {
                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'copyMove';
                }
                e.dataTransfer.setData('application/json', JSON.stringify({
                    id: nodeId,
                    title: nodeTitle,
                    url: nodeUrl,
                    type: isFolder ? 'folder' : 'bookmark'
                }));
            } catch (err) {
                console.warn('[Canvas] 设置拖拽数据失败:', err);
            }
            
            console.log('[Canvas] 拖拽数据已保存:', CanvasState.dragState.draggedData);

            markTreeItemDragging(item);

            const permanentSection = document.getElementById('permanentSection');
            if (permanentSection) {
                permanentSection.classList.add('drag-origin-active');
            }

            // 自定义替代UI：
            // - 单项拖出显示名称
            // - 批量选择拖出显示英文标识 "Multiple items"
            try {
                if (e.dataTransfer && typeof e.dataTransfer.setDragImage === 'function') {
                    let previewText = nodeTitle || nodeUrl || '';
                    try {
                        const ids = collectPermanentSelectionIds(nodeId);
                        if (Array.isArray(ids) && ids.length > 1) {
                            previewText = 'Multiple items';
                        }
                    } catch (_) {}
                    const preview = document.createElement('div');
                    preview.className = 'drag-preview';
                    preview.textContent = previewText || '';
                    preview.style.left = '-9999px';
                    document.body.appendChild(preview);
                    e.dataTransfer.setDragImage(preview, 0, 0);
                    setTimeout(() => preview.remove(), 0);
                }
            } catch (_) {}
        });
        
        // 添加dragend监听器，检查是否拖到Canvas
        item.addEventListener('dragend', async function(e) {
            if (CanvasState.dragState.dragSource !== 'permanent') return;
            
            // 防重复：检查是否正在创建或者时间间隔太短
            const now = Date.now();
            if (CanvasState.isCreatingTempNode || (now - CanvasState.lastDragEndTime < 300)) {
                console.log('[Canvas] 防重复：跳过重复的 dragend 事件');
                return;
            }
            
            const dropX = e.clientX;
            const dropY = e.clientY;
            
            // 检查是否拖到Canvas工作区
            const workspace = document.getElementById('canvasWorkspace');
            if (!workspace) return;
            
            const rect = workspace.getBoundingClientRect();
            let accepted = false;
            
            if (dropX >= rect.left && dropX <= rect.right && 
                dropY >= rect.top && dropY <= rect.bottom) {
                
                // 优先检查是否拖到现有的临时栏目上（通过 drop 事件处理）
                // 如果已经被 drop 事件处理过（拖到临时栏目），就不创建新栏目
                const elementAtPoint = document.elementFromPoint(dropX, dropY);
                const tempNode = elementAtPoint?.closest('.temp-canvas-node');
                const tempTree = elementAtPoint?.closest('.temp-bookmark-tree');
                // 如果落点位于永久栏目内，则视为在永久栏目内部操作，不创建临时栏目
                const permanentSection = document.getElementById('permanentSection');
                const insidePermanentDom = !!(elementAtPoint && permanentSection && elementAtPoint.closest('#permanentSection'));
                let insidePermanentRect = false;
                if (permanentSection) {
                    const pRect = permanentSection.getBoundingClientRect();
                    insidePermanentRect = dropX >= pRect.left && dropX <= pRect.right && dropY >= pRect.top && dropY <= pRect.bottom;
                }
                
                if (insidePermanentDom || insidePermanentRect) {
                    // 落点在永久栏目区域内，不创建临时栏目（避免内部移动误触发）
                    console.log('[Canvas] 拖拽位于永久栏目内，不创建临时栏目');
                    accepted = true;
                } else if (tempNode || tempTree) {
                    // 已经拖到现有临时栏目，由 drop 事件处理
                    console.log('[Canvas] 拖到现有临时栏目，不创建新栏目');
                    accepted = true;
                } else {
                    // 拖到空白区域，创建新临时栏目
                    const canvasX = (dropX - rect.left - CanvasState.panOffsetX) / CanvasState.zoom;
                    const canvasY = (dropY - rect.top - CanvasState.panOffsetY) / CanvasState.zoom;
                    
                    console.log('[Canvas] 拖到Canvas空白区域，创建新临时栏目:', { canvasX, canvasY });
                    
                    // 在Canvas上创建临时节点（支持多选合集）
                    if (CanvasState.dragState.draggedData) {
                        try {
                            // 标记正在创建，防止重复
                            CanvasState.isCreatingTempNode = true;
                            CanvasState.lastDragEndTime = now;
                            
                            let ids = [];
                            try {
                                ids = collectPermanentSelectionIds(CanvasState.dragState.draggedData.id || null) || [];
                            } catch(_) {}
                            if (Array.isArray(ids) && ids.length > 1) {
                                await createTempNode({ multi: true, permanentIds: ids }, canvasX, canvasY);
                            } else {
                                await createTempNode(CanvasState.dragState.draggedData, canvasX, canvasY);
                            }
                            accepted = true;
                        } catch (err) {
                            console.error('[Canvas] 创建临时栏目失败:', err);
                            alert('创建临时栏目失败: ' + err.message);
                        } finally {
                            // 延迟重置标志，确保所有 dragend 事件都被过滤
                            setTimeout(() => {
                                CanvasState.isCreatingTempNode = false;
                            }, 500);
                        }
                    }
                }
            }
            
            // 清理状态
            CanvasState.dragState.draggedData = null;
            CanvasState.dragState.dragSource = null;
            const permanentSection = document.getElementById('permanentSection');
            if (permanentSection) {
                permanentSection.classList.remove('drag-origin-active');
            }
            if (workspace) {
                workspace.classList.remove('canvas-drop-active');
            }

            // 接受落点后延迟还原树条目外观，避免“松手瞬间回弹”感
            scheduleClearTreeItemDragging(accepted ? 380 : 160);
        });
    });
    
    console.log('[Canvas] 已为', treeItems.length, '个节点添加Canvas拖拽支持');
}

// 这两个函数已废弃，不再需要，因为原有的拖拽功能已经足够
// handleExistingBookmarkDragStart 和 handleExistingFolderDragStart 已被移除

function createCanvasBookmarkElement(bookmark, isDraggable = true) {
    if (bookmark.url) {
        return createCanvasBookmarkItem(bookmark, isDraggable);
    } else {
        return createCanvasFolderItem(bookmark, isDraggable);
    }
}

function createCanvasBookmarkItem(bookmark, isDraggable) {
    const item = document.createElement('div');
    item.className = 'canvas-bookmark-item' + (isDraggable ? ' draggable' : '');
    item.dataset.bookmarkId = bookmark.id;
    item.dataset.bookmarkTitle = bookmark.title;
    item.dataset.bookmarkUrl = bookmark.url;
    
    // 图标
    const icon = document.createElement('img');
    icon.className = 'canvas-bookmark-icon';
    icon.src = getFaviconUrl(bookmark.url);
    icon.onerror = () => {
        icon.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23999"%3E%3Cpath d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"%3E%3C/path%3E%3C/svg%3E';
    };
    
    // 标题
    const title = document.createElement('span');
    title.className = 'canvas-bookmark-title';
    title.textContent = bookmark.title || bookmark.url;
    title.title = bookmark.title || bookmark.url;
    
    item.appendChild(icon);
    item.appendChild(title);
    
    // 点击打开链接
    item.addEventListener('click', (e) => {
        if (!CanvasState.dragState.isDragging && bookmark.url) {
            window.open(bookmark.url, '_blank');
        }
    });
    
    // 添加拖拽事件
    if (isDraggable) {
        item.draggable = true;
        item.addEventListener('dragstart', (e) => handlePermanentDragStart(e, bookmark, 'bookmark'));
        item.addEventListener('dragend', handlePermanentDragEnd);
    }
    
    return item;
}

function createCanvasFolderItem(folder, isDraggable) {
    const item = document.createElement('div');
    item.className = 'canvas-folder-item';
    item.dataset.folderId = folder.id;
    item.dataset.folderTitle = folder.title;
    
    // 文件夹头部
    const header = document.createElement('div');
    header.className = 'canvas-folder-header';
    
    // 图标
    const icon = document.createElement('i');
    icon.className = 'fas fa-folder canvas-folder-icon';
    
    // 标题
    const title = document.createElement('span');
    title.className = 'canvas-folder-title';
    title.textContent = folder.title || '未命名文件夹';
    
    header.appendChild(icon);
    header.appendChild(title);
    
    // 子节点容器
    const children = document.createElement('div');
    children.className = 'canvas-folder-children';
    
    if (folder.children) {
        folder.children.forEach(child => {
            const childElement = createCanvasBookmarkElement(child, isDraggable);
            children.appendChild(childElement);
        });
    }
    
    // 点击展开/折叠
    header.addEventListener('click', (e) => {
        if (!CanvasState.dragState.isDragging) {
            children.classList.toggle('collapsed');
            icon.classList.toggle('fa-folder');
            icon.classList.toggle('fa-folder-open');
        }
    });
    
    // 文件夹拖拽
    if (isDraggable) {
        header.draggable = true;
        header.addEventListener('dragstart', (e) => handlePermanentDragStart(e, folder, 'folder'));
        header.addEventListener('dragend', handlePermanentDragEnd);
    }
    
    item.appendChild(header);
    item.appendChild(children);
    
    return item;
}

// =============================================================================
// Canvas 缩放和平移功能
// =============================================================================


function setupCanvasZoomAndPan() {
    const workspace = document.getElementById('canvasWorkspace');
    const container = document.querySelector('.canvas-main-container');
    
    if (!workspace || !container) {
        console.warn('[Canvas] 找不到workspace或container元素');
        return;
    }
    
    console.log('[Canvas] 设置Obsidian风格的缩放和平移功能');
    
    // 加载保存的缩放级别
    loadCanvasZoom();
    setupCanvasFullscreenControls();
    
    // Ctrl + 滚轮缩放（以鼠标位置为中心）- 性能优化版本
    workspace.addEventListener('wheel', (e) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            
            // 标记正在滚动
            markScrolling();
            
            // 获取鼠标在viewport中的位置
            const rect = workspace.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            // 计算新的缩放级别 - 优化：更平滑的缩放速度
            const delta = -e.deltaY;
            const zoomSpeed = 0.0008; // 降低缩放速度，更平滑
            const oldZoom = CanvasState.zoom;
            const newZoom = Math.max(0.1, Math.min(3, oldZoom + delta * zoomSpeed));
            
            // 使用优化的缩放更新，滚动时跳过边界计算
            scheduleZoomUpdate(newZoom, mouseX, mouseY, { recomputeBounds: false, skipSave: false, skipScrollbarUpdate: true });
        } else if (shouldHandleCustomScroll(e)) {
            handleCanvasCustomScroll(e);
        }
    }, { passive: false });
    
    // 空格键按下 - 启用拖动模式
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && !e.repeat && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
            e.preventDefault();
            CanvasState.isSpacePressed = true;
            workspace.classList.add('space-pressed');
        }
    });
    
    document.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
            CanvasState.isSpacePressed = false;
            workspace.classList.remove('space-pressed');
            if (CanvasState.isPanning) {
                CanvasState.isPanning = false;
                workspace.classList.remove('panning');
            }
        }
    });
    
    // 空格 + 鼠标拖动画布（Obsidian方式）
    workspace.addEventListener('mousedown', (e) => {
        if (CanvasState.isSpacePressed) {
            e.preventDefault();
            CanvasState.isPanning = true;
            CanvasState.panStartX = e.clientX - CanvasState.panOffsetX;
            CanvasState.panStartY = e.clientY - CanvasState.panOffsetY;
            workspace.classList.add('panning');
        }
    });
    
    document.addEventListener('mousemove', (e) => {
        if (CanvasState.isPanning) {
            CanvasState.panOffsetX = e.clientX - CanvasState.panStartX;
            CanvasState.panOffsetY = e.clientY - CanvasState.panStartY;
            
            applyPanOffset();
        }
    });
    
    document.addEventListener('mouseup', () => {
        if (CanvasState.isPanning) {
            CanvasState.isPanning = false;
            workspace.classList.remove('panning');
            savePanOffsetThrottled();
        }
    });
    
    // 缩放按钮
    const zoomInBtn = document.getElementById('zoomInBtn');
    const zoomOutBtn = document.getElementById('zoomOutBtn');
    const zoomLocateBtn = document.getElementById('zoomLocateBtn');
    
    if (zoomInBtn) zoomInBtn.addEventListener('click', () => setCanvasZoom(CanvasState.zoom + 0.1));
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => setCanvasZoom(CanvasState.zoom - 0.1));
    if (zoomLocateBtn) zoomLocateBtn.addEventListener('click', locateToPermanentSection);
}

function setCanvasZoom(zoom, centerX = null, centerY = null, options = {}) {
    const container = document.querySelector('.canvas-main-container');
    const workspace = document.getElementById('canvasWorkspace');
    if (!container || !workspace) return;
    
    if (typeof options !== 'object' || options === null) {
        options = {};
    }
    const {
        recomputeBounds = false,
        skipSave = false,
        silent = false,
        skipScrollbarUpdate = false // 新增：跳过滚动条更新（滚动时使用）
    } = options;
    
    const oldZoom = CanvasState.zoom;
    
    // 限制缩放范围
    zoom = Math.max(0.1, Math.min(3, zoom));
    
    // 如果没有指定中心点，使用 workspace 的中心点
    if (centerX === null || centerY === null) {
        const workspaceRect = workspace.getBoundingClientRect();
        centerX = workspaceRect.width / 2;
        centerY = workspaceRect.height / 2;
    }
    
    // 计算中心点在 canvas-content 坐标系中的位置
    const canvasCenterX = (centerX - CanvasState.panOffsetX) / oldZoom;
    const canvasCenterY = (centerY - CanvasState.panOffsetY) / oldZoom;
    
    // 应用新的缩放
    CanvasState.zoom = zoom;
    
    // 调整平移偏移，使中心点保持在相同的视觉位置
    CanvasState.panOffsetX = centerX - canvasCenterX * zoom;
    CanvasState.panOffsetY = centerY - canvasCenterY * zoom;
    
    // 优化：滚动时延迟更新边界
    if (!skipScrollbarUpdate) {
        container.style.setProperty('--canvas-scale', zoom);
        updateCanvasScrollBounds({ initial: false, recomputeBounds });
        savePanOffsetThrottled();
    } else {
        // 滚动时使用极速平移（直接 transform）
        applyPanOffsetFast();
    }
    
    // 更新显示
    const zoomValue = document.getElementById('zoomValue');
    if (zoomValue) {
        zoomValue.textContent = Math.round(zoom * 100) + '%';
    }
    
    // 保存缩放级别
    if (!skipSave) {
        saveZoomThrottled(zoom);
    }
    
    if (!silent) {
        console.log('[Canvas] 缩放:', Math.round(zoom * 100) + '%', '中心点:', { canvasCenterX, canvasCenterY });
    }
}

function applyPanOffset() {
    const container = getCachedContainer();
    const content = getCachedContent();
    if (!container || !content) return;
    
    // 不要自动限制滚动位置，允许用户自由滚动到空白区域
    // CanvasState.panOffsetX = clampPan('horizontal', CanvasState.panOffsetX);
    // CanvasState.panOffsetY = clampPan('vertical', CanvasState.panOffsetY);
    
    // 优化：滚动时使用 transform 直接操作，停止时才用 CSS 变量
    if (isScrolling) {
        const scale = CanvasState.zoom;
        const translateX = CanvasState.panOffsetX / scale;
        const translateY = CanvasState.panOffsetY / scale;
        // 使用 translate3d 启用硬件加速
        content.style.transform = `scale(${scale}) translate3d(${translateX}px, ${translateY}px, 0)`;
    } else {
        // 停止时使用 CSS 变量（兼容性）
        container.style.setProperty('--canvas-pan-x', `${CanvasState.panOffsetX}px`);
        container.style.setProperty('--canvas-pan-y', `${CanvasState.panOffsetY}px`);
        content.style.transform = ''; // 清除直接 transform
        
        // 调度滚动条更新
        scheduleScrollbarUpdate();
    }
    
    if (!CanvasState.scrollAnimation.frameId) {
        CanvasState.scrollAnimation.targetX = CanvasState.panOffsetX;
        CanvasState.scrollAnimation.targetY = CanvasState.panOffsetY;
    }
}

// 性能优化：极速平移（使用 transform，完全跳过边界检查和滚动条）
function applyPanOffsetFast() {
    const content = getCachedContent();
    if (!content) return;
    
    // 直接使用 transform，跳过 clampPan 和 CSS 变量
    // transform 只触发合成，性能最优
    const scale = CanvasState.zoom;
    const translateX = CanvasState.panOffsetX / scale;
    const translateY = CanvasState.panOffsetY / scale;
    
    // 使用 translate3d 启用硬件加速
    content.style.transform = `scale(${scale}) translate3d(${translateX}px, ${translateY}px, 0)`;
}

// 性能优化：标记正在滚动
function markScrolling() {
    isScrolling = true;
    
    // 清除之前的停止计时器
    if (scrollStopTimer) {
        clearTimeout(scrollStopTimer);
    }
    
    // 设置新的停止计时器
    scrollStopTimer = setTimeout(() => {
        isScrolling = false;
        onScrollStop();
    }, SCROLL_STOP_DELAY);
}

// 性能优化：滚动停止后的处理
function onScrollStop() {
    // 滚动停止后，恢复 CSS 变量模式
    const container = getCachedContainer();
    const content = getCachedContent();
    
    if (container && content) {
        // 恢复使用 CSS 变量
        container.style.setProperty('--canvas-scale', CanvasState.zoom);
        container.style.setProperty('--canvas-pan-x', `${CanvasState.panOffsetX}px`);
        container.style.setProperty('--canvas-pan-y', `${CanvasState.panOffsetY}px`);
        content.style.transform = ''; // 清除直接 transform
    }
    
    // 更新边界和滚动条
    scheduleBoundsUpdate();
    scheduleScrollbarUpdate();
    savePanOffsetThrottled();
    
    // 更新休眠状态
    scheduleDormancyUpdate();
}

// 性能优化：调度休眠管理更新（节流）
function scheduleDormancyUpdate() {
    if (dormancyUpdatePending) return;
    
    dormancyUpdatePending = true;
    
    if (dormancyUpdateTimer) {
        clearTimeout(dormancyUpdateTimer);
    }
    
    dormancyUpdateTimer = setTimeout(() => {
        dormancyUpdateTimer = null;
        dormancyUpdatePending = false;
        manageSectionDormancy();
    }, 200); // 200ms 延迟
}

// 性能优化：调度滚动条更新（使用 RAF 去抖）
function scheduleScrollbarUpdate() {
    if (scrollbarUpdatePending) return;
    
    scrollbarUpdatePending = true;
    
    if (scrollbarUpdateFrame) {
        cancelAnimationFrame(scrollbarUpdateFrame);
    }
    
    scrollbarUpdateFrame = requestAnimationFrame(() => {
        scrollbarUpdateFrame = null;
        scrollbarUpdatePending = false;
        updateScrollbarThumbs();
    });
}

// 性能优化：调度边界更新（使用 RAF 去抖）
function scheduleBoundsUpdate() {
    if (boundsUpdatePending) return;
    
    boundsUpdatePending = true;
    
    if (boundsUpdateFrame) {
        cancelAnimationFrame(boundsUpdateFrame);
    }
    
    boundsUpdateFrame = requestAnimationFrame(() => {
        boundsUpdateFrame = null;
        boundsUpdatePending = false;
        updateCanvasScrollBounds({ initial: false, recomputeBounds: true });
    });
}

function loadCanvasZoom() {
    try {
        const saved = localStorage.getItem('canvas-zoom');
        if (saved) {
            const zoom = parseFloat(saved);
            if (!isNaN(zoom)) {
                setCanvasZoom(zoom, null, null, { recomputeBounds: false, skipSave: true, silent: true });
            }
        }
        
        // 加载平移位置
        const panData = localStorage.getItem('canvas-pan');
        if (panData) {
            const pan = JSON.parse(panData);
            CanvasState.panOffsetX = pan.x || 0;
            CanvasState.panOffsetY = pan.y || 0;
            applyPanOffset();
        }
    } catch (error) {
        console.error('[Canvas] 加载画布状态失败:', error);
    }
    
    updateCanvasScrollBounds(true);
    updateScrollbarThumbs();
}

function savePanOffset() {
    localStorage.setItem('canvas-pan', JSON.stringify({
        x: CanvasState.panOffsetX,
        y: CanvasState.panOffsetY
    }));
}

function savePanOffsetThrottled() {
    if (panSaveTimeout) {
        clearTimeout(panSaveTimeout);
    }
    panSaveTimeout = setTimeout(() => {
        savePanOffset();
        panSaveTimeout = null;
    }, 160);
}

function saveZoomThrottled(zoom) {
    if (zoomSaveTimeout) {
        clearTimeout(zoomSaveTimeout);
    }
    zoomSaveTimeout = setTimeout(() => {
        localStorage.setItem('canvas-zoom', zoom.toString());
        zoomSaveTimeout = null;
    }, 160);
}

function scheduleZoomUpdate(zoom, centerX, centerY, options = {}) {
    pendingZoomRequest = {
        zoom,
        centerX,
        centerY,
        options
    };
    
    if (!zoomUpdateFrame) {
        zoomUpdateFrame = requestAnimationFrame(() => {
            zoomUpdateFrame = null;
            if (!pendingZoomRequest) return;
            
            const { zoom, centerX, centerY, options } = pendingZoomRequest;
            pendingZoomRequest = null;
            setCanvasZoom(zoom, centerX, centerY, options);
        });
    }
}

function loadCanvasScrollPreferences() {
    try {
        const stored = localStorage.getItem('canvas-scroll-preferences');
        if (!stored) return;
        
        const parsed = JSON.parse(stored);
        ['vertical', 'horizontal'].forEach(axis => {
            if (parsed[axis]) {
                CanvasState.scrollState[axis].hidden = Boolean(parsed[axis].hidden);
                CanvasState.scrollState[axis].disabled = Boolean(parsed[axis].disabled);
            }
        });
    } catch (error) {
        console.error('[Canvas] 加载滚动条偏好失败:', error);
    }
}

function persistCanvasScrollPreferences() {
    try {
        const payload = {
            vertical: {
                hidden: CanvasState.scrollState.vertical.hidden,
                disabled: CanvasState.scrollState.vertical.disabled
            },
            horizontal: {
                hidden: CanvasState.scrollState.horizontal.hidden,
                disabled: CanvasState.scrollState.horizontal.disabled
            }
        };
        localStorage.setItem('canvas-scroll-preferences', JSON.stringify(payload));
    } catch (error) {
        console.error('[Canvas] 保存滚动条偏好失败:', error);
    }
}

function setupCanvasScrollbars() {
    const verticalBar = document.getElementById('canvasVerticalScrollbar');
    const horizontalBar = document.getElementById('canvasHorizontalScrollbar');
    
    if (!verticalBar && !horizontalBar) return;
    
    const bars = [
        { axis: 'vertical', element: verticalBar },
        { axis: 'horizontal', element: horizontalBar }
    ];
    
    bars.forEach(({ axis, element }) => {
        if (!element) return;
        
        element.classList.toggle('is-hidden', CanvasState.scrollState[axis].hidden);
        element.classList.toggle('is-disabled', CanvasState.scrollState[axis].disabled);
        element.classList.remove('show-controls');
        
        const hideBtn = element.querySelector('.scrollbar-btn.scroll-hide');
        const disableBtn = element.querySelector('.scrollbar-btn.scroll-disable');
        const thumb = element.querySelector('.scrollbar-thumb');
        const controls = element.querySelector('.scrollbar-controls');
        
        if (hideBtn) {
            hideBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                toggleScrollbarHidden(axis);
                flashScrollbarControls(element);
            });
        }
        
        if (disableBtn) {
            disableBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                toggleScrollbarDisabled(axis);
                flashScrollbarControls(element);
            });
        }
        
        if (thumb) {
            thumb.addEventListener('mousedown', (event) => startScrollbarThumbDrag(event, axis));
        }
        
        attachScrollbarHoverHandlers(element, axis);
    });
    
    if (!CanvasState.scrollState.handlersAttached) {
        document.addEventListener('mousemove', handleScrollbarThumbDrag);
        document.addEventListener('mouseup', stopScrollbarThumbDrag);
        CanvasState.scrollState.handlersAttached = true;
    }
    
    updateScrollbarControls('vertical');
    updateScrollbarControls('horizontal');
    updateScrollbarThumbs();
}

function toggleScrollbarHidden(axis) {
    CanvasState.scrollState[axis].hidden = !CanvasState.scrollState[axis].hidden;
    const bar = axis === 'vertical' ? document.getElementById('canvasVerticalScrollbar') : document.getElementById('canvasHorizontalScrollbar');
    if (bar) {
        bar.classList.toggle('is-hidden', CanvasState.scrollState[axis].hidden);
    }
    updateScrollbarControls(axis);
    updateScrollbarThumbs();
    persistCanvasScrollPreferences();
}

function toggleScrollbarDisabled(axis) {
    CanvasState.scrollState[axis].disabled = !CanvasState.scrollState[axis].disabled;
    const bar = axis === 'vertical' ? document.getElementById('canvasVerticalScrollbar') : document.getElementById('canvasHorizontalScrollbar');
    if (bar) {
        bar.classList.toggle('is-disabled', CanvasState.scrollState[axis].disabled);
    }
    updateScrollbarControls(axis);
    persistCanvasScrollPreferences();
}

function updateScrollbarControls(axis) {
    const bar = axis === 'vertical' ? document.getElementById('canvasVerticalScrollbar') : document.getElementById('canvasHorizontalScrollbar');
    if (!bar) return;
    
    const hideBtn = bar.querySelector('.scrollbar-btn.scroll-hide');
    const hideIcon = hideBtn ? hideBtn.querySelector('i') : null;
    const disableBtn = bar.querySelector('.scrollbar-btn.scroll-disable');
    const disableIcon = disableBtn ? disableBtn.querySelector('i') : null;
    const axisLabel = axis === 'vertical' ? '纵向' : '横向';
    
    bar.classList.toggle('is-hidden', CanvasState.scrollState[axis].hidden);
    bar.classList.toggle('is-disabled', CanvasState.scrollState[axis].disabled);
    
    if (hideBtn) {
        const label = CanvasState.scrollState[axis].hidden ? `显示${axisLabel}滚动条` : `隐藏${axisLabel}滚动条`;
        hideBtn.setAttribute('aria-label', label);
        hideBtn.removeAttribute('title');
    }
    if (hideIcon) {
        hideIcon.className = CanvasState.scrollState[axis].hidden ? 'fas fa-eye' : 'fas fa-eye-slash';
    }
    if (disableBtn) {
        const label = CanvasState.scrollState[axis].disabled ? `启用${axisLabel}滚动` : `禁用${axisLabel}滚动`;
        disableBtn.setAttribute('aria-label', label);
        disableBtn.removeAttribute('title');
    }
    if (disableIcon) {
        disableIcon.className = CanvasState.scrollState[axis].disabled ? 'fas fa-unlock' : 'fas fa-ban';
    }
}

function startScrollbarThumbDrag(event, axis) {
    if (CanvasState.scrollState[axis].disabled) return;
    
    const bar = axis === 'vertical' ? document.getElementById('canvasVerticalScrollbar') : document.getElementById('canvasHorizontalScrollbar');
    if (!bar) return;
    
    const track = bar.querySelector('.scrollbar-track');
    const thumb = bar.querySelector('.scrollbar-thumb');
    if (!track || !thumb) return;
    
    event.preventDefault();
    
    const trackRect = track.getBoundingClientRect();
    const thumbRect = thumb.getBoundingClientRect();
    const offset = axis === 'vertical' ? event.clientY - thumbRect.top : event.clientX - thumbRect.left;
    
    if (CanvasState.scrollAnimation.frameId) {
        cancelAnimationFrame(CanvasState.scrollAnimation.frameId);
        CanvasState.scrollAnimation.frameId = null;
    }
    CanvasState.scrollAnimation.targetX = CanvasState.panOffsetX;
    CanvasState.scrollAnimation.targetY = CanvasState.panOffsetY;
    
    CanvasState.scrollState.activeDragAxis = axis;
    CanvasState.scrollState.dragInfo = {
        offset,
        trackSize: axis === 'vertical' ? trackRect.height : trackRect.width,
        thumbSize: axis === 'vertical' ? thumbRect.height : thumbRect.width
    };
    
    CanvasState.scrollState[axis].dragging = true;
    thumb.classList.add('dragging');
}

function handleScrollbarThumbDrag(event) {
    const axis = CanvasState.scrollState.activeDragAxis;
    if (!axis) return;
    
    if (CanvasState.scrollState[axis].disabled) return;
    
    const bar = axis === 'vertical' ? document.getElementById('canvasVerticalScrollbar') : document.getElementById('canvasHorizontalScrollbar');
    if (!bar) return;
    
    const track = bar.querySelector('.scrollbar-track');
    const thumb = bar.querySelector('.scrollbar-thumb');
    const info = CanvasState.scrollState.dragInfo;
    if (!track || !thumb || !info) return;
    
    event.preventDefault();
    
    const trackRect = track.getBoundingClientRect();
    const coord = axis === 'vertical'
        ? event.clientY - trackRect.top - info.offset
        : event.clientX - trackRect.left - info.offset;
    const maxTravel = Math.max(0, info.trackSize - info.thumbSize);
    const clampedCoord = Math.min(Math.max(coord, 0), maxTravel);
    const ratio = maxTravel === 0 ? 0 : clampedCoord / maxTravel;
    const bounds = axis === 'vertical' ? CanvasState.scrollBounds.vertical : CanvasState.scrollBounds.horizontal;
    const target = bounds.max - ratio * (bounds.max - bounds.min);
    
    if (axis === 'vertical') {
        CanvasState.panOffsetY = target;
    } else {
        CanvasState.panOffsetX = target;
    }
    
    applyPanOffset();
}

function stopScrollbarThumbDrag() {
    const axis = CanvasState.scrollState.activeDragAxis;
    if (!axis) return;
    
    const bar = axis === 'vertical' ? document.getElementById('canvasVerticalScrollbar') : document.getElementById('canvasHorizontalScrollbar');
    const thumb = bar ? bar.querySelector('.scrollbar-thumb') : null;
    
    if (thumb) {
        thumb.classList.remove('dragging');
    }
    
    CanvasState.scrollState[axis].dragging = false;
    CanvasState.scrollState.activeDragAxis = null;
    CanvasState.scrollState.dragInfo = null;
    savePanOffsetThrottled();
}

function attachScrollbarHoverHandlers(bar, axis) {
    if (!bar) return;
    const controls = bar.querySelector('.scrollbar-controls');
    if (!controls || scrollbarHoverState.has(bar)) return;
    
    const state = {
        axis,
        hideTimer: null,
        flashTimer: null,
        pointerInside: false
    };
    
    const showControls = () => {
        if (state.hideTimer) {
            clearTimeout(state.hideTimer);
            state.hideTimer = null;
        }
        bar.classList.add('show-controls');
    };
    
    const hideControls = () => {
        if (state.hideTimer) {
            clearTimeout(state.hideTimer);
        }
        state.hideTimer = setTimeout(() => {
            if (state.pointerInside) return;
            bar.classList.remove('show-controls');
            state.hideTimer = null;
        }, 220);
    };
    
    const enterControls = () => {
        state.pointerInside = true;
        showControls();
    };
    
    const leaveControls = () => {
        state.pointerInside = false;
        hideControls();
    };
    
    controls.addEventListener('mouseenter', enterControls);
    controls.addEventListener('focusin', enterControls);
    controls.addEventListener('mouseleave', leaveControls);
    controls.addEventListener('focusout', leaveControls);
    bar.addEventListener('mouseleave', leaveControls);
    
    state.show = showControls;
    state.hide = hideControls;
    
    scrollbarHoverState.set(bar, state);
}

function flashScrollbarControls(bar, duration = 900) {
    const state = scrollbarHoverState.get(bar);
    if (!state) return;

    state.show();
    if (state.flashTimer) {
        clearTimeout(state.flashTimer);
    }
    state.flashTimer = setTimeout(() => {
        if (!state.pointerInside) {
            bar.classList.remove('show-controls');
        }
        state.flashTimer = null;
    }, duration);
}

function setupCanvasFullscreenControls() {
    const btn = document.getElementById('canvasFullscreenBtn');
    const container = document.querySelector('.canvas-main-container');
    if (!btn || !container) return;

    const canRequestFullscreen = container.requestFullscreen ||
        container.webkitRequestFullscreen ||
        container.mozRequestFullScreen ||
        container.msRequestFullscreen;
    if (!canRequestFullscreen) {
        btn.style.display = 'none';
        return;
    }

    if (!CanvasState.fullscreenHandlersBound) {
        btn.addEventListener('click', toggleCanvasFullscreen);
        document.addEventListener('fullscreenchange', handleCanvasFullscreenChange);
        CanvasState.fullscreenHandlersBound = true;
    }

    updateFullscreenButtonState();
}

function toggleCanvasFullscreen() {
    const container = document.querySelector('.canvas-main-container');
    if (!container) return;

    const fullscreenElement = getCurrentFullscreenElement();
    if (fullscreenElement === container) {
        const exit = document.exitFullscreen ||
            document.webkitExitFullscreen ||
            document.mozCancelFullScreen ||
            document.msExitFullscreen;
        if (exit) {
            Promise.resolve(exit.call(document)).catch(error => {
                console.warn('[Canvas] 退出全屏失败:', error);
            });
        }
        return;
    }

    const request = container.requestFullscreen ||
        container.webkitRequestFullscreen ||
        container.mozRequestFullScreen ||
        container.msRequestFullscreen;
    if (request) {
        Promise.resolve(request.call(container)).catch(error => {
            console.warn('[Canvas] 进入全屏失败:', error);
        });
    }
}

function handleCanvasFullscreenChange() {
    const container = document.querySelector('.canvas-main-container');
    CanvasState.isFullscreen = getCurrentFullscreenElement() === container;
    updateFullscreenButtonState();
}

function updateFullscreenButtonState() {
    const btn = document.getElementById('canvasFullscreenBtn');
    const container = document.querySelector('.canvas-main-container');
    if (!btn || !container) return;

    const lang = getCanvasLanguage();
    const enterLabel = getFullscreenLabel('canvasFullscreenEnter', lang);
    const exitLabel = getFullscreenLabel('canvasFullscreenExit', lang);
    const isFullscreen = getCurrentFullscreenElement() === container;

    CanvasState.isFullscreen = isFullscreen;
    const text = isFullscreen ? exitLabel : enterLabel;
    btn.textContent = text;
    btn.setAttribute('aria-label', text);
    btn.setAttribute('aria-pressed', isFullscreen ? 'true' : 'false');
    btn.classList.toggle('fullscreen-active', isFullscreen);
}

function getCanvasLanguage() {
    if (typeof window !== 'undefined' && window.currentLang) {
        return window.currentLang === 'en' ? 'en' : 'zh_CN';
    }
    return 'zh_CN';
}

function getFullscreenLabel(key, lang) {
    if (window.i18n && window.i18n[key] && window.i18n[key][lang]) {
        return window.i18n[key][lang];
    }
    if (key === 'canvasFullscreenExit') {
        return lang === 'en' ? 'Exit' : '退出';
    }
    return lang === 'en' ? 'Fullscreen' : '全屏';
}

function getCurrentFullscreenElement() {
    return document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement || null;
}

function shouldHandleCustomScroll(event) {
    const workspace = document.getElementById('canvasWorkspace');
    if (!workspace || !workspace.contains(event.target)) {
        return false;
    }
    
    const scrollbarElement = event.target.closest('.canvas-scrollbar');
    if (scrollbarElement) {
        const axisKey = scrollbarElement.classList.contains('horizontal') ? 'horizontal' : 'vertical';
        const axisState = CanvasState.scrollState[axisKey];
        const controlsArea = event.target.closest('.scrollbar-controls');
        if (!axisState) {
            return false;
        }
        if (controlsArea) {
            return false;
        }
        if (!axisState.hidden) {
            return false;
        }
    }
    
    if (event.target.closest('.permanent-section-body') || event.target.closest('.temp-node-body')) {
        return false;
    }
    
    if (CanvasState.scrollState.vertical.disabled && CanvasState.scrollState.horizontal.disabled) {
        return false;
    }
    
    return true;
}

function handleCanvasCustomScroll(event) {
    const horizontalEnabled = !CanvasState.scrollState.horizontal.disabled;
    const verticalEnabled = !CanvasState.scrollState.vertical.disabled;
    
    if (!horizontalEnabled && !verticalEnabled) {
        return;
    }
    
    // 标记正在滚动
    markScrolling();
    
    let horizontalDelta = event.deltaX;
    let verticalDelta = event.deltaY;
    
    if (event.shiftKey && horizontalEnabled) {
        horizontalDelta = horizontalDelta !== 0 ? horizontalDelta : verticalDelta;
        verticalDelta = 0;
    }
    
    // 极简处理：直接更新，不做任何判断
    let hasUpdate = false;
    const scrollFactor = 1.0 / (CanvasState.zoom || 1); // 内联计算
    
    if (horizontalEnabled && horizontalDelta !== 0) {
        CanvasState.panOffsetX -= horizontalDelta * scrollFactor;
        hasUpdate = true;
    }
    
    if (verticalEnabled && verticalDelta !== 0) {
        CanvasState.panOffsetY -= verticalDelta * scrollFactor;
        hasUpdate = true;
    }
    
    if (hasUpdate) {
        // 直接应用，最快路径
        applyPanOffsetFast();
        event.preventDefault();
    }
}

function getScrollFactor(axis) {
    // 极简计算，提升性能
    const zoom = CanvasState.zoom || 1;
    // 直接线性缩放，避免 Math.pow 计算
    const base = axis === 'vertical' ? 1.0 : 1.0;
    return base / zoom;
}

function getScrollEaseFactor(axis) {
    const zoom = Math.max(CanvasState.zoom || 1, 0.1);
    const base = axis === 'horizontal' ? 0.35 : 0.33;
    const zoomBoost = zoom > 1
        ? Math.min(0.18, (zoom - 1) * 0.12)
        : (1 - zoom) * 0.08;
    return Math.min(0.52, base + zoomBoost);
}

function schedulePanTo(targetX, targetY) {
    if (typeof targetX === 'number') {
        // 只在动画滚动到特定位置时才限制（比如双击居中），允许一定的边界
        CanvasState.scrollAnimation.targetX = clampPan('horizontal', targetX);
    }
    if (typeof targetY === 'number') {
        CanvasState.scrollAnimation.targetY = clampPan('vertical', targetY);
    }
    
    if (!CanvasState.scrollAnimation.frameId) {
        CanvasState.scrollAnimation.frameId = requestAnimationFrame(runScrollAnimation);
    }
}

function runScrollAnimation() {
    let continueAnimation = false;
    
    if (typeof CanvasState.scrollAnimation.targetX === 'number') {
        const diffX = CanvasState.scrollAnimation.targetX - CanvasState.panOffsetX;
        if (Math.abs(diffX) > 0.5) {
            CanvasState.panOffsetX += diffX * getScrollEaseFactor('horizontal');
            continueAnimation = true;
        } else {
            CanvasState.panOffsetX = CanvasState.scrollAnimation.targetX;
        }
    }
    
    if (typeof CanvasState.scrollAnimation.targetY === 'number') {
        const diffY = CanvasState.scrollAnimation.targetY - CanvasState.panOffsetY;
        if (Math.abs(diffY) > 0.5) {
            CanvasState.panOffsetY += diffY * getScrollEaseFactor('vertical');
            continueAnimation = true;
        } else {
            CanvasState.panOffsetY = CanvasState.scrollAnimation.targetY;
        }
    }
    
    // 优化：使用快速平移（不更新滚动条）
    applyPanOffsetFast();
    
    if (continueAnimation) {
        CanvasState.scrollAnimation.frameId = requestAnimationFrame(runScrollAnimation);
    } else {
        CanvasState.scrollAnimation.frameId = null;
        CanvasState.scrollAnimation.targetX = CanvasState.panOffsetX;
        CanvasState.scrollAnimation.targetY = CanvasState.panOffsetY;
        
        // 动画结束后更新滚动条
        scheduleScrollbarUpdate();
        savePanOffsetThrottled();
    }
}

function updateCanvasScrollBounds(options = {}) {
    const workspace = document.getElementById('canvasWorkspace');
    if (!workspace) return;
    
    let initial = false;
    let recomputeBounds = true;
    
    if (typeof options === 'boolean') {
        initial = options;
    } else if (options && typeof options === 'object') {
        initial = Boolean(options.initial);
        if (Object.prototype.hasOwnProperty.call(options, 'recomputeBounds')) {
            recomputeBounds = options.recomputeBounds;
        }
    }
    
    let bounds = CanvasState.contentBounds;
    if (recomputeBounds || !bounds) {
        bounds = computeCanvasContentBounds();
        CanvasState.contentBounds = bounds;
    } else if (!bounds) {
        bounds = computeCanvasContentBounds();
        CanvasState.contentBounds = bounds;
    }
    
    const zoom = Math.max(CanvasState.zoom || 1, 0.1);
    const workspaceWidth = workspace.clientWidth || 1;
    const workspaceHeight = workspace.clientHeight || 1;
    
    // 允许滚动到内容区域外的空白区域
    const minPanX = workspaceWidth - CANVAS_SCROLL_MARGIN - bounds.maxX * zoom - CANVAS_SCROLL_EXTRA_SPACE;
    const maxPanX = CANVAS_SCROLL_MARGIN - bounds.minX * zoom + CANVAS_SCROLL_EXTRA_SPACE;
    const minPanY = workspaceHeight - CANVAS_SCROLL_MARGIN - bounds.maxY * zoom - CANVAS_SCROLL_EXTRA_SPACE;
    const maxPanY = CANVAS_SCROLL_MARGIN - bounds.minY * zoom + CANVAS_SCROLL_EXTRA_SPACE;
    
    CanvasState.scrollBounds.horizontal = normalizeScrollBounds(minPanX, maxPanX, workspaceWidth);
    CanvasState.scrollBounds.vertical = normalizeScrollBounds(minPanY, maxPanY, workspaceHeight);
    
    // 不要自动限制滚动位置，允许用户滚动到空白区域
    // CanvasState.panOffsetX = clampPan('horizontal', CanvasState.panOffsetX);
    // CanvasState.panOffsetY = clampPan('vertical', CanvasState.panOffsetY);
    
    if (!initial) {
        applyPanOffset();
    }
}

function normalizeScrollBounds(min, max, fallbackSize) {
    if (!isFinite(min) || !isFinite(max)) {
        const half = fallbackSize * 0.5;
        return { min: -half, max: half };
    }
    
    if (min === max) {
        const half = Math.max(fallbackSize * 0.5, 200);
        return { min: min - half, max: max + half };
    }
    
    if (min > max) {
        const center = (min + max) / 2;
        const half = Math.max(fallbackSize * 0.5, 200);
        return { min: center - half, max: center + half };
    }
    
    const span = max - min;
    if (span < fallbackSize * 0.3) {
        const center = (min + max) / 2;
        const half = Math.max(span / 2, fallbackSize * 0.3);
        return { min: center - half, max: center + half };
    }
    
    return { min, max };
}

function computeCanvasContentBounds() {
    const permanentSection = document.getElementById('permanentSection');
    
    let minX = 0;
    let maxX = 0;
    let minY = 0;
    let maxY = 0;
    let hasContent = false;
    
    if (permanentSection) {
        const left = parseFloat(permanentSection.style.left) || 0;
        const top = parseFloat(permanentSection.style.top) || 0;
        const width = permanentSection.offsetWidth || 0;
        const height = permanentSection.offsetHeight || 0;
        minX = Math.min(minX, left);
        maxX = Math.max(maxX, left + width);
        minY = Math.min(minY, top);
        maxY = Math.max(maxY, top + height);
        hasContent = true;
    }
    
    CanvasState.tempSections.forEach(section => {
        const width = section.width || TEMP_SECTION_DEFAULT_WIDTH;
        const height = section.height || TEMP_SECTION_DEFAULT_HEIGHT;
        minX = Math.min(minX, section.x);
        maxX = Math.max(maxX, section.x + width);
        minY = Math.min(minY, section.y);
        maxY = Math.max(maxY, section.y + height);
        hasContent = true;
    });
    // 计算 Markdown 文本节点范围
    if (Array.isArray(CanvasState.mdNodes)) {
        CanvasState.mdNodes.forEach(node => {
            const width = node.width || MD_NODE_DEFAULT_WIDTH;
            const height = node.height || MD_NODE_DEFAULT_HEIGHT;
            minX = Math.min(minX, node.x);
            maxX = Math.max(maxX, node.x + width);
            minY = Math.min(minY, node.y);
            maxY = Math.max(maxY, node.y + height);
            hasContent = true;
        });
    }
    
    if (!hasContent) {
        minX = -400;
        maxX = 400;
        minY = -300;
        maxY = 300;
    }
    
    return {
        minX: minX - 80,
        maxX: maxX + 80,
        minY: minY - 80,
        maxY: maxY + 80
    };
}

function clampPan(axis, value) {
    const bounds = axis === 'horizontal'
        ? CanvasState.scrollBounds.horizontal
        : CanvasState.scrollBounds.vertical;
    
    if (!bounds) return value;
    if (value < bounds.min) return bounds.min;
    if (value > bounds.max) return bounds.max;
    return value;
}

function updateScrollbarThumbs() {
    const workspace = document.getElementById('canvasWorkspace');
    if (!workspace) return;
    
    const verticalBar = document.getElementById('canvasVerticalScrollbar');
    const horizontalBar = document.getElementById('canvasHorizontalScrollbar');
    
    if (verticalBar) {
        const track = verticalBar.querySelector('.scrollbar-track');
        const thumb = verticalBar.querySelector('.scrollbar-thumb');
        if (track && thumb) {
            const trackSize = track.clientHeight;
            const bounds = CanvasState.scrollBounds.vertical;
            if (trackSize > 0 && bounds && isFinite(bounds.min) && isFinite(bounds.max)) {
                const range = bounds.max - bounds.min;
                // 使用scrollBounds中的范围来计算可见比例，而不是contentBounds
                const totalScrollableHeight = Math.abs(range);
                // 内容总高度 = 滚动范围 + 可见窗口
                const totalHeight = Math.max(1, totalScrollableHeight + workspace.clientHeight);
                const visibleRatio = Math.max(0.05, Math.min(1, workspace.clientHeight / totalHeight));
                const thumbSize = Math.max(20, trackSize * visibleRatio);
                const maxTravel = Math.max(0, trackSize - thumbSize);
                const normalized = range === 0 ? 0 : (bounds.max - CanvasState.panOffsetY) / range;
                const position = Math.min(maxTravel, Math.max(0, normalized * maxTravel));
                
                thumb.style.height = `${thumbSize}px`;
                thumb.style.transform = `translateY(${position}px)`;
            }
        }
    }
    
    if (horizontalBar) {
        const track = horizontalBar.querySelector('.scrollbar-track');
        const thumb = horizontalBar.querySelector('.scrollbar-thumb');
        if (track && thumb) {
            const trackSize = track.clientWidth;
            const bounds = CanvasState.scrollBounds.horizontal;
            if (trackSize > 0 && bounds && isFinite(bounds.min) && isFinite(bounds.max)) {
                const range = bounds.max - bounds.min;
                // 使用scrollBounds中的范围来计算可见比例，而不是contentBounds
                const totalScrollableWidth = Math.abs(range);
                // 内容总宽度 = 滚动范围 + 可见窗口
                const totalWidth = Math.max(1, totalScrollableWidth + workspace.clientWidth);
                const visibleRatio = Math.max(0.05, Math.min(1, workspace.clientWidth / totalWidth));
                const thumbSize = Math.max(20, trackSize * visibleRatio);
                const maxTravel = Math.max(0, trackSize - thumbSize);
                const normalized = range === 0 ? 0 : (bounds.max - CanvasState.panOffsetX) / range;
                const position = Math.min(maxTravel, Math.max(0, normalized * maxTravel));
                
                thumb.style.width = `${thumbSize}px`;
                thumb.style.transform = `translateX(${position}px)`;
            }
        }
    }
}

// =============================================================================
// 定位到永久栏目
// =============================================================================

function locateToPermanentSection() {
    const permanentSection = document.getElementById('permanentSection');
    const workspace = document.getElementById('canvasWorkspace');
    
    if (!permanentSection || !workspace) {
        console.warn('[Canvas] 找不到永久栏目或工作区');
        return;
    }
    
    // 获取永久栏目的位置和尺寸（在canvas-content坐标系中）
    const sectionLeft = parseFloat(permanentSection.style.left) || 0;
    const sectionTop = parseFloat(permanentSection.style.top) || 0;
    const sectionWidth = permanentSection.offsetWidth;
    const sectionHeight = permanentSection.offsetHeight;
    
    // 获取workspace的尺寸
    const workspaceWidth = workspace.clientWidth;
    const workspaceHeight = workspace.clientHeight;
    
    // 计算永久栏目的中心点（在canvas-content坐标系中）
    const sectionCenterX = sectionLeft + sectionWidth / 2;
    const sectionCenterY = sectionTop + sectionHeight / 2;
    
    // 计算需要的平移量，使永久栏目居中显示
    // 公式：panOffset = workspace中心 - (section中心 * zoom)
    CanvasState.panOffsetX = workspaceWidth / 2 - sectionCenterX * CanvasState.zoom;
    CanvasState.panOffsetY = workspaceHeight / 2 - sectionCenterY * CanvasState.zoom;
    
    // 应用平移
    updateCanvasScrollBounds();
    savePanOffsetThrottled();
    
    console.log('[Canvas] 定位到永久栏目:', {
        sectionCenter: { x: sectionCenterX, y: sectionCenterY },
        panOffset: { x: CanvasState.panOffsetX, y: CanvasState.panOffsetY }
    });
}

// =============================================================================
// 让永久栏目本身可以拖动
// =============================================================================

function makePermanentSectionDraggable() {
    const permanentSection = document.getElementById('permanentSection');
    const header = document.getElementById('permanentSectionHeader');
    
    if (!permanentSection || !header) {
        console.warn('[Canvas] 找不到永久栏目元素');
        return;
    }
    
    console.log('[Canvas] 为永久栏目添加拖拽功能');
    
    // 初始化位置：如果使用transform居中，转换为left/top形式，避免第一次拖动跳动
    initializePermanentSectionPosition(permanentSection);
    
    // 添加resize功能
    makePermanentSectionResizable(permanentSection);
    
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;
    let hasMoved = false;
    let lastClientX = 0; // 记录最后的鼠标位置
    let lastClientY = 0;
    
    const onMouseDown = (e) => {
        // 不要在连接点或其触发区上触发拖动
        if (e.target.closest('.canvas-node-anchor') || e.target.closest('.canvas-anchor-zone')) return;
        
        // 不要在关闭按钮、提示文本上触发拖动
        if (e.target.closest('.permanent-section-tip-close') || 
            e.target.closest('.permanent-section-tip-container')) {
            return;
        }
        
        // 只允许在标题区域拖动
        if (!e.target.closest('.permanent-section-header')) {
            return;
        }
        
        isDragging = true;
        hasMoved = false;
        startX = e.clientX;
        startY = e.clientY;
        
        // 获取当前在canvas-content坐标系中的位置
        const currentLeft = parseFloat(permanentSection.style.left) || 0;
        const currentTop = parseFloat(permanentSection.style.top) || 0;
        
        initialLeft = currentLeft;
        initialTop = currentTop;
        
        permanentSection.classList.add('dragging');
        permanentSection.style.transform = 'none';
        permanentSection.style.transition = 'none';
        
        // 立即响应，不阻止默认行为可能更灵敏
        e.preventDefault();
    };
    
    const onMouseMove = (e) => {
        if (!isDragging) return;
        
        // 记录最后的鼠标位置
        lastClientX = e.clientX;
        lastClientY = e.clientY;
        
        // 计算鼠标在屏幕上的移动距离
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        
        // 降低移动阈值，提高灵敏度
        if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
            hasMoved = true;
        }
        
        // 除以缩放比例得到在canvas-content坐标系中的实际移动距离
        const scaledDeltaX = deltaX / CanvasState.zoom;
        const scaledDeltaY = deltaY / CanvasState.zoom;
        
        // 计算新位置
        const newX = initialLeft + scaledDeltaX;
        const newY = initialTop + scaledDeltaY;
        
        // 使用 transform 替代 left/top 以提升性能
        permanentSection.style.transform = `translate(${newX - initialLeft}px, ${newY - initialTop}px)`;
        
        // 阻止文本选择
        e.preventDefault();
    };
    
    const onMouseUp = () => {
        if (isDragging) {
            isDragging = false;
            permanentSection.classList.remove('dragging');
            
            if (hasMoved) {
                // 应用最终位置（从 transform 转回 left/top）
                const deltaX = lastClientX - startX;
                const deltaY = lastClientY - startY;
                const scaledDeltaX = deltaX / CanvasState.zoom;
                const scaledDeltaY = deltaY / CanvasState.zoom;
                const finalX = initialLeft + scaledDeltaX;
                const finalY = initialTop + scaledDeltaY;
                
                permanentSection.style.transform = 'none';
                permanentSection.style.left = finalX + 'px';
                permanentSection.style.top = finalY + 'px';
                
                // 保存位置
                savePermanentSectionPosition();
                scheduleBoundsUpdate();
                scheduleScrollbarUpdate();
            }
            
            hasMoved = false;
        }
    };
    
    // 使用捕获阶段确保事件优先处理，mousemove用冒泡阶段提高性能
    header.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mousemove', onMouseMove, false);
    document.addEventListener('mouseup', onMouseUp, true);
    
    // 添加永久栏目空白区域右键菜单（整个栏目body区域）
    const permanentBody = permanentSection.querySelector('.permanent-section-body');
    if (permanentBody) {
        permanentBody.addEventListener('contextmenu', (e) => {
            // 检查是否点击在树节点上
            const treeItem = e.target.closest('.tree-item[data-node-id]');
            if (!treeItem) {
                e.preventDefault();
                e.stopPropagation();
                showBlankAreaContextMenu(e, null, 'permanent');
            }
        });
    }
}

function savePermanentSectionPosition() {
    const permanentSection = document.getElementById('permanentSection');
    if (!permanentSection) return;
    
    const position = {
        left: permanentSection.style.left,
        top: permanentSection.style.top,
        width: permanentSection.style.width,
        height: permanentSection.style.height
    };
    
    localStorage.setItem('permanent-section-position', JSON.stringify(position));
    console.log('[Canvas] 保存永久栏目位置和大小:', position);
}

function loadPermanentSectionPosition() {
    try {
        const saved = localStorage.getItem('permanent-section-position');
        if (saved) {
            const position = JSON.parse(saved);
            const permanentSection = document.getElementById('permanentSection');
            if (permanentSection) {
                permanentSection.style.transition = 'none';
                permanentSection.style.transform = 'none';
                permanentSection.style.left = position.left;
                permanentSection.style.top = position.top;
                if (position.width) permanentSection.style.width = position.width;
                if (position.height) permanentSection.style.height = position.height;
                console.log('[Canvas] 恢复永久栏目位置和大小:', position);
                
                // 强制重排后恢复transition
                permanentSection.offsetHeight;
                permanentSection.style.transition = '';
            }
        }
    } catch (error) {
        console.error('[Canvas] 加载永久栏目位置失败:', error);
    }
}

// 初始化永久栏目位置：转换transform为left/top，避免第一次拖动跳动
function initializePermanentSectionPosition(permanentSection) {
    if (!permanentSection) return;
    
    // 如果已经有left/top设置，说明已经初始化过了
    if (permanentSection.style.left && permanentSection.style.top) {
        return;
    }
    
    // 获取当前的计算位置（使用transform居中）
    const rect = permanentSection.getBoundingClientRect();
    const workspace = document.getElementById('canvasWorkspace');
    if (!workspace) return;
    
    const workspaceRect = workspace.getBoundingClientRect();
    
    // 计算在canvas-content坐标系中的位置
    const left = (rect.left - workspaceRect.left) / CanvasState.zoom;
    const top = (rect.top - workspaceRect.top) / CanvasState.zoom;
    
    // 禁用过渡，设置新位置
    permanentSection.style.transition = 'none';
    permanentSection.style.transform = 'none';
    permanentSection.style.left = left + 'px';
    permanentSection.style.top = top + 'px';
    
    // 强制重排后恢复transition
    permanentSection.offsetHeight;
    permanentSection.style.transition = '';
    
    console.log('[Canvas] 初始化永久栏目位置:', { left, top });
}

// =============================================================================
// 永久栏目和临时节点Resize功能
// =============================================================================

function makePermanentSectionResizable(element) {
    // 创建8个resize handles
    const handles = [
        { name: 'nw', cursor: 'nw-resize', position: 'top-left' },
        { name: 'n', cursor: 'n-resize', position: 'top' },
        { name: 'ne', cursor: 'ne-resize', position: 'top-right' },
        { name: 'e', cursor: 'e-resize', position: 'right' },
        { name: 'se', cursor: 'se-resize', position: 'bottom-right' },
        { name: 's', cursor: 's-resize', position: 'bottom' },
        { name: 'sw', cursor: 'sw-resize', position: 'bottom-left' },
        { name: 'w', cursor: 'w-resize', position: 'left' }
    ];
    
    handles.forEach(handleInfo => {
        const handle = document.createElement('div');
        handle.className = `resize-handle resize-handle-${handleInfo.name}`;
        handle.style.cssText = getResizeHandleStyle(handleInfo);
        element.appendChild(handle);
        
        let isResizing = false;
        let startX, startY, startWidth, startHeight, startLeft, startTop;
        
        handle.addEventListener('mousedown', (e) => {
            if (node && node.locked) return; // 锁定不允许缩放
            e.stopPropagation();
            e.preventDefault();
            
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            startWidth = element.offsetWidth;
            startHeight = element.offsetHeight;
            startLeft = parseFloat(element.style.left) || 0;
            startTop = parseFloat(element.style.top) || 0;
            
            element.classList.add('resizing');
            
            const onMouseMove = (e) => {
                if (!isResizing) return;
                
                // 计算鼠标移动距离（考虑缩放）
                const deltaX = (e.clientX - startX) / CanvasState.zoom;
                const deltaY = (e.clientY - startY) / CanvasState.zoom;
                
                // 根据handle位置计算新的尺寸和位置
                let newWidth = startWidth;
                let newHeight = startHeight;
                let newLeft = startLeft;
                let newTop = startTop;
                
                // 处理水平方向
                if (handleInfo.name.includes('e')) {
                    newWidth = Math.max(300, startWidth + deltaX);
                } else if (handleInfo.name.includes('w')) {
                    newWidth = Math.max(300, startWidth - deltaX);
                    newLeft = startLeft + (startWidth - newWidth);
                }
                
                // 处理垂直方向
                if (handleInfo.name.includes('s')) {
                    newHeight = Math.max(200, startHeight + deltaY);
                } else if (handleInfo.name.includes('n')) {
                    newHeight = Math.max(200, startHeight - deltaY);
                    newTop = startTop + (startHeight - newHeight);
                }
                
                // 应用新的尺寸和位置
                element.style.width = newWidth + 'px';
                element.style.height = newHeight + 'px';
                element.style.left = newLeft + 'px';
                element.style.top = newTop + 'px';
                
                // 不再设置max-height，让内容区域自动填充
            };
            
            const onMouseUp = () => {
                if (isResizing) {
                    isResizing = false;
                    element.classList.remove('resizing');
                    savePermanentSectionPosition();
                    updateCanvasScrollBounds();
                    updateScrollbarThumbs();
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                }
            };
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    });
}

function getResizeHandleStyle(handleInfo) {
    const baseStyle = 'position: absolute; z-index: 10; background: transparent;';
    const cornerSize = '50px'; // 角手柄更大
    const edgeSize = '10px';   // 边手柄保持原大小
    
    let style = baseStyle + `cursor: ${handleInfo.cursor};`;
    
    // 角handle - 三角形区域，更大范围
    if (handleInfo.name.length === 2) {
        style += `width: ${cornerSize}; height: ${cornerSize};`;
        
        // 使用clip-path创建三角形
        if (handleInfo.name === 'nw') {
            style += 'top: 0; left: 0;';
            style += 'clip-path: polygon(0 0, 100% 0, 0 100%);';
        } else if (handleInfo.name === 'ne') {
            style += 'top: 0; right: 0;';
            style += 'clip-path: polygon(100% 0, 100% 100%, 0 0);';
        } else if (handleInfo.name === 'sw') {
            style += 'bottom: 0; left: 0;';
            style += 'clip-path: polygon(0 0, 0 100%, 100% 100%);';
        } else if (handleInfo.name === 'se') {
            style += 'bottom: 0; right: 0;';
            style += 'clip-path: polygon(100% 0, 100% 100%, 0 100%);';
        }
    }
    // 边handle
    else {
        if (handleInfo.name === 'n' || handleInfo.name === 's') {
            style += 'left: 50px; right: 50px; height: ' + edgeSize + '; background: transparent;';
            if (handleInfo.name === 'n') style += 'top: -5px;';
            else style += 'bottom: -5px;';
        } else {
            style += 'top: 50px; bottom: 50px; width: ' + edgeSize + '; background: transparent;';
            if (handleInfo.name === 'w') style += 'left: -5px;';
            else style += 'right: -5px;';
        }
    }
    
    return style;
}

function makeTempNodeResizable(element, node) {
    // 创建8个resize handles
    const handles = [
        { name: 'nw', cursor: 'nw-resize' },
        { name: 'n', cursor: 'n-resize' },
        { name: 'ne', cursor: 'ne-resize' },
        { name: 'e', cursor: 'e-resize' },
        { name: 'se', cursor: 'se-resize' },
        { name: 's', cursor: 's-resize' },
        { name: 'sw', cursor: 'sw-resize' },
        { name: 'w', cursor: 'w-resize' }
    ];
    
    handles.forEach(handleInfo => {
        const handle = document.createElement('div');
        handle.className = `resize-handle resize-handle-${handleInfo.name}`;
        handle.style.cssText = getResizeHandleStyle(handleInfo);
        element.appendChild(handle);
        
        let isResizing = false;
        let startX, startY, startWidth, startHeight, startLeft, startTop;
        
        handle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            startWidth = element.offsetWidth;
            startHeight = element.offsetHeight;
            startLeft = node.x;
            startTop = node.y;
            
            element.classList.add('resizing');
            
            const onMouseMove = (e) => {
                if (!isResizing) return;
                
                // 计算鼠标移动距离（考虑缩放）
                const deltaX = (e.clientX - startX) / CanvasState.zoom;
                const deltaY = (e.clientY - startY) / CanvasState.zoom;
                
                // 根据handle位置计算新的尺寸和位置
                let newWidth = startWidth;
                let newHeight = startHeight;
                let newLeft = startLeft;
                let newTop = startTop;
                
                // 处理水平方向
                if (handleInfo.name.includes('e')) {
                    newWidth = Math.max(200, startWidth + deltaX);
                } else if (handleInfo.name.includes('w')) {
                    newWidth = Math.max(200, startWidth - deltaX);
                    newLeft = startLeft + (startWidth - newWidth);
                }
                
                // 处理垂直方向
                if (handleInfo.name.includes('s')) {
                    newHeight = Math.max(150, startHeight + deltaY);
                } else if (handleInfo.name.includes('n')) {
                    newHeight = Math.max(150, startHeight - deltaY);
                    newTop = startTop + (startHeight - newHeight);
                }
                
                // 应用新的尺寸和位置
                element.style.width = newWidth + 'px';
                element.style.height = newHeight + 'px';
                element.style.left = newLeft + 'px';
                element.style.top = newTop + 'px';
                
                // 更新节点数据
                node.width = newWidth;
                node.height = newHeight;
                node.x = newLeft;
                node.y = newTop;
            };
            
            const onMouseUp = () => {
                if (isResizing) {
                    isResizing = false;
                    element.classList.remove('resizing');
                    saveTempNodes();
                    updateCanvasScrollBounds();
                    updateScrollbarThumbs();
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                }
            };
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    });
}

// =============================================================================
// 拖拽功能 - 从永久栏目拖出
// =============================================================================

function handlePermanentDragStart(e, data, type) {
    CanvasState.dragState.isDragging = true;
    CanvasState.dragState.draggedData = {
        id: data.id,
        title: data.title,
        url: data.url,
        type,
        source: 'permanent',
        hasSnapshot: !!data.children
    };
    CanvasState.dragState.dragSource = 'permanent';
    
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', data.title || '');
    try {
        e.dataTransfer.setData('application/json', JSON.stringify({
            id: data.id,
            title: data.title,
            url: data.url,
            type
        }));
    } catch (err) {
        console.warn('[Canvas] 设置拖拽数据失败:', err);
    }
    
    // 创建拖拽预览（替代UI规则同上）
    let previewText = data && (data.title || data.url) ? (data.title || data.url) : '';
    try {
        const ids = collectPermanentSelectionIds(data && data.id ? data.id : null);
        if (Array.isArray(ids) && ids.length > 1) {
            previewText = 'Multiple items';
        }
    } catch (_) {}
    const preview = document.createElement('div');
    preview.className = 'drag-preview';
    preview.textContent = previewText || '';
    preview.style.left = '-9999px';
    document.body.appendChild(preview);
    e.dataTransfer.setDragImage(preview, 0, 0);
    setTimeout(() => preview.remove(), 0);
}

async function handlePermanentDragEnd(e) {
    if (!CanvasState.dragState.isDragging) return;
    
    const dropX = e.clientX;
    const dropY = e.clientY;
    
    // 检查是否拖到Canvas工作区
    const workspace = document.getElementById('canvasWorkspace');
    const rect = workspace.getBoundingClientRect();
    
    if (dropX >= rect.left && dropX <= rect.right && 
        dropY >= rect.top && dropY <= rect.bottom) {
        // 若落点在永久栏目内，则视为永久栏目内部操作，不创建临时栏目
        const elementAtPoint = document.elementFromPoint(dropX, dropY);
        const permanentSection = document.getElementById('permanentSection');
        const insidePermanentDom = !!(elementAtPoint && permanentSection && elementAtPoint.closest('#permanentSection'));
        let insidePermanentRect = false;
        if (permanentSection) {
            const pRect = permanentSection.getBoundingClientRect();
            insidePermanentRect = dropX >= pRect.left && dropX <= pRect.right && dropY >= pRect.top && dropY <= pRect.bottom;
        }

        if (!(insidePermanentDom || insidePermanentRect)) {
            // 在Canvas空白/临时区创建临时节点
            const x = dropX - rect.left + workspace.scrollLeft;
            const y = dropY - rect.top + workspace.scrollTop;
            try {
                let ids = [];
                try { ids = collectPermanentSelectionIds((CanvasState.dragState.draggedData && CanvasState.dragState.draggedData.id) || null) || []; } catch(_) {}
                if (Array.isArray(ids) && ids.length > 1) {
                    await createTempNode({ multi: true, permanentIds: ids }, x, y);
                } else {
                    await createTempNode(CanvasState.dragState.draggedData, x, y);
                }
            } catch (error) {
                console.error('[Canvas] 创建临时栏目失败:', error);
                alert('创建临时栏目失败: ' + error.message);
            }
        } else {
            console.log('[Canvas] 拖拽结束位于永久栏目内，不创建临时栏目');
        }
    }
    
    CanvasState.dragState.isDragging = false;
    CanvasState.dragState.draggedData = null;
    CanvasState.dragState.dragSource = null;
    const permanentSection = document.getElementById('permanentSection');
    if (permanentSection) {
        permanentSection.classList.remove('drag-origin-active');
    }
    if (workspace) {
        workspace.classList.remove('canvas-drop-active');
    }

    scheduleClearTreeItemDragging();
}

// =============================================================================
// 临时节点管理
// =============================================================================

async function createTempNode(data, x, y) {
    const sectionId = `temp-section-${++CanvasState.tempSectionCounter}`;
    const sequenceNumber = ++CanvasState.tempSectionSequenceNumber;
    const section = {
        id: sectionId,
        title: getDefaultTempSectionTitle(),
        sequenceNumber: sequenceNumber,
        color: pickTempSectionColor(),
        x,
        y,
        width: TEMP_SECTION_DEFAULT_WIDTH,
        height: TEMP_SECTION_DEFAULT_HEIGHT,
        createdAt: Date.now(),
        items: []
    };
    
    try {
        let payload = [];
        if (data && data.multi && Array.isArray(data.permanentIds) && data.permanentIds.length) {
            // 多选合集：从永久栏收集所有选中的节点
            payload = await resolvePermanentPayload(data.permanentIds);
        } else {
            let resolvedNode = null;
            try {
                resolvedNode = await resolveBookmarkNode(data);
            } catch (error) {
                console.warn('[Canvas] 实时获取书签数据失败，使用一次性快照:', error);
                resolvedNode = cloneBookmarkNode(data);
            }
            if (resolvedNode) {
                payload = [resolvedNode];
            }
        }

        if (payload && payload.length) {
            payload.forEach(node => {
                const tempItem = convertBookmarkNodeToTempItem(node, sectionId);
                if (tempItem) section.items.push(tempItem);
            });
        }
    } catch (error) {
        console.error('[Canvas] 转换拖拽节点失败:', error);
    }
    
    CanvasState.tempSections.push(section);
    
    renderTempNode(section);
    
    // 延迟管理休眠状态
    scheduleDormancyUpdate();
    
    saveTempNodes();
}

// =============================================================================
// Markdown 文本节点（Obsidian Canvas 风格）
// =============================================================================

function clearMdSelection() {
    try {
        if (CanvasState.selectedMdNodeId) {
            const prev = document.getElementById(CanvasState.selectedMdNodeId);
            if (prev) prev.classList.remove('selected');
        }
    } catch(_) {}
    CanvasState.selectedMdNodeId = null;
}

function selectMdNode(nodeId) {
    if (!nodeId) return;
    if (CanvasState.selectedMdNodeId === nodeId) return;
    clearMdSelection();
    // 清除连接线的选择
    clearEdgeSelection();
    const el = document.getElementById(nodeId);
    if (el) {
        el.classList.add('selected');
        CanvasState.selectedMdNodeId = nodeId;
    }
}

function duplicateMdNode(nodeId) {
    const node = (Array.isArray(CanvasState.mdNodes) ? CanvasState.mdNodes.find(n => n.id === nodeId) : null);
    if (!node) return null;
    const id = `md-node-${++CanvasState.mdNodeCounter}`;
    const copy = {
        id,
        x: (node.x || 0) + 24,
        y: (node.y || 0) + 24,
        width: node.width || MD_NODE_DEFAULT_WIDTH,
        height: node.height || MD_NODE_DEFAULT_HEIGHT,
        text: node.text || '',
        color: node.color || null,
        createdAt: Date.now()
    };
    CanvasState.mdNodes.push(copy);
    renderMdNode(copy);
    scheduleBoundsUpdate();
    saveTempNodes();
    return id;
}

function makeMdNodeDraggable(element, node) {
    let dragPending = false;
    let startX = 0;
    let startY = 0;

    const onMouseDown = (e) => {
        if (node && node.locked) return; // 锁定不允许拖动
        const target = e.target;
        if (!target) return;
        // 编辑、resize、连接点时不拖动
        if (target.closest('.md-canvas-editor') || target.closest('.resize-handle') || target.closest('.canvas-node-anchor') || target.closest('.canvas-anchor-zone')) return;

        dragPending = true;
        startX = e.clientX;
        startY = e.clientY;

        const onMove = (ev) => {
            if (!dragPending) return;
            const dx = Math.abs(ev.clientX - startX);
            const dy = Math.abs(ev.clientY - startY);
            if (dx + dy < 3) return; // 小阈值，模拟单击拖动体验

            dragPending = false;
            document.removeEventListener('mousemove', onMove, true);
            document.removeEventListener('mouseup', onUp, true);

            // 真正开始拖动
            CanvasState.dragState.isDragging = true;
            CanvasState.dragState.draggedElement = element;
            CanvasState.dragState.dragStartX = startX;
            CanvasState.dragState.dragStartY = startY;
            CanvasState.dragState.nodeStartX = node.x;
            CanvasState.dragState.nodeStartY = node.y;
            CanvasState.dragState.dragSource = 'temp-node';
            element.classList.add('dragging');
            element.style.transition = 'none';
            ev.preventDefault();
        };

        const onUp = () => {
            if (dragPending) {
                // 单击释放，不进入拖动
                dragPending = false;
            }
            document.removeEventListener('mousemove', onMove, true);
            document.removeEventListener('mouseup', onUp, true);
        };

        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('mouseup', onUp, true);
    };
    element.addEventListener('mousedown', onMouseDown, true);
}

function renderMdNode(node) {
    const container = document.getElementById('canvasContent');
    if (!container) return;
    
    let el = document.getElementById(node.id);
    const isNew = !el;
    if (!el) {
        el = document.createElement('div');
        el.id = node.id;
        el.className = 'md-canvas-node';
        container.appendChild(el);
        el.style.left = node.x + 'px';
        el.style.top = node.y + 'px';
        el.style.width = (node.width || MD_NODE_DEFAULT_WIDTH) + 'px';
        el.style.height = (node.height || MD_NODE_DEFAULT_HEIGHT) + 'px';
    } else {
        el.innerHTML = '';
    }

    // 顶部工具栏（选中/悬停可见）
    const toolbar = document.createElement('div');
    toolbar.className = 'md-node-toolbar';
    
    // 多语言支持
    const lang = typeof currentLang !== 'undefined' ? currentLang : 'zh';
    const deleteTitle = lang === 'en' ? 'Delete' : '删除';
    const colorTitle = lang === 'en' ? 'Color' : '颜色';
    const focusTitle = lang === 'en' ? 'Locate and zoom' : '定位并放大';
    const editTitle = lang === 'en' ? 'Edit' : '编辑';
    
    toolbar.innerHTML = `
        <button class="md-node-toolbar-btn" data-action="md-delete" title="${deleteTitle}"><i class="far fa-trash-alt"></i></button>
        <button class="md-node-toolbar-btn" data-action="md-color-toggle" title="${colorTitle}"><i class="fas fa-palette"></i></button>
        <button class="md-node-toolbar-btn" data-action="md-focus" title="${focusTitle}"><i class="fas fa-search-plus"></i></button>
        <button class="md-node-toolbar-btn" data-action="md-edit" title="${editTitle}"><i class="far fa-edit"></i></button>
    `;
    
    // 视图（渲染 Markdown）
    const view = document.createElement('div');
    view.className = 'md-canvas-text';
    const raw = typeof node.text === 'string' ? node.text : '';
    if (raw) {
        if (typeof marked !== 'undefined') {
            try { view.innerHTML = marked.parse(raw); } catch { view.textContent = raw; }
        } else {
            view.textContent = raw;
        }
    } else {
        view.textContent = '';
    }

    // 编辑器
    const editor = document.createElement('textarea');
    editor.className = 'md-canvas-editor';
    editor.spellcheck = false;
    editor.style.display = node.isEditing ? 'block' : 'none';
    editor.value = raw;

    const enterEdit = () => {
        if (node.isEditing) return;
        node.isEditing = true;
        editor.value = typeof node.text === 'string' ? node.text : '';
        editor.style.display = 'block';
        view.style.display = 'none';
        el.classList.add('editing');
        requestAnimationFrame(() => editor.focus());
    };

    const applyEdit = () => {
        const val = editor.value || '';
        node.text = val;
        if (typeof marked !== 'undefined') {
            try { view.innerHTML = val ? marked.parse(val) : ''; } catch { view.textContent = val; }
        } else {
            view.textContent = val;
        }
        node.isEditing = false;
        editor.style.display = 'none';
        view.style.display = 'block';
        el.classList.remove('editing');
        saveTempNodes();
    };

    const cancelEdit = () => {
        node.isEditing = false;
        editor.style.display = 'none';
        view.style.display = 'block';
        el.classList.remove('editing');
    };

    // 交互：双击进入编辑；编辑框 blur/快捷键提交
    el.addEventListener('dblclick', (e) => {
        if (e.target.closest('.resize-handle')) return;
        enterEdit();
        e.stopPropagation();
        e.preventDefault();
    });

    editor.addEventListener('blur', () => { if (node.isEditing) applyEdit(); });
    editor.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); applyEdit(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
    });

    // 阻止编辑器事件冒泡
    ['mousedown','dblclick','click'].forEach(evt => editor.addEventListener(evt, ev => ev.stopPropagation()));

    el.appendChild(toolbar);
    el.appendChild(view);
    el.appendChild(editor);

    // 选择逻辑：单击选中，空白点击清除
    el.addEventListener('mousedown', (e) => {
        // 忽略在编辑、resize、小工具栏按钮上的按下
        if (e.target.closest('.md-canvas-editor') || e.target.closest('.resize-handle') || e.target.closest('.md-node-toolbar-btn')) return;
        selectMdNode(node.id);
    }, true);

    // 工具栏事件
    toolbar.addEventListener('click', (e) => {
        const btn = e.target.closest('.md-node-toolbar-btn, .md-color-chip, .md-color-custom, .md-color-picker-btn');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const action = btn.getAttribute('data-action');
        if (action === 'md-edit') {
            selectMdNode(node.id);
            enterEdit();
        } else if (action === 'md-delete') {
            removeMdNode(node.id);
            clearMdSelection();
        } else if (action === 'md-color-toggle') {
            toggleMdColorPopover(toolbar, node, btn);
        } else if (action === 'md-color-preset') {
            const preset = String(btn.getAttribute('data-color') || '').trim();
            setMdNodeColor(node, preset);
            closeMdColorPopover(toolbar);
        } else if (action === 'md-color-picker-toggle') {
            // RGB选择器切换由ensureMdColorPopover中的事件处理
        } else if (action === 'md-color-custom') {
            // handled by input change event
        } else if (action === 'md-focus') {
            selectMdNode(node.id);
            locateAndZoomToMdNode(node.id);
        }
    });
    
    makeMdNodeDraggable(el, node);
    makeTempNodeResizable(el, node);
    
    if (isNew) {
        el.classList.add('temp-node-enter');
        requestAnimationFrame(() => el.classList.remove('temp-node-enter'));
    }

    // 如果当前选中的是该节点，恢复选中外观
    if (CanvasState.selectedMdNodeId === node.id) {
        el.classList.add('selected');
    }

    // 初始颜色与层级
    applyMdNodeColor(el, node);
    if (node && typeof node.z === 'number') {
        el.style.zIndex = String(node.z);
    }
    
    addAnchorsToNode(el, node.id);
}

// —— 工具栏动作实现 ——
function presetToHex(preset) {
    // Obsidian Canvas 风格颜色
    switch (String(preset)) {
        case '1': return '#ff6666'; // red
        case '2': return '#ffaa66'; // orange
        case '3': return '#ffdd66'; // yellow
        case '4': return '#66dd99'; // green
        case '5': return '#66bbff'; // blue
        case '6': return '#bb99ff'; // purple
        default: return null;
    }
}

function applyMdNodeColor(el, node) {
    const hex = node && (node.colorHex || presetToHex(node.color) || null);
    if (!el) return;
    if (hex) {
        el.style.borderColor = hex;
        // 背景保持当前主题，仅强调描边以显得更“高级”
    }
}

function setMdNodeColor(node, presetOrHex) {
    if (!node) return;
    // 支持预设编号或十六进制颜色
    const isPreset = /^[1-6]$/.test(String(presetOrHex));
    if (isPreset) {
        node.color = String(presetOrHex);
        node.colorHex = presetToHex(node.color);
    } else if (typeof presetOrHex === 'string' && presetOrHex.startsWith('#')) {
        node.color = null;
        node.colorHex = presetOrHex;
    }
    const el = document.getElementById(node.id);
    if (el) applyMdNodeColor(el, node);
    saveTempNodes();
}

// 色盘弹层逻辑
function ensureMdColorPopover(toolbar, node) {
    let pop = toolbar.querySelector('.md-color-popover');
    if (pop) return pop;
    pop = document.createElement('div');
    pop.className = 'md-color-popover';
    
    // 多语言支持
    const lang = typeof currentLang !== 'undefined' ? currentLang : 'zh';
    const rgbPickerTitle = lang === 'en' ? 'RGB Color Picker' : 'RGB颜色选择器';
    const customColorTitle = lang === 'en' ? 'Select custom color' : '选择自定义颜色';
    
    // 使用 Obsidian Canvas 风格的颜色
    pop.innerHTML = `
        <span class="md-color-chip" data-action="md-color-preset" data-color="1" style="background:#ff6666"></span>
        <span class="md-color-chip" data-action="md-color-preset" data-color="2" style="background:#ffaa66"></span>
        <span class="md-color-chip" data-action="md-color-preset" data-color="3" style="background:#ffdd66"></span>
        <span class="md-color-chip" data-action="md-color-preset" data-color="4" style="background:#66dd99"></span>
        <span class="md-color-chip" data-action="md-color-preset" data-color="5" style="background:#66bbff"></span>
        <span class="md-color-chip" data-action="md-color-preset" data-color="6" style="background:#bb99ff"></span>
        <button class="md-color-chip md-color-picker-btn" data-action="md-color-picker-toggle" title="${rgbPickerTitle}">
            <svg viewBox="0 0 24 24" width="14" height="14">
                <circle cx="12" cy="12" r="10" fill="url(#rainbow-gradient)" />
                <defs>
                    <linearGradient id="rainbow-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#ff0000" />
                        <stop offset="16.67%" style="stop-color:#ff9900" />
                        <stop offset="33.33%" style="stop-color:#ffff00" />
                        <stop offset="50%" style="stop-color:#00ff00" />
                        <stop offset="66.67%" style="stop-color:#0099ff" />
                        <stop offset="83.33%" style="stop-color:#9900ff" />
                        <stop offset="100%" style="stop-color:#ff0099" />
                    </linearGradient>
                </defs>
            </svg>
        </button>
    `;
    
    // RGB选择器UI（显示在色盘上方）
    const rgbPicker = document.createElement('div');
    rgbPicker.className = 'md-rgb-picker';
    rgbPicker.innerHTML = `
        <input class="md-color-input" type="color" value="${node.colorHex || '#2563eb'}" title="${customColorTitle}" />
    `;
    pop.appendChild(rgbPicker);
    
    // 彩色圆盘按钮点击事件 - 切换RGB选择器显示
    const pickerBtn = pop.querySelector('.md-color-picker-btn');
    const colorInput = rgbPicker.querySelector('.md-color-input');
    
    pickerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = rgbPicker.classList.contains('open');
        if (isOpen) {
            rgbPicker.classList.remove('open');
        } else {
            rgbPicker.classList.add('open');
            // 延迟触发点击，确保UI已显示
            setTimeout(() => colorInput.click(), 50);
        }
    });
    
    // 自定义颜色变化
    colorInput.addEventListener('input', (ev) => {
        setMdNodeColor(node, ev.target.value);
    });
    
    colorInput.addEventListener('change', () => {
        rgbPicker.classList.remove('open');
    });
    
    toolbar.appendChild(pop);
    return pop;
}

function toggleMdColorPopover(toolbar, node, anchorBtn) {
    const pop = ensureMdColorPopover(toolbar, node);
    const isOpen = pop.classList.contains('open');
    if (isOpen) { closeMdColorPopover(toolbar); return; }
    pop.classList.add('open');
    // 监听外部点击关闭
    const onDoc = (e) => {
        if (!toolbar.contains(e.target)) {
            closeMdColorPopover(toolbar);
            document.removeEventListener('mousedown', onDoc, true);
        }
    };
    document.addEventListener('mousedown', onDoc, true);
}

function closeMdColorPopover(toolbar) {
    const pop = toolbar.querySelector('.md-color-popover');
    if (pop) pop.classList.remove('open');
}

// 定位并放大到指定 Markdown 节点
function locateAndZoomToMdNode(nodeId, targetZoom = 1.2) {
    const el = document.getElementById(nodeId);
    const workspace = document.getElementById('canvasWorkspace');
    if (!el || !workspace) return;

    const zoom = Math.max(0.1, Math.min(3, Math.max(CanvasState.zoom, targetZoom)));
    if (zoom !== CanvasState.zoom) {
        const rect = workspace.getBoundingClientRect();
        setCanvasZoom(zoom, rect.left + rect.width / 2, rect.top + rect.height / 2, { recomputeBounds: true });
    }

    const nodeLeft = parseFloat(el.style.left) || 0;
    const nodeTop = parseFloat(el.style.top) || 0;
    const nodeCenterX = nodeLeft + el.offsetWidth / 2;
    const nodeCenterY = nodeTop + el.offsetHeight / 2;

    const workspaceWidth = workspace.clientWidth;
    const workspaceHeight = workspace.clientHeight;
    CanvasState.panOffsetX = workspaceWidth / 2 - nodeCenterX * CanvasState.zoom;
    CanvasState.panOffsetY = workspaceHeight / 2 - nodeCenterY * CanvasState.zoom;

    updateCanvasScrollBounds();
    savePanOffsetThrottled();
}

async function createMdNode(x, y, text = '') {
    const id = `md-node-${++CanvasState.mdNodeCounter}`;
    const node = {
        id,
        x,
        y,
        width: MD_NODE_DEFAULT_WIDTH,
        height: MD_NODE_DEFAULT_HEIGHT,
        text,
        color: null,
        createdAt: Date.now()
    };
    CanvasState.mdNodes.push(node);
    renderMdNode(node);
    scheduleBoundsUpdate();
    saveTempNodes();
    return id;
}

function removeMdNode(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
    CanvasState.mdNodes = CanvasState.mdNodes.filter(n => n.id !== id);
    saveTempNodes();
    scheduleBoundsUpdate();
}

function renderTempNode(section) {
    const container = document.getElementById('canvasContent');
    if (!container) {
        console.warn('[Canvas] 找不到canvasContent容器');
        return;
    }
    
    section.color = section.color || TEMP_SECTION_DEFAULT_COLOR;
    
    let nodeElement = document.getElementById(section.id);
    const isNew = !nodeElement;
    
    // 如果栏目处于休眠状态，只隐藏不删除
    if (section.dormant && nodeElement) {
        nodeElement.style.display = 'none';
        return;
    }
    
    // 保存滚动位置（如果是更新现有节点）
    // 注意：滚动容器是 temp-node-body，而不是 bookmark-tree
    let savedScrollTop = 0;
    let savedScrollLeft = 0;
    if (!isNew && nodeElement) {
        const existingBody = nodeElement.querySelector('.temp-node-body');
        if (existingBody) {
            savedScrollTop = existingBody.scrollTop || 0;
            savedScrollLeft = existingBody.scrollLeft || 0;
            console.log('[Canvas] 保存滚动位置:', { sectionId: section.id, scrollTop: savedScrollTop, scrollLeft: savedScrollLeft });
        }
    }
    
    if (!nodeElement) {
        nodeElement = document.createElement('div');
        nodeElement.className = 'temp-canvas-node';
        nodeElement.id = section.id;
        nodeElement.dataset.sectionId = section.id;
        container.appendChild(nodeElement);
        
        // 只在新建时设置位置和大小
        nodeElement.style.transition = 'none';
        nodeElement.style.left = section.x + 'px';
        nodeElement.style.top = section.y + 'px';
        nodeElement.style.width = (section.width || TEMP_SECTION_DEFAULT_WIDTH) + 'px';
        nodeElement.style.height = (section.height || TEMP_SECTION_DEFAULT_HEIGHT) + 'px';
    } else {
        // 更新时清空内容，但保持位置和大小不变
        nodeElement.innerHTML = '';
        // 只更新颜色
        nodeElement.style.setProperty('--section-color', section.color || TEMP_SECTION_DEFAULT_COLOR);
    }
    
    if (isNew) {
        nodeElement.style.setProperty('--section-color', section.color || TEMP_SECTION_DEFAULT_COLOR);
    }
    
    const header = document.createElement('div');
    header.className = 'temp-node-header';
    header.dataset.sectionId = section.id;
    header.style.setProperty('--section-color', section.color || TEMP_SECTION_DEFAULT_COLOR);
    
    // 创建标题容器（包含序号标签和标题输入框）
    const titleContainer = document.createElement('div');
    titleContainer.className = 'temp-node-title-container';
    
    // 添加序号标签（如果有）
    if (section.sequenceNumber) {
        const sequenceBadge = document.createElement('span');
        sequenceBadge.className = 'temp-node-sequence-badge';
        sequenceBadge.textContent = section.sequenceNumber;
        titleContainer.appendChild(sequenceBadge);
    }
    
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'temp-node-title temp-node-title-input';
    titleInput.value = section.title || getDefaultTempSectionTitle();
    titleInput.placeholder = '临时栏目';
    titleInput.readOnly = true;
    titleInput.setAttribute('readonly', 'readonly');
    titleInput.tabIndex = -1;
    titleInput.dataset.sectionId = section.id;
    
    titleContainer.appendChild(titleInput);
    
    const actions = document.createElement('div');
    actions.className = 'temp-node-actions';
    
    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'temp-node-action-btn temp-node-rename-btn';
    const renameLabel = (typeof currentLang !== 'undefined' && currentLang === 'en') ? 'Rename section' : '重命名栏目';
    renameBtn.title = renameLabel;
    renameBtn.setAttribute('aria-label', renameLabel);
    renameBtn.innerHTML = '<i class="fas fa-edit"></i>';
    
    const colorLabel = (typeof currentLang !== 'undefined' && currentLang === 'en') ? 'Change color' : '调整栏目颜色';

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'temp-node-color-input';
    colorInput.value = section.color || TEMP_SECTION_DEFAULT_COLOR;
    colorInput.title = colorLabel;
    
    const colorBtn = document.createElement('button');
    colorBtn.type = 'button';
    colorBtn.className = 'temp-node-action-btn temp-node-color-btn';
    colorBtn.title = colorLabel;
    colorBtn.setAttribute('aria-label', colorLabel);
    colorBtn.innerHTML = '<i class="fas fa-palette"></i>';
    colorBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        colorInput.click();
    });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'temp-node-action-btn temp-node-delete-btn temp-node-close';
    closeBtn.innerHTML = '<i class="fas fa-times"></i>';
    const closeLabel = (typeof currentLang !== 'undefined' && currentLang === 'en') ? 'Remove section' : '删除临时栏目';
    closeBtn.title = closeLabel;
    closeBtn.setAttribute('aria-label', closeLabel);
    closeBtn.addEventListener('click', () => removeTempNode(section.id));

    colorInput.addEventListener('input', (event) => {
        section.color = event.target.value || TEMP_SECTION_DEFAULT_COLOR;
        applyTempSectionColor(section, nodeElement, header, colorBtn, colorInput);
        saveTempNodes();
    });

    renameBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (titleInput.classList.contains('editing')) {
            finishTempSectionTitleEdit(section, titleInput, renameBtn, true);
        } else {
            beginTempSectionTitleEdit(section, titleInput, renameBtn);
        }
    });

    titleInput.addEventListener('blur', () => {
        if (!titleInput.classList.contains('editing')) return;
        finishTempSectionTitleEdit(section, titleInput, renameBtn, true);
    });

    titleInput.addEventListener('keydown', (ev) => {
        if (!titleInput.classList.contains('editing')) return;
        if (ev.key === 'Enter') {
            ev.preventDefault();
            finishTempSectionTitleEdit(section, titleInput, renameBtn, true);
        } else if (ev.key === 'Escape') {
            ev.preventDefault();
            finishTempSectionTitleEdit(section, titleInput, renameBtn, false);
        }
    });

    titleInput.addEventListener('mousedown', (ev) => {
        if (!titleInput.classList.contains('editing')) {
            ev.preventDefault();
        }
    });

    // 置顶按钮
    const pinBtn = document.createElement('button');
    pinBtn.type = 'button';
    pinBtn.className = 'temp-node-action-btn temp-node-pin-btn';
    const pinLabel = (typeof currentLang !== 'undefined' && currentLang === 'en') ? 'Pin section' : '置顶栏目';
    const unpinLabel = (typeof currentLang !== 'undefined' && currentLang === 'en') ? 'Unpin section' : '取消置顶';
    const isPinned = section.pinned || false;
    pinBtn.title = isPinned ? unpinLabel : pinLabel;
    pinBtn.setAttribute('aria-label', pinBtn.title);
    pinBtn.innerHTML = isPinned ? '<i class="fas fa-thumbtack"></i>' : '<i class="fas fa-thumbtack" style="opacity: 0.5;"></i>';
    if (isPinned) {
        pinBtn.classList.add('pinned');
    }
    pinBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        section.pinned = !section.pinned;
        pinBtn.classList.toggle('pinned', section.pinned);
        pinBtn.title = section.pinned ? unpinLabel : pinLabel;
        pinBtn.setAttribute('aria-label', pinBtn.title);
        pinBtn.innerHTML = section.pinned ? '<i class="fas fa-thumbtack"></i>' : '<i class="fas fa-thumbtack" style="opacity: 0.5;"></i>';
        updateSectionZIndex(section.id, section.pinned);
        saveTempNodes();
    });

    actions.appendChild(renameBtn);
    actions.appendChild(pinBtn);
    actions.appendChild(colorBtn);
    actions.appendChild(colorInput);
    actions.appendChild(closeBtn);
    
    header.appendChild(titleContainer);
    header.appendChild(actions);
    
    // 创建说明文字容器（始终显示）
    const descriptionContainer = document.createElement('div');
    descriptionContainer.className = 'temp-node-description-container';
    descriptionContainer.dataset.sectionId = section.id;
    
    const descriptionContent = document.createElement('div');
    descriptionContent.className = 'temp-node-description-content';
    
    const descriptionText = document.createElement('div');
    descriptionText.className = 'temp-node-description';
    descriptionText.style.cursor = 'pointer';
    descriptionText.style.fontStyle = section.description ? 'normal' : 'italic';
    descriptionText.style.opacity = section.description ? '1' : '0.5';
    
    // 获取占位符文字（支持多语言）
    const getPlaceholderText = () => {
        const lang = typeof currentLang !== 'undefined' ? currentLang : 'zh';
        return lang === 'en' ? 'Click to add description...' : '点击添加说明...';
    };
    
    // 获取编辑提示（支持多语言）
    const getEditTitle = () => {
        const lang = typeof currentLang !== 'undefined' ? currentLang : 'zh';
        return lang === 'en' ? 'Double-click to edit' : '双击编辑说明';
    };
    
    const getAddTitle = () => {
        const lang = typeof currentLang !== 'undefined' ? currentLang : 'zh';
        return lang === 'en' ? 'Click to add description' : '点击添加说明';
    };
    
    // 渲染 Markdown 或占位符
    const renderTempDescription = () => {
        if (section.description) {
            if (typeof marked !== 'undefined') {
                try {
                    const html = marked.parse(section.description);
                    descriptionText.innerHTML = html;
                    descriptionText.title = getEditTitle();
                } catch (e) {
                    descriptionText.textContent = section.description;
                    descriptionText.title = getEditTitle();
                }
            } else {
                descriptionText.textContent = section.description;
                descriptionText.title = getEditTitle();
            }
        } else {
            if (section.suppressPlaceholder) {
                descriptionText.innerHTML = '';
                descriptionText.title = '';
            } else {
                descriptionText.innerHTML = `<span style="color: inherit; opacity: 0.6;">${getPlaceholderText()}</span>`;
                descriptionText.title = getAddTitle();
            }
        }
    };
    
    renderTempDescription();
    
    // 双击编辑功能
    descriptionText.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        editDescBtn.click();
    });
    
    // 单击也可以编辑（当没有说明时）
    descriptionText.addEventListener('click', (e) => {
        if (!section.description) {
            e.preventDefault();
            e.stopPropagation();
            editDescBtn.click();
        }
    });
    
    descriptionContent.appendChild(descriptionText);
    
    const descriptionEditor = document.createElement('textarea');
    descriptionEditor.className = 'temp-node-description-editor';
    descriptionEditor.placeholder = '';
    descriptionEditor.value = section.description || '';
    descriptionEditor.style.display = 'none';
    descriptionContent.appendChild(descriptionEditor);
    
    descriptionContainer.appendChild(descriptionContent);
    
    const descriptionControls = document.createElement('div');
    descriptionControls.className = 'temp-node-description-controls';
    descriptionControls.style.display = 'flex';
    
    const editDescBtn = document.createElement('button');
    editDescBtn.type = 'button';
    editDescBtn.className = 'temp-node-desc-action-btn temp-node-desc-edit-btn';
    editDescBtn.title = '编辑说明';
    editDescBtn.innerHTML = '<i class="fas fa-edit"></i>';
    descriptionControls.appendChild(editDescBtn);
    
    const delDescBtn = document.createElement('button');
    delDescBtn.type = 'button';
    delDescBtn.className = 'temp-node-desc-action-btn temp-node-desc-delete-btn';
    delDescBtn.title = '删除说明';
    delDescBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
    descriptionControls.appendChild(delDescBtn);
    
    descriptionContainer.appendChild(descriptionControls);
    
    // 编辑说明文字的事件处理
    const finishEditingDescription = () => {
        const newDesc = descriptionEditor.value.trim();
        section.description = newDesc;
        
        descriptionText.style.fontStyle = newDesc ? 'normal' : 'italic';
        descriptionText.style.opacity = newDesc ? '1' : '0.5';
        
        // 重新渲染 Markdown
        renderTempDescription();
        
        // 结束编辑后交给CSS通过hover/状态控制按钮显隐
        descriptionContainer.classList.remove('editing');
        
        descriptionEditor.style.display = 'none';
        descriptionText.style.display = 'block';
        saveTempNodes();
        console.log('[Canvas] 临时栏目说明已保存:', section.id);
    };
    
    editDescBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isEditing = descriptionEditor.style.display !== 'none';
        if (isEditing) {
            finishEditingDescription();
        } else {
            // 进入编辑模式
            descriptionEditor.style.display = 'block';
            descriptionText.style.display = 'none';
            // 编辑状态下强制显示按钮（CSS 通过 .editing 控制）
            descriptionContainer.classList.add('editing');
            descriptionEditor.focus();
            descriptionEditor.select();
        }
    });
    
    // 点击编辑框外部时自动保存
    descriptionEditor.addEventListener('blur', () => {
        if (descriptionEditor.style.display !== 'none') {
            finishEditingDescription();
        }
    });
    
    delDescBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        section.description = '';
        descriptionEditor.value = '';
        descriptionText.style.fontStyle = 'italic';
        descriptionText.style.opacity = '0.5';
        renderTempDescription();
        descriptionEditor.style.display = 'none';
        descriptionText.style.display = 'block';
        descriptionContainer.classList.remove('editing');
        saveTempNodes();
        console.log('[Canvas] 临时栏目说明已删除:', section.id);
    });
    
    descriptionEditor.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            finishEditingDescription();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            // 取消编辑，恢复原来的内容
            descriptionEditor.value = section.description || '';
            descriptionEditor.style.display = 'none';
            descriptionText.style.display = 'block';
            descriptionContainer.classList.remove('editing');
        }
    });
    
    const body = document.createElement('div');
    body.className = 'temp-node-body';
    
    const treeContainer = document.createElement('div');
    treeContainer.className = 'bookmark-tree temp-bookmark-tree';
    treeContainer.dataset.sectionId = section.id;
    treeContainer.dataset.treeType = 'temporary';
    
    const treeFragment = document.createDocumentFragment();
    section.items.forEach(item => {
        const node = buildTempTreeNode(section, item, 0);
        if (node) treeFragment.appendChild(node);
    });
    treeContainer.appendChild(treeFragment);
    body.appendChild(treeContainer);
    
    nodeElement.appendChild(header);
    nodeElement.appendChild(descriptionContainer);
    nodeElement.appendChild(body);
    
    applyTempSectionColor(section, nodeElement, header, colorBtn, colorInput);
    makeNodeDraggable(nodeElement, section);
    makeTempNodeResizable(nodeElement, section);
    setupTempSectionTreeInteractions(treeContainer, section);
    setupTempSectionBlankAreaMenu(nodeElement, section); // 新增：空白区域右键菜单
    setupTempSectionDropTargets(section, nodeElement, treeContainer, header);
    if (typeof attachTreeEvents === 'function') {
        attachTreeEvents(treeContainer);
    }
    if (typeof attachDragEvents === 'function') {
        attachDragEvents(treeContainer);
    }
    // 绑定指针拖拽事件（支持滚轮滚动）
    if (typeof attachPointerDragEvents === 'function') {
        attachPointerDragEvents(treeContainer);
        console.log('[Canvas] 临时栏目指针拖拽事件已绑定');
    }
    
    // 恢复滚动位置（在所有事件绑定之后，使用多次尝试确保成功）
    // 即使滚动位置是0也需要恢复，因为可能从非0位置变为0
    // 注意：滚动容器是 body (temp-node-body)，而不是 treeContainer
    if (!isNew) {
        const restoreScroll = () => {
            body.scrollTop = savedScrollTop;
            body.scrollLeft = savedScrollLeft;
            console.log('[Canvas] 恢复滚动位置:', { 
                sectionId: section.id, 
                target: { top: savedScrollTop, left: savedScrollLeft },
                actual: { top: body.scrollTop, left: body.scrollLeft }
            });
        };
        
        // 立即尝试
        restoreScroll();
        
        // 使用 requestAnimationFrame 延迟尝试
        requestAnimationFrame(() => {
            restoreScroll();
            // 再次延迟尝试（确保 DOM 完全渲染和事件绑定完成）
            setTimeout(restoreScroll, 10);
            setTimeout(restoreScroll, 50);
            setTimeout(restoreScroll, 100);
        });
    }
    
    nodeElement.offsetHeight;
    nodeElement.style.transition = '';
    
    if (!suppressScrollSync) {
        updateCanvasScrollBounds();
        updateScrollbarThumbs();
    }
    
    if (isNew) {
        nodeElement.classList.add('temp-node-enter');
        requestAnimationFrame(() => {
            nodeElement.classList.remove('temp-node-enter');
        });
    }
    
    addAnchorsToNode(nodeElement, section.id);
}

function normalizeHexColor(hex) {
    if (!hex || typeof hex !== 'string') return null;
    let sanitized = hex.trim();
    if (!sanitized) return null;
    sanitized = sanitized.startsWith('#') ? sanitized.slice(1) : sanitized;
    if (sanitized.length === 3) {
        sanitized = sanitized.split('').map((ch) => ch + ch).join('');
    }
    if (sanitized.length !== 6 || /[^0-9a-f]/i.test(sanitized)) {
        return null;
    }
    return sanitized.toLowerCase();
}

function hexToRgb(hex) {
    const normalized = normalizeHexColor(hex);
    if (!normalized) return null;
    const intVal = parseInt(normalized, 16);
    return {
        r: (intVal >> 16) & 255,
        g: (intVal >> 8) & 255,
        b: intVal & 255
    };
}

function rgbToHex(r, g, b) {
    const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));
    return `#${[clamp(r), clamp(g), clamp(b)]
        .map((channel) => channel.toString(16).padStart(2, '0'))
        .join('')}`;
}

function blendChannel(channel, target, factor) {
    const ratio = Math.max(0, Math.min(1, factor));
    return channel + (target - channel) * ratio;
}

function lightenHexColor(hex, amount) {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;
    const ratio = Math.max(0, Math.min(1, amount));
    return rgbToHex(
        blendChannel(rgb.r, 255, ratio),
        blendChannel(rgb.g, 255, ratio),
        blendChannel(rgb.b, 255, ratio)
    );
}

function darkenHexColor(hex, amount) {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;
    const ratio = Math.max(0, Math.min(1, amount));
    return rgbToHex(
        blendChannel(rgb.r, 0, ratio),
        blendChannel(rgb.g, 0, ratio),
        blendChannel(rgb.b, 0, ratio)
    );
}

function calculateRelativeLuminance({ r, g, b }) {
    const toLinear = (channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928
            ? normalized / 12.92
            : Math.pow((normalized + 0.055) / 1.055, 2.4);
    };
    const linearR = toLinear(r);
    const linearG = toLinear(g);
    const linearB = toLinear(b);
    return 0.2126 * linearR + 0.7152 * linearG + 0.0722 * linearB;
}

function pickReadableTextColor(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return '#0f172a';
    const luminance = calculateRelativeLuminance(rgb);
    return luminance > 0.6 ? '#0f172a' : '#ffffff';
}

function buildAdaptivePalette(baseColor, preferLightening) {
    const adjust = preferLightening ? lightenHexColor : darkenHexColor;
    const base = adjust(baseColor, preferLightening ? 0.38 : 0.22);
    const hover = adjust(baseColor, preferLightening ? 0.5 : 0.32);
    const border = adjust(baseColor, preferLightening ? 0.58 : 0.45);
    const outline = adjust(baseColor, preferLightening ? 0.68 : 0.55);
    const muted = adjust(baseColor, preferLightening ? 0.22 : 0.12);

    const baseRgb = hexToRgb(baseColor) || { r: 37, g: 99, b: 235 };
    const shadowAlpha = preferLightening ? 0.24 : 0.3;
    const shadow = `rgba(${baseRgb.r}, ${baseRgb.g}, ${baseRgb.b}, ${shadowAlpha})`;

    return {
        base,
        hover,
        border,
        outline,
        subtle: muted,
        icon: pickReadableTextColor(base),
        hoverIcon: pickReadableTextColor(hover),
        shadow
    };
}

function createTempSectionPalettes(color) {
    const normalizedValue = normalizeHexColor(color);
    const normalizedColor = normalizedValue ? `#${normalizedValue}` : TEMP_SECTION_DEFAULT_COLOR;
    const sectionRgb = hexToRgb(normalizedColor) || hexToRgb(TEMP_SECTION_DEFAULT_COLOR);
    const sectionLuminance = sectionRgb ? calculateRelativeLuminance(sectionRgb) : 0.5;
    const preferLightening = sectionLuminance < 0.45;

    return {
        primary: buildAdaptivePalette(normalizedColor, preferLightening),
        danger: buildAdaptivePalette('#ef4444', preferLightening)
    };
}

function applyTempSectionColor(section, nodeElement, header, colorButton, colorInput) {
    const rawColor = section.color || TEMP_SECTION_DEFAULT_COLOR;
    const normalizedValue = normalizeHexColor(rawColor);
    const safeColor = normalizedValue ? `#${normalizedValue}` : TEMP_SECTION_DEFAULT_COLOR;
    const palettes = createTempSectionPalettes(safeColor);

    if (nodeElement) {
        nodeElement.style.setProperty('--section-color', safeColor);
    }
    if (header) {
        header.style.setProperty('--section-color', safeColor);
    }

    const target = nodeElement || header;
    if (target) {
        target.style.setProperty('--temp-action-bg', palettes.primary.base);
        target.style.setProperty('--temp-action-hover-bg', palettes.primary.hover);
        target.style.setProperty('--temp-action-border', palettes.primary.border);
        target.style.setProperty('--temp-action-icon', palettes.primary.icon);
        target.style.setProperty('--temp-action-hover-icon', palettes.primary.hoverIcon);
        target.style.setProperty('--temp-action-shadow', palettes.primary.shadow);
        target.style.setProperty('--temp-action-outline', palettes.primary.outline);
        target.style.setProperty('--temp-action-muted-bg', palettes.primary.subtle);

        target.style.setProperty('--temp-action-danger-bg', palettes.danger.base);
        target.style.setProperty('--temp-action-danger-hover-bg', palettes.danger.hover);
        target.style.setProperty('--temp-action-danger-border', palettes.danger.border);
        target.style.setProperty('--temp-action-danger-icon', palettes.danger.icon);
        target.style.setProperty('--temp-action-danger-hover-icon', palettes.danger.hoverIcon);
        target.style.setProperty('--temp-action-danger-shadow', palettes.danger.shadow);
    }

    if (colorInput) {
        colorInput.value = safeColor;
    }
}

function beginTempSectionTitleEdit(section, input, renameButton) {
    if (!input) return;
    input.classList.add('editing');
    input.readOnly = false;
    input.removeAttribute('readonly');
    input.tabIndex = 0;
    input.focus();
    input.select();
    if (renameButton) {
        renameButton.classList.add('active');
    }
}

function finishTempSectionTitleEdit(section, input, renameButton, commit) {
    if (!input) return;
    if (commit) {
        const newTitle = input.value.trim() || getDefaultTempSectionTitle();
        section.title = newTitle;
        input.value = newTitle;
        saveTempNodes();
    } else {
        input.value = section.title || getDefaultTempSectionTitle();
    }
    input.classList.remove('editing');
    input.readOnly = true;
    input.setAttribute('readonly', 'readonly');
    input.tabIndex = -1;
    if (document.activeElement === input) {
        input.blur();
    }
    if (renameButton) {
        renameButton.classList.remove('active');
    }
}

function buildTempTreeNode(section, item, level) {
    if (!item) return null;
    
    const wrapper = document.createElement('div');
    wrapper.className = 'tree-node';
    wrapper.style.paddingLeft = `${level * 12}px`;
    
    const treeItem = document.createElement('div');
    treeItem.className = 'tree-item';
    treeItem.dataset.nodeId = item.id;
    treeItem.dataset.nodeTitle = item.title || '';
    treeItem.dataset.nodeType = item.type;
    treeItem.dataset.sectionId = section.id;
    treeItem.dataset.treeType = 'temporary';
    treeItem.dataset.originalId = item.originalId || '';
    if (item.url) {
        treeItem.dataset.nodeUrl = item.url;
    }
    
    const toggle = document.createElement('span');
    toggle.className = 'tree-toggle';
    if (item.type === 'folder' && item.children && item.children.length) {
        toggle.classList.add('expanded');
    } else {
        toggle.style.opacity = '0';
    }
    
    let icon;
    if (item.type === 'folder') {
        icon = document.createElement('i');
        icon.className = 'tree-icon fas fa-folder-open';
    } else {
        icon = document.createElement('img');
        icon.className = 'tree-icon';
        const favicon = getFaviconUrl(item.url);
        if (favicon) {
            icon.src = favicon;
            icon.onerror = () => { icon.src = fallbackIcon; };
        } else {
            icon.src = fallbackIcon;
        }
    }
    
    let label;
    if (item.type === 'bookmark') {
        const link = document.createElement('a');
        link.className = 'tree-label tree-bookmark-link';
        link.href = item.url || '#';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = item.title || item.url || '未命名书签';
        label = link;
    } else {
        const span = document.createElement('span');
        span.className = 'tree-label';
        span.textContent = item.title || '未命名文件夹';
        label = span;
    }

    const badges = document.createElement('span');
    badges.className = 'change-badges';
    
    treeItem.appendChild(toggle);
    treeItem.appendChild(icon);
    treeItem.appendChild(label);
    treeItem.appendChild(badges);
    wrapper.appendChild(treeItem);

    setupTempTreeNodeDropHandlers(treeItem, section, item);

    if (item.type === 'folder') {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'tree-children expanded';
        childrenContainer.dataset.sectionId = section.id;
        
        if (item.children && item.children.length) {
            item.children.forEach(child => {
                const childNode = buildTempTreeNode(section, child, level + 1);
                if (childNode) childrenContainer.appendChild(childNode);
            });
        } else {
            toggle.style.opacity = '0';
        }
        
        wrapper.appendChild(childrenContainer);
    }
    
    return wrapper;
}

function setupTempSectionTreeInteractions(treeContainer, section) {
    if (!treeContainer) return;
    
    // 注意：空白区域右键菜单已移至 setupTempSectionBlankAreaMenu
}

function setupTempSectionBlankAreaMenu(sectionElement, section) {
    if (!sectionElement) return;
    
    // 在整个栏目容器上监听右键菜单
    sectionElement.addEventListener('contextmenu', (e) => {
        // 检查是否点击在树节点上
        const treeItem = e.target.closest('.tree-item[data-node-id]');
        // 检查是否点击在操作按钮上
        const actionBtn = e.target.closest('.temp-node-action-btn');
        const headerArea = e.target.closest('.temp-node-header');
        
        // 如果不是树节点、不是操作按钮，则显示空白区域菜单
        if (!treeItem && !actionBtn) {
            e.preventDefault();
            e.stopPropagation();
            showBlankAreaContextMenu(e, section.id, 'temporary');
        }
    });
}

function setupTempSectionDropTargets(section, sectionElement, treeContainer, header) {
    if (!sectionElement) return;
    const highlight = () => sectionElement.classList.add('temp-drop-highlight');
    const clearHighlight = () => sectionElement.classList.remove('temp-drop-highlight');

    const allowDrop = () => {
        const source = getCurrentDragSourceType();
        return source === 'permanent' || source === 'temporary';
    };

    const handleDrop = async (event) => {
        if (!allowDrop()) return;
        event.preventDefault();
        clearHighlight();
        try {
            const source = getCurrentDragSourceType();
            if (source === 'permanent') {
                const fallbackId = (typeof draggedNodeId !== 'undefined') ? draggedNodeId : null;
                const ids = collectPermanentSelectionIds(fallbackId);
                if (!ids.length) return;
                const payload = await resolvePermanentPayload(ids);
                if (payload && payload.length) {
                    insertTempItemsFromPayload(section.id, null, payload);
                    if (typeof deselectAll === 'function') {
                        deselectAll();
                    }
                }
            } else if (source === 'temporary') {
                const sourceSectionId = getTempDragSourceSectionId();
                if (!sourceSectionId) return;
                const fallbackId = (typeof draggedNodeId !== 'undefined') ? draggedNodeId : null;
                const ids = collectTemporarySelectionIds(sourceSectionId, fallbackId);
                if (!ids.length) return;
                if (sourceSectionId === section.id) {
                    moveTempItemsWithinSection(section.id, ids, null, null);
                } else {
                    moveTempItemsAcrossSections(sourceSectionId, section.id, ids, null, null);
                }
                if (typeof deselectAll === 'function') {
                    deselectAll();
                }
            }
        } catch (error) {
            console.error('[Canvas] 临时栏目接收拖拽失败:', error);
            alert('拖拽失败: ' + (error && error.message ? error.message : error));
        }
    };

    const handleDragOver = (event) => {
        if (!allowDrop()) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = getCurrentDragSourceType() === 'permanent' ? 'copy' : 'move';
        highlight();
    };

    const handleDragLeave = (event) => {
        if (!sectionElement.contains(event.relatedTarget)) {
            clearHighlight();
        }
    };

    // 扩大drop区域：整个栏目节点都可以接收拖放
    const targets = [sectionElement, treeContainer, header];
    targets.forEach(target => {
        if (!target) return;
        target.addEventListener('dragover', handleDragOver);
        target.addEventListener('dragleave', handleDragLeave);
        target.addEventListener('drop', handleDrop);
    });

    if (!CanvasState.dropCleanupBound) {
        document.addEventListener('dragend', () => {
            document.querySelectorAll('.temp-drop-highlight').forEach(el => el.classList.remove('temp-drop-highlight'));
            document.querySelectorAll('.temp-tree-drop-highlight').forEach(el => el.classList.remove('temp-tree-drop-highlight'));
            const workspaceEl = document.getElementById('canvasWorkspace');
            if (workspaceEl) {
                workspaceEl.classList.remove('canvas-drop-active');
            }
            if (CanvasState.dragState && CanvasState.dragState.dragSource === 'permanent') {
                scheduleClearTreeItemDragging(380);
            } else {
                clearTreeItemDragging();
            }
        }, true);
        CanvasState.dropCleanupBound = true;
    }
}

function getCurrentDragSourceType() {
    if (typeof draggedNodeTreeType !== 'undefined' && draggedNodeTreeType) {
        return draggedNodeTreeType;
    }
    if (CanvasState.dragState && CanvasState.dragState.dragSource) {
        return CanvasState.dragState.dragSource;
    }
    return null;
}

function getTempDragSourceSectionId() {
    if (typeof draggedNodeSectionId !== 'undefined' && draggedNodeSectionId) {
        return draggedNodeSectionId;
    }
    if (typeof draggedNodeId !== 'undefined' && draggedNodeId) {
        const meta = getSelectionMeta(draggedNodeId);
        if (meta && meta.sectionId) {
            return meta.sectionId;
        }
    }
    if (CanvasState.dragState && CanvasState.dragState.draggedData && CanvasState.dragState.draggedData.sectionId) {
        return CanvasState.dragState.draggedData.sectionId;
    }
    return null;
}

function collectPermanentSelectionIds(fallbackId) {
    const ids = [];
    const selection = (typeof selectedNodes !== 'undefined') ? selectedNodes : null;
    if (selection && typeof selection.forEach === 'function' && selection.size) {
        selection.forEach(id => {
            const meta = getSelectionMeta(id);
            const treeType = meta ? meta.treeType : 'permanent';
            if (treeType !== 'temporary') {
                ids.push(id);
            }
        });
    }
    if (fallbackId) {
        const meta = getSelectionMeta(fallbackId);
        if (!meta || meta.treeType !== 'temporary') {
            ids.push(fallbackId);
        }
    }
    return Array.from(new Set(ids.filter(Boolean)));
}

function collectTemporarySelectionIds(sectionId, fallbackId) {
    const ids = [];
    const selection = (typeof selectedNodes !== 'undefined') ? selectedNodes : null;
    if (selection && typeof selection.forEach === 'function' && selection.size) {
        selection.forEach(id => {
            const meta = getSelectionMeta(id);
            if (meta && meta.treeType === 'temporary' && meta.sectionId === sectionId) {
                ids.push(id);
            }
        });
    }
    if (fallbackId) {
        const meta = getSelectionMeta(fallbackId);
        if (meta && meta.treeType === 'temporary' && meta.sectionId === sectionId) {
            ids.push(fallbackId);
        } else if ((!meta || !meta.sectionId) && typeof draggedNodeId !== 'undefined' && draggedNodeId === fallbackId && draggedNodeSectionId === sectionId) {
            ids.push(fallbackId);
        }
    }
    return Array.from(new Set(ids.filter(Boolean)));
}

function setupTempTreeNodeDropHandlers(treeItem, section, item) {
    if (!treeItem || !section || !item || item.type !== 'folder') return;
    const allowDrop = () => getCurrentDragSourceType() === 'permanent' || getCurrentDragSourceType() === 'temporary';
    const highlight = () => treeItem.classList.add('temp-tree-drop-highlight');
    const clear = () => treeItem.classList.remove('temp-tree-drop-highlight');

    const handleDropToFolder = async () => {
        const source = getCurrentDragSourceType();
        if (source === 'permanent') {
            const fallbackId = (typeof draggedNodeId !== 'undefined') ? draggedNodeId : null;
            const ids = collectPermanentSelectionIds(fallbackId);
            if (!ids.length) return;
            const payload = await resolvePermanentPayload(ids);
            if (!payload || !payload.length) return;
            insertTempItemsFromPayload(section.id, item.id, payload);
            if (typeof deselectAll === 'function') {
                deselectAll();
            }
        } else if (source === 'temporary') {
            const sourceSectionId = getTempDragSourceSectionId();
            if (!sourceSectionId) return;
            const fallbackId = (typeof draggedNodeId !== 'undefined') ? draggedNodeId : null;
            const ids = collectTemporarySelectionIds(sourceSectionId, fallbackId);
            if (!ids.length) return;
            if (sourceSectionId === section.id) {
                moveTempItemsWithinSection(section.id, ids, item.id, null);
            } else {
                moveTempItemsAcrossSections(sourceSectionId, section.id, ids, item.id, null);
            }
            if (typeof deselectAll === 'function') {
                deselectAll();
            }
        }
    };

    treeItem.addEventListener('dragover', (event) => {
        if (!allowDrop()) return;
        if (getCurrentDragSourceType() === 'temporary' && item.type !== 'folder') return;
        event.preventDefault();
        event.dataTransfer.dropEffect = getCurrentDragSourceType() === 'permanent' ? 'copy' : 'move';
        highlight();
    });

    treeItem.addEventListener('dragleave', (event) => {
        if (!treeItem.contains(event.relatedTarget)) {
            clear();
        }
    });

    treeItem.addEventListener('drop', async (event) => {
        if (!allowDrop()) return;
        if (item.type !== 'folder') return;
        event.preventDefault();
        clear();
        try {
            await handleDropToFolder();
        } catch (error) {
            console.error('[Canvas] 临时栏目节点接收拖拽失败:', error);
            alert('拖拽失败: ' + (error && error.message ? error.message : error));
        }
    });
}

async function resolvePermanentPayload(nodeIds) {
    const results = [];
    if (!Array.isArray(nodeIds) || !nodeIds.length) return results;
    const api = (typeof browserAPI !== 'undefined' && browserAPI.bookmarks) ? browserAPI.bookmarks : (chrome && chrome.bookmarks ? chrome.bookmarks : null);
    if (api && typeof api.getSubTree === 'function') {
        for (const id of nodeIds) {
            try {
                const nodes = await api.getSubTree(id);
                if (nodes && nodes[0]) {
                    results.push(cloneBookmarkNode(nodes[0]));
                }
            } catch (error) {
                console.warn('[Canvas] 获取书签数据失败:', error);
            }
        }
    }
    if (!results.length && CanvasState.dragState && CanvasState.dragState.draggedData) {
        const data = CanvasState.dragState.draggedData;
        if (data && data.id && nodeIds.includes(data.id) && (data.url || data.children)) {
            results.push(cloneBookmarkNode(data));
        }
    }
    return results.filter(Boolean);
}

function getSelectionMeta(nodeId) {
    if (typeof selectedNodeMeta !== 'undefined' && selectedNodeMeta && typeof selectedNodeMeta.get === 'function') {
        return selectedNodeMeta.get(nodeId) || null;
    }
    return null;
}

function makeNodeDraggable(element, section) {
    const header = element.querySelector('.temp-node-header');
    if (!header) return;
    
    let lastClientX = 0;
    let lastClientY = 0;
    
    const onMouseDown = (e) => {
        const target = e.target;
        if (!target) return;
        if (target.closest('.temp-node-action-btn') ||
            target.classList.contains('temp-node-color-input') ||
            (target.classList.contains('temp-node-title') && target.classList.contains('editing')) ||
            target.closest('.canvas-node-anchor') ||
            target.closest('.canvas-anchor-zone')) {
            return;
        }
        
        lastClientX = e.clientX;
        lastClientY = e.clientY;
        
        CanvasState.dragState.isDragging = true;
        CanvasState.dragState.draggedElement = element;
        CanvasState.dragState.dragStartX = e.clientX;
        CanvasState.dragState.dragStartY = e.clientY;
        CanvasState.dragState.nodeStartX = section.x;
        CanvasState.dragState.nodeStartY = section.y;
        CanvasState.dragState.dragSource = 'temp-node';
        
        element.classList.add('dragging');
        element.style.transition = 'none';
        
        e.preventDefault();
    };
    
    header.addEventListener('mousedown', onMouseDown, true);
}

function updateSectionZIndex(sectionId, isPinned) {
    const element = document.getElementById(sectionId);
    if (!element) return;
    
    // 置顶的栏目 z-index 更高
    if (isPinned) {
        element.style.zIndex = '200';
    } else {
        element.style.zIndex = '100';
    }
}

// =============================================================================
// 栏目休眠管理（性能优化）- 基于视口可见性
// =============================================================================

// 取消栏目的休眠定时器
function cancelDormancyTimer(sectionId) {
    const timerInfo = CanvasState.dormancyTimers.get(sectionId);
    if (timerInfo && timerInfo.timer) {
        clearTimeout(timerInfo.timer);
        CanvasState.dormancyTimers.delete(sectionId);
    }
}

// 调度延迟休眠
function scheduleDormancy(section, reason) {
    const sectionId = section.id;
    
    // 取消之前的定时器
    cancelDormancyTimer(sectionId);
    
    // 确定延迟时间
    const delay = reason === 'viewport' 
        ? CanvasState.dormancyDelays.viewport 
        : CanvasState.dormancyDelays.occlusion;
    
    // 设置新的定时器
    const timer = setTimeout(() => {
        // 再次检查栏目是否仍然应该休眠
        const element = document.getElementById(sectionId);
        if (element && !section.dormant) {
            section.dormant = true;
            element.style.display = 'none';
        }
        CanvasState.dormancyTimers.delete(sectionId);
    }, delay);
    
    CanvasState.dormancyTimers.set(sectionId, {
        type: reason,
        timer: timer,
        scheduledAt: Date.now()
    });
}

// 立即唤醒栏目（取消定时器）
function wakeSection(section) {
    const sectionId = section.id;
    
    // 取消休眠定时器
    cancelDormancyTimer(sectionId);
    
    // 如果已经休眠，立即唤醒
    if (section.dormant) {
        section.dormant = false;
        const element = document.getElementById(sectionId);
        if (element) {
            element.style.display = '';
        }
    }
}

function manageSectionDormancy() {
    const workspace = document.getElementById('canvasWorkspace');
    if (!workspace) return;
    
    // 获取当前性能模式的缓冲区大小
    const currentSettings = CanvasState.performanceSettings[CanvasState.performanceMode];
    const margin = currentSettings ? currentSettings.margin : 50;
    
    // 无限制模式：不执行休眠
    if (margin === Infinity) {
        CanvasState.tempSections.forEach(section => {
            cancelDormancyTimer(section.id);
            if (section.dormant) {
                section.dormant = false;
                const element = document.getElementById(section.id);
                if (element) {
                    element.style.display = '';
                }
            }
        });
        return;
    }
    
    const workspaceRect = workspace.getBoundingClientRect();
    
    // 扩展的可见区域
    const visibleArea = {
        left: workspaceRect.left - margin,
        right: workspaceRect.right + margin,
        top: workspaceRect.top - margin,
        bottom: workspaceRect.bottom + margin
    };
    
    let dormantCount = 0;
    let activeCount = 0;
    let scheduledCount = 0;
    
    CanvasState.tempSections.forEach(section => {
        const element = document.getElementById(section.id);
        if (!element) return;
        
        // 置顶的栏目永远不休眠
        if (section.pinned) {
            wakeSection(section);
            activeCount++;
            return;
        }
        
        // 计算栏目的位置（考虑缩放和平移）
        const scale = CanvasState.zoom || 1;
        const x = section.x * scale + CanvasState.panOffsetX + workspaceRect.left;
        const y = section.y * scale + CanvasState.panOffsetY + workspaceRect.top;
        const width = (section.width || 360) * scale;
        const height = (section.height || 280) * scale;
        
        // 检查是否在可见区域内
        const isInViewport = !(
            x + width < visibleArea.left ||
            x > visibleArea.right ||
            y + height < visibleArea.top ||
            y > visibleArea.bottom
        );
        
        if (isInViewport) {
            // 在视口内，立即唤醒（如果已休眠）或取消休眠定时器
            wakeSection(section);
            activeCount++;
        } else {
            // 不在视口内，调度延迟休眠
            if (!section.dormant) {
                // 检查是否已经调度了休眠
                const timerInfo = CanvasState.dormancyTimers.get(section.id);
                if (!timerInfo) {
                    // 还没调度，现在调度
                    scheduleDormancy(section, 'viewport');
                    scheduledCount++;
                    activeCount++; // 还未休眠，仍然活跃
                } else {
                    // 已经调度了，等待定时器触发
                    activeCount++; // 还未休眠，仍然活跃
                }
            } else {
                // 已经休眠
                dormantCount++;
            }
        }
    });
    
    // 性能统计（不输出日志）
    // 活跃: activeCount, 休眠: dormantCount, 已调度: scheduledCount
}

function isSectionDormant(sectionId) {
    const section = getTempSection(sectionId);
    return section && section.dormant === true;
}

function wakeSectionById(sectionId) {
    const section = getTempSection(sectionId);
    if (!section || !section.dormant) return;
    
    section.dormant = false;
    const element = document.getElementById(section.id);
    if (element) {
        element.style.display = '';
    }
    
    saveTempNodes();
}

// 设置性能模式
function setPerformanceMode(mode) {
    if (!CanvasState.performanceSettings[mode]) {
        console.warn(`[Canvas] 无效的性能模式: ${mode}`);
        return;
    }
    
    CanvasState.performanceMode = mode;
    const settings = CanvasState.performanceSettings[mode];
    console.log(`[Canvas] 切换性能模式：${settings.name} - ${settings.description}`);
    
    // 保存到 localStorage
    try {
        localStorage.setItem('canvas-performance-mode', mode);
    } catch (error) {
        console.error('[Canvas] 保存性能模式失败:', error);
    }
    
    // 立即更新休眠状态
    manageSectionDormancy();
}

// 加载性能模式设置
function loadPerformanceMode() {
    try {
        const saved = localStorage.getItem('canvas-performance-mode');
        if (saved && CanvasState.performanceSettings[saved]) {
            CanvasState.performanceMode = saved;
            const settings = CanvasState.performanceSettings[saved];
            console.log(`[Canvas] 加载性能模式：${settings.name}`);
        }
    } catch (error) {
        console.error('[Canvas] 加载性能模式失败:', error);
    }
}

function removeTempNode(sectionId) {
    const element = document.getElementById(sectionId);
    if (element) {
        element.remove();
    }
    
    CanvasState.tempSections = CanvasState.tempSections.filter(section => section.id !== sectionId);
    
    // 重新计算序号：让剩余栏目的序号连续
    reorderSectionSequenceNumbers();
    
    saveTempNodes();
    scheduleBoundsUpdate();
    scheduleScrollbarUpdate();
    
    // 删除后重新管理休眠状态（可能唤醒休眠的栏目）
    scheduleDormancyUpdate();
}

function clearAllTempNodes() {
    if (!confirm('确定要清空所有临时栏目吗？')) return;
    
    const container = document.getElementById('canvasContent');
    if (!container) return;
    
    container.querySelectorAll('.temp-canvas-node').forEach(node => node.remove());
    container.querySelectorAll('.md-canvas-node').forEach(node => node.remove());
    CanvasState.tempSections = [];
    CanvasState.mdNodes = [];
    
    // 重置序号计数器
    CanvasState.tempSectionSequenceNumber = 0;
    CanvasState.mdNodeCounter = 0;
    
    saveTempNodes();
    updateCanvasScrollBounds();
    updateScrollbarThumbs();
}

// 重新计算所有临时栏目的序号，使其连续
function reorderSectionSequenceNumbers() {
    // 按当前序号排序
    const sortedSections = CanvasState.tempSections
        .filter(s => s.sequenceNumber) // 只处理有序号的
        .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    
    // 重新分配序号 1, 2, 3, ...
    sortedSections.forEach((section, index) => {
        const newSequenceNumber = index + 1;
        if (section.sequenceNumber !== newSequenceNumber) {
            section.sequenceNumber = newSequenceNumber;
            console.log(`[Canvas] 重新编号：${section.id} -> 序号 ${newSequenceNumber}`);
            
            // 更新DOM中的序号显示
            const element = document.getElementById(section.id);
            if (element) {
                const badge = element.querySelector('.temp-node-sequence-badge');
                if (badge) {
                    badge.textContent = newSequenceNumber;
                }
            }
        }
    });
    
    // 更新全局序号计数器为最大序号
    CanvasState.tempSectionSequenceNumber = sortedSections.length;
}

// 注意：这个函数已经不需要了，因为永久栏目在renderCurrentView中直接创建到canvas-content中
// 保留此函数以防其他地方调用，但实际上不做任何事
function movePermanentSectionToCanvas() {
    // 已废弃：永久栏目现在直接从template创建到canvas-content中
    console.log('[Canvas] 永久栏目已在canvas-content中（从template创建）');
}

// =============================================================================
// 永久栏目提示关闭功能
// =============================================================================

function setupPermanentSectionTipClose() {
    const closeBtn = document.getElementById('permanentSectionTipClose');
    const editBtn = document.getElementById('permanentSectionTipEditBtn');
    const tipText = document.getElementById('permanentSectionTip');
    const tipEditor = document.getElementById('permanentSectionTipEditor');
    const tipContainer = document.getElementById('permanentSectionTipContainer');
    
    if (!closeBtn || !tipContainer || !tipText || !tipEditor) {
        console.warn('[Canvas] 找不到提示相关元素');
        return;
    }
    
    // 折叠栏（像临时栏说明的占位小栏）
    let collapsedBar = tipContainer.querySelector('.permanent-section-tip-collapsed');
    if (!collapsedBar) {
        collapsedBar = document.createElement('div');
        collapsedBar.className = 'permanent-section-tip-collapsed';
        const lang = typeof currentLang !== 'undefined' ? currentLang : 'zh';
        const text = lang === 'en' ? 'Click to add description...' : '点击添加说明...';
        collapsedBar.innerHTML = `<i class="fas fa-info-circle" style="font-size:12px;"></i><span>${text}</span>`;
        tipContainer.appendChild(collapsedBar);
    }
    
    // 检查是否已经关闭过
    const isTipClosed = localStorage.getItem('canvas-permanent-tip-closed') === 'true';
    if (isTipClosed) {
        tipContainer.classList.add('collapsed');
    } else {
        tipContainer.classList.remove('collapsed');
    }
    
    // 多语言占位文本
    const getPlaceholderText = () => {
        const lang = typeof currentLang !== 'undefined' ? currentLang : 'zh';
        return lang === 'en' ? 'Click to add description...' : '点击添加说明...';
    };

    // 加载保存的说明文字并渲染（空内容显示占位提示）
    const savedTip = localStorage.getItem('canvas-permanent-tip-text');
    tipEditor.value = (savedTip || '');

    const renderTipContent = (text) => {
        const val = (text || '').trim();
        if (val) {
            if (typeof marked !== 'undefined') {
                try {
                    tipText.innerHTML = marked.parse(val);
                } catch (e) {
                    tipText.textContent = val;
                }
            } else {
                tipText.textContent = val;
            }
            tipText.title = '双击编辑说明';
        } else {
            tipText.innerHTML = `<span style="opacity: 0.6;">${getPlaceholderText()}</span>`;
            tipText.title = '点击添加说明';
        }
    };

    renderTipContent(savedTip || '');
    
    // 为说明文字添加双击编辑功能
    tipText.style.cursor = 'pointer';
    tipText.title = '双击编辑说明';
    tipText.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (editBtn) {
            editBtn.click();
        }
    });
    
    // 点击关闭按钮 -> 折叠而不是隐藏容器
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (isEditingTip) {
            // 提交并退出编辑
            const newText = tipEditor.value.trim();
            if (newText) {
                localStorage.setItem('canvas-permanent-tip-text', newText);
            } else {
                try { localStorage.removeItem('canvas-permanent-tip-text'); } catch {}
            }
            renderTipContent(newText);
            isEditingTip = false;
            const tipContent = tipContainer.querySelector('.permanent-section-tip-content');
            tipEditor.style.display = 'none';
            if (tipContent) tipContent.style.display = 'flex';
            if (editBtn) {
                editBtn.innerHTML = '<i class="fas fa-edit"></i>';
                editBtn.title = '编辑说明';
            }
            detachOutsideListener();
        }
        tipContainer.classList.add('collapsed');
        localStorage.setItem('canvas-permanent-tip-closed', 'true');
        console.log('[Canvas] 永久栏目提示已关闭');
    });

    // 点击折叠栏 -> 展开并进入编辑
    collapsedBar.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        tipContainer.classList.remove('collapsed');
        try { localStorage.setItem('canvas-permanent-tip-closed', 'false'); } catch {}
        // 进入编辑模式
        const tipContent = tipContainer.querySelector('.permanent-section-tip-content');
        if (tipContent) tipContent.style.display = 'none';
        tipEditor.style.display = 'block';
        tipEditor.focus();
        tipEditor.select();
        // 标记为编辑中并启用外部点击监听，确保可点击外部退出
        isEditingTip = true;
        attachOutsideListener();
        if (editBtn) {
            // 同步按钮状态为“保存”
            editBtn.innerHTML = '<i class="fas fa-save"></i>';
            editBtn.title = '保存说明（Ctrl/Cmd+Enter）';
        }
    });
    
    // 编辑功能
    let isEditingTip = false;
    let outsideHandlers = [];
    let clickAwayOverlay = null;

    const commitAndExit = () => {
        if (!isEditingTip) return;
        const newText = tipEditor.value.trim();
        if (newText) {
            localStorage.setItem('canvas-permanent-tip-text', newText);
        } else {
            try { localStorage.removeItem('canvas-permanent-tip-text'); } catch {}
        }
        renderTipContent(newText);
        isEditingTip = false;
        const tipContent = tipContainer.querySelector('.permanent-section-tip-content');
        tipEditor.style.display = 'none';
        if (tipContent) tipContent.style.display = 'flex';
        if (editBtn) {
            editBtn.innerHTML = '<i class="fas fa-edit"></i>';
            editBtn.title = '编辑说明';
        }
        detachOutsideListener();
        console.log('[Canvas] 点击外部自动保存永久栏目说明');
    };

    const addCapture = (node, type, handler) => {
        if (!node) return;
        node.addEventListener(type, handler, true);
        outsideHandlers.push(() => node.removeEventListener(type, handler, true));
    };

    const attachOutsideListener = () => {
        if (outsideHandlers.length) return;
        // 仅使用捕获监听检测外部点击，不使用覆盖层，避免遮挡输入框
        // 1) 在容器上捕获：点击容器内部但非输入框也算“外部”
        const containerCap = (e) => {
            if (!isEditingTip) return;
            const t = e.target;
            if (t === tipEditor || (tipEditor && tipEditor.contains(t))) return;
            if (editBtn && (t === editBtn || editBtn.contains(t))) return;
            if (closeBtn && (t === closeBtn || closeBtn.contains(t))) return;
            commitAndExit();
        };
        addCapture(tipContainer, 'pointerdown', containerCap);

        // 2) 全局捕获：window/document/body/html 以及主要画布区域
        const globalCap = (e) => {
            if (!isEditingTip) return;
            if (!tipContainer.contains(e.target)) commitAndExit();
        };
        addCapture(window, 'pointerdown', globalCap);
        addCapture(document, 'pointerdown', globalCap);
        addCapture(document.body, 'pointerdown', globalCap);
        addCapture(document.documentElement, 'pointerdown', globalCap);
        const ws = document.getElementById('canvasWorkspace');
        const cc = document.getElementById('canvasContent');
        addCapture(ws, 'pointerdown', globalCap);
        addCapture(cc, 'pointerdown', globalCap);

        // 兼容触摸/鼠标事件
        addCapture(window, 'mousedown', globalCap);
        addCapture(window, 'touchstart', globalCap);
    };
    const detachOutsideListener = () => {
        while (outsideHandlers.length) {
            const off = outsideHandlers.pop();
            try { off(); } catch {}
        }
        if (clickAwayOverlay && clickAwayOverlay.parentNode) {
            try { clickAwayOverlay.parentNode.removeChild(clickAwayOverlay); } catch {}
        }
        clickAwayOverlay = null;
        if (tipContainer) {
            if (typeof tipContainer.__oldZIndex !== 'undefined') {
                tipContainer.style.zIndex = tipContainer.__oldZIndex || '';
                delete tipContainer.__oldZIndex;
            }
        }
    };
    
    if (editBtn) {
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            
            const tipContent = tipContainer.querySelector('.permanent-section-tip-content');
            
            if (isEditingTip) {
                // 保存编辑（点击按钮明确保存）
                commitAndExit();
            } else {
                // 进入编辑模式
                isEditingTip = true;
                tipContent.style.display = 'none';
                tipEditor.style.display = 'block';
                // 每次进入编辑时，用已保存内容或空值填充
                const saved = localStorage.getItem('canvas-permanent-tip-text');
                tipEditor.value = (saved || '');
                tipEditor.focus();
                tipEditor.select();
                editBtn.innerHTML = '<i class="fas fa-save"></i>';
                editBtn.title = '保存说明（Ctrl/Cmd+Enter）';
                console.log('[Canvas] 进入永久栏目说明编辑模式');
                attachOutsideListener();
            }
        });
        
        // 编辑框快捷键处理
        tipEditor.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                editBtn.click();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                if (isEditingTip) {
                    // 取消编辑，不保存
                    isEditingTip = false;
                    const tipContent = tipContainer.querySelector('.permanent-section-tip-content');
                    tipEditor.style.display = 'none';
                    tipContent.style.display = 'flex';
                    editBtn.innerHTML = '<i class="fas fa-edit"></i>';
                    editBtn.title = '编辑说明';
                    const saved = localStorage.getItem('canvas-permanent-tip-text');
                    tipEditor.value = (saved || '');
                    detachOutsideListener();
                    console.log('[Canvas] 取消编辑永久栏目说明');
                }
            }
        });
        
        // 点击外部时自动保存并退出（空内容显示占位提示）
        tipEditor.addEventListener('blur', () => {
            if (isEditingTip) {
                isEditingTip = false;
                const tipContent = tipContainer.querySelector('.permanent-section-tip-content');
                tipEditor.style.display = 'none';
                if (tipContent) tipContent.style.display = 'flex';
                if (editBtn) {
                    editBtn.innerHTML = '<i class="fas fa-edit"></i>';
                    editBtn.title = '编辑说明';
                }
                const newText = tipEditor.value.trim();
                if (newText) {
                    localStorage.setItem('canvas-permanent-tip-text', newText);
                } else {
                    try { localStorage.removeItem('canvas-permanent-tip-text'); } catch {}
                }
                renderTipContent(newText);
                detachOutsideListener();
                console.log('[Canvas] 点击外部自动保存永久栏目说明');
            }
        });
    }

    // 折叠栏点击进入编辑时，确保文本为保存值或空
    if (collapsedBar) {
        collapsedBar.addEventListener('click', () => {
            const saved = localStorage.getItem('canvas-permanent-tip-text');
            tipEditor.value = (saved || '');
        });
    }
}

function setupPermanentSectionPinButton() {
    const pinBtn = document.getElementById('permanentSectionPinBtn');
    const permanentSection = document.getElementById('permanentSection');
    
    if (!pinBtn || !permanentSection) {
        console.warn('[Canvas] 找不到永久栏目置顶按钮或栏目元素');
        return;
    }
    
    // 加载置顶状态（默认为true）
    let isPinned = true;
    try {
        const savedState = localStorage.getItem('permanent-section-pinned');
        if (savedState !== null) {
            isPinned = savedState === 'true';
        }
    } catch (error) {
        console.error('[Canvas] 加载永久栏目置顶状态失败:', error);
    }
    
    // 应用初始状态
    updatePermanentSectionPinState(isPinned, pinBtn, permanentSection);
    
    // 添加点击事件
    pinBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isPinned = !isPinned;
        updatePermanentSectionPinState(isPinned, pinBtn, permanentSection);
        
        // 保存状态
        try {
            localStorage.setItem('permanent-section-pinned', isPinned.toString());
        } catch (error) {
            console.error('[Canvas] 保存永久栏目置顶状态失败:', error);
        }
    });
}

function updatePermanentSectionPinState(isPinned, pinBtn, permanentSection) {
    const pinLabel = (typeof currentLang !== 'undefined' && currentLang === 'en') ? 'Pin section' : '置顶栏目';
    const unpinLabel = (typeof currentLang !== 'undefined' && currentLang === 'en') ? 'Unpin section' : '取消置顶';
    
    if (isPinned) {
        pinBtn.classList.add('pinned');
        pinBtn.title = unpinLabel;
        pinBtn.innerHTML = '<i class="fas fa-thumbtack"></i>';
        permanentSection.style.zIndex = '200';
    } else {
        pinBtn.classList.remove('pinned');
        pinBtn.title = pinLabel;
        pinBtn.innerHTML = '<i class="fas fa-thumbtack" style="opacity: 0.5;"></i>';
        permanentSection.style.zIndex = '100';
    }
}

// =============================================================================
// 拖回永久栏目功能
// =============================================================================

function setupPermanentDropTarget() {
    const permanentSection = document.getElementById('permanentSection');
    if (!permanentSection) return;
    
    const allowDrop = () => getCurrentDragSourceType() === 'temporary';
    const clearHighlight = () => permanentSection.classList.remove('drop-target-highlight');
    
    permanentSection.addEventListener('dragover', (e) => {
        if (!allowDrop()) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    });
    
    permanentSection.addEventListener('dragleave', (e) => {
        if (!permanentSection.contains(e.relatedTarget)) {
            clearHighlight();
        }
    });
    
    permanentSection.addEventListener('drop', async (e) => {
        if (!allowDrop()) return;
        e.preventDefault();
        clearHighlight();
        try {
            const sourceSectionId = getTempDragSourceSectionId();
            if (!sourceSectionId) return;
            const fallbackId = (typeof draggedNodeId !== 'undefined') ? draggedNodeId : null;
            const ids = collectTemporarySelectionIds(sourceSectionId, fallbackId);
            let payload = [];
            let sectionRemoved = false;
            if (ids.length) {
                payload = extractTempItemsPayload(sourceSectionId, ids);
                if (!payload || !payload.length) return;
                removeTempItemsById(sourceSectionId, ids);
                ensureTempSectionRendered(sourceSectionId);
            } else if (CanvasState.dragState && CanvasState.dragState.draggedData && CanvasState.dragState.draggedData.id === sourceSectionId) {
                const sectionData = CanvasState.dragState.draggedData;
                const children = (sectionData.items || []).map(item => serializeTempItemForClipboard(item));
                payload = [{
                    title: sectionData.title || getDefaultTempSectionTitle(),
                    type: 'folder',
                    children
                }];
                removeTempNode(sectionData.id);
                sectionRemoved = true;
            }

            if (!payload || !payload.length) return;
            await addToPermanentBookmarks(payload);
            if (!sectionRemoved) {
                ensureTempSectionRendered(sourceSectionId);
            }
            if (typeof deselectAll === 'function') {
                deselectAll();
            }
            // 刷新永久书签树
            if (typeof refreshBookmarkTree === 'function') {
                await refreshBookmarkTree();
            }
        } catch (error) {
            console.error('[Canvas] 添加到书签失败:', error);
            alert('添加到书签失败: ' + (error && error.message ? error.message : error));
        }
    });
    
    document.addEventListener('dragend', clearHighlight, true);
}

async function addToPermanentBookmarks(payload, parentIdOverride = null) {
    const items = Array.isArray(payload) ? payload : [payload];
    if (!items.length) return;
    if (!browserAPI || !browserAPI.bookmarks || typeof browserAPI.bookmarks.create !== 'function') {
        throw new Error('当前环境不支持书签操作');
    }
    const tree = await browserAPI.bookmarks.getTree();
    const bookmarkBar = tree[0].children.find(child => child.title === '书签栏' || child.id === '1');
    if (!bookmarkBar) {
        throw new Error('找不到书签栏');
    }
    const parentId = parentIdOverride || bookmarkBar.id;
    for (const item of items) {
        await createBookmarkFromPayload(parentId, null, item);
    }
}

// =============================================================================
// 事件监听设置
// =============================================================================

function setupCanvasEventListeners() {
    // 鼠标移动 - 拖动节点（性能优化版）
    document.addEventListener('mousemove', (e) => {
        if (CanvasState.dragState.isDragging && CanvasState.dragState.draggedElement && CanvasState.dragState.dragSource === 'temp-node') {
            // 计算鼠标在屏幕上的移动距离
            const deltaX = e.clientX - CanvasState.dragState.dragStartX;
            const deltaY = e.clientY - CanvasState.dragState.dragStartY;
            
            // 除以缩放比例得到在canvas-content坐标系中的实际移动距离
            const scaledDeltaX = deltaX / CanvasState.zoom;
            const scaledDeltaY = deltaY / CanvasState.zoom;
            
            const newX = CanvasState.dragState.nodeStartX + scaledDeltaX;
            const newY = CanvasState.dragState.nodeStartY + scaledDeltaY;
            
            // Directly update left/top for real-time edge following
            CanvasState.dragState.draggedElement.style.left = newX + 'px';
            CanvasState.dragState.draggedElement.style.top = newY + 'px';
            // Remove transform as we are updating left/top directly
            CanvasState.dragState.draggedElement.style.transform = 'none';
            
            // 更新节点数据（实际位置）
            const nodeId = CanvasState.dragState.draggedElement.id;
            const section = CanvasState.tempSections.find(n => n.id === nodeId) ||
                            (Array.isArray(CanvasState.mdNodes) ? CanvasState.mdNodes.find(n => n.id === nodeId) : null);
            if (section) {
                section.x = newX;
                section.y = newY;
            }
            
            // 实时更新连接线
            renderEdges();
            
            // 阻止文本选择
            e.preventDefault();
        }
    }, false);
    
    // 鼠标释放
    document.addEventListener('mouseup', () => {
        if (CanvasState.dragState.isDragging && CanvasState.dragState.draggedElement) {
            const element = CanvasState.dragState.draggedElement;
            element.classList.remove('dragging');
            
            // 应用最终位置（从 transform 转回 left/top）
            const nodeId = element.id;
            const section = CanvasState.tempSections.find(n => n.id === nodeId) ||
                            (Array.isArray(CanvasState.mdNodes) ? CanvasState.mdNodes.find(n => n.id === nodeId) : null);
            if (section) {
                element.style.transform = 'none';
                element.style.left = section.x + 'px';
                element.style.top = section.y + 'px';
            }
            
            CanvasState.dragState.isDragging = false;
            CanvasState.dragState.draggedElement = null;
            
            saveTempNodes();
            scheduleBoundsUpdate();
            scheduleScrollbarUpdate();
        }
    }, false);
    
    // 工具栏按钮
    const importBtn = document.getElementById('importCanvasBtn');
    const exportBtn = document.getElementById('exportCanvasBtn');
    const clearBtn = document.getElementById('clearTempNodesBtn');
    
    if (importBtn) importBtn.addEventListener('click', showImportDialog);
    if (exportBtn) exportBtn.addEventListener('click', exportCanvas);
    if (clearBtn) clearBtn.addEventListener('click', clearAllTempNodes);
    
    // 设置永久栏目拖放目标
    setupPermanentDropTarget();

    // 空白画布双击：创建 Obsidian Canvas 风格的“空白栏目”（纯 Markdown 文本卡片）
    const workspace = document.getElementById('canvasWorkspace');
    if (workspace) {
        // 空白处单击：清除 Markdown 节点选中
        workspace.addEventListener('mousedown', (e) => {
            const target = e.target;
            // 在已有节点/永久栏目/滚动条/缩放控件内不清除
            const inMd = !!target.closest('.md-canvas-node');
            const inTemp = !!target.closest('.temp-canvas-node');
            const inPermanent = !!target.closest('#permanentSection');
            const isUI = !!target.closest('.canvas-scrollbar, .canvas-zoom-indicator, .view-actions');
            const isForm = ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT', 'LABEL'].includes(target.tagName);
            if (inMd || inTemp || inPermanent || isUI || isForm) return;
            clearMdSelection();
        }, true);

        workspace.addEventListener('dblclick', async (e) => {
            // 忽略在已有临时栏目、永久栏目、滚动条、缩放控件、输入控件内的双击
            const target = e.target;
            const isInsideTemp = !!target.closest('.temp-canvas-node');
            const isInsidePermanent = !!target.closest('#permanentSection');
            const isUI = !!target.closest('.canvas-scrollbar, .canvas-zoom-indicator, .view-actions');
            const isForm = ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT', 'LABEL'].includes(target.tagName);
            if (isInsideTemp || isInsidePermanent || isUI || isForm) return;

            // 计算在 canvas-content 坐标系中的点击位置
            const rect = workspace.getBoundingClientRect();
            const clickX = e.clientX;
            const clickY = e.clientY;
            const canvasX = (clickX - rect.left - CanvasState.panOffsetX) / CanvasState.zoom;
            const canvasY = (clickY - rect.top - CanvasState.panOffsetY) / CanvasState.zoom;

            try {
                const nodeId = await createMdNode(canvasX, canvasY, '');
                // 自动聚焦到编辑器，保持内容为空（真正的空白）
                requestAnimationFrame(() => {
                    const el = document.getElementById(nodeId);
                    if (!el) return;
                    const editor = el.querySelector('.md-canvas-editor');
                    if (editor) editor.focus();
                });
            } catch (err) {
                console.error('[Canvas] 双击创建空白栏目失败:', err);
            }
        });
    }
}

// =============================================================================
// 导入导出功能
// =============================================================================

function showImportDialog() {
    // 创建导入对话框
    const dialog = document.createElement('div');
    dialog.className = 'import-dialog';
    dialog.id = 'canvasImportDialog';
    
    dialog.innerHTML = `
        <div class="import-dialog-content">
            <div class="import-dialog-header">
                <h3>导入书签</h3>
                <button class="import-dialog-close" id="closeImportDialog">&times;</button>
            </div>
            <div class="import-dialog-body">
                <div class="import-options">
                    <button class="import-option-btn" id="importHtmlBtn">
                        <i class="fas fa-file-code" style="font-size: 24px;"></i>
                        <span>导入 HTML 书签</span>
                    </button>
                    <button class="import-option-btn" id="importJsonBtn">
                        <i class="fas fa-file-code" style="font-size: 24px;"></i>
                        <span>导入 JSON 书签</span>
                    </button>
                </div>
                <input type="file" id="canvasFileInput" accept=".html,.json" style="display: none;">
            </div>
        </div>
    `;
    
    document.body.appendChild(dialog);
    
    // 事件监听
    document.getElementById('closeImportDialog').addEventListener('click', () => {
        dialog.remove();
    });
    
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) dialog.remove();
    });
    
    document.getElementById('importHtmlBtn').addEventListener('click', () => {
        const input = document.getElementById('canvasFileInput');
        input.accept = '.html';
        input.dataset.type = 'html';
        input.click();
    });
    
    document.getElementById('importJsonBtn').addEventListener('click', () => {
        const input = document.getElementById('canvasFileInput');
        input.accept = '.json';
        input.dataset.type = 'json';
        input.click();
    });
    
    document.getElementById('canvasFileInput').addEventListener('change', handleFileImport);
}

async function handleFileImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const type = e.target.dataset.type;
    
    try {
        const text = await file.text();
        
        if (type === 'html') {
            await importHtmlBookmarks(text);
        } else {
            await importJsonBookmarks(text);
        }
        
        document.getElementById('canvasImportDialog').remove();
        alert('导入成功！');
    } catch (error) {
        console.error('[Canvas] 导入失败:', error);
        alert('导入失败: ' + error.message);
    }
    
    e.target.value = '';
}

async function importHtmlBookmarks(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const links = doc.querySelectorAll('a[href]');
    
    let x = 100;
    let y = 100;
    
    for (const [index, link] of Array.from(links).entries()) {
        const bookmark = {
            id: 'imported-' + Date.now() + '-' + index,
            title: link.textContent,
            url: link.href,
            type: 'bookmark'
        };
        
        await createTempNode(bookmark, x, y);
        x += 30;
        y += 30;
    }
}

async function importJsonBookmarks(json) {
    const data = JSON.parse(json);
    
    let x = 100;
    let y = 100;
    
    const processNode = async (node) => {
        if (node.url) {
            const bookmark = {
                id: node.id || 'imported-' + Date.now(),
                title: node.name || node.title,
                url: node.url,
                type: 'bookmark'
            };
            await createTempNode(bookmark, x, y);
            x += 30;
            y += 30;
        }
        
        if (node.children) {
            for (const child of node.children) {
                await processNode(child);
            }
        }
    };
    
    if (data.roots) {
        for (const root of Object.values(data.roots)) {
            if (root.children) {
                for (const child of root.children) {
                    await processNode(child);
                }
            }
        }
    } else {
        await processNode(data);
    }
}

function exportCanvas() {
    const canvasData = {
        nodes: [],
        edges: []
    };
    
    // 添加永久栏目节点
    canvasData.nodes.push({
        id: 'permanent-section',
        type: 'group',
        x: window.innerWidth / 2 - 300,
        y: window.innerHeight / 2 - 300,
        width: 600,
        height: 600,
        label: 'Bookmark Tree (永久栏目)',
        color: '4'
    });
    
    // 添加临时节点（书签栏目 -> 导出为文本）
    CanvasState.tempSections.forEach(section => {
        const hasDesc = section.description && typeof section.description === 'string' && section.description.trim().length > 0;
        const hasItems = Array.isArray(section.items) && section.items.length > 0;

        // 当说明与条目都为空：导出空文本，确保“什么都没有”
        let mdText = '';
        if (hasDesc && !hasItems) {
            mdText = section.description;
        } else if (!hasDesc && hasItems) {
            // 仅导出条目列表为 Markdown（不加标题行）
            const lines = [];
            const appendItem = (item, depth = 0) => {
                const indent = '  '.repeat(depth);
                if (item.type === 'bookmark') {
                    const title = item.title || item.url || '未命名书签';
                    const url = item.url || '#';
                    lines.push(`${indent}- [${title}](${url})`);
                } else {
                    lines.push(`${indent}- ${item.title || '未命名文件夹'}`);
                    if (item.children && item.children.length) {
                        item.children.forEach(child => appendItem(child, depth + 1));
                    }
                }
            };
            section.items.forEach(item => appendItem(item, 0));
            mdText = lines.join('\n');
        } else if (hasDesc && hasItems) {
            // 两者都存在时，保留说明并在其后追加条目列表
            const lines = [];
            const appendItem = (item, depth = 0) => {
                const indent = '  '.repeat(depth);
                if (item.type === 'bookmark') {
                    const title = item.title || item.url || '未命名书签';
                    const url = item.url || '#';
                    lines.push(`${indent}- [${title}](${url})`);
                } else {
                    lines.push(`${indent}- ${item.title || '未命名文件夹'}`);
                    if (item.children && item.children.length) {
                        item.children.forEach(child => appendItem(child, depth + 1));
                    }
                }
            };
            section.items.forEach(item => appendItem(item, 0));
            const listText = lines.join('\n');
            mdText = `${section.description.trim()}\n\n${listText}`;
        }

        const textNode = {
            id: `${section.id}-text`,
            type: 'text',
            x: section.x,
            y: section.y,
            width: section.width || TEMP_SECTION_DEFAULT_WIDTH,
            height: section.height || TEMP_SECTION_DEFAULT_HEIGHT,
            text: mdText,
            color: section.color
        };
        canvasData.nodes.push(textNode);
    });
    
    // 添加 Markdown 文本卡片（与 Obsidian Canvas 文本节点一致）
    if (Array.isArray(CanvasState.mdNodes)) {
        CanvasState.mdNodes.forEach(node => {
            canvasData.nodes.push({
                id: node.id,
                type: 'text',
                x: node.x,
                y: node.y,
                width: node.width || MD_NODE_DEFAULT_WIDTH,
                height: node.height || MD_NODE_DEFAULT_HEIGHT,
                text: typeof node.text === 'string' ? node.text : '',
                // 颜色可选，遵循规范可省略
                ...(node.color ? { color: node.color } : {})
            });
        });
    }
    
    // 添加连接线
    if (Array.isArray(CanvasState.edges)) {
        canvasData.edges = CanvasState.edges.map(edge => ({
            id: edge.id,
            fromNode: edge.fromNode,
            fromSide: edge.fromSide,
            toNode: edge.toNode,
            toSide: edge.toSide
        }));
    }
    
    // 生成并下载文件
    const blob = new Blob([JSON.stringify(canvasData, null, 2)], { 
        type: 'application/json' 
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bookmark-canvas-${Date.now()}.canvas`;
    a.click();
    URL.revokeObjectURL(url);
    
    alert('Canvas已导出为 .canvas 文件！');
}

function formatSectionText(section) {
    const lines = [`# ${section.title || '临时栏目'}`, ''];
    
    const appendItem = (item, depth = 0) => {
        const indent = '  '.repeat(depth);
        if (item.type === 'bookmark') {
            const title = item.title || item.url || '未命名书签';
            const url = item.url || '#';
            lines.push(`${indent}- [${title}](${url})`);
        } else {
            lines.push(`${indent}- ${item.title || '未命名文件夹'}`);
            if (item.children && item.children.length) {
                item.children.forEach(child => appendItem(child, depth + 1));
            }
        }
    };
    
    section.items.forEach(item => appendItem(item, 0));
    
    return lines.join('\n');
}

// =============================================================================
// 数据持久化
// =============================================================================

function saveTempNodes() {
    try {
        const state = {
            sections: CanvasState.tempSections,
            tempSectionCounter: CanvasState.tempSectionCounter,
            tempItemCounter: CanvasState.tempItemCounter,
            colorCursor: CanvasState.colorCursor,
            // 新增：保存 Markdown 文本卡片
            mdNodes: CanvasState.mdNodes,
            mdNodeCounter: CanvasState.mdNodeCounter,
            // 新增：保存连接线
            edges: CanvasState.edges,
            edgeCounter: CanvasState.edgeCounter,
            timestamp: Date.now()
        };
        localStorage.setItem(TEMP_SECTION_STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
        console.error('[Canvas] 保存临时栏目失败:', error);
    }
}

function loadTempNodes() {
    try {
        CanvasState.tempSections = [];
        CanvasState.tempSectionCounter = 0;
        CanvasState.tempItemCounter = 0;
        CanvasState.colorCursor = 0;
        CanvasState.mdNodes = [];
        CanvasState.mdNodeCounter = 0;
        CanvasState.edges = [];
        CanvasState.edgeCounter = 0;
        
        let loaded = false;
        const saved = localStorage.getItem(TEMP_SECTION_STORAGE_KEY);
        if (saved) {
            const state = JSON.parse(saved);
            CanvasState.tempSections = Array.isArray(state.sections) ? state.sections : [];
            CanvasState.tempSectionCounter = state.tempSectionCounter || CanvasState.tempSections.length;
            CanvasState.tempItemCounter = state.tempItemCounter || 0;
            CanvasState.colorCursor = state.colorCursor || 0;
            CanvasState.mdNodes = Array.isArray(state.mdNodes) ? state.mdNodes : [];
            CanvasState.mdNodeCounter = state.mdNodeCounter || CanvasState.mdNodes.length || 0;
            CanvasState.edges = Array.isArray(state.edges) ? state.edges : [];
            CanvasState.edgeCounter = state.edgeCounter || CanvasState.edges.length || 0;
            loaded = true;
        } else {
            const legacy = localStorage.getItem(LEGACY_TEMP_NODE_STORAGE_KEY);
            if (legacy) {
                const legacyState = JSON.parse(legacy);
                const legacyNodes = Array.isArray(legacyState.nodes) ? legacyState.nodes : [];
                legacyNodes.forEach((legacyNode, index) => {
                    const section = convertLegacyTempNode(legacyNode, index);
                    if (section) {
                        CanvasState.tempSections.push(section);
                    }
                });
                loaded = CanvasState.tempSections.length > 0;
                if (loaded) {
                    saveTempNodes();
                }
            }
        }
        
        if (!loaded) {
            CanvasState.tempSections = [];
        }
        
        // 根据已有ID刷新计数
        refreshTempSectionCounters();
        
        // 恢复序号计数器（找到最大的序号）
        let maxSequenceNumber = 0;
        CanvasState.tempSections.forEach(section => {
            if (section.sequenceNumber && section.sequenceNumber > maxSequenceNumber) {
                maxSequenceNumber = section.sequenceNumber;
            }
        });
        CanvasState.tempSectionSequenceNumber = maxSequenceNumber;
        
        suppressScrollSync = true;
        try {
            CanvasState.tempSections.forEach(section => {
                section.width = section.width || TEMP_SECTION_DEFAULT_WIDTH;
                section.height = section.height || TEMP_SECTION_DEFAULT_HEIGHT;
                renderTempNode(section);
            });
            // 渲染 Markdown 文本卡片
            CanvasState.mdNodes.forEach(node => {
                node.width = node.width || MD_NODE_DEFAULT_WIDTH;
                node.height = node.height || MD_NODE_DEFAULT_HEIGHT;
                renderMdNode(node);
            });
        } finally {
            suppressScrollSync = false;
        }
        
        console.log(`[Canvas] 加载了 ${CanvasState.tempSections.length} 个临时栏目`);
        
        loadPermanentSectionPosition();
        updateCanvasScrollBounds();
        updateScrollbarThumbs();
        
        // 初始化休眠状态
        scheduleDormancyUpdate();
        
        // 渲染连接线
        renderEdges();
    } catch (error) {
        console.error('[Canvas] 加载临时栏目失败:', error);
    }
}

// =============================================================================
// 连接线功能 (Obsidian Canvas 风格)
// =============================================================================

function setupCanvasEdgesLayer() {
    const content = document.getElementById('canvasContent');
    if (!content) return;
    if (content.querySelector('.canvas-edges')) return;
    
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'canvas-edges');
    // Insert as first child so it's behind everything
    content.insertBefore(svg, content.firstChild);
}

function addAnchorsToNode(nodeElement, nodeId) {
    if (!nodeElement) return;
    // Remove existing anchors and zones if any to avoid duplicates
    nodeElement.querySelectorAll('.canvas-node-anchor, .canvas-anchor-zone').forEach(el => el.remove());
    
    ['top', 'right', 'bottom', 'left'].forEach(side => {
        // Create hover zone first (so it can affect anchor via sibling selector if needed, 
        // though we might use JS for more reliable hover handling if CSS is tricky)
        const zone = document.createElement('div');
        zone.className = `canvas-anchor-zone zone-${side}`;
        zone.dataset.side = side;
        nodeElement.appendChild(zone);
        
        const anchor = document.createElement('div');
        anchor.className = 'canvas-node-anchor';
        anchor.dataset.nodeId = nodeId;
        anchor.dataset.side = side;
        nodeElement.appendChild(anchor);
        
        anchor.addEventListener('mousedown', (e) => {
            startConnection(e, nodeId, side);
        }, true);
    });
}

function startConnection(e, nodeId, side) {
    e.stopPropagation();
    e.preventDefault();
    CanvasState.isConnecting = true;
    CanvasState.connectionStart = { nodeId, side, x: e.clientX, y: e.clientY };
    const workspace = document.getElementById('canvasWorkspace');
    if (workspace) workspace.classList.add('connecting');
    
    // 隐藏连接线工具栏
    hideEdgeToolbar();
    
    // Create temporary path for dragging
    const svg = document.querySelector('.canvas-edges');
    if (svg) {
        let tempPath = document.getElementById('temp-connection-path');
        if (!tempPath) {
            tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            tempPath.setAttribute('id', 'temp-connection-path');
            tempPath.setAttribute('class', 'canvas-edge');
            tempPath.style.opacity = '0.5';
            svg.appendChild(tempPath);
        }
    }
}

function updateConnection(e) {
    if (!CanvasState.isConnecting || !CanvasState.connectionStart) return;
    e.preventDefault();
    
    const svg = document.querySelector('.canvas-edges');
    const tempPath = document.getElementById('temp-connection-path');
    if (!svg || !tempPath) return;
    
    const startPos = getAnchorPosition(CanvasState.connectionStart.nodeId, CanvasState.connectionStart.side);
    if (!startPos) return;
    
    // Calculate end position in canvas coordinates
    const rect = svg.getBoundingClientRect();
    const zoom = CanvasState.zoom || 1;
    const endX = (e.clientX - rect.left) / zoom;
    const endY = (e.clientY - rect.top) / zoom;
    
    const d = getEdgePathD(startPos.x, startPos.y, endX, endY, CanvasState.connectionStart.side, null);
    tempPath.setAttribute('d', d);
}

function endConnection(e) {
    if (!CanvasState.isConnecting) return;
    CanvasState.isConnecting = false;
    const workspace = document.getElementById('canvasWorkspace');
    if (workspace) workspace.classList.remove('connecting');
    
    const tempPath = document.getElementById('temp-connection-path');
    if (tempPath) tempPath.remove();
    
    // Use composedPath if available to get all elements under cursor, 
    // or just elementFromPoint. elementFromPoint might hit the dragging line if not careful,
    // but we removed it just above.
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const anchor = target ? target.closest('.canvas-node-anchor') : null;
    const nodeEl = target ? target.closest('.temp-canvas-node, .md-canvas-node, #permanentSection') : null;
    
    if (CanvasState.connectionStart) {
        let toNodeId = null;
        let toSide = null;

        if (anchor) {
            toNodeId = anchor.dataset.nodeId;
            toSide = anchor.dataset.side;
        } else if (nodeEl) {
            // Dropped on a node but not an anchor -> auto-connect to nearest side
            toNodeId = nodeEl.id;
            // Special case for permanent section ID normalization
            if (toNodeId === 'permanentSection') toNodeId = 'permanent-section';
            
            const rect = nodeEl.getBoundingClientRect();
            toSide = getNearestSide(rect, e.clientX, e.clientY);
        }

        if (toNodeId && toSide) {
             // Prevent duplicate connection to exact same point (optional, but good)
             if (toNodeId !== CanvasState.connectionStart.nodeId || toSide !== CanvasState.connectionStart.side) {
                 addEdge(CanvasState.connectionStart.nodeId, CanvasState.connectionStart.side, toNodeId, toSide);
             }
        }
    }
    CanvasState.connectionStart = null;
}

function getNearestSide(rect, x, y) {
    const distTop = Math.abs(y - rect.top);
    const distBottom = Math.abs(y - rect.bottom);
    const distLeft = Math.abs(x - rect.left);
    const distRight = Math.abs(x - rect.right);
    const min = Math.min(distTop, distBottom, distLeft, distRight);
    if (min === distTop) return 'top';
    if (min === distBottom) return 'bottom';
    if (min === distLeft) return 'left';
    return 'right';
}

function addEdge(fromNode, fromSide, toNode, toSide) {
    // Check for existing identical edge
    const exists = CanvasState.edges.some(e => 
        e.fromNode === fromNode && e.fromSide === fromSide &&
        e.toNode === toNode && e.toSide === toSide
    );
    if (exists) return;
    
    const id = `edge-${++CanvasState.edgeCounter}-${Date.now()}`;
    CanvasState.edges.push({ 
        id, 
        fromNode, 
        fromSide, 
        toNode, 
        toSide,
        color: null, // 预设颜色编号 (1-6) 或 null
        colorHex: null, // 自定义十六进制颜色
        label: '' // 连接线文字标签
    });
    renderEdges();
    saveTempNodes();
}

function removeEdge(edgeId) {
    CanvasState.edges = CanvasState.edges.filter(e => e.id !== edgeId);
    if (CanvasState.selectedEdgeId === edgeId) {
        clearEdgeSelection();
    }
    renderEdges();
    saveTempNodes();
}

function renderEdges() {
    const svg = document.querySelector('.canvas-edges');
    if (!svg) return;
    
    // Clear existing edges (except temp path if any)
    Array.from(svg.querySelectorAll('.canvas-edge, .canvas-edge-label, .canvas-edge-hit-area')).forEach(el => {
        if (el.id !== 'temp-connection-path') el.remove();
    });
    
    CanvasState.edges.forEach(edge => {
        // 创建不可见的宽点击区域（用于扩大点击识别范围）
        const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hitArea.setAttribute('class', 'canvas-edge-hit-area');
        hitArea.dataset.edgeId = edge.id;
        hitArea.setAttribute('stroke', 'transparent');
        hitArea.setAttribute('stroke-width', '20'); // 更宽的点击区域
        hitArea.setAttribute('fill', 'none');
        hitArea.style.cursor = 'pointer';
        hitArea.style.pointerEvents = 'stroke';
        
        updateEdgePath(edge, hitArea);
        svg.appendChild(hitArea);
        
        // 创建可见的连接线路径
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'canvas-edge');
        path.dataset.edgeId = edge.id;
        path.style.pointerEvents = 'none'; // 可见路径不响应点击，由 hitArea 处理
        if (edge.id === CanvasState.selectedEdgeId) {
            path.classList.add('selected');
        }
        
        // 应用颜色
        const edgeColor = edge.colorHex || presetToHex(edge.color) || null;
        if (edgeColor) {
            path.setAttribute('stroke', edgeColor);
        }
        
        updateEdgePath(edge, path);
        svg.appendChild(path);
        
        // 点击事件绑定到不可见的宽区域
        hitArea.addEventListener('click', (e) => {
            console.log('[Edge] Edge clicked:', edge.id);
            e.stopPropagation();
            selectEdge(edge.id, e.clientX, e.clientY);
        });
        
        // 悬停效果也应用到 hitArea
        hitArea.addEventListener('mouseenter', () => {
            path.classList.add('hover');
        });
        hitArea.addEventListener('mouseleave', () => {
            path.classList.remove('hover');
        });
        
        // 渲染标签（如果有）
        if (edge.label && edge.label.trim()) {
            renderEdgeLabel(svg, edge);
        }
    });
    
    // 更新工具栏位置（如果工具栏正在显示）
    updateEdgeToolbarPosition();
}

function renderEdgeLabel(svg, edge) {
    const start = getAnchorPosition(edge.fromNode, edge.fromSide);
    const end = getAnchorPosition(edge.toNode, edge.toSide);
    
    if (!start || !end) return;
    
    // 计算标签位置（连接线中点）
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    
    // 创建标签文本元素
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('class', 'canvas-edge-label');
    text.setAttribute('x', midX);
    text.setAttribute('y', midY);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.textContent = edge.label;
    
    // 应用颜色
    const edgeColor = edge.colorHex || presetToHex(edge.color) || null;
    if (edgeColor) {
        text.setAttribute('fill', edgeColor);
    }
    
    svg.appendChild(text);
    
    // 标签点击事件
    text.addEventListener('click', (e) => {
        e.stopPropagation();
        selectEdge(edge.id, e.clientX, e.clientY);
    });
}

function updateEdgePath(edge, pathElement) {
    const start = getAnchorPosition(edge.fromNode, edge.fromSide);
    const end = getAnchorPosition(edge.toNode, edge.toSide);
    
    if (start && end) {
        const d = getEdgePathD(start.x, start.y, end.x, end.y, edge.fromSide, edge.toSide);
        pathElement.setAttribute('d', d);
    } else {
        pathElement.setAttribute('d', '');
    }
}

function getAnchorPosition(nodeId, side) {
    let el = document.getElementById(nodeId);
    // Special case mapping for permanent section
    if (nodeId === 'permanent-section') el = document.getElementById('permanentSection');
    
    if (!el) return null;
    
    // Must use style.left/top because they are in canvas-content coordinates
    const left = parseFloat(el.style.left) || 0;
    const top = parseFloat(el.style.top) || 0;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    
    switch (side) {
        case 'top': return { x: left + width / 2, y: top };
        case 'bottom': return { x: left + width / 2, y: top + height };
        case 'left': return { x: left, y: top + height / 2 };
        case 'right': return { x: left + width, y: top + height / 2 };
        default: return { x: left + width / 2, y: top + height / 2 };
    }
}

function getEdgePathD(x1, y1, x2, y2, side1, side2) {
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    const dist = Math.sqrt(dx * dx + dy * dy);
    // Dynamic smoothing based on distance, with min/max limits for better aesthetics
    const smooth = Math.min(400, Math.max(60, dist * 0.4));
    
    let cp1x = x1, cp1y = y1, cp2x = x2, cp2y = y2;
    
    switch (side1) {
        case 'top': cp1y -= smooth; break;
        case 'bottom': cp1y += smooth; break;
        case 'left': cp1x -= smooth; break;
        case 'right': cp1x += smooth; break;
    }
    
    if (side2) {
        switch (side2) {
            case 'top': cp2y -= smooth; break;
            case 'bottom': cp2y += smooth; break;
            case 'left': cp2x -= smooth; break;
            case 'right': cp2x += smooth; break;
        }
    } else {
        // For temp connection, keep end control point near the end point (mouse)
        // but maybe align it slightly with the start direction for a "seeking" feel
         switch (side1) {
            case 'top': case 'bottom': cp2x = x2; cp2y = y2; break;
            case 'left': case 'right': cp2x = x2; cp2y = y2; break;
        }
    }
    
    return `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
}

function setupCanvasConnectionInteractions() {
    document.addEventListener('mousemove', updateConnection);
    document.addEventListener('mouseup', endConnection);
    
    // Clear edge selection on canvas click
    const workspace = document.getElementById('canvasWorkspace');
    if (workspace) {
        workspace.addEventListener('click', (e) => {
            // If clicking on workspace background (not on a node or edge)
            if (e.target === workspace || e.target.classList.contains('canvas-content')) {
                clearEdgeSelection();
                clearMdSelection();
            }
        });
    }
}

function selectEdge(edgeId, clientX, clientY) {
    // 清除空白栏目的选择
    clearMdSelection();
    
    CanvasState.selectedEdgeId = edgeId;
    renderEdges(); // Re-render to show selection state
    showEdgeToolbar(edgeId, clientX, clientY);
}

function clearEdgeSelection() {
    if (CanvasState.selectedEdgeId) {
        CanvasState.selectedEdgeId = null;
        renderEdges();
        hideEdgeToolbar();
    }
}

function showEdgeToolbar(edgeId, x, y) {
    console.log('[Edge Toolbar] showEdgeToolbar called:', edgeId);
    const edge = CanvasState.edges.find(e => e.id === edgeId);
    if (!edge) {
        console.warn('[Edge Toolbar] Edge not found:', edgeId);
        return;
    }
    
    const canvasContent = document.getElementById('canvasContent');
    if (!canvasContent) {
        console.warn('[Edge Toolbar] canvasContent not found');
        return;
    }
    
    let toolbar = document.getElementById('edge-toolbar');
    if (!toolbar) {
        console.log('[Edge Toolbar] Creating new toolbar');
        toolbar = document.createElement('div');
        toolbar.id = 'edge-toolbar';
        toolbar.className = 'md-node-toolbar edge-toolbar'; // 添加专属类名
        toolbar.style.position = 'absolute'; // 使用 absolute 定位，吸附在 canvas-content 上
        toolbar.style.zIndex = '100';
        toolbar.style.display = 'flex'; // 确保显示
        toolbar.style.opacity = '1'; // 确保可见
        toolbar.style.pointerEvents = 'auto'; // 确保可交互
        canvasContent.appendChild(toolbar); // 添加到 canvas-content 中
        console.log('[Edge Toolbar] Toolbar created and appended');
    } else {
        console.log('[Edge Toolbar] Using existing toolbar');
        toolbar.style.display = 'flex';
        toolbar.style.opacity = '1';
        toolbar.style.pointerEvents = 'auto';
    }
    
    // 保存当前选中的连接线 ID
    toolbar.dataset.edgeId = edgeId;
    
    // Multi-language support
    const lang = typeof currentLang !== 'undefined' ? currentLang : 'zh';
    const deleteTitle = lang === 'en' ? 'Delete' : '删除';
    const colorTitle = lang === 'en' ? 'Color' : '颜色';
    const focusTitle = lang === 'en' ? 'Locate and zoom' : '定位并放大';
    const directionTitle = lang === 'en' ? 'Line direction' : '直线方向';
    const labelTitle = lang === 'en' ? 'Edit label' : '编辑文字';
    
    toolbar.innerHTML = `
        <button class="md-node-toolbar-btn" data-action="edge-delete" title="${deleteTitle}">
            <i class="far fa-trash-alt"></i>
        </button>
        <button class="md-node-toolbar-btn" data-action="edge-color-toggle" title="${colorTitle}">
            <i class="fas fa-palette"></i>
        </button>
        <button class="md-node-toolbar-btn" data-action="edge-focus" title="${focusTitle}">
            <i class="fas fa-search-plus"></i>
        </button>
        <button class="md-node-toolbar-btn" data-action="edge-direction" title="${directionTitle}">
            <i class="fas fa-arrows-alt-h"></i>
        </button>
        <button class="md-node-toolbar-btn" data-action="edge-label" title="${labelTitle}">
            <i class="far fa-edit"></i>
        </button>
    `;
    
    // 更新工具栏位置（基于连接线中点，使用 canvas-content 坐标系）
    updateEdgeToolbarPosition();
    
    // Attach event handlers (使用事件委托，只绑定一次)
    if (!toolbar.dataset.eventsBound) {
        toolbar.addEventListener('click', (e) => {
            const btn = e.target.closest('.md-node-toolbar-btn, .md-color-chip, .md-color-picker-btn');
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            
            const currentEdgeId = toolbar.dataset.edgeId;
            const currentEdge = CanvasState.edges.find(ed => ed.id === currentEdgeId);
            if (!currentEdge) return;
            
            const action = btn.getAttribute('data-action');
            
            if (action === 'edge-delete') {
                removeEdge(currentEdgeId);
                hideEdgeToolbar();
            } else if (action === 'edge-color-toggle') {
                // 复用空白栏目的色盘弹层逻辑
                toggleEdgeColorPopover(toolbar, currentEdge, btn);
            } else if (action === 'edge-focus') {
                // 复用空白栏目的定位逻辑
                locateAndZoomToEdge(currentEdgeId);
            } else if (action === 'edge-direction') {
                toggleEdgeDirection(currentEdgeId);
            } else if (action === 'edge-label') {
                editEdgeLabel(currentEdgeId);
            } else if (action === 'md-color-preset') {
                const preset = String(btn.getAttribute('data-color') || '').trim();
                setEdgeColor(currentEdge, preset);
                closeEdgeColorPopover(toolbar);
            }
        });
        toolbar.dataset.eventsBound = 'true';
    }
}

// 更新连接线工具栏位置（使用 canvas-content 坐标系）
function updateEdgeToolbarPosition() {
    const toolbar = document.getElementById('edge-toolbar');
    if (!toolbar || !toolbar.parentElement) return;
    
    const edgeId = toolbar.dataset.edgeId;
    if (!edgeId) return;
    
    const edge = CanvasState.edges.find(e => e.id === edgeId);
    if (!edge) return;
    
    const start = getAnchorPosition(edge.fromNode, edge.fromSide);
    const end = getAnchorPosition(edge.toNode, edge.toSide);
    
    if (!start || !end) return;
    
    // 计算连接线中点在 canvas-content 坐标系中的位置
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    
    // 工具栏显示在中点上方（使用 canvas-content 坐标系）
    toolbar.style.left = `${midX}px`;
    toolbar.style.top = `${midY - 40}px`;
    toolbar.style.transform = 'translateX(-50%)'; // 居中对齐
}

function hideEdgeToolbar() {
    const toolbar = document.getElementById('edge-toolbar');
    if (toolbar) {
        toolbar.style.display = 'none';
        toolbar.style.opacity = '0';
        toolbar.style.pointerEvents = 'none';
    }
}

// =============================================================================
// 连接线工具栏功能实现
// =============================================================================

// 色盘弹层逻辑（完全复用空白栏目的实现）
function ensureEdgeColorPopover(toolbar, edge) {
    let pop = toolbar.querySelector('.md-color-popover');
    if (pop) return pop;
    
    pop = document.createElement('div');
    pop.className = 'md-color-popover';
    
    // 多语言支持
    const lang = typeof currentLang !== 'undefined' ? currentLang : 'zh';
    const rgbPickerTitle = lang === 'en' ? 'RGB Color Picker' : 'RGB颜色选择器';
    const customColorTitle = lang === 'en' ? 'Select custom color' : '选择自定义颜色';
    
    // 使用 Obsidian Canvas 风格的颜色（与空白栏目完全一致）
    pop.innerHTML = `
        <span class="md-color-chip" data-action="md-color-preset" data-color="1" style="background:#ff6666"></span>
        <span class="md-color-chip" data-action="md-color-preset" data-color="2" style="background:#ffaa66"></span>
        <span class="md-color-chip" data-action="md-color-preset" data-color="3" style="background:#ffdd66"></span>
        <span class="md-color-chip" data-action="md-color-preset" data-color="4" style="background:#66dd99"></span>
        <span class="md-color-chip" data-action="md-color-preset" data-color="5" style="background:#66bbff"></span>
        <span class="md-color-chip" data-action="md-color-preset" data-color="6" style="background:#bb99ff"></span>
        <button class="md-color-chip md-color-picker-btn" data-action="md-color-picker-toggle" title="${rgbPickerTitle}">
            <svg viewBox="0 0 24 24" width="14" height="14">
                <circle cx="12" cy="12" r="10" fill="url(#rainbow-gradient-edge)" />
                <defs>
                    <linearGradient id="rainbow-gradient-edge" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#ff0000" />
                        <stop offset="16.67%" style="stop-color:#ff9900" />
                        <stop offset="33.33%" style="stop-color:#ffff00" />
                        <stop offset="50%" style="stop-color:#00ff00" />
                        <stop offset="66.67%" style="stop-color:#0099ff" />
                        <stop offset="83.33%" style="stop-color:#9900ff" />
                        <stop offset="100%" style="stop-color:#ff0099" />
                    </linearGradient>
                </defs>
            </svg>
        </button>
    `;
    
    // RGB选择器UI（显示在色盘上方，与空白栏目完全一致）
    const rgbPicker = document.createElement('div');
    rgbPicker.className = 'md-rgb-picker';
    rgbPicker.innerHTML = `
        <input class="md-color-input" type="color" value="${edge.colorHex || '#66bbff'}" title="${customColorTitle}" />
    `;
    pop.appendChild(rgbPicker);
    
    // 彩色圆盘按钮点击事件 - 切换RGB选择器显示
    const pickerBtn = pop.querySelector('.md-color-picker-btn');
    const colorInput = rgbPicker.querySelector('.md-color-input');
    
    pickerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = rgbPicker.classList.contains('open');
        if (isOpen) {
            rgbPicker.classList.remove('open');
        } else {
            rgbPicker.classList.add('open');
            // 延迟触发点击，确保UI已显示
            setTimeout(() => colorInput.click(), 50);
        }
    });
    
    // 自定义颜色变化
    colorInput.addEventListener('input', (ev) => {
        setEdgeColor(edge, ev.target.value);
    });
    
    colorInput.addEventListener('change', () => {
        rgbPicker.classList.remove('open');
    });
    
    toolbar.appendChild(pop);
    return pop;
}

function toggleEdgeColorPopover(toolbar, edge, anchorBtn) {
    const pop = ensureEdgeColorPopover(toolbar, edge);
    const isOpen = pop.classList.contains('open');
    if (isOpen) { 
        closeEdgeColorPopover(toolbar); 
        return; 
    }
    pop.classList.add('open');
    // 监听外部点击关闭
    const onDoc = (e) => {
        if (!toolbar.contains(e.target)) {
            closeEdgeColorPopover(toolbar);
            document.removeEventListener('mousedown', onDoc, true);
        }
    };
    document.addEventListener('mousedown', onDoc, true);
}

function closeEdgeColorPopover(toolbar) {
    const pop = toolbar.querySelector('.md-color-popover');
    if (pop) pop.classList.remove('open');
}

function setEdgeColor(edge, presetOrHex) {
    if (!edge) return;
    
    // 支持预设编号或十六进制颜色
    const isPreset = /^[1-6]$/.test(String(presetOrHex));
    if (isPreset) {
        edge.color = String(presetOrHex);
        edge.colorHex = presetToHex(edge.color);
    } else if (typeof presetOrHex === 'string' && presetOrHex.startsWith('#')) {
        edge.color = null;
        edge.colorHex = presetOrHex;
    }
    
    renderEdges();
    saveTempNodes();
}

// 定位并放大到连接线（复用空白栏目的定位逻辑）
function locateAndZoomToEdge(edgeId, targetZoom = 1.2) {
    const edge = CanvasState.edges.find(e => e.id === edgeId);
    const workspace = document.getElementById('canvasWorkspace');
    if (!edge || !workspace) return;
    
    const start = getAnchorPosition(edge.fromNode, edge.fromSide);
    const end = getAnchorPosition(edge.toNode, edge.toSide);
    if (!start || !end) return;
    
    // 先调整缩放（与空白栏目逻辑一致）
    const zoom = Math.max(0.1, Math.min(3, Math.max(CanvasState.zoom, targetZoom)));
    if (zoom !== CanvasState.zoom) {
        const rect = workspace.getBoundingClientRect();
        setCanvasZoom(zoom, rect.left + rect.width / 2, rect.top + rect.height / 2, { recomputeBounds: true });
    }
    
    // 计算连接线中心点
    const centerX = (start.x + end.x) / 2;
    const centerY = (start.y + end.y) / 2;
    
    // 平移到中心点（与空白栏目逻辑一致）
    const workspaceWidth = workspace.clientWidth;
    const workspaceHeight = workspace.clientHeight;
    CanvasState.panOffsetX = workspaceWidth / 2 - centerX * CanvasState.zoom;
    CanvasState.panOffsetY = workspaceHeight / 2 - centerY * CanvasState.zoom;
    
    updateCanvasScrollBounds();
    savePanOffsetThrottled();
}

// 切换连接线方向（交换起点和终点）
function toggleEdgeDirection(edgeId) {
    const edge = CanvasState.edges.find(e => e.id === edgeId);
    if (!edge) return;
    
    // 交换起点和终点
    const tempNode = edge.fromNode;
    const tempSide = edge.fromSide;
    edge.fromNode = edge.toNode;
    edge.fromSide = edge.toSide;
    edge.toNode = tempNode;
    edge.toSide = tempSide;
    
    renderEdges();
    saveTempNodes();
    
    console.log('[Canvas] 切换连接线方向:', edgeId);
}

// 编辑连接线标签
function editEdgeLabel(edgeId) {
    const edge = CanvasState.edges.find(e => e.id === edgeId);
    if (!edge) return;
    
    const lang = typeof currentLang !== 'undefined' ? currentLang : 'zh';
    const promptText = lang === 'en' ? 'Enter label for this connection:' : '输入连接线标签：';
    const newLabel = prompt(promptText, edge.label || '');
    
    if (newLabel !== null) {
        edge.label = newLabel;
        renderEdges();
        saveTempNodes();
        console.log('[Canvas] 更新连接线标签:', edgeId, newLabel);
    }
}

// =============================================================================
// 导出模块
// =============================================================================

window.CanvasModule = {
    init: initCanvasView,
    enhance: enhanceBookmarkTreeForCanvas, // 增强书签树的Canvas功能
    clear: clearAllTempNodes,
    updateFullscreenButton: updateFullscreenButtonState,
    CanvasState: CanvasState, // 导出状态供外部访问（如指针拖拽）
    createTempNode: createTempNode, // 导出创建临时节点函数
    createMdNode: createMdNode,
    temp: {
        getSection: getTempSection,
        findItem: findTempItemEntry,
        renameItem: renameTempItem,
        updateBookmark: updateTempBookmark,
        createBookmark: createTempBookmark,
        createFolder: createTempFolder,
        removeItems: removeTempItemsById,
        insertFromPayload: insertTempItemsFromPayload,
        extractPayload: extractTempItemsPayload,
        moveWithin: moveTempItemsWithinSection,
        moveAcross: moveTempItemsAcrossSections,
        ensureRendered: ensureTempSectionRendered,
        // 性能模式管理
        setPerformanceMode: setPerformanceMode,
        getPerformanceMode: () => CanvasState.performanceMode,
        getPerformanceSettings: () => CanvasState.performanceSettings
    }
};
