// =============================================================================
// 指针事件拖拽系统 (Pointer-based Drag System)
// 解决原生HTML5 DnD拖拽期间无法使用滚轮的问题
// =============================================================================

let pointerDragState = {
    isDragging: false,
    draggedElement: null,
    dragOverlay: null,
    currentTarget: null,
    startX: 0,
    startY: 0,
    treeContainer: null,
    dragThreshold: 5, // 移动5px后才开始拖拽
    hasMoved: false
};

// 暴露给外部的接口：为书签树容器附加指针拖拽事件
// 悬停展开状态（跨模块共享，二次/后续加速）
var __hoverExpandState = (typeof window !== 'undefined' && window.__hoverExpandState)
    ? window.__hoverExpandState
    : { timers: new Map(), counts: new Map(), lastAt: new Map(), session: 0, lastDragEndTime: 0 };
if (typeof window !== 'undefined') window.__hoverExpandState = __hoverExpandState;

// 长时间不拖动后重置的阈值（毫秒）- 使用 var 避免与 bookmark_tree_drag_drop.js 重复声明
var HOVER_EXPAND_RESET_THRESHOLD = (typeof HOVER_EXPAND_RESET_THRESHOLD !== 'undefined')
    ? HOVER_EXPAND_RESET_THRESHOLD
    : 5000; // 5秒不拖动则重置

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
    const hadTimer = __hoverExpandState.timers.has(folderId);
    // 若已有定时器，保持不变，避免把"首次 2.5 秒"意外缩短为更快延迟
    if (hadTimer) return;

    const delay = getHoverDelayForFolder(folderId);

    // 在安排定时器时计数（一次悬停一次识别），连续 dragover 仅重置定时不叠加计数
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
                const childrenLoaded = targetNode.dataset.childrenLoaded;
                const hasChildren = targetNode.dataset.hasChildren;
                const nodeId = targetNode.dataset.nodeId;

                if (childrenLoaded === 'false' && hasChildren === 'true') {
                    // 永久栏目：调用 history.js 的懒加载函数
                    try {
                        if (typeof loadPermanentFolderChildrenLazy === 'function') {
                            loadPermanentFolderChildrenLazy(nodeId, children, 0, null);
                        }
                    } catch (loadErr) {
                        console.warn('[指针拖拽展开] 永久栏目懒加载失败:', loadErr);
                    }
                }

                // 【新增】保存展开状态（永久栏目）
                try {
                    const treeContainer = targetNode.closest('.bookmark-tree');
                    if (treeContainer && typeof saveTreeExpandState === 'function') {
                        saveTreeExpandState(treeContainer);
                    }
                } catch (_) { }
            }
        } catch (_) { }
    }, delay);
    __hoverExpandState.timers.set(folderId, timer);
}

function attachPointerDragEvents(treeContainer) {
    if (!treeContainer) {
        console.warn('[指针拖拽] 未提供树容器');
        return;
    }

    // 避免重复绑定（renderTreeView 可能多次调用 attachPointerDragEvents）
    if (treeContainer.dataset.pointerDragAttached === 'true') {
        return;
    }
    treeContainer.dataset.pointerDragAttached = 'true';

    console.log('[指针拖拽] 为容器绑定指针拖拽事件:', treeContainer.id || treeContainer.className);

    // 使用事件委托，只在容器上监听
    treeContainer.addEventListener('pointerdown', handlePointerDown);

    // 全局监听 pointermove 和 pointerup（只绑定一次）
    if (!pointerDragState.globalHandlersAttached) {
        document.addEventListener('pointermove', handlePointerMove);
        document.addEventListener('pointerup', handlePointerUp);
        document.addEventListener('pointercancel', handlePointerCancel);
        pointerDragState.globalHandlersAttached = true;
    }
}

function handlePointerDown(e) {
    // 只处理左键
    if (e.button !== 0) return;

    // 查找最近的 tree-item
    const treeItem = e.target.closest('.tree-item[data-node-id]');
    if (!treeItem) return;

    // 检查是否点击了toggle按钮
    if (e.target.closest('.tree-toggle')) return;

    // 检查是否点击了输入框或按钮
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.tagName === 'TEXTAREA') return;

    // 记录起始状态
    pointerDragState.draggedElement = treeItem;
    pointerDragState.startX = e.clientX;
    pointerDragState.startY = e.clientY;
    // 选择最近的可滚动树容器：永久（.permanent-section-body），最后再退化到 .bookmark-tree
    pointerDragState.treeContainer = treeItem.closest('.permanent-section-body') ||
        treeItem.closest('.bookmark-tree');
    pointerDragState.hasMoved = false;
    pointerDragState.isDragging = false; // 还未开始拖拽

    // 阻止默认选择行为
    e.preventDefault();
}

