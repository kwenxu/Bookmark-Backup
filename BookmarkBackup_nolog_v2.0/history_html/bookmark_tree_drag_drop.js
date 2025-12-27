// 书签树拖拽功能
// 支持拖拽移动书签和文件夹

// 全局变量
let draggedNode = null;
let draggedNodeId = null;
let draggedNodeParent = null;
let draggedNodePrev = null;  // 被拖动节点的前一个同级节点
let draggedNodeNext = null;  // 被拖动节点的后一个同级节点
let dropIndicator = null;
let autoScrollInterval = null;
let lastScrollTime = 0;
let hoverExpandTimer = null;
// 记录文件夹被悬停展开的次数和定时器，加快二次与后续展开
var __hoverExpandState = (typeof window !== 'undefined' && window.__hoverExpandState)
    ? window.__hoverExpandState
    : { timers: new Map(), counts: new Map(), lastAt: new Map(), session: 0, lastDragEndTime: 0 };
if (typeof window !== 'undefined') window.__hoverExpandState = __hoverExpandState;

// 长时间不拖动后重置的阈值（毫秒）
var HOVER_EXPAND_RESET_THRESHOLD = 5000; // 5秒不拖动则重置

function getHoverDelayForFolder(folderId) {
    // 检查是否距离上次拖动结束已经过了很长时间，如果是则重置计数
    const now = Date.now();
    if (__hoverExpandState.lastDragEndTime > 0 &&
        (now - __hoverExpandState.lastDragEndTime) > HOVER_EXPAND_RESET_THRESHOLD) {
        // 距离上次拖动结束超过阈值，重置所有计数
        __hoverExpandState.counts.clear();
        __hoverExpandState.lastDragEndTime = 0;
    }

    // 延迟逻辑：首次 2000ms，后续统一 1200ms
    const count = __hoverExpandState.counts.get(folderId) || 0;
    if (count >= 1) return 1200;
    return 2000;
}

