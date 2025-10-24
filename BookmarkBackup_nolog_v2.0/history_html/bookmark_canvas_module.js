// =============================================================================
// Bookmark Canvas Module - 基于原有Bookmark Tree改造的Canvas功能
// =============================================================================

// Canvas状态管理
const CanvasState = {
    tempSections: [],
    tempSectionCounter: 0,
    tempItemCounter: 0,
    colorCursor: 0,
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
    dropCleanupBound: false
};

let panSaveTimeout = null;
const CANVAS_SCROLL_MARGIN = 120;
let suppressScrollSync = false;
let zoomSaveTimeout = null;
let zoomUpdateFrame = null;
let pendingZoomRequest = null;
const scrollbarHoverState = new WeakMap();
const TEMP_SECTION_STORAGE_KEY = 'bookmark-canvas-temp-sections';
const LEGACY_TEMP_NODE_STORAGE_KEY = 'bookmark-canvas-temp-nodes';
const TEMP_SECTION_DEFAULT_WIDTH = 360;
const TEMP_SECTION_DEFAULT_HEIGHT = 280;
const TEMP_SECTION_DEFAULT_COLOR = '#2563eb';
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
    
    // 设置永久栏目提示关闭按钮
    setupPermanentSectionTipClose();
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
            const rect = workspace.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 100;
            const y = ((e.clientY - rect.top) / rect.height) * 100;
            workspace.style.setProperty('--drop-x', `${x}%`);
            workspace.style.setProperty('--drop-y', `${y}%`);
        }
    });
    workspace.addEventListener('drop', () => {
        workspace.classList.remove('canvas-drop-active');
    });
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
        });
        
        // 添加dragend监听器，检查是否拖到Canvas
        item.addEventListener('dragend', async function(e) {
            if (CanvasState.dragState.dragSource !== 'permanent') return;
            
            const dropX = e.clientX;
            const dropY = e.clientY;
            
            // 检查是否拖到Canvas工作区
            const workspace = document.getElementById('canvasWorkspace');
            if (!workspace) return;
            
            const rect = workspace.getBoundingClientRect();
            
            if (dropX >= rect.left && dropX <= rect.right && 
                dropY >= rect.top && dropY <= rect.bottom) {
                
                // 计算在canvas-content坐标系中的位置（考虑缩放和平移）
                const canvasX = (dropX - rect.left - CanvasState.panOffsetX) / CanvasState.zoom;
                const canvasY = (dropY - rect.top - CanvasState.panOffsetY) / CanvasState.zoom;
                
                console.log('[Canvas] 拖到Canvas，创建临时节点:', { canvasX, canvasY });
                
                // 在Canvas上创建临时节点
                if (CanvasState.dragState.draggedData) {
                    try {
                        await createTempNode(CanvasState.dragState.draggedData, canvasX, canvasY);
                    } catch (err) {
                        console.error('[Canvas] 创建临时栏目失败:', err);
                        alert('创建临时栏目失败: ' + err.message);
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

            scheduleClearTreeItemDragging();
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
    
    // Ctrl + 滚轮缩放（以鼠标位置为中心）
    workspace.addEventListener('wheel', (e) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            
            // 获取鼠标在viewport中的位置
            const rect = workspace.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            // 计算新的缩放级别
            const delta = -e.deltaY;
            const zoomSpeed = 0.001;
            const oldZoom = CanvasState.zoom;
            const newZoom = Math.max(0.1, Math.min(3, oldZoom + delta * zoomSpeed));
            scheduleZoomUpdate(newZoom, mouseX, mouseY, { recomputeBounds: false, skipSave: false });
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
        silent = false
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
    container.style.setProperty('--canvas-scale', zoom);
    
    // 调整平移偏移，使中心点保持在相同的视觉位置
    CanvasState.panOffsetX = centerX - canvasCenterX * zoom;
    CanvasState.panOffsetY = centerY - canvasCenterY * zoom;
    updateCanvasScrollBounds({ initial: false, recomputeBounds });
    savePanOffsetThrottled();
    
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
    const container = document.querySelector('.canvas-main-container');
    if (!container) return;
    
    CanvasState.panOffsetX = clampPan('horizontal', CanvasState.panOffsetX);
    CanvasState.panOffsetY = clampPan('vertical', CanvasState.panOffsetY);
    
    container.style.setProperty('--canvas-pan-x', `${CanvasState.panOffsetX}px`);
    container.style.setProperty('--canvas-pan-y', `${CanvasState.panOffsetY}px`);
    updateScrollbarThumbs();
    
    if (!CanvasState.scrollAnimation.frameId) {
        CanvasState.scrollAnimation.targetX = CanvasState.panOffsetX;
        CanvasState.scrollAnimation.targetY = CanvasState.panOffsetY;
    }
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
    const docLang = typeof document !== 'undefined' ? (document.documentElement.getAttribute('lang') || '').toLowerCase() : '';
    return docLang.startsWith('en') ? 'en' : 'zh_CN';
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
    let consumed = false;
    
    const horizontalEnabled = !CanvasState.scrollState.horizontal.disabled;
    const verticalEnabled = !CanvasState.scrollState.vertical.disabled;
    
    if (!horizontalEnabled && !verticalEnabled) {
        return;
    }
    
    let horizontalDelta = event.deltaX;
    let verticalDelta = event.deltaY;
    
    if (event.shiftKey && horizontalEnabled) {
        horizontalDelta = horizontalDelta !== 0 ? horizontalDelta : verticalDelta;
        verticalDelta = 0;
    }
    
    if (horizontalEnabled && Math.abs(horizontalDelta) > 0.01) {
        const targetX = CanvasState.panOffsetX - horizontalDelta * getScrollFactor('horizontal');
        schedulePanTo(targetX, null);
        consumed = true;
    }
    
    if (verticalEnabled && Math.abs(verticalDelta) > 0.01) {
        const targetY = CanvasState.panOffsetY - verticalDelta * getScrollFactor('vertical');
        schedulePanTo(null, targetY);
        consumed = true;
    }
    
    if (consumed) {
        event.preventDefault();
    }
}

function getScrollFactor(axis) {
    const zoom = Math.max(CanvasState.zoom || 1, 0.1);
    const base = axis === 'vertical' ? 1.0 : 1.25;
    const exponent = 0.55;
    return base / Math.pow(zoom, exponent);
}

function getScrollEaseFactor(axis) {
    const zoom = Math.max(CanvasState.zoom || 1, 0.1);
    const base = axis === 'horizontal' ? 0.28 : 0.26;
    const zoomBoost = zoom > 1
        ? Math.min(0.14, (zoom - 1) * 0.09)
        : (1 - zoom) * 0.06;
    return Math.min(0.45, base + zoomBoost);
}

function schedulePanTo(targetX, targetY) {
    if (typeof targetX === 'number') {
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
    
    applyPanOffset();
    
    if (continueAnimation) {
        CanvasState.scrollAnimation.frameId = requestAnimationFrame(runScrollAnimation);
    } else {
        CanvasState.scrollAnimation.frameId = null;
        CanvasState.scrollAnimation.targetX = CanvasState.panOffsetX;
        CanvasState.scrollAnimation.targetY = CanvasState.panOffsetY;
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
    
    const minPanX = workspaceWidth - CANVAS_SCROLL_MARGIN - bounds.maxX * zoom;
    const maxPanX = CANVAS_SCROLL_MARGIN - bounds.minX * zoom;
    const minPanY = workspaceHeight - CANVAS_SCROLL_MARGIN - bounds.maxY * zoom;
    const maxPanY = CANVAS_SCROLL_MARGIN - bounds.minY * zoom;
    
    CanvasState.scrollBounds.horizontal = normalizeScrollBounds(minPanX, maxPanX, workspaceWidth);
    CanvasState.scrollBounds.vertical = normalizeScrollBounds(minPanY, maxPanY, workspaceHeight);
    
    CanvasState.panOffsetX = clampPan('horizontal', CanvasState.panOffsetX);
    CanvasState.panOffsetY = clampPan('vertical', CanvasState.panOffsetY);
    
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
                const contentSpan = Math.max(1, (CanvasState.contentBounds.maxY - CanvasState.contentBounds.minY) * CanvasState.zoom);
                const visibleRatio = Math.min(1, workspace.clientHeight / (contentSpan + CANVAS_SCROLL_MARGIN));
                const thumbSize = Math.max(32, trackSize * visibleRatio);
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
                const contentSpan = Math.max(1, (CanvasState.contentBounds.maxX - CanvasState.contentBounds.minX) * CanvasState.zoom);
                const visibleRatio = Math.min(1, workspace.clientWidth / (contentSpan + CANVAS_SCROLL_MARGIN));
                const thumbSize = Math.max(32, trackSize * visibleRatio);
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
    
    const onMouseDown = (e) => {
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
        
        // 直接更新位置，不使用requestAnimationFrame提高响应速度
        permanentSection.style.left = newX + 'px';
        permanentSection.style.top = newY + 'px';
        
        // 阻止文本选择
        e.preventDefault();
    };
    
    const onMouseUp = () => {
        if (isDragging) {
            isDragging = false;
            permanentSection.classList.remove('dragging');
            
            if (hasMoved) {
                // 保存位置
                savePermanentSectionPosition();
                updateCanvasScrollBounds();
                updateScrollbarThumbs();
            }
            
            hasMoved = false;
        }
    };
    
    // 使用捕获阶段确保事件优先处理，mousemove用冒泡阶段提高性能
    header.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mousemove', onMouseMove, false);
    document.addEventListener('mouseup', onMouseUp, true);
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
    
    // 创建拖拽预览
    const preview = document.createElement('div');
    preview.className = 'drag-preview';
    preview.textContent = data.title || '未命名';
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
        
        // 在Canvas上创建临时节点
        const x = dropX - rect.left + workspace.scrollLeft;
        const y = dropY - rect.top + workspace.scrollTop;
        try {
            await createTempNode(CanvasState.dragState.draggedData, x, y);
        } catch (error) {
            console.error('[Canvas] 创建临时栏目失败:', error);
            alert('创建临时栏目失败: ' + error.message);
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
    const section = {
        id: sectionId,
        title: getDefaultTempSectionTitle(),
        color: pickTempSectionColor(),
        x,
        y,
        width: TEMP_SECTION_DEFAULT_WIDTH,
        height: TEMP_SECTION_DEFAULT_HEIGHT,
        createdAt: Date.now(),
        items: []
    };
    
    try {
        let resolvedNode = null;
        try {
            resolvedNode = await resolveBookmarkNode(data);
        } catch (error) {
            console.warn('[Canvas] 实时获取书签数据失败，使用一次性快照:', error);
            resolvedNode = cloneBookmarkNode(data);
        }
        if (resolvedNode) {
            const tempRoot = convertBookmarkNodeToTempItem(resolvedNode, sectionId);
            if (tempRoot) {
                section.items.push(tempRoot);
            }
        }
    } catch (error) {
        console.error('[Canvas] 转换拖拽节点失败:', error);
    }
    
    CanvasState.tempSections.push(section);
    renderTempNode(section);
    saveTempNodes();
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
    
    if (!nodeElement) {
        nodeElement = document.createElement('div');
        nodeElement.className = 'temp-canvas-node';
        nodeElement.id = section.id;
        nodeElement.dataset.sectionId = section.id;
        container.appendChild(nodeElement);
    } else {
        nodeElement.innerHTML = '';
    }
    
    nodeElement.style.transition = 'none';
    nodeElement.style.left = section.x + 'px';
    nodeElement.style.top = section.y + 'px';
    nodeElement.style.width = (section.width || TEMP_SECTION_DEFAULT_WIDTH) + 'px';
    nodeElement.style.height = (section.height || TEMP_SECTION_DEFAULT_HEIGHT) + 'px';
    nodeElement.style.setProperty('--section-color', section.color || TEMP_SECTION_DEFAULT_COLOR);
    
    const header = document.createElement('div');
    header.className = 'temp-node-header';
    header.dataset.sectionId = section.id;
    header.style.setProperty('--section-color', section.color || TEMP_SECTION_DEFAULT_COLOR);
    
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'temp-node-title temp-node-title-input';
    titleInput.value = section.title || getDefaultTempSectionTitle();
    titleInput.placeholder = '临时栏目';
    titleInput.readOnly = true;
    titleInput.setAttribute('readonly', 'readonly');
    titleInput.tabIndex = -1;
    titleInput.dataset.sectionId = section.id;
    
    const actions = document.createElement('div');
    actions.className = 'temp-node-actions';
    
    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'temp-node-action-btn temp-node-rename-btn';
    const renameLabel = (typeof currentLang !== 'undefined' && currentLang === 'en') ? 'Rename section' : '重命名栏目';
    renameBtn.title = renameLabel;
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
    colorBtn.innerHTML = '<i class="fas fa-palette"></i>';
    colorBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        colorInput.click();
    });
    
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

    const closeBtn = document.createElement('button');
    closeBtn.className = 'temp-node-action-btn temp-node-delete-btn temp-node-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = (typeof currentLang !== 'undefined' && currentLang === 'en') ? 'Remove section' : '删除临时栏目';
    closeBtn.addEventListener('click', () => removeTempNode(section.id));

    actions.appendChild(renameBtn);
    actions.appendChild(colorBtn);
    actions.appendChild(colorInput);
    actions.appendChild(closeBtn);
    
    header.appendChild(titleInput);
    header.appendChild(actions);
    
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
    nodeElement.appendChild(body);
    
    applyTempSectionColor(section, nodeElement, header, colorBtn, colorInput);
    makeNodeDraggable(nodeElement, section);
    makeTempNodeResizable(nodeElement, section);
    setupTempSectionTreeInteractions(treeContainer, section);
    setupTempSectionDropTargets(section, nodeElement, treeContainer, header);
    if (typeof attachTreeEvents === 'function') {
        attachTreeEvents(treeContainer);
    }
    if (typeof attachDragEvents === 'function') {
        attachDragEvents(treeContainer);
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
}

function applyTempSectionColor(section, nodeElement, header, colorButton, colorInput) {
    const color = section.color || TEMP_SECTION_DEFAULT_COLOR;
    if (nodeElement) {
        nodeElement.style.setProperty('--section-color', color);
    }
    if (header) {
        header.style.setProperty('--section-color', color);
    }
    if (colorButton) {
        colorButton.style.background = color;
        colorButton.style.borderColor = color;
        colorButton.style.color = '#ffffff';
        colorButton.style.boxShadow = '0 0 0 2px rgba(255, 255, 255, 0.35)';
    }
    if (colorInput) {
        colorInput.value = color;
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

    const targets = [treeContainer, header];
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
            clearTreeItemDragging();
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
    
    const onMouseDown = (e) => {
        const target = e.target;
        if (!target) return;
        if (target.closest('.temp-node-action-btn') ||
            target.classList.contains('temp-node-color-input') ||
            (target.classList.contains('temp-node-title') && target.classList.contains('editing'))) {
            return;
        }
        
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

function removeTempNode(sectionId) {
    const element = document.getElementById(sectionId);
    if (element) {
        element.remove();
    }
    
    CanvasState.tempSections = CanvasState.tempSections.filter(section => section.id !== sectionId);
    saveTempNodes();
    updateCanvasScrollBounds();
    updateScrollbarThumbs();
}

function clearAllTempNodes() {
    if (!confirm('确定要清空所有临时栏目吗？')) return;
    
    const container = document.getElementById('canvasContent');
    if (container) {
        container.querySelectorAll('.temp-canvas-node').forEach(node => node.remove());
    }
    
    CanvasState.tempSections = [];
    saveTempNodes();
    updateCanvasScrollBounds();
    updateScrollbarThumbs();
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
    const tipContainer = document.getElementById('permanentSectionTipContainer');
    
    if (!closeBtn || !tipContainer) {
        console.warn('[Canvas] 找不到提示关闭按钮或容器');
        return;
    }
    
    // 检查是否已经关闭过
    const isTipClosed = localStorage.getItem('canvas-permanent-tip-closed') === 'true';
    if (isTipClosed) {
        tipContainer.style.display = 'none';
    }
    
    // 点击关闭按钮
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        
        tipContainer.style.display = 'none';
        localStorage.setItem('canvas-permanent-tip-closed', 'true');
        console.log('[Canvas] 永久栏目提示已关闭');
    });
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
            await renderPermanentBookmarkTree();
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
    // 鼠标移动 - 拖动节点
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
            
            // 直接更新DOM，提高响应速度
            CanvasState.dragState.draggedElement.style.left = newX + 'px';
            CanvasState.dragState.draggedElement.style.top = newY + 'px';
            
            // 更新节点数据
            const nodeId = CanvasState.dragState.draggedElement.id;
            const section = CanvasState.tempSections.find(n => n.id === nodeId);
            if (section) {
                section.x = newX;
                section.y = newY;
            }
            
            // 阻止文本选择
            e.preventDefault();
        }
    }, false);
    
    // 鼠标释放
    document.addEventListener('mouseup', () => {
        if (CanvasState.dragState.isDragging && CanvasState.dragState.draggedElement) {
            CanvasState.dragState.draggedElement.classList.remove('dragging');
            CanvasState.dragState.isDragging = false;
            CanvasState.dragState.draggedElement = null;
            saveTempNodes();
            updateCanvasScrollBounds();
            updateScrollbarThumbs();
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
    
    // 添加临时节点
    CanvasState.tempSections.forEach(section => {
        const textNode = {
            id: `${section.id}-text`,
            type: 'text',
            x: section.x,
            y: section.y,
            width: section.width || TEMP_SECTION_DEFAULT_WIDTH,
            height: section.height || TEMP_SECTION_DEFAULT_HEIGHT,
            text: formatSectionText(section),
            color: section.color
        };
        canvasData.nodes.push(textNode);
    });
    
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
        
        let loaded = false;
        const saved = localStorage.getItem(TEMP_SECTION_STORAGE_KEY);
        if (saved) {
            const state = JSON.parse(saved);
            CanvasState.tempSections = Array.isArray(state.sections) ? state.sections : [];
            CanvasState.tempSectionCounter = state.tempSectionCounter || CanvasState.tempSections.length;
            CanvasState.tempItemCounter = state.tempItemCounter || 0;
            CanvasState.colorCursor = state.colorCursor || 0;
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
        
        suppressScrollSync = true;
        try {
            CanvasState.tempSections.forEach(section => {
                section.width = section.width || TEMP_SECTION_DEFAULT_WIDTH;
                section.height = section.height || TEMP_SECTION_DEFAULT_HEIGHT;
                renderTempNode(section);
            });
        } finally {
            suppressScrollSync = false;
        }
        console.log(`[Canvas] 加载了 ${CanvasState.tempSections.length} 个临时栏目`);
        
        loadPermanentSectionPosition();
        updateCanvasScrollBounds();
        updateScrollbarThumbs();
    } catch (error) {
        console.error('[Canvas] 加载临时栏目失败:', error);
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
        ensureRendered: ensureTempSectionRendered
    }
};
