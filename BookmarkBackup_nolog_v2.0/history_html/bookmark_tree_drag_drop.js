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
  : { timers: new Map(), counts: new Map(), lastAt: new Map(), session: 0 };
if (typeof window !== 'undefined') window.__hoverExpandState = __hoverExpandState;

function getHoverDelayForFolder(folderId) {
  // 仅依赖“本次拖动内”的识别次数：
  // 0 次 → 2000ms；1 次 → 240ms；≥2 次 → 120ms
  // 不再使用跨时间的记忆（since/lastAt），以满足“仅限当前一次拖动”。
  const count = __hoverExpandState.counts.get(folderId) || 0;
  if (count >= 2) return 120;
  if (count >= 1) return 240;
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
  // - 第一次安排 → 使用 3000ms，同时计数从 0→1；
  // - 第二次（离开后再次悬停并安排）→ 使用 240ms，计数 1→2；
  // - 后续 → 使用 120ms；
  const prev = __hoverExpandState.counts.get(folderId) || 0;
  __hoverExpandState.counts.set(folderId, Math.min(prev + 1, 2));
  __hoverExpandState.lastAt.set(folderId, Date.now());

  const sessionAtSchedule = __hoverExpandState.session;
  const timer = setTimeout(() => {
    try {
      if (__hoverExpandState.session !== sessionAtSchedule) return; // 仅限当前拖动会话
      const children = targetNode.nextElementSibling;
      const toggle = targetNode.querySelector('.tree-toggle');
      if (children && children.classList.contains('tree-children') && !children.classList.contains('expanded')) {
        children.classList.add('expanded');
        if (toggle) toggle.classList.add('expanded');
      }
    } catch (_) {}
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
    } catch (_) {}
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
    } catch (_) {}
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
    } catch (_) {}
    
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
    } catch (_) {}

    // 悬停自动展开文件夹（带二次与后续加速）
    try { clearTimeout(hoverExpandTimer); } catch(_) {}
    scheduleFolderExpand(targetNode);
}

// 拖拽离开
function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const targetNode = e.currentTarget;
    targetNode.classList.remove('drag-over');
    targetNode.classList.remove('temp-tree-drop-highlight');
    try { clearTimeout(hoverExpandTimer); } catch(_) {}
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
    
    console.log('[拖拽] 放下:', {
        from: draggedNodeId,
        to: targetNodeId,
        targetIsFolder
    });
    
    // 隐藏拖拽指示器
    hideDropIndicator();
    
    const targetTreeType = targetNode.dataset.treeType || 'permanent';
    const targetSectionId = targetNode.dataset.sectionId || null;
    const position = dropIndicator ? dropIndicator.dataset.position : null;
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
        // 同时重置计数与时间戳，确保下一次拖动从“首 3 秒”开始
        __hoverExpandState.counts.clear();
        __hoverExpandState.lastAt.clear();
    } catch (_) {}
    
    console.log('[拖拽] 拖拽结束');
}