function scheduleFolderExpand(targetNode) {
    if (!targetNode || targetNode.dataset.nodeType !== 'folder') return;
    const folderId = targetNode.dataset.nodeId;
    // 若已有定时器，仅重置定时而不增加识别计数（避免连续 dragover 快速累加）
    const hadTimer = __hoverExpandState.timers.has(folderId);
    // 若已有定时器，保持不变，避免把“首次 3 秒”意外缩短为更快延迟
    if (hadTimer) return;

    const delay = getHoverDelayForFolder(folderId);

    // 在“安排定时器”的时刻记录一次识别，使得：
    // - 第一次安排 → 使用 2500ms，同时计数从 0→1；
    // - 第二次（离开后再次悬停并安排）→ 使用 400ms，计数 1→2；
    // - 后续 → 使用 200ms；
    const prev = __hoverExpandState.counts.get(folderId) || 0;
    __hoverExpandState.counts.set(folderId, Math.min(prev + 1, 2));
    __hoverExpandState.lastAt.set(folderId, Date.now());

    const sessionAtSchedule = __hoverExpandState.session;
    const timer = setTimeout(() => {
        try {
            if (__hoverExpandState.session !== sessionAtSchedule) return; // 仅限当前拖动会话

            const treeNode = targetNode.closest('.tree-node');
            const children = treeNode ? treeNode.querySelector(':scope > .tree-children') : targetNode.nextElementSibling;
            const toggle = targetNode.querySelector('.tree-toggle');
            const icon = targetNode.querySelector('.tree-icon.fas');

            if (children && children.classList.contains('tree-children') && !children.classList.contains('expanded')) {
                children.classList.add('expanded');
                if (toggle) toggle.classList.add('expanded');

                // 更新文件夹图标
                if (icon) {
                    icon.classList.remove('fa-folder');
                    icon.classList.add('fa-folder-open');
                }

                // 【关键修复】触发懒加载：检查子节点是否需要加载
                const treeType = targetNode.dataset.treeType;
                const sectionId = targetNode.dataset.sectionId;
                const childrenLoaded = targetNode.dataset.childrenLoaded;
                const hasChildren = targetNode.dataset.hasChildren;
                const nodeId = targetNode.dataset.nodeId;

                if (childrenLoaded === 'false' && hasChildren === 'true') {
                    if (treeType === 'temporary' && sectionId) {
                        // 临时栏目：调用 Canvas 模块的懒加载函数
                        try {
                            const loadFolderChildren = window.CanvasModule?.loadFolderChildren;
                            const getTempSection = window.CanvasModule?.getTempSection;
                            if (loadFolderChildren && getTempSection) {
                                const section = getTempSection(sectionId);
                                if (section) {
                                    loadFolderChildren(section, nodeId, children);
                                }
                            }
                        } catch (loadErr) {
                            console.warn('[拖拽展开] 临时栏目懒加载失败:', loadErr);
                        }
                    } else if (treeType === 'permanent' || !treeType) {
                        // 永久栏目：调用 history.js 的懒加载函数
                        try {
                            if (typeof loadPermanentFolderChildrenLazy === 'function') {
                                loadPermanentFolderChildrenLazy(nodeId, children, 0, null);
                            }
                        } catch (loadErr) {
                            console.warn('[拖拽展开] 永久栏目懒加载失败:', loadErr);
                        }
                    }
                }

                // 【新增】保存展开状态
                try {
                    if (treeType === 'temporary' && sectionId) {
                        // 临时栏目：更新 LAZY_LOAD_THRESHOLD 并保存
                        const folderId = `${sectionId}-${nodeId}`;
                        if (window.CanvasModule?.clearLazyLoadState) {
                            // 使用 Canvas 模块的内部状态管理
                            // LAZY_LOAD_THRESHOLD 是内部变量，通过间接方式更新
                        }
                        // 调用 saveTempExpandState（如果存在）
                        if (typeof saveTempExpandState === 'function') {
                            saveTempExpandState();
                        }
                    } else {
                        // 永久栏目：调用 saveTreeExpandState
                        const treeContainer = targetNode.closest('.bookmark-tree');
                        if (treeContainer && typeof saveTreeExpandState === 'function') {
                            saveTreeExpandState(treeContainer);
                        }
                    }
                } catch (_) { }
            }
        } catch (_) { }
    }, delay);
    __hoverExpandState.timers.set(folderId, timer);
}
let draggedNodeTreeType = 'permanent';
let draggedNodeSectionId = null;

function getTempManager() {
    return (window.CanvasModule && window.CanvasModule.temp) ? window.CanvasModule.temp : null;
}

function serializeBookmarkNode(node) {
    if (!node) return null;
    return {
        title: node.title,
        url: node.url || '',
        type: node.url ? 'bookmark' : 'folder',
        children: (node.children || []).map(child => serializeBookmarkNode(child))
    };
}

// 初始化拖拽功能
function initDragDrop() {
    // 创建拖拽指示器
    dropIndicator = document.createElement('div');
    dropIndicator.className = 'drop-indicator';
    dropIndicator.style.display = 'none';
    document.body.appendChild(dropIndicator);

    console.log('[拖拽] 初始化完成');
}

// 为树节点绑定拖拽事件
function attachDragEvents(treeContainer) {
    if (!treeContainer) return;

    // 获取所有可拖拽的节点
    const draggableNodes = treeContainer.querySelectorAll('.tree-item[data-node-id]');

    draggableNodes.forEach(node => {
        // 避免重复绑定：renderTreeView/懒加载可能多次调用 attachDragEvents
        if (node.dataset.dragEventsBound === 'true') return;
        node.dataset.dragEventsBound = 'true';

        // 设置可拖拽
        node.setAttribute('draggable', 'true');

        // 拖拽开始
        node.addEventListener('dragstart', handleDragStart);

        // 拖拽经过
        node.addEventListener('dragover', handleDragOver);

        // 拖拽进入
        node.addEventListener('dragenter', handleDragEnter);

        // 拖拽离开
        node.addEventListener('dragleave', handleDragLeave);

        // 放下
        node.addEventListener('drop', handleDrop);

        // 拖拽结束
        node.addEventListener('dragend', handleDragEnd);
    });

    console.log('[拖拽] 绑定拖拽事件:', draggableNodes.length, '个节点');

    // 额外：在滚动容器层面也监听 dragover，用于容器空白区域的自动滚动
    try {
        const scrollContainer = treeContainer.closest('.permanent-section-body') || treeContainer.closest('.temp-node-body');
        if (scrollContainer && !scrollContainer.__autoScrollHooked) {
            scrollContainer.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                updateAutoScroll(e);
            });
            scrollContainer.__autoScrollHooked = true;
            console.log('[拖拽] 已在滚动容器绑定 dragover 自动滚动监听');
        }
    } catch (_) { }
}

