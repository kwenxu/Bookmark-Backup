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
function attachPointerDragEvents(treeContainer) {
    if (!treeContainer) {
        console.warn('[指针拖拽] 未提供树容器');
        return;
    }
    
    console.log('[指针拖拽] 为容器绑定指针拖拽事件:', treeContainer.id || treeContainer.className);
    
    // 使用事件委托，只在容器上监听
    treeContainer.addEventListener('pointerdown', handlePointerDown);
    
    // 全局监听 pointermove 和 pointerup
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointercancel', handlePointerCancel);
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
    pointerDragState.treeContainer = treeItem.closest('.bookmark-tree');
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
            // 清除旧目标的高亮
            if (pointerDragState.currentTarget) {
                pointerDragState.currentTarget.classList.remove('drag-over');
            }
            
            // 高亮新目标
            pointerDragState.currentTarget = targetTreeItem;
            targetTreeItem.classList.add('drag-over');
        }
        
        // 显示放置指示器（调用共享接口）
        if (typeof window.__treeDnd !== 'undefined' && typeof window.__treeDnd.showIndicator === 'function') {
            window.__treeDnd.showIndicator(targetTreeItem, e);
        }
    } else if (!targetTreeItem) {
        // 鼠标不在任何tree-item上
        if (pointerDragState.currentTarget) {
            pointerDragState.currentTarget.classList.remove('drag-over');
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
    const treeContainer = target?.closest('.bookmark-tree, .temp-bookmark-tree');
    
    if (targetTreeItem && targetTreeItem !== pointerDragState.draggedElement && treeContainer) {
        // 在树内放置
        performDrop(pointerDragState.draggedElement, targetTreeItem, e);
    } else if (!treeContainer) {
        // 可能拖到Canvas外，检查是否需要创建临时栏目
        const canvasWorkspace = document.getElementById('canvasWorkspace');
        const permanentSection = document.getElementById('permanentSection');
        
        if (canvasWorkspace && permanentSection) {
            const workspaceRect = canvasWorkspace.getBoundingClientRect();
            const permanentRect = permanentSection.getBoundingClientRect();
            
            const inWorkspace = e.clientX >= workspaceRect.left && 
                               e.clientX <= workspaceRect.right && 
                               e.clientY >= workspaceRect.top && 
                               e.clientY <= workspaceRect.bottom;
            
            const inPermanent = e.clientX >= permanentRect.left && 
                               e.clientX <= permanentRect.right && 
                               e.clientY >= permanentRect.top && 
                               e.clientY <= permanentRect.bottom;
            
            // 如果在Canvas工作区但不在永久栏目内，创建临时栏目
            if (inWorkspace && !inPermanent) {
                handleDropToCanvas(e, workspaceRect);
            }
        }
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
    
    // 获取树类型和section ID
    const sourceTreeType = draggedElement.dataset.treeType || 'permanent';
    const sourceSectionId = draggedElement.dataset.sectionId || null;
    const targetTreeType = targetElement.dataset.treeType || 'permanent';
    const targetSectionId = targetElement.dataset.sectionId || null;
    
    // 调用共享的移动逻辑
    if (typeof window.__treeDnd !== 'undefined' && typeof window.__treeDnd.performMove === 'function') {
        window.__treeDnd.performMove(sourceId, targetId, targetIsFolder, {
            sourceTreeType,
            sourceSectionId,
            targetTreeType,
            targetSectionId,
            position,
            event
        });
    } else {
        console.warn('[指针拖拽] 未找到共享移动接口');
    }
}

function handleAutoScroll(e) {
    if (!pointerDragState.treeContainer) return;
    
    const rect = pointerDragState.treeContainer.getBoundingClientRect();
    const scrollZone = 40; // 边缘触发区域
    const scrollSpeed = 15; // 滚动速度
    
    let scrollDelta = 0;
    
    // 检查是否在顶部边缘
    if (e.clientY < rect.top + scrollZone && e.clientY > rect.top) {
        scrollDelta = -scrollSpeed * ((rect.top + scrollZone - e.clientY) / scrollZone);
    }
    // 检查是否在底部边缘
    else if (e.clientY > rect.bottom - scrollZone && e.clientY < rect.bottom) {
        scrollDelta = scrollSpeed * ((e.clientY - (rect.bottom - scrollZone)) / scrollZone);
    }
    
    // 执行滚动
    if (scrollDelta !== 0) {
        pointerDragState.treeContainer.scrollTop += scrollDelta;
    }
}

async function handleDropToCanvas(event, workspaceRect) {
    if (!pointerDragState.draggedElement) return;
    
    const draggedElement = pointerDragState.draggedElement;
    const nodeId = draggedElement.dataset.nodeId;
    const nodeTitle = draggedElement.dataset.nodeTitle;
    const nodeUrl = draggedElement.dataset.nodeUrl;
    const isFolder = draggedElement.dataset.nodeType === 'folder';
    
    console.log('[指针拖拽] 拖到Canvas外，创建临时栏目:', { nodeId, nodeTitle, isFolder });
    
    // 获取Canvas状态（缩放和平移）
    const CanvasState = window.CanvasModule?.CanvasState || window.CanvasState;
    const zoom = CanvasState?.zoom || 1;
    const panOffsetX = CanvasState?.panOffsetX || 0;
    const panOffsetY = CanvasState?.panOffsetY || 0;
    
    // 计算Canvas坐标
    const canvasX = (event.clientX - workspaceRect.left - panOffsetX) / zoom;
    const canvasY = (event.clientY - workspaceRect.top - panOffsetY) / zoom;
    
    // 准备拖拽数据
    const dragData = {
        id: nodeId,
        title: nodeTitle,
        url: nodeUrl,
        type: isFolder ? 'folder' : 'bookmark',
        source: 'permanent'
    };
    
    try {
        // 调用Canvas模块创建临时栏目（复用原有逻辑）
        if (window.createTempNode && typeof window.createTempNode === 'function') {
            await window.createTempNode(dragData, canvasX, canvasY);
            console.log('[指针拖拽] 临时栏目创建成功');
        } else if (window.CanvasModule && typeof window.CanvasModule.createTempNode === 'function') {
            await window.CanvasModule.createTempNode(dragData, canvasX, canvasY);
            console.log('[指针拖拽] 临时栏目创建成功 (通过CanvasModule)');
        } else {
            console.warn('[指针拖拽] 未找到创建临时栏目的函数');
        }
    } catch (error) {
        console.error('[指针拖拽] 创建临时栏目失败:', error);
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
    
    // 重置状态
    pointerDragState.isDragging = false;
    pointerDragState.draggedElement = null;
    pointerDragState.dragOverlay = null;
    pointerDragState.currentTarget = null;
    pointerDragState.treeContainer = null;
    pointerDragState.hasMoved = false;
}

// 导出到全局
if (typeof window !== 'undefined') {
    window.attachPointerDragEvents = attachPointerDragEvents;
    console.log('[指针拖拽] 模块已加载');
}