// 显示拖拽指示器
function showDropIndicator(targetNode, e) {
    if (!dropIndicator) return;
    
    const rect = targetNode.getBoundingClientRect();
    const mouseY = e.clientY;
    const targetMiddle = rect.top + rect.height / 2;
    
    // 判断放置位置：上方、内部还是下方
    let position;
    // 增加边缘检测敏感度，使同级移动更容易准确
    const minBand = 6; // 减小最小边缘带高度，提高灵敏度
    const threshold = Math.max(minBand, Math.min(rect.height / 4, 12)); // 调整为1/4并减小上限
    
    // 使用基于 data-node-id 的比较（比 DOM 元素引用更可靠）
    const draggedNodeId = draggedNode?.dataset?.nodeId;
    const targetNodeId = targetNode?.dataset?.nodeId;
    const prevNodeId = draggedNodePrev?.dataset?.nodeId;
    const nextNodeId = draggedNodeNext?.dataset?.nodeId;
    
    // 检查目标节点是否是被拖动节点
    const isTargetDraggedNode = draggedNodeId && draggedNodeId === targetNodeId;
    
    // 检查目标节点是否是被拖动节点的子节点
    const isTargetDescendant = draggedNode && isDescendant(targetNode, draggedNode);
    
    // 检查目标节点是否是前一个同级节点
    const isTargetPrev = prevNodeId && prevNodeId === targetNodeId;
    
    // 检查目标节点是否是后一个同级节点
    const isTargetNext = nextNodeId && nextNodeId === targetNodeId;
    
    // 确定是否需要屏蔽以及屏蔽哪个边缘
    let blockBeforeEdge = false;  // 是否屏蔽 before 边缘
    let blockAfterEdge = false;   // 是否屏蔽 after 边缘
    
    if (isTargetDraggedNode || isTargetDescendant) {
        // 屏蔽被拖动节点和其子节点的所有上下边缘
        blockBeforeEdge = true;
        blockAfterEdge = true;
        console.log('[拖拽指示器] 屏蔽被拖节点的所有上下边缘');
    } else if (isTargetPrev) {
        // 屏蔽前一个同级节点的下边缘 (after)
        blockAfterEdge = true;
        console.log('[拖拽指示器] 屏蔽前一个同级节点的下边缘');
    } else if (isTargetNext) {
        // 屏蔽后一个同级节点的上边缘 (before)
        blockBeforeEdge = true;
        console.log('[拖拽指示器] 屏蔽后一个同级节点的上边缘');
    }
    
    // 允许任意位置放置
    const allowInside = true;

    // 根据屏蔽规则确定最终位置
    if (mouseY < rect.top + threshold) {
        // 鼠标在上边缘
        position = blockBeforeEdge ? 'inside' : 'before';
    } else if (mouseY > rect.bottom - threshold) {
        // 鼠标在下边缘
        position = blockAfterEdge ? 'inside' : 'after';
    } else {
        // 鼠标在中间
        position = 'inside';
    }
    
    // 如果上下边缘都被屏蔽，强制为 inside
    if (blockBeforeEdge && blockAfterEdge && (mouseY < rect.top + threshold || mouseY > rect.bottom - threshold)) {
        position = 'inside';
    }
    
    // 设置指示器位置
    if (position === 'before') {
        console.log('[拖拽指示器] 显示 before 线条');
        dropIndicator.style.top = (rect.top + window.scrollY) + 'px';
        dropIndicator.style.left = rect.left + 'px';
        dropIndicator.style.width = rect.width + 'px';
        dropIndicator.style.height = '2px';
        dropIndicator.style.display = 'block';
        dropIndicator.style.visibility = 'visible';
        dropIndicator.style.pointerEvents = 'auto';
        // 添加闪烁效果提示可以吸附
        dropIndicator.classList.add('flashing');
    } else if (position === 'after') {
        console.log('[拖拽指示器] 显示 after 线条');
        dropIndicator.style.top = (rect.bottom + window.scrollY) + 'px';
        dropIndicator.style.left = rect.left + 'px';
        dropIndicator.style.width = rect.width + 'px';
        dropIndicator.style.height = '2px';
        dropIndicator.style.display = 'block';
        dropIndicator.style.visibility = 'visible';
        dropIndicator.style.pointerEvents = 'auto';
        // 添加闪烁效果提示可以吸附
        dropIndicator.classList.add('flashing');
    } else {
        // inside - 隐藏线条
        console.log('[拖拽指示器] 屏蔽线条（inside 位置）');
        dropIndicator.style.display = 'none';
        dropIndicator.style.visibility = 'hidden';
        dropIndicator.style.pointerEvents = 'none';
        // 隐藏时移除闪烁效果
        dropIndicator.classList.remove('flashing');
    }
    
    // 保存位置信息
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
            const { parentId, index } = await computePermanentInsertion(targetId, targetIsFolder, position);
            for (const item of payload) {
                await createBookmarkFromPayload(parentId, index, item);
            }
            manager.removeItems(sourceSectionId, [sourceId]);
            await refreshBookmarkTree();
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
        
        console.log('[拖拽] 移动书签:', {
            source: sourceNode?.title,
            target: targetNode?.title,
            position,
            insertInfo
        });
        
        await chrome.bookmarks.move(sourceId, {
            parentId: insertInfo.parentId,
            index: insertInfo.index
        });
        
        try {
            if (typeof explicitMovedIds !== 'undefined') {
                explicitMovedIds.set(sourceId, Date.now() + Infinity);
            }
        } catch (_) {}
        
    } catch (error) {
        console.debug('[拖拽] 移动操作信息:', error.message);
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
        getIndicatorPosition: function() {
            return dropIndicator ? dropIndicator.dataset.position : 'inside';
        },
        
        // 执行移动操作
        performMove: moveBookmark,
        
        // 获取拖拽的节点信息
        getDraggedNodeInfo: function() {
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