// 拖拽开始
function handleDragStart(e) {
    draggedNode = e.currentTarget;
    draggedNodeId = draggedNode?.dataset?.nodeId;
    draggedNodeTreeType = draggedNode?.dataset?.treeType || 'permanent';
    draggedNodeSectionId = draggedNode?.dataset?.sectionId || null;

    // 获取被拖动节点的父级（tree-node 容器）
    draggedNodeParent = draggedNode.parentElement;

    // 获取同级节点中相邻的上下节点
    // tree-item 的上一个兄弟是 tree-children 或另一个 tree-node
    // 需要找到前一个 tree-item 和后一个 tree-item
    let prevSibling = draggedNodeParent?.previousElementSibling;
    let nextSibling = draggedNodeParent?.nextElementSibling;

    // 如果前一个是 tree-children，继续往前找
    while (prevSibling && prevSibling.classList.contains('tree-children')) {
        prevSibling = prevSibling.previousElementSibling;
    }

    // 如果后一个是 tree-children，继续往后找
    while (nextSibling && nextSibling.classList.contains('tree-children')) {
        nextSibling = nextSibling.nextElementSibling;
    }

    // 找到前一个节点的 tree-item
    draggedNodePrev = prevSibling?.querySelector('.tree-item') || null;

    // 后一个节点的 tree-item 就是 nextSibling（如果存在的话）
    draggedNodeNext = nextSibling?.classList.contains('tree-node') ?
        nextSibling.querySelector('.tree-item') : null;

    // 设置拖拽数据
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedNodeId);

    // 添加拖拽样式
    draggedNode.classList.add('dragging');

    console.log('[拖拽] ===== 开始拖拽 =====');
    console.log('[拖拽] 被拖动节点ID:', draggedNodeId);
    console.log('[拖拽] 被拖动节点标题:', draggedNode?.dataset?.nodeTitle);
    console.log('[拖拽] 上一个同级节点ID:', draggedNodePrev?.dataset?.nodeId);
    console.log('[拖拽] 下一个同级节点ID:', draggedNodeNext?.dataset?.nodeId);

    // 启动自动滚动检测
    startAutoScroll();

    // 重置悬停展开的加速状态，仅对“当前一次拖动”生效
    try {
        if (__hoverExpandState) {
            __hoverExpandState.session = (__hoverExpandState.session || 0) + 1;
            // 彻底清理上一拖动残留
            __hoverExpandState.timers.forEach((t) => clearTimeout(t));
            __hoverExpandState.timers.clear();
            __hoverExpandState.counts.clear();
            __hoverExpandState.lastAt.clear();
        }
    } catch (_) { }
}

// 拖拽经过
function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();

    const targetNode = e.currentTarget;
    const targetNodeId = targetNode?.dataset?.nodeId;

    e.dataTransfer.dropEffect = 'move';

    // 显示拖拽指示器（包含屏蔽逻辑）
    showDropIndicator(targetNode, e);

    // 持续悬停也触发展开（不依赖仅一次的 dragenter）
    if (targetNode.dataset.nodeType === 'folder') {
        scheduleFolderExpand(targetNode);
    }

    // 当来源为临时栏目时，对永久栏目的文件夹增加蓝色候选高亮
    try {
        // 无论来源（永久/临时/指针），只要目标是文件夹都蓝色候选高亮
        if (targetNode.dataset.nodeType === 'folder') {
            targetNode.classList.add('temp-tree-drop-highlight');
        }
    } catch (_) { }

    // 更新自动滚动
    updateAutoScroll(e);
}