function handlePointerMove(e) {
    if (!pointerDragState.draggedElement) return;

    const deltaX = Math.abs(e.clientX - pointerDragState.startX);
    const deltaY = Math.abs(e.clientY - pointerDragState.startY);
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // 检查是否超过阈值
    if (!pointerDragState.hasMoved && distance < pointerDragState.dragThreshold) {
        return; // 还未移动足够距离
    }

    // 开始拖拽
    if (!pointerDragState.isDragging) {
        startPointerDrag(e);
    }

    pointerDragState.hasMoved = true;

    // 更新拖拽覆盖层位置
    if (pointerDragState.dragOverlay) {
        pointerDragState.dragOverlay.style.left = e.clientX + 10 + 'px';
        pointerDragState.dragOverlay.style.top = e.clientY + 10 + 'px';
    }

    // 查找当前鼠标下的目标节点（暂时隐藏覆盖层以避免干扰）
    let target = null;
    if (pointerDragState.dragOverlay) {
        pointerDragState.dragOverlay.style.display = 'none';
        target = document.elementFromPoint(e.clientX, e.clientY);
        pointerDragState.dragOverlay.style.display = 'block';
    } else {
        target = document.elementFromPoint(e.clientX, e.clientY);
    }

    const targetTreeItem = target?.closest('.tree-item[data-node-id]');

    if (targetTreeItem && targetTreeItem !== pointerDragState.draggedElement) {
        // 更新当前目标
        if (pointerDragState.currentTarget !== targetTreeItem) {
            // 清除旧目标的高亮，并清理其悬停展开计时器
            if (pointerDragState.currentTarget) {
                pointerDragState.currentTarget.classList.remove('drag-over');
                try {
                    const prevId = pointerDragState.currentTarget.dataset?.nodeId;
                    const t = prevId && __hoverExpandState.timers.get(prevId);
                    if (t) { clearTimeout(t); __hoverExpandState.timers.delete(prevId); }
                } catch (_) { }
            }

            // 高亮新目标
            pointerDragState.currentTarget = targetTreeItem;
            targetTreeItem.classList.add('drag-over');
        }

        // 悬停自动展开文件夹（带二次与后续加速），并显示蓝色候选高亮
        if (targetTreeItem.dataset.nodeType === 'folder') {
            scheduleFolderExpand(targetTreeItem);
        }

        // 显示放置指示器（调用共享接口）
        if (typeof window.__treeDnd !== 'undefined' && typeof window.__treeDnd.showIndicator === 'function') {
            window.__treeDnd.showIndicator(targetTreeItem, e);
        }
    } else if (!targetTreeItem) {
        // 鼠标不在任何tree-item上
        if (pointerDragState.currentTarget) {
            pointerDragState.currentTarget.classList.remove('drag-over');
            try {
                const prevId = pointerDragState.currentTarget.dataset?.nodeId;
                const t = prevId && __hoverExpandState.timers.get(prevId);
                if (t) { clearTimeout(t); __hoverExpandState.timers.delete(prevId); }
            } catch (_) { }
            pointerDragState.currentTarget = null;
        }

        // 隐藏指示器
        if (typeof window.__treeDnd !== 'undefined' && typeof window.__treeDnd.hideIndicator === 'function') {
            window.__treeDnd.hideIndicator();
        }
    }

    // 处理自动滚动（靠近边缘时）
    handleAutoScroll(e);
}

function handlePointerUp(e) {
    if (!pointerDragState.isDragging) {
        // 未开始拖拽，清理状态
        cleanupPointerDrag();
        return;
    }

    // 隐藏覆盖层以准确检测落点
    if (pointerDragState.dragOverlay) {
        pointerDragState.dragOverlay.style.display = 'none';
    }

    // 重新检测落点位置（确保最准确）
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const targetTreeItem = target?.closest('.tree-item[data-node-id]');

    // 恢复覆盖层显示（准备清理）
    if (pointerDragState.dragOverlay) {
        pointerDragState.dragOverlay.style.display = 'block';
    }

    // 检查是否在树容器内
    const treeContainer = target?.closest('.bookmark-tree');

    if (targetTreeItem && targetTreeItem !== pointerDragState.draggedElement && treeContainer) {
        // 在树内放置
        performDrop(pointerDragState.draggedElement, targetTreeItem, e);
    }

    cleanupPointerDrag();
}

function handlePointerCancel(e) {
    cleanupPointerDrag();
}