// 拖拽进入
function handleDragEnter(e) {
    e.preventDefault();
    e.stopPropagation();

    const targetNode = e.currentTarget;
    if (targetNode !== draggedNode && !isDescendant(targetNode, draggedNode)) {
        targetNode.classList.add('drag-over');
    }

    // 当来源为临时栏目时，对永久栏目的文件夹增加蓝色候选高亮
    try {
        if (targetNode.dataset.nodeType === 'folder') {
            targetNode.classList.add('temp-tree-drop-highlight');
        }
    } catch (_) { }

    // 悬停自动展开文件夹（带二次与后续加速）
    try { clearTimeout(hoverExpandTimer); } catch (_) { }
    scheduleFolderExpand(targetNode);
}

// 拖拽离开
function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();

    const targetNode = e.currentTarget;
    targetNode.classList.remove('drag-over');
    targetNode.classList.remove('temp-tree-drop-highlight');
    try { clearTimeout(hoverExpandTimer); } catch (_) { }
    if (targetNode && targetNode.dataset && targetNode.dataset.nodeId) {
        const t = __hoverExpandState.timers.get(targetNode.dataset.nodeId);
        if (t) { clearTimeout(t); __hoverExpandState.timers.delete(targetNode.dataset.nodeId); }
    }
}

// 放下
async function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();

    const targetNode = e.currentTarget;
    targetNode.classList.remove('drag-over');
    targetNode.classList.remove('temp-tree-drop-highlight');

    const targetNodeId = targetNode.dataset.nodeId;
    const targetIsFolder = targetNode.dataset.nodeType === 'folder';
    const position = dropIndicator ? dropIndicator.dataset.position : null;

    // 隐藏拖拽指示器
    hideDropIndicator();

    const targetTreeType = targetNode.dataset.treeType || 'permanent';
    const targetSectionId = targetNode.dataset.sectionId || null;
    await moveBookmark(draggedNodeId, targetNodeId, targetIsFolder, {
        sourceTreeType: draggedNodeTreeType,
        sourceSectionId: draggedNodeSectionId,
        targetTreeType,
        targetSectionId,
        position,
        event: e
    });
}

// 拖拽结束
function handleDragEnd(e) {
    // 移除拖拽样式
    if (draggedNode) {
        draggedNode.classList.remove('dragging');
    }

    // 移除所有drag-over样式
    document.querySelectorAll('.drag-over').forEach(node => {
        node.classList.remove('drag-over');
    });
    // 清理跨栏目的候选高亮
    document.querySelectorAll('.temp-tree-drop-highlight').forEach(node => {
        node.classList.remove('temp-tree-drop-highlight');
    });

    // 隐藏拖拽指示器
    hideDropIndicator();

    // 停止自动滚动
    stopAutoScroll();

    draggedNode = null;
    draggedNodeId = null;
    draggedNodeParent = null;
    draggedNodePrev = null;
    draggedNodeNext = null;
    draggedNodeTreeType = 'permanent';
    draggedNodeSectionId = null;
    if (typeof clearTreeItemDragging === 'function') {
        clearTreeItemDragging();
    }
    // 清理所有悬停展开计时器
    try {
        __hoverExpandState.session = (__hoverExpandState.session || 0) + 1;
        __hoverExpandState.timers.forEach((t) => clearTimeout(t));
        __hoverExpandState.timers.clear();
        // 记录拖动结束时间，用于判断是否需要重置延迟
        // 不立即清除计数，让后续拖动可以继续使用1.2秒的快速延迟
        __hoverExpandState.lastDragEndTime = Date.now();
        __hoverExpandState.lastAt.clear();
    } catch (_) { }

    console.log('[拖拽] 拖拽结束');
}

// 显示拖拽指示器
function showDropIndicator(targetNode, e) {
    if (!dropIndicator) return;

    const rect = targetNode.getBoundingClientRect();
    const mouseY = e.clientY;
    const targetIsFolder = targetNode?.dataset?.nodeType === 'folder';

    // 检查是否是当前层级的第一个节点
    const treeNode = targetNode.closest('.tree-node');
    const isFirstInLevel = treeNode && !treeNode.previousElementSibling;

    // 检查文件夹是否展开
    let isFolderExpanded = false;
    if (targetIsFolder && treeNode) {
        const childrenContainer = treeNode.querySelector(':scope > .tree-children');
        isFolderExpanded = childrenContainer && childrenContainer.classList.contains('expanded');
    }

    let position;

    if (targetIsFolder) {
        if (isFolderExpanded) {
            // 展开的文件夹：上半部分 = before（如果是首位）或 inside，下半部分也是 inside（没有 after）
            if (isFirstInLevel && mouseY < rect.top + rect.height / 3) {
                position = 'before';
            } else {
                position = 'inside';
            }
        } else {
            // 未展开的文件夹：首位有 before，上半部分 = inside，下半部分 = after
            if (isFirstInLevel && mouseY < rect.top + rect.height / 4) {
                position = 'before';
            } else if (mouseY < rect.top + rect.height / 2) {
                position = 'inside';
            } else {
                position = 'after';
            }
        }
    } else {
        // 书签：首位有 before，否则只有 after
        if (isFirstInLevel && mouseY < rect.top + rect.height / 2) {
            position = 'before';
        } else {
            position = 'after';
        }
    }

    // 设置指示器位置
    if (position === 'before') {
        dropIndicator.style.top = (rect.top + window.scrollY) + 'px';
        dropIndicator.style.left = rect.left + 'px';
        dropIndicator.style.width = rect.width + 'px';
        dropIndicator.style.height = '2px';
        dropIndicator.style.display = 'block';
    } else if (position === 'after') {
        dropIndicator.style.top = (rect.bottom + window.scrollY) + 'px';
        dropIndicator.style.left = rect.left + 'px';
        dropIndicator.style.width = rect.width + 'px';
        dropIndicator.style.height = '2px';
        dropIndicator.style.display = 'block';
    } else {
        // inside - 隐藏线条（文件夹高亮显示）
        dropIndicator.style.display = 'none';
    }

    dropIndicator.dataset.position = position;
}

// 隐藏拖拽指示器
function hideDropIndicator() {
    if (dropIndicator) {
        dropIndicator.style.display = 'none';
    }
}

// 检查是否是后代节点
function isDescendant(potentialDescendant, ancestor) {
    let node = potentialDescendant.parentElement;
    while (node) {
        if (node === ancestor) return true;
        node = node.parentElement;
    }
    return false;
}

async function computePermanentInsertion(targetId, targetIsFolder, position) {
    position = position || 'inside';
    if (!chrome || !chrome.bookmarks) {
        return { parentId: targetId, index: null };
    }
    if (position === 'inside' && targetIsFolder) {
        return { parentId: targetId, index: null };
    }
    try {
        const [targetNode] = await chrome.bookmarks.get(targetId);
        if (!targetNode) {
            return { parentId: targetId, index: null };
        }
        const parentId = targetNode.parentId;
        const targetIndex = typeof targetNode.index === 'number' ? targetNode.index : null;
        const index = targetIndex === null ? null : (position === 'before' ? targetIndex : targetIndex + 1);
        return { parentId, index };
    } catch (error) {
        console.warn('[拖拽] 计算插入位置失败:', error);
        return { parentId: targetId, index: null };
    }
}

function computeTempInsertion(sectionId, targetId, position) {
    position = position || 'inside';
    const manager = getTempManager();
    if (!manager) {
        return { parentId: null, index: null };
    }
    const entry = manager.findItem(sectionId, targetId);
    if (!entry || !entry.item) {
        return { parentId: null, index: null };
    }
    if (position === 'inside' && entry.item.type === 'folder') {
        const children = entry.item.children || [];
        return { parentId: entry.item.id, index: children.length };
    }
    const parentId = entry.parent ? entry.parent.id : null;
    const index = position === 'before' ? entry.index : entry.index + 1;
    return { parentId, index };
}