function startPointerDrag(e) {
    pointerDragState.isDragging = true;

    const draggedElement = pointerDragState.draggedElement;
    if (!draggedElement) return;

    // 添加拖拽样式
    draggedElement.classList.add('dragging');

    // 创建拖拽覆盖层
    const overlay = document.createElement('div');
    overlay.className = 'pointer-drag-overlay';
    overlay.textContent = draggedElement.dataset.nodeTitle || '拖拽中...';
    overlay.style.position = 'fixed';
    overlay.style.left = e.clientX + 10 + 'px';
    overlay.style.top = e.clientY + 10 + 'px';
    overlay.style.padding = '4px 8px';
    overlay.style.background = 'rgba(0, 0, 0, 0.75)';
    overlay.style.color = 'white';
    overlay.style.borderRadius = '4px';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '10000';
    overlay.style.fontSize = '12px';
    overlay.style.maxWidth = '200px';
    overlay.style.overflow = 'hidden';
    overlay.style.textOverflow = 'ellipsis';
    overlay.style.whiteSpace = 'nowrap';

    document.body.appendChild(overlay);
    pointerDragState.dragOverlay = overlay;

    // 重置“本次拖动”的悬停展开加速状态
    try {
        if (__hoverExpandState) {
            __hoverExpandState.session = (__hoverExpandState.session || 0) + 1;
            __hoverExpandState.timers.forEach((t) => clearTimeout(t));
            __hoverExpandState.timers.clear();
            __hoverExpandState.counts.clear();
            __hoverExpandState.lastAt.clear();
        }
    } catch (_) { }

    console.log('[指针拖拽] 开始拖拽:', draggedElement.dataset.nodeTitle);
}

function performDrop(draggedElement, targetElement, event) {
    if (!draggedElement || !targetElement) return;

    const sourceId = draggedElement.dataset.nodeId;
    const targetId = targetElement.dataset.nodeId;
    const targetIsFolder = targetElement.dataset.nodeType === 'folder';

    console.log('[指针拖拽] 执行放置:', {
        from: sourceId,
        to: targetId,
        targetIsFolder
    });

    // 获取放置位置（before/inside/after）
    let position = 'inside';
    if (typeof window.__treeDnd !== 'undefined' && window.__treeDnd.getIndicatorPosition) {
        position = window.__treeDnd.getIndicatorPosition();
    }

    // 调用共享的移动逻辑
    if (typeof window.__treeDnd !== 'undefined' && typeof window.__treeDnd.performMove === 'function') {
        window.__treeDnd.performMove(sourceId, targetId, targetIsFolder, {
            position,
            event
        });
    } else {
        console.warn('[指针拖拽] 未找到共享移动接口');
    }
}

function handleAutoScroll(e) {
    const baseZone = 96; // 更高的触发高度
    const scrollSpeed = 18; // 稍快
    let didScroll = false;

    // 根据指针位置选择容器进行滚动（永久 body）
    const containers = [];
    const permanentBody = document.querySelector('.permanent-section-body');
    if (permanentBody) containers.push(permanentBody);
    for (const c of containers) {
        const rect = c.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right) {
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

    // 备选：滚动窗口
    if (!didScroll) {
        const viewportHeight = window.innerHeight;
        const dynamicZone = Math.max(baseZone, Math.min(Math.round(viewportHeight * 0.12), 160));
        let winDelta = 0;
        if (e.clientY < dynamicZone) winDelta = -scrollSpeed * ((dynamicZone - e.clientY) / dynamicZone);
        else if (e.clientY > viewportHeight - dynamicZone) winDelta = scrollSpeed * ((e.clientY - (viewportHeight - dynamicZone)) / dynamicZone);
        if (winDelta !== 0) window.scrollBy(0, winDelta);
    }
}

function cleanupPointerDrag() {
    // 移除拖拽样式
    if (pointerDragState.draggedElement) {
        pointerDragState.draggedElement.classList.remove('dragging');
    }

    // 移除目标高亮
    if (pointerDragState.currentTarget) {
        pointerDragState.currentTarget.classList.remove('drag-over');
    }

    // 移除拖拽覆盖层
    if (pointerDragState.dragOverlay) {
        pointerDragState.dragOverlay.remove();
    }

    // 隐藏指示器
    if (typeof window.__treeDnd !== 'undefined' && typeof window.__treeDnd.hideIndicator === 'function') {
        window.__treeDnd.hideIndicator();
    }

    // 全量清除候选/悬停样式，防止残留需要刷新才消失
    try {
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    } catch (_) { }

    // 重置状态
    pointerDragState.isDragging = false;
    pointerDragState.draggedElement = null;
    pointerDragState.dragOverlay = null;
    pointerDragState.currentTarget = null;
    pointerDragState.treeContainer = null;
    pointerDragState.hasMoved = false;

    // 结束拖动：清理所有悬停展开计时器，记录结束时间
    // 不立即清除计数，让后续拖动可以继续使用1.2秒的快速延迟
    try {
        __hoverExpandState.session = (__hoverExpandState.session || 0) + 1;
        __hoverExpandState.timers.forEach((t) => clearTimeout(t));
        __hoverExpandState.timers.clear();
        __hoverExpandState.lastDragEndTime = Date.now();
        __hoverExpandState.lastAt.clear();
    } catch (_) { }
}

// 导出到全局
if (typeof window !== 'undefined') {
    window.attachPointerDragEvents = attachPointerDragEvents;
    console.log('[指针拖拽] 模块已加载');
}