async function createBookmarkFromPayload(parentId, index, payload) {
    if (!chrome || !chrome.bookmarks || !payload) return;
    const createInfo = {
        parentId: parentId,
        title: payload.title || ''
    };
    if (payload.url) {
        createInfo.url = payload.url;
    }
    if (typeof index === 'number') {
        createInfo.index = index;
    }
    const created = await chrome.bookmarks.create(createInfo);
    if (payload.children && payload.children.length) {
        for (const child of payload.children) {
            await createBookmarkFromPayload(created.id, null, child);
        }
    }
}

// 用于标记由拖拽操作触发的移动，防止 applyIncrementalMoveToTree 重复处理
if (typeof window !== 'undefined') {
    window.__dragMoveHandled = window.__dragMoveHandled || new Set();
}

async function moveBookmark(sourceId, targetId, targetIsFolder, context) {
    const { sourceTreeType = 'permanent', sourceSectionId = null, targetTreeType = 'permanent', targetSectionId = null, position = 'inside' } = context || {};
    const manager = getTempManager();
    try {
        if (sourceTreeType === 'temporary' && targetTreeType === 'temporary' && manager) {
            const targetInfo = computeTempInsertion(targetSectionId || sourceSectionId, targetId, position);
            if (sourceSectionId === targetSectionId) {
                manager.moveWithin(sourceSectionId, [sourceId], targetInfo.parentId, targetInfo.index);
            } else {
                manager.moveAcross(sourceSectionId, targetSectionId, [sourceId], targetInfo.parentId, targetInfo.index);
            }
            return;
        }

        if (sourceTreeType === 'temporary' && targetTreeType === 'permanent' && manager && chrome && chrome.bookmarks) {
            const payload = manager.extractPayload(sourceSectionId, [sourceId]);
            // 临时栏目到永久栏目不需要调整索引（源不在永久栏目中）
            const { parentId, index } = await computePermanentInsertion(targetId, targetIsFolder, position);
            for (const item of payload) {
                await createBookmarkFromPayload(parentId, index, item);
            }
            manager.removeItems(sourceSectionId, [sourceId]);
            // 不调用 refreshBookmarkTree()，让 chrome.bookmarks.onCreated 事件触发增量更新
            // 这样可以避免页面闪烁和滚动位置丢失
            console.log('[拖拽] 临时->永久完成，等待 onCreated 事件增量更新');
            return;
        }

        if (sourceTreeType === 'permanent' && targetTreeType === 'temporary' && manager && chrome && chrome.bookmarks) {
            const nodes = await chrome.bookmarks.getSubTree(sourceId);
            const payload = nodes && nodes[0] ? [serializeBookmarkNode(nodes[0])] : [];
            const targetInfo = computeTempInsertion(targetSectionId, targetId, position);
            manager.insertFromPayload(targetSectionId, targetInfo.parentId, payload, targetInfo.index);
            return;
        }

        if (!chrome || !chrome.bookmarks) {
            console.warn('[拖拽] Chrome扩展环境不可用');
            return;
        }

        const [sourceNode] = await chrome.bookmarks.get(sourceId);
        const [targetNode] = await chrome.bookmarks.get(targetId);
        const insertInfo = await computePermanentInsertion(targetId, targetIsFolder, position);

        console.log('[拖拽] 永久栏目内移动:', {
            source: sourceNode?.title,
            target: targetNode?.title,
            position,
            insertInfo
        });

        // 【测试】只执行Chrome API，完全依赖 onMoved 事件来更新视觉
        // 先标记
        try {
            if (typeof explicitMovedIds !== 'undefined') {
                explicitMovedIds.set(sourceId, Date.now() + Infinity);
            }
        } catch (_) { }

        // 执行Chrome API移动
        await chrome.bookmarks.move(sourceId, {
            parentId: insertInfo.parentId,
            index: insertInfo.index
        });

        console.log('[拖拽] Chrome API 移动成功，等待 onMoved 事件更新视觉');

    } catch (error) {
        console.error('[拖拽] 移动操作失败:', error);
    }
}

// 启动自动滚动
function startAutoScroll() {
    if (autoScrollInterval) return;

    autoScrollInterval = setInterval(() => {
        // 由 updateAutoScroll 控制实际滚动
    }, 10); // 100fps，更高的帧率提供更流畅的拖拽体验
}

// 更新自动滚动
function updateAutoScroll(e) {
    const baseZone = 96; // 基线高度（更大更容易触发）
    const scrollSpeed = 18; // 略微加速

    const now = Date.now();
    if (now - lastScrollTime <= 10) return; // 100fps 节流

    let didScroll = false;

    // 优先滚动鼠标所在的树容器（永久/临时）
    const containers = [];
    const permanentBody = document.querySelector('.permanent-section-body');
    if (permanentBody) containers.push(permanentBody);
    document.querySelectorAll('.temp-node-body').forEach(el => containers.push(el));

    for (const c of containers) {
        const rect = c.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right) {
            // 动态热区：容器高度的 12%，夹在 [baseZone, 160]
            const dynamicZone = Math.max(baseZone, Math.min(Math.round(rect.height * 0.12), 160));
            let delta = 0;
            if (e.clientY < rect.top + dynamicZone && e.clientY > rect.top) {
                delta = -scrollSpeed * ((rect.top + dynamicZone - e.clientY) / dynamicZone);
            } else if (e.clientY > rect.bottom - dynamicZone && e.clientY < rect.bottom) {
                delta = scrollSpeed * ((e.clientY - (rect.bottom - dynamicZone)) / dynamicZone);
            }
            if (delta !== 0) {
                c.scrollTop += delta;
                didScroll = true;
                break;
            }
        }
    }

    // 若不在任何树容器边缘，则回退到窗口滚动
    if (!didScroll) {
        const viewportHeight = window.innerHeight;
        const mouseY = e.clientY;
        const dynamicZone = Math.max(baseZone, Math.min(Math.round(viewportHeight * 0.12), 160));
        let winDelta = 0;
        if (mouseY < dynamicZone) winDelta = -scrollSpeed * ((dynamicZone - mouseY) / dynamicZone);
        else if (mouseY > viewportHeight - dynamicZone) winDelta = scrollSpeed * ((mouseY - (viewportHeight - dynamicZone)) / dynamicZone);
        if (winDelta !== 0) {
            window.scrollBy(0, winDelta);
            didScroll = true;
        }
    }

    if (didScroll) lastScrollTime = now;
}

// 停止自动滚动
function stopAutoScroll() {
    if (autoScrollInterval) {
        clearInterval(autoScrollInterval);
        autoScrollInterval = null;
    }
}

// 刷新书签树
async function refreshBookmarkTree() {
    if (typeof renderTreeView === 'function') {
        await renderTreeView(true);
    }
}

// =============================================================================
// 导出共享接口（供指针拖拽复用）
// =============================================================================

if (typeof window !== 'undefined') {
    window.__treeDnd = {
        // 显示放置指示器
        showIndicator: showDropIndicator,

        // 隐藏放置指示器
        hideIndicator: hideDropIndicator,

        // 获取当前指示器位置
        getIndicatorPosition: function () {
            return dropIndicator ? dropIndicator.dataset.position : 'inside';
        },

        // 执行移动操作
        performMove: moveBookmark,

        // 获取拖拽的节点信息
        getDraggedNodeInfo: function () {
            return {
                nodeId: draggedNodeId,
                treeType: draggedNodeTreeType,
                sectionId: draggedNodeSectionId
            };
        }
    };
}

// 导出函数
if (typeof window !== 'undefined') {
    window.initDragDrop = initDragDrop;
    window.attachDragEvents = attachDragEvents;
}
