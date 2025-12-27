// =============================================================================
// Bookmark Canvas Module - 基于原有Bookmark Tree改造的Canvas功能
// =============================================================================

// Canvas状态管理
const CANVAS_BASE_ZOOM_DEFAULT = 0.6; // 新默认基准缩放：旧 60% 视图 = 新 100%

// 统一的首屏初始缩放：让 HTML 不需要再手动同步数值
try {
    const initialContainer = document.querySelector('.canvas-main-container');
    if (initialContainer) {
        initialContainer.style.setProperty('--canvas-scale', CANVAS_BASE_ZOOM_DEFAULT);
    }
} catch (_) { }

const CanvasState = {
    tempSections: [],
    tempSectionCounter: 0,
    tempItemCounter: 0,
    tempSectionSequenceNumber: 0,
    tempSectionLastColor: null,
    tempSectionPrevColor: null,
    colorCursor: 0,
    // 纯 Markdown 文本卡片（Obsidian Canvas 风格）
    mdNodes: [],
    mdNodeCounter: 0,
    // 栏目休眠管理（性能优化）- 阶梯式性能模式
    performanceMode: 'balanced', // 性能模式：'maximum' | 'balanced' | 'smooth' | 'unlimited'
    // 双指滑动状态追踪（防止在栏目内触发纵向滚动）
    touchpadState: {
        isScrolling: false, // 是否正在画布级别的滚动
        lastScrollTime: 0,
        scrollTimeout: null
    },
    // 自动滚动状态（拖动到边缘时）
    autoScrollState: {
        intervalId: null,
        velocityX: 0,           // 当前实际速度
        velocityY: 0,           // 当前实际速度
        targetVelocityX: 0,     // 目标速度
        targetVelocityY: 0,     // 目标速度
        isActive: false,
        smoothing: 0.15         // 速度平滑系数（0-1），值越小越平滑但响应越慢
    },
    // 滚动惯性状态（阻尼延续）
    inertiaState: {
        velocityX: 0,
        velocityY: 0,
        isActive: false,
        animationId: null,
        lastDeltaX: 0,
        lastDeltaY: 0,
        lastTime: 0
    },
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
        viewport: 60000,   // 离开视口1分钟后休眠
        occlusion: 60000   // 被遮挡1分钟后休眠
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
        treeDragCleanupTimeout: null,
        wheelScrollEnabled: false, // 拖动时是否启用滚轮滚动
        lastClientX: 0,
        lastClientY: 0,
        hasMoved: false,
        meta: null
    },
    // Ctrl 专属栏目操作状态（移动/缩放和蒙版）
    sectionCtrlMode: {
        active: false,
        resize: {
            active: false,
            element: null,
            type: null, // 'permanent-section' | 'temp-node'
            data: null,
            startX: 0,
            startY: 0,
            startWidth: 0,
            startHeight: 0,
            startLeft: 0,
            startTop: 0,
            minWidth: 0,
            minHeight: 0,
            waitForSecondRightClick: false
        }
    },
    // 画布缩放和平移
    zoom: 1,
    baseZoom: CANVAS_BASE_ZOOM_DEFAULT,
    panOffsetX: 0,
    panOffsetY: 0,
    isPanning: false,
    panStartX: 0,
    panStartY: 0,
    isSpacePressed: false,
    isCtrlPressed: false,
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

// 简易本地存储封装（仅用于滚动位置）
// 全局 Popover 状态管理 (防止穿透交互)
function updateCanvasPopoverState(isActive) {
    if (isActive) {
        document.body.classList.add('canvas-popover-active');
    } else {
        // 延时一帧检查，确保 DOM 状态已更新
        requestAnimationFrame(() => {
            const hasOpen = document.querySelector('.md-format-popover.open, .temp-color-popover.open, .md-color-popover.open, .md-delete-options-popover.open');
            if (!hasOpen) {
                document.body.classList.remove('canvas-popover-active');
            }
        });
    }
}

// 阻止 Canvas 事件冒泡 (防止 UI 内部拖动触发父级 Drag/Resize)
function preventCanvasEventsPropagation(element) {
    if (!element) return;
    ['mousedown', 'dblclick', 'dragstart'].forEach(evt => {
        element.addEventListener(evt, (e) => e.stopPropagation());
    });
}

function __readJSON(key, fallback = null) {
    try {
        const v = localStorage.getItem(key);
        if (!v) return fallback;
        return JSON.parse(v);
    } catch (_) { return fallback; }
}
function __writeJSON(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch (_) { }
}

// 多次尝试恢复滚动，避免首次布局或字体加载导致的覆盖
function __restoreScroll(el, key) {
    if (!el || !key) return;
    const data = __readJSON(key, null);
    const apply = () => {
        if (!data) return;
        if (typeof data.top === 'number') el.scrollTop = data.top || 0;
        if (typeof data.left === 'number') el.scrollLeft = data.left || 0;
    };
    apply();
    requestAnimationFrame(() => {
        apply();
        setTimeout(apply, 10);
        setTimeout(apply, 50);
        setTimeout(apply, 100);
    });
}

let panSaveTimeout = null;
const CANVAS_SCROLL_MARGIN = 120;
const CANVAS_SCROLL_EXTRA_SPACE = 2000; // 允许滚动到内容外2000px的空白区域
let suppressScrollSync = false;
let zoomSaveTimeout = null;
let zoomUpdateFrame = null;
let pendingZoomRequest = null;
// 性能优化：滚动更新去抖（RAF）
let scrollUpdateFrame = null;
let pendingScrollRequest = null;
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
let lastDormancyCheckTime = 0; // [Fix] 用于滚动过程中的节流检查
let lastResizeTime = 0; // [Fix] 用于防止Resize过程中的闪烁
// 防止重复绑定：临时栏目书签链接点击处理器
let tempLinkClickHandler = null;

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

// =============================================================================
// Ctrl 专属栏目操作（蒙版 + 拖动/尺寸调整入口）
// =============================================================================

function isSectionCtrlModeEvent(e) {
    return !!(CanvasState.sectionCtrlMode && CanvasState.sectionCtrlMode.active) || (!!e && (isCustomCtrlKeyPressed(e) || e.metaKey));
}

function resolveSectionMeta(element) {
    if (!element) return null;
    if (element.id === 'permanentSection') {
        return {
            type: 'permanent-section',
            data: null,
            x: parseFloat(element.style.left) || 0,
            y: parseFloat(element.style.top) || 0,
            locked: element.dataset && element.dataset.locked === 'true',
            isEditing: false
        };
    }

    if (element.classList.contains('md-canvas-node')) {
        const data = Array.isArray(CanvasState.mdNodes) ? CanvasState.mdNodes.find(n => n.id === element.id) : null;
        if (!data) return null;
        return {
            type: 'md-node',
            data,
            x: typeof data.x === 'number' ? data.x : (parseFloat(element.style.left) || 0),
            y: typeof data.y === 'number' ? data.y : (parseFloat(element.style.top) || 0),
            locked: !!data.locked,
            isEditing: !!data.isEditing
        };
    }

    if (element.classList.contains('temp-canvas-node')) {
        const data = CanvasState.tempSections.find(n => n.id === element.id);
        if (!data) return null;
        return {
            type: 'temp-node',
            data,
            x: typeof data.x === 'number' ? data.x : (parseFloat(element.style.left) || 0),
            y: typeof data.y === 'number' ? data.y : (parseFloat(element.style.top) || 0),
            locked: false,
            isEditing: false
        };
    }

    return null;
}

function registerSectionCtrlOverlay(element) {
    if (!element) return null;
    let overlay = element.querySelector('.canvas-section-ctrl-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'canvas-section-ctrl-overlay';
        overlay.addEventListener('mousedown', handleCtrlOverlayMouseDown, true);
        overlay.addEventListener('contextmenu', (e) => {
            if (isSectionCtrlModeEvent(e)) {
                e.preventDefault();
                e.stopPropagation();
            }
        });
        overlay.addEventListener('wheel', (e) => {
            // 允许 Ctrl+滚轮 进行画布缩放，不阻止
            if (isCustomCtrlKeyPressed(e) || e.metaKey) {
                return;
            }
            // 其他情况下，如果在Ctrl模式中，阻止默认滚动
            if (CanvasState.sectionCtrlMode && CanvasState.sectionCtrlMode.active) {
                e.preventDefault();
                e.stopPropagation();
            }
        }, { passive: false });
        element.appendChild(overlay);
    }

    overlay.dataset.sectionId = element.id || '';
    overlay.dataset.sectionType = element.id === 'permanentSection'
        ? 'permanent-section'
        : (element.classList.contains('md-canvas-node') ? 'md-node' : 'temp-node');
    overlay.classList.toggle('active', !!(CanvasState.sectionCtrlMode && CanvasState.sectionCtrlMode.active));

    if (CanvasState.sectionCtrlMode && CanvasState.sectionCtrlMode.resize && CanvasState.sectionCtrlMode.resize.element === element) {
        overlay.classList.add('ctrl-resize');
    } else {
        overlay.classList.remove('ctrl-resize');
    }

    return overlay;
}

function refreshSectionCtrlOverlays() {
    const nodes = document.querySelectorAll('.temp-canvas-node, .md-canvas-node, #permanentSection');
    nodes.forEach(el => registerSectionCtrlOverlay(el));
}

function setSectionCtrlModeActive(active) {
    const wasActive = !!(CanvasState.sectionCtrlMode && CanvasState.sectionCtrlMode.active);
    if (wasActive === active) return;
    CanvasState.sectionCtrlMode.active = active;
    if (!active) {
        endCtrlResize(false);
    }
    refreshSectionCtrlOverlays();
}

function startSectionDrag(element, event) {
    if (!isSectionCtrlModeEvent(event)) return false;
    if (!element || event.button !== 0) return false;
    if (CanvasState.sectionCtrlMode.resize && CanvasState.sectionCtrlMode.resize.active) return false;

    const meta = resolveSectionMeta(element);
    if (!meta || meta.locked || meta.isEditing) return false;

    CanvasState.dragState.isDragging = true;
    CanvasState.dragState.draggedElement = element;
    CanvasState.dragState.dragStartX = event.clientX;
    CanvasState.dragState.dragStartY = event.clientY;
    CanvasState.dragState.nodeStartX = meta.x;
    CanvasState.dragState.nodeStartY = meta.y;
    CanvasState.dragState.dragSource = meta.type === 'permanent-section' ? 'permanent-section' : 'temp-node';
    CanvasState.dragState.lastClientX = event.clientX;
    CanvasState.dragState.lastClientY = event.clientY;
    CanvasState.dragState.hasMoved = false;
    CanvasState.dragState.meta = { ctrlOverlay: !!CanvasState.sectionCtrlMode.active };
    CanvasState.dragState.wheelScrollEnabled = true;

    element.classList.add('dragging');
    element.style.transition = 'none';

    if (meta.type === 'permanent-section') {
        element.style.transform = 'none';
    }

    // 如果是 import-container，计算并捕获其内部的子节点
    CanvasState.dragState.childElements = [];
    if (meta.data && meta.data.subtype === 'import-container') {
        const container = meta.data;
        const cx = Number(container.x);
        const cy = Number(container.y);
        const cw = Number(container.width);
        const ch = Number(container.height);

        // 查找所有在容器范围内的 tempSections
        CanvasState.tempSections.forEach(sec => {
            // 简单的包含检测：中心点在容器内，或者完全包含
            const sx = Number(sec.x) + (Number(sec.width) / 2);
            const sy = Number(sec.y) + (Number(sec.height) / 2);
            if (sx >= cx && sx <= cx + cw && sy >= cy && sy <= cy + ch) {
                CanvasState.dragState.childElements.push({
                    type: 'temp-section',
                    data: sec,
                    startX: Number(sec.x),
                    startY: Number(sec.y),
                    element: document.getElementById(sec.id)
                });
            }
        });

        // 查找所有在容器范围内的 mdNodes (排除容器自己)
        CanvasState.mdNodes.forEach(node => {
            if (node.id === container.id) return;
            // 简单的包含检测
            const nodeW = Number(node.width) || 200; // fallback width
            const nodeH = Number(node.height) || 100;
            const nx = Number(node.x) + (nodeW / 2);
            const ny = Number(node.y) + (nodeH / 2);
            if (nx >= cx && nx <= cx + cw && ny >= cy && ny <= cy + ch) {
                CanvasState.dragState.childElements.push({
                    type: 'md-node',
                    data: node,
                    startX: Number(node.x),
                    startY: Number(node.y),
                    element: document.getElementById(node.id)
                });
            }
        });

        // 临时禁用这些子元素的过渡效果，以便平滑拖动
        CanvasState.dragState.childElements.forEach(child => {
            if (child.element) child.element.style.transition = 'none';
        });
    }

    event.preventDefault();
    return true;
}

function startSectionResize(element, event) {
    if (!isSectionCtrlModeEvent(event)) return false;
    if (!element || event.button !== 2) return false;
    if (CanvasState.dragState && CanvasState.dragState.isDragging) return false;

    const meta = resolveSectionMeta(element);
    if (!meta || meta.locked || meta.isEditing) return false;

    const state = CanvasState.sectionCtrlMode.resize;
    state.active = true;
    state.element = element;
    state.type = meta.type === 'permanent-section' ? 'permanent-section' : 'temp-node';
    state.data = meta.data;
    state.startX = event.clientX;
    state.startY = event.clientY;
    state.startWidth = element.offsetWidth;
    state.startHeight = element.offsetHeight;
    state.startLeft = meta.x;
    state.startTop = meta.y;
    state.minWidth = meta.type === 'permanent-section' ? 300 : (meta.type === 'md-node' ? 180 : 200);
    state.minHeight = meta.type === 'permanent-section' ? 200 : (meta.type === 'md-node' ? 140 : 150);
    state.waitForSecondRightClick = true; // 第二次右键才结束

    element.classList.add('resizing');
    const overlay = registerSectionCtrlOverlay(element);
    if (overlay) overlay.classList.add('ctrl-resize');

    applyCtrlResize(event.clientX, event.clientY);

    event.preventDefault();
    event.stopPropagation();
    return true;
}

function applyCtrlResize(clientX, clientY) {
    const state = CanvasState.sectionCtrlMode.resize;
    if (!state || !state.active || !state.element) return;

    const deltaX = (clientX - state.startX) / (CanvasState.zoom || 1);
    const deltaY = (clientY - state.startY) / (CanvasState.zoom || 1);

    const newWidth = Math.max(state.minWidth, state.startWidth + deltaX);
    const newHeight = Math.max(state.minHeight, state.startHeight + deltaY);

    state.element.style.width = `${newWidth}px`;
    state.element.style.height = `${newHeight}px`;

    if (state.type === 'permanent-section') {
        // 固定左上角，宽高变化即可
    } else if (state.data) {
        state.data.width = newWidth;
        state.data.height = newHeight;
    }
}

function endCtrlResize(force) {
    const state = CanvasState.sectionCtrlMode.resize;
    if (!state || !state.active) return;

    if (!force) {
        if (state.type === 'permanent-section') {
            savePermanentSectionPosition();
        } else if (state.data) {
            saveTempNodes();
        }
        updateCanvasScrollBounds();
        updateScrollbarThumbs();
    }

    if (state.element) {
        state.element.classList.remove('resizing');
    }

    const overlay = state.element ? state.element.querySelector('.canvas-section-ctrl-overlay') : null;
    if (overlay) overlay.classList.remove('ctrl-resize');

    state.active = false;
    state.element = null;
    state.type = null;
    state.data = null;
    state.waitForSecondRightClick = false;
}

function handleCtrlOverlayMouseDown(e) {
    if (!isSectionCtrlModeEvent(e)) return;
    const host = e.currentTarget ? e.currentTarget.parentElement : null;
    if (!host) return;
    e.preventDefault();
    e.stopPropagation();

    const resizeState = CanvasState.sectionCtrlMode && CanvasState.sectionCtrlMode.resize;

    if (resizeState && resizeState.active && resizeState.waitForSecondRightClick && e.button === 2) {
        // 第二次右键点击，结束缩放
        endCtrlResize(false);
        return;
    }

    if (e.button === 0) {
        startSectionDrag(host, e);
    } else if (e.button === 2) {
        startSectionResize(host, e);
    }
}
const TEMP_SECTION_STORAGE_KEY = 'bookmark-canvas-temp-sections';
const LEGACY_TEMP_NODE_STORAGE_KEY = 'bookmark-canvas-temp-nodes';
const TEMP_SECTION_DEFAULT_WIDTH = 420;
const TEMP_SECTION_DEFAULT_HEIGHT = 380;
const TEMP_SECTION_DEFAULT_COLOR = '#2563eb';
// Obsidian Canvas 文本节点默认尺寸（参考 sample.canvas）
const MD_NODE_DEFAULT_WIDTH = 300;
const MD_NODE_DEFAULT_HEIGHT = 300;

// =============================================================================
// 初始演示模板 - 首次使用时显示的使用指南
// =============================================================================

/**
 * 创建初始演示模板数据
 * 包含两个空白栏目和演示连接线
 * 根据语言设置显示中文或英文版本
 */
function createInitialDemoTemplate() {
    // 检测语言：使用全局 currentLang 或 window.currentLang，非中文则显示英文
    const lang = (typeof currentLang !== 'undefined' ? currentLang : (typeof window !== 'undefined' && window.currentLang ? window.currentLang : 'zh_CN'));
    const isEnglish = lang !== 'zh_CN';

    // 中文版：永久栏目使用说明
    const bookmarkGuideHtml_zh = `<h2>书签画布（v3.0） - 使用说明</h2>
<ol>
<li><strong>拖动书签/文件夹至空白处</strong>，创建书签型临时节点；</li>
<li>临时节点的修改<strong>不计入核心数据</strong>，可用来对比查看/整理；</li>
<li><strong>栏目间可互相拖动/粘贴</strong>。</li>
</ol>
<hr>
<h3>基本操作</h3>
<ul>
<li><strong>创建临时栏目</strong>：从书签树拖动书签到空白处</li>
<li><strong>创建空白卡片</strong>：双击画布空白处</li>
<li><strong>平移画布</strong>：空格+拖动 或 双指滑动</li>
<li><strong>缩放画布</strong>：Ctrl+滚轮 或 双指捏合</li>
</ul>
<h3>连接线</h3>
<ul>
<li><strong>创建连接</strong>：点击栏目边缘连接点，拖向另一栏目</li>
<li><strong>编辑连接</strong>：点击连接线，可修改颜色、方向、标签</li>
<li><strong>预设颜色</strong>：<font color="#ff6666">红</font> <font color="#ffaa66">橙</font> <font color="#ffdd66">黄</font> <font color="#66ffaa">绿</font> <font color="#66bbff">蓝</font> <font color="#bf66ff">紫</font></li>
</ul>
<p><em>提示：此卡片可自由编辑或删除</em></p>`;

    // 英文版：永久栏目使用说明
    const bookmarkGuideHtml_en = `<h2>Bookmark Canvas (v3.0) - User Guide</h2>
<ol>
<li><strong>Drag bookmarks/folders to blank area</strong> to create bookmark-type temp nodes;</li>
<li>Temp node changes are <strong>not saved to core data</strong>, useful for comparison/organization;</li>
<li><strong>Drag/paste between sections</strong>.</li>
</ol>
<hr>
<h3>Basic Operations</h3>
<ul>
<li><strong>Create temp section</strong>: Drag bookmark from tree to blank area</li>
<li><strong>Create blank card</strong>: Double-click on canvas blank area</li>
<li><strong>Pan canvas</strong>: Space+drag or two-finger swipe</li>
<li><strong>Zoom canvas</strong>: Ctrl+scroll or pinch gesture</li>
</ul>
<h3>Connection Lines</h3>
<ul>
<li><strong>Create connection</strong>: Click section edge anchor, drag to another section</li>
<li><strong>Edit connection</strong>: Click line to change color, direction, label</li>
<li><strong>Preset colors</strong>: <font color="#ff6666">Red</font> <font color="#ffaa66">Orange</font> <font color="#ffdd66">Yellow</font> <font color="#66ffaa">Green</font> <font color="#66bbff">Blue</font> <font color="#bf66ff">Purple</font></li>
</ul>
<p><em>Tip: This card can be freely edited or deleted</em></p>`;

    // 中文版：快捷键说明
    const shortcutGuideHtml_zh = `<h2>快捷键说明</h2>
<h3>Ctrl 键操作</h3>
<ul>
<li><strong>Ctrl + 左键（按住）</strong>：拖动画布 或 栏目卡片</li>
<li><strong>Ctrl + 滚轮</strong>：缩放画布</li>
<li><strong>Ctrl + 右键（单击）</strong>：更改栏目卡片的大小</li>
</ul>
<h3>空格键操作</h3>
<ul>
<li><strong>空格 + 左键（按住）</strong>：拖动画布</li>
</ul>
<h3>触控板操作</h3>
<ul>
<li><strong>双指捏合</strong>：缩放画布</li>
<li><strong>双指滑动</strong>：拖动画布</li>
</ul>
<hr>
<p><em>快捷键可在左上角「说明」按钮中自定义</em></p>`;

    // 英文版：快捷键说明
    const shortcutGuideHtml_en = `<h2>Keyboard Shortcuts</h2>
<h3>Ctrl Key Operations</h3>
<ul>
<li><strong>Ctrl + Left Click (hold)</strong>: Drag canvas or section card</li>
<li><strong>Ctrl + Scroll</strong>: Zoom canvas</li>
<li><strong>Ctrl + Right Click</strong>: Resize section card</li>
</ul>
<h3>Space Key Operations</h3>
<ul>
<li><strong>Space + Left Click (hold)</strong>: Drag canvas</li>
</ul>
<h3>Touchpad Operations</h3>
<ul>
<li><strong>Pinch gesture</strong>: Zoom canvas</li>
<li><strong>Two-finger swipe</strong>: Drag canvas</li>
</ul>
<hr>
<p><em>Shortcuts can be customized in the "Help" button at top-left</em></p>`;

    // 根据语言选择对应版本
    const bookmarkGuideHtml = isEnglish ? bookmarkGuideHtml_en : bookmarkGuideHtml_zh;
    const shortcutGuideHtml = isEnglish ? shortcutGuideHtml_en : shortcutGuideHtml_zh;
    const edgeLabel = isEnglish ? 'Guide' : '说明';

    // 永久栏目说明卡片（位于永久栏目左侧，与永久栏目水平对齐）- 绿色
    // 永久栏目初始位置：left=0, top=-190（与本卡片顶部对齐），横向间距180
    const bookmarkGuideNode = {
        id: 'md-node-demo-bookmark-guide',
        x: -600,  // 右边缘(-600+420=-180) 与永久栏目(left=0)间距180
        y: -190,  // 与永久栏目(top=-190)顶部对齐
        width: 420,
        height: 480,
        text: '',
        html: bookmarkGuideHtml,
        color: '4', // 绿色
        fontSize: 14,
        createdAt: Date.now()
    };

    // 快捷键说明卡片（位于永久栏目说明卡片上方）- 蓝色
    const shortcutGuideNode = {
        id: 'md-node-demo-shortcut-guide',
        x: -600,  // 与使用说明卡片左对齐
        y: -730,  // 使用说明顶部(y:-190) - 间距140 - 高度400 = -730
        width: 420,
        height: 400,
        text: '',
        html: shortcutGuideHtml,
        color: '5', // 蓝色
        fontSize: 14,
        createdAt: Date.now()
    };

    // 中文版：打开方式与多选功能说明（强调一键连续点击）
    const batchFeatureHtml_zh = `<h2>打开方式特色功能</h2>
<h3>⭐ 一键连续打开</h3>
<ul>
<li><strong>勾选默认打开方式</strong>：右键菜单中选择并勾选你想要的打开方式</li>
<li><strong>左键单击即生效</strong>：设置后，每次左键点击书签自动使用已选方式打开</li>
</ul>
<h3>可选打开方式</h3>
<ul>
<li><strong>同窗特定组</strong>：在同一窗口的特定标签组中打开</li>
<li><strong>手动选择...</strong>：每次手动选择目标窗口和标签组</li>
<li>新标签页 / 同一标签组 / 特定标签组</li>
<li>新窗口 / 同一窗口 / 特定窗口 / 无痕窗口</li>
</ul>
<h3>批量操作</h3>
<ul>
<li><strong>选择（批量操作）</strong>：进入多选模式，支持跨栏目多选</li>
<li><strong>文件夹自动成组</strong>：批量打开时，文件夹自动创建标签组</li>
</ul>
<hr>
<p><em>提示：此卡片可自由编辑或删除</em></p>`;

    // 英文版：打开方式与多选功能说明
    const batchFeatureHtml_en = `<h2>Open Mode Features</h2>
<h3>⭐ One-Click Continuous Open</h3>
<ul>
<li><strong>Check default open mode</strong>: Right-click menu to select and check your preferred mode</li>
<li><strong>Left-click to open</strong>: After setting, each left-click opens bookmark in the chosen mode</li>
</ul>
<h3>Available Open Modes</h3>
<ul>
<li><strong>Same Window + Specific Group</strong>: Open in specific tab group of same window</li>
<li><strong>Manual Select...</strong>: Manually choose target window and tab group each time</li>
<li>New Tab / Same Group / Specific Group</li>
<li>New Window / Same Window / Specific Window / Incognito</li>
</ul>
<h3>Batch Operations</h3>
<ul>
<li><strong>Select (Batch)</strong>: Enter multi-select mode, supports cross-column selection</li>
<li><strong>Auto folder grouping</strong>: Folders auto-create tab groups when batch opening</li>
</ul>
<hr>
<p><em>Tip: This card can be freely edited or deleted</em></p>`;

    const batchFeatureHtml = isEnglish ? batchFeatureHtml_en : batchFeatureHtml_zh;

    // 多选功能说明卡片（位于使用说明卡片下方）- 蓝色
    const batchFeatureNode = {
        id: 'md-node-demo-batch-feature',
        x: -600,  // 与使用说明卡片左对齐
        y: 430,  // 使用说明底部(y:-190+480=290) + 间距140 = 430
        width: 420,
        height: 420,  // 稍微增高以容纳更多内容
        text: '',
        html: batchFeatureHtml,
        color: '5', // 蓝色
        fontSize: 14,
        createdAt: Date.now()
    };

    // 从永久栏目连接到使用说明的演示连接线（绿色，箭头指向使用说明）
    const edge1 = {
        id: 'edge-demo-1',
        fromNode: 'permanent-section',
        fromSide: 'left',
        toNode: 'md-node-demo-bookmark-guide',
        toSide: 'right',
        direction: 'forward',
        color: '4', // 绿色
        colorHex: null,
        label: edgeLabel
    };

    // 从快捷键说明连接到永久栏目说明的演示连接线（蓝色）
    const edge2 = {
        id: 'edge-demo-2',
        fromNode: 'md-node-demo-shortcut-guide',
        fromSide: 'bottom',
        toNode: 'md-node-demo-bookmark-guide',
        toSide: 'top',
        direction: 'none',
        color: '5', // 蓝色
        colorHex: null,
        label: ''
    };

    // 从使用说明连接到多选功能说明的演示连接线（蓝色）
    const edge3 = {
        id: 'edge-demo-3',
        fromNode: 'md-node-demo-bookmark-guide',
        fromSide: 'bottom',
        toNode: 'md-node-demo-batch-feature',
        toSide: 'top',
        direction: 'none',
        color: '5', // 蓝色
        colorHex: null,
        label: ''
    };

    return {
        mdNodes: [bookmarkGuideNode, shortcutGuideNode, batchFeatureNode],
        edges: [edge1, edge2, edge3],
        mdNodeCounter: 3,
        edgeCounter: 3
    };
}

/**
 * 在当前视口中找到一个可用的位置
 * 第一个放在视口正中间，后续向右下偏移
 * @param {number} width - 新元素的宽度
 * @param {number} height - 新元素的高度
 * @returns {{x: number, y: number, needsHigherZIndex: boolean}} - 可用位置的 Canvas 坐标
 */
// 用于跟踪导入偏移的计数器
let importPositionOffset = 0;

function findAvailablePositionInViewport(width = TEMP_SECTION_DEFAULT_WIDTH, height = TEMP_SECTION_DEFAULT_HEIGHT) {
    const workspace = document.getElementById('canvasWorkspace');
    if (!workspace) {
        return { x: 100, y: 100, needsHigherZIndex: false };
    }

    const rect = workspace.getBoundingClientRect();
    const zoom = CanvasState.zoom || 1;
    const panX = CanvasState.panOffsetX || 0;
    const panY = CanvasState.panOffsetY || 0;

    // 计算当前视口中心的 Canvas 坐标
    const viewportCenterScreenX = rect.width / 2;
    const viewportCenterScreenY = rect.height / 2;
    const viewportCenterCanvasX = (viewportCenterScreenX - panX) / zoom;
    const viewportCenterCanvasY = (viewportCenterScreenY - panY) / zoom;

    // 计算新元素的位置（左上角坐标，使元素居中于视口）
    // 每次导入向右下偏移一些距离
    const offsetStep = 40;  // 每次偏移的距离
    const offsetX = importPositionOffset * offsetStep;
    const offsetY = importPositionOffset * offsetStep * 0.5;  // Y方向偏移较小

    const targetX = viewportCenterCanvasX - width / 2 + offsetX;
    const targetY = viewportCenterCanvasY - height / 2 + offsetY;

    // 更新偏移计数器（循环使用，避免偏移过大）
    importPositionOffset = (importPositionOffset + 1) % 8;

    return {
        x: targetX,
        y: targetY,
        needsHigherZIndex: true  // 所有导入的栏目都设置更高z-index，确保可见
    };
}

/**
 * 在 Canvas UI 中显示 Toast 通知
 * 显示在左上角悬浮工具窗下方
 * @param {string} message - 通知消息
 * @param {string} type - 类型：'success' | 'error' | 'info' | 'warning'
 * @param {number} duration - 显示时长（毫秒），默认 3000
 */
function showCanvasToast(message, type = 'info', duration = 3000) {
    // 移除之前的同类提示（防止堆积）
    const existingToast = document.querySelector('.canvas-toast');
    if (existingToast) {
        existingToast.remove();
    }

    // 创建新的提示
    const toast = document.createElement('div');
    toast.className = 'canvas-toast';

    // 基础样式 - 左上角，在悬浮工具窗下方
    toast.style.cssText = `
        position: fixed;
        top: 60px;
        left: 12px;
        padding: 10px 16px;
        border-radius: 8px;
        font-size: 13px;
        z-index: 100000;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
        max-width: 320px;
        word-break: break-word;
        display: flex;
        align-items: center;
        gap: 8px;
        animation: canvasToastSlideDown 0.3s ease;
        backdrop-filter: blur(8px);
    `;

    // 根据类型设置颜色和图标
    let icon = '';
    switch (type) {
        case 'success':
            toast.style.backgroundColor = 'rgba(16, 185, 129, 0.95)';
            toast.style.color = '#ffffff';
            toast.style.border = '1px solid rgba(255, 255, 255, 0.2)';
            icon = '<i class="fas fa-check-circle" style="font-size: 14px;"></i>';
            break;
        case 'error':
            toast.style.backgroundColor = 'rgba(239, 68, 68, 0.95)';
            toast.style.color = '#ffffff';
            toast.style.border = '1px solid rgba(255, 255, 255, 0.2)';
            icon = '<i class="fas fa-exclamation-circle" style="font-size: 14px;"></i>';
            break;
        case 'warning':
            toast.style.backgroundColor = 'rgba(245, 158, 11, 0.95)';
            toast.style.color = '#ffffff';
            toast.style.border = '1px solid rgba(255, 255, 255, 0.2)';
            icon = '<i class="fas fa-exclamation-triangle" style="font-size: 14px;"></i>';
            break;
        case 'info':
        default:
            toast.style.backgroundColor = 'rgba(59, 130, 246, 0.95)';
            toast.style.color = '#ffffff';
            toast.style.border = '1px solid rgba(255, 255, 255, 0.2)';
            icon = '<i class="fas fa-info-circle" style="font-size: 14px;"></i>';
            break;
    }

    toast.innerHTML = `${icon}<span>${message}</span>`;

    // 添加动画样式（如果还没有）
    if (!document.getElementById('canvas-toast-styles')) {
        const style = document.createElement('style');
        style.id = 'canvas-toast-styles';
        style.textContent = `
            @keyframes canvasToastSlideDown {
                from {
                    transform: translateY(-20px);
                    opacity: 0;
                }
                to {
                    transform: translateY(0);
                    opacity: 1;
                }
            }
            @keyframes canvasToastSlideUp {
                from {
                    transform: translateY(0);
                    opacity: 1;
                }
                to {
                    transform: translateY(-20px);
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(toast);

    // 自动移除
    setTimeout(() => {
        toast.style.animation = 'canvasToastSlideUp 0.3s ease';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 300);
    }, duration);
}

/**
 * 给元素添加呼吸式闪烁效果
 * @param {HTMLElement} element - 要添加效果的元素
 * @param {number} duration - 效果持续时间（毫秒），默认1500
 */
function pulseBreathingEffect(element, duration = 1500) {
    if (!element) return;

    // 添加呼吸动画样式（如果还没有）
    if (!document.getElementById('canvas-breathing-styles')) {
        const style = document.createElement('style');
        style.id = 'canvas-breathing-styles';
        style.textContent = `
            @keyframes canvasBreathingPulse {
                0%, 100% {
                    box-shadow: 0 0 0 0 rgba(255, 215, 0, 0.7),
                                0 4px 12px rgba(0, 0, 0, 0.15);
                    transform: scale(1);
                }
                50% {
                    box-shadow: 0 0 0 10px rgba(255, 215, 0, 0.4),
                                0 0 25px rgba(255, 215, 0, 0.5),
                                0 4px 12px rgba(0, 0, 0, 0.15);
                    transform: scale(1.01);
                }
            }
            .canvas-breathing-pulse {
                animation: canvasBreathingPulse 0.75s ease-in-out 2;
            }
        `;
        document.head.appendChild(style);
    }

    // 添加动画类
    element.classList.add('canvas-breathing-pulse');

    // 动画结束后移除类
    setTimeout(() => {
        element.classList.remove('canvas-breathing-pulse');
    }, duration);
}

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

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toAlphaLabel(n) {
    let num = parseInt(n, 10);
    if (!Number.isFinite(num) || num <= 0) return '';
    let s = '';
    while (num > 0) {
        const rem = (num - 1) % 26;
        s = String.fromCharCode(65 + rem) + s;
        num = Math.floor((num - 1) / 26);
    }
    return s;
}

function getTempSectionLabel(section) {
    if (!section) return '';
    const explicit = (typeof section.label === 'string') ? section.label.trim() : '';
    if (explicit) return explicit;
    if (section.sequenceNumber) return toAlphaLabel(section.sequenceNumber);
    return '';
}

function shouldUseWideBadge(label) {
    return typeof label === 'string' && label.includes('-');
}

function applyTempSectionBadge(badge, label) {
    if (!badge) return;
    badge.textContent = label || '';
    badge.classList.toggle('temp-node-sequence-badge-wide', shouldUseWideBadge(label));
}

function isDescendantLabel(parentLabel, candidateLabel) {
    if (!parentLabel || !candidateLabel) return false;
    if (parentLabel === candidateLabel) return false;
    const base = String(parentLabel);
    const candidate = String(candidateLabel);
    if (/\d$/.test(base)) {
        if (!candidate.startsWith(`${base}-`)) return false;
        const rest = candidate.slice(base.length + 1);
        return /^\d/.test(rest);
    }
    if (!candidate.startsWith(base)) return false;
    const rest = candidate.slice(base.length);
    return /^\d/.test(rest);
}

function getParentLabel(label) {
    const value = String(label || '').trim();
    if (!value) return '';
    const dashIndex = value.lastIndexOf('-');
    if (dashIndex > 0) {
        return value.slice(0, dashIndex);
    }
    const match = value.match(/^([A-Z]+)\d+$/);
    if (match) return match[1];
    return '';
}

function buildTempSectionLabelMap() {
    const map = new Map();
    CanvasState.tempSections.forEach(section => {
        const label = getTempSectionLabel(section);
        if (label) map.set(label, section);
    });
    return map;
}

function hasLockedAncestor(parentLabel, candidateLabel, labelMap) {
    let current = getParentLabel(candidateLabel);
    while (current) {
        if (current === parentLabel) return false;
        const section = labelMap.get(current);
        if (section && section.colorLocked) return true;
        current = getParentLabel(current);
    }
    return false;
}

function updateTempSectionColor(section, color) {
    if (!section) return;
    section.color = color || TEMP_SECTION_DEFAULT_COLOR;
    const element = document.getElementById(section.id);
    if (!element) return;
    const header = element.querySelector('.temp-node-header');
    const colorInput = element.querySelector('.temp-node-color-input');
    const colorBtn = element.querySelector('.temp-node-color-btn');
    applyTempSectionColor(section, element, header, colorBtn, colorInput);
}

function propagateTempSectionColor(parentSection, color) {
    if (!parentSection) return;
    const parentLabel = getTempSectionLabel(parentSection);
    if (!parentLabel) return;
    const labelMap = buildTempSectionLabelMap();
    CanvasState.tempSections.forEach(section => {
        if (!section || section.id === parentSection.id) return;
        const label = getTempSectionLabel(section);
        if (label && isDescendantLabel(parentLabel, label)) {
            if (section.colorLocked) return;
            if (hasLockedAncestor(parentLabel, label, labelMap)) return;
            updateTempSectionColor(section, color);
        }
    });
}

function getSplitTempSectionLabel(parentSection) {
    if (!parentSection) return '';
    let base = getTempSectionLabel(parentSection);
    if (!base) base = String(parentSection.title || '').trim();
    if (!base) return '';

    const needsDash = /\d$/.test(base);
    const separator = needsDash ? '-' : '';
    const pattern = new RegExp(`^${escapeRegExp(base)}${separator ? '\\-' : ''}(\\d+)$`);
    let maxIndex = 0;

    CanvasState.tempSections.forEach(section => {
        const label = getTempSectionLabel(section);
        if (!label) return;
        const match = label.match(pattern);
        if (match) {
            const num = parseInt(match[1], 10);
            if (Number.isFinite(num)) {
                maxIndex = Math.max(maxIndex, num);
            }
        }
    });

    return `${base}${separator}${maxIndex + 1}`;
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

    // 加载临时栏目展开状态
    loadTempExpandState();

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

    // 检测是否是来自浏览器书签侧边栏的拖拽
    const isBrowserBookmarkDrag = (e) => {
        if (!e.dataTransfer) return false;
        const types = e.dataTransfer.types || [];
        // 浏览器书签拖拽通常包含这些类型
        const hasUrl = types.includes('text/uri-list') || types.includes('text/plain');
        // 排除我们自己扩展的拖拽
        const isOurDrag = CanvasState.dragState.dragSource === 'permanent' ||
            CanvasState.dragState.dragSource === 'temporary';
        return hasUrl && !isOurDrag;
    };

    workspace.addEventListener('dragenter', (e) => {
        if (CanvasState.dragState.dragSource === 'permanent') {
            workspace.classList.add('canvas-drop-active');
        } else if (isBrowserBookmarkDrag(e)) {
            // 浏览器书签侧边栏拖入
            workspace.classList.add('canvas-drop-active', 'browser-bookmark-drop');
        }
    });

    workspace.addEventListener('dragleave', (e) => {
        if (!workspace.contains(e.relatedTarget)) {
            workspace.classList.remove('canvas-drop-active', 'browser-bookmark-drop');
        }
    });

    workspace.addEventListener('dragover', (e) => {
        if (CanvasState.dragState.dragSource === 'permanent') {
            e.preventDefault();
            try { if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; } catch (_) { }
            workspace.classList.add('canvas-drop-active');
        } else if (isBrowserBookmarkDrag(e)) {
            // 允许浏览器书签拖放
            e.preventDefault();
            try { if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; } catch (_) { }
            workspace.classList.add('canvas-drop-active', 'browser-bookmark-drop');
        }
    });

    workspace.addEventListener('drop', async (e) => {
        try { e.preventDefault(); } catch (_) { }
        workspace.classList.remove('canvas-drop-active', 'browser-bookmark-drop');

        // 检查是否是浏览器书签侧边栏拖拽
        if (isBrowserBookmarkDrag(e)) {
            await handleBrowserBookmarkDrop(e);
        }
    });
}

/**
 * 处理从浏览器书签侧边栏拖入的书签/文件夹
 */
async function handleBrowserBookmarkDrop(e) {
    const { isEn } = __getLang();
    const dataTransfer = e.dataTransfer;
    if (!dataTransfer) return;

    // 获取所有可用的拖拽数据类型
    const types = Array.from(dataTransfer.types || []);

    // 获取各种格式的数据
    let uriList = '';
    let plainText = '';
    let htmlData = '';

    try {
        uriList = dataTransfer.getData('text/uri-list') || '';
        plainText = dataTransfer.getData('text/plain') || '';
        htmlData = dataTransfer.getData('text/html') || '';
    } catch (err) {
        console.warn('[Canvas] 获取拖拽数据失败:', err);
    }

    // 解析 URL 列表（可能有多个，用换行符分隔）
    let urls = [];
    const rawUrls = (uriList || plainText || '').split(/[\r\n]+/).map(s => s.trim()).filter(s => s);
    for (const u of rawUrls) {
        if (u.match(/^(https?|ftp|file):\/\//i)) {
            urls.push(u);
        }
    }

    // 计算放置位置（Canvas 坐标）
    const workspace = document.getElementById('canvasWorkspace');
    if (!workspace) return;
    const rect = workspace.getBoundingClientRect();
    const zoom = CanvasState.zoom || 1;
    const dropX = (e.clientX - rect.left - CanvasState.panOffsetX) / zoom;
    const dropY = (e.clientY - rect.top - CanvasState.panOffsetY) / zoom;

    if (urls.length > 1) {
        // 多个 URL：文件夹拖拽，扁平展示所有书签
        console.log('[Canvas] 检测到多个 URL，扁平展示所有书签');
        await createTempNodeFromMultipleUrlsFlat(urls, dropX, dropY);
    } else if (urls.length === 1) {
        // 单个 URL：直接创建包含单个书签的临时栏目
        console.log('[Canvas] 检测到单个 URL，创建单个书签临时栏目');
        let title = '';
        if (htmlData) {
            const match = htmlData.match(/<a[^>]*>([^<]*)<\/a>/i);
            if (match && match[1]) {
                title = match[1].trim();
            }
        }
        // 尝试从书签库获取真实标题
        if (browserAPI && browserAPI.bookmarks) {
            try {
                const results = await browserAPI.bookmarks.search({ url: urls[0] });
                if (results && results.length > 0) {
                    title = results[0].title || title;
                }
            } catch (e) { }
        }
        await createTempNodeFromBrowserBookmark({
            title: title || urls[0],
            url: urls[0],
            type: 'bookmark'
        }, dropX, dropY);
    } else {
        // 没有有效 URL，尝试作为文件夹名称匹配
        const folderName = plainText.trim().split(/[\r\n]+/)[0].trim();
        if (folderName && !folderName.match(/^(https?|ftp|file):\/\//i)) {
            console.log('[Canvas] 尝试匹配文件夹:', folderName);
            await handleBrowserBookmarkFolderDrop(folderName, dropX, dropY);
        } else {
            showCanvasToast(isEn ? 'Unable to recognize dropped content' : '无法识别拖入的内容', 'warning');
        }
    }
}

/**
 * 获取书签的完整路径字符串（从根到父文件夹）
 */
async function getBookmarkPathString(folderId) {
    if (!browserAPI || !browserAPI.bookmarks || !folderId) return '';

    try {
        const pathParts = [];
        let currentId = folderId;

        // 向上遍历获取路径
        while (currentId && currentId !== '0') {
            const nodes = await browserAPI.bookmarks.get(currentId);
            if (!nodes || !nodes[0]) break;

            const node = nodes[0];
            if (node.title) {
                pathParts.unshift(node.title);
            }
            currentId = node.parentId;
        }

        return pathParts.join(' > ') || '';
    } catch (e) {
        console.warn('[Canvas] 获取书签路径失败:', e);
        return '';
    }
}

/**
 * 从多个 URL 创建临时栏目（扁平展示，不嵌套）
 */
async function createTempNodeFromMultipleUrlsFlat(urls, dropX, dropY) {
    const { isEn } = __getLang();

    if (!urls || urls.length === 0) return;

    // 收集所有书签信息，并记录第一个书签的路径
    const bookmarks = [];
    let sourcePath = '';

    for (const url of urls) {
        let title = url;
        let bookmarkPath = '';
        // 尝试从书签库获取真实标题和路径
        if (browserAPI && browserAPI.bookmarks) {
            try {
                const results = await browserAPI.bookmarks.search({ url: url });
                if (results && results.length > 0) {
                    title = results[0].title || url;
                    // 获取第一个书签的完整路径
                    if (!sourcePath && results[0].parentId) {
                        sourcePath = await getBookmarkPathString(results[0].parentId);
                    }
                }
            } catch (e) { }
        }
        bookmarks.push({
            title: title,
            url: url,
            type: 'bookmark'
        });
    }

    // 生成标题：时间 + 书签数量 + 来源说明
    const now = new Date();
    const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const dateStr = now.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
    const sourceInfo = isEn
        ? `${dateStr} ${timeStr} | ${bookmarks.length} bookmarks | Browser drop`
        : `${dateStr} ${timeStr} | ${bookmarks.length}个书签 | 浏览器拖入`;

    // 生成说明：书签路径
    const description = sourcePath
        ? (isEn ? `Source: ${sourcePath}` : `来源路径：${sourcePath}`)
        : '';

    // 创建临时栏目
    const sectionId = `temp-section-${++CanvasState.tempSectionCounter}`;
    const section = {
        id: sectionId,
        title: sourceInfo,
        description: description,  // 添加说明
        label: isEn ? 'Drop' : '拖入',  // 左边标签：拖入
        color: pickTempSectionColor(),
        x: dropX,
        y: dropY,
        width: TEMP_SECTION_DEFAULT_WIDTH,
        height: TEMP_SECTION_DEFAULT_HEIGHT,
        createdAt: Date.now(),
        source: 'browser-drop',  // 标记来源
        items: bookmarks.map((bm, index) => ({
            id: `temp-${sectionId}-${++CanvasState.tempItemCounter}`,
            sectionId: sectionId,
            title: bm.title,
            url: bm.url,
            type: 'bookmark',
            children: [],
            createdAt: Date.now()
        }))
    };

    CanvasState.tempSections.push(section);
    renderTempNode(section);

    // 设置更高的 z-index 和呼吸效果
    const nodeElement = document.getElementById(section.id);
    if (nodeElement) {
        nodeElement.style.zIndex = '500';
        pulseBreathingEffect(nodeElement, 1500);
    }

    saveTempNodes();

    // 显示提示，说明浏览器限制
    showCanvasToast(
        isEn
            ? `Created section with ${bookmarks.length} bookmarks. Note: Due to browser limitations, folder structure cannot be preserved.`
            : `已创建临时栏目，包含 ${bookmarks.length} 个书签。提示：由于浏览器限制，无法保留文件夹层级结构。`,
        'info',
        4000  // 显示 4 秒
    );
}

/**
 * 处理单个 URL 的拖放：查找父文件夹，智能判断是否导入整个文件夹
 */
async function handleSingleUrlDrop(url, htmlData, dropX, dropY) {
    const { isEn } = __getLang();

    // 从 HTML 获取标题
    let title = '';
    if (htmlData) {
        const match = htmlData.match(/<a[^>]*>([^<]*)<\/a>/i);
        if (match && match[1]) {
            title = match[1].trim();
        }
    }

    // 尝试在书签库中找到这个 URL
    if (browserAPI && browserAPI.bookmarks) {
        try {
            const results = await browserAPI.bookmarks.search({ url: url });
            if (results && results.length > 0) {
                const bookmark = results[0];
                let parentId = String(bookmark.parentId); // 确保是字符串

                console.log('[Canvas] 书签 parentId:', parentId, '类型:', typeof bookmark.parentId);

                // 根级文件夹的 ID（不应该导入整个根文件夹）
                const rootFolderIds = ['0', '1', '2']; // 0=root, 1=Bookmarks Bar, 2=Other Bookmarks
                const isRootFolder = rootFolderIds.includes(parentId);

                // 获取父文件夹信息
                if (parentId) {
                    const parents = await browserAPI.bookmarks.get(parentId);
                    if (parents && parents[0] && !parents[0].url) {
                        const parentFolder = parents[0];
                        const folderTitle = parentFolder.title || '';

                        // 根级文件夹名称列表（不应该导入整个根文件夹）
                        const rootFolderNames = [
                            'Bookmarks Bar', '书签栏', 'Bookmark Bar',
                            'Other Bookmarks', '其他书签', 'Other bookmarks',
                            'Mobile Bookmarks', '移动设备书签', 'Mobile bookmarks',
                            'Bookmarks', '书签'
                        ];
                        const isRootFolder = rootFolderNames.some(name =>
                            folderTitle.toLowerCase() === name.toLowerCase()
                        );

                        console.log('[Canvas] 父文件夹:', folderTitle, 'ID:', parentId, '是根文件夹:', isRootFolder);

                        if (isRootFolder) {
                            // 书签直接位于根文件夹下，创建单个书签
                            console.log('[Canvas] 书签位于根文件夹下，直接创建单个书签');
                        } else {
                            // 获取父文件夹内的直接子项数量
                            const children = await browserAPI.bookmarks.getChildren(parentId);
                            const directChildCount = children ? children.length : 0;

                            console.log('[Canvas] 普通文件夹，直接子项数量:', directChildCount);

                            // 如果父文件夹有多个子项，说明用户拖动的是文件夹，自动导入整个文件夹
                            if (directChildCount > 1) {
                                console.log('[Canvas] 检测到不完整的文件夹拖拽，自动导入整个文件夹');
                                await createTempNodeFromBookmarkFolder(parentFolder, dropX, dropY);
                                return;
                            }
                            // 父文件夹只有一个书签，直接创建单个书签
                        }
                    }
                }
            }
        } catch (error) {
            console.warn('[Canvas] 查找书签失败:', error);
        }
    }

    // 如果无法找到父文件夹，或父文件夹只有一个书签，直接创建单个书签的临时栏目
    await createTempNodeFromBrowserBookmark({
        title: title || url,
        url: url,
        type: 'bookmark'
    }, dropX, dropY);
}

/**
 * 显示导入选择对话框：让用户选择导入单个书签还是整个文件夹
 */
async function showImportChoiceDialog(bookmark, parentFolder, dropX, dropY) {
    const { isEn } = __getLang();

    // 移除已有的对话框
    const existingDialog = document.getElementById('importChoiceDialog');
    if (existingDialog) existingDialog.remove();

    // 获取文件夹内的书签数量
    let folderBookmarkCount = 0;
    try {
        const subTree = await browserAPI.bookmarks.getSubTree(parentFolder.id);
        if (subTree && subTree[0]) {
            const countBookmarks = (node) => {
                let count = 0;
                if (node.url) count = 1;
                if (node.children) {
                    for (const child of node.children) {
                        count += countBookmarks(child);
                    }
                }
                return count;
            };
            folderBookmarkCount = countBookmarks(subTree[0]);
        }
    } catch (e) { }

    // 创建对话框
    const dialog = document.createElement('div');
    dialog.id = 'importChoiceDialog';
    dialog.className = 'import-dialog';
    dialog.innerHTML = `
        <div class="import-dialog-content" style="max-width: 420px;">
            <div class="import-dialog-header">
                <h3>${isEn ? 'Import Options' : '导入选项'}</h3>
                <button class="import-dialog-close">&times;</button>
            </div>
            <div class="import-dialog-body">
                <p style="margin-bottom: 16px; color: var(--text-secondary);">
                    ${isEn
            ? `This bookmark is in folder "${parentFolder.title}". What would you like to import?`
            : `此书签位于文件夹「${parentFolder.title}」中，您要导入什么？`}
                </p>
                <div class="import-options">
                    <button class="import-option-btn" id="importSingleBtn">
                        <i class="fas fa-bookmark" style="color: var(--accent-primary);"></i>
                        <div style="flex: 1; text-align: left;">
                            <div style="font-weight: 600;">${isEn ? 'Single Bookmark' : '单个书签'}</div>
                            <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">
                                ${bookmark.title || bookmark.url}
                            </div>
                        </div>
                    </button>
                    <button class="import-option-btn" id="importFolderBtn">
                        <i class="fas fa-folder" style="color: var(--warning);"></i>
                        <div style="flex: 1; text-align: left;">
                            <div style="font-weight: 600;">${isEn ? 'Entire Folder' : '整个文件夹'}</div>
                            <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">
                                ${parentFolder.title} (${folderBookmarkCount} ${isEn ? 'bookmarks' : '个书签'})
                            </div>
                        </div>
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(dialog);

    // 绑定事件
    dialog.querySelector('.import-dialog-close').onclick = () => dialog.remove();
    dialog.onclick = (e) => {
        if (e.target === dialog) dialog.remove();
    };

    dialog.querySelector('#importSingleBtn').onclick = async () => {
        dialog.remove();
        await createTempNodeFromBrowserBookmark({
            title: bookmark.title || bookmark.url,
            url: bookmark.url,
            type: 'bookmark'
        }, dropX, dropY);
    };

    dialog.querySelector('#importFolderBtn').onclick = async () => {
        dialog.remove();
        await createTempNodeFromBookmarkFolder(parentFolder, dropX, dropY);
    };
}

/**
 * 获取书签的祖先路径（从根到当前节点的 ID 列表）
 */
async function getBookmarkAncestorPath(bookmarkId) {
    const path = [];
    let currentId = bookmarkId;

    try {
        while (currentId && currentId !== '0') {
            path.unshift(currentId);
            const nodes = await browserAPI.bookmarks.get(currentId);
            if (nodes && nodes[0] && nodes[0].parentId) {
                currentId = nodes[0].parentId;
            } else {
                break;
            }
        }
    } catch (e) {
        console.warn('[Canvas] 获取书签祖先路径失败:', e);
    }

    return path;
}

/**
 * 找到多个路径的最近公共祖先
 * @param {Array<Array<string>>} paths - 多个祖先路径数组
 * @returns {string|null} - 最近公共祖先的 ID
 */
function findLowestCommonAncestor(paths) {
    if (!paths || paths.length === 0) return null;
    if (paths.length === 1) {
        // 单个路径，返回倒数第二个（父文件夹）
        return paths[0].length > 1 ? paths[0][paths[0].length - 2] : null;
    }

    // 找到最短路径长度
    const minLen = Math.min(...paths.map(p => p.length));

    // 从根开始，找最后一个共同的祖先
    let lcaIndex = -1;
    for (let i = 0; i < minLen; i++) {
        const id = paths[0][i];
        if (paths.every(p => p[i] === id)) {
            lcaIndex = i;
        } else {
            break;
        }
    }

    return lcaIndex >= 0 ? paths[0][lcaIndex] : null;
}

/**
 * 从多个 URL 创建临时栏目（文件夹拖拽）
 * 通过书签 API 搜索匹配的书签来获取原始标题和文件夹结构
 */
async function createTempNodeFromMultipleUrls(urls, dropX, dropY) {
    const { isEn } = __getLang();

    if (!urls || urls.length === 0) return;

    // 使用书签 API 搜索每个 URL 对应的书签
    let bookmarks = [];
    let commonParentId = null;
    let commonParentTitle = null;

    if (browserAPI && browserAPI.bookmarks) {
        try {
            // 获取每个 URL 对应的书签及其祖先路径
            const bookmarkInfos = [];

            for (const url of urls) {
                const results = await browserAPI.bookmarks.search({ url: url });
                if (results && results.length > 0) {
                    const bm = results[0];
                    // 获取这个书签的祖先路径
                    const ancestors = await getBookmarkAncestorPath(bm.id);
                    bookmarkInfos.push({
                        bookmark: bm,
                        ancestors: ancestors // 从根到当前的 ID 路径
                    });
                }
            }

            console.log('[Canvas] 书签信息:', bookmarkInfos.length, '个');

            // 如果成功获取了所有书签信息，找最近公共祖先
            if (bookmarkInfos.length === urls.length && bookmarkInfos.length > 0) {
                // 找到最近公共祖先（LCA）
                const lcaId = findLowestCommonAncestor(bookmarkInfos.map(info => info.ancestors));

                if (lcaId && lcaId !== '0' && lcaId !== '1' && lcaId !== '2') {
                    console.log('[Canvas] 找到最近公共祖先:', lcaId);
                    const folder = await browserAPI.bookmarks.get(lcaId);
                    if (folder && folder[0] && !folder[0].url) {
                        // 确认是文件夹，使用 createTempNodeFromBookmarkFolder
                        await createTempNodeFromBookmarkFolder(folder[0], dropX, dropY);
                        return; // 已完成，直接返回
                    }
                }
            }

            // 如果无法确定公共祖先，逐个收集书签信息
            for (const info of bookmarkInfos) {
                bookmarks.push({
                    title: info.bookmark.title || info.bookmark.url,
                    url: info.bookmark.url,
                    parentId: info.bookmark.parentId
                });
            }

            // 补充未找到的 URL
            if (bookmarks.length < urls.length) {
                for (const url of urls) {
                    if (!bookmarks.find(b => b.url === url)) {
                        bookmarks.push({ title: url, url: url, parentId: null });
                    }
                }
            }
        } catch (error) {
            console.warn('[Canvas] 搜索书签失败，使用 URL 作为标题:', error);
        }
    }

    // 如果书签 API 搜索失败或未启用，使用 URL 提取标题
    if (bookmarks.length === 0) {
        for (const url of urls) {
            let title = url;
            try {
                const urlObj = new URL(url);
                const pathParts = urlObj.pathname.split('/').filter(p => p);
                if (pathParts.length > 0) {
                    title = decodeURIComponent(pathParts[pathParts.length - 1]) || urlObj.hostname;
                } else {
                    title = urlObj.hostname;
                }
            } catch (e) { }
            bookmarks.push({ title, url, parentId: null });
        }
    }

    // 创建临时栏目
    const sectionId = `temp-section-${++CanvasState.tempSectionCounter}`;
    const items = [];

    for (const bm of bookmarks) {
        items.push({
            id: `temp-${sectionId}-${++CanvasState.tempItemCounter}`,
            sectionId: sectionId,
            title: bm.title,
            url: bm.url,
            type: 'bookmark',
            children: [],
            createdAt: Date.now()
        });
    }

    // 使用默认标题格式
    const sequenceNumber = ++CanvasState.tempSectionSequenceNumber;

    const section = {
        id: sectionId,
        title: getDefaultTempSectionTitle(),
        sequenceNumber: sequenceNumber,
        color: pickTempSectionColor(),
        x: dropX,
        y: dropY,
        width: TEMP_SECTION_DEFAULT_WIDTH,
        height: TEMP_SECTION_DEFAULT_HEIGHT,
        createdAt: Date.now(),
        items: items
    };

    CanvasState.tempSections.push(section);
    renderTempNode(section);

    // 设置更高的 z-index 和呼吸效果
    const nodeElement = document.getElementById(section.id);
    if (nodeElement) {
        nodeElement.style.zIndex = '500';
        pulseBreathingEffect(nodeElement, 1500);
    }

    saveTempNodes();

    const message = commonParentTitle
        ? (isEn ? `Imported folder "${commonParentTitle}" with ${items.length} bookmarks`
            : `已导入文件夹「${commonParentTitle}」，共 ${items.length} 个书签`)
        : (isEn ? `Created temporary section with ${items.length} bookmarks`
            : `已创建临时栏目，包含 ${items.length} 个书签`);
    showCanvasToast(message, 'success');
}

/**
 * 处理文件夹拖拽：通过标题匹配永久栏目中的文件夹
 */
async function handleBrowserBookmarkFolderDrop(folderTitle, dropX, dropY) {
    const { isEn } = __getLang();

    if (!browserAPI || !browserAPI.bookmarks) {
        showCanvasToast(isEn ? 'Bookmarks API not available' : '书签API不可用', 'error');
        return;
    }

    try {
        // 搜索匹配标题的书签节点
        const results = await browserAPI.bookmarks.search({ title: folderTitle });

        // 过滤出文件夹（没有 url 的节点是文件夹）
        const folders = results.filter(node => !node.url);

        if (folders.length === 0) {
            showCanvasToast(
                isEn ? `Folder "${folderTitle}" not found` : `未找到文件夹「${folderTitle}」`,
                'warning'
            );
            return;
        }

        if (folders.length === 1) {
            // 唯一匹配，直接获取内容并创建临时栏目
            await createTempNodeFromBookmarkFolder(folders[0], dropX, dropY);
        } else {
            // 多个匹配，让用户选择
            await showFolderSelectionDialog(folders, dropX, dropY);
        }
    } catch (error) {
        console.error('[Canvas] 搜索书签文件夹失败:', error);
        showCanvasToast(
            isEn ? 'Failed to search bookmark folder' : '搜索书签文件夹失败',
            'error'
        );
    }
}

/**
 * 从书签文件夹创建临时栏目
 */
async function createTempNodeFromBookmarkFolder(folder, dropX, dropY) {
    const { isEn } = __getLang();

    if (!browserAPI || !browserAPI.bookmarks) return;

    try {
        // 获取文件夹的完整子树
        const subTree = await browserAPI.bookmarks.getSubTree(folder.id);
        if (!subTree || !subTree[0]) {
            showCanvasToast(isEn ? 'Folder is empty' : '文件夹为空', 'warning');
            return;
        }

        const folderNode = subTree[0];
        const children = folderNode.children || [];

        if (children.length === 0) {
            showCanvasToast(isEn ? 'Folder is empty' : '文件夹为空', 'warning');
            return;
        }

        // 计算书签总数
        const countBookmarks = (nodes) => {
            let count = 0;
            for (const node of nodes) {
                if (node.url) count++;
                if (node.children) count += countBookmarks(node.children);
            }
            return count;
        };
        const totalCount = countBookmarks(children);

        // 创建临时栏目（使用默认标题格式）
        const sectionId = `temp-section-${++CanvasState.tempSectionCounter}`;
        const sequenceNumber = ++CanvasState.tempSectionSequenceNumber;
        const section = {
            id: sectionId,
            title: getDefaultTempSectionTitle(),
            sequenceNumber: sequenceNumber,
            color: pickTempSectionColor(),
            x: dropX,
            y: dropY,
            width: TEMP_SECTION_DEFAULT_WIDTH,
            height: TEMP_SECTION_DEFAULT_HEIGHT,
            createdAt: Date.now(),
            items: []
        };

        // 递归转换为临时栏目格式
        const convertToTempItem = (node) => {
            const item = {
                id: `temp-${sectionId}-${++CanvasState.tempItemCounter}`,
                sectionId: sectionId,
                title: node.title || (node.url ? (isEn ? 'Untitled' : '未命名') : (isEn ? 'Folder' : '文件夹')),
                url: node.url || '',
                type: node.url ? 'bookmark' : 'folder',
                children: [],
                createdAt: Date.now()
            };

            if (node.children && Array.isArray(node.children)) {
                item.children = node.children.map(convertToTempItem).filter(Boolean);
            }

            return item;
        };

        // 将整个文件夹作为一个顶层项放入临时栏目（保留完整层次结构）
        const folderItem = convertToTempItem(folderNode);
        section.items = [folderItem];

        // 调试：打印创建的数据结构
        console.log('[Canvas] 创建的临时栏目数据结构:', JSON.stringify(section, null, 2).substring(0, 2000));
        console.log('[Canvas] 顶层项类型:', folderItem.type, '子项数量:', folderItem.children?.length);

        CanvasState.tempSections.push(section);
        renderTempNode(section);

        // 设置更高的 z-index
        const nodeElement = document.getElementById(section.id);
        if (nodeElement) {
            nodeElement.style.zIndex = '500';
            pulseBreathingEffect(nodeElement, 1500);
        }

        saveTempNodes();

        showCanvasToast(
            isEn ? `Imported folder "${folderNode.title}" with ${totalCount} bookmarks`
                : `已导入文件夹「${folderNode.title}」，共 ${totalCount} 个书签`,
            'success'
        );
    } catch (error) {
        console.error('[Canvas] 创建临时栏目失败:', error);
        showCanvasToast(isEn ? 'Failed to import folder' : '导入文件夹失败', 'error');
    }
}

/**
 * 从单个书签创建临时栏目
 */
async function createTempNodeFromBrowserBookmark(bookmark, dropX, dropY) {
    const { isEn } = __getLang();

    // 获取书签的路径
    let sourcePath = '';
    if (browserAPI && browserAPI.bookmarks && bookmark.url) {
        try {
            const results = await browserAPI.bookmarks.search({ url: bookmark.url });
            if (results && results.length > 0 && results[0].parentId) {
                sourcePath = await getBookmarkPathString(results[0].parentId);
            }
        } catch (e) { }
    }

    // 生成标题：时间 + 书签数量 + 来源说明
    const now = new Date();
    const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const dateStr = now.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
    const sourceInfo = isEn
        ? `${dateStr} ${timeStr} | 1 bookmark | Browser drop`
        : `${dateStr} ${timeStr} | 1个书签 | 浏览器拖入`;

    // 生成说明：书签路径
    const description = sourcePath
        ? (isEn ? `Source: ${sourcePath}` : `来源路径：${sourcePath}`)
        : '';

    const sectionId = `temp-section-${++CanvasState.tempSectionCounter}`;
    const section = {
        id: sectionId,
        title: sourceInfo,
        description: description,  // 添加说明
        label: isEn ? 'Drop' : '拖入',  // 左边标签：拖入
        color: pickTempSectionColor(),
        x: dropX,
        y: dropY,
        width: TEMP_SECTION_DEFAULT_WIDTH,
        height: TEMP_SECTION_DEFAULT_HEIGHT,
        createdAt: Date.now(),
        source: 'browser-drop',  // 标记来源
        items: [{
            id: `temp-${sectionId}-${++CanvasState.tempItemCounter}`,
            sectionId: sectionId,
            title: bookmark.title || bookmark.url,
            url: bookmark.url || '',
            type: 'bookmark',
            children: [],
            createdAt: Date.now()
        }]
    };

    CanvasState.tempSections.push(section);
    renderTempNode(section);

    // 设置更高的 z-index
    const nodeElement = document.getElementById(section.id);
    if (nodeElement) {
        nodeElement.style.zIndex = '500';
        pulseBreathingEffect(nodeElement, 1500);
    }

    saveTempNodes();

    showCanvasToast(
        isEn ? 'Created temporary section with 1 bookmark' : '已创建临时栏目，包含 1 个书签',
        'success'
    );
}

/**
 * 显示文件夹选择对话框（当有多个同名文件夹时）
 */
async function showFolderSelectionDialog(folders, dropX, dropY) {
    const { isEn } = __getLang();

    // 移除已有的对话框
    const existingDialog = document.getElementById('folderSelectionDialog');
    if (existingDialog) existingDialog.remove();

    // 获取每个文件夹的路径信息
    const foldersWithPath = await Promise.all(folders.map(async (folder) => {
        let path = folder.title;
        try {
            // 获取父文件夹路径
            let current = folder;
            const pathParts = [folder.title];
            while (current.parentId && current.parentId !== '0') {
                const parents = await browserAPI.bookmarks.get(current.parentId);
                if (parents && parents[0]) {
                    pathParts.unshift(parents[0].title || '');
                    current = parents[0];
                } else {
                    break;
                }
            }
            path = pathParts.filter(p => p).join(' / ');
        } catch (e) {
            console.warn('[Canvas] 获取文件夹路径失败:', e);
        }
        return { ...folder, path };
    }));

    // 创建对话框
    const dialog = document.createElement('div');
    dialog.id = 'folderSelectionDialog';
    dialog.className = 'import-dialog';
    dialog.innerHTML = `
        <div class="import-dialog-content" style="max-width: 500px;">
            <div class="import-dialog-header">
                <h3>${isEn ? 'Multiple folders found' : '找到多个同名文件夹'}</h3>
                <button class="import-dialog-close">&times;</button>
            </div>
            <div class="import-dialog-body">
                <p style="margin-bottom: 16px; color: var(--text-secondary);">
                    ${isEn ? 'Please select the folder you want to import:' : '请选择要导入的文件夹：'}
                </p>
                <div class="import-options">
                    ${foldersWithPath.map((folder, index) => `
                        <button class="import-option-btn folder-select-btn" data-index="${index}">
                            <i class="fas fa-folder" style="color: var(--warning);"></i>
                            <div style="flex: 1; text-align: left;">
                                <div style="font-weight: 600;">${folder.title}</div>
                                <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">
                                    ${folder.path}
                                </div>
                            </div>
                        </button>
                    `).join('')}
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(dialog);

    // 绑定事件
    dialog.querySelector('.import-dialog-close').onclick = () => dialog.remove();
    dialog.onclick = (e) => {
        if (e.target === dialog) dialog.remove();
    };

    dialog.querySelectorAll('.folder-select-btn').forEach(btn => {
        btn.onclick = async () => {
            const index = parseInt(btn.dataset.index, 10);
            const selectedFolder = folders[index];
            dialog.remove();
            await createTempNodeFromBookmarkFolder(selectedFolder, dropX, dropY);
        };
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

    // 性能优化：使用事件委托，避免给海量 tree-item 逐个绑定 dragstart/dragend
    if (bookmarkTree.dataset.canvasDragDelegated === 'true') return;
    bookmarkTree.dataset.canvasDragDelegated = 'true';

    const onDragStart = (e) => {
        const item = e && e.target && e.target.closest ? e.target.closest('.tree-item[data-node-id]') : null;
        if (!item) return;

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

        // 启用拖动时的滚轮滚动功能
        CanvasState.dragState.wheelScrollEnabled = true;

        // 设置拖拽数据（供外部系统识别）
        try {
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'copyMove';
                e.dataTransfer.setData('application/json', JSON.stringify({
                    id: nodeId,
                    title: nodeTitle,
                    url: nodeUrl,
                    type: isFolder ? 'folder' : 'bookmark'
                }));
            }
        } catch (err) {
            console.warn('[Canvas] 设置拖拽数据失败:', err);
        }

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
                } catch (_) { }
                const preview = document.createElement('div');
                preview.className = 'drag-preview';
                preview.textContent = previewText || '';
                preview.style.left = '-9999px';
                document.body.appendChild(preview);
                e.dataTransfer.setDragImage(preview, 0, 0);
                setTimeout(() => preview.remove(), 0);
            }
        } catch (_) { }
    };

    const onDragEnd = async (e) => {
        if (CanvasState.dragState.dragSource !== 'permanent') return;

        // 禁用拖动时的滚轮滚动功能
        CanvasState.dragState.wheelScrollEnabled = false;

        // 防重复：检查是否正在创建或者时间间隔太短
        const now = Date.now();
        if (CanvasState.isCreatingTempNode || (now - CanvasState.lastDragEndTime < 300)) {
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
                accepted = true;
            } else if (tempNode || tempTree) {
                accepted = true;
            } else {
                // 拖到空白区域，创建新临时栏目
                const canvasX = (dropX - rect.left - CanvasState.panOffsetX) / CanvasState.zoom;
                const canvasY = (dropY - rect.top - CanvasState.panOffsetY) / CanvasState.zoom;

                // 在Canvas上创建临时节点（支持多选合集）
                if (CanvasState.dragState.draggedData) {
                    try {
                        // 标记正在创建，防止重复
                        CanvasState.isCreatingTempNode = true;
                        CanvasState.lastDragEndTime = now;

                        let ids = [];
                        try {
                            ids = collectPermanentSelectionIds(CanvasState.dragState.draggedData.id || null) || [];
                        } catch (_) { }
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
    };

    // 使用捕获阶段确保不被子模块 stopPropagation 影响，但不阻断原事件链
    bookmarkTree.addEventListener('dragstart', onDragStart, true);
    bookmarkTree.addEventListener('dragend', (e) => { onDragEnd(e); }, true);

    console.log('[Canvas] 已为书签树启用委托拖拽支持');
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
    // 不再需要 onerror，全局事件处理器会处理

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

    // 加载保存的快捷键设置（必须在事件处理器注册之前）
    loadCanvasShortcuts();

    // 加载保存的缩放级别
    loadCanvasZoom();
    setupCanvasFullscreenControls();

    // Ctrl + 滚轮缩放（以鼠标位置为中心）- 性能优化版本
    workspace.addEventListener('wheel', (e) => {
        // 拖动时的滚轮滚动功能：
        // - 触控板双指滑动：四向自由滚动（横向 + 纵向同时支持）
        // - 鼠标滚轮：纵向滚动
        // - Shift + 鼠标滚轮：横向滚动
        // 拖动的元素会悬停在更高层级，滚轮滚动画布，松开后元素落下归位
        if (CanvasState.dragState.wheelScrollEnabled) {
            e.preventDefault();

            // 标记正在滚动
            markScrolling();

            // 检测是否为触控板
            const isTouchpad = (Math.abs(e.deltaY) < 50 || Math.abs(e.deltaX) < 50) && e.deltaMode === 0;

            // 滚动系数 - 根据缩放比例动态调整
            let scrollFactor = 1.0 / (CanvasState.zoom || 1);

            // 根据缩放比例动态调整基础系数，让不同缩放级别下的滚动感觉更一致
            const zoomAdjustment = Math.pow(CanvasState.zoom || 1, 0.3); // 使用较小的指数，减少缩放对速率的影响
            scrollFactor *= zoomAdjustment;

            if (isTouchpad) {
                scrollFactor *= 0.7; // 触控板降低灵敏度（从1.4降到0.7）
            } else {
                scrollFactor *= 0.8; // 鼠标滚轮也稍微降低一点灵敏度
            }

            const prevPanX = CanvasState.panOffsetX;
            const prevPanY = CanvasState.panOffsetY;
            let hasUpdate = false;

            // 触控板：同时支持横向和纵向，实现四向自由滚动
            if (isTouchpad) {
                if (e.deltaX !== 0) {
                    CanvasState.panOffsetX -= e.deltaX * scrollFactor;
                    hasUpdate = true;
                }
                if (e.deltaY !== 0) {
                    CanvasState.panOffsetY -= e.deltaY * scrollFactor;
                    hasUpdate = true;
                }
            } else {
                // 鼠标滚轮
                if (e.shiftKey) {
                    // Shift + 滚轮：横向滚动
                    const horizontalDelta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
                    if (horizontalDelta !== 0) {
                        CanvasState.panOffsetX -= horizontalDelta * scrollFactor;
                        hasUpdate = true;
                    }
                } else {
                    // 普通滚轮：纵向滚动
                    if (e.deltaY !== 0) {
                        CanvasState.panOffsetY -= e.deltaY * scrollFactor;
                        hasUpdate = true;
                    }
                }
            }

            if (hasUpdate) {
                const panDeltaX = CanvasState.panOffsetX - prevPanX;
                const panDeltaY = CanvasState.panOffsetY - prevPanY;
                if ((panDeltaX || panDeltaY) && (CanvasState.dragState.dragSource === 'temp-node' || CanvasState.dragState.dragSource === 'permanent-section')) {
                    adjustDragReferenceForPan(panDeltaX, panDeltaY, e.clientX, e.clientY);
                }
                applyPanOffsetFast();

                // 拖动时也实时更新滚动条
                updateScrollbarThumbsLightweight();
            }

            return;
        }

        if (isCustomCtrlKeyPressed(e) || e.metaKey) {
            e.preventDefault();

            // [OPT] 缩放开始：进入高性能模式
            workspace.classList.add('is-zooming');

            // 清除之前的定时器
            if (workspace._zoomEndTimer) clearTimeout(workspace._zoomEndTimer);

            // 设置新的结束检测（延长至 400ms，防止滚轮间隙导致频繁的状态切换重排）
            workspace._zoomEndTimer = setTimeout(() => {
                workspace.classList.remove('is-zooming');
            }, 400);

            // 标记正在滚动
            markScrolling();

            // 获取鼠标在viewport中的位置
            const rect = workspace.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            // [FIX] 移除不稳定的阈值判断 (delta < 50)，防止快速滑动时系数突变导致的顿挫
            const zoomSpeed = 0.001;

            // Shift+滚轮在某些浏览器会变成横向滚动，需要使用 deltaX 或 deltaY
            const delta = e.deltaY !== 0 ? -e.deltaY : -e.deltaX;

            // [FIX] 核心修复：消除“钝感”和“阶梯感”
            // 如果有 pendingZoomRequest，说明上一帧的缩放还没渲染出来。
            // 此时必须基于 pending 的目标值继续累积，否则中间的高频滚动事件会被丢弃（因为 CanvasState.zoom 没变）。
            const baseZoomForCalc = pendingZoomRequest ? pendingZoomRequest.zoom : CanvasState.zoom;

            // 计算缩放因子：delta > 0 放大，delta < 0 缩小
            // 使用 Math.exp 实现指数缩放，确保放大和缩小是对称的
            const zoomFactor = Math.exp(delta * zoomSpeed);
            let newZoom = baseZoomForCalc * zoomFactor;

            newZoom = Math.max(0.1, Math.min(3, newZoom));

            // 使用优化的缩放更新，滚动时跳过边界计算
            scheduleZoomUpdate(newZoom, mouseX, mouseY, { recomputeBounds: false, skipSave: false, skipScrollbarUpdate: true });
        } else if (shouldHandleCustomScroll(e)) {
            handleCanvasCustomScroll(e);
        }
    }, { passive: false });

    // 空格键/Control键按下 - 启用拖动模式（支持自定义快捷键）
    // 快捷键检测辅助函数
    const MODIFIER_KEY_CODES = {
        'Control': ['ControlLeft', 'ControlRight'],
        'Alt': ['AltLeft', 'AltRight'],
        'Shift': ['ShiftLeft', 'ShiftRight'],
        'Meta': ['MetaLeft', 'MetaRight']
    };

    function isCustomCtrlKeyCode(code) {
        const key = canvasShortcuts.ctrlKey;
        const codes = MODIFIER_KEY_CODES[key];
        // 修饰键匹配左右键
        if (codes) return codes.includes(code);
        // 普通键直接匹配
        return code === key;
    }

    function isCustomSpaceKeyCode(code) {
        const key = canvasShortcuts.spaceKey;
        const codes = MODIFIER_KEY_CODES[key];
        // 修饰键匹配左右键
        if (codes) return codes.includes(code);
        // 普通键直接匹配
        return code === key;
    }

    document.addEventListener('keydown', (e) => {
        if (isRecordingShortcut) return;
        if (e.repeat || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        // 在 contenteditable 元素内编辑时不拦截键盘事件（允许输入空格等）
        if (e.target.isContentEditable || e.target.closest('[contenteditable="true"]')) return;

        if (isCustomSpaceKeyCode(e.code)) {
            e.preventDefault();
            CanvasState.isSpacePressed = true;
            workspace.classList.add('space-pressed');
        }
        if (isCustomCtrlKeyCode(e.code)) {
            CanvasState.isCtrlPressed = true;
            workspace.classList.add('ctrl-pressed');
            // 延迟激活栏目操作蒙版，避免影响拖动性能
            requestAnimationFrame(() => setSectionCtrlModeActive(true));
        }
    });

    document.addEventListener('keyup', (e) => {
        if (isCustomSpaceKeyCode(e.code)) {
            CanvasState.isSpacePressed = false;
            workspace.classList.remove('space-pressed');
            if (CanvasState.isPanning) {
                CanvasState.isPanning = false;
                workspace.classList.remove('panning');
                onScrollStop();
                savePanOffsetThrottled();
            }
        }
        if (isCustomCtrlKeyCode(e.code)) {
            CanvasState.isCtrlPressed = false;
            workspace.classList.remove('ctrl-pressed');
            // 延迟停用栏目操作蒙版
            requestAnimationFrame(() => setSectionCtrlModeActive(false));
            if (CanvasState.isPanning) {
                CanvasState.isPanning = false;
                workspace.classList.remove('panning');
                onScrollStop();
                savePanOffsetThrottled();
            }
        }
    });

    // 空格/Control + 鼠标拖动画布（Obsidian方式）
    workspace.addEventListener('mousedown', (e) => {
        if (CanvasState.isSpacePressed || CanvasState.isCtrlPressed) {
            e.preventDefault();
            e.stopPropagation();
            CanvasState.isPanning = true;
            CanvasState.panStartX = e.clientX - CanvasState.panOffsetX;
            CanvasState.panStartY = e.clientY - CanvasState.panOffsetY;
            workspace.classList.add('panning');
            // 标记正在拖动/滚动
            markScrolling();
        }
    });

    // Control键按下时屏蔽右键菜单，避免干扰拖动
    workspace.addEventListener('contextmenu', (e) => {
        if (CanvasState.isCtrlPressed || CanvasState.isPanning) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);

    document.addEventListener('mousemove', (e) => {
        if (CanvasState.isPanning) {
            // 标记正在拖动/滚动
            markScrolling();

            CanvasState.panOffsetX = e.clientX - CanvasState.panStartX;
            CanvasState.panOffsetY = e.clientY - CanvasState.panStartY;

            // 使用极速平移（降低渲染频率）
            applyPanOffsetFast();

            // 实时更新滚动条位置
            updateScrollbarThumbsLightweight();
        }
    });

    document.addEventListener('mouseup', () => {
        if (CanvasState.isPanning) {
            CanvasState.isPanning = false;
            workspace.classList.remove('panning');

            // 拖动停止后，触发完整更新
            onScrollStop();
            savePanOffsetThrottled();
        }
    });

    // 缩放按钮
    const zoomInBtn = document.getElementById('zoomInBtn');
    const zoomOutBtn = document.getElementById('zoomOutBtn');
    const zoomLocateBtn = document.getElementById('zoomLocateBtn');

    // [OPT] 优化缩放手感：添加平滑动画，使用 1.2 倍指数缩放
    const animateZoomStep = (factor) => {
        const content = document.getElementById('canvasContent');
        if (content) {
            content.classList.add('animate-zoom');
            setTimeout(() => content.classList.remove('animate-zoom'), 300);
        }
        setCanvasZoom(CanvasState.zoom * factor);
    };

    if (zoomInBtn) zoomInBtn.addEventListener('click', () => animateZoomStep(1.2));
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => animateZoomStep(1 / 1.2));
    if (zoomLocateBtn) zoomLocateBtn.addEventListener('click', locateToPermanentSection);

    // [Fix] 窗口大小改变时，重新计算可视区域休眠状态
    // 使用 debounce (300ms) 防止高频触发导致连续闪烁
    let resizeTimer = null;
    window.addEventListener('resize', () => {
        lastResizeTime = Date.now(); // 记录最后一次 Resize 时间
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (CanvasState.performanceMode !== 'unlimited') {
                manageSectionDormancy();
            }
            updateCanvasScrollBounds({ recomputeBounds: true, initial: false });
        }, 300);
    });

    // 管理按钮和弹窗
    setupCanvasManageModal();
    // 快捷键帮助按钮和弹窗
    setupCanvasHelpModal();
}

function setupCanvasManageModal() {
    const manageBtn = document.getElementById('canvasManageBtn');
    const manageModal = document.getElementById('canvasManageModal');
    const manageModalClose = document.getElementById('canvasManageModalClose');
    const helpModal = document.getElementById('canvasHelpModal');

    if (!manageBtn || !manageModal) return;

    manageBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // 先关闭帮助弹窗
        if (helpModal) helpModal.style.display = 'none';
        // 切换管理弹窗
        const isVisible = manageModal.style.display === 'block';
        manageModal.style.display = isVisible ? 'none' : 'block';
    });

    if (manageModalClose) {
        manageModalClose.addEventListener('click', () => {
            manageModal.style.display = 'none';
        });
    }

    // 点击其他地方关闭弹窗
    document.addEventListener('click', (e) => {
        if (manageModal.style.display === 'block' &&
            !manageModal.contains(e.target) &&
            e.target !== manageBtn &&
            !manageBtn.contains(e.target)) {
            manageModal.style.display = 'none';
        }
    });
}

// =============================================================================
// 快捷键自定义功能
// =============================================================================

const CANVAS_SHORTCUTS_KEY = 'canvas-custom-shortcuts';
const DEFAULT_SHORTCUTS = {
    ctrlKey: 'Control',  // Control, Alt, Shift, Meta
    spaceKey: 'Space'    // Space, or any other key
};

let canvasShortcuts = { ...DEFAULT_SHORTCUTS };
let isRecordingShortcut = false;
let recordingTarget = null; // 'ctrl' or 'space'

function loadCanvasShortcuts() {
    try {
        const saved = localStorage.getItem(CANVAS_SHORTCUTS_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            canvasShortcuts = { ...DEFAULT_SHORTCUTS, ...parsed };
        }
    } catch (e) {
        console.warn('[Canvas] 加载快捷键设置失败:', e);
    }
    updateShortcutDisplays();
}

function saveCanvasShortcuts() {
    try {
        localStorage.setItem(CANVAS_SHORTCUTS_KEY, JSON.stringify(canvasShortcuts));
    } catch (e) {
        console.warn('[Canvas] 保存快捷键设置失败:', e);
    }
}

function getKeyDisplayName(keyCode, lang) {
    const isZh = lang === 'zh_CN';
    const keyMap = {
        'Control': 'Ctrl',
        'Alt': 'Alt',
        'Shift': 'Shift',
        'Meta': 'Cmd',
        'Space': isZh ? '空格' : 'Space',
        'Tab': 'Tab'
    };
    if (keyMap[keyCode]) return keyMap[keyCode];
    // KeyA -> A, Digit1 -> 1
    if (/^Key([A-Z])$/.test(keyCode)) return keyCode.slice(3);
    if (/^Digit([0-9])$/.test(keyCode)) return keyCode.slice(5);
    return keyCode;
}

function updateShortcutDisplays() {
    const lang = typeof window !== 'undefined' && window.currentLang ? window.currentLang : 'zh_CN';

    // 更新 Ctrl 键显示
    const ctrlDisplays = ['ctrlKeyDisplay', 'ctrlKeyDisplay2', 'ctrlKeyDisplay3'];
    const ctrlName = getKeyDisplayName(canvasShortcuts.ctrlKey, lang);
    ctrlDisplays.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = ctrlName;
    });

    // 更新 Space 键显示
    const spaceDisplay = document.getElementById('spaceKeyDisplay');
    if (spaceDisplay) {
        spaceDisplay.textContent = getKeyDisplayName(canvasShortcuts.spaceKey, lang);
    }

    // 更新标题
    const ctrlTitle = document.getElementById('canvasHelpCtrlTitle');
    if (ctrlTitle) {
        const isZh = lang === 'zh_CN';
        ctrlTitle.textContent = isZh ? `${ctrlName} 键操作` : `${ctrlName} Key Actions`;
    }

    const spaceTitle = document.getElementById('canvasHelpSpaceTitle');
    if (spaceTitle) {
        const isZh = lang === 'zh_CN';
        const spaceName = getKeyDisplayName(canvasShortcuts.spaceKey, lang);
        spaceTitle.textContent = isZh ? `${spaceName}键操作` : `${spaceName} Key Actions`;
    }
}

function startShortcutRecording(target) {
    isRecordingShortcut = true;
    recordingTarget = target;

    const recorder = document.getElementById('canvasShortcutRecorder');
    const recorderText = document.getElementById('recorderText');
    const lang = typeof window !== 'undefined' && window.currentLang ? window.currentLang : 'zh_CN';

    if (recorder) {
        recorder.style.display = 'block';
        if (recorderText) {
            recorderText.textContent = lang === 'zh_CN' ? '请按下新的快捷键...' : 'Press a new shortcut key...';
        }
    }

    // 高亮对应的键
    if (target === 'ctrl') {
        ['ctrlKeyDisplay', 'ctrlKeyDisplay2', 'ctrlKeyDisplay3'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('recording');
        });
    } else if (target === 'space') {
        const el = document.getElementById('spaceKeyDisplay');
        if (el) el.classList.add('recording');
    }
}

function stopShortcutRecording(newKey) {
    if (!isRecordingShortcut) return;

    ['ctrlKeyDisplay', 'ctrlKeyDisplay2', 'ctrlKeyDisplay3', 'spaceKeyDisplay'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('recording');
    });

    const recorder = document.getElementById('canvasShortcutRecorder');
    if (recorder) recorder.style.display = 'none';

    if (newKey && recordingTarget) {
        if (recordingTarget === 'ctrl') {
            canvasShortcuts.ctrlKey = newKey;
        } else if (recordingTarget === 'space') {
            canvasShortcuts.spaceKey = newKey;
        }
        saveCanvasShortcuts();
        updateShortcutDisplays();
    }

    isRecordingShortcut = false;
    recordingTarget = null;
}

function isCustomCtrlKeyPressed(e) {
    const key = canvasShortcuts.ctrlKey;
    // 修饰键使用事件属性检测
    switch (key) {
        case 'Control': return e.ctrlKey;
        case 'Alt': return e.altKey;
        case 'Shift': return e.shiftKey;
        case 'Meta': return e.metaKey;
    }
    // 普通键使用状态检测
    return CanvasState.isCtrlPressed;
}

function isCustomSpaceKeyPressed(keyCode) {
    const key = canvasShortcuts.spaceKey;
    return keyCode === key;
}

function getCustomCtrlKeyCode() {
    return canvasShortcuts.ctrlKey;
}

function getCustomSpaceKeyCode() {
    return canvasShortcuts.spaceKey;
}

function setupCanvasHelpModal() {
    const helpBtn = document.getElementById('canvasHelpBtn');
    const helpModal = document.getElementById('canvasHelpModal');
    const helpModalClose = document.getElementById('canvasHelpModalClose');
    const manageModal = document.getElementById('canvasManageModal');

    if (!helpBtn || !helpModal) return;

    // 加载保存的快捷键设置
    loadCanvasShortcuts();

    helpBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // 先关闭管理弹窗
        if (manageModal) manageModal.style.display = 'none';
        // 切换帮助弹窗
        const isVisible = helpModal.style.display === 'block';
        helpModal.style.display = isVisible ? 'none' : 'block';
        if (!isVisible) {
            updateShortcutDisplays();
        }
    });

    if (helpModalClose) {
        helpModalClose.addEventListener('click', () => {
            stopShortcutRecording(null);
            helpModal.style.display = 'none';
        });
    }

    // 快捷键编辑按钮
    const editCtrlBtn = document.getElementById('editCtrlKeyBtn');
    const editSpaceBtn = document.getElementById('editSpaceKeyBtn');
    const recorderCancelBtn = document.getElementById('recorderCancelBtn');

    if (editCtrlBtn) {
        editCtrlBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            startShortcutRecording('ctrl');
        });
    }

    if (editSpaceBtn) {
        editSpaceBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            startShortcutRecording('space');
        });
    }

    if (recorderCancelBtn) {
        recorderCancelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            stopShortcutRecording(null);
        });
    }

    // 问号帮助按钮
    const recorderHelpBtn = document.getElementById('recorderHelpBtn');
    const recorderHelpTooltip = document.getElementById('recorderHelpTooltip');

    if (recorderHelpBtn && recorderHelpTooltip) {
        recorderHelpBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = recorderHelpTooltip.style.display === 'block';
            recorderHelpTooltip.style.display = isVisible ? 'none' : 'block';
        });

        // 点击其他地方关闭提示
        document.addEventListener('click', (e) => {
            if (recorderHelpTooltip.style.display === 'block' &&
                !recorderHelpTooltip.contains(e.target) &&
                e.target !== recorderHelpBtn &&
                !recorderHelpBtn.contains(e.target)) {
                recorderHelpTooltip.style.display = 'none';
            }
        });
    }

    // 监听键盘事件进行录制
    document.addEventListener('keydown', (e) => {
        if (!isRecordingShortcut) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const modifierKeys = ['Control', 'Alt', 'Shift', 'Meta'];
        const specialKeys = ['Space', 'Tab'];

        let newKey = null;

        // 修饰键直接使用 e.key
        if (modifierKeys.includes(e.key)) {
            newKey = e.key;
        }
        // 特殊键使用 e.code
        else if (specialKeys.includes(e.code)) {
            newKey = e.code;
        }
        // 普通字母/数字键使用 e.code (如 KeyA, KeyB, Digit1)
        else if (/^(Key[A-Z]|Digit[0-9])$/.test(e.code)) {
            newKey = e.code;
        }

        if (newKey) stopShortcutRecording(newKey);
    }, true);

    // 点击其他地方关闭弹窗
    document.addEventListener('click', (e) => {
        if (helpModal.style.display === 'block' &&
            !helpModal.contains(e.target) &&
            e.target !== helpBtn &&
            !helpBtn.contains(e.target)) {
            stopShortcutRecording(null);
            helpModal.style.display = 'none';
        }
    });
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

    // 限制缩放范围 (0.006 ≈ 1% at base 0.6)
    zoom = Math.max(0.006, Math.min(3, zoom));

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
        // [Fix] 缩放后立即检查唤醒状态，确保新进入视野的栏目可见
        requestAnimationFrame(() => manageSectionDormancy());
    } else {
        // 滚动时使用极速平移（直接 transform）
        applyPanOffsetFast();
    }

    // 更新显示
    const zoomValue = document.getElementById('zoomValue');
    if (zoomValue) {
        const base = (CanvasState.baseZoom && CanvasState.baseZoom > 0) ? CanvasState.baseZoom : 1;
        const displayZoom = zoom / base;
        zoomValue.textContent = (displayZoom * 100).toFixed(0) + '%';
        // [Fix] 如果小于 10%，显示一位小数
        if (displayZoom < 0.1) {
            zoomValue.textContent = (displayZoom * 100).toFixed(1) + '%';
        } else {
            zoomValue.textContent = Math.round(displayZoom * 100) + '%';
        }
    }

    // 保存缩放级别
    if (!skipSave) {
        saveZoomThrottled(zoom);
    }

    // 移除缩放日志以减少控制台输出
    // if (!silent) {
    //     console.log('[Canvas] 缩放:', Math.round(zoom * 100) + '%', '中心点:', { canvasCenterX, canvasCenterY });
    // }

    // 缩放变化后，更新连接线工具栏位置以保持固定像素偏移
    updateEdgeToolbarPosition();
}

function applyPanOffset() {
    const container = getCachedContainer();
    const content = getCachedContent();
    if (!container || !content) return;

    // 不要自动限制滚动位置，允许用户自由滚动到空白区域
    // CanvasState.panOffsetX = clampPan('horizontal', CanvasState.panOffsetX);
    // CanvasState.panOffsetY = clampPan('vertical', CanvasState.panOffsetY);

    // 优化：滚动/拖动时使用 transform 直接操作，停止时才用 CSS 变量
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

        // 调度滚动条更新（只在停止时更新）
        scheduleScrollbarUpdate();
    }

    if (!CanvasState.scrollAnimation.frameId) {
        CanvasState.scrollAnimation.targetX = CanvasState.panOffsetX;
        CanvasState.scrollAnimation.targetY = CanvasState.panOffsetY;
    }
}

// 性能优化：极速平移（使用 transform，完全跳过边界检查和滚动条）
function applyPanOffsetFast() {
    const container = getCachedContainer();
    const content = getCachedContent();
    if (!content) return;

    // 直接使用 transform，跳过 clampPan
    // transform 只触发合成，性能最优
    const scale = CanvasState.zoom;
    const translateX = CanvasState.panOffsetX / scale;
    const translateY = CanvasState.panOffsetY / scale;

    // 使用 translate3d 启用硬件加速
    content.style.transform = `scale(${scale}) translate3d(${translateX}px, ${translateY}px, 0)`;

    // [Fix] 移除交互过程中的实时唤醒检查，通过 onScrollStop 在停止时统一处理
    // 之前尝试的 150ms 节流检查会导致高频 DOM 操作引发闪烁

    // [OPT] 只有在非快速缩放模式下才更新背景网格变量
    // 如果正在缩放(is-zooming)，网格是隐藏的，更新变量纯属浪费性能
    const workspace = document.getElementById('canvasWorkspace');
    const isZooming = workspace && workspace.classList.contains('is-zooming');

    if (!isZooming && container) {
        container.style.setProperty('--canvas-scale', scale);
        container.style.setProperty('--canvas-pan-x', `${CanvasState.panOffsetX}px`);
        container.style.setProperty('--canvas-pan-y', `${CanvasState.panOffsetY}px`);
    }
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
        // [Fix] 在切换渲染模式（Inline Transform -> CSS Vars）前，强制关闭过渡
        // 防止移除 Inline 样式瞬间触发 CSS transition 导致的闪烁/回弹
        const originalTransition = content.style.transition;
        content.style.transition = 'none';

        // 恢复使用 CSS 变量
        container.style.setProperty('--canvas-scale', CanvasState.zoom);
        container.style.setProperty('--canvas-pan-x', `${CanvasState.panOffsetX}px`);
        container.style.setProperty('--canvas-pan-y', `${CanvasState.panOffsetY}px`);
        content.style.transform = ''; // 清除直接 transform

        // 强制回流，确保上面的变更立即生效且无动画
        void content.offsetHeight;

        // 恢复过渡设置（下一帧）
        requestAnimationFrame(() => {
            content.style.transition = '';
        });
    }

    // 启动惯性滚动（拖尾阻尼效果）
    startInertiaScroll();

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

// 惯性滚动相关函数
function startInertiaScroll() {
    // 检查是否有足够的速度启动惯性滚动
    const velocityThreshold = 0.5; // 最小速度阈值
    const timeSinceLastScroll = Date.now() - CanvasState.inertiaState.lastTime;

    // 如果距离上次滚动太久（超过100ms），不启动惯性滚动
    if (timeSinceLastScroll > 100) {
        return;
    }

    const absVelocityX = Math.abs(CanvasState.inertiaState.lastDeltaX);
    const absVelocityY = Math.abs(CanvasState.inertiaState.lastDeltaY);

    // 如果速度太小，不启动惯性滚动
    if (absVelocityX < velocityThreshold && absVelocityY < velocityThreshold) {
        return;
    }

    // 设置初始速度（放大系数，让惯性更明显）
    const inertiaMultiplier = 1.2;
    CanvasState.inertiaState.velocityX = CanvasState.inertiaState.lastDeltaX * inertiaMultiplier;
    CanvasState.inertiaState.velocityY = CanvasState.inertiaState.lastDeltaY * inertiaMultiplier;
    CanvasState.inertiaState.isActive = true;

    // 启动惯性滚动动画
    runInertiaScroll();
}

function runInertiaScroll() {
    if (!CanvasState.inertiaState.isActive) {
        return;
    }

    const scrollFactor = 1.0 / (CanvasState.zoom || 1);
    const damping = 0.92; // 阻尼系数，越小减速越快
    const stopThreshold = 0.1; // 速度低于此值时停止

    // 应用速度
    if (Math.abs(CanvasState.inertiaState.velocityX) > stopThreshold) {
        CanvasState.panOffsetX -= CanvasState.inertiaState.velocityX * scrollFactor;
    }
    if (Math.abs(CanvasState.inertiaState.velocityY) > stopThreshold) {
        CanvasState.panOffsetY -= CanvasState.inertiaState.velocityY * scrollFactor;
    }

    // 应用阻尼
    CanvasState.inertiaState.velocityX *= damping;
    CanvasState.inertiaState.velocityY *= damping;

    // 更新显示
    applyPanOffsetFast();
    updateScrollbarThumbsLightweight();

    // 检查是否应该停止
    const absVelocityX = Math.abs(CanvasState.inertiaState.velocityX);
    const absVelocityY = Math.abs(CanvasState.inertiaState.velocityY);

    if (absVelocityX < stopThreshold && absVelocityY < stopThreshold) {
        // 停止惯性滚动
        CanvasState.inertiaState.isActive = false;
        CanvasState.inertiaState.velocityX = 0;
        CanvasState.inertiaState.velocityY = 0;
        CanvasState.inertiaState.animationId = null;

        // 惯性滚动结束后，进行最终更新
        const container = getCachedContainer();
        const content = getCachedContent();
        if (container && content) {
            container.style.setProperty('--canvas-scale', CanvasState.zoom);
            container.style.setProperty('--canvas-pan-x', `${CanvasState.panOffsetX}px`);
            container.style.setProperty('--canvas-pan-y', `${CanvasState.panOffsetY}px`);
            content.style.transform = '';
        }
        scheduleScrollbarUpdate();
        savePanOffsetThrottled();
        return;
    }

    // 继续动画
    CanvasState.inertiaState.animationId = requestAnimationFrame(runInertiaScroll);
}

function cancelInertiaScroll() {
    if (CanvasState.inertiaState.animationId) {
        cancelAnimationFrame(CanvasState.inertiaState.animationId);
        CanvasState.inertiaState.animationId = null;
    }
    CanvasState.inertiaState.isActive = false;
    CanvasState.inertiaState.velocityX = 0;
    CanvasState.inertiaState.velocityY = 0;
}

// 边缘自动滚动相关函数
function checkEdgeAutoScroll(clientX, clientY) {
    const workspace = document.getElementById('canvasWorkspace');
    if (!workspace) return;

    const rect = workspace.getBoundingClientRect();
    const edgeThreshold = 100; // 触发自动滚动的边缘距离（像素）- 增加到100px
    const maxSpeed = 20; // 最大滚动速度 - 增加基础速度
    const minSpeed = 2; // 最小滚动速度 - 确保在边缘有基础速度

    // 计算距离边缘的距离
    const distLeft = clientX - rect.left;
    const distRight = rect.right - clientX;
    const distTop = clientY - rect.top;
    const distBottom = rect.bottom - clientY;

    let targetVelocityX = 0;
    let targetVelocityY = 0;

    // 缓动函数：使用三次方缓动（easeInCubic）让加速更平滑
    const easeInCubic = (t) => t * t * t;

    // 横向滚动
    if (distLeft < edgeThreshold && distLeft > 0) {
        // 靠近左边缘，向左滚动（正向）
        const ratio = 1 - (distLeft / edgeThreshold);
        const easedRatio = easeInCubic(ratio);
        targetVelocityX = minSpeed + (maxSpeed - minSpeed) * easedRatio;
    } else if (distRight < edgeThreshold && distRight > 0) {
        // 靠近右边缘，向右滚动（负向）
        const ratio = 1 - (distRight / edgeThreshold);
        const easedRatio = easeInCubic(ratio);
        targetVelocityX = -(minSpeed + (maxSpeed - minSpeed) * easedRatio);
    }

    // 纵向滚动
    if (distTop < edgeThreshold && distTop > 0) {
        // 靠近上边缘，向上滚动（正向）
        const ratio = 1 - (distTop / edgeThreshold);
        const easedRatio = easeInCubic(ratio);
        targetVelocityY = minSpeed + (maxSpeed - minSpeed) * easedRatio;
    } else if (distBottom < edgeThreshold && distBottom > 0) {
        // 靠近下边缘，向下滚动（负向）
        const ratio = 1 - (distBottom / edgeThreshold);
        const easedRatio = easeInCubic(ratio);
        targetVelocityY = -(minSpeed + (maxSpeed - minSpeed) * easedRatio);
    }

    // 启动或更新自动滚动
    if (targetVelocityX !== 0 || targetVelocityY !== 0) {
        startEdgeAutoScroll(targetVelocityX, targetVelocityY);
    } else {
        stopEdgeAutoScroll();
    }
}

function startEdgeAutoScroll(targetVelocityX, targetVelocityY) {
    // 更新目标速度
    CanvasState.autoScrollState.targetVelocityX = targetVelocityX;
    CanvasState.autoScrollState.targetVelocityY = targetVelocityY;

    // 如果已经在自动滚动，只更新目标速度
    if (CanvasState.autoScrollState.isActive) {
        return;
    }

    // 首次启动时，将当前速度设置为目标速度的一半，实现平滑启动
    CanvasState.autoScrollState.velocityX = targetVelocityX * 0.5;
    CanvasState.autoScrollState.velocityY = targetVelocityY * 0.5;
    CanvasState.autoScrollState.isActive = true;
    runEdgeAutoScroll();
}

function runEdgeAutoScroll() {
    if (!CanvasState.autoScrollState.isActive) {
        return;
    }

    const state = CanvasState.autoScrollState;
    const scrollFactor = 1.0 / (CanvasState.zoom || 1);

    // 使用线性插值（lerp）平滑地过渡到目标速度，避免抖动
    // velocityX = velocityX + (targetVelocityX - velocityX) * smoothing
    const smoothing = state.smoothing;
    state.velocityX += (state.targetVelocityX - state.velocityX) * smoothing;
    state.velocityY += (state.targetVelocityY - state.velocityY) * smoothing;

    // 应用滚动
    CanvasState.panOffsetX += state.velocityX * scrollFactor;
    CanvasState.panOffsetY += state.velocityY * scrollFactor;

    // 更新显示
    applyPanOffsetFast();
    updateScrollbarThumbsLightweight();

    // 同步更新拖动元素的位置
    if (CanvasState.dragState.isDragging && CanvasState.dragState.draggedElement) {
        const panDeltaX = state.velocityX * scrollFactor;
        const panDeltaY = state.velocityY * scrollFactor;
        adjustDragReferenceForPan(panDeltaX, panDeltaY, CanvasState.dragState.lastClientX, CanvasState.dragState.lastClientY);
    }

    // 继续动画
    state.intervalId = requestAnimationFrame(runEdgeAutoScroll);
}

function stopEdgeAutoScroll() {
    const state = CanvasState.autoScrollState;

    if (state.intervalId) {
        cancelAnimationFrame(state.intervalId);
        state.intervalId = null;
    }

    // 重置所有状态
    state.isActive = false;
    state.velocityX = 0;
    state.velocityY = 0;
    state.targetVelocityX = 0;
    state.targetVelocityY = 0;

    // 停止后进行最终更新
    if (CanvasState.dragState.isDragging) {
        const container = getCachedContainer();
        const content = getCachedContent();
        if (container && content) {
            container.style.setProperty('--canvas-scale', CanvasState.zoom);
            container.style.setProperty('--canvas-pan-x', `${CanvasState.panOffsetX}px`);
            container.style.setProperty('--canvas-pan-y', `${CanvasState.panOffsetY}px`);
            content.style.transform = '';
        }
        scheduleScrollbarUpdate();
    }
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
        let zoomLoaded = false;
        if (saved) {
            const zoom = parseFloat(saved);
            if (!isNaN(zoom)) {
                setCanvasZoom(zoom, null, null, { recomputeBounds: false, skipSave: true, silent: true });
                zoomLoaded = true;
            }
        }

        // 新安装/无历史缩放：默认使用 baseZoom（旧 60% 视图）
        if (!zoomLoaded && CanvasState.baseZoom && CanvasState.baseZoom !== 1) {
            setCanvasZoom(CanvasState.baseZoom, null, null, { recomputeBounds: false, skipSave: true, silent: true });
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
        return window.currentLang;
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

    // 在 Markdown 空白栏目内（查看/编辑区）时，不拦截滚轮，让其自身垂直滚动
    // - .md-canvas-text: 查看态的滚动容器
    // - .md-canvas-editor: 编辑态的文本域
    if (event.target.closest('.md-canvas-text') || event.target.closest('.md-canvas-editor')) {
        return false;
    }

    // 在临时栏目说明区域编辑时，不拦截滚轮，让其自身滚动
    // 检测是否为正在编辑的说明区域（contentEditable 为 true）
    const descTarget = event.target.closest('.temp-node-description');
    if (descTarget && descTarget.isContentEditable) {
        return false;
    }

    // 在永久栏目说明区域编辑时，不拦截滚轮，让其自身滚动
    const tipTarget = event.target.closest('#permanentSectionTip');
    if (tipTarget && tipTarget.isContentEditable) {
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

    // 在栏目内部：如果正在画布级滚动，则拦截处理
    const sectionBody = event.target.closest('.permanent-section-body') || event.target.closest('.temp-node-body');
    if (sectionBody) {
        // 检测是否为触控板双指滑动
        const isTouchpad = (Math.abs(event.deltaX) < 50 || Math.abs(event.deltaY) < 50) && event.deltaMode === 0;

        // 如果正在画布级滚动（双指滑动），拦截并让画布处理
        if (isTouchpad && CanvasState.touchpadState.isScrolling) {
            return true; // 让画布处理滚动
        }

        // 否则让栏目自己处理滚动
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

    // 取消之前的惯性滚动
    cancelInertiaScroll();

    let horizontalDelta = event.deltaX;
    let verticalDelta = event.deltaY;

    if (event.shiftKey && horizontalEnabled) {
        horizontalDelta = horizontalDelta !== 0 ? horizontalDelta : verticalDelta;
        verticalDelta = 0;
    }

    // 检测是否为触控板（触控板的 delta 值较小且连续，deltaMode 通常为 0）
    const isTouchpad = (Math.abs(horizontalDelta) < 50 || Math.abs(verticalDelta) < 50) && event.deltaMode === 0;

    // 双指滑动状态追踪：当检测到画布级别的滚动时，标记状态并设置超时清除
    if (isTouchpad && (Math.abs(horizontalDelta) > 0.5 || Math.abs(verticalDelta) > 0.5)) {
        CanvasState.touchpadState.isScrolling = true;
        CanvasState.touchpadState.lastScrollTime = Date.now();

        // 清除之前的超时
        if (CanvasState.touchpadState.scrollTimeout) {
            clearTimeout(CanvasState.touchpadState.scrollTimeout);
        }

        // 设置新的超时：滚动停止300ms后恢复栏目内滚动
        CanvasState.touchpadState.scrollTimeout = setTimeout(() => {
            CanvasState.touchpadState.isScrolling = false;
        }, 300);
    }

    // 记录滚动速度用于惯性滚动（仅触控板）
    if (isTouchpad) {
        const currentTime = Date.now();
        CanvasState.inertiaState.lastDeltaX = horizontalDelta;
        CanvasState.inertiaState.lastDeltaY = verticalDelta;
        CanvasState.inertiaState.lastTime = currentTime;
    }

    // 触控板双指拖动优化：根据缩放比例调整灵敏度
    let scrollFactor = 1.0 / (CanvasState.zoom || 1);

    // 根据缩放比例动态调整基础系数，让不同缩放级别下的滚动感觉更一致
    // 缩放越大（放大状态），滚动速率应该越慢；缩放越小（缩小状态），滚动速率应该越快
    const zoomAdjustment = Math.pow(CanvasState.zoom || 1, 0.3); // 使用较小的指数，减少缩放对速率的影响
    scrollFactor *= zoomAdjustment;

    if (isTouchpad) {
        // 触控板使用适中的滚动系数（降低灵敏度）
        scrollFactor *= 0.7; // 降低灵敏度（从1.4降到0.7）

        // 根据滚动速度动态调整响应：快速滚动时略微提升（减少加成幅度）
        const scrollSpeed = Math.sqrt(horizontalDelta * horizontalDelta + verticalDelta * verticalDelta);
        if (scrollSpeed > 8) { // 提高阈值（从5到8）
            const speedBoost = Math.min(1.15, 1 + (scrollSpeed - 8) / 200); // 减少加成幅度
            scrollFactor *= speedBoost;
        }
    } else {
        // 鼠标滚轮也应用缩放调整，但保持相对较快的响应
        scrollFactor *= 0.8; // 鼠标滚轮也稍微降低一点灵敏度
    }

    // 累积滚动增量
    let hasUpdate = false;

    if (horizontalEnabled && horizontalDelta !== 0) {
        CanvasState.panOffsetX -= horizontalDelta * scrollFactor;
        hasUpdate = true;
    }

    if (verticalEnabled && verticalDelta !== 0) {
        CanvasState.panOffsetY -= verticalDelta * scrollFactor;
        hasUpdate = true;
    }

    if (hasUpdate) {
        // 使用 RAF 去抖，合并多个滚动事件为一次渲染
        scheduleScrollUpdate();
        event.preventDefault();
    }
}

// 性能优化：使用 RAF 去抖滚动更新（参考 scheduleZoomUpdate）
function scheduleScrollUpdate() {
    // 保存当前的滚动位置
    pendingScrollRequest = {
        panOffsetX: CanvasState.panOffsetX,
        panOffsetY: CanvasState.panOffsetY
    };

    // 如果没有正在进行的渲染帧，调度一次
    if (!scrollUpdateFrame) {
        scrollUpdateFrame = requestAnimationFrame(() => {
            scrollUpdateFrame = null;
            if (!pendingScrollRequest) return;

            // 应用累积的滚动位置（使用极速平移）
            applyPanOffsetFast();

            // 实时更新滚动条位置（轻量操作，只更新 transform）
            updateScrollbarThumbsLightweight();

            pendingScrollRequest = null;
        });
    }
}

// 轻量级滚动条更新：只更新 thumb 的 transform，不触发边界重计算
function updateScrollbarThumbsLightweight() {
    const workspace = document.getElementById('canvasWorkspace');
    if (!workspace) return;

    const verticalBar = document.getElementById('canvasVerticalScrollbar');
    const horizontalBar = document.getElementById('canvasHorizontalScrollbar');

    // 更新垂直滚动条
    if (verticalBar) {
        const track = verticalBar.querySelector('.scrollbar-track');
        const thumb = verticalBar.querySelector('.scrollbar-thumb');
        if (track && thumb) {
            const trackSize = track.clientHeight;
            const bounds = CanvasState.scrollBounds.vertical;
            if (trackSize > 0 && bounds && isFinite(bounds.min) && isFinite(bounds.max)) {
                const range = bounds.max - bounds.min;
                const thumbSize = parseFloat(thumb.style.height) || 20;
                const maxTravel = Math.max(0, trackSize - thumbSize);
                const normalized = range === 0 ? 0 : (bounds.max - CanvasState.panOffsetY) / range;
                const position = Math.min(maxTravel, Math.max(0, normalized * maxTravel));

                // 只更新 transform，极轻量
                thumb.style.transform = `translateY(${position}px)`;
            }
        }
    }

    // 更新水平滚动条
    if (horizontalBar) {
        const track = horizontalBar.querySelector('.scrollbar-track');
        const thumb = horizontalBar.querySelector('.scrollbar-thumb');
        if (track && thumb) {
            const trackSize = track.clientWidth;
            const bounds = CanvasState.scrollBounds.horizontal;
            if (trackSize > 0 && bounds && isFinite(bounds.min) && isFinite(bounds.max)) {
                const range = bounds.max - bounds.min;
                const thumbSize = parseFloat(thumb.style.width) || 20;
                const maxTravel = Math.max(0, trackSize - thumbSize);
                const normalized = range === 0 ? 0 : (bounds.max - CanvasState.panOffsetX) / range;
                const position = Math.min(maxTravel, Math.max(0, normalized * maxTravel));

                // 只更新 transform，极轻量
                thumb.style.transform = `translateX(${position}px)`;
            }
        }
    }
}

function adjustDragReferenceForPan(panDeltaX, panDeltaY, clientX, clientY) {
    if (!CanvasState.dragState.isDragging) return;
    const source = CanvasState.dragState.dragSource;
    if (source !== 'temp-node' && source !== 'permanent-section') return;
    if (!panDeltaX && !panDeltaY) return;

    CanvasState.dragState.dragStartX += panDeltaX;
    CanvasState.dragState.dragStartY += panDeltaY;
    CanvasState.dragState.hasMoved = true;

    updateActiveDragPosition(clientX, clientY);
}

function updateActiveDragPosition(clientX, clientY) {
    if (!CanvasState.dragState.isDragging || !CanvasState.dragState.draggedElement) {
        return false;
    }

    CanvasState.dragState.lastClientX = clientX;
    CanvasState.dragState.lastClientY = clientY;

    if (CanvasState.dragState.dragSource === 'temp-node') {
        return applyTempNodeDragPosition(clientX, clientY);
    }

    if (CanvasState.dragState.dragSource === 'permanent-section') {
        return applyPermanentSectionDragPosition(clientX, clientY);
    }

    return false;
}

function applyTempNodeDragPosition(clientX, clientY) {
    const element = CanvasState.dragState.draggedElement;
    if (!element) return false;

    const deltaX = clientX - CanvasState.dragState.dragStartX;
    const deltaY = clientY - CanvasState.dragState.dragStartY;
    const scaledDeltaX = deltaX / (CanvasState.zoom || 1);
    const scaledDeltaY = deltaY / (CanvasState.zoom || 1);

    if (!CanvasState.dragState.hasMoved) {
        if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
            CanvasState.dragState.hasMoved = true;
        }
    }

    const newX = CanvasState.dragState.nodeStartX + scaledDeltaX;
    const newY = CanvasState.dragState.nodeStartY + scaledDeltaY;

    element.style.left = newX + 'px';
    element.style.top = newY + 'px';

    // 如果有附带的子节点（import-container 组拖动），同步更新它们的位置
    if (CanvasState.dragState.childElements && CanvasState.dragState.childElements.length > 0) {
        CanvasState.dragState.childElements.forEach(child => {
            const cx = child.startX + scaledDeltaX;
            const cy = child.startY + scaledDeltaY;
            if (child.element) {
                child.element.style.left = cx + 'px';
                child.element.style.top = cy + 'px';
            }
            // 同时更新数据模型，确保 saveTempNodes 时能保存
            if (child.data) {
                child.data.x = cx;
                child.data.y = cy;
            }
        });
    }
    element.style.transform = 'none';

    const nodeId = element.id;
    const section = CanvasState.tempSections.find(n => n.id === nodeId) ||
        (Array.isArray(CanvasState.mdNodes) ? CanvasState.mdNodes.find(n => n.id === nodeId) : null);
    if (section) {
        section.x = newX;
        section.y = newY;
    }

    // 优化：拖动时降低连接线渲染频率
    if (typeof renderEdges === 'function' && isScrolling) {
        // 只在停止时重新渲染连接线
        // renderEdges();
    } else if (typeof renderEdges === 'function') {
        renderEdges();
    }

    return true;
}

function applyPermanentSectionDragPosition(clientX, clientY) {
    const element = CanvasState.dragState.draggedElement;
    if (!element) return false;

    const deltaX = clientX - CanvasState.dragState.dragStartX;
    const deltaY = clientY - CanvasState.dragState.dragStartY;
    const scaledDeltaX = deltaX / (CanvasState.zoom || 1);
    const scaledDeltaY = deltaY / (CanvasState.zoom || 1);

    if (!CanvasState.dragState.hasMoved) {
        if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
            CanvasState.dragState.hasMoved = true;
        }
    }

    element.style.transform = `translate(${scaledDeltaX}px, ${scaledDeltaY}px)`;

    // 优化：拖动时降低连接线渲染频率
    if (typeof renderEdges === 'function' && isScrolling) {
        // 只在停止时重新渲染连接线
        // renderEdges();
    } else if (typeof renderEdges === 'function') {
        renderEdges();
    }

    return true;
}

function finalizeTempNodeDrag() {
    const element = CanvasState.dragState.draggedElement;
    if (!element) return;

    element.classList.remove('dragging');

    const nodeId = element.id;
    const section = CanvasState.tempSections.find(n => n.id === nodeId) ||
        (Array.isArray(CanvasState.mdNodes) ? CanvasState.mdNodes.find(n => n.id === nodeId) : null);
    if (section) {
        element.style.transform = 'none';
        element.style.left = section.x + 'px';
        element.style.top = section.y + 'px';
    }

    // 优化：拖动结束时重新渲染连接线
    if (typeof renderEdges === 'function') {
        renderEdges();
    }

    saveTempNodes();
    scheduleBoundsUpdate();
    scheduleScrollbarUpdate();
    CanvasState.dragState.meta = null;
    CanvasState.dragState.hasMoved = false;
}

function finalizePermanentSectionDrag() {
    const element = CanvasState.dragState.draggedElement;
    if (!element) return;

    element.classList.remove('dragging');

    if (CanvasState.dragState.hasMoved) {
        const deltaX = CanvasState.dragState.lastClientX - CanvasState.dragState.dragStartX;
        const deltaY = CanvasState.dragState.lastClientY - CanvasState.dragState.dragStartY;
        const scaledDeltaX = deltaX / (CanvasState.zoom || 1);
        const scaledDeltaY = deltaY / (CanvasState.zoom || 1);
        const finalX = CanvasState.dragState.nodeStartX + scaledDeltaX;
        const finalY = CanvasState.dragState.nodeStartY + scaledDeltaY;
        // 关闭过渡，避免落下时“果冻”弹动
        element.style.transition = 'none';
        element.style.transform = 'none';
        element.style.left = finalX + 'px';
        element.style.top = finalY + 'px';
        // 强制重排，然后恢复 transition（下一帧再允许动画）
        element.offsetHeight; // reflow
        requestAnimationFrame(() => { element.style.transition = ''; });

        // 优化：拖动结束时重新渲染连接线
        if (typeof renderEdges === 'function') {
            renderEdges();
        }

        savePermanentSectionPosition();
        scheduleBoundsUpdate();
        scheduleScrollbarUpdate();
    } else {
        element.style.transform = 'none';
    }

    CanvasState.dragState.hasMoved = false;
    CanvasState.dragState.meta = null;
    element.style.transition = '';
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

// 首次打开 Canvas（演示模板）时：定位到「快捷键说明 + 使用说明 + 永久栏目」三卡片的中心
function locateToIntroCardsCenter() {
    const workspace = document.getElementById('canvasWorkspace');
    if (!workspace) return false;

    const permanentSection = document.getElementById('permanentSection');
    const shortcutGuide = document.getElementById('md-node-demo-shortcut-guide');
    const bookmarkGuide = document.getElementById('md-node-demo-bookmark-guide');

    const elements = [permanentSection, shortcutGuide, bookmarkGuide].filter(Boolean);
    if (elements.length < 2) return false;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    elements.forEach((el) => {
        const left = parseFloat(el.style.left) || 0;
        const top = parseFloat(el.style.top) || 0;
        const width = el.offsetWidth || 0;
        const height = el.offsetHeight || 0;

        minX = Math.min(minX, left);
        minY = Math.min(minY, top);
        maxX = Math.max(maxX, left + width);
        maxY = Math.max(maxY, top + height);
    });

    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return false;

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const wsW = workspace.clientWidth || 1;
    const wsH = workspace.clientHeight || 1;

    CanvasState.panOffsetX = wsW / 2 - centerX * CanvasState.zoom;
    CanvasState.panOffsetY = wsH / 2 - centerY * CanvasState.zoom;

    updateCanvasScrollBounds({ initial: false, recomputeBounds: true });
    updateScrollbarThumbs();
    savePanOffsetThrottled();

    return true;
}

// 通用：定位到任意 Canvas 节点（按绝对定位的 left/top + 尺寸）
function locateToElement(el) {
    if (!el) return;
    const workspace = document.getElementById('canvasWorkspace');
    if (!workspace) return;
    const left = parseFloat(el.style.left) || 0;
    const top = parseFloat(el.style.top) || 0;
    const width = el.offsetWidth || 0;
    const height = el.offsetHeight || 0;
    const centerX = left + width / 2;
    const centerY = top + height / 2;
    const wsW = workspace.clientWidth;
    const wsH = workspace.clientHeight;
    CanvasState.panOffsetX = wsW / 2 - centerX * CanvasState.zoom;
    CanvasState.panOffsetY = wsH / 2 - centerY * CanvasState.zoom;
    updateCanvasScrollBounds();
    savePanOffsetThrottled();
}

// 定位到临时栏目（通过 sectionId）
function locateToTempSection(sectionId) {
    if (!sectionId) return;
    try { ensureTempSectionRendered(sectionId); } catch (_) { }
    const el = document.querySelector(`.temp-canvas-node[data-section-id="${CSS.escape(sectionId)}"]`);
    if (el) locateToElement(el);
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

    // 注册 Ctrl 蒙版
    registerSectionCtrlOverlay(permanentSection);

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

        // Ctrl模式下，通过overlay处理；非Ctrl模式下，直接拖动
        if (isSectionCtrlModeEvent(e)) {
            // Ctrl模式下的拖动由overlay接管
            return;
        }

        // 正常拖动（非Ctrl模式）
        if (e.button !== 0) return;

        const currentLeft = parseFloat(permanentSection.style.left) || 0;
        const currentTop = parseFloat(permanentSection.style.top) || 0;

        CanvasState.dragState.isDragging = true;
        CanvasState.dragState.draggedElement = permanentSection;
        CanvasState.dragState.dragSource = 'permanent-section';
        CanvasState.dragState.dragStartX = e.clientX;
        CanvasState.dragState.dragStartY = e.clientY;
        CanvasState.dragState.nodeStartX = currentLeft;
        CanvasState.dragState.nodeStartY = currentTop;
        CanvasState.dragState.lastClientX = e.clientX;
        CanvasState.dragState.lastClientY = e.clientY;
        CanvasState.dragState.hasMoved = false;
        CanvasState.dragState.meta = null;

        permanentSection.classList.add('dragging');
        permanentSection.style.transform = 'none';
        permanentSection.style.transition = 'none';

        CanvasState.dragState.wheelScrollEnabled = true;

        e.preventDefault();
    };

    // 使用捕获阶段确保事件优先处理，mousemove用冒泡阶段提高性能
    header.addEventListener('mousedown', onMouseDown, true);

    // 添加永久栏目空白区域右键菜单（整个栏目body区域）
    const permanentBody = permanentSection.querySelector('.permanent-section-body');
    if (permanentBody) {
        // 右键空白菜单
        permanentBody.addEventListener('contextmenu', (e) => {
            // 检查是否点击在树节点上
            const treeItem = e.target.closest('.tree-item[data-node-id]');
            if (!treeItem) {
                e.preventDefault();
                e.stopPropagation();
                showBlankAreaContextMenu(e, null, 'permanent');
            }
        });

        // 持久化滚动位置（永久栏目）
        const key = 'permanent-section-scroll';
        let rafId = 0;
        permanentBody.addEventListener('scroll', () => {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => __writeJSON(key, { top: permanentBody.scrollTop || 0, left: permanentBody.scrollLeft || 0 }));
        }, { passive: true });

        // 避免“多次自动恢复滚动”与用户滚动产生抢夺：用户一旦开始滚动，短时间内停止自动恢复
        if (permanentBody.dataset.scrollRestoreGuardAttached !== 'true') {
            permanentBody.dataset.scrollRestoreGuardAttached = 'true';
            const blockMs = 1000;
            const block = () => {
                try {
                    permanentBody.dataset.scrollRestoreBlockUntil = String(Date.now() + blockMs);
                } catch (_) { }
            };
            permanentBody.addEventListener('wheel', block, { passive: true });
            permanentBody.addEventListener('touchstart', block, { passive: true });
            permanentBody.addEventListener('touchmove', block, { passive: true });
            // 仅当直接在滚动容器上按下（如拖动滚动条/空白区域）才算用户滚动意图，避免点击树节点误触发
            permanentBody.addEventListener('pointerdown', (e) => {
                if (e && e.target === permanentBody) block();
            }, { passive: true });
        }

        // 恢复滚动位置（多次尝试，确保树渲染后也能成功）
        const persisted = __readJSON(key, null);
        if (persisted && typeof persisted.top === 'number') {
            const restore = () => {
                try {
                    const until = parseInt(permanentBody.dataset.scrollRestoreBlockUntil || '0', 10) || 0;
                    if (until && Date.now() < until) return;
                } catch (_) { }
                permanentBody.scrollTop = persisted.top || 0;
                permanentBody.scrollLeft = persisted.left || 0;
            };
            restore();
            requestAnimationFrame(() => {
                restore();
                setTimeout(restore, 10);
                setTimeout(restore, 50);
                setTimeout(restore, 100);
            });
        }
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
        const permanentSection = document.getElementById('permanentSection');
        if (!permanentSection) return;

        if (saved) {
            const position = JSON.parse(saved);
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

        // 需求：永久栏目尺寸应始终“固定”，不要因为窗口 resize 而改变。
        // 旧默认值中 height 使用 vh（会随窗口高度变化），只有当用户手动 resize 后才变成 px。
        // 这里在“没有保存尺寸”的情况下，把当前计算后的尺寸固化为 px 并持久化，保证行为一致。
        const hasInlineWidth = !!(permanentSection.style.width && permanentSection.style.width.trim());
        const hasInlineHeight = !!(permanentSection.style.height && permanentSection.style.height.trim());
        if (!hasInlineWidth || !hasInlineHeight) {
            // 确保 left/top 已经初始化（否则保存会写入空值）
            if (!permanentSection.style.left || !permanentSection.style.top) {
                try { initializePermanentSectionPosition(permanentSection); } catch (_) { }
            }

            // 用当前渲染尺寸固化为 px（避免 70vh 这种相对单位随窗口变化）
            const widthPx = Math.max(300, Math.round(permanentSection.offsetWidth || 0));
            const heightPx = Math.max(200, Math.round(permanentSection.offsetHeight || 0));
            if (!hasInlineWidth) permanentSection.style.width = `${widthPx}px`;
            if (!hasInlineHeight) permanentSection.style.height = `${heightPx}px`;

            try { savePermanentSectionPosition(); } catch (_) { }
            console.log('[Canvas] 固化永久栏目默认尺寸为固定像素:', {
                width: permanentSection.style.width,
                height: permanentSection.style.height
            });
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

    // 检测是否是首次打开 Canvas（演示模板）
    // 首次打开时使用固定的 canvas 坐标，与使用说明卡片水平对齐
    const openedKey = 'bookmark-canvas-has-opened';
    const hasOpenedCanvas = localStorage.getItem(openedKey) === 'true';

    let left, top;

    if (!hasOpenedCanvas) {
        // 首次打开：使用固定的 canvas 坐标，与使用说明卡片(y=-190)水平对齐
        // 使用说明卡片位置：x=-500, y=-190, width=420, height=480
        // 永久栏目放在使用说明卡片右侧，水平对齐：left=0, top=-190
        left = 0;
        top = -190;
        console.log('[Canvas] 首次打开，使用固定位置与使用说明卡片对齐:', { left, top });
    } else {
        // 非首次打开：使用当前视口位置转换为 canvas 坐标
        const rect = permanentSection.getBoundingClientRect();
        const workspace = document.getElementById('canvasWorkspace');
        if (!workspace) return;

        const workspaceRect = workspace.getBoundingClientRect();

        // 计算在canvas-content坐标系中的位置
        left = (rect.left - workspaceRect.left) / CanvasState.zoom;
        top = (rect.top - workspaceRect.top) / CanvasState.zoom;
    }

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
            // 永久栏目不使用 node 对象；如需禁用缩放，可通过 data-locked 控制
            if (element && element.dataset && element.dataset.locked === 'true') return;

            // Ctrl模式下，resize由overlay接管
            if (isSectionCtrlModeEvent(e)) return;

            if (e.button !== 0) return;
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

                // Update connected edges in real-time during resize
                renderEdges();
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
    const baseStyle = 'position: absolute; z-index: 10003; background: transparent;';
    const cornerSize = '36px'; // 角手柄再缩小
    const edgeThickness = '28px'; // 边手柄再增宽

    let style = baseStyle + `cursor: ${handleInfo.cursor};`;

    // 角handle - 三角形区域，更大范围
    if (handleInfo.name.length === 2) {
        style += `width: ${cornerSize}; height: ${cornerSize};`;

        // 使用clip-path创建三角形
        if (handleInfo.name === 'nw') {
            style += 'top: -8px; left: -8px;'; // 向外扩展
            style += 'clip-path: polygon(0 0, 100% 0, 0 100%);';
        } else if (handleInfo.name === 'ne') {
            style += 'top: -8px; right: -8px;';
            style += 'clip-path: polygon(100% 0, 100% 100%, 0 0);';
        } else if (handleInfo.name === 'sw') {
            style += 'bottom: -8px; left: -8px;';
            style += 'clip-path: polygon(0 0, 0 100%, 100% 100%);';
        } else if (handleInfo.name === 'se') {
            style += 'bottom: -8px; right: -8px;';
            style += 'clip-path: polygon(100% 0, 100% 100%, 0 100%);';
        }
    }
    // 边handle - 居中在边框上（一半在外，一半在内）
    else {
        const halfThickness = parseInt(edgeThickness) / 2;
        if (handleInfo.name === 'n' || handleInfo.name === 's') {
            style += `left: ${cornerSize}; right: ${cornerSize}; height: ${edgeThickness};`;
            if (handleInfo.name === 'n') style += `top: -${halfThickness}px;`;
            else style += `bottom: -${halfThickness}px;`;
        } else {
            style += `top: ${cornerSize}; bottom: ${cornerSize}; width: ${edgeThickness};`;
            if (handleInfo.name === 'w') {
                // 左侧handle保持居中（一半在内，一半在外）
                style += `left: -${halfThickness}px;`;
            } else {
                // 【修复】右侧handle完全在栏目外部，避免与垂直滚动条冲突
                // 从栏目右边缘开始，向右延伸到外部
                style += `left: 100%;`;
            }
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
            // Ctrl模式下，resize由overlay接管
            if (isSectionCtrlModeEvent(e)) return;

            if (e.button !== 0) return;
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

                // Update connected edges in real-time during resize
                renderEdges();
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
    } catch (_) { }
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
                try { ids = collectPermanentSelectionIds((CanvasState.dragState.draggedData && CanvasState.dragState.draggedData.id) || null) || []; } catch (_) { }
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
    CanvasState.dragState.childElements = []; // 清空子元素数组
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
    const isTempSplit = !!(data && data.source === 'temporary' && data.sectionId);
    let inheritedLabel = null;
    let inheritedTitle = null;
    let inheritedColor = null;
    let splitPayload = [];

    if (isTempSplit) {
        const parentSection = getTempSection(data.sectionId);
        if (parentSection) {
            inheritedLabel = getSplitTempSectionLabel(parentSection);
            const parentTitle = String(parentSection.title || '').trim();
            const parentLabel = getTempSectionLabel(parentSection);
            if (inheritedLabel && parentTitle && parentLabel && parentTitle === parentLabel) {
                inheritedTitle = inheritedLabel;
            }
            inheritedColor = parentSection.color || TEMP_SECTION_DEFAULT_COLOR;
            try {
                const fallbackId = data.id || null;
                let ids = [];
                if (typeof collectTemporarySelectionIds === 'function') {
                    ids = collectTemporarySelectionIds(parentSection.id, fallbackId);
                }
                if (Array.isArray(ids) && ids.length) {
                    splitPayload = extractTempItemsPayload(parentSection.id, ids);
                } else if (fallbackId) {
                    const entry = findTempItemEntry(parentSection.id, fallbackId);
                    if (entry && entry.item) {
                        splitPayload = [serializeTempItemForClipboard(entry.item)];
                    }
                }
            } catch (error) {
                console.warn('[Canvas] 获取分裂栏目数据失败:', error);
            }
        }
    }

    const sectionId = `temp-section-${++CanvasState.tempSectionCounter}`;
    const sequenceNumber = ++CanvasState.tempSectionSequenceNumber;
    const section = {
        id: sectionId,
        title: inheritedTitle || getDefaultTempSectionTitle(),
        sequenceNumber: sequenceNumber,
        color: inheritedColor || pickTempSectionColor(),
        x,
        y,
        width: TEMP_SECTION_DEFAULT_WIDTH,
        height: TEMP_SECTION_DEFAULT_HEIGHT,
        createdAt: Date.now(),
        items: []
    };
    if (inheritedLabel) {
        section.label = inheritedLabel;
    }

    try {
        let payload = Array.isArray(splitPayload) ? splitPayload : [];
        if (data && data.multi && Array.isArray(data.permanentIds) && data.permanentIds.length) {
            // 多选合集：从永久栏收集所有选中的节点
            payload = await resolvePermanentPayload(data.permanentIds);
        } else if (!payload.length) {
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
    } catch (_) { }
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
        if (node && node.isEditing) return; // 编辑模式下不允许拖动
        const target = e.target;
        if (!target) return;

        // resize、连接点、链接时不拖动
        if (target.closest('.resize-handle') ||
            target.closest('.canvas-node-anchor') ||
            target.closest('.canvas-anchor-zone') ||
            target.closest('a')) {
            return;
        }

        // *** 重要：如果是 import-container，检查点击的是否是内部的子节点 ***
        // 如果点击的是子节点，则不拖动容器，让子节点自己处理拖动
        if (node && node.subtype === 'import-container') {
            const clickedChildNode = target.closest('.temp-canvas-node, .md-canvas-node');
            // 如果点击的子节点不是当前容器本身，则跳过
            if (clickedChildNode && clickedChildNode.id !== node.id) {
                return;
            }
        }

        // 编辑器区域：如果编辑器已聚焦（正在编辑），不拖动；否则允许拖动
        const editorEl = element.querySelector('.md-canvas-editor');
        if (target.closest('.md-canvas-editor') && document.activeElement === editorEl) {
            return;
        }

        // Ctrl模式下，通过overlay处理
        if (isSectionCtrlModeEvent(e)) {
            return;
        }

        // 正常拖动
        if (e.button !== 0) return;

        // 在查看态区域内也允许按下后拖动（滚动用 wheel 事件处理；链接在下方单独保护）
        // 不再因存在滚动条而提前 return；通过移动阈值来区分点击/拖动

        dragPending = true;
        startX = e.clientX;
        startY = e.clientY;

        const onMove = (ev) => {
            if (!dragPending) return;
            const dx = Math.abs(ev.clientX - startX);
            const dy = Math.abs(ev.clientY - startY);
            if (dx + dy < 3) return; // 小阈值，模拟单击拖动体验

            dragPending = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);

            // 真正开始拖动（非Ctrl模式）
            CanvasState.dragState.isDragging = true;
            CanvasState.dragState.draggedElement = element;
            CanvasState.dragState.dragStartX = startX;
            CanvasState.dragState.dragStartY = startY;
            CanvasState.dragState.nodeStartX = node.x;
            CanvasState.dragState.nodeStartY = node.y;
            CanvasState.dragState.dragSource = 'temp-node';

            // *** 组拖动支持：如果是 import-container，捕获子节点 ***
            CanvasState.dragState.childElements = [];
            if (node && node.subtype === 'import-container') {
                const container = node;
                const cx = Number(container.x);
                const cy = Number(container.y);
                const cw = Number(container.width);
                const ch = Number(container.height);

                CanvasState.tempSections.forEach(sec => {
                    const sx = Number(sec.x) + (Number(sec.width) / 2);
                    const sy = Number(sec.y) + (Number(sec.height) / 2);
                    if (sx >= cx && sx <= cx + cw && sy >= cy && sy <= cy + ch) {
                        CanvasState.dragState.childElements.push({
                            type: 'temp-section',
                            data: sec,
                            startX: Number(sec.x),
                            startY: Number(sec.y),
                            element: document.getElementById(sec.id) // ID就是section.id，没有前缀
                        });
                    }
                });

                CanvasState.mdNodes.forEach(n => {
                    if (n.id === container.id) return;
                    const nodeW = Number(n.width) || 120;
                    const nodeH = Number(n.height) || 60;
                    const nx = Number(n.x) + (nodeW / 2);
                    const ny = Number(n.y) + (nodeH / 2);
                    if (nx >= cx && nx <= cx + cw && ny >= cy && ny <= cy + ch) {
                        CanvasState.dragState.childElements.push({
                            type: 'md-node',
                            data: n,
                            startX: Number(n.x),
                            startY: Number(n.y),
                            element: document.getElementById(n.id) // 注意：renderMdNode用的是n.id作为element id，没有前缀
                        });
                    }
                });

                CanvasState.dragState.childElements.forEach(child => {
                    if (child.element) child.element.style.transition = 'none';
                });
            }

            CanvasState.dragState.wheelScrollEnabled = true;

            element.classList.add('dragging');
            element.style.transition = 'none';
            ev.preventDefault();
        };

        const onUp = () => {
            if (dragPending) {
                // 单击释放，不进入拖动
                dragPending = false;
            }
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };

        // 不使用捕获阶段，让滚动事件正常工作
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    };
    // 不使用捕获阶段，让滚动事件正常工作
    element.addEventListener('mousedown', onMouseDown, false);
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
    } else {
        el.innerHTML = '';
    }

    // Always update position/size/style
    el.style.left = node.x + 'px';
    el.style.top = node.y + 'px';
    el.style.width = (node.width || 120) + 'px'; // Fallback to safe default
    el.style.height = (node.height || 60) + 'px';

    // 应用自定义样式 (用于 import-container 等)
    if (node.style) {
        el.style.cssText += node.style;
    }

    // 强制层级管理：Container(5) < TempSection(10) < MdNode(15)
    if (node.subtype === 'import-container') {
        el.style.zIndex = '5';
    } else {
        // 普通 Markdown 卡片默认在书签栏目之上
        // 如果自定义样式里没有指定 z-index，才应用默认值 (这里简单起见强制应用，保证层级正确)
        el.style.zIndex = '15';
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
    const formatTitle = lang === 'en' ? 'Format toolbar' : '格式工具栏';

    // 多语言：import-container 的两个删除按钮
    const deleteFrameTitle = lang === 'en' ? 'Delete Frame Only' : '仅删除框体';
    const deleteAllTitle = lang === 'en' ? 'Delete All Content' : '删除全部内容';

    // 根据节点类型生成不同的工具栏
    if (node.subtype === 'import-container') {
        // import-container 使用两个独立的删除按钮
        // data-tooltip 用于自定义快速气泡，移除 title 属性以禁用原生提示
        toolbar.innerHTML = `
            <button class="md-node-toolbar-btn" data-action="md-delete-frame-only" data-tooltip="${deleteFrameTitle}">
                <div class="icon-frame-delete">
                    <i class="far fa-square"></i>
                    <i class="fas fa-trash-alt"></i>
                </div>
            </button>
            <button class="md-node-toolbar-btn" data-action="md-delete-all-content" data-tooltip="${deleteAllTitle}">
                <i class="fas fa-trash-alt"></i>
            </button>
            <button class="md-node-toolbar-btn" data-action="md-focus" data-tooltip="${focusTitle}">
                <i class="fas fa-search-plus"></i>
            </button>
        `;
    } else {
        // 普通节点使用标准工具栏
        toolbar.innerHTML = `
            <button class="md-node-toolbar-btn" data-action="md-delete" data-tooltip="${deleteTitle}"><i class="far fa-trash-alt"></i></button>
            <button class="md-node-toolbar-btn" data-action="md-color-toggle" data-tooltip="${colorTitle}"><i class="fas fa-palette"></i></button>
            <button class="md-node-toolbar-btn" data-action="md-format-toggle" data-tooltip="${formatTitle}"><i class="fas fa-font"></i></button>
            <button class="md-node-toolbar-btn" data-action="md-focus" data-tooltip="${focusTitle}"><i class="fas fa-search-plus"></i></button>
            <button class="md-node-toolbar-btn" data-action="md-edit" data-tooltip="${editTitle}"><i class="far fa-edit"></i></button>
        `;
    }

    // Hook for Import Container Events
    if (node.subtype === 'import-container') {
        __setupImportContainerEvents(el, node);
    }

    // 初始化字体大小（从节点数据或默认值）
    const defaultFontSize = 14;
    const minFontSize = 10;
    const maxFontSize = 28;
    if (typeof node.fontSize !== 'number') {
        node.fontSize = defaultFontSize;
    }

    // 创建格式工具栏弹层（单行布局）
    const createFormatPopover = () => {
        let pop = toolbar.querySelector('.md-format-popover');
        if (pop) return pop;

        pop = document.createElement('div');
        pop.className = 'md-format-popover';
        preventCanvasEventsPropagation(pop);

        // 多语言翻译
        const sizeDecreaseTitle = lang === 'en' ? 'Decrease font size' : '减小字号';
        const sizeIncreaseTitle = lang === 'en' ? 'Increase font size' : '增大字号';
        const boldTitle = lang === 'en' ? 'Bold' : '加粗';
        const italicTitle = lang === 'en' ? 'Italic' : '斜体';
        const underlineTitle = lang === 'en' ? 'Underline' : '下划线';
        const highlightTitle = lang === 'en' ? 'Highlight' : '高亮';
        const fontColorTitle = lang === 'en' ? 'Font Color' : '字体颜色';
        const strikeTitle = lang === 'en' ? 'Strikethrough' : '删除线';
        const codeTitle = lang === 'en' ? 'Code' : '代码';
        const linkTitle = lang === 'en' ? 'Link' : '链接';
        const headingTitle = lang === 'en' ? 'Heading' : '标题';
        const alignTitle = lang === 'en' ? 'Alignment' : '对齐';
        const listTitle = lang === 'en' ? 'List' : '列表';
        const quoteTitle = lang === 'en' ? 'Quote' : '引用';

        pop.innerHTML = `
            <div class="md-format-row">
                <button class="md-format-btn md-format-btn-sm" data-action="md-font-decrease" title="${sizeDecreaseTitle}"><i class="fas fa-minus"></i></button>
                <span class="md-format-size-value">${node.fontSize}</span>
                <button class="md-format-btn md-format-btn-sm" data-action="md-font-increase" title="${sizeIncreaseTitle}"><i class="fas fa-plus"></i></button>
                <span class="md-format-sep"></span>
                <button class="md-format-btn md-format-heading-btn" data-action="md-heading-toggle" title="${headingTitle}"><i class="fas fa-heading"></i></button>
                <button class="md-format-btn md-format-align-btn" data-action="md-align-toggle" title="${alignTitle}"><i class="fas fa-align-left"></i></button>
                <span class="md-format-sep"></span>
                <button class="md-format-btn" data-action="md-insert-bold" title="${boldTitle}"><b>B</b></button>
                <button class="md-format-btn" data-action="md-insert-italic" title="${italicTitle}"><i>I</i></button>
                <button class="md-format-btn" data-action="md-insert-underline" title="${underlineTitle}"><u>U</u></button>
                <button class="md-format-btn" data-action="md-insert-highlight" title="${highlightTitle}"><span style="background:#fcd34d;color:#000;padding:0 3px;border-radius:2px;">H</span></button>
                <button class="md-format-btn md-format-fontcolor-btn" data-action="md-fontcolor-toggle" title="${fontColorTitle}"><span style="border-bottom:2px solid #2DC26B;padding:0 2px;">A</span></button>
                <button class="md-format-btn" data-action="md-insert-strike" title="${strikeTitle}"><s>S</s></button>
                <button class="md-format-btn" data-action="md-insert-code" title="${codeTitle}"><code>&lt;/&gt;</code></button>
                <button class="md-format-btn" data-action="md-insert-link" title="${linkTitle}"><i class="fas fa-link"></i></button>
                <span class="md-format-sep"></span>
                <button class="md-format-btn md-format-list-btn" data-action="md-list-toggle" title="${listTitle}"><i class="fas fa-list"></i></button>
                <button class="md-format-btn" data-action="md-insert-quote" title="${quoteTitle}"><i class="fas fa-quote-left"></i></button>
                <button class="md-format-btn md-format-close-btn" data-action="md-format-close" title="${(typeof lang !== 'undefined' && lang === 'en') ? 'Close toolbar' : '关闭工具窗'}"><i class="fas fa-times"></i></button>
            </div>
        `;

        toolbar.appendChild(pop);
        preventCanvasEventsPropagation(pop);
        return pop;
    };

    // 切换格式工具栏显示
    const toggleFormatPopover = (btn) => {
        const pop = createFormatPopover();
        const isOpen = pop.classList.contains('open');

        // 关闭其他弹层
        closeMdColorPopover(toolbar);

        if (isOpen) {
            pop.classList.remove('open');
            btn.classList.remove('active');
            updateCanvasPopoverState(false);
        } else {
            pop.classList.add('open');
            btn.classList.add('active');
            updateCanvasPopoverState(true);
            // 更新字号显示
            const sizeValue = pop.querySelector('.md-format-size-value');
            if (sizeValue) sizeValue.textContent = node.fontSize + 'px';
        }
    };

    // 关闭格式工具栏
    const closeFormatPopover = () => {
        const pop = toolbar.querySelector('.md-format-popover');
        if (pop) {
            pop.classList.remove('open');
            updateCanvasPopoverState(false);
        }
        // 移除按钮选中状态
        const formatBtn = toolbar.querySelector('[data-action="md-format-toggle"]');
        if (formatBtn) formatBtn.classList.remove('active');
    };

    // 当前选中的字体颜色
    let currentFontColor = '#2DC26B';

    // 创建字体颜色选择弹层
    const createFontColorPopover = () => {
        let pop = toolbar.querySelector('.md-fontcolor-popover');
        if (pop) return pop;

        pop = document.createElement('div');
        pop.className = 'md-fontcolor-popover';
        preventCanvasEventsPropagation(pop);

        // 预设颜色值（参考obsidian-editing-toolbar）
        const presetColors = [
            '#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050',
            '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0',
            '#ffffff', '#000000', '#1f497d', '#4f81bd', '#8064a2'
        ];

        let colorChips = presetColors.map(c =>
            `<span class="md-fontcolor-chip" data-action="md-fontcolor-apply" data-color="${c}" style="background:${c};" title="${c}"></span>`
        ).join('');

        pop.innerHTML = `
            <div class="md-fontcolor-grid">${colorChips}</div>
            <div class="md-fontcolor-custom">
                <input type="color" class="md-fontcolor-input" value="${currentFontColor}" title="${lang === 'en' ? 'Custom color' : '自定义颜色'}">
            </div>
        `;

        // 自定义颜色选择器事件
        const customInput = pop.querySelector('.md-fontcolor-input');
        if (customInput) {
            customInput.addEventListener('change', (e) => {
                const color = e.target.value;
                currentFontColor = color;
                insertFontColor(color);
                closeFontColorPopover();
            });
        }

        // 添加到 format popover 内部，作为兄弟元素
        const formatPop = toolbar.querySelector('.md-format-popover');
        if (formatPop) {
            formatPop.appendChild(pop);
        }
        preventCanvasEventsPropagation(pop);
        return pop;
    };

    // 定位弹层到按钮正上方居中
    const positionPopoverAboveBtn = (pop, btn) => {
        const formatPop = toolbar.querySelector('.md-format-popover');
        if (!formatPop) return;
        const btnRect = btn.getBoundingClientRect();
        const formatRect = formatPop.getBoundingClientRect();
        // 计算按钮中心相对于格式弹层的位置
        const btnCenterX = btnRect.left + btnRect.width / 2 - formatRect.left;
        pop.style.left = btnCenterX + 'px';
        pop.style.transform = 'translateX(-50%) translateY(-100%)';
    };

    // 切换字体颜色弹层
    const toggleFontColorPopover = (btn) => {
        // 先保存当前选区
        const sel = window.getSelection();
        if (sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
            savedSelection = {
                range: sel.getRangeAt(0).cloneRange(),
                text: sel.toString()
            };
        }

        const pop = createFontColorPopover();
        const isOpen = pop.classList.contains('open');

        // 关闭其他弹层
        closeAlignPopover();
        closeHeadingPopover();
        closeListPopover();

        if (isOpen) {
            pop.classList.remove('open');
            btn.classList.remove('active');
            updateCanvasPopoverState(false);
        } else {
            positionPopoverAboveBtn(pop, btn);
            pop.classList.add('open');
            btn.classList.add('active');
            updateCanvasPopoverState(true);
        }
    };

    // 关闭字体颜色弹层
    const closeFontColorPopover = () => {
        const pop = toolbar.querySelector('.md-fontcolor-popover');
        if (pop) {
            pop.classList.remove('open');
            updateCanvasPopoverState(false);
        }
        const btn = toolbar.querySelector('[data-action="md-fontcolor-toggle"]');
        if (btn) btn.classList.remove('active');
    };

    // 插入字体颜色
    const insertFontColor = (color) => {
        if (!node.isEditing) {
            enterEdit();
            setTimeout(() => doInsertFontColor(color), 50);
        } else {
            doInsertFontColor(color);
        }
    };

    const doInsertFontColor = (color) => {
        const sel = window.getSelection();
        let range;

        // 优先使用保存的选区
        if (savedSelection && savedSelection.range) {
            range = savedSelection.range;
            sel.removeAllRanges();
            sel.addRange(range);
        } else if (sel.rangeCount) {
            range = sel.getRangeAt(0);
        } else {
            editor.focus();
            return;
        }

        if (!editor.contains(range.commonAncestorContainer)) {
            editor.focus();
            return;
        }

        const selected = range.toString();
        const insertText = selected || (lang === 'en' ? 'text' : '文本');

        // 清除保存的选区
        savedSelection = null;

        // 创建 font 标签
        const wrapper = document.createElement('font');
        wrapper.setAttribute('color', color);
        wrapper.textContent = insertText;

        range.deleteContents();
        range.insertNode(wrapper);

        const spacer = document.createTextNode('\u200B');
        wrapper.parentNode.insertBefore(spacer, wrapper.nextSibling);

        range.setStart(spacer, 1);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);

        node.html = editor.innerHTML;
        node.text = editor.innerText;
        saveTempNodes();

        currentFontColor = color;
        // 更新按钮颜色指示
        const fontColorBtn = toolbar.querySelector('[data-action="md-fontcolor-toggle"] span');
        if (fontColorBtn) {
            fontColorBtn.style.borderBottomColor = color;
        }

        editor.focus();
    };

    // 创建对齐选择弹层
    const createAlignPopover = () => {
        let pop = toolbar.querySelector('.md-align-popover');
        if (pop) return pop;

        pop = document.createElement('div');
        pop.className = 'md-align-popover';
        preventCanvasEventsPropagation(pop);

        const leftTitle = lang === 'en' ? 'Align Left' : '左对齐';
        const centerTitle = lang === 'en' ? 'Center' : '居中';
        const rightTitle = lang === 'en' ? 'Align Right' : '右对齐';
        const justifyTitle = lang === 'en' ? 'Justify' : '两端对齐';

        pop.innerHTML = `
            <button class="md-align-option" data-action="md-align-apply" data-align="left" title="${leftTitle}"><i class="fas fa-align-left"></i></button>
            <button class="md-align-option" data-action="md-align-apply" data-align="center" title="${centerTitle}"><i class="fas fa-align-center"></i></button>
            <button class="md-align-option" data-action="md-align-apply" data-align="right" title="${rightTitle}"><i class="fas fa-align-right"></i></button>
            <button class="md-align-option" data-action="md-align-apply" data-align="justify" title="${justifyTitle}"><i class="fas fa-align-justify"></i></button>
        `;

        toolbar.querySelector('.md-format-popover').appendChild(pop);
        preventCanvasEventsPropagation(pop);
        return pop;
    };

    // 切换对齐弹层
    const toggleAlignPopover = (btn) => {
        // 先保存当前选区
        const sel = window.getSelection();
        if (sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
            savedSelection = {
                range: sel.getRangeAt(0).cloneRange(),
                text: sel.toString()
            };
        }

        const pop = createAlignPopover();
        const isOpen = pop.classList.contains('open');

        // 关闭其他弹层
        closeFontColorPopover();
        closeHeadingPopover();
        closeListPopover();

        if (isOpen) {
            pop.classList.remove('open');
            btn.classList.remove('active');
            updateCanvasPopoverState(false);
        } else {
            positionPopoverAboveBtn(pop, btn);
            pop.classList.add('open');
            btn.classList.add('active');
            updateCanvasPopoverState(true);
        }
    };

    // 关闭对齐弹层
    const closeAlignPopover = () => {
        const pop = toolbar.querySelector('.md-align-popover');
        if (pop) {
            pop.classList.remove('open');
            updateCanvasPopoverState(false);
        }
        const btn = toolbar.querySelector('[data-action="md-align-toggle"]');
        if (btn) btn.classList.remove('active');
    };

    // 创建标题选择弹层
    const createHeadingPopover = () => {
        let pop = toolbar.querySelector('.md-heading-popover');
        if (pop) return pop;

        pop = document.createElement('div');
        pop.className = 'md-heading-popover';
        preventCanvasEventsPropagation(pop);

        const h1Title = lang === 'en' ? 'Heading 1' : '一级标题';
        const h2Title = lang === 'en' ? 'Heading 2' : '二级标题';
        const h3Title = lang === 'en' ? 'Heading 3' : '三级标题';

        pop.innerHTML = `
            <button class="md-heading-option" data-action="md-heading-apply" data-level="h1" title="${h1Title}">H1</button>
            <button class="md-heading-option" data-action="md-heading-apply" data-level="h2" title="${h2Title}">H2</button>
            <button class="md-heading-option" data-action="md-heading-apply" data-level="h3" title="${h3Title}">H3</button>
        `;

        const formatPop = toolbar.querySelector('.md-format-popover');
        if (formatPop) {
            formatPop.appendChild(pop);
        }
        return pop;
    };

    // 切换标题弹层
    const toggleHeadingPopover = (btn) => {
        // 先保存当前选区
        const sel = window.getSelection();
        if (sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
            savedSelection = {
                range: sel.getRangeAt(0).cloneRange(),
                text: sel.toString()
            };
        }

        const pop = createHeadingPopover();
        const isOpen = pop.classList.contains('open');

        // 关闭其他弹层
        closeFontColorPopover();
        closeAlignPopover();
        closeListPopover();

        if (isOpen) {
            pop.classList.remove('open');
            btn.classList.remove('active');
            updateCanvasPopoverState(false);
        } else {
            positionPopoverAboveBtn(pop, btn);
            pop.classList.add('open');
            btn.classList.add('active');
            updateCanvasPopoverState(true);
        }
    };

    // 关闭标题弹层
    const closeHeadingPopover = () => {
        const pop = toolbar.querySelector('.md-heading-popover');
        if (pop) {
            pop.classList.remove('open');
            updateCanvasPopoverState(false);
        }
        const btn = toolbar.querySelector('[data-action="md-heading-toggle"]');
        if (btn) btn.classList.remove('active');
    };

    // 创建列表选择弹层
    const createListPopover = () => {
        let pop = toolbar.querySelector('.md-list-popover');
        if (pop) return pop;

        pop = document.createElement('div');
        pop.className = 'md-list-popover';
        preventCanvasEventsPropagation(pop);

        const ulTitle = lang === 'en' ? 'Bullet List' : '无序列表';
        const olTitle = lang === 'en' ? 'Numbered List' : '有序列表';
        const taskTitle = lang === 'en' ? 'Task List' : '任务列表';

        pop.innerHTML = `
            <button class="md-list-option" data-action="md-list-apply" data-type="ul" title="${ulTitle}"><i class="fas fa-list-ul"></i></button>
            <button class="md-list-option" data-action="md-list-apply" data-type="ol" title="${olTitle}"><i class="fas fa-list-ol"></i></button>
            <button class="md-list-option" data-action="md-list-apply" data-type="task" title="${taskTitle}"><i class="fas fa-tasks"></i></button>
        `;

        const formatPop = toolbar.querySelector('.md-format-popover');
        if (formatPop) {
            formatPop.appendChild(pop);
        }
        return pop;
    };

    // 切换列表弹层
    const toggleListPopover = (btn) => {
        // 先保存当前选区
        const sel = window.getSelection();
        if (sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
            savedSelection = {
                range: sel.getRangeAt(0).cloneRange(),
                text: sel.toString()
            };
        }

        const pop = createListPopover();
        const isOpen = pop.classList.contains('open');

        // 关闭其他弹层
        closeFontColorPopover();
        closeAlignPopover();
        closeHeadingPopover();

        if (isOpen) {
            pop.classList.remove('open');
            btn.classList.remove('active');
            updateCanvasPopoverState(false);
        } else {
            positionPopoverAboveBtn(pop, btn);
            pop.classList.add('open');
            btn.classList.add('active');
            updateCanvasPopoverState(true);
        }
    };

    // 关闭列表弹层
    const closeListPopover = () => {
        const pop = toolbar.querySelector('.md-list-popover');
        if (pop) {
            pop.classList.remove('open');
            updateCanvasPopoverState(false);
        }
        const btn = toolbar.querySelector('[data-action="md-list-toggle"]');
        if (btn) btn.classList.remove('active');
    };

    // 插入对齐格式
    const insertAlign = (alignType) => {
        if (!node.isEditing) {
            enterEdit();
            setTimeout(() => doInsertAlign(alignType), 50);
        } else {
            doInsertAlign(alignType);
        }
    };

    const doInsertAlign = (alignType) => {
        const sel = window.getSelection();
        let range;

        // 优先使用保存的选区
        if (savedSelection && savedSelection.range) {
            range = savedSelection.range;
            sel.removeAllRanges();
            sel.addRange(range);
        } else if (sel.rangeCount) {
            range = sel.getRangeAt(0);
        } else {
            editor.focus();
            return;
        }

        if (!editor.contains(range.commonAncestorContainer)) {
            editor.focus();
            return;
        }

        const selected = range.toString();
        const insertText = selected || (lang === 'en' ? 'text' : '文本');

        // 清除保存的选区
        savedSelection = null;

        let wrapper;
        if (alignType === 'center') {
            // 使用 <center> 标签
            wrapper = document.createElement('center');
            wrapper.textContent = insertText;
        } else {
            // 使用 <p align="xxx"> 标签
            wrapper = document.createElement('p');
            wrapper.setAttribute('align', alignType);
            wrapper.textContent = insertText;
        }

        range.deleteContents();
        range.insertNode(wrapper);

        const spacer = document.createTextNode('\u200B');
        wrapper.parentNode.insertBefore(spacer, wrapper.nextSibling);

        range.setStart(spacer, 1);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);

        node.html = editor.innerHTML;
        node.text = editor.innerText;
        saveTempNodes();

        editor.focus();
    };

    // 保存选区（用于工具栏点击时恢复）- 变量先声明，事件监听在editor创建后绑定
    let savedSelection = null;

    // 插入格式化 - 直接插入 HTML 标签（不是 Markdown 语法）
    const insertFormat = (formatType) => {
        if (!node.isEditing) {
            enterEdit();
            setTimeout(() => doInsert(formatType), 50);
        } else {
            doInsert(formatType);
        }
    };

    const doInsert = (formatType) => {
        // 获取当前选区
        const sel = window.getSelection();
        if (!sel.rangeCount) {
            editor.focus();
            return;
        }
        let range = sel.getRangeAt(0);

        // 确保 range 在 editor 内
        if (!editor.contains(range.commonAncestorContainer)) {
            editor.focus();
            return;
        }

        // 清除保存的选区
        savedSelection = null;

        // 判断是否为块级元素类型
        const isBlockFormat = ['h1', 'h2', 'h3', 'ul', 'ol', 'task', 'quote'].includes(formatType);

        // 对于块级元素，扩展选区到整行/整段
        let insertText;
        if (isBlockFormat) {
            // 获取光标所在的文本行
            const container = range.startContainer;
            let lineText = '';
            let lineStart = null;
            let lineEnd = null;

            // 找到包含选区的块级容器（div, p, 或 editor 本身）
            let blockContainer = container;
            if (container.nodeType === Node.TEXT_NODE) {
                blockContainer = container.parentElement;
            }

            // 如果是在 editor 直接子级的文本节点，则取整个文本节点
            if (blockContainer === editor || blockContainer.parentElement === editor) {
                if (container.nodeType === Node.TEXT_NODE) {
                    lineText = container.textContent;
                    lineStart = container;
                    lineEnd = container;
                } else {
                    lineText = range.toString() || (lang === 'en' ? 'text' : '文本');
                }
            } else {
                // 否则取整个块级容器的内容
                lineText = blockContainer.textContent;
                lineStart = blockContainer;
                lineEnd = blockContainer;
            }

            // 如果找到了整行内容，扩展选区
            if (lineStart && lineEnd && lineText.trim()) {
                insertText = lineText.trim();
                // 创建一个新的 range 覆盖整个行
                range = document.createRange();
                if (lineStart.nodeType === Node.TEXT_NODE) {
                    range.setStart(lineStart, 0);
                    range.setEnd(lineEnd, lineEnd.textContent.length);
                } else {
                    range.selectNodeContents(lineStart);
                }
                sel.removeAllRanges();
                sel.addRange(range);
            } else {
                insertText = range.toString() || (lang === 'en' ? 'text' : '文本');
            }
        } else {
            // 获取选中的文本
            const selected = range.toString();
            insertText = selected || (lang === 'en' ? 'text' : '文本');
        }

        // 插入格式化元素，并在后面添加零宽空格确保后续输入不继承格式
        let wrapper = null;

        switch (formatType) {
            case 'bold':
                wrapper = document.createElement('strong');
                wrapper.textContent = insertText;
                break;
            case 'italic':
                wrapper = document.createElement('em');
                wrapper.textContent = insertText;
                break;
            case 'underline':
                wrapper = document.createElement('u');
                wrapper.textContent = insertText;
                break;
            case 'highlight':
                wrapper = document.createElement('mark');
                wrapper.textContent = insertText;
                break;
            case 'strike':
                wrapper = document.createElement('del');
                wrapper.textContent = insertText;
                break;
            case 'code':
                wrapper = document.createElement('code');
                wrapper.textContent = insertText;
                break;
            case 'link':
                const url = prompt(lang === 'en' ? 'Enter URL:' : '请输入链接地址:', 'https://');
                if (url) {
                    wrapper = document.createElement('a');
                    wrapper.href = url;
                    wrapper.textContent = insertText;
                    wrapper.target = '_blank';
                }
                break;
            case 'h1':
                wrapper = document.createElement('h1');
                wrapper.textContent = insertText;
                break;
            case 'h2':
                wrapper = document.createElement('h2');
                wrapper.textContent = insertText;
                break;
            case 'h3':
                wrapper = document.createElement('h3');
                wrapper.textContent = insertText;
                break;
            case 'ul':
                wrapper = document.createElement('ul');
                const li1 = document.createElement('li');
                li1.textContent = insertText;
                wrapper.appendChild(li1);
                break;
            case 'ol':
                wrapper = document.createElement('ol');
                const li2 = document.createElement('li');
                li2.textContent = insertText;
                wrapper.appendChild(li2);
                break;
            case 'task':
                wrapper = document.createElement('div');
                wrapper.className = 'md-task-item';
                const taskCb = document.createElement('input');
                taskCb.type = 'checkbox';
                taskCb.className = 'md-task-checkbox';
                wrapper.appendChild(taskCb);
                wrapper.appendChild(document.createTextNode(' ' + insertText));
                break;
            case 'quote':
                wrapper = document.createElement('blockquote');
                wrapper.textContent = insertText;
                break;
        }

        if (wrapper) {
            range.deleteContents();
            range.insertNode(wrapper);

            // 在格式化元素后添加一个空文本节点，确保后续输入不继承格式
            const spacer = document.createTextNode('\u200B'); // 零宽空格
            wrapper.parentNode.insertBefore(spacer, wrapper.nextSibling);

            // 移动光标到空文本节点内
            range.setStart(spacer, 1);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);

            // 保存内容
            node.html = editor.innerHTML;
            node.text = editor.innerText;
            saveTempNodes();
            try { if (undoManager) undoManager.scheduleRecord('tool-insert'); } catch (_) { }
        }

        editor.focus();
    };

    // 编辑器（实时渲染的 WYSIWYG 编辑器）
    const editor = document.createElement('div');
    editor.className = 'md-canvas-editor md-wysiwyg-editor md-canvas-text';
    editor.contentEditable = 'true';
    editor.spellcheck = false;

    // 应用字体大小
    editor.style.fontSize = node.fontSize + 'px';

    const mdPlaceholder = (lang === 'en')
        ? 'Type Markdown: **bold**, *italic*, ==highlight=='
        : '输入 Markdown：**粗体**、*斜体*、==高亮==';
    editor.setAttribute('data-placeholder', mdPlaceholder);
    editor.setAttribute('aria-label', mdPlaceholder);

    // 初始化编辑器内容：优先使用保存的 HTML，否则从 text 渲染
    if (node.html) {
        editor.innerHTML = node.html;
    } else {
        const raw = typeof node.text === 'string' ? node.text : '';
        if (raw) {
            if (typeof marked !== 'undefined') {
                try { editor.innerHTML = marked.parse(raw); } catch { editor.textContent = raw; }
            } else {
                editor.textContent = raw;
            }
        }
    }
    try { __applyHeadingCollapse(editor); } catch (_) { }

    // 保存选区函数（用于工具栏点击时恢复）
    const saveSelection = () => {
        const sel = window.getSelection();
        if (sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
            savedSelection = {
                range: sel.getRangeAt(0).cloneRange(),
                text: sel.toString()
            };
        }
    };

    // 监听mouseup/keyup保存选区（在点击工具栏前保存）
    editor.addEventListener('mouseup', saveSelection);
    editor.addEventListener('keyup', saveSelection);

    // 持久化：空白栏目滚动位置
    const scrollKey = `md-node-scroll:${node.id}`;
    // 恢复滚动位置
    const scrollPersist = __readJSON(scrollKey, null);
    if (scrollPersist && typeof scrollPersist.top === 'number') {
        editor.scrollTop = scrollPersist.top || 0;
        editor.scrollLeft = scrollPersist.left || 0;
    }
    // 保存滚动位置
    {
        let rafS = 0;
        editor.addEventListener('scroll', () => {
            if (rafS) cancelAnimationFrame(rafS);
            rafS = requestAnimationFrame(() => __writeJSON(scrollKey, { top: editor.scrollTop || 0, left: editor.scrollLeft || 0 }));
        }, { passive: true });
    }

    // 格式化元素与 Markdown 语法的映射
    const formatMap = {
        'STRONG': { prefix: '**', suffix: '**' },
        'B': { prefix: '**', suffix: '**' },
        'EM': { prefix: '*', suffix: '*' },
        'I': { prefix: '*', suffix: '*' },
        // underline 使用 HTML 语法（便于“展开为源码/离开后重渲染”的体验）
        'U': { prefix: '<u>', suffix: '</u>' },
        'DEL': { prefix: '~~', suffix: '~~' },
        'S': { prefix: '~~', suffix: '~~' },
        'MARK': { prefix: '==', suffix: '==' },
        'CODE': { prefix: '`', suffix: '`' },
    };

    // 当前展开的元素（用于失焦时重新渲染）
    let expandedElement = null;
    let expandedMarkdown = null;
    let expandedType = null; // 'simple' | 'fontcolor' | 'align'

    // 统一判定：当前光标是否仍在“展开的源码文本节点”内
    const isCaretInsideExpandedSource = () => {
        if (!expandedElement || !expandedElement.parentNode) return false;
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return false;
        const range = sel.getRangeAt(0);
        return range && range.startContainer === expandedElement;
    };

    // 只要光标离开展开的源码节点，就立即重渲染
    const scheduleReRenderIfCaretLeftExpanded = (() => {
        let rafId = 0;
        return () => {
            if (!expandedElement || !expandedElement.parentNode) return;
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                rafId = 0;
                if (expandedElement && expandedElement.parentNode && !isCaretInsideExpandedSource()) {
                    reRenderExpanded();
                }
            });
        };
    })();

    // 获取特殊格式元素的源码表示
    const getSourceCode = (el) => {
        const tagName = el.tagName;
        const content = el.textContent;
        const htmlContent = el.innerHTML; // 用于需要保留内部 HTML 的元素

        // font color: <font color="#xxx">text</font>（保留内部 HTML）
        if (tagName === 'FONT') {
            const color = el.getAttribute('color') || '#000000';
            return {
                source: `<font color="${color}">${htmlContent}</font>`,
                prefix: `<font color="${color}">`,
                suffix: '</font>',
                type: 'fontcolor'
            };
        }

        // center: <center>text</center>（保留内部 HTML）
        if (tagName === 'CENTER') {
            return {
                source: `<center>${htmlContent}</center>`,
                prefix: '<center>',
                suffix: '</center>',
                type: 'align'
            };
        }

        // p with align: <p align="xxx">text</p>（保留内部 HTML）
        if (tagName === 'P' && el.hasAttribute('align')) {
            const align = el.getAttribute('align');
            return {
                source: `<p align="${align}">${htmlContent}</p>`,
                prefix: `<p align="${align}">`,
                suffix: '</p>',
                type: 'align'
            };
        }

        // hr: --- 水平分割线
        if (tagName === 'HR') {
            return {
                source: '---',
                prefix: '',
                suffix: '',
                type: 'hr'
            };
        }

        // blockquote: > text（保留内部 HTML）
        if (tagName === 'BLOCKQUOTE') {
            return {
                source: `> ${htmlContent}`,
                prefix: '> ',
                suffix: '',
                type: 'quote'
            };
        }

        // li: - item / 1. item（保留内部 HTML）
        if (tagName === 'LI') {
            const parent = el.parentElement;
            const itemHtml = (el.innerHTML || '').trim();
            if (parent && parent.tagName === 'UL') {
                return {
                    source: `- ${itemHtml}`,
                    prefix: '- ',
                    suffix: '',
                    type: 'li-ul'
                };
            }
            if (parent && parent.tagName === 'OL') {
                const siblings = Array.from(parent.children).filter(child => child && child.tagName === 'LI');
                const idx = siblings.indexOf(el) + 1;
                const n = idx > 0 ? idx : 1;
                return {
                    source: `${n}. ${itemHtml}`,
                    prefix: `${n}. `,
                    suffix: '',
                    type: 'li-ol'
                };
            }
        }

        // ul: - item（保留内部 HTML）
        if (tagName === 'UL') {
            const items = Array.from(el.querySelectorAll('li')).map(li => `- ${li.innerHTML}`).join('\n');
            return {
                source: items,
                prefix: '- ',
                suffix: '',
                type: 'ul'
            };
        }

        // ol: 1. item（保留内部 HTML）
        if (tagName === 'OL') {
            const items = Array.from(el.querySelectorAll('li')).map((li, i) => `${i + 1}. ${li.innerHTML}`).join('\n');
            return {
                source: items,
                prefix: '1. ',
                suffix: '',
                type: 'ol'
            };
        }

        // task: - [ ] text 或 - [x] text（保留内部 HTML）
        if (el.classList && el.classList.contains('md-task-item')) {
            const checkbox = el.querySelector('input[type="checkbox"]');
            const checked = checkbox && checkbox.checked;
            // 获取除 checkbox 以外的内容
            const clone = el.cloneNode(true);
            const cb = clone.querySelector('input[type="checkbox"]');
            if (cb) cb.remove();
            const taskHtml = clone.innerHTML.trim();
            return {
                source: checked ? `- [x] ${taskHtml}` : `- [ ] ${taskHtml}`,
                prefix: checked ? '- [x] ' : '- [ ] ',
                suffix: '',
                type: 'task'
            };
        }

        // 标题: 支持 ATX 和 Setext 两种格式
        // Setext 格式通过 dataset.setextType 标识
        // 标准规则: === → H1, --- → H2
        if (tagName === 'H1') {
            // 检查是否为 Setext 格式（--- → H1）
            if (el.dataset && el.dataset.setextType) {
                const separator = el.dataset.setextType;
                // 从渲染的元素中提取标题文字
                // 元素结构：标题文字 + <br> + <span class="setext-separator">分隔符</span>
                // 使用 childNodes 提取纯文本部分（不包括 separator span）
                let headerText = '';
                for (let node of el.childNodes) {
                    if (node.nodeType === Node.TEXT_NODE) {
                        headerText += node.textContent;
                    } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'BR' && !node.classList.contains('setext-separator')) {
                        headerText += node.textContent;
                    }
                }
                headerText = headerText.trim();

                return {
                    source: `${headerText}\n${separator}`,
                    prefix: '',
                    suffix: '\n' + separator,
                    type: 'setext-heading'
                };
            }
            return {
                source: `# ${htmlContent}`,
                prefix: '# ',
                suffix: '',
                type: 'heading'
            };
        }
        if (tagName === 'H2') {
            // 检查是否为 Setext 格式（=== → H2）
            if (el.dataset && el.dataset.setextType) {
                const separator = el.dataset.setextType;
                // 从渲染的元素中提取标题文字
                // 元素结构：标题文字 + <br> + <span class="setext-separator">分隔符</span>
                // 使用 childNodes 提取纯文本部分（不包括 separator span）
                let headerText = '';
                for (let node of el.childNodes) {
                    if (node.nodeType === Node.TEXT_NODE) {
                        headerText += node.textContent;
                    } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'BR' && !node.classList.contains('setext-separator')) {
                        headerText += node.textContent;
                    }
                }
                headerText = headerText.trim();

                return {
                    source: `${headerText}\n${separator}`,
                    prefix: '',
                    suffix: '\n' + separator,
                    type: 'setext-heading'
                };
            }
            return {
                source: `## ${htmlContent}`,
                prefix: '## ',
                suffix: '',
                type: 'heading'
            };
        }
        if (tagName === 'H3') {
            return {
                source: `### ${htmlContent}`,
                prefix: '### ',
                suffix: '',
                type: 'heading'
            };
        }
        if (tagName === 'H4') {
            return {
                source: `#### ${htmlContent}`,
                prefix: '#### ',
                suffix: '',
                type: 'heading'
            };
        }
        if (tagName === 'H5') {
            return {
                source: `##### ${htmlContent}`,
                prefix: '##### ',
                suffix: '',
                type: 'heading'
            };
        }
        if (tagName === 'H6') {
            return {
                source: `###### ${htmlContent}`,
                prefix: '###### ',
                suffix: '',
                type: 'heading'
            };
        }

        return null;
    };

    // 点击格式化元素时展开为源码
    // cursorPosition: 'middle'(默认), 'start', 'end'
    const expandToMarkdown = (formattedEl, cursorPosition = 'middle') => {
        const tagName = formattedEl.tagName;

        // 处理特殊格式（font color, alignment, headings, hr 等）
        const specialFormat = getSourceCode(formattedEl);
        if (specialFormat) {
            const parent = formattedEl.parentNode;

            // 对于 Setext 标题，需要用 <br> 来表示换行（contenteditable 不显示 \n）
            if (specialFormat.type === 'setext-heading') {
                // 从渲染的元素中提取标题文字（不包括分隔符）
                // 元素结构：标题文字 + <br> + <span class="setext-separator">分隔符</span>
                let headerText = '';
                for (let node of formattedEl.childNodes) {
                    if (node.nodeType === Node.TEXT_NODE) {
                        headerText += node.textContent;
                    } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'BR' && !node.classList.contains('setext-separator')) {
                        headerText += node.textContent;
                    }
                }
                headerText = headerText.trim();

                const underline = formattedEl.dataset.setextType || '---';

                const textNode1 = document.createTextNode(headerText);
                const brNode = document.createElement('br');
                const textNode2 = document.createTextNode(underline);

                parent.insertBefore(textNode1, formattedEl);
                parent.insertBefore(brNode, formattedEl);
                parent.insertBefore(textNode2, formattedEl);
                parent.removeChild(formattedEl);

                expandedElement = textNode2; // 记录下划线节点
                expandedMarkdown = specialFormat.source;
                expandedType = specialFormat.type;

                // 光标放在下划线末尾
                const sel = window.getSelection();
                const range = document.createRange();
                range.setStart(textNode2, textNode2.length);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);

                return true;
            }

            const textNode = document.createTextNode(specialFormat.source);
            parent.replaceChild(textNode, formattedEl);

            // 对于通过 # 语法形成的标题，在源码行后面显式插入一个 <br>
            // 确保原本在标题下一行的内容不会“挤到”同一行右侧
            if (specialFormat.type === 'heading') {
                const nextSibling = textNode.nextSibling;
                if (!nextSibling || !(nextSibling.nodeType === Node.ELEMENT_NODE && nextSibling.tagName === 'BR')) {
                    const brAfter = document.createElement('br');
                    brAfter.setAttribute('data-md-auto-br', 'heading');
                    if (nextSibling) {
                        parent.insertBefore(brAfter, nextSibling);
                    } else {
                        parent.appendChild(brAfter);
                    }
                }
            }

            expandedElement = textNode;
            expandedMarkdown = specialFormat.source;
            expandedType = specialFormat.type;

            const sel = window.getSelection();
            const range = document.createRange();
            let cursorPos;
            if (cursorPosition === 'start') {
                cursorPos = 0;
            } else if (cursorPosition === 'end') {
                cursorPos = specialFormat.source.length;
            } else {
                // 对于没有文本内容的元素（如 hr），光标放在中间
                const contentLen = formattedEl.textContent ? formattedEl.textContent.length : 0;
                cursorPos = specialFormat.prefix.length + Math.floor(contentLen / 2);
                // 确保光标位置在有效范围内
                cursorPos = Math.max(0, Math.min(cursorPos, specialFormat.source.length));
            }
            range.setStart(textNode, Math.min(cursorPos, textNode.length));
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);

            return true;
        }

        // 处理简单格式（Markdown）
        const format = formatMap[tagName];
        if (!format) return false;

        // 使用 innerHTML 保留内部 HTML 格式
        const innerHtml = formattedEl.innerHTML;
        const markdown = format.prefix + innerHtml + format.suffix;

        // 创建文本节点替换格式化元素
        const textNode = document.createTextNode(markdown);
        formattedEl.parentNode.replaceChild(textNode, formattedEl);

        // 记录展开的状态
        expandedElement = textNode;
        expandedMarkdown = markdown;
        expandedType = 'simple';

        // 根据参数决定光标位置
        const sel = window.getSelection();
        const range = document.createRange();
        let cursorPos;
        const plainTextLen = formattedEl.textContent ? formattedEl.textContent.length : 0;
        if (cursorPosition === 'start') {
            cursorPos = 0;
        } else if (cursorPosition === 'end') {
            cursorPos = markdown.length;
        } else {
            cursorPos = format.prefix.length + Math.floor(plainTextLen / 2);
        }
        range.setStart(textNode, cursorPos);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);

        return true;
    };

    // 实时 Markdown 渲染：检测并转换 Markdown 语法
    const liveRenderMarkdown = () => {
        const sel = window.getSelection();
        if (!sel.rangeCount) return;

        const range = sel.getRangeAt(0);
        if (!editor.contains(range.startContainer)) return;

        // 获取当前光标所在的文本节点
        let textNode = range.startContainer;
        if (textNode.nodeType !== Node.TEXT_NODE) return;

        // 如果正在编辑展开的元素，不要渲染
        if (textNode === expandedElement) return;

        const text = textNode.textContent;
        const cursorPos = range.startOffset;

        // 辅助函数：查找下一个“行”节点（兼容 TextNode 和 Block Element）
        const findNextLineNode = (node) => {
            let next = node.nextSibling;

            // 1. 同级查找
            while (next) {
                // 跳过空文本/注释
                if (next.nodeType === Node.TEXT_NODE && !next.textContent.trim()) {
                    next = next.nextSibling;
                    continue;
                }
                // 跳过 BR
                if (next.tagName === 'BR') {
                    next = next.nextSibling;
                    continue;
                }
                break;
            }

            if (next) return next;

            // 2. 跨块查找 (如果当前在 DIV/P 内，找父元素的下一个兄弟)
            const parent = node.parentNode;
            if (parent && (parent.tagName === 'DIV' || parent.tagName === 'P') && parent.parentNode === editor) {
                let nextBlock = parent.nextSibling;
                while (nextBlock && nextBlock.nodeType === Node.TEXT_NODE && !nextBlock.textContent.trim()) {
                    nextBlock = nextBlock.nextSibling;
                }
                if (nextBlock) return nextBlock;
            }

            return null;
        };

        // 辅助函数：查找上一个“行”节点（兼容 TextNode 和 Block Element）
        const findPrevLineNode = (node) => {
            let prev = node.previousSibling;

            // 1. 同级查找
            while (prev) {
                if (prev.nodeType === Node.TEXT_NODE && !prev.textContent.trim()) {
                    prev = prev.previousSibling;
                    continue;
                }
                if (prev.tagName === 'BR') {
                    prev = prev.previousSibling;
                    continue;
                }
                break;
            }

            if (prev) return prev;

            // 2. 跨块查找
            const parent = node.parentNode;
            if (parent && (parent.tagName === 'DIV' || parent.tagName === 'P') && parent.parentNode === editor) {
                let prevBlock = parent.previousSibling;
                while (prevBlock && prevBlock.nodeType === Node.TEXT_NODE && !prevBlock.textContent.trim()) {
                    prevBlock = prevBlock.previousSibling;
                }
                if (prevBlock) return prevBlock;
            }

            return null;
        };

        // 获取节点文本内容的辅助函数
        const getNodeText = (node) => {
            return node.textContent || '';
        };

        // Setext 标题前瞻检测（当在标题文本行输入时，检测下一行是否为分隔符）
        // 只有当当前行不是分隔符时才进行检测
        const isSeparator = /^[\u200B]*([-=])\1+\s*$/.test(text);
        if (!isSeparator && text.trim()) {
            const nextNode = findNextLineNode(textNode);

            let foundSetext = false;
            let setextLevel = ''; // h1 or h2
            let setextType = ''; // --- or ===

            if (nextNode) {
                const nextText = getNodeText(nextNode);

                // 1. 下一行是 HR 元素（对应 ---）
                if (nextNode.tagName === 'HR') {
                    // Text + HR(---) => H2
                    foundSetext = true;
                    setextLevel = 'h2';
                    setextType = '---';
                }
                // 2. 下一行是文本（TextNode 或 Block），且内容是 --- 或 ===
                else {
                    const dashMatch = nextText.match(/^[\u200B]*(-{3,})\s*$/);
                    const equalMatch = nextText.match(/^[\u200B]*(={3,})\s*$/);

                    if (dashMatch) {
                        // Text + --- => H2
                        foundSetext = true;
                        setextLevel = 'h2';
                        setextType = dashMatch[1];  // 保存实际的分隔符（如 ---、----、-----）
                    } else if (equalMatch) {
                        // Text + === => H1
                        foundSetext = true;
                        setextLevel = 'h1';
                        setextType = equalMatch[1];  // 保存实际的分隔符（如 ===、====、=====）
                    }
                }
            }

            if (foundSetext) {
                const newEl = document.createElement(setextLevel);
                // Setext 标题显示为：标题文字 + 换行 + 分隔符（两行，分隔符保持原始大小）
                const headerTextEscaped = text.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;');
                newEl.innerHTML = `${headerTextEscaped}<br><span class="setext-separator" style="font-size: 14px; font-weight: normal; color: #999;">${setextType}</span>`;
                newEl.dataset.setextType = setextType;

                // 插入新标题（位置在当前节点之前）
                const insertParent = textNode.parentNode === editor ? editor : textNode.parentNode.parentNode;
                const insertRef = textNode.parentNode === editor ? textNode : textNode.parentNode;

                insertParent.insertBefore(newEl, insertRef);

                // 移除旧节点（当前文本节点 + 下一行节点）
                // 注意：如果是在块元素内，可能需要移除整个块
                const removeNodeAndBlock = (n) => {
                    if (!n) return;
                    if (n.parentNode === editor) {
                        // Block element or direct text node
                        editor.removeChild(n);
                    } else if (n.parentNode && n.parentNode.parentNode === editor && (n.parentNode.tagName === 'DIV' || n.parentNode.tagName === 'P')) {
                        // Inside a block, remove the whole block
                        editor.removeChild(n.parentNode);
                    } else if (n.parentNode) {
                        n.parentNode.removeChild(n);
                    }
                };

                // 移除当前节点
                removeNodeAndBlock(textNode);

                // 移除下一行节点
                removeNodeAndBlock(nextNode);

                // 在后面添加零宽空格
                const afterNode = document.createTextNode('\u200B');
                if (newEl.nextSibling) {
                    insertParent.insertBefore(afterNode, newEl.nextSibling);
                } else {
                    insertParent.appendChild(afterNode);
                }

                // 恢复光标位置
                const newRange = document.createRange();
                newRange.setStart(afterNode, 1);
                newRange.collapse(true);
                sel.removeAllRanges();
                sel.addRange(newRange);

                expandedElement = null;
                expandedMarkdown = null;
                expandedType = null;

                saveEditorContent();
                return;
            }
        }

        // Markdown 模式列表（按优先级排序）
        const patterns = [
            { regex: /\*\*(.+?)\*\*/, tag: 'strong' },           // **粗体**
            { regex: /\*(.+?)\*/, tag: 'em' },                   // *斜体*
            { regex: /~~(.+?)~~/, tag: 'del' },                  // ~~删除线~~
            { regex: /==(.+?)==/, tag: 'mark' },                 // ==高亮==
            { regex: /`([^`]+)`/, tag: 'code' },                 // `代码`
            { regex: /\[\[(.+?)\]\]/, tag: 'span', className: 'md-wikilink' }, // [[链接]]
        ];

        // HTML 标签模式（font color, center, p align）
        const htmlPatterns = [
            { regex: /<font\s+color=["']?([^"'>]+)["']?>([^<]*)<\/font>/i, tag: 'font', attrName: 'color', attrIndex: 1, contentIndex: 2 },
            { regex: /<center>([^<]*)<\/center>/i, tag: 'center', contentIndex: 1 },
            { regex: /<p\s+align=["']?([^"'>]+)["']?>([^<]*)<\/p>/i, tag: 'p', attrName: 'align', attrIndex: 1, contentIndex: 2 },
            { regex: /<u>([^<]*)<\/u>/i, tag: 'u', contentIndex: 1 },
        ];

        // Setext 标题和水平分割线检测（回溯检测：当输入分隔符时，检测上一行是否为标题文本）
        const setextDashMatch = text.match(/^[\u200B]*(-{3,})\s*$/);    // --- → H1
        const setextEqualMatch = text.match(/^[\u200B]*(={3,})\s*$/);   // === → H2

        if (setextDashMatch || setextEqualMatch) {
            const prevNode = findPrevLineNode(textNode);

            if (prevNode) {
                // 获取上一行的文本内容（移除零宽空格）
                const headerText = getNodeText(prevNode).replace(/\u200B/g, '').trim();

                // 如果上一行是 HR 元素、空内容、或只包含零宽空格，不尝试创建标题，直接跳过
                if (prevNode.tagName === 'HR' || !headerText || /^[-=]{3,}$/.test(headerText)) {
                    // 继续执行后续的 HR 创建逻辑
                } else {
                    // 确保上一行有有效内容且不是分隔符
                    if (headerText) {
                        // 标准规则: === → H1, --- → H2
                        const level = setextDashMatch ? 'h1' : 'h2';
                        const separator = setextDashMatch ? setextDashMatch[1] : setextEqualMatch[1];

                        const newEl = document.createElement(level);
                        // Setext 标题显示为：标题文字 + 换行 + 分隔符（两行，分隔符保持原始大小）
                        const headerTextEscaped = headerText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                        newEl.innerHTML = `${headerTextEscaped}<br><span class="setext-separator" style="font-size: 14px; font-weight: normal; color: #999;">${separator}</span>`;
                        newEl.dataset.setextType = separator;

                        // 插入位置确定
                        const insertParent = textNode.parentNode === editor ? editor : textNode.parentNode.parentNode;
                        const insertRef = (prevNode.parentNode === editor) ? prevNode : prevNode.parentNode;

                        insertParent.insertBefore(newEl, insertRef);

                        // 移除节点Helper
                        const removeNodeAndBlock = (n) => {
                            if (!n) return;
                            if (n.parentNode === editor) {
                                editor.removeChild(n);
                            } else if (n.parentNode && n.parentNode.parentNode === editor && (n.parentNode.tagName === 'DIV' || n.parentNode.tagName === 'P')) {
                                editor.removeChild(n.parentNode);
                            } else if (n.parentNode) {
                                n.parentNode.removeChild(n);
                            }
                        };

                        // 移除上一行
                        removeNodeAndBlock(prevNode);

                        // 移除当前行（分隔符）
                        removeNodeAndBlock(textNode);

                        // 移除当前的 ---/=== 文本节点
                        const afterNode = document.createTextNode('\u200B');
                        if (newEl.nextSibling) {
                            insertParent.insertBefore(afterNode, newEl.nextSibling);
                        } else {
                            insertParent.appendChild(afterNode);
                        }

                        // 恢复光标位置
                        const newRange = document.createRange();
                        newRange.setStart(afterNode, afterNode.textContent.length);
                        newRange.collapse(true);
                        sel.removeAllRanges();
                        sel.addRange(newRange);

                        expandedElement = null;
                        expandedMarkdown = null;
                        expandedType = null;

                        saveEditorContent();
                        return;
                    }
                }
            }

            // 逻辑 2: 水平分割线 (仅限 ---, 且没有形成标题时)
            if (setextDashMatch) {
                const hr = document.createElement('hr');

                const parent = textNode.parentNode;

                // 如果在 Block 内，需要在 Block 外插入 HR，或者把 Block 替换
                if (parent.tagName === 'DIV' || parent.tagName === 'P') {
                    // 在 Block 前插入 HR
                    parent.parentNode.insertBefore(hr, parent);

                    // 清空当前 Block 的内容，保留 Block 本身以保持光标位置
                    textNode.textContent = '\u200B';

                    // 设置光标
                    try {
                        const newRange = document.createRange();
                        newRange.setStart(textNode, 1);
                        newRange.collapse(true);
                        sel.removeAllRanges();
                        sel.addRange(newRange);
                    } catch (e) {
                        // 光标设置失败，静默处理
                    }
                } else {
                    // 在当前文本节点前插入 HR
                    parent.insertBefore(hr, textNode);

                    // 清空当前文本节点为零宽空格
                    textNode.textContent = '\u200B';

                    // 设置光标
                    try {
                        const newRange = document.createRange();
                        newRange.setStart(textNode, 1);
                        newRange.collapse(true);
                        sel.removeAllRanges();
                        sel.addRange(newRange);
                    } catch (e) {
                        // 光标设置失败，静默处理
                    }
                }

                expandedElement = null;
                expandedMarkdown = null;
                expandedType = null;

                saveEditorContent();
                return;
            }
        }

        // 块级 Markdown 模式（需要特殊处理）
        // ATX 标题规则：
        //   - # 必须在行首
        //   - # 后面必须有至少一个空格
        //   - 支持 H1-H6（1-6个 #）
        //   - 超过6个 # 不会被渲染为标题
        //   - #标题（无空格）不会被渲染
        //   -兼容零宽空格(\u200B)
        const blockPatterns = [
            { regex: /^[\u200B]*######\s(.+)$/, type: 'h6', contentIndex: 1 },    // ###### 六级标题
            { regex: /^[\u200B]*#####\s(.+)$/, type: 'h5', contentIndex: 1 },     // ##### 五级标题
            { regex: /^[\u200B]*####\s(.+)$/, type: 'h4', contentIndex: 1 },      // #### 四级标题
            { regex: /^[\u200B]*###\s(.+)$/, type: 'h3', contentIndex: 1 },       // ### 三级标题
            { regex: /^[\u200B]*##\s(.+)$/, type: 'h2', contentIndex: 1 },        // ## 二级标题
            { regex: /^[\u200B]*#\s(.+)$/, type: 'h1', contentIndex: 1 },         // # 一级标题
            { regex: /^[\u200B]*>\s*(.*)$/, type: 'blockquote', contentIndex: 1 },
            { regex: /^[\u200B]*-\s+\[\s*\]\s*(.*)$/, type: 'task-unchecked', contentIndex: 1 },
            { regex: /^[\u200B]*-\s+\[x\]\s*(.*)$/i, type: 'task-checked', contentIndex: 1 },
            { regex: /^[\u200B]*-\s+(.+)$/, type: 'ul', contentIndex: 1 },
            { regex: /^[\u200B]*(\d+)\.\s+(.+)$/, type: 'ol', contentIndex: 2 },
        ];

        // 检查块级模式
        for (const pattern of blockPatterns) {
            const match = text.match(pattern.regex);
            // 放宽条件：只要匹配成功就尝试渲染（不要求光标必须在末尾）
            if (match) {
                let newEl;
                const parent = textNode.parentNode;

                // 辅助函数：将内联 Markdown 语法转换为 HTML
                const parseInlineMarkdown = (text) => {
                    if (!text) return text;
                    // 按顺序处理：粗体、斜体、删除线、高亮、代码
                    return text
                        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                        .replace(/\*(.+?)\*/g, '<em>$1</em>')
                        .replace(/~~(.+?)~~/g, '<del>$1</del>')
                        .replace(/==(.+?)==/g, '<mark>$1</mark>')
                        .replace(/`([^`]+)`/g, '<code>$1</code>');
                };

                // 辅助函数：安全地设置元素内容
                const setContent = (element, content) => {
                    // 先解析 Markdown 再用 innerHTML
                    const parsed = parseInlineMarkdown(content);
                    if (/<[^>]+>/.test(parsed)) {
                        element.innerHTML = parsed;
                    } else {
                        element.textContent = content;
                    }
                };

                // ATX 标题处理
                if (pattern.type === 'h1') {
                    newEl = document.createElement('h1');
                    setContent(newEl, match[pattern.contentIndex] || '');
                } else if (pattern.type === 'h2') {
                    newEl = document.createElement('h2');
                    setContent(newEl, match[pattern.contentIndex] || '');
                } else if (pattern.type === 'h3') {
                    newEl = document.createElement('h3');
                    setContent(newEl, match[pattern.contentIndex] || '');
                } else if (pattern.type === 'h4') {
                    newEl = document.createElement('h4');
                    setContent(newEl, match[pattern.contentIndex] || '');
                } else if (pattern.type === 'h5') {
                    newEl = document.createElement('h5');
                    setContent(newEl, match[pattern.contentIndex] || '');
                } else if (pattern.type === 'h6') {
                    newEl = document.createElement('h6');
                    setContent(newEl, match[pattern.contentIndex] || '');
                } else if (pattern.type === 'blockquote') {
                    newEl = document.createElement('blockquote');
                    setContent(newEl, match[pattern.contentIndex] || '');
                } else if (pattern.type === 'task-unchecked' || pattern.type === 'task-checked') {
                    newEl = document.createElement('div');
                    newEl.className = 'md-task-item';
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.className = 'md-task-checkbox';
                    checkbox.checked = pattern.type === 'task-checked';
                    newEl.appendChild(checkbox);
                    // 任务内容可能包含 HTML
                    const contentSpan = document.createElement('span');
                    setContent(contentSpan, ' ' + (match[pattern.contentIndex] || ''));
                    newEl.appendChild(contentSpan);
                } else if (pattern.type === 'ul') {
                    newEl = document.createElement('ul');
                    const li = document.createElement('li');
                    setContent(li, match[pattern.contentIndex] || '');
                    newEl.appendChild(li);
                } else if (pattern.type === 'ol') {
                    newEl = document.createElement('ol');
                    const li = document.createElement('li');
                    setContent(li, match[pattern.contentIndex] || '');
                    newEl.appendChild(li);
                }

                if (newEl) {
                    const afterNode = document.createTextNode('\u200B');
                    parent.insertBefore(newEl, textNode);
                    parent.insertBefore(afterNode, textNode);
                    parent.removeChild(textNode);

                    const newRange = document.createRange();
                    newRange.setStart(afterNode, 1);
                    newRange.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(newRange);

                    expandedElement = null;
                    expandedMarkdown = null;
                    expandedType = null;

                    saveEditorContent();
                    return;
                }
            }
        }

        // 先检查 HTML 模式
        for (const pattern of htmlPatterns) {
            const match = text.match(pattern.regex);
            if (match && match.index !== undefined) {
                const matchStart = match.index;
                const matchEnd = matchStart + match[0].length;

                if (cursorPos >= matchEnd) {
                    const before = text.substring(0, matchStart);
                    const content = match[pattern.contentIndex];
                    const after = text.substring(matchEnd);
                    const cursorInAfter = Math.max(0, Math.min(cursorPos - matchEnd, after.length));

                    const newEl = document.createElement(pattern.tag);
                    if (pattern.attrName && pattern.attrIndex) {
                        newEl.setAttribute(pattern.attrName, match[pattern.attrIndex]);
                    }
                    // 如果内容包含 HTML 标签则用 innerHTML
                    if (/<[^>]+>/.test(content)) {
                        newEl.innerHTML = content;
                    } else {
                        newEl.textContent = content;
                    }

                    const parent = textNode.parentNode;
                    const beforeNode = document.createTextNode(before);
                    const afterNode = document.createTextNode(after || '\u200B');

                    parent.insertBefore(beforeNode, textNode);
                    parent.insertBefore(newEl, textNode);
                    parent.insertBefore(afterNode, textNode);
                    parent.removeChild(textNode);

                    const newRange = document.createRange();
                    newRange.setStart(afterNode, after ? cursorInAfter : 1);
                    newRange.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(newRange);

                    expandedElement = null;
                    expandedMarkdown = null;
                    expandedType = null;

                    saveEditorContent();
                    return;
                }
            }
        }

        // 检查 Markdown 模式
        for (const pattern of patterns) {
            const match = text.match(pattern.regex);
            if (match && match.index !== undefined) {
                const matchStart = match.index;
                const matchEnd = matchStart + match[0].length;

                // 只在光标位于匹配文本之后时才渲染（即用户刚完成输入）
                if (cursorPos >= matchEnd) {
                    const before = text.substring(0, matchStart);
                    const content = match[1];
                    const after = text.substring(matchEnd);
                    const cursorInAfter = Math.max(0, Math.min(cursorPos - matchEnd, after.length));

                    // 创建新元素
                    const newEl = document.createElement(pattern.tag);
                    if (pattern.className) newEl.className = pattern.className;
                    // 如果内容包含 HTML 标签则用 innerHTML
                    if (/<[^>]+>/.test(content)) {
                        newEl.innerHTML = content;
                    } else {
                        newEl.textContent = content;
                    }

                    // 替换文本节点
                    const parent = textNode.parentNode;
                    const beforeNode = document.createTextNode(before);
                    // 如果后面没有内容，添加零宽空格确保光标位置正确且后续输入不继承格式
                    const afterNode = document.createTextNode(after || '\u200B');

                    parent.insertBefore(beforeNode, textNode);
                    parent.insertBefore(newEl, textNode);
                    parent.insertBefore(afterNode, textNode);
                    parent.removeChild(textNode);

                    // 将光标移到新元素之后
                    const newRange = document.createRange();
                    newRange.setStart(afterNode, after ? cursorInAfter : 1);
                    newRange.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(newRange);

                    // 清除展开状态
                    expandedElement = null;
                    expandedMarkdown = null;
                    expandedType = null;

                    // 保存内容
                    saveEditorContent();
                    return;
                }
            }
        }
    };

    // 重新渲染展开的 Markdown（当光标离开时）
    const reRenderExpanded = () => {
        if (!expandedElement || !expandedElement.parentNode) {
            expandedElement = null;
            expandedMarkdown = null;
            expandedType = null;
            return;
        }

        // 辅助函数：将内联 Markdown 语法转换为 HTML
        const parseInlineMarkdown = (text) => {
            if (!text) return text;
            return text
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.+?)\*/g, '<em>$1</em>')
                .replace(/~~(.+?)~~/g, '<del>$1</del>')
                .replace(/==(.+?)==/g, '<mark>$1</mark>')
                .replace(/`([^`]+)`/g, '<code>$1</code>');
        };

        const textNode = expandedElement;
        const text = textNode.textContent;
        const savedType = expandedType;

        // 清除展开状态（必须在渲染前清除）
        expandedElement = null;
        expandedMarkdown = null;
        expandedType = null;

        // 列表项：LI 级别的源码 → 还原回 <li>
        if (savedType === 'li-ul' || savedType === 'li-ol') {
            const parent = textNode.parentNode;
            const parentTag = parent && parent.nodeType === Node.ELEMENT_NODE ? parent.tagName : null;
            const expectedParent = savedType === 'li-ul' ? 'UL' : 'OL';
            if (parent && parentTag === expectedParent) {
                const raw = (text || '').replace(/\u200B/g, '').trim();
                let itemText = raw;
                if (savedType === 'li-ul') {
                    const m = raw.match(/^[-*+]\s+(.*)$/);
                    itemText = m ? m[1] : raw;
                } else {
                    const m = raw.match(/^\d+\.\s+(.*)$/);
                    itemText = m ? m[1] : raw;
                }
                const li = document.createElement('li');
                // 先解析 Markdown 再检查 HTML 标签
                const parsed = parseInlineMarkdown(itemText);
                if (/<[^>]+>/.test(parsed)) {
                    li.innerHTML = parsed;
                } else {
                    li.textContent = itemText;
                }
                parent.replaceChild(li, textNode);
                saveEditorContent();
                return;
            }
        }

        // HTML 标签模式（font color, center, p align）
        const htmlPatterns = [
            { regex: /<font\s+color=["']?([^"'>]+)["']?>([^<]*)<\/font>/i, tag: 'font', attrName: 'color', attrIndex: 1, contentIndex: 2 },
            { regex: /<center>([^<]*)<\/center>/i, tag: 'center', contentIndex: 1 },
            { regex: /<p\s+align=["']?([^"'>]+)["']?>([^<]*)<\/p>/i, tag: 'p', attrName: 'align', attrIndex: 1, contentIndex: 2 },
            { regex: /<u>([^<]*)<\/u>/i, tag: 'u', contentIndex: 1 },
        ];

        // Setext 标题语法检测（处理两行结构：内容 + <br> + ---/===）
        // 标准规则: === → H1, --- → H2
        const setextH1Match = text.match(/^[\u200B]*(-{3,})\s*$/);  // --- → H1
        const setextH2Match = text.match(/^[\u200B]*(={3,})\s*$/);  // === → H2
        const isSetextH1 = !!setextH1Match;
        const isSetextH2 = !!setextH2Match;

        if (isSetextH1 || isSetextH2) {
            const parent = textNode.parentNode;
            if (parent) {
                // 向前查找：<br> 和上一行文本
                let prevNode = textNode.previousSibling;
                let brNode = null;
                let contentNode = null;

                // 跳过空文本节点
                while (prevNode && prevNode.nodeType === Node.TEXT_NODE &&
                    prevNode.textContent.trim() === '') {
                    prevNode = prevNode.previousSibling;
                }

                // 找到 <br>
                if (prevNode && prevNode.nodeType === Node.ELEMENT_NODE && prevNode.tagName === 'BR') {
                    brNode = prevNode;
                    prevNode = prevNode.previousSibling;

                    // 跳过空文本节点
                    while (prevNode && prevNode.nodeType === Node.TEXT_NODE &&
                        prevNode.textContent.trim() === '') {
                        prevNode = prevNode.previousSibling;
                    }

                    // 找到内容文本节点
                    if (prevNode && prevNode.nodeType === Node.TEXT_NODE) {
                        contentNode = prevNode;
                    }
                }

                if (contentNode && contentNode.textContent.trim()) {
                    // 有上一行内容，创建标题
                    const headingLevel = isSetextH1 ? 'h1' : 'h2';
                    const separator = isSetextH1 ? setextH1Match[1] : setextH2Match[1];
                    const newEl = document.createElement(headingLevel);
                    // Setext 标题显示为：标题文字 + 换行 + 分隔符（两行，分隔符保持原始大小）
                    // 分隔符部分设为不可编辑，让用户只能修改标题文字
                    const headerTextEscaped = contentNode.textContent.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    newEl.innerHTML = `${headerTextEscaped}<br contenteditable="false"><span class="setext-separator" contenteditable="false" style="font-size: 14px; font-weight: normal; color: #999; user-select: none;">${separator}</span>`;
                    newEl.dataset.setextType = separator;

                    // 用标题节点替换原始“内容文本节点”，并移除 <br> 与下划线节点
                    const contentParent = contentNode.parentNode;
                    if (!contentParent) return;
                    contentParent.replaceChild(newEl, contentNode);
                    if (brNode && brNode.parentNode) brNode.parentNode.removeChild(brNode);
                    if (textNode.parentNode) textNode.parentNode.removeChild(textNode);

                    // 清理标题后由旧逻辑插入/遗留的占位符与换行，避免产生额外空行
                    let removedZwsp = false;
                    while (newEl.nextSibling &&
                        newEl.nextSibling.nodeType === Node.TEXT_NODE &&
                        newEl.nextSibling.textContent &&
                        newEl.nextSibling.textContent.replace(/\u200B/g, '') === '' &&
                        newEl.nextSibling.nextSibling) {
                        removedZwsp = true;
                        newEl.nextSibling.parentNode.removeChild(newEl.nextSibling);
                    }
                    while (newEl.nextSibling &&
                        newEl.nextSibling.nodeType === Node.ELEMENT_NODE &&
                        newEl.nextSibling.tagName === 'BR' &&
                        (newEl.nextSibling.getAttribute('data-md-auto-br') === 'heading' || removedZwsp)) {
                        newEl.nextSibling.parentNode.removeChild(newEl.nextSibling);
                    }

                    // 若标题位于末尾，保留一个占位符以便光标落点
                    if (!newEl.nextSibling) {
                        contentParent.appendChild(document.createTextNode('\u200B'));
                    }
                    saveEditorContent();
                    return;
                } else if (isSetextH1) {
                    // 没有上一行内容，--- 变成水平分割线
                    const hrEl = document.createElement('hr');

                    // 移除可能存在的 <br>
                    if (brNode && brNode.parentNode) brNode.parentNode.removeChild(brNode);

                    // 直接替换，避免在分隔线后额外插入“空行”
                    parent.replaceChild(hrEl, textNode);

                    // 如果分隔线后面紧跟的是我们插入的 \u200B 占位符，并且后面还有真实内容，则清理它，避免产生额外空行
                    while (hrEl.nextSibling &&
                        hrEl.nextSibling.nodeType === Node.TEXT_NODE &&
                        hrEl.nextSibling.textContent &&
                        hrEl.nextSibling.textContent.replace(/\u200B/g, '') === '' &&
                        hrEl.nextSibling.nextSibling) {
                        hrEl.nextSibling.parentNode.removeChild(hrEl.nextSibling);
                    }

                    // 若分隔线位于末尾，保留一个占位符以便光标落点
                    if (!hrEl.nextSibling) {
                        parent.appendChild(document.createTextNode('\u200B'));
                    }
                    saveEditorContent();
                    return;
                }
            }
        }

        // 水平分割线 ---（单独一行，没有其他内容）
        const hrPattern = /^[\u200B]*-{3,}\s*$/;
        if (savedType === 'hr' && hrPattern.test(text)) {
            const parent = textNode.parentNode;
            if (parent) {
                const hrEl = document.createElement('hr');

                // 直接替换，避免在分隔线后额外插入“空行”
                parent.replaceChild(hrEl, textNode);

                // 如果分隔线后面紧跟的是我们插入的 \u200B 占位符，并且后面还有真实内容，则清理它，避免产生额外空行
                while (hrEl.nextSibling &&
                    hrEl.nextSibling.nodeType === Node.TEXT_NODE &&
                    hrEl.nextSibling.textContent &&
                    hrEl.nextSibling.textContent.replace(/\u200B/g, '') === '' &&
                    hrEl.nextSibling.nextSibling) {
                    hrEl.nextSibling.parentNode.removeChild(hrEl.nextSibling);
                }

                // 若分隔线位于末尾，保留一个占位符以便光标落点
                if (!hrEl.nextSibling) {
                    parent.appendChild(document.createTextNode('\u200B'));
                }
                saveEditorContent();
                return;
            }
        }

        // 块级 Markdown 模式
        // ATX 标题规则：# 在行首，后面必须有空格，支持 H1-H6
        const blockPatterns = [
            { regex: /^######\s(.+)$/, type: 'h6', contentIndex: 1 },    // ###### 六级标题
            { regex: /^#####\s(.+)$/, type: 'h5', contentIndex: 1 },     // ##### 五级标题
            { regex: /^####\s(.+)$/, type: 'h4', contentIndex: 1 },      // #### 四级标题
            { regex: /^###\s(.+)$/, type: 'h3', contentIndex: 1 },       // ### 三级标题
            { regex: /^##\s(.+)$/, type: 'h2', contentIndex: 1 },        // ## 二级标题
            { regex: /^#\s(.+)$/, type: 'h1', contentIndex: 1 },         // # 一级标题
            { regex: /^>\s*(.*)$/, type: 'blockquote', contentIndex: 1 },
            { regex: /^-\s+\[\s*\]\s*(.*)$/, type: 'task-unchecked', contentIndex: 1 },
            { regex: /^-\s+\[x\]\s*(.*)$/i, type: 'task-checked', contentIndex: 1 },
            { regex: /^-\s+(.+)$/, type: 'ul', contentIndex: 1 },
            { regex: /^(\d+)\.\s+(.+)$/, type: 'ol', contentIndex: 2 },
        ];

        // 检查块级模式
        for (const pattern of blockPatterns) {
            const match = text.match(pattern.regex);
            if (match) {
                let newEl;
                const parent = textNode.parentNode;
                if (!parent) return;

                // 辅助函数：将内联 Markdown 语法转换为 HTML
                const parseInlineMarkdown = (text) => {
                    if (!text) return text;
                    return text
                        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                        .replace(/\*(.+?)\*/g, '<em>$1</em>')
                        .replace(/~~(.+?)~~/g, '<del>$1</del>')
                        .replace(/==(.+?)==/g, '<mark>$1</mark>')
                        .replace(/`([^`]+)`/g, '<code>$1</code>');
                };

                // 辅助函数：安全地设置元素内容（解析 Markdown 后用 innerHTML）
                const setElementContent = (element, content) => {
                    const parsed = parseInlineMarkdown(content);
                    if (/<[^>]+>/.test(parsed)) {
                        element.innerHTML = parsed;
                    } else {
                        element.textContent = content;
                    }
                };

                // ATX 标题处理
                if (pattern.type === 'h1') {
                    newEl = document.createElement('h1');
                    setElementContent(newEl, match[pattern.contentIndex] || '');
                } else if (pattern.type === 'h2') {
                    newEl = document.createElement('h2');
                    setElementContent(newEl, match[pattern.contentIndex] || '');
                } else if (pattern.type === 'h3') {
                    newEl = document.createElement('h3');
                    setElementContent(newEl, match[pattern.contentIndex] || '');
                } else if (pattern.type === 'h4') {
                    newEl = document.createElement('h4');
                    setElementContent(newEl, match[pattern.contentIndex] || '');
                } else if (pattern.type === 'h5') {
                    newEl = document.createElement('h5');
                    setElementContent(newEl, match[pattern.contentIndex] || '');
                } else if (pattern.type === 'h6') {
                    newEl = document.createElement('h6');
                    setElementContent(newEl, match[pattern.contentIndex] || '');
                } else if (pattern.type === 'blockquote') {
                    newEl = document.createElement('blockquote');
                    setElementContent(newEl, match[pattern.contentIndex] || '');
                } else if (pattern.type === 'task-unchecked' || pattern.type === 'task-checked') {
                    newEl = document.createElement('div');
                    newEl.className = 'md-task-item';
                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.className = 'md-task-checkbox';
                    cb.checked = pattern.type === 'task-checked';
                    newEl.appendChild(cb);
                    // 任务项内容可能包含 HTML
                    const contentSpan = document.createElement('span');
                    setElementContent(contentSpan, ' ' + (match[pattern.contentIndex] || ''));
                    newEl.appendChild(contentSpan);
                } else if (pattern.type === 'ul') {
                    newEl = document.createElement('ul');
                    const li = document.createElement('li');
                    setElementContent(li, match[pattern.contentIndex] || '');
                    newEl.appendChild(li);
                } else if (pattern.type === 'ol') {
                    newEl = document.createElement('ol');
                    const li = document.createElement('li');
                    setElementContent(li, match[pattern.contentIndex] || '');
                    newEl.appendChild(li);
                }
                if (newEl) {
                    const isHeading = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(pattern.type);
                    if (isHeading) {
                        parent.replaceChild(newEl, textNode);

                        // 清理标题后由旧逻辑插入/遗留的占位符与换行，避免产生额外空行
                        let removedZwsp = false;
                        while (newEl.nextSibling &&
                            newEl.nextSibling.nodeType === Node.TEXT_NODE &&
                            newEl.nextSibling.textContent &&
                            newEl.nextSibling.textContent.replace(/\u200B/g, '') === '' &&
                            newEl.nextSibling.nextSibling) {
                            removedZwsp = true;
                            newEl.nextSibling.parentNode.removeChild(newEl.nextSibling);
                        }
                        while (newEl.nextSibling &&
                            newEl.nextSibling.nodeType === Node.ELEMENT_NODE &&
                            newEl.nextSibling.tagName === 'BR' &&
                            (newEl.nextSibling.getAttribute('data-md-auto-br') === 'heading' || removedZwsp)) {
                            newEl.nextSibling.parentNode.removeChild(newEl.nextSibling);
                        }

                        // 若标题位于末尾，保留一个占位符以便光标落点
                        if (!newEl.nextSibling) {
                            parent.appendChild(document.createTextNode('\u200B'));
                        }
                    } else {
                        const afterNode = document.createTextNode('\u200B');
                        parent.insertBefore(newEl, textNode);
                        parent.insertBefore(afterNode, textNode);
                        parent.removeChild(textNode);
                    }
                    saveEditorContent();
                    return;
                }
            }
        }

        // 先检查 HTML 模式
        for (const pattern of htmlPatterns) {
            const match = text.match(pattern.regex);
            if (match && match.index !== undefined) {
                const matchStart = match.index;
                const matchEnd = matchStart + match[0].length;
                const before = text.substring(0, matchStart);
                const content = match[pattern.contentIndex];
                const after = text.substring(matchEnd);

                const newEl = document.createElement(pattern.tag);
                if (pattern.attrName && pattern.attrIndex) {
                    newEl.setAttribute(pattern.attrName, match[pattern.attrIndex]);
                }
                newEl.textContent = content;

                const parent = textNode.parentNode;
                if (!parent) return;

                const beforeNode = document.createTextNode(before);
                const afterNode = document.createTextNode(after || '\u200B');

                parent.insertBefore(beforeNode, textNode);
                parent.insertBefore(newEl, textNode);
                parent.insertBefore(afterNode, textNode);
                parent.removeChild(textNode);

                saveEditorContent();
                return;
            }
        }

        // Markdown 模式列表
        const patterns = [
            { regex: /\*\*(.+?)\*\*/, tag: 'strong' },
            { regex: /\*(.+?)\*/, tag: 'em' },
            { regex: /~~(.+?)~~/, tag: 'del' },
            { regex: /==(.+?)==/, tag: 'mark' },
            { regex: /`([^`]+)`/, tag: 'code' },
            { regex: /\[\[(.+?)\]\]/, tag: 'span', className: 'md-wikilink' },
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern.regex);
            if (match && match.index !== undefined) {
                const matchStart = match.index;
                const matchEnd = matchStart + match[0].length;
                const before = text.substring(0, matchStart);
                const content = match[1];
                const after = text.substring(matchEnd);

                // 创建新元素
                const newEl = document.createElement(pattern.tag);
                if (pattern.className) newEl.className = pattern.className;
                // 如果内容包含 HTML 标签则用 innerHTML
                if (/<[^>]+>/.test(content)) {
                    newEl.innerHTML = content;
                } else {
                    newEl.textContent = content;
                }

                // 替换文本节点
                const parent = textNode.parentNode;
                if (!parent) return;

                const beforeNode = document.createTextNode(before);
                // 如果后面没有内容，添加零宽空格
                const afterNode = document.createTextNode(after || '\u200B');

                parent.insertBefore(beforeNode, textNode);
                parent.insertBefore(newEl, textNode);
                parent.insertBefore(afterNode, textNode);
                parent.removeChild(textNode);

                // 保存内容
                saveEditorContent();
                return;
            }
        }
    };

    // 空白栏目：自定义撤销/重做（修复 DOM 直接改写导致的 Ctrl+Z 不可用/顺序混乱）
    let undoManager = null;

    // 保存编辑器内容
    const saveEditorContent = () => {
        try { __applyHeadingCollapse(editor); } catch (_) { }
        const cleanHtml = __getCleanHtmlForStorage(editor);
        node.html = cleanHtml;
        // 保存时清除零宽空格（从干净副本获取完整文本，避免折叠状态丢失内容）
        try {
            const tmp = document.createElement('div');
            tmp.innerHTML = cleanHtml;
            node.text = (tmp.innerText || tmp.textContent || '').replace(/\u200B/g, '');
        } catch (_) {
            node.text = editor.innerText.replace(/\u200B/g, '');
        }
        saveTempNodes();
        try { if (undoManager) undoManager.scheduleRecord('save'); } catch (_) { }
    };

    // 初始化 undo/redo 管理器（每个 md-node 独立）
    (() => {
        try {
            if (!CanvasState.mdUndoStates) {
                CanvasState.mdUndoStates = new Map();
            }
            const getNodePath = (root, target) => {
                if (!root || !target) return null;
                const path = [];
                let nodeCur = target;
                while (nodeCur && nodeCur !== root) {
                    const parent = nodeCur.parentNode;
                    if (!parent) return null;
                    const idx = Array.prototype.indexOf.call(parent.childNodes, nodeCur);
                    if (idx < 0) return null;
                    path.unshift(idx);
                    nodeCur = parent;
                }
                return nodeCur === root ? path : null;
            };

            const resolveNodePath = (root, path) => {
                if (!root || !Array.isArray(path)) return null;
                let cur = root;
                for (const idx of path) {
                    if (!cur || !cur.childNodes || idx < 0 || idx >= cur.childNodes.length) return null;
                    cur = cur.childNodes[idx];
                }
                return cur;
            };

            const clampOffset = (nodeForOffset, offset) => {
                const safe = Math.max(0, Number.isFinite(offset) ? offset : 0);
                if (!nodeForOffset) return 0;
                if (nodeForOffset.nodeType === Node.TEXT_NODE) {
                    const len = (nodeForOffset.textContent || '').length;
                    return Math.min(safe, len);
                }
                if (nodeForOffset.nodeType === Node.ELEMENT_NODE) {
                    return Math.min(safe, nodeForOffset.childNodes.length);
                }
                return 0;
            };

            const captureSelection = () => {
                const sel = window.getSelection();
                if (!sel || !sel.rangeCount) return null;
                const range = sel.getRangeAt(0);
                if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return null;
                const startPath = getNodePath(editor, range.startContainer);
                const endPath = getNodePath(editor, range.endContainer);
                if (!startPath || !endPath) return null;
                return {
                    startPath,
                    startOffset: range.startOffset,
                    endPath,
                    endOffset: range.endOffset,
                    collapsed: range.collapsed
                };
            };

            const restoreSelection = (selData) => {
                try {
                    if (!selData) return;
                    const startNode = resolveNodePath(editor, selData.startPath) || editor;
                    const endNode = resolveNodePath(editor, selData.endPath) || startNode;
                    const range = document.createRange();
                    range.setStart(startNode, clampOffset(startNode, selData.startOffset));
                    range.setEnd(endNode, clampOffset(endNode, selData.endOffset));
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                } catch (_) { }
            };

            const snapshot = () => ({
                html: editor.innerHTML,
                fontSize: typeof node.fontSize === 'number' ? node.fontSize : 14,
                selection: captureSelection(),
                scrollTop: editor.scrollTop || 0,
                scrollLeft: editor.scrollLeft || 0
            });

            const isSameSnapshot = (a, b) => {
                if (!a || !b) return false;
                return a.html === b.html && a.fontSize === b.fontSize;
            };

            const persisted = CanvasState.mdUndoStates.get(node.id) || null;
            const state = {
                stack: Array.isArray(persisted && persisted.stack) ? persisted.stack : [],
                index: Number.isFinite(persisted && persisted.index) ? persisted.index : -1
            };

            let recordRaf = 0;
            const MAX_STACK = 300;

            const syncExpandedStateFromSelection = (wasExpanded = false) => {
                try {
                    // 只有在“撤销前已经处于展开源码态”时才进行同步，避免把普通 Markdown token 误判为展开态
                    if (!wasExpanded) return;

                    const sel = window.getSelection();
                    if (!sel || !sel.rangeCount) return;
                    const range = sel.getRangeAt(0);
                    if (!range || !editor.contains(range.startContainer)) return;

                    const container = range.startContainer;
                    if (!container || container.nodeType !== Node.TEXT_NODE) return;
                    if (!container.parentNode) return;

                    const raw = String(container.textContent || '');
                    const text = raw.replace(/\u200B/g, '').trim();
                    if (!text) return;

                    // 仅在“整段文本看起来就是一段源码 token”时才视为展开态，避免误判普通段落
                    const looksLikeExpandedToken = (() => {
                        if (/^\*\*[\s\S]+?\*\*$/.test(text)) return true; // **bold**
                        if (/^\*[\s\S]+?\*$/.test(text)) return true; // *italic*
                        if (/^~~[\s\S]+?~~$/.test(text)) return true; // ~~del~~
                        if (/^==[\s\S]+?==$/.test(text)) return true; // ==mark==
                        if (/^`[^`]+`$/.test(text)) return true; // `code`
                        if (/^\[\[[\s\S]+?\]\]$/.test(text)) return true; // [[wikilink]]
                        if (/^<font\s+color=["']?[^"'>]+["']?>[\s\S]*<\/font>$/i.test(text)) return true;
                        if (/^<center>[\s\S]*<\/center>$/i.test(text)) return true;
                        if (/^<p\s+align=["']?[^"'>]+["']?>[\s\S]*<\/p>$/i.test(text)) return true;
                        if (/^<u>[\s\S]*<\/u>$/i.test(text)) return true;
                        // Setext 标题分隔符行（--- / ===）
                        if (/^(-{3,}|={3,})$/.test(text)) return true;
                        // 列表项（展开后 <li> 会变成 UL/OL 内的 TextNode）
                        const p = container.parentNode;
                        if (p && p.nodeType === Node.ELEMENT_NODE && (p.tagName === 'UL' || p.tagName === 'OL')) {
                            if (/^[-*+]\s+/.test(text) || /^\d+\.\s+/.test(text)) return true;
                        }
                        return false;
                    })();

                    if (!looksLikeExpandedToken) return;

                    expandedElement = container;
                    expandedMarkdown = raw;
                    // 仅列表需要额外类型信息；其他交给 reRenderExpanded 内部识别
                    const parentEl = container.parentNode;
                    if (parentEl && parentEl.nodeType === Node.ELEMENT_NODE && parentEl.tagName === 'UL') {
                        expandedType = 'li-ul';
                    } else if (parentEl && parentEl.nodeType === Node.ELEMENT_NODE && parentEl.tagName === 'OL') {
                        expandedType = 'li-ol';
                    } else {
                        expandedType = 'simple';
                    }
                } catch (_) { }
            };

            undoManager = {
                isRestoring: false,
                cancelPendingRecord: () => {
                    if (recordRaf) {
                        cancelAnimationFrame(recordRaf);
                        recordRaf = 0;
                    }
                },
                scheduleRecord: (reason = 'unknown') => {
                    if (undoManager.isRestoring) return;
                    if (recordRaf) cancelAnimationFrame(recordRaf);
                    recordRaf = requestAnimationFrame(() => {
                        recordRaf = 0;
                        undoManager.recordNow(reason);
                    });
                },
                recordNow: (reason = 'unknown') => {
                    if (undoManager.isRestoring) return;
                    const snap = snapshot();

                    // 初始化或同步当前指针
                    if (state.index < 0) {
                        state.stack = [snap];
                        state.index = 0;
                        CanvasState.mdUndoStates.set(node.id, { stack: state.stack, index: state.index });
                        return;
                    }

                    // 如果当前指针不是最后一个，截断“未来”
                    if (state.index < state.stack.length - 1) {
                        state.stack = state.stack.slice(0, state.index + 1);
                    }

                    // 去重：避免重复写入相同内容
                    const cur = state.stack[state.index];
                    if (isSameSnapshot(cur, snap)) {
                        // 更新 selection/scroll（不影响撤销内容，但避免恢复位置错乱）
                        state.stack[state.index] = snap;
                        CanvasState.mdUndoStates.set(node.id, { stack: state.stack, index: state.index });
                        return;
                    }

                    state.stack.push(snap);
                    state.index = state.stack.length - 1;
                    if (state.stack.length > MAX_STACK) {
                        const overflow = state.stack.length - MAX_STACK;
                        state.stack.splice(0, overflow);
                        state.index = Math.max(0, state.index - overflow);
                    }
                    CanvasState.mdUndoStates.set(node.id, { stack: state.stack, index: state.index });
                },
                reset: (reason = 'reset') => {
                    try { undoManager.cancelPendingRecord(); } catch (_) { }
                    try {
                        const snap = snapshot();
                        state.stack = [snap];
                        state.index = 0;
                        CanvasState.mdUndoStates.set(node.id, { stack: state.stack, index: state.index });
                    } catch (_) { }
                },
                undo: () => {
                    if (state.index <= 0) return;
                    undoManager.cancelPendingRecord();
                    undoManager.isRestoring = true;
                    try {
                        const wasExpanded = !!expandedElement || !!expandedMarkdown || !!expandedType;
                        state.index -= 1;
                        const snap = state.stack[state.index];
                        if (snap) {
                            editor.innerHTML = snap.html;
                            // innerHTML 会重建 DOM，旧的 expandedElement 会失效
                            expandedElement = null;
                            expandedMarkdown = null;
                            expandedType = null;
                            node.fontSize = snap.fontSize;
                            editor.style.fontSize = node.fontSize + 'px';
                            editor.scrollTop = snap.scrollTop || 0;
                            editor.scrollLeft = snap.scrollLeft || 0;
                            restoreSelection(snap.selection);
                            // 撤销/反撤销会重建 DOM：同步“展开源码”状态，确保后续能正常重新渲染
                            syncExpandedStateFromSelection(wasExpanded);
                            // 注意：不要在此处触发异步 reRender（会立刻写入新快照并截断 redo 栈）
                            try {
                                if (expandedElement && expandedElement.parentNode) {
                                    reRenderExpanded();
                                }
                            } catch (_) { }
                            try { liveRenderMarkdown(); } catch (_) { }
                            saveEditorContent();
                        }
                        CanvasState.mdUndoStates.set(node.id, { stack: state.stack, index: state.index });
                    } finally {
                        undoManager.isRestoring = false;
                    }
                },
                redo: () => {
                    if (state.index >= state.stack.length - 1) return;
                    undoManager.cancelPendingRecord();
                    undoManager.isRestoring = true;
                    try {
                        const wasExpanded = !!expandedElement || !!expandedMarkdown || !!expandedType;
                        state.index += 1;
                        const snap = state.stack[state.index];
                        if (snap) {
                            editor.innerHTML = snap.html;
                            // innerHTML 会重建 DOM，旧的 expandedElement 会失效
                            expandedElement = null;
                            expandedMarkdown = null;
                            expandedType = null;
                            node.fontSize = snap.fontSize;
                            editor.style.fontSize = node.fontSize + 'px';
                            editor.scrollTop = snap.scrollTop || 0;
                            editor.scrollLeft = snap.scrollLeft || 0;
                            restoreSelection(snap.selection);
                            // 撤销/反撤销会重建 DOM：同步“展开源码”状态，确保后续能正常重新渲染
                            syncExpandedStateFromSelection(wasExpanded);
                            // 注意：不要在此处触发异步 reRender（会立刻写入新快照并截断 redo 栈）
                            try {
                                if (expandedElement && expandedElement.parentNode) {
                                    reRenderExpanded();
                                }
                            } catch (_) { }
                            try { liveRenderMarkdown(); } catch (_) { }
                            saveEditorContent();
                        }
                        CanvasState.mdUndoStates.set(node.id, { stack: state.stack, index: state.index });
                    } finally {
                        undoManager.isRestoring = false;
                    }
                }
            };

            // 初始快照
            undoManager.recordNow('init');
        } catch (e) {
            // undo 不可用时，不影响正常编辑
            undoManager = null;
        }
    })();

    // 进入编辑状态（点击时）
    const enterEdit = () => {
        if (node.isEditing) return;
        node.isEditing = true;
        el.classList.add('editing');

        // 编辑模式下禁用拖拽和resize
        const resizeHandles = el.querySelectorAll('.resize-handle');
        resizeHandles.forEach(handle => {
            handle.style.pointerEvents = 'none';
            handle.style.opacity = '0';
        });
    };

    // 退出编辑状态
    const exitEdit = () => {
        if (!node.isEditing) return;
        node.isEditing = false;
        el.classList.remove('editing');

        // 恢复拖拽和resize
        const resizeHandles = el.querySelectorAll('.resize-handle');
        resizeHandles.forEach(handle => {
            handle.style.pointerEvents = 'auto';
            handle.style.opacity = '';
        });

        // 保存内容
        saveEditorContent();
    };

    // 实时渲染：监听输入事件（带防抖，避免输入时频繁渲染）
    let renderDebounceTimer = null;
    const RENDER_DEBOUNCE_DELAY = 250; // 降低到 250ms：减少手动输入到渲染的等待，但仍避免“还没打完就被渲染”

    editor.addEventListener('input', (e) => {
        if (undoManager && undoManager.isRestoring) return;

        // 若用户已经把光标移出“展开的源码”，立即重渲染（避免只靠方向键触发）
        scheduleReRenderIfCaretLeftExpanded();

        // 输入法合成阶段不要触发即时渲染，避免候选中途被替换（compositionend 会兜底）
        if (e && e.isComposing) {
            return;
        }

        // 清除之前的定时器
        if (renderDebounceTimer) {
            clearTimeout(renderDebounceTimer);
        }

        // 对“闭合分隔符/标签结束/粘贴”等场景，立即渲染，避免必须停顿 400ms 才生效
        // 典型例子：==12345==6789，在输入第二个 == 后应立刻渲染且光标保持在原位置（不回跳）
        const inputType = (e && typeof e.inputType === 'string') ? e.inputType : '';
        const data = (e && typeof e.data === 'string') ? e.data : '';
        const shouldRenderImmediately = (
            inputType === 'insertFromPaste' ||
            inputType === 'insertFromDrop' ||
            /[*~=`=<>/\\]]/.test(data)
        );

        if (shouldRenderImmediately) {
            liveRenderMarkdown();
            renderDebounceTimer = null;
            try { if (undoManager) undoManager.scheduleRecord('input-immediate'); } catch (_) { }
            return;
        }

        // 其他普通输入：延迟渲染，避免“还没打完就被渲染”
        renderDebounceTimer = setTimeout(() => {
            liveRenderMarkdown();
            try { if (undoManager) undoManager.scheduleRecord('input-debounced'); } catch (_) { }
            renderDebounceTimer = null;
        }, RENDER_DEBOUNCE_DELAY);

        // 记录一次输入快照（即使本次没有触发语法渲染，也要支持逐步撤销）
        try { if (undoManager) undoManager.scheduleRecord('input'); } catch (_) { }
    });

    // 编辑器获得焦点时进入编辑状态
    editor.addEventListener('focus', () => {
        enterEdit();
    });

    // 编辑器失去焦点时退出编辑状态并重新渲染展开的内容
    editor.addEventListener('blur', () => {
        reRenderExpanded();
        exitEdit();
    });

    // 鼠标/输入法/键盘：只要光标离开展开源码就重渲染
    editor.addEventListener('mouseup', () => {
        scheduleReRenderIfCaretLeftExpanded();
    });
    editor.addEventListener('keyup', () => {
        scheduleReRenderIfCaretLeftExpanded();
    });
    editor.addEventListener('compositionend', () => {
        scheduleReRenderIfCaretLeftExpanded();
        // 合成结束后立刻尝试渲染（避免中文输入导致渲染延后）
        try {
            liveRenderMarkdown();
            if (undoManager) undoManager.scheduleRecord('compositionend');
        } catch (_) { }
    });

    // 【关键修复】使用 selectionchange 检测光标移动，确保离开展开源码后立即重渲染
    // 这对于颜色、字体等工具展开源码后的重渲染至关重要
    // 注意：selectionchange 是 document 级别事件，需要检查选区是否在当前编辑器内
    const onSelectionChange = () => {
        // 只有当编辑器有焦点时才处理
        if (!editor.contains(document.activeElement) && document.activeElement !== editor) return;
        // 检查选区是否在编辑器内
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        if (!editor.contains(range.startContainer)) return;
        // 调度重渲染检查
        scheduleReRenderIfCaretLeftExpanded();
    };
    document.addEventListener('selectionchange', onSelectionChange);

    // 快捷键处理
    editor.addEventListener('keydown', (e) => {
        // Undo / Redo（修复工具插入与自动渲染无法撤销、撤销顺序混乱）
        if (undoManager && (e.ctrlKey || e.metaKey) && !e.altKey) {
            const key = (e.key || '').toLowerCase();
            const isZ = key === 'z';
            const isY = key === 'y';
            if (isZ) {
                e.preventDefault();
                e.stopPropagation();
                // 撤销/反撤销前先取消“延迟渲染/延迟记录”，避免把 redo 栈提前截断
                try {
                    if (renderDebounceTimer) {
                        clearTimeout(renderDebounceTimer);
                        renderDebounceTimer = null;
                    }
                    if (undoManager.cancelPendingRecord) undoManager.cancelPendingRecord();
                } catch (_) { }
                if (e.shiftKey) undoManager.redo();
                else undoManager.undo();
                return;
            }
            if (isY) {
                e.preventDefault();
                e.stopPropagation();
                try {
                    if (renderDebounceTimer) {
                        clearTimeout(renderDebounceTimer);
                        renderDebounceTimer = null;
                    }
                    if (undoManager.cancelPendingRecord) undoManager.cancelPendingRecord();
                } catch (_) { }
                undoManager.redo();
                return;
            }
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            editor.blur();
            return;
        }

        // Backspace：删除到格式化元素时，先展开为源码
        if (e.key === 'Backspace') {
            const sel = window.getSelection();
            if (!sel.rangeCount) return;
            const range = sel.getRangeAt(0);

            // 只处理光标（非选区）
            if (!range.collapsed) return;

            const container = range.startContainer;
            const offset = range.startOffset;

            // 检查元素是否为格式化元素（Markdown 或 HTML 格式）
            const isFormattedElement = (el) => {
                if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
                const tag = el.tagName;
                // Markdown 格式
                if (formatMap[tag]) return true;
                // HTML 格式：font, center, p[align]
                if (tag === 'FONT' || tag === 'CENTER') return true;
                if (tag === 'P' && el.hasAttribute('align')) return true;
                // 块级格式：blockquote, hr, ul, ol, task
                if (tag === 'BLOCKQUOTE' || tag === 'HR' || tag === 'LI') return true;
                if (el.classList && el.classList.contains('md-task-item')) return true;
                // 标题格式：h1-h6
                if (tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' || tag === 'H5' || tag === 'H6') return true;
                return false;
            };

            // 查找紧邻光标前的格式化元素
            const findAdjacentFormattedEl = () => {
                // 情况A：光标在文本节点内
                if (container.nodeType === Node.TEXT_NODE) {
                    // 在文本开头，或在零宽空格的位置1
                    if (offset === 0 || (offset === 1 && container.textContent.charAt(0) === '\u200B')) {
                        let prev = container.previousSibling;
                        // 跳过空文本节点和零宽空格
                        while (prev && prev.nodeType === Node.TEXT_NODE &&
                            (prev.textContent === '' || prev.textContent === '\u200B')) {
                            prev = prev.previousSibling;
                        }
                        if (isFormattedElement(prev)) {
                            return { el: prev, cleanup: offset === 1 && container.textContent === '\u200B' ? container : null };
                        }
                    }
                }

                // 情况B：光标在元素节点内（如 editor 本身）
                if (container.nodeType === Node.ELEMENT_NODE && offset > 0) {
                    let prevChild = container.childNodes[offset - 1];
                    // 跳过零宽空格
                    let cleanup = null;
                    if (prevChild && prevChild.nodeType === Node.TEXT_NODE && prevChild.textContent === '\u200B') {
                        cleanup = prevChild;
                        prevChild = container.childNodes[offset - 2];
                    }
                    if (isFormattedElement(prevChild)) {
                        return { el: prevChild, cleanup };
                    }
                }

                // 情况C：光标在格式化元素内部的开头
                const formattedParent = container.parentElement?.closest('strong, b, em, i, u, del, s, mark, code, font, center, p[align], blockquote, hr, li, .md-task-item, h1, h2, h3, h4, h5, h6');
                if (formattedParent && editor.contains(formattedParent)) {
                    const isAtStart = (container.nodeType === Node.TEXT_NODE && offset === 0) ||
                        (container === formattedParent && offset === 0);
                    if (isAtStart) {
                        return { el: formattedParent, cleanup: null };
                    }
                }

                return null;
            };

            const result = findAdjacentFormattedEl();
            if (result) {
                e.preventDefault();
                if (result.cleanup) {
                    result.cleanup.parentNode?.removeChild(result.cleanup);
                }
                expandToMarkdown(result.el, 'end');
                return;
            }
        }

        // Delete：删除到格式化元素时，先展开为源码
        if (e.key === 'Delete') {
            const sel = window.getSelection();
            if (!sel.rangeCount) return;
            const range = sel.getRangeAt(0);

            if (!range.collapsed) return;

            const container = range.startContainer;
            const offset = range.startOffset;

            // 检查元素是否为格式化元素（Markdown 或 HTML 格式）
            const isFormattedEl = (el) => {
                if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
                const tag = el.tagName;
                if (formatMap[tag]) return true;
                if (tag === 'FONT' || tag === 'CENTER') return true;
                if (tag === 'P' && el.hasAttribute('align')) return true;
                // 块级格式
                if (tag === 'BLOCKQUOTE' || tag === 'HR' || tag === 'LI') return true;
                if (el.classList && el.classList.contains('md-task-item')) return true;
                // 标题格式：h1-h6
                if (tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' || tag === 'H5' || tag === 'H6') return true;
                return false;
            };

            // 查找紧邻光标后的格式化元素
            const findNextFormattedEl = () => {
                if (container.nodeType === Node.TEXT_NODE) {
                    const len = container.textContent.length;
                    // 在文本末尾，或在零宽空格结尾位置
                    if (offset === len || (offset === len - 1 && container.textContent.charAt(len - 1) === '\u200B')) {
                        let next = container.nextSibling;
                        while (next && next.nodeType === Node.TEXT_NODE &&
                            (next.textContent === '' || next.textContent === '\u200B')) {
                            next = next.nextSibling;
                        }
                        if (isFormattedEl(next)) {
                            return next;
                        }
                    }
                }

                if (container.nodeType === Node.ELEMENT_NODE && offset < container.childNodes.length) {
                    let nextChild = container.childNodes[offset];
                    if (nextChild && nextChild.nodeType === Node.TEXT_NODE && nextChild.textContent === '\u200B') {
                        nextChild = container.childNodes[offset + 1];
                    }
                    if (isFormattedEl(nextChild)) {
                        return nextChild;
                    }
                }

                return null;
            };

            const nextEl = findNextFormattedEl();
            if (nextEl) {
                e.preventDefault();
                expandToMarkdown(nextEl, 'start');
                return;
            }
        }

        // 方向键移动：
        // - 当光标离开当前展开的源码区域时，自动重新渲染
        // - 当光标移动到某个格式化元素内部时，自动展开为源码
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
            setTimeout(() => {
                const sel = window.getSelection();
                if (!sel || !sel.rangeCount) return;
                let range = sel.getRangeAt(0);

                // 如果已经展开源码且光标离开了该区域，则先重新渲染
                if (expandedElement && expandedElement.parentNode && !isCaretInsideExpandedSource()) {
                    reRenderExpanded();
                    const selAfter = window.getSelection();
                    if (!selAfter || !selAfter.rangeCount) return;
                    range = selAfter.getRangeAt(0);
                }

                // 当前没有展开的源码时，检测是否进入了某个格式化元素
                if (!expandedElement) {
                    let container = range.startContainer;
                    if (container.nodeType === Node.TEXT_NODE && container.parentElement) {
                        // 避免零宽空格节点干扰判断
                        if (container.textContent === '\u200B') {
                            container = container.parentElement;
                        } else {
                            container = container.parentElement;
                        }
                    }

                    let formattedEl = null;
                    if (container.nodeType === Node.ELEMENT_NODE) {
                        formattedEl = container.closest('strong, b, em, i, u, del, s, mark, code, font, center, p[align], blockquote, hr, li, .md-task-item, h1, h2, h3, h4, h5, h6');
                    }

                    if (formattedEl && editor.contains(formattedEl)) {
                        // 根据方向键大致决定光标落点在源码的开头还是结尾
                        const cursorPos = (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? 'end' : 'start';
                        expandToMarkdown(formattedEl, cursorPos);
                    }
                }
            }, 0);
        }
    });

    // 阻止编辑器事件冒泡（防止触发画布拖动）
    ['mousedown', 'dblclick', 'click'].forEach(evt => editor.addEventListener(evt, ev => ev.stopPropagation()));

    el.appendChild(toolbar);
    el.appendChild(editor);

    // 点击处理：格式化元素展开为源码，链接打开
    editor.addEventListener('click', (e) => {
        if (__handleHeadingCollapseClick(editor, e)) {
            saveEditorContent();
            return;
        }
        const rawTarget = e.target;
        const target = (rawTarget && rawTarget.nodeType === Node.ELEMENT_NODE)
            ? rawTarget
            : (rawTarget && rawTarget.parentElement ? rawTarget.parentElement : null);
        if (!target) return;

        // 任务checkbox点击 - 切换选中状态
        if (target.classList && target.classList.contains('md-task-checkbox')) {
            // checkbox状态已经由浏览器自动切换，只需保存
            saveEditorContent();
            return;
        }

        // 链接点击
        const link = target.closest('a');
        if (link && link.href && !node.isEditing) {
            e.preventDefault();
            e.stopPropagation();
            window.open(link.href, '_blank', 'noopener,noreferrer');
            return;
        }

        // 判断当前点击是否仍在已展开的源码区域内（允许继续选择文字，而不触发重新渲染）
        const isClickInsideExpanded = isCaretInsideExpandedSource() || rawTarget === expandedElement;

        // 点击格式化元素时展开为 Markdown 源码（包括 HTML 格式）- 排除checkbox
        let formattedEl = target.closest('strong, b, em, i, u, del, s, mark, code, font, center, p[align], blockquote, hr, li, .md-task-item, h1, h2, h3, h4, h5, h6');
        // 标题是高频操作：无论点击标题内部的哪个子元素，都优先按整个标题处理（保留 # / ## / ### 语义）
        const headingEl = target.closest('h1, h2, h3, h4, h5, h6');
        if (headingEl && editor.contains(headingEl)) {
            formattedEl = headingEl;
        }
        if (formattedEl && editor.contains(formattedEl)) {
            // 优化：对于块级元素（列表、引用），只有点击元素左侧（符号/Padding）时才展开源码
            // 点击右侧文本内容时保持富文本编辑模式
            //
            // NOTE: 标题（# / ## / ### ...）属于高频操作，这里保持“直接点击即可展开源码”的行为。
            const isBlockRestricted = formattedEl.tagName === 'LI' || formattedEl.tagName === 'BLOCKQUOTE';
            if (isBlockRestricted) {
                // 如果点击的是子元素（如 strong, em, a）或其内部文本区域，视为点击内容 -> 不展开
                if (target !== formattedEl) return;

                // 获取点击相对元素的横坐标
                const rect = formattedEl.getBoundingClientRect();
                const clickX = e.clientX - rect.left;

                // 获取左侧缩进宽度（通常包含 bullet/marker）
                const style = window.getComputedStyle(formattedEl);
                const paddingLeft = parseFloat(style.paddingLeft);
                // 设定热区阈值：至少 25px，或者使用 paddingLeft
                const threshold = paddingLeft > 10 ? paddingLeft : 25;

                // 如果点击位置在热区右侧，视为点击文本 -> 不展开
                if (clickX > threshold) return;
            }
            // 特殊处理：Setext标题（带有分隔符的H1/H2）点击时不展开为源码
            // 而是让标题内容可编辑，保持渲染后的标题格式
            const isSetextHeading = (formattedEl.tagName === 'H1' || formattedEl.tagName === 'H2') &&
                formattedEl.dataset && formattedEl.dataset.setextType;

            if (isSetextHeading) {
                // 先重新渲染之前展开的元素
                if (expandedElement && expandedElement.parentNode && !isClickInsideExpanded) {
                    reRenderExpanded();
                }
                // Setext标题保持渲染后的格式，直接可编辑，不展开为源码
                // 标题元素本身在contenteditable中，用户可以直接修改文字内容
                // 不做任何操作，让浏览器默认的编辑行为生效
                return;
            }

            // 其他格式化元素：展开为源码
            // 先重新渲染之前展开的元素（如果此次点击不在源码区域内）
            if (expandedElement && expandedElement.parentNode && !isClickInsideExpanded) {
                reRenderExpanded();
            }
            expandToMarkdown(formattedEl);
        } else if (expandedElement && expandedElement.parentNode && !isClickInsideExpanded) {
            // 点击其他位置时，重新渲染之前展开的元素
            reRenderExpanded();
        }
    });

    // 降低滚动链和事件冒泡带来的卡顿
    editor.addEventListener('wheel', (e) => {
        e.stopPropagation();
    }, { passive: true });

    // 复制时转换为 Markdown 源码格式（而非渲染后的富文本）
    editor.addEventListener('copy', (e) => {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return;

        // 获取选中内容的 HTML
        const range = selection.getRangeAt(0);
        const container = document.createElement('div');
        container.appendChild(range.cloneContents());
        const selectedHtml = container.innerHTML;

        const isAll = __isSelectionAll(editor, selection);
        const htmlSource = isAll ? __getCleanHtmlForStorage(editor) : selectedHtml;
        if (!htmlSource) return;

        // 转换为 Markdown 源码
        const markdownSource = __htmlToMarkdown(htmlSource);

        // 设置剪贴板内容
        // 智能优化：如果用户选中了整个块级元素（如列表项）的文本，自动补充 Markdown 语法结构（如 - ）
        let finalSource = markdownSource;
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const commonAncestor = range.commonAncestorContainer;
            const blockEl = (commonAncestor.nodeType === 1 ? commonAncestor : commonAncestor.parentNode).closest('li, h1, h2, h3, h4, h5, h6, blockquote');

            if (blockEl && editor.contains(blockEl)) {
                const blockText = blockEl.textContent.trim();
                const selectedText = selection.toString().trim();

                // 如果选中的文本覆盖了整行（内容匹配），说明用户意图复制整行，补充 Markdown 符号
                // 注意：这里做简单的全匹配判定
                if (blockText && selectedText && blockText === selectedText) {
                    const tag = blockEl.tagName;
                    if (tag === 'LI') {
                        const parent = blockEl.parentElement;
                        if (parent && parent.tagName === 'OL') {
                            const index = Array.from(parent.children).indexOf(blockEl) + 1;
                            finalSource = `${index}. ${finalSource}`;
                        } else {
                            if (blockEl.classList.contains('md-task-item')) {
                                const cb = blockEl.querySelector('input[type="checkbox"]');
                                const mark = cb && cb.checked ? '[x]' : '[ ]';
                                finalSource = `- ${mark} ${finalSource}`;
                            } else {
                                finalSource = `- ${finalSource}`;
                            }
                        }
                    } else if (tag === 'H1') finalSource = `# ${finalSource}`;
                    else if (tag === 'H2') finalSource = `## ${finalSource}`;
                    else if (tag === 'H3') finalSource = `### ${finalSource}`;
                    else if (tag === 'H4') finalSource = `#### ${finalSource}`;
                    else if (tag === 'H5') finalSource = `##### ${finalSource}`;
                    else if (tag === 'H6') finalSource = `###### ${finalSource}`;
                    else if (tag === 'BLOCKQUOTE') finalSource = `> ${finalSource}`;
                }
            }
        }

        const safeHtml = __normalizeCanvasRichHtml(htmlSource);
        if (safeHtml) {
            try { e.clipboardData.setData('text/html', safeHtml); } catch (_) { }
            try { e.clipboardData.setData('application/x-bookmark-canvas-html', safeHtml); } catch (_) { }
        }

        e.preventDefault();
        e.clipboardData.setData('text/plain', finalSource);
        // 移除 HTML 格式，确保外部粘贴时使用 Markdown 源码
        // e.clipboardData.setData('text/html', selectedHtml);
    });

    const __insertTextAtSelection = (text) => {
        const val = String(text || '');
        if (!val) return;
        try {
            document.execCommand('insertText', false, val);
            return;
        } catch (_) { }
        try {
            const sel = window.getSelection();
            if (!sel || !sel.rangeCount) return;
            const range = sel.getRangeAt(0);
            range.deleteContents();
            const tn = document.createTextNode(val);
            range.insertNode(tn);
            const newRange = document.createRange();
            newRange.setStartAfter(tn);
            newRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(newRange);
        } catch (_) { }
    };

    const __insertHtmlAtSelection = (html) => {
        const safeHtml = String(html || '');
        if (!safeHtml) return;
        try {
            document.execCommand('insertHTML', false, safeHtml);
            return;
        } catch (_) { }
        try {
            const sel = window.getSelection();
            if (!sel || !sel.rangeCount) return;
            const range = sel.getRangeAt(0);
            range.deleteContents();
            const tpl = document.createElement('template');
            tpl.innerHTML = safeHtml;
            const frag = tpl.content;
            const last = frag.lastChild;
            range.insertNode(frag);
            if (last) {
                const newRange = document.createRange();
                newRange.setStartAfter(last);
                newRange.collapse(true);
                sel.removeAllRanges();
                sel.addRange(newRange);
            }
        } catch (_) { }
    };

    // 粘贴时优先使用 HTML（内部格式），否则走 Markdown 解析
    editor.addEventListener('paste', (e) => {
        try {
            const cd = e && e.clipboardData;
            const clipboardHtml = cd ? String(cd.getData('application/x-bookmark-canvas-html') || cd.getData('text/html') || '') : '';
            const plain = cd ? String(cd.getData('text/plain') || '') : '';
            const normalized = plain.replace(/\r\n/g, '\n');
            const trimmed = normalized.trim();
            const looksLikeBlockMd = /(^|\n)\s*(#{1,6}\s+|>\s+|[-*]\s*(?:\[[ xX]\]\s+)?|\d+\.\s+|```)/.test(trimmed);
            const isMultiLine = /\n/.test(trimmed);
            const safeHtml = clipboardHtml ? __normalizeCanvasRichHtml(clipboardHtml) : '';
            const hasHtmlTags = /<\s*(?:a|p|div|span|br|strong|em|b|i|u|del|s|mark|code|blockquote|ul|ol|li|hr|h[1-6]|font|center|pre|img|input|button|details|summary)\b/i.test(clipboardHtml);

            if (safeHtml && hasHtmlTags) {
                e.preventDefault();
                __insertHtmlAtSelection(safeHtml);
                setTimeout(() => {
                    saveEditorContent();
                }, 0);
                return;
            }

            if (trimmed && (isMultiLine || looksLikeBlockMd) && typeof marked !== 'undefined') {
                e.preventDefault();
                let parsedHtml = '';
                try { parsedHtml = marked.parse(trimmed); } catch (_) { parsedHtml = ''; }
                const safe = __normalizeCanvasRichHtml(parsedHtml);
                if (safe) {
                    __insertHtmlAtSelection(safe);
                } else {
                    __insertTextAtSelection(normalized);
                }
                setTimeout(() => {
                    saveEditorContent();
                }, 0);
                return;
            }

            if (trimmed && (isMultiLine || looksLikeBlockMd) && typeof marked === 'undefined') {
                e.preventDefault();
                const esc = (s) => String(s || '')
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#39;');
                const lines = normalized.split('\n');
                const html = lines.map(line => `<div>${esc(line)}</div>`).join('');
                __insertHtmlAtSelection(html);
                setTimeout(() => {
                    saveEditorContent();
                }, 0);
                return;
            }
        } catch (_) { }

        setTimeout(() => {
            try { saveEditorContent(); } catch (_) { }
        }, 50);
    });

    // 选择逻辑：单击选中（可拖动），快速双击进入编辑
    // 使用自定义双击检测，时间窗口 200ms（更严格）
    let lastClickTime = 0;
    const DOUBLE_CLICK_THRESHOLD = 200;

    // 标记是否在编辑模式
    let isInEditMode = false;
    let ctrlPausedEdit = false; // Ctrl暂停编辑标记

    const enterEditMode = () => {
        isInEditMode = true;
        ctrlPausedEdit = false;
        node.isEditing = true;
        el.setAttribute('data-editing', 'true');
        editor.focus();
    };

    const exitEditMode = () => {
        isInEditMode = false;
        ctrlPausedEdit = false;
        node.isEditing = false;
        el.removeAttribute('data-editing');
        // 退出栏目卡片时：清空撤销/反撤销栈（每次进入编辑都从当前内容开始）
        try {
            if (renderDebounceTimer) {
                clearTimeout(renderDebounceTimer);
                renderDebounceTimer = null;
            }
        } catch (_) { }
        try { if (undoManager && undoManager.reset) undoManager.reset('exit-card'); } catch (_) { }
    };

    // Ctrl键暂停编辑（允许拖动/调整大小）
    const pauseEditForCtrl = () => {
        if (isInEditMode) {
            ctrlPausedEdit = true;
            node.isEditing = false; // 暂时禁用编辑状态，允许拖动
            el.removeAttribute('data-editing');
            editor.blur();
        }
    };

    // 恢复编辑模式（Ctrl释放后可双击继续编辑）
    const resumeEditFromCtrl = () => {
        if (ctrlPausedEdit) {
            ctrlPausedEdit = false;
            // 不自动恢复编辑，保持选中状态，用户可双击继续编辑
        }
    };

    // 监听编辑器失焦，退出编辑模式
    editor.addEventListener('blur', () => {
        // 如果是Ctrl暂停的，不退出编辑模式
        if (ctrlPausedEdit) return;
        // 延迟检查，避免点击工具栏时误退出
        setTimeout(() => {
            if (document.activeElement !== editor && !el.contains(document.activeElement)) {
                exitEditMode();
            }
        }, 100);
    });

    el.addEventListener('mousedown', (e) => {
        const target = (e.target && e.target.nodeType === Node.ELEMENT_NODE)
            ? e.target
            : (e.target && e.target.parentElement ? e.target.parentElement : null);
        if (!target) return;
        // 忽略在resize、小工具栏按钮、链接上的按下
        if (target.closest('.resize-handle') || target.closest('.md-node-toolbar-btn') || target.closest('a')) return;

        // 按住Ctrl键时，暂停编辑模式，允许拖动和调整大小
        if (isSectionCtrlModeEvent(e)) {
            if (isInEditMode) {
                pauseEditForCtrl();
            }
            return; // 让Ctrl模式的逻辑处理
        }

        // 如果在编辑模式中（非Ctrl暂停），允许正常编辑操作
        if (isInEditMode && !ctrlPausedEdit) return;

        const now = Date.now();
        const timeSinceLastClick = now - lastClickTime;

        // 快速双击检测（200ms内）：进入编辑模式
        if (timeSinceLastClick < DOUBLE_CLICK_THRESHOLD && timeSinceLastClick > 30) {
            e.preventDefault();
            e.stopPropagation();
            lastClickTime = 0;
            selectMdNode(node.id);
            enterEditMode();
            return;
        }

        // 单击：选中节点
        lastClickTime = now;
        e.preventDefault(); // 阻止编辑器自动聚焦
        selectMdNode(node.id);
    }, true);

    // 禁用原生双击
    el.addEventListener('dblclick', (e) => {
        const target = (e.target && e.target.nodeType === Node.ELEMENT_NODE)
            ? e.target
            : (e.target && e.target.parentElement ? e.target.parentElement : null);
        if (!target) return;
        if (target.closest('.resize-handle') || target.closest('.md-node-toolbar-btn')) return;
        e.preventDefault();
        e.stopPropagation();
    }, true);

    // 工具栏mousedown：阻止默认行为防止编辑器失焦
    toolbar.addEventListener('mousedown', (e) => {
        const btn = e.target.closest('.md-format-btn, .md-fontcolor-chip, .md-align-option, .md-heading-option, .md-list-option, .md-fontcolor-input');
        if (btn && node.isEditing) {
            e.preventDefault(); // 防止编辑器失去焦点
        }
    });

    // 工具栏事件
    toolbar.addEventListener('click', (e) => {
        const btn = e.target.closest('.md-node-toolbar-btn, .md-color-chip, .md-color-custom, .md-color-picker-btn, .md-format-btn, .md-fontcolor-chip, .md-align-option, .md-heading-option, .md-list-option');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const action = btn.getAttribute('data-action');
        if (action === 'md-edit') {
            selectMdNode(node.id);
            enterEditMode();
        } else if (action === 'md-delete') {
            // 普通节点的删除
            removeMdNode(node.id);
            clearMdSelection();
        } else if (action === 'md-delete-frame-only') {
            // import-container: 仅删除框体，保留内容
            removeMdNode(node.id, false);
            clearMdSelection();
        } else if (action === 'md-delete-all-content') {
            // import-container: 删除框体及全部内容
            removeMdNode(node.id, true);
            clearMdSelection();
        } else if (action === 'md-color-toggle') {
            toggleMdColorPopover(toolbar, node, btn);
        } else if (action === 'md-color-preset') {
            const preset = String(btn.getAttribute('data-color') || '').trim();
            // 更新颜色历史
            const newColor = presetToHex(preset);
            if (newColor && node.colorHex) {
                CanvasState.mdNodePrevColor = node.colorHex;
            }
            setMdNodeColor(node, preset);
            closeMdColorPopover(toolbar);
        } else if (action === 'md-color-default') {
            node.color = null;
            node.colorHex = null;
            const el2 = document.getElementById(node.id);
            if (el2) applyMdNodeColor(el2, node);
            saveTempNodes();
            closeMdColorPopover(toolbar);
        } else if (action === 'md-color-picker-toggle') {
            // RGB选择器切换由ensureMdColorPopover中的事件处理
        } else if (action === 'md-color-custom') {
            // 自定义颜色快捷选项（灰色、默认蓝色等）
            const customColor = btn.getAttribute('data-color');
            if (customColor) {
                // 更新颜色历史
                if (node.colorHex) {
                    CanvasState.mdNodePrevColor = node.colorHex;
                }
                node.color = null;
                node.colorHex = customColor;
                const el2 = document.getElementById(node.id);
                if (el2) applyMdNodeColor(el2, node);
                saveTempNodes();
                closeMdColorPopover(toolbar);
            }
        } else if (action === 'md-color-recent') {
            // 上一次颜色
            const recentColor = btn.getAttribute('data-color') || CanvasState.mdNodePrevColor;
            if (recentColor) {
                const oldColor = node.colorHex;
                node.color = null;
                node.colorHex = recentColor;
                const el2 = document.getElementById(node.id);
                if (el2) applyMdNodeColor(el2, node);
                // 交换颜色历史
                if (oldColor) {
                    CanvasState.mdNodePrevColor = oldColor;
                }
                saveTempNodes();
                closeMdColorPopover(toolbar);
            }
        } else if (action === 'md-focus') {
            selectMdNode(node.id);
            locateAndZoomToMdNode(node.id);
        } else if (action === 'md-format-toggle') {
            // 打开格式工具栏
            toggleFormatPopover(btn);
        } else if (action === 'md-font-increase') {
            // 增大字体
            if (node.fontSize < maxFontSize) {
                node.fontSize = Math.min(maxFontSize, node.fontSize + 2);
                editor.style.fontSize = node.fontSize + 'px';
                // 更新弹层中的字号显示
                const sizeValue = toolbar.querySelector('.md-format-size-value');
                if (sizeValue) sizeValue.textContent = node.fontSize + 'px';
                saveTempNodes();
            }
        } else if (action === 'md-font-decrease') {
            // 减小字体
            if (node.fontSize > minFontSize) {
                node.fontSize = Math.max(minFontSize, node.fontSize - 2);
                editor.style.fontSize = node.fontSize + 'px';
                // 更新弹层中的字号显示
                const sizeValue = toolbar.querySelector('.md-format-size-value');
                if (sizeValue) sizeValue.textContent = node.fontSize + 'px';
                saveTempNodes();
            }
        } else if (action === 'md-insert-bold') {
            insertFormat('bold');
        } else if (action === 'md-insert-italic') {
            insertFormat('italic');
        } else if (action === 'md-insert-underline') {
            insertFormat('underline');
        } else if (action === 'md-insert-highlight') {
            insertFormat('highlight');
        } else if (action === 'md-fontcolor-toggle') {
            toggleFontColorPopover(btn);
        } else if (action === 'md-fontcolor-apply') {
            const color = btn.getAttribute('data-color');
            if (color) {
                insertFontColor(color);
                closeFontColorPopover();
            }
        } else if (action === 'md-insert-strike') {
            insertFormat('strike');
        } else if (action === 'md-insert-code') {
            insertFormat('code');
        } else if (action === 'md-insert-link') {
            insertFormat('link');
        } else if (action === 'md-heading-toggle') {
            toggleHeadingPopover(btn);
        } else if (action === 'md-heading-apply') {
            const level = btn.getAttribute('data-level');
            if (level) {
                insertFormat(level);
                closeHeadingPopover();
            }
        } else if (action === 'md-align-toggle') {
            toggleAlignPopover(btn);
        } else if (action === 'md-align-apply') {
            const alignType = btn.getAttribute('data-align');
            if (alignType) {
                insertAlign(alignType);
                closeAlignPopover();
            }
        } else if (action === 'md-list-toggle') {
            toggleListPopover(btn);
        } else if (action === 'md-list-apply') {
            const listType = btn.getAttribute('data-type');
            if (listType) {
                insertFormat(listType);
                closeListPopover();
            }
        } else if (action === 'md-insert-quote') {
            insertFormat('quote');
        } else if (action === 'md-format-close') {
            closeFormatPopover();
        }
    });

    // 同步字体大小到编辑器
    editor.style.fontSize = node.fontSize + 'px';

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

    // Ctrl 蒙版同步
    registerSectionCtrlOverlay(el);
}

// —— 工具栏动作实现 ——
function presetToHex(preset) {
    // Obsidian Canvas 官方颜色：红橙黄绿青紫
    switch (String(preset)) {
        case '1': return '#fb464c'; // 红色 (Red)
        case '2': return '#e9973f'; // 橙色 (Orange)
        case '3': return '#e0de71'; // 黄色 (Yellow)
        case '4': return '#44cf6e'; // 绿色 (Green)
        case '5': return '#53dfdd'; // 青蓝色 (Cyan)
        case '6': return '#a882ff'; // 紫色 (Purple)
        default: return null;
    }
}

function applyMdNodeColor(el, node) {
    const hex = node && (node.colorHex || presetToHex(node.color) || null);
    if (!el) return;
    if (hex) {
        el.style.borderColor = hex;
        el.style.setProperty('--section-color', hex);
        // 设置CSS变量用于选中时的发光效果
        el.style.setProperty('--node-glow-color', hex);
        el.setAttribute('data-has-color', 'true');
    } else {
        // 恢复默认样式
        el.style.borderColor = '';
        try {
            const fallback = window.getComputedStyle(el).borderColor;
            if (fallback) el.style.setProperty('--section-color', fallback);
            else el.style.removeProperty('--section-color');
        } catch (_) {
            el.style.removeProperty('--section-color');
        }
        el.style.removeProperty('--node-glow-color');
        el.removeAttribute('data-has-color');
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
    preventCanvasEventsPropagation(pop);

    // 多语言支持
    const lang = typeof currentLang !== 'undefined' ? currentLang : 'zh';
    const rgbPickerTitle = lang === 'en' ? 'RGB Color Picker' : 'RGB颜色选择器';
    const customColorTitle = lang === 'en' ? 'Select custom color' : '选择自定义颜色';
    const recentTitle = lang === 'en' ? 'Previous color' : '上一次颜色';

    // 使用 Obsidian Canvas 风格的颜色
    pop.innerHTML = `
        <span class="md-color-chip" data-action="md-color-custom" data-color="#888888" style="background:#888888" title="${lang === 'en' ? 'Gray' : '灰色'}"></span>
        <span class="md-color-chip" data-action="md-color-custom" data-color="#66bbff" style="background:#66bbff" title="${lang === 'en' ? 'Default Blue' : '默认蓝色'}"></span>
        <span class="md-color-chip" data-action="md-color-preset" data-color="1" style="background:#fb464c"></span>
        <span class="md-color-chip" data-action="md-color-preset" data-color="2" style="background:#e9973f"></span>
        <span class="md-color-chip" data-action="md-color-preset" data-color="3" style="background:#e0de71"></span>
        <span class="md-color-chip" data-action="md-color-preset" data-color="4" style="background:#44cf6e"></span>
        <span class="md-color-chip" data-action="md-color-preset" data-color="5" style="background:#53dfdd"></span>
        <span class="md-color-chip" data-action="md-color-preset" data-color="6" style="background:#a882ff"></span>
        <span class="md-color-divider" aria-hidden="true"></span>
        <span class="md-color-chip md-color-recent-chip" data-action="md-color-recent" title="${recentTitle}"></span>
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

    // 上一次颜色功能
    const recentChipEl = pop.querySelector('.md-color-recent-chip');
    const resolveHistoryColor = (value) => {
        const normalized = normalizeHexColor(value || '');
        return normalized ? `#${normalized}` : '#66bbff';
    };
    const syncHistoryChip = (value) => {
        if (!recentChipEl) return;
        const safe = resolveHistoryColor(value);
        recentChipEl.dataset.color = safe;
        recentChipEl.style.backgroundColor = safe;
    };
    // 初始化上一次颜色
    syncHistoryChip(CanvasState.mdNodePrevColor || '#66bbff');

    // RGB选择器UI（显示在色盘上方）
    const rgbPicker = document.createElement('div');
    rgbPicker.className = 'md-rgb-picker';
    rgbPicker.innerHTML = `
        <input class="md-color-input" type="color" value="${node.colorHex || '#66bbff'}" title="${customColorTitle}" />
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
    updateCanvasPopoverState(true);
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
    if (pop) {
        pop.classList.remove('open');
        updateCanvasPopoverState(false);
    }
}

// 删除选项弹窗 (用于 import-container)
function ensureDeleteOptionsPopover(toolbar, node) {
    let pop = toolbar.querySelector('.md-delete-options-popover');
    if (pop) return pop;

    pop = document.createElement('div');
    pop.className = 'md-delete-options-popover';

    // 多语言支持
    const lang = typeof currentLang !== 'undefined' ? currentLang : 'zh';
    const deleteFrameTitle = lang === 'en' ? 'Delete Frame Only' : '仅删除框体';
    const deleteAllTitle = lang === 'en' ? 'Delete All Content' : '删除全部内容';

    pop.innerHTML = `
        <button class="md-delete-option" data-action="md-delete-frame-only" title="${deleteFrameTitle}">
            <i class="far fa-square"></i>
            <span>${deleteFrameTitle}</span>
        </button>
        <button class="md-delete-option md-delete-option-danger" data-action="md-delete-all-content" title="${deleteAllTitle}">
            <i class="fas fa-trash-alt"></i>
            <span>${deleteAllTitle}</span>
        </button>
    `;

    preventCanvasEventsPropagation(pop);

    // 删除选项点击事件
    pop.addEventListener('click', (e) => {
        const btn = e.target.closest('.md-delete-option');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();

        const action = btn.getAttribute('data-action');
        if (action === 'md-delete-frame-only') {
            // 仅删除框体，保留内容
            removeMdNode(node.id, false);
            clearMdSelection();
        } else if (action === 'md-delete-all-content') {
            // 删除全部内容
            removeMdNode(node.id, true);
            clearMdSelection();
        }
        closeDeleteOptionsPopover(toolbar);
    });

    toolbar.appendChild(pop);
    return pop;
}

function toggleDeleteOptionsPopover(toolbar, node, anchorBtn) {
    const pop = ensureDeleteOptionsPopover(toolbar, node);
    const isOpen = pop.classList.contains('open');

    // 关闭其他弹层
    closeMdColorPopover(toolbar);

    if (isOpen) {
        closeDeleteOptionsPopover(toolbar);
        return;
    }
    pop.classList.add('open');
    updateCanvasPopoverState(true);

    // 监听外部点击关闭
    const onDoc = (e) => {
        if (!toolbar.contains(e.target)) {
            closeDeleteOptionsPopover(toolbar);
            document.removeEventListener('mousedown', onDoc, true);
        }
    };
    document.addEventListener('mousedown', onDoc, true);
}

function closeDeleteOptionsPopover(toolbar) {
    const pop = toolbar.querySelector('.md-delete-options-popover');
    if (pop) {
        pop.classList.remove('open');
        updateCanvasPopoverState(false);
    }
}


// 定位并放大到指定 Markdown 节点
function locateAndZoomToMdNode(nodeId, targetZoom = null) {
    const el = document.getElementById(nodeId);
    const workspace = document.getElementById('canvasWorkspace');
    if (!el || !workspace) return;

    const workspaceWidth = workspace.clientWidth;
    const workspaceHeight = workspace.clientHeight;
    const nodeWidth = el.offsetWidth || 200;
    const nodeHeight = el.offsetHeight || 100;

    // 自动计算合适的缩放比例，使节点完整显示在视野中
    // 留出一些边距（80px）
    const padding = 80;
    let fitZoom;
    if (targetZoom === null) {
        const zoomX = (workspaceWidth - padding * 2) / nodeWidth;
        const zoomY = (workspaceHeight - padding * 2) / nodeHeight;
        // 取两者中较小的值，确保节点在两个方向上都能完整显示
        fitZoom = Math.min(zoomX, zoomY);
        // 限制缩放范围：最小0.2，最大1.5（不要放得太大）
        fitZoom = Math.max(0.2, Math.min(1.5, fitZoom));
    } else {
        fitZoom = targetZoom;
    }

    const zoom = Math.max(0.1, Math.min(3, fitZoom));
    if (zoom !== CanvasState.zoom) {
        const rect = workspace.getBoundingClientRect();
        setCanvasZoom(zoom, rect.left + rect.width / 2, rect.top + rect.height / 2, { recomputeBounds: true });
    }

    const nodeLeft = parseFloat(el.style.left) || 0;
    const nodeTop = parseFloat(el.style.top) || 0;
    const nodeCenterX = nodeLeft + nodeWidth / 2;
    const nodeCenterY = nodeTop + nodeHeight / 2;

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

function removeMdNode(id, deleteChildren = false) {
    // Check for container cascading delete
    const node = CanvasState.mdNodes.find(n => n.id === id);
    if (node && node.subtype === 'import-container' && deleteChildren && !node._deletingChildren) {
        node._deletingChildren = true;
        const gx = node.x; const gy = node.y; const gw = node.width; const gh = node.height;
        const idsToRemove = { temp: [], md: [] };

        // Find internal
        CanvasState.tempSections.forEach(s => {
            const sx = s.x + (s.width / 2);
            const sy = s.y + (s.height / 2);
            if (sx > gx && sx < gx + gw && sy > gy && sy < gy + gh) idsToRemove.temp.push(s.id);
        });
        CanvasState.mdNodes.forEach(n => {
            if (n.id === id) return;
            const nx = n.x + (n.width / 2);
            const ny = n.y + (n.height / 2);
            if (nx > gx && nx < gx + gw && ny > gy && ny < gy + gh) idsToRemove.md.push(n.id);
        });

        // Delete internal
        idsToRemove.temp.forEach(tid => removeTempNode(tid));
        idsToRemove.md.forEach(mid => removeMdNode(mid)); // Recursive safe because _deletingChildren is not set on children (unless they are nested containers)
    }

    const el = document.getElementById(id);
    if (el) el.remove();
    CanvasState.mdNodes = CanvasState.mdNodes.filter(n => n.id !== id);
    // Remove edges connected to this markdown node
    removeEdgesForNode(id);
    saveTempNodes();
    scheduleBoundsUpdate();
}

function __sanitizeCanvasRichTextHtml(html) {
    const raw = String(html || '');
    if (!raw) return '';

    const allowedTags = new Set([
        'a',
        'p',
        'center',
        'font',
        'span',
        'u',
        'mark',
        'strong',
        'em',
        'b',
        'i',
        'del',
        's',
        'sub',
        'sup',
        'br',
        'code',
        'blockquote',
        'ul',
        'ol',
        'li',
        'hr',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'div',
        'input',
        'img',
        'button',
        'details',
        'summary'
    ]);

    const allowedAttrs = new Set([
        'href',
        'title',
        'target',
        'rel',
        'color',
        'align',
        'class',
        'data-wikilink',
        'data-callout',
        'data-md-collapsible',
        'data-md-collapsed',
        'type',
        'checked',
        'disabled',
        'src',
        'alt',
        'aria-label',
        'aria-expanded',
        'aria-hidden',
        'open'
    ]);

    const allowedAlign = new Set(['left', 'center', 'right', 'justify']);

    const sanitizeHref = (href) => {
        const h = String(href || '').trim();
        if (!h) return null;
        try {
            if (typeof ObsidianMarkdown !== 'undefined' && typeof ObsidianMarkdown.sanitizeHref === 'function') {
                return ObsidianMarkdown.sanitizeHref(h);
            }
        } catch (_) { }
        if (h.startsWith('#')) return h;
        try {
            const u = new URL(h, 'https://dummy.local');
            const ok = u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:' || u.protocol === 'tel:';
            return ok ? h : null;
        } catch (_) {
            return null;
        }
    };

    const sanitizeSrc = (src) => {
        const s = String(src || '').trim();
        if (!s) return null;
        if (s.startsWith('data:image/')) return s;
        try {
            const u = new URL(s, 'https://dummy.local');
            const ok = u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'blob:' || u.protocol === 'chrome-extension:';
            return ok ? s : null;
        } catch (_) {
            return null;
        }
    };

    const tpl = document.createElement('template');
    tpl.innerHTML = raw;

    const sanitizeElement = (el) => {
        const tag = String(el.tagName || '').toLowerCase();
        if (!allowedTags.has(tag)) {
            const text = document.createTextNode(el.textContent || '');
            el.replaceWith(text);
            return;
        }

        // Strip disallowed / dangerous attributes
        Array.from(el.attributes || []).forEach((attr) => {
            const name = String(attr.name || '').toLowerCase();
            if (name.startsWith('on') || !allowedAttrs.has(name)) {
                try { el.removeAttribute(attr.name); } catch (_) { }
            }
        });

        if (tag === 'a') {
            const safe = sanitizeHref(el.getAttribute('href'));
            if (!safe) {
                const text = document.createTextNode(el.textContent || '');
                el.replaceWith(text);
                return;
            }
            el.setAttribute('href', safe);
            el.setAttribute('target', '_blank');
            el.setAttribute('rel', 'noopener noreferrer');
        }

        if (tag === 'img') {
            const safeSrc = sanitizeSrc(el.getAttribute('src'));
            if (!safeSrc) {
                const text = document.createTextNode(el.getAttribute('alt') || '');
                el.replaceWith(text);
                return;
            }
            el.setAttribute('src', safeSrc);
            return;
        }

        if (tag === 'button') {
            el.setAttribute('type', 'button');
        }

        if (tag === 'p' && el.hasAttribute('align')) {
            const a = String(el.getAttribute('align') || '').toLowerCase();
            if (!allowedAlign.has(a)) {
                try { el.removeAttribute('align'); } catch (_) { }
            } else {
                el.setAttribute('align', a);
            }
        }

        if (tag === 'font' && el.hasAttribute('color')) {
            const rawColor = el.getAttribute('color') || '';
            const normalized = normalizeHexColor(rawColor);
            if (!normalized) {
                try { el.removeAttribute('color'); } catch (_) { }
            } else {
                el.setAttribute('color', `#${normalized}`);
            }
        }

        if (tag === 'input') {
            const type = String(el.getAttribute('type') || '').toLowerCase();
            if (type !== 'checkbox') {
                const text = document.createTextNode('');
                el.replaceWith(text);
                return;
            }
            el.setAttribute('type', 'checkbox');
        }
    };

    const walk = (node) => {
        const children = Array.from(node.childNodes || []);
        children.forEach((child) => {
            if (!child) return;
            if (child.nodeType === Node.COMMENT_NODE) {
                try { child.remove(); } catch (_) { }
                return;
            }
            if (child.nodeType === Node.ELEMENT_NODE) {
                sanitizeElement(child);
                // If still connected, traverse
                if (child.parentNode) {
                    walk(child);
                }
                return;
            }
            if (child.nodeType === Node.TEXT_NODE) {
                return;
            }
            try { child.remove(); } catch (_) { }
        });
    };

    walk(tpl.content);

    const out = document.createElement('div');
    out.appendChild(tpl.content);
    return out.innerHTML;
}

function __placeCaretAtEnd(editableEl) {
    if (!editableEl) return;
    try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editableEl);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
    } catch (_) { }
}

function __tryConvertInlinePatternsInTextNode(editorEl, explicitNode = null) {
    if (!editorEl) return false;
    let textNode;
    let cursorPos;
    let sel = null;

    if (explicitNode) {
        if (explicitNode.nodeType !== Node.TEXT_NODE) return false;
        textNode = explicitNode;
        cursorPos = Number.MAX_SAFE_INTEGER; // Bypass typing check
    } else {
        sel = window.getSelection();
        if (!sel || !sel.rangeCount) return false;
        const range = sel.getRangeAt(0);
        const start = range.startContainer;
        if (!start || start.nodeType !== Node.TEXT_NODE) return false;
        if (!editorEl.contains(start)) return false;
        textNode = start;
        cursorPos = range.startOffset;
    }

    const text = textNode.textContent || '';

    const patterns = [
        // HTML-like explicit syntax
        { type: 'font', regex: /<font\s+color=["']?([^"'>\s]+)["']?>([^<]*)<\/font>/i, tag: 'font', attrName: 'color', attrIndex: 1, contentIndex: 2 },
        { type: 'center', regex: /<center>([^<]*)<\/center>/i, tag: 'center', contentIndex: 1 },
        { type: 'pAlign', regex: /<p\s+align=["']?([^"'>\s]+)["']?>([^<]*)<\/p>/i, tag: 'p', attrName: 'align', attrIndex: 1, contentIndex: 2 },
        { type: 'u', regex: /<u>([^<]*)<\/u>/i, tag: 'u', contentIndex: 1 },

        // Markdown-like implicit syntax
        { type: 'bold', regex: /\*\*(.+?)\*\*/, tag: 'strong', contentIndex: 1 },
        { type: 'italic', regex: /\*(.+?)\*/, tag: 'em', contentIndex: 1 },
        { type: 'strike', regex: /~~(.+?)~~/, tag: 'del', contentIndex: 1 },
        { type: 'highlight', regex: /==(.+?)==/, tag: 'mark', contentIndex: 1 },
        { type: 'code', regex: /`([^`]+)`/, tag: 'code', contentIndex: 1 },
        { type: 'wikilink', regex: /\[\[([^\]]+?)\]\]/, tag: 'span', className: 'md-wikilink', contentIndex: 1 },
        { type: 'link', regex: /\[([^\]]+?)\]\(([^)]+?)\)/, tag: 'a', contentIndex: 1, hrefIndex: 2 },
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern.regex);
        if (!match || match.index == null) continue;

        const matchStart = match.index;
        const matchEnd = matchStart + match[0].length;
        if (cursorPos < matchEnd) continue; // user still typing inside the pattern

        const before = text.substring(0, matchStart);
        const after = text.substring(matchEnd);
        const afterText = after || '\u200B';

        const parent = textNode.parentNode;
        if (!parent) return false;

        const beforeNode = before ? document.createTextNode(before) : null;
        const afterNode = document.createTextNode(afterText);

        const parseInlineMarkdown = (text) => {
            if (!text) return text;
            return text
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.+?)\*/g, '<em>$1</em>')
                .replace(/~~(.+?)~~/g, '<del>$1</del>')
                .replace(/==(.+?)==/g, '<mark>$1</mark>')
                .replace(/`([^`]+)`/g, '<code>$1</code>');
        };

        const setContent = (element, content) => {
            const parsed = parseInlineMarkdown(content);
            if (/<[^>]+>/.test(parsed)) {
                element.innerHTML = parsed;
            } else {
                element.textContent = content;
            }
        };

        let newNode = null;
        if (pattern.type === 'link') {
            const href = match[pattern.hrefIndex] || '';
            const safeHref = (typeof ObsidianMarkdown !== 'undefined' && typeof ObsidianMarkdown.sanitizeHref === 'function')
                ? ObsidianMarkdown.sanitizeHref(href)
                : href;
            if (!safeHref) {
                newNode = document.createTextNode(match[0] || '');
            } else {
                const a = document.createElement('a');
                a.setAttribute('href', safeHref);
                a.setAttribute('target', '_blank');
                a.setAttribute('rel', 'noopener noreferrer');
                // Link text might contain formatting too
                setContent(a, match[pattern.contentIndex] || '');
                newNode = a;
            }
        } else {
            const newEl = document.createElement(pattern.tag);
            if (pattern.className) newEl.className = pattern.className;
            if (pattern.attrName && pattern.attrIndex) {
                newEl.setAttribute(pattern.attrName, match[pattern.attrIndex]);
            }
            setContent(newEl, match[pattern.contentIndex] || '');
            newNode = newEl;
        }

        if (beforeNode) parent.insertBefore(beforeNode, textNode);
        parent.insertBefore(newNode, textNode);
        parent.insertBefore(afterNode, textNode);
        parent.removeChild(textNode);

        // Restore caret in the "after" text node (same relative position after the match)
        if (!explicitNode && sel) {
            try {
                const newRange = document.createRange();
                const offsetInAfter = after ? Math.min(afterNode.length, Math.max(0, cursorPos - matchEnd)) : 1;
                newRange.setStart(afterNode, offsetInAfter);
                newRange.collapse(true);
                sel.removeAllRanges();
                sel.addRange(newRange);
            } catch (_) { }
        }

        return true;
    }

    return false;
}

function __coerceDescriptionSourceToHtml(raw) {
    const val = String(raw || '');
    if (!val.trim()) return '';
    const looksLikeHtml = /<\s*(?:a|p|div|span|br|strong|em|b|i|u|del|s|mark|code|blockquote|ul|ol|li|hr|h[1-6]|font|center|input)\b/i.test(val);
    if (looksLikeHtml) return val;
    if (typeof marked !== 'undefined') {
        try { return marked.parse(val); } catch (_) { return val; }
    }
    return val;
}

function __hasMeaningfulRichContent(root) {
    if (!root) return false;
    const nodes = Array.from(root.childNodes || []);
    for (const node of nodes) {
        if (!node) continue;
        if (node.nodeType === Node.TEXT_NODE) {
            const t = (node.textContent || '').replace(/\u200B/g, '').trim();
            if (t) return true;
            continue;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const tag = node.tagName;
        if (tag === 'BR') continue;
        if (tag === 'DIV' || tag === 'P') {
            if (__hasMeaningfulRichContent(node)) return true;
            continue;
        }
        return true;
    }
    return false;
}

function __normalizeCanvasRichHtml(rawHtml) {
    const sanitized = __sanitizeCanvasRichTextHtml(rawHtml);
    if (!sanitized) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = sanitized;
    if (!__hasMeaningfulRichContent(tmp)) return '';
    return sanitized;
}

function __getCleanHtmlForStorage(editorEl) {
    if (!editorEl) return '';
    const clone = editorEl.cloneNode(true);
    clone.querySelectorAll('.md-heading-hidden').forEach(el => {
        try { el.classList.remove('md-heading-hidden'); } catch (_) { }
    });
    return clone.innerHTML;
}

function __isSelectionAll(editorEl, selection) {
    if (!editorEl || !selection || !selection.rangeCount) return false;
    const range = selection.getRangeAt(0);
    if (!editorEl.contains(range.startContainer) || !editorEl.contains(range.endContainer)) return false;
    try {
        const editorRange = document.createRange();
        editorRange.selectNodeContents(editorEl);
        const coversAll = range.compareBoundaryPoints(Range.START_TO_START, editorRange) <= 0 &&
            range.compareBoundaryPoints(Range.END_TO_END, editorRange) >= 0;
        if (coversAll) return true;
    } catch (_) { }
    const fullText = (editorEl.innerText || editorEl.textContent || '').replace(/\u200B/g, '').trim();
    const selectedText = selection.toString().replace(/\u200B/g, '').trim();
    return !!fullText && selectedText === fullText;
}

function __isHeadingNode(node) {
    return !!(node && node.nodeType === Node.ELEMENT_NODE && /^H[1-6]$/.test(node.tagName));
}

function __getHeadingLevel(node) {
    if (!__isHeadingNode(node)) return 0;
    return parseInt(node.tagName.slice(1), 10) || 0;
}

function __applyHeadingCollapse(editorEl) {
    if (!editorEl) return;
    const nodes = Array.from(editorEl.childNodes || []);
    const hasContentBetween = (startIndex, level) => {
        for (let i = startIndex + 1; i < nodes.length; i++) {
            const n = nodes[i];
            if (__isHeadingNode(n)) {
                const nextLevel = __getHeadingLevel(n);
                if (nextLevel <= level) return false;
                return true;
            }
            if (n.nodeType === Node.TEXT_NODE) {
                if ((n.textContent || '').trim()) return true;
                continue;
            }
            return true;
        }
        return false;
    };

    let collapseLevel = null;
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (__isHeadingNode(node)) {
            const level = __getHeadingLevel(node);
            if (collapseLevel !== null && level <= collapseLevel) {
                collapseLevel = null;
            }

            const foldable = hasContentBetween(i, level);
            if (foldable) {
                node.setAttribute('data-md-collapsible', 'true');
            } else {
                try { node.removeAttribute('data-md-collapsible'); } catch (_) { }
                try { node.removeAttribute('data-md-collapsed'); } catch (_) { }
            }

            const shouldHide = collapseLevel !== null && level > collapseLevel;
            if (node.classList) node.classList.toggle('md-heading-hidden', shouldHide);

            if (foldable && node.getAttribute('data-md-collapsed') === 'true') {
                collapseLevel = level;
            }
        } else {
            const shouldHide = collapseLevel !== null;
            if (node.nodeType === Node.ELEMENT_NODE && node.classList) {
                node.classList.toggle('md-heading-hidden', shouldHide);
            }
        }
    }
}

function __handleHeadingCollapseClick(editorEl, e) {
    if (!editorEl || !e || !e.target) return false;
    const heading = e.target.closest('h1, h2, h3, h4, h5, h6');
    if (!heading || heading.parentNode !== editorEl) return false;
    if (heading.getAttribute('data-md-collapsible') !== 'true') return false;

    const rect = heading.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const style = window.getComputedStyle(heading);
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const threshold = Math.max(16, Math.min(28, paddingLeft || 22));
    if (clickX > threshold) return false;

    e.preventDefault();
    e.stopPropagation();

    const collapsed = heading.getAttribute('data-md-collapsed') === 'true';
    if (collapsed) heading.removeAttribute('data-md-collapsed');
    else heading.setAttribute('data-md-collapsed', 'true');

    __applyHeadingCollapse(editorEl);
    return true;
}

function __tryConvertBlockPatternsAtCaret(editorEl, explicitNode = null) {
    if (!editorEl) return false;
    const sel = window.getSelection();

    // 如果没有 explicitNode，则必须依赖 selection
    if (!explicitNode && (!sel || !sel.rangeCount)) return false;

    let lineEl = null;
    let lineTextNode = null;

    if (explicitNode) {
        if (explicitNode.nodeType === Node.TEXT_NODE) {
            if (explicitNode.parentNode === editorEl) {
                lineTextNode = explicitNode;
            } else {
                let cur = explicitNode.parentElement;
                while (cur && cur !== editorEl && cur.parentElement !== editorEl) cur = cur.parentElement;
                if (cur && cur !== editorEl && (cur.tagName === 'DIV' || cur.tagName === 'P')) lineEl = cur;
            }
        } else {
            let cur = explicitNode;
            if (cur !== editorEl) {
                while (cur && cur !== editorEl && cur.parentElement !== editorEl) cur = cur.parentElement;
                if (cur && cur !== editorEl && (cur.tagName === 'DIV' || cur.tagName === 'P')) lineEl = cur;
            }
        }
    } else {
        const range = sel.getRangeAt(0);
        const startContainer = range.startContainer;
        if (!startContainer || !editorEl.contains(startContainer)) return false;

        const parentEl = (startContainer.nodeType === Node.ELEMENT_NODE)
            ? startContainer
            : (startContainer.parentElement || null);
        if (parentEl && parentEl.closest && parentEl.closest('code')) return false;

        if (startContainer.nodeType === Node.TEXT_NODE) {
            if (startContainer.parentNode === editorEl) {
                lineTextNode = startContainer;
            } else {
                let cur = startContainer.parentElement;
                while (cur && cur !== editorEl && cur.parentElement !== editorEl) {
                    cur = cur.parentElement;
                }
                if (cur && cur !== editorEl && (cur.tagName === 'DIV' || cur.tagName === 'P')) {
                    lineEl = cur;
                }
            }
        } else if (startContainer.nodeType === Node.ELEMENT_NODE) {
            let cur = startContainer;
            if (cur !== editorEl) {
                while (cur && cur !== editorEl && cur.parentElement !== editorEl) {
                    cur = cur.parentElement;
                }
                if (cur && cur !== editorEl && (cur.tagName === 'DIV' || cur.tagName === 'P')) {
                    lineEl = cur;
                }
            }
        }
    }

    const rawText = lineEl
        ? (lineEl.textContent || '')
        : (lineTextNode ? (lineTextNode.textContent || '') : '');
    const text = rawText.replace(/\u200B/g, '').trim();
    if (!text) return false;

    const containerEl = lineEl || (lineTextNode ? lineTextNode.parentElement : null);
    if (containerEl && containerEl.closest) {
        const inExistingBlock = containerEl.closest('ul, ol, blockquote, li, .md-task-item, h1, h2, h3, h4, h5, h6');
        if (inExistingBlock && inExistingBlock !== containerEl) return false;
        const t = containerEl.tagName;
        if (t === 'UL' || t === 'OL' || t === 'BLOCKQUOTE') return false;
    }

    // Setext heading: "Title" + next line of --- / ===
    const findNextLineNode = (node) => {
        if (!node) return null;
        let next = node.nextSibling;
        while (next) {
            if (next.nodeType === Node.TEXT_NODE && !next.textContent.trim()) {
                next = next.nextSibling;
                continue;
            }
            if (next.nodeType === Node.ELEMENT_NODE && next.tagName === 'BR') {
                next = next.nextSibling;
                continue;
            }
            return next;
        }
        return null;
    };

    const getNodeText = (node) => {
        if (!node) return '';
        if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
        if (node.nodeType === Node.ELEMENT_NODE) return node.textContent || '';
        return '';
    };

    const removeNodeAndBlock = (n) => {
        if (!n) return;
        if (n.nodeType === Node.ELEMENT_NODE && (n.tagName === 'DIV' || n.tagName === 'P') && n.parentNode === editorEl) {
            try { n.remove(); } catch (_) { }
            return;
        }
        if (n.nodeType === Node.TEXT_NODE && n.parentNode && (n.parentNode.tagName === 'DIV' || n.parentNode.tagName === 'P') && n.parentNode.parentNode === editorEl) {
            try { n.parentNode.remove(); } catch (_) { }
            return;
        }
        try { n.remove(); } catch (_) { }
    };

    const hrMatch = text.match(/^(-{3,}|_{3,}|\*{3,})$/);
    const headingMatch = text.match(/^(#{1,6})\s+(.+)$/);
    const taskMatch = text.match(/^[-*]\s*\[( |x|X)\]\s+(.+)$/);
    const olMatch = text.match(/^(\d+)\.\s+(.+)$/);
    const quoteMatch = text.match(/^>\s+(.+)$/);
    const ulMatch = text.match(/^[-*]\s+(.+)$/);

    const parseInlineMarkdown = (text) => {
        if (!text) return text;
        return text
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/~~(.+?)~~/g, '<del>$1</del>')
            .replace(/==(.+?)==/g, '<mark>$1</mark>')
            .replace(/`([^`]+)`/g, '<code>$1</code>');
    };

    const setContent = (element, content) => {
        const parsed = parseInlineMarkdown(content);
        if (/<[^>]+>/.test(parsed)) {
            element.innerHTML = parsed;
        } else {
            element.textContent = content;
        }
    };

    // Handle Setext headings before other block patterns
    const isSeparator = /^[\u200B]*([-=])\1+\s*$/.test(text);
    if (!isSeparator) {
        const baseNode = lineEl || lineTextNode;
        const nextNode = findNextLineNode(baseNode);
        if (nextNode) {
            const nextText = getNodeText(nextNode).replace(/\u200B/g, '').trim();
            let level = 0;
            if (nextNode.nodeType === Node.ELEMENT_NODE && nextNode.tagName === 'HR') {
                level = 2;
            } else if (/^-{3,}$/.test(nextText)) {
                level = 2;
            } else if (/^={3,}$/.test(nextText)) {
                level = 1;
            }
            if (level) {
                const heading = document.createElement('h' + level);
                setContent(heading, String(text || '').trim());
                const parent = lineEl ? lineEl.parentNode : (lineTextNode ? lineTextNode.parentNode : null);
                const refNode = lineEl || lineTextNode;
                if (!parent || !refNode) return false;

                parent.insertBefore(heading, refNode);
                const spacer = document.createTextNode('\u200B');
                if (heading.nextSibling) parent.insertBefore(spacer, heading.nextSibling);
                else parent.appendChild(spacer);
                try { parent.removeChild(refNode); } catch (_) { }
                removeNodeAndBlock(nextNode);

                try {
                    const newRange = document.createRange();
                    newRange.setStart(spacer, 1);
                    newRange.collapse(true);
                    if (sel) {
                        sel.removeAllRanges();
                        sel.addRange(newRange);
                    }
                } catch (_) { }

                return true;
            }
        }
    }

    let wrapper = null;
    if (taskMatch) {
        wrapper = document.createElement('div');
        wrapper.className = 'md-task-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'md-task-checkbox';
        if (String(taskMatch[1] || '').trim().toLowerCase() === 'x') cb.checked = true;
        wrapper.appendChild(cb);
        const textSpan = document.createElement('span');
        setContent(textSpan, ' ' + String(taskMatch[2] || '').trim());
        wrapper.appendChild(textSpan);
    } else if (hrMatch) {
        wrapper = document.createElement('hr');
    } else if (headingMatch) {
        const level = Math.min(6, Math.max(1, String(headingMatch[1] || '').length));
        wrapper = document.createElement('h' + level);
        setContent(wrapper, String(headingMatch[2] || '').trim());
    } else if (quoteMatch) {
        wrapper = document.createElement('blockquote');
        setContent(wrapper, String(quoteMatch[1] || '').trim());
    } else if (olMatch) {
        wrapper = document.createElement('ol');
        const li = document.createElement('li');
        setContent(li, String(olMatch[2] || '').trim());
        wrapper.appendChild(li);
    } else if (ulMatch) {
        wrapper = document.createElement('ul');
        const li = document.createElement('li');
        setContent(li, String(ulMatch[1] || '').trim());
        wrapper.appendChild(li);
    }

    if (!wrapper) return false;
    const parent = lineEl ? lineEl.parentNode : (lineTextNode ? lineTextNode.parentNode : null);
    const refNode = lineEl || lineTextNode;
    if (!parent || !refNode) return false;

    parent.insertBefore(wrapper, refNode);
    const spacer = document.createTextNode('\u200B');
    if (wrapper.nextSibling) parent.insertBefore(spacer, wrapper.nextSibling);
    else parent.appendChild(spacer);
    try { parent.removeChild(refNode); } catch (_) { }

    try {
        const newRange = document.createRange();
        newRange.setStart(spacer, 1);
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);
    } catch (_) { }

    return true;
}

function __fullScanRenderDescriptionEditor(editorEl) {
    if (!editorEl) return;

    // 1. Process Block Patterns first
    // We check direct children or text nodes
    let children = Array.from(editorEl.childNodes);
    for (const child of children) {
        __tryConvertBlockPatternsAtCaret(editorEl, child);
    }

    // 2. Process Inline Patterns repeatedly until no changes
    let changed = true;
    let loop = 0;
    while (changed && loop++ < 10) {
        changed = false;
        const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT, null, false);
        const textNodes = [];
        let node;
        while (node = walker.nextNode()) textNodes.push(node);

        for (const tn of textNodes) {
            if (!tn.parentNode) continue;
            // Skip if inside code block or pre
            if (tn.parentNode.closest('code, pre')) continue;

            if (__tryConvertInlinePatternsInTextNode(editorEl, tn)) {
                changed = true;
            }
        }
    }

    try { __applyHeadingCollapse(editorEl); } catch (_) { }
}

function __mountMdCloneDescriptionEditor({ editor, toolbar, formatToggleBtn, isEditing, enterEdit, save, nodeId }) {
    if (!editor || !toolbar || !formatToggleBtn) return null;

    const getLang = () => (typeof currentLang !== 'undefined' ? currentLang : 'zh');

    const __insertTextAtSelection = (text) => {
        const val = String(text || '');
        if (!val) return;
        try {
            document.execCommand('insertText', false, val);
            return;
        } catch (_) { }
        try {
            const sel = window.getSelection();
            if (!sel || !sel.rangeCount) return;
            const range = sel.getRangeAt(0);
            range.deleteContents();
            const tn = document.createTextNode(val);
            range.insertNode(tn);
            const newRange = document.createRange();
            newRange.setStartAfter(tn);
            newRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(newRange);
        } catch (_) { }
    };

    const __insertHtmlAtSelection = (html) => {
        const safeHtml = String(html || '');
        if (!safeHtml) return;
        try {
            document.execCommand('insertHTML', false, safeHtml);
            return;
        } catch (_) { }
        try {
            const sel = window.getSelection();
            if (!sel || !sel.rangeCount) return;
            const range = sel.getRangeAt(0);
            range.deleteContents();
            const tpl = document.createElement('template');
            tpl.innerHTML = safeHtml;
            const frag = tpl.content;
            const last = frag.lastChild;
            range.insertNode(frag);
            if (last) {
                const newRange = document.createRange();
                newRange.setStartAfter(last);
                newRange.collapse(true);
                sel.removeAllRanges();
                sel.addRange(newRange);
            }
        } catch (_) { }
    };

    // 保存选区函数（用于工具栏点击时恢复）
    let savedSelection = null;
    const saveSelection = () => {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
            savedSelection = {
                range: sel.getRangeAt(0).cloneRange(),
                text: sel.toString()
            };
        }
    };
    editor.addEventListener('mouseup', saveSelection);
    editor.addEventListener('keyup', saveSelection);

    // 修复粘贴后不自动渲染的问题
    editor.addEventListener('paste', (e) => {
        // 多行/块级 Markdown 粘贴：直接解析为 HTML 插入，避免整段文本落在同一个节点导致无法命中规则
        try {
            const cd = e && e.clipboardData;
            const clipboardHtml = cd ? String(cd.getData('application/x-bookmark-canvas-html') || cd.getData('text/html') || '') : '';
            const plain = cd ? String(cd.getData('text/plain') || '') : '';
            const normalized = plain.replace(/\r\n/g, '\n');
            const trimmed = normalized.trim();
            const looksLikeBlockMd = /(^|\n)\s*(#{1,6}\s+|>\s+|[-*]\s*(?:\[[ xX]\]\s+)?|\d+\.\s+|```)/.test(trimmed);
            const isMultiLine = /\n/.test(trimmed);
            const safeHtml = clipboardHtml ? __normalizeCanvasRichHtml(clipboardHtml) : '';
            const hasHtmlTags = /<\s*(?:a|p|div|span|br|strong|em|b|i|u|del|s|mark|code|blockquote|ul|ol|li|hr|h[1-6]|font|center|pre|img|input|button|details|summary)\b/i.test(clipboardHtml);

            // 优先使用内部专用 HTML（避免 Markdown 往返导致格式丢失）
            if (safeHtml && hasHtmlTags) {
                e.preventDefault();
                __insertHtmlAtSelection(safeHtml);
                setTimeout(() => {
                    __fullScanRenderDescriptionEditor(editor);
                    saveEditorContent();
                }, 0);
                return;
            }

            if (trimmed && (isMultiLine || looksLikeBlockMd) && typeof marked !== 'undefined') {
                e.preventDefault();
                let parsedHtml = '';
                try { parsedHtml = marked.parse(trimmed); } catch (_) { parsedHtml = ''; }
                const safe = __normalizeCanvasRichHtml(parsedHtml);
                if (safe) {
                    __insertHtmlAtSelection(safe);
                } else {
                    // Fallback: insert as plain text
                    __insertTextAtSelection(normalized);
                }
                setTimeout(() => {
                    __fullScanRenderDescriptionEditor(editor);
                    saveEditorContent();
                }, 0);
                return;
            }

            // marked 不可用时：仍然把多行文本拆成多行节点，确保后续渲染规则可命中
            if (trimmed && (isMultiLine || looksLikeBlockMd) && typeof marked === 'undefined') {
                e.preventDefault();
                const esc = (s) => String(s || '')
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#39;');
                const lines = normalized.split('\n');
                const html = lines.map(line => `<div>${esc(line)}</div>`).join('');
                __insertHtmlAtSelection(html);
                setTimeout(() => {
                    __fullScanRenderDescriptionEditor(editor);
                    saveEditorContent();
                }, 0);
                return;
            }
        } catch (_) { }

        setTimeout(() => {
            __fullScanRenderDescriptionEditor(editor);
            saveEditorContent();
        }, 50);
    });

    const saveEditorContent = () => {
        try { if (typeof save === 'function') save(); } catch (_) { }
        try { if (undoManager) undoManager.scheduleRecord('save'); } catch (_) { }
    };

    // =========================================================================
    // Markdown Editor Logic (Undo/Redo + Syntax Expansion)
    // =========================================================================

    // —— Undo/Redo Manager ——
    let undoManager = null;
    (() => {
        try {
            if (!CanvasState.mdUndoStates) {
                CanvasState.mdUndoStates = new Map();
            }
            const idKey = nodeId || (editor.id ? editor.id : 'anonymous-editor-' + Math.random());

            const getNodePath = (root, target) => {
                if (!root || !target) return null;
                const path = [];
                let nodeCur = target;
                while (nodeCur && nodeCur !== root) {
                    const parent = nodeCur.parentNode;
                    if (!parent) return null;
                    const idx = Array.prototype.indexOf.call(parent.childNodes, nodeCur);
                    if (idx < 0) return null;
                    path.unshift(idx);
                    nodeCur = parent;
                }
                return nodeCur === root ? path : null;
            };

            const resolveNodePath = (root, path) => {
                if (!root || !Array.isArray(path)) return null;
                let cur = root;
                for (const idx of path) {
                    if (!cur || !cur.childNodes || idx < 0 || idx >= cur.childNodes.length) return null;
                    cur = cur.childNodes[idx];
                }
                return cur;
            };

            const clampOffset = (nodeForOffset, offset) => {
                const safe = Math.max(0, Number.isFinite(offset) ? offset : 0);
                if (!nodeForOffset) return 0;
                if (nodeForOffset.nodeType === Node.TEXT_NODE) {
                    const len = (nodeForOffset.textContent || '').length;
                    return Math.min(safe, len);
                }
                if (nodeForOffset.nodeType === Node.ELEMENT_NODE) {
                    return Math.min(safe, nodeForOffset.childNodes.length);
                }
                return 0;
            };

            const captureSelection = () => {
                const sel = window.getSelection();
                if (!sel || !sel.rangeCount) return null;
                const range = sel.getRangeAt(0);
                if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return null;
                const startPath = getNodePath(editor, range.startContainer);
                const endPath = getNodePath(editor, range.endContainer);
                if (!startPath || !endPath) return null;
                return {
                    startPath,
                    startOffset: range.startOffset,
                    endPath,
                    endOffset: range.endOffset,
                    collapsed: range.collapsed
                };
            };

            const restoreSelection = (selData) => {
                try {
                    if (!selData) return;
                    const startNode = resolveNodePath(editor, selData.startPath) || editor;
                    const endNode = resolveNodePath(editor, selData.endPath) || startNode;
                    const range = document.createRange();
                    range.setStart(startNode, clampOffset(startNode, selData.startOffset));
                    range.setEnd(endNode, clampOffset(endNode, selData.endOffset));
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                } catch (_) { }
            };

            const snapshot = () => ({
                html: editor.innerHTML,
                selection: captureSelection(),
                scrollTop: editor.scrollTop || 0,
                scrollLeft: editor.scrollLeft || 0
            });

            const isSameSnapshot = (a, b) => {
                if (!a || !b) return false;
                return a.html === b.html;
            };

            const persisted = CanvasState.mdUndoStates.get(idKey) || null;
            const state = {
                stack: Array.isArray(persisted && persisted.stack) ? persisted.stack : [],
                index: Number.isFinite(persisted && persisted.index) ? persisted.index : -1
            };

            let recordRaf = 0;
            const MAX_STACK = 300;

            const syncExpandedStateFromSelection = (wasExpanded = false) => {
                // Similar logic to renderMdNode for re-identifying expanded token
                if (!wasExpanded) return;
                const sel = window.getSelection();
                if (!sel || !sel.rangeCount) return;
                const range = sel.getRangeAt(0);
                if (!range || !editor.contains(range.startContainer)) return;
                const container = range.startContainer;
                if (!container || container.nodeType !== Node.TEXT_NODE || !container.parentNode) return;
                expandedElement = null;
                expandedMarkdown = null;
                expandedType = null;
            };

            undoManager = {
                isRestoring: false,
                cancelPendingRecord: () => {
                    if (recordRaf) { cancelAnimationFrame(recordRaf); recordRaf = 0; }
                },
                scheduleRecord: (reason = 'unknown') => {
                    if (undoManager.isRestoring) return;
                    if (recordRaf) cancelAnimationFrame(recordRaf);
                    recordRaf = requestAnimationFrame(() => { recordRaf = 0; undoManager.recordNow(reason); });
                },
                recordNow: (reason = 'unknown') => {
                    if (undoManager.isRestoring) return;
                    const snap = snapshot();
                    if (state.index < 0) {
                        state.stack = [snap];
                        state.index = 0;
                        CanvasState.mdUndoStates.set(idKey, { stack: state.stack, index: state.index });
                        return;
                    }
                    if (state.index < state.stack.length - 1) {
                        state.stack = state.stack.slice(0, state.index + 1);
                    }
                    const cur = state.stack[state.index];
                    if (isSameSnapshot(cur, snap)) {
                        state.stack[state.index] = snap;
                        CanvasState.mdUndoStates.set(idKey, { stack: state.stack, index: state.index });
                        return;
                    }
                    state.stack.push(snap);
                    state.index = state.stack.length - 1;
                    if (state.stack.length > MAX_STACK) {
                        const overflow = state.stack.length - MAX_STACK;
                        state.stack.splice(0, overflow);
                        state.index = Math.max(0, state.index - overflow);
                    }
                    CanvasState.mdUndoStates.set(idKey, { stack: state.stack, index: state.index });
                },
                reset: () => {
                    undoManager.cancelPendingRecord();
                    state.stack = [];
                    state.index = -1;
                    if (CanvasState.mdUndoStates) CanvasState.mdUndoStates.delete(idKey);
                },
                undo: () => {

                    if (state.index <= 0) return;
                    undoManager.cancelPendingRecord();
                    undoManager.isRestoring = true;
                    try {
                        state.index -= 1;
                        const snap = state.stack[state.index];
                        if (snap) {
                            editor.innerHTML = snap.html;
                            expandedElement = null;
                            expandedMarkdown = null;
                            expandedType = null;
                            editor.scrollTop = snap.scrollTop || 0;
                            editor.scrollLeft = snap.scrollLeft || 0;
                            restoreSelection(snap.selection);
                            saveEditorContent(); // Keep data in sync
                        }
                    } finally {
                        undoManager.isRestoring = false;
                    }
                },
                redo: () => {
                    if (state.index >= state.stack.length - 1) return;
                    undoManager.cancelPendingRecord();
                    undoManager.isRestoring = true;
                    try {
                        state.index += 1;
                        const snap = state.stack[state.index];
                        if (snap) {
                            editor.innerHTML = snap.html;
                            expandedElement = null;
                            expandedMarkdown = null;
                            expandedType = null;
                            editor.scrollTop = snap.scrollTop || 0;
                            editor.scrollLeft = snap.scrollLeft || 0;
                            restoreSelection(snap.selection);
                            saveEditorContent();
                        }
                    } finally {
                        undoManager.isRestoring = false;
                    }
                }
            };
        } catch (e) { console.error('UndoManager init error', e); }
    })();

    // —— Expand/Collapse Logic ——
    let expandedElement = null;
    let expandedMarkdown = null;
    let expandedType = null;
    const formatMap = {
        'STRONG': { prefix: '**', suffix: '**' },
        'B': { prefix: '**', suffix: '**' },
        'EM': { prefix: '*', suffix: '*' },
        'I': { prefix: '*', suffix: '*' },
        'U': { prefix: '<u>', suffix: '</u>' },
        'DEL': { prefix: '~~', suffix: '~~' },
        'S': { prefix: '~~', suffix: '~~' },
        'MARK': { prefix: '==', suffix: '==' },
        'CODE': { prefix: '`', suffix: '`' },
    };

    const isCaretInsideExpandedSource = () => {
        if (!expandedElement || !expandedElement.parentNode) return false;
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return false;
        const range = sel.getRangeAt(0);
        if (!range) return false;
        // 检查光标是否在展开的元素内（包括直接在文本节点内，或在其子节点内）
        return range.startContainer === expandedElement ||
            (expandedElement.nodeType === Node.TEXT_NODE && range.startContainer === expandedElement) ||
            (expandedElement.contains && expandedElement.contains(range.startContainer));
    };

    const checkAndExpandIfCaretEntered = () => {
        // If currently expanded, let the 'leave' logic handle it
        if (expandedElement && expandedElement.parentNode) return;

        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return;

        let node = sel.anchorNode;
        if (!node) return;

        // Ensure we are inside this editor
        if (!editor.contains(node)) return;

        // Find closest formatted element
        if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;

        // Only auto-expand inline-like formats here; block elements are handled by click rules.
        const formatted = node.closest('strong, b, em, i, u, del, s, mark, code, font, center, p[align], h1, h2, h3, h4, h5, h6, hr');
        if (formatted && editor.contains(formatted)) {
            // Expand it!
            expandToMarkdown(formatted);
        }
    };

    const scheduleReRenderIfCaretLeftExpanded = (() => {
        let rafId = 0;
        return () => {
            if (!expandedElement || !expandedElement.parentNode) return;
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                rafId = 0;
                if (expandedElement && expandedElement.parentNode && !isCaretInsideExpandedSource()) {
                    reRenderExpanded();
                }
            });
        };
    })();

    const reRenderExpanded = () => {
        const el = expandedElement;
        if (!el || !el.parentNode) {
            expandedElement = null; expandedMarkdown = null; expandedType = null;
            return;
        }

        // 辅助函数：将内联 Markdown 语法转换为 HTML
        const parseInlineMarkdown = (text) => {
            if (!text) return text;
            return text
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.+?)\*/g, '<em>$1</em>')
                .replace(/~~(.+?)~~/g, '<del>$1</del>')
                .replace(/==(.+?)==/g, '<mark>$1</mark>')
                .replace(/`([^`]+)`/g, '<code>$1</code>');
        };

        const rawText = el.textContent || '';
        const text = rawText.replace(/\u200B/g, '').trim(); // 用于模式匹配的清理后文本
        const parent = el.parentNode;
        const savedType = expandedType;

        expandedElement = null;
        expandedMarkdown = null;
        expandedType = null;

        // 只有当原始文本完全为空或只有零宽空格时才删除元素
        if (!rawText.replace(/\u200B/g, '').trim()) {
            try { el.remove(); } catch (_) { }
            return;
        }

        // 列表项：LI 级别的源码 → 还原回 <li>
        if (savedType === 'li-ul' || savedType === 'li-ol') {
            const parentTag = parent && parent.nodeType === Node.ELEMENT_NODE ? parent.tagName : null;
            const expectedParent = savedType === 'li-ul' ? 'UL' : 'OL';
            if (parent && parentTag === expectedParent) {
                const raw = text;
                let itemText = raw;
                if (savedType === 'li-ul') {
                    const m = raw.match(/^[-*+]\s+(.*)$/);
                    itemText = m ? m[1] : raw;
                } else {
                    const m = raw.match(/^\d+\.\s+(.*)$/);
                    itemText = m ? m[1] : raw;
                }
                const li = document.createElement('li');
                // 先解析 Markdown 再检查 HTML 标签
                const parsed = parseInlineMarkdown(itemText);
                if (/<[^>]+>/.test(parsed)) {
                    li.innerHTML = parsed;
                } else {
                    li.textContent = itemText;
                }
                parent.replaceChild(li, el);
                saveEditorContent();
                return;
            }
        }

        let newNode = null;

        // 内联格式模式
        const inlinePatterns = [
            { regex: /^\*\*(.+?)\*\*$/, tag: 'strong', contentIndex: 1 },
            { regex: /^\*(.+?)\*$/, tag: 'em', contentIndex: 1 },
            { regex: /^~~(.+?)~~$/, tag: 'del', contentIndex: 1 },
            { regex: /^==(.+?)==$/, tag: 'mark', contentIndex: 1 },
            { regex: /^`([^`]+)`$/, tag: 'code', contentIndex: 1 },
            { regex: /^<u>([^<]*)<\/u>$/i, tag: 'u', contentIndex: 1 },
            // font color: 支持带引号和不带引号的格式
            { regex: /^<font\s+color="([^"]+)">([^<]*)<\/font>$/i, tag: 'font', attrName: 'color', attrIndex: 1, contentIndex: 2 },
            { regex: /^<font\s+color='([^']+)'>([^<]*)<\/font>$/i, tag: 'font', attrName: 'color', attrIndex: 1, contentIndex: 2 },
            { regex: /^<font\s+color=([^>\s]+)>([^<]*)<\/font>$/i, tag: 'font', attrName: 'color', attrIndex: 1, contentIndex: 2 },
            { regex: /^<center>([^<]*)<\/center>$/i, tag: 'center', contentIndex: 1 },
            // p align: 支持带引号和不带引号的格式
            { regex: /^<p\s+align="([^"]+)">([^<]*)<\/p>$/i, tag: 'p', attrName: 'align', attrIndex: 1, contentIndex: 2 },
            { regex: /^<p\s+align='([^']+)'>([^<]*)<\/p>$/i, tag: 'p', attrName: 'align', attrIndex: 1, contentIndex: 2 },
            { regex: /^<p\s+align=([^>\s]+)>([^<]*)<\/p>$/i, tag: 'p', attrName: 'align', attrIndex: 1, contentIndex: 2 }
        ];

        // 块级格式模式（ATX 标题、引用、列表、水平分割线等）
        const blockPatterns = [
            { regex: /^######\s(.+)$/, type: 'h6', contentIndex: 1 },
            { regex: /^#####\s(.+)$/, type: 'h5', contentIndex: 1 },
            { regex: /^####\s(.+)$/, type: 'h4', contentIndex: 1 },
            { regex: /^###\s(.+)$/, type: 'h3', contentIndex: 1 },
            { regex: /^##\s(.+)$/, type: 'h2', contentIndex: 1 },
            { regex: /^#\s(.+)$/, type: 'h1', contentIndex: 1 },
            { regex: /^>\s*(.*)$/, type: 'blockquote', contentIndex: 1 },
            { regex: /^-\s+\[\s*\]\s*(.*)$/, type: 'task-unchecked', contentIndex: 1 },
            { regex: /^-\s+\[x\]\s*(.*)$/i, type: 'task-checked', contentIndex: 1 },
            { regex: /^-\s+(.+)$/, type: 'ul', contentIndex: 1 },
            { regex: /^(\d+)\.\s+(.+)$/, type: 'ol', contentIndex: 2 },
            // { regex: /^[\u200B]*-{3,}\s*$/, type: 'hr' }
        ];

        // 辅助函数：安全地设置元素内容（解析 Markdown 后用 innerHTML）
        const setElementContent = (element, content) => {
            const parsed = parseInlineMarkdown(content);
            if (/<[^>]+>/.test(parsed)) {
                element.innerHTML = parsed;
            } else {
                element.textContent = content;
            }
        };

        // 先检查内联格式
        for (const p of inlinePatterns) {
            const m = text.match(p.regex);
            if (m) {
                const newEl = document.createElement(p.tag);
                if (p.attrName) newEl.setAttribute(p.attrName, m[p.attrIndex]);
                // 使用 setElementContent 以保留可能的内部 HTML
                setElementContent(newEl, m[p.contentIndex]);
                newNode = newEl;
                break;
            }
        }

        // 如果没有匹配内联格式，检查块级格式
        if (!newNode) {

            for (const pattern of blockPatterns) {
                const match = text.match(pattern.regex);
                if (match) {
                    if (pattern.type === 'hr') {
                        newNode = document.createElement('hr');
                    } else if (pattern.type === 'h1' || pattern.type === 'h2' || pattern.type === 'h3' ||
                        pattern.type === 'h4' || pattern.type === 'h5' || pattern.type === 'h6') {
                        newNode = document.createElement(pattern.type);
                        setElementContent(newNode, match[pattern.contentIndex] || '');
                    } else if (pattern.type === 'blockquote') {
                        newNode = document.createElement('blockquote');
                        setElementContent(newNode, match[pattern.contentIndex] || '');
                    } else if (pattern.type === 'ul') {
                        const ul = document.createElement('ul');
                        const li = document.createElement('li');
                        setElementContent(li, match[pattern.contentIndex] || '');
                        ul.appendChild(li);
                        newNode = ul;
                    } else if (pattern.type === 'ol') {
                        const ol = document.createElement('ol');
                        const li = document.createElement('li');
                        setElementContent(li, match[pattern.contentIndex] || '');
                        ol.appendChild(li);
                        newNode = ol;
                    } else if (pattern.type === 'task-unchecked' || pattern.type === 'task-checked') {
                        const div = document.createElement('div');
                        div.className = 'md-task-item';
                        const checkbox = document.createElement('input');
                        checkbox.type = 'checkbox';
                        checkbox.className = 'md-task-checkbox';
                        if (pattern.type === 'task-checked') checkbox.checked = true;
                        div.appendChild(checkbox);
                        // 任务列表项内容可能包含 HTML
                        const contentSpan = document.createElement('span');
                        setElementContent(contentSpan, ' ' + (match[pattern.contentIndex] || ''));
                        div.appendChild(contentSpan);
                        newNode = div;
                    }
                    break;
                }
            }
        }

        if (newNode) {
            parent.replaceChild(newNode, el);
            saveEditorContent();
        } else {
            // 如果没有匹配任何模式，创建一个普通的文本节点或 span 保留内容
            // 不删除，保留原样
            saveEditorContent();
        }
    };

    // Since we don't have the full `expandToMarkdown` implementation here (it's 200 lines), 
    // we will implement a simplified version for common formats logic used in Blank Column.

    // 获取特殊格式元素的源码表示（与空白栏目 getSourceCode 功能一致）
    const getSourceCode = (el) => {
        const tagName = el.tagName;
        const content = el.textContent;
        const htmlContent = el.innerHTML; // 用于需要保留内部 HTML 的元素

        // font color: <font color="#xxx">text</font>（保留内部 HTML）
        if (tagName === 'FONT') {
            const color = el.getAttribute('color') || '#000000';
            return {
                source: `<font color="${color}">${htmlContent}</font>`,
                prefix: `<font color="${color}">`,
                suffix: '</font>',
                type: 'fontcolor'
            };
        }

        // center: <center>text</center>
        if (tagName === 'CENTER') {
            return {
                source: `<center>${htmlContent}</center>`,
                prefix: '<center>',
                suffix: '</center>',
                type: 'align'
            };
        }

        // p with align: <p align="xxx">text</p>
        if (tagName === 'P' && el.hasAttribute('align')) {
            const align = el.getAttribute('align');
            return {
                source: `<p align="${align}">${htmlContent}</p>`,
                prefix: `<p align="${align}">`,
                suffix: '</p>',
                type: 'align'
            };
        }

        // hr: --- 水平分割线
        if (tagName === 'HR') {
            return {
                source: '---',
                prefix: '',
                suffix: '',
                type: 'hr'
            };
        }

        // blockquote: > text （保留内部 HTML）
        if (tagName === 'BLOCKQUOTE') {
            return {
                source: `> ${htmlContent}`,
                prefix: '> ',
                suffix: '',
                type: 'quote'
            };
        }

        // li: - item / 1. item （保留内部 HTML）
        if (tagName === 'LI') {
            const parent = el.parentElement;
            const itemHtml = (el.innerHTML || '').trim();
            if (parent && parent.tagName === 'UL') {
                return {
                    source: `- ${itemHtml}`,
                    prefix: '- ',
                    suffix: '',
                    type: 'li-ul'
                };
            }
            if (parent && parent.tagName === 'OL') {
                const siblings = Array.from(parent.children).filter(child => child && child.tagName === 'LI');
                const idx = siblings.indexOf(el) + 1;
                const n = idx > 0 ? idx : 1;
                return {
                    source: `${n}. ${itemHtml}`,
                    prefix: `${n}. `,
                    suffix: '',
                    type: 'li-ol'
                };
            }
        }

        // ul: - item （保留内部 HTML）
        if (tagName === 'UL') {
            const items = Array.from(el.querySelectorAll('li')).map(li => `- ${li.innerHTML}`).join('\n');
            return {
                source: items,
                prefix: '- ',
                suffix: '',
                type: 'ul'
            };
        }

        // ol: 1. item （保留内部 HTML）
        if (tagName === 'OL') {
            const items = Array.from(el.querySelectorAll('li')).map((li, i) => `${i + 1}. ${li.innerHTML}`).join('\n');
            return {
                source: items,
                prefix: '1. ',
                suffix: '',
                type: 'ol'
            };
        }

        // task: - [ ] text 或 - [x] text （保留内部 HTML）
        if (el.classList && el.classList.contains('md-task-item')) {
            const checkbox = el.querySelector('input[type="checkbox"]');
            const checked = checkbox && checkbox.checked;
            // 获取除 checkbox 以外的内容
            const clone = el.cloneNode(true);
            const cb = clone.querySelector('input[type="checkbox"]');
            if (cb) cb.remove();
            const taskHtml = clone.innerHTML.trim();
            return {
                source: checked ? `- [x] ${taskHtml}` : `- [ ] ${taskHtml}`,
                prefix: checked ? '- [x] ' : '- [ ] ',
                suffix: '',
                type: 'task'
            };
        }

        // 标题: H1-H6 （保留内部 HTML）
        if (tagName === 'H1') {
            return { source: `# ${htmlContent}`, prefix: '# ', suffix: '', type: 'heading' };
        }
        if (tagName === 'H2') {
            return { source: `## ${htmlContent}`, prefix: '## ', suffix: '', type: 'heading' };
        }
        if (tagName === 'H3') {
            return { source: `### ${htmlContent}`, prefix: '### ', suffix: '', type: 'heading' };
        }
        if (tagName === 'H4') {
            return { source: `#### ${htmlContent}`, prefix: '#### ', suffix: '', type: 'heading' };
        }
        if (tagName === 'H5') {
            return { source: `##### ${htmlContent}`, prefix: '##### ', suffix: '', type: 'heading' };
        }
        if (tagName === 'H6') {
            return { source: `###### ${htmlContent}`, prefix: '###### ', suffix: '', type: 'heading' };
        }


        return null;
    };

    const expandToMarkdown = (formattedEl) => {
        const tagName = formattedEl.tagName;

        // 先尝试处理特殊格式（headings, lists, quotes, hr 等）
        const specialFormat = getSourceCode(formattedEl);
        if (specialFormat) {
            const parent = formattedEl.parentNode;
            const textNode = document.createTextNode(specialFormat.source);
            parent.replaceChild(textNode, formattedEl);

            expandedElement = textNode;
            expandedMarkdown = specialFormat.source;
            expandedType = specialFormat.type;

            // Place cursor
            const sel = window.getSelection();
            const range = document.createRange();
            const contentLen = formattedEl.textContent ? formattedEl.textContent.length : 0;
            let cursorPos = specialFormat.prefix.length + Math.floor(contentLen / 2);
            cursorPos = Math.max(0, Math.min(cursorPos, specialFormat.source.length));
            range.setStart(textNode, Math.min(cursorPos, textNode.length));
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            return true;
        }

        // 处理简单格式（粗体、斜体等，在 formatMap 中定义）
        const format = formatMap[tagName];
        if (format) {
            // 使用 innerHTML 保留内部 HTML 格式
            const innerHtml = formattedEl.innerHTML;
            const markdown = format.prefix + innerHtml + format.suffix;
            const textNode = document.createTextNode(markdown);
            formattedEl.parentNode.replaceChild(textNode, formattedEl);
            expandedElement = textNode;
            expandedMarkdown = markdown;
            expandedType = 'simple';

            // Place cursor
            const sel = window.getSelection();
            const range = document.createRange();
            const plainTextLen = formattedEl.textContent ? formattedEl.textContent.length : 0;
            range.setStart(textNode, format.prefix.length + Math.floor(plainTextLen / 2));
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            return true;
        }

        return false;
    };

    // Attach Listeners
    editor.addEventListener('keydown', (e) => {
        if (e.metaKey || e.ctrlKey) {
            if (e.key === 'z' || e.key === 'Z') {
                e.preventDefault();
                e.shiftKey ? (undoManager && undoManager.redo()) : (undoManager && undoManager.undo());
            } else if (e.key === 'y') {
                e.preventDefault();
                undoManager && undoManager.redo();
            }
        }
    });

    // Expand on click
    editor.addEventListener('click', (e) => {
        if (!e.target) return;
        if (__handleHeadingCollapseClick(editor, e)) {
            saveEditorContent();
            return;
        }
        if (typeof isEditing === 'function' && !isEditing()) return;

        let target = e.target;

        // If clicked inside editor but not on text directly
        if (target !== editor && editor.contains(target)) {
            // Find closest formatted element (including block-level elements)
            const formatted = target.closest('strong, b, em, i, u, del, s, mark, code, font, center, blockquote, h1, h2, h3, h4, h5, h6, hr, li, .md-task-item, p[align]');

            if (formatted && editor.contains(formatted)) {
                const isBlockRestricted = formatted.tagName === 'LI' || formatted.tagName === 'BLOCKQUOTE';
                if (isBlockRestricted) {
                    if (target !== formatted) return;
                    const rect = formatted.getBoundingClientRect();
                    const clickX = e.clientX - rect.left;
                    const style = window.getComputedStyle(formatted);
                    const paddingLeft = parseFloat(style.paddingLeft);
                    const threshold = paddingLeft > 10 ? paddingLeft : 25;
                    if (clickX > threshold) return;
                }
                // 如果已经有展开的元素，先重渲染
                if (expandedElement && expandedElement.parentNode) {
                    reRenderExpanded();
                }
                // 展开新元素
                if (expandToMarkdown(formatted)) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            }
        }
    });

    // Collapse on leave / Expand on enter
    // 监听选区变化，当光标离开展开的源码时重渲染
    document.addEventListener('selectionchange', () => {
        // 首先，始终检查是否需要重渲染（即使选区不在编辑器内）
        scheduleReRenderIfCaretLeftExpanded();

        // 然后，只有选区在编辑器内时才检查是否需要展开
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        if (!editor.contains(range.startContainer)) return;

        // 自动展开检查
        checkAndExpandIfCaretEntered();
    });

    editor.addEventListener('blur', () => {
        if (expandedElement) reRenderExpanded();
    });

    // 鼠标抬起时也检查是否需要重渲染
    editor.addEventListener('mouseup', () => {
        scheduleReRenderIfCaretLeftExpanded();
    });

    // 当前选中的字体颜色
    let currentFontColor = '#2DC26B';

    // 创建格式工具栏弹层（单行布局）
    const createFormatPopover = () => {
        let pop = toolbar.querySelector('.md-format-popover');
        if (pop) return pop;

        pop = document.createElement('div');
        pop.className = 'md-format-popover';
        preventCanvasEventsPropagation(pop);

        const lang = getLang();
        const boldTitle = lang === 'en' ? 'Bold' : '加粗';
        const italicTitle = lang === 'en' ? 'Italic' : '斜体';
        const underlineTitle = lang === 'en' ? 'Underline' : '下划线';
        const highlightTitle = lang === 'en' ? 'Highlight' : '高亮';
        const fontColorTitle = lang === 'en' ? 'Font Color' : '字体颜色';
        const strikeTitle = lang === 'en' ? 'Strikethrough' : '删除线';
        const codeTitle = lang === 'en' ? 'Code' : '代码';
        const linkTitle = lang === 'en' ? 'Link' : '链接';
        const headingTitle = lang === 'en' ? 'Heading' : '标题';
        const alignTitle = lang === 'en' ? 'Alignment' : '对齐';
        const listTitle = lang === 'en' ? 'List' : '列表';
        const quoteTitle = lang === 'en' ? 'Quote' : '引用';

        pop.innerHTML = `
            <div class="md-format-row">
                <button class="md-format-btn md-format-heading-btn" data-action="md-heading-toggle" title="${headingTitle}"><i class="fas fa-heading"></i></button>
                <button class="md-format-btn md-format-align-btn" data-action="md-align-toggle" title="${alignTitle}"><i class="fas fa-align-left"></i></button>
                <span class="md-format-sep"></span>
                <button class="md-format-btn" data-action="md-insert-bold" title="${boldTitle}"><b>B</b></button>
                <button class="md-format-btn" data-action="md-insert-italic" title="${italicTitle}"><i>I</i></button>
                <button class="md-format-btn" data-action="md-insert-underline" title="${underlineTitle}"><u>U</u></button>
                <button class="md-format-btn" data-action="md-insert-highlight" title="${highlightTitle}"><span style="background:#fcd34d;color:#000;padding:0 3px;border-radius:2px;">H</span></button>
                <button class="md-format-btn md-format-fontcolor-btn" data-action="md-fontcolor-toggle" title="${fontColorTitle}"><span style="border-bottom:2px solid ${currentFontColor};padding:0 2px;">A</span></button>
                <button class="md-format-btn" data-action="md-insert-strike" title="${strikeTitle}"><s>S</s></button>
                <button class="md-format-btn" data-action="md-insert-code" title="${codeTitle}"><code>&lt;/&gt;</code></button>
                <button class="md-format-btn" data-action="md-insert-link" title="${linkTitle}"><i class="fas fa-link"></i></button>
                <span class="md-format-sep"></span>
                <button class="md-format-btn md-format-list-btn" data-action="md-list-toggle" title="${listTitle}"><i class="fas fa-list"></i></button>
                <button class="md-format-btn" data-action="md-insert-quote" title="${quoteTitle}"><i class="fas fa-quote-left"></i></button>
                <button class="md-format-btn md-format-close-btn" data-action="md-format-close" title="${(typeof currentLang !== 'undefined' && currentLang === 'en') ? 'Close toolbar' : '关闭工具窗'}"><i class="fas fa-times"></i></button>
            </div>
        `;

        toolbar.appendChild(pop);
        preventCanvasEventsPropagation(pop);
        return pop;
    };

    const closeFormatPopover = () => {
        const pop = toolbar.querySelector('.md-format-popover');
        if (pop) {
            pop.classList.remove('open');
            updateCanvasPopoverState(false);
        }
        if (formatToggleBtn) formatToggleBtn.classList.remove('active');
    };

    const positionPopoverAboveBtn = (pop, btn) => {
        const formatPop = toolbar.querySelector('.md-format-popover');
        if (!formatPop) return;
        const btnRect = btn.getBoundingClientRect();
        const formatRect = formatPop.getBoundingClientRect();
        const btnCenterX = btnRect.left + btnRect.width / 2 - formatRect.left;
        pop.style.left = btnCenterX + 'px';
        pop.style.transform = 'translateX(-50%) translateY(-100%)';
    };

    const createFontColorPopover = () => {
        let pop = toolbar.querySelector('.md-fontcolor-popover');
        if (pop) return pop;

        pop = document.createElement('div');
        pop.className = 'md-fontcolor-popover';
        preventCanvasEventsPropagation(pop);

        const presetColors = [
            '#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050',
            '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0',
            '#ffffff', '#000000', '#1f497d', '#4f81bd', '#8064a2'
        ];

        const colorChips = presetColors.map(c =>
            `<span class="md-fontcolor-chip" data-action="md-fontcolor-apply" data-color="${c}" style="background:${c};" title="${c}"></span>`
        ).join('');

        const lang = getLang();
        pop.innerHTML = `
            <div class="md-fontcolor-grid">${colorChips}</div>
            <div class="md-fontcolor-custom">
                <input type="color" class="md-fontcolor-input" value="${currentFontColor}" title="${lang === 'en' ? 'Custom color' : '自定义颜色'}">
            </div>
        `;

        const customInput = pop.querySelector('.md-fontcolor-input');
        if (customInput) {
            customInput.addEventListener('change', (e) => {
                const color = e.target.value;
                currentFontColor = color;
                insertFontColor(color);
                closeFontColorPopover();
            });
        }

        const formatPop = toolbar.querySelector('.md-format-popover');
        if (formatPop) formatPop.appendChild(pop);
        preventCanvasEventsPropagation(pop);
        return pop;
    };

    const closeFontColorPopover = () => {
        const pop = toolbar.querySelector('.md-fontcolor-popover');
        if (pop) pop.classList.remove('open');
        const btn = toolbar.querySelector('[data-action="md-fontcolor-toggle"]');
        if (btn) btn.classList.remove('active');
    };

    const createAlignPopover = () => {
        let pop = toolbar.querySelector('.md-align-popover');
        if (pop) return pop;

        pop = document.createElement('div');
        pop.className = 'md-align-popover';
        preventCanvasEventsPropagation(pop);

        const lang = getLang();
        const leftTitle = lang === 'en' ? 'Align Left' : '左对齐';
        const centerTitle = lang === 'en' ? 'Center' : '居中';
        const rightTitle = lang === 'en' ? 'Align Right' : '右对齐';
        const justifyTitle = lang === 'en' ? 'Justify' : '两端对齐';

        pop.innerHTML = `
            <button class="md-align-option" data-action="md-align-apply" data-align="left" title="${leftTitle}"><i class="fas fa-align-left"></i></button>
            <button class="md-align-option" data-action="md-align-apply" data-align="center" title="${centerTitle}"><i class="fas fa-align-center"></i></button>
            <button class="md-align-option" data-action="md-align-apply" data-align="right" title="${rightTitle}"><i class="fas fa-align-right"></i></button>
            <button class="md-align-option" data-action="md-align-apply" data-align="justify" title="${justifyTitle}"><i class="fas fa-align-justify"></i></button>
        `;

        const formatPop = toolbar.querySelector('.md-format-popover');
        if (formatPop) formatPop.appendChild(pop);
        return pop;
    };

    const closeAlignPopover = () => {
        const pop = toolbar.querySelector('.md-align-popover');
        if (pop) {
            pop.classList.remove('open');
            updateCanvasPopoverState(false);
        }
        const btn = toolbar.querySelector('[data-action="md-align-toggle"]');
        if (btn) btn.classList.remove('active');
    };

    const createHeadingPopover = () => {
        let pop = toolbar.querySelector('.md-heading-popover');
        if (pop) return pop;

        pop = document.createElement('div');
        pop.className = 'md-heading-popover';
        preventCanvasEventsPropagation(pop);

        const lang = getLang();
        const h1Title = lang === 'en' ? 'Heading 1' : '一级标题';
        const h2Title = lang === 'en' ? 'Heading 2' : '二级标题';
        const h3Title = lang === 'en' ? 'Heading 3' : '三级标题';

        pop.innerHTML = `
            <button class="md-heading-option" data-action="md-heading-apply" data-level="h1" title="${h1Title}">H1</button>
            <button class="md-heading-option" data-action="md-heading-apply" data-level="h2" title="${h2Title}">H2</button>
            <button class="md-heading-option" data-action="md-heading-apply" data-level="h3" title="${h3Title}">H3</button>
        `;

        const formatPop = toolbar.querySelector('.md-format-popover');
        if (formatPop) formatPop.appendChild(pop);
        return pop;
    };

    const closeHeadingPopover = () => {
        const pop = toolbar.querySelector('.md-heading-popover');
        if (pop) {
            pop.classList.remove('open');
            updateCanvasPopoverState(false);
        }
        const btn = toolbar.querySelector('[data-action="md-heading-toggle"]');
        if (btn) btn.classList.remove('active');
    };

    const createListPopover = () => {
        let pop = toolbar.querySelector('.md-list-popover');
        if (pop) return pop;

        pop = document.createElement('div');
        pop.className = 'md-list-popover';
        preventCanvasEventsPropagation(pop);

        const lang = getLang();
        const ulTitle = lang === 'en' ? 'Bullet List' : '无序列表';
        const olTitle = lang === 'en' ? 'Numbered List' : '有序列表';
        const taskTitle = lang === 'en' ? 'Task List' : '任务列表';

        pop.innerHTML = `
            <button class="md-list-option" data-action="md-list-apply" data-type="ul" title="${ulTitle}"><i class="fas fa-list-ul"></i></button>
            <button class="md-list-option" data-action="md-list-apply" data-type="ol" title="${olTitle}"><i class="fas fa-list-ol"></i></button>
            <button class="md-list-option" data-action="md-list-apply" data-type="task" title="${taskTitle}"><i class="fas fa-tasks"></i></button>
        `;

        const formatPop = toolbar.querySelector('.md-format-popover');
        if (formatPop) formatPop.appendChild(pop);
        return pop;
    };

    const closeListPopover = () => {
        const pop = toolbar.querySelector('.md-list-popover');
        if (pop) {
            pop.classList.remove('open');
            updateCanvasPopoverState(false);
        }
        const btn = toolbar.querySelector('[data-action="md-list-toggle"]');
        if (btn) btn.classList.remove('active');
    };

    const closeAllPopovers = () => {
        closeFontColorPopover();
        closeAlignPopover();
        closeHeadingPopover();
        closeListPopover();
        closeFormatPopover();
    };

    const toggleFontColorPopover = (btn) => {
        saveSelection();
        const pop = createFontColorPopover();
        const isOpen = pop.classList.contains('open');

        closeAlignPopover();
        closeHeadingPopover();
        closeListPopover();

        if (isOpen) {
            pop.classList.remove('open');
            btn.classList.remove('active');
            updateCanvasPopoverState(false);
        } else {
            positionPopoverAboveBtn(pop, btn);
            pop.classList.add('open');
            btn.classList.add('active');
            updateCanvasPopoverState(true);
        }
    };

    const toggleAlignPopover = (btn) => {
        saveSelection();
        const pop = createAlignPopover();
        const isOpen = pop.classList.contains('open');

        closeFontColorPopover();
        closeHeadingPopover();
        closeListPopover();

        if (isOpen) {
            pop.classList.remove('open');
            btn.classList.remove('active');
            updateCanvasPopoverState(false);
        } else {
            positionPopoverAboveBtn(pop, btn);
            pop.classList.add('open');
            btn.classList.add('active');
            updateCanvasPopoverState(true);
        }
    };

    const toggleHeadingPopover = (btn) => {
        saveSelection();
        const pop = createHeadingPopover();
        const isOpen = pop.classList.contains('open');

        closeFontColorPopover();
        closeAlignPopover();
        closeListPopover();

        if (isOpen) {
            pop.classList.remove('open');
            btn.classList.remove('active');
            updateCanvasPopoverState(false);
        } else {
            positionPopoverAboveBtn(pop, btn);
            pop.classList.add('open');
            btn.classList.add('active');
            updateCanvasPopoverState(true);
        }
    };

    const toggleListPopover = (btn) => {
        saveSelection();
        const pop = createListPopover();
        const isOpen = pop.classList.contains('open');

        closeFontColorPopover();
        closeAlignPopover();
        closeHeadingPopover();

        if (isOpen) {
            pop.classList.remove('open');
            btn.classList.remove('active');
            updateCanvasPopoverState(false);
        } else {
            positionPopoverAboveBtn(pop, btn);
            pop.classList.add('open');
            btn.classList.add('active');
            updateCanvasPopoverState(true);
        }
    };

    const toggleFormatPopover = () => {
        const pop = createFormatPopover();
        const isOpen = pop.classList.contains('open');
        closeAllPopovers();
        if (!isOpen) {
            pop.classList.add('open');
            formatToggleBtn.classList.add('active');
            updateCanvasPopoverState(true);

            // -----------------------------------------------------------
            // 定位优化：出现在当前输入框（editor）的上边缘居中位置
            // -----------------------------------------------------------
            try {
                // 确保 toolbar 设置了定位上下文
                const computedStyle = window.getComputedStyle(toolbar);
                if (computedStyle.position === 'static') {
                    toolbar.style.position = 'relative';
                }

                const editorRect = editor.getBoundingClientRect();
                const toolbarRect = toolbar.getBoundingClientRect();

                // 目标位置：Editor 右上角 (实现右对齐)
                // 绝对坐标 (Viewport based)
                const targetX = editorRect.right;
                const targetY = editorRect.top;

                // 计算相对于 toolbar 的坐标 (pop 是 toolbar 的子元素，绝对定位)
                const relX = targetX - toolbarRect.left;
                const relY = targetY - toolbarRect.top;

                pop.style.left = relX + 'px';
                pop.style.top = relY + 'px';

                // 向上偏移 (translateY -100% - 6px) 并 向左偏移 (translateX -100%) 以实现右对齐且微调垂直间距
                pop.style.transform = 'translate(-100%, calc(-100% - 6px))';
            } catch (e) {
                console.warn('Format popover positioning failed:', e);
                // Fallback
                pop.style.left = '';
                pop.style.top = '';
                pop.style.transform = '';
            }
        }
    };

    const insertFontColor = (color) => {
        if (typeof isEditing === 'function' && !isEditing()) {
            if (typeof enterEdit === 'function') enterEdit();
            setTimeout(() => doInsertFontColor(color), 50);
        } else {
            doInsertFontColor(color);
        }
    };

    const doInsertFontColor = (color) => {
        const sel = window.getSelection();
        let range;

        if (savedSelection && savedSelection.range) {
            range = savedSelection.range;
            sel.removeAllRanges();
            sel.addRange(range);
        } else if (sel.rangeCount) {
            range = sel.getRangeAt(0);
        } else {
            editor.focus();
            return;
        }

        if (!editor.contains(range.commonAncestorContainer)) {
            editor.focus();
            return;
        }

        const lang = getLang();
        const selected = range.toString();
        const insertText = selected || (lang === 'en' ? 'text' : '文本');
        savedSelection = null;

        const wrapper = document.createElement('font');
        wrapper.setAttribute('color', color);
        wrapper.textContent = insertText;

        range.deleteContents();
        range.insertNode(wrapper);

        const spacer = document.createTextNode('\u200B');
        wrapper.parentNode.insertBefore(spacer, wrapper.nextSibling);

        range.setStart(spacer, 1);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);

        currentFontColor = color;
        const fontColorBtn = toolbar.querySelector('[data-action="md-fontcolor-toggle"] span');
        if (fontColorBtn) {
            fontColorBtn.style.borderBottomColor = color;
        }

        saveEditorContent();
        editor.focus();
    };

    const insertAlign = (alignType) => {
        if (typeof isEditing === 'function' && !isEditing()) {
            if (typeof enterEdit === 'function') enterEdit();
            setTimeout(() => doInsertAlign(alignType), 50);
        } else {
            doInsertAlign(alignType);
        }
    };

    const doInsertAlign = (alignType) => {
        const sel = window.getSelection();
        let range;

        if (savedSelection && savedSelection.range) {
            range = savedSelection.range;
            sel.removeAllRanges();
            sel.addRange(range);
        } else if (sel.rangeCount) {
            range = sel.getRangeAt(0);
        } else {
            editor.focus();
            return;
        }

        if (!editor.contains(range.commonAncestorContainer)) {
            editor.focus();
            return;
        }

        const lang = getLang();
        const selected = range.toString();
        const insertText = selected || (lang === 'en' ? 'text' : '文本');
        savedSelection = null;

        let wrapper;
        if (alignType === 'center') {
            wrapper = document.createElement('center');
            wrapper.textContent = insertText;
        } else {
            wrapper = document.createElement('p');
            wrapper.setAttribute('align', alignType);
            wrapper.textContent = insertText;
        }

        range.deleteContents();
        range.insertNode(wrapper);

        const spacer = document.createTextNode('\u200B');
        wrapper.parentNode.insertBefore(spacer, wrapper.nextSibling);

        range.setStart(spacer, 1);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);

        saveEditorContent();
        editor.focus();
    };

    const insertFormat = (formatType) => {
        if (typeof isEditing === 'function' && !isEditing()) {
            if (typeof enterEdit === 'function') enterEdit();
            setTimeout(() => doInsert(formatType), 50);
        } else {
            doInsert(formatType);
        }
    };

    const doInsert = (formatType) => {
        const sel = window.getSelection();
        if (!sel.rangeCount) {
            editor.focus();
            return;
        }
        let range = sel.getRangeAt(0);

        if (savedSelection && savedSelection.range) {
            range = savedSelection.range;
            sel.removeAllRanges();
            sel.addRange(range);
        }

        if (!editor.contains(range.commonAncestorContainer)) {
            editor.focus();
            return;
        }

        const lang = getLang();
        const isBlockFormat = ['h1', 'h2', 'h3', 'ul', 'ol', 'task', 'quote'].includes(formatType);

        let insertText;
        if (isBlockFormat) {
            const container = range.startContainer;
            let blockContainer = container;
            if (container.nodeType === Node.TEXT_NODE) {
                blockContainer = container.parentElement;
            }

            if (blockContainer === editor || (blockContainer && blockContainer.parentElement === editor)) {
                if (container.nodeType === Node.TEXT_NODE) {
                    insertText = container.textContent.trim();
                    range = document.createRange();
                    range.setStart(container, 0);
                    range.setEnd(container, container.textContent.length);
                    sel.removeAllRanges();
                    sel.addRange(range);
                } else {
                    insertText = range.toString() || (lang === 'en' ? 'text' : '文本');
                }
            } else {
                insertText = (blockContainer && blockContainer.textContent) ? blockContainer.textContent.trim() : (range.toString() || (lang === 'en' ? 'text' : '文本'));
                if (blockContainer && blockContainer.textContent && blockContainer.textContent.trim()) {
                    range = document.createRange();
                    range.selectNodeContents(blockContainer);
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
            }
        } else {
            const selected = range.toString();
            insertText = selected || (lang === 'en' ? 'text' : '文本');
        }

        savedSelection = null;

        let wrapper = null;
        switch (formatType) {
            case 'bold':
                wrapper = document.createElement('strong');
                wrapper.textContent = insertText;
                break;
            case 'italic':
                wrapper = document.createElement('em');
                wrapper.textContent = insertText;
                break;
            case 'underline':
                wrapper = document.createElement('u');
                wrapper.textContent = insertText;
                break;
            case 'highlight':
                wrapper = document.createElement('mark');
                wrapper.textContent = insertText;
                break;
            case 'strike':
                wrapper = document.createElement('del');
                wrapper.textContent = insertText;
                break;
            case 'code':
                wrapper = document.createElement('code');
                wrapper.textContent = insertText;
                break;
            case 'link': {
                const url = prompt(lang === 'en' ? 'Enter URL:' : '请输入链接地址:', 'https://');
                if (url) {
                    const safe = (typeof ObsidianMarkdown !== 'undefined' && typeof ObsidianMarkdown.sanitizeHref === 'function')
                        ? ObsidianMarkdown.sanitizeHref(url)
                        : url;
                    if (safe) {
                        wrapper = document.createElement('a');
                        wrapper.href = safe;
                        wrapper.textContent = insertText;
                        wrapper.target = '_blank';
                        wrapper.rel = 'noopener noreferrer';
                    }
                }
                break;
            }
            case 'h1':
                wrapper = document.createElement('h1');
                wrapper.textContent = insertText;
                break;
            case 'h2':
                wrapper = document.createElement('h2');
                wrapper.textContent = insertText;
                break;
            case 'h3':
                wrapper = document.createElement('h3');
                wrapper.textContent = insertText;
                break;
            case 'ul': {
                wrapper = document.createElement('ul');
                const li = document.createElement('li');
                li.textContent = insertText;
                wrapper.appendChild(li);
                break;
            }
            case 'ol': {
                wrapper = document.createElement('ol');
                const li = document.createElement('li');
                li.textContent = insertText;
                wrapper.appendChild(li);
                break;
            }
            case 'task': {
                wrapper = document.createElement('div');
                wrapper.className = 'md-task-item';
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.className = 'md-task-checkbox';
                wrapper.appendChild(cb);
                wrapper.appendChild(document.createTextNode(' ' + insertText));
                break;
            }
            case 'quote':
                wrapper = document.createElement('blockquote');
                wrapper.textContent = insertText;
                break;
        }

        if (wrapper) {
            range.deleteContents();
            range.insertNode(wrapper);
            const spacer = document.createTextNode('\u200B');
            wrapper.parentNode.insertBefore(spacer, wrapper.nextSibling);
            range.setStart(spacer, 1);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            saveEditorContent();
        }

        editor.focus();
    };

    toolbar.addEventListener('mousedown', (e) => {
        const btn = e.target.closest('.md-format-btn, .md-fontcolor-chip, .md-align-option, .md-heading-option, .md-list-option, .md-fontcolor-input');
        if (btn && typeof isEditing === 'function' && isEditing()) {
            e.preventDefault();
        }
    });

    toolbar.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.getAttribute('data-action');
        if (!action) return;
        e.preventDefault();
        e.stopPropagation();

        if (action === 'md-format-toggle') {
            toggleFormatPopover();
            return;
        }

        if (action === 'md-fontcolor-toggle') {
            toggleFontColorPopover(btn);
            return;
        }
        if (action === 'md-fontcolor-apply') {
            const color = btn.getAttribute('data-color');
            if (color) {
                insertFontColor(color);
                closeFontColorPopover();
            }
            return;
        }

        if (action === 'md-heading-toggle') {
            toggleHeadingPopover(btn);
            return;
        }
        if (action === 'md-heading-apply') {
            const level = btn.getAttribute('data-level');
            if (level) {
                insertFormat(level);
                closeHeadingPopover();
            }
            return;
        }

        if (action === 'md-format-close') {
            toggleFormatPopover(toolbar.querySelector('[data-action="md-format-toggle"]'));
            return;
        }

        if (action === 'md-align-toggle') {
            toggleAlignPopover(btn);
            return;
        }
        if (action === 'md-align-apply') {
            const alignType = btn.getAttribute('data-align');
            if (alignType) {
                insertAlign(alignType);
                closeAlignPopover();
            }
            return;
        }

        if (action === 'md-list-toggle') {
            toggleListPopover(btn);
            return;
        }
        if (action === 'md-list-apply') {
            const listType = btn.getAttribute('data-type');
            if (listType) {
                insertFormat(listType);
                closeListPopover();
            }
            return;
        }

        if (action === 'md-insert-bold') return insertFormat('bold');
        if (action === 'md-insert-italic') return insertFormat('italic');
        if (action === 'md-insert-underline') return insertFormat('underline');
        if (action === 'md-insert-highlight') return insertFormat('highlight');
        if (action === 'md-insert-strike') return insertFormat('strike');
        if (action === 'md-insert-code') return insertFormat('code');
        if (action === 'md-insert-link') return insertFormat('link');
        if (action === 'md-insert-quote') return insertFormat('quote');

        if (action === 'md-format-close') {
            closeFormatPopover();
            return;
        }
    });

    // 实时渲染：监听输入事件（带防抖）
    let renderDebounceTimer = null;
    const RENDER_DEBOUNCE_DELAY = 250;
    const liveRender = () => {
        let changed = false;
        for (let i = 0; i < 20; i++) {
            if (!__tryConvertInlinePatternsInTextNode(editor)) break;
            changed = true;
        }
        for (let i = 0; i < 10; i++) {
            if (!__tryConvertBlockPatternsAtCaret(editor)) break;
            changed = true;
        }
        try { __applyHeadingCollapse(editor); } catch (_) { }
        saveEditorContent();
        return changed;
    };

    editor.addEventListener('input', (e) => {
        if (typeof isEditing === 'function' && !isEditing()) return;
        if (e && e.isComposing) return;
        if (renderDebounceTimer) clearTimeout(renderDebounceTimer);

        const inputType = (e && typeof e.inputType === 'string') ? e.inputType : '';
        const data = (e && typeof e.data === 'string') ? e.data : '';
        const shouldRenderImmediately = (
            inputType === 'insertFromPaste' ||
            inputType === 'insertFromDrop' ||
            /[*~=`=<>/\\\]\-#>]/.test(data)
        );
        if (shouldRenderImmediately) {
            // 如果是粘贴或拖放，进行全量扫描以确保所有内容（包括多行）都被渲染
            if (inputType === 'insertFromPaste' || inputType === 'insertFromDrop') {
                try { __fullScanRenderDescriptionEditor(editor); } catch (_) { }
            }
            liveRender();
            renderDebounceTimer = null;
            return;
        }

        renderDebounceTimer = setTimeout(() => {
            liveRender();
            renderDebounceTimer = null;
        }, RENDER_DEBOUNCE_DELAY);
    });

    editor.addEventListener('compositionend', () => {
        if (typeof isEditing === 'function' && !isEditing()) return;
        try { liveRender(); } catch (_) { }
    });



    editor.addEventListener('click', (e) => {
        const target = e.target;
        if (target && target.closest && target.closest('input.md-task-checkbox')) {
            saveEditorContent();
        }
    });

    ['mousedown', 'dblclick', 'click'].forEach(evt => editor.addEventListener(evt, ev => ev.stopPropagation()));

    return {
        closeAllPopovers,
        flush: reRenderExpanded,
        recordSnapshot: () => {
            if (undoManager) undoManager.recordNow('manual');
        },
        clearUndoHistory: () => {
            if (undoManager && typeof undoManager.reset === 'function') {
                undoManager.reset();
            }
        }
    };
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
    // 优先使用持久化的滚动位置
    const persisted = __readJSON(`temp-section-scroll:${section.id}`, null);
    if (persisted && typeof persisted.top === 'number') {
        savedScrollTop = persisted.top;
        savedScrollLeft = typeof persisted.left === 'number' ? persisted.left : 0;
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
    }

    // Always update z-index logic (Both new and existing)
    // 默认100 (Unpinned), Pinned 200. 高于 Import Container (5) 和 Edges (7)
    const pinnedState = section.pinned || false;
    nodeElement.style.zIndex = pinnedState ? '200' : '100';
    nodeElement.style.position = 'absolute'; // Ensure absolute positioning
    nodeElement.style.setProperty('--section-color', section.color || TEMP_SECTION_DEFAULT_COLOR);

    const header = document.createElement('div');
    header.className = 'temp-node-header';
    header.dataset.sectionId = section.id;
    header.style.setProperty('--section-color', section.color || TEMP_SECTION_DEFAULT_COLOR);

    // 创建标题容器（包含序号标签和标题输入框）
    const titleContainer = document.createElement('div');
    titleContainer.className = 'temp-node-title-container';

    // 添加序号标签（如果有）
    const sectionLabel = getTempSectionLabel(section);
    if (sectionLabel) {
        const sequenceBadge = document.createElement('span');
        sequenceBadge.className = 'temp-node-sequence-badge';
        applyTempSectionBadge(sequenceBadge, sectionLabel);
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
    colorInput.className = 'temp-node-color-input md-color-input';
    colorInput.value = section.color || '#66bbff';
    colorInput.title = colorLabel;

    const lockBtn = document.createElement('button');
    lockBtn.type = 'button';
    lockBtn.className = 'temp-node-action-btn temp-color-lock-btn';
    const lockLabel = (typeof currentLang !== 'undefined' && currentLang === 'en') ? 'Lock color' : '锁定颜色';
    const unlockLabel = (typeof currentLang !== 'undefined' && currentLang === 'en') ? 'Unlock color' : '解除锁定';
    const lockedSvg = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2a4 4 0 0 0-4 4v3H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1V6a4 4 0 0 0-4-4zm-2 7V6a2 2 0 1 1 4 0v3h-4z"/></svg>';
    const unlockedSvg = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M17 9h-1V7a4 4 0 0 0-7.4-2.2 1 1 0 1 0 1.7 1A2 2 0 0 1 14 7v2H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zm0 9H7v-7h10v7z"/></svg>';
    const updateLockBtn = () => {
        const locked = !!section.colorLocked;
        lockBtn.classList.toggle('locked', locked);
        lockBtn.innerHTML = locked ? lockedSvg : unlockedSvg;
        lockBtn.title = locked ? unlockLabel : lockLabel;
        lockBtn.setAttribute('aria-label', lockBtn.title);
        lockBtn.setAttribute('aria-pressed', locked ? 'true' : 'false');
    };
    updateLockBtn();

    const colorBtn = document.createElement('button');
    colorBtn.type = 'button';
    colorBtn.className = 'temp-node-action-btn temp-node-color-btn';
    colorBtn.title = colorLabel;
    colorBtn.setAttribute('aria-label', colorLabel);
    colorBtn.innerHTML = '<i class="fas fa-palette"></i>';

    const colorWrap = document.createElement('div');
    colorWrap.className = 'temp-node-color-wrap';

    const colorPopover = document.createElement('div');
    colorPopover.className = 'md-color-popover temp-color-popover';
    preventCanvasEventsPropagation(colorPopover);
    const rgbPickerTitle = (typeof currentLang !== 'undefined' && currentLang === 'en') ? 'RGB Color Picker' : 'RGB颜色选择器';
    const recentTitle = (typeof currentLang !== 'undefined' && currentLang === 'en') ? 'Previous color' : '上上次颜色';
    const chipRow = document.createElement('div');
    chipRow.className = 'temp-color-chip-row';
    const lang = typeof currentLang !== 'undefined' ? currentLang : 'zh';
    chipRow.innerHTML = `
        <span class="md-color-chip" data-action="md-color-custom" data-color="#888888" style="background:#888888" title="${lang === 'en' ? 'Gray' : '灰色'}"></span>
        <span class="md-color-chip" data-action="md-color-custom" data-color="#66bbff" style="background:#66bbff" title="${lang === 'en' ? 'Default Blue' : '默认蓝色'}"></span>
        <span class="md-color-chip" data-action="md-color-preset" data-color="1" style="background:#fb464c"></span>
        <span class="md-color-chip" data-action="md-color-preset" data-color="2" style="background:#e9973f"></span>
        <span class="md-color-chip" data-action="md-color-preset" data-color="3" style="background:#e0de71"></span>
        <span class="md-color-chip" data-action="md-color-preset" data-color="4" style="background:#44cf6e"></span>
        <span class="md-color-chip" data-action="md-color-preset" data-color="5" style="background:#53dfdd"></span>
        <span class="md-color-chip" data-action="md-color-preset" data-color="6" style="background:#a882ff"></span>
        <span class="temp-color-divider" aria-hidden="true"></span>
        <span class="md-color-chip temp-color-current-chip" data-action="md-color-recent" title="${recentTitle}"></span>
        <button class="md-color-chip md-color-picker-btn temp-rainbow-btn" data-action="md-color-picker-toggle" title="${rgbPickerTitle}"></button>
    `;
    const defaultChipEl = chipRow.querySelector('.temp-color-current-chip');
    const resolveHistoryColor = (value) => {
        const normalized = normalizeHexColor(value || '');
        return normalized ? `#${normalized}` : TEMP_SECTION_DEFAULT_COLOR;
    };
    const syncHistoryChip = (value) => {
        if (!defaultChipEl) return;
        const safe = resolveHistoryColor(value);
        defaultChipEl.dataset.color = safe;
        defaultChipEl.style.backgroundColor = safe;
        defaultChipEl.style.backgroundImage = 'none';
        defaultChipEl.style.border = '';
    };
    const updateColorHistory = (value) => {
        const safe = resolveHistoryColor(value);
        const last = resolveHistoryColor(CanvasState.tempSectionLastColor || TEMP_SECTION_DEFAULT_COLOR);
        CanvasState.tempSectionPrevColor = last;
        CanvasState.tempSectionLastColor = safe;
        syncHistoryChip(CanvasState.tempSectionPrevColor || TEMP_SECTION_DEFAULT_COLOR);
    };
    syncHistoryChip(CanvasState.tempSectionPrevColor || TEMP_SECTION_DEFAULT_COLOR);
    chipRow.appendChild(lockBtn);
    colorPopover.appendChild(chipRow);
    colorPopover.appendChild(colorInput);
    colorWrap.appendChild(colorBtn);
    colorWrap.appendChild(colorPopover);
    preventCanvasEventsPropagation(colorPopover);

    const closeColorPopover = () => {
        colorPopover.classList.remove('open');
        updateCanvasPopoverState(false);
    };

    colorBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const isOpen = colorPopover.classList.contains('open');
        document.querySelectorAll('.temp-color-popover.open').forEach(el => {
            if (el !== colorPopover) el.classList.remove('open');
        });
        if (isOpen) {
            closeColorPopover();
            return;
        }
        syncHistoryChip(CanvasState.tempSectionPrevColor || TEMP_SECTION_DEFAULT_COLOR);
        colorPopover.classList.add('open');
        updateCanvasPopoverState(true);

        const onDoc = (e) => {
            if (!colorPopover.contains(e.target) && e.target !== colorBtn) {
                closeColorPopover();
                document.removeEventListener('mousedown', onDoc, true);
            }
        };
        document.addEventListener('mousedown', onDoc, true);
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
        const nextColor = event.target.value || TEMP_SECTION_DEFAULT_COLOR;
        section.color = nextColor;
        applyTempSectionColor(section, nodeElement, header, colorBtn, colorInput);
        propagateTempSectionColor(section, nextColor);
        updateColorHistory(nextColor);
        saveTempNodes();
    });

    lockBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        section.colorLocked = !section.colorLocked;
        updateLockBtn();
        saveTempNodes();
    });

    colorPopover.addEventListener('click', (event) => {
        const btn = event.target.closest('.md-color-chip, .md-color-picker-btn');
        if (!btn) return;
        event.preventDefault();
        event.stopPropagation();
        const action = btn.getAttribute('data-action');

        if (action === 'md-color-picker-toggle') {
            colorInput.click();
            return;
        }

        if (action === 'md-color-recent') {
            const nextColor = (defaultChipEl && defaultChipEl.dataset.color) || TEMP_SECTION_DEFAULT_COLOR;
            section.color = nextColor;
            applyTempSectionColor(section, nodeElement, header, colorBtn, colorInput);
            propagateTempSectionColor(section, nextColor);
            updateColorHistory(nextColor);
            saveTempNodes();
            closeColorPopover();
            return;
        }

        if (action === 'md-color-preset') {
            const preset = String(btn.getAttribute('data-color') || '').trim();
            const nextColor = presetToHex(preset) || TEMP_SECTION_DEFAULT_COLOR;
            section.color = nextColor;
            applyTempSectionColor(section, nodeElement, header, colorBtn, colorInput);
            propagateTempSectionColor(section, nextColor);
            updateColorHistory(nextColor);
            saveTempNodes();
            closeColorPopover();
        }

        if (action === 'md-color-custom') {
            const customColor = btn.getAttribute('data-color');
            if (customColor) {
                section.color = customColor;
                applyTempSectionColor(section, nodeElement, header, colorBtn, colorInput);
                propagateTempSectionColor(section, customColor);
                updateColorHistory(customColor);
                saveTempNodes();
                closeColorPopover();
            }
        }
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
    actions.appendChild(colorWrap);
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
    descriptionText.className = 'temp-node-description md-wysiwyg-editor';
    descriptionText.style.cursor = 'pointer';
    descriptionText.contentEditable = 'false';
    descriptionText.spellcheck = false;

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

    // 初始化内容：兼容旧的 Markdown 存储；编辑器内使用 HTML（与空白栏目一致）
    const initialHtml = __normalizeCanvasRichHtml(__coerceDescriptionSourceToHtml(section.description || ''));
    descriptionText.innerHTML = initialHtml;
    try { __applyHeadingCollapse(descriptionText); } catch (_) { }

    // 双击编辑功能
    descriptionText.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        enterEditingDescription();
    });

    descriptionContent.appendChild(descriptionText);

    descriptionContainer.appendChild(descriptionContent);

    const descriptionControls = document.createElement('div');
    descriptionControls.className = 'temp-node-description-controls';
    descriptionControls.style.display = 'flex';
    descriptionControls.style.opacity = '0'; // 默认隐藏，点击进入输入框时显示
    descriptionControls.style.pointerEvents = 'none';
    descriptionControls.style.transition = 'opacity 0.2s';

    const formatDescBtn = document.createElement('button');
    formatDescBtn.type = 'button';
    formatDescBtn.className = 'temp-node-desc-action-btn temp-node-desc-format-btn';
    const formatLabel = (typeof currentLang !== 'undefined' && currentLang === 'en') ? 'Format toolbar' : '格式工具栏';
    formatDescBtn.title = formatLabel;
    formatDescBtn.setAttribute('aria-label', formatLabel);
    formatDescBtn.setAttribute('data-action', 'md-format-toggle');
    formatDescBtn.innerHTML = '<i class="fas fa-font"></i>';
    descriptionControls.appendChild(formatDescBtn);

    // editDescBtn removed as per request


    const delDescBtn = document.createElement('button');
    delDescBtn.type = 'button';
    delDescBtn.className = 'temp-node-desc-action-btn temp-node-desc-delete-btn';
    // Change to "Clear input" to match Permanent Section
    delDescBtn.title = (typeof currentLang !== 'undefined' && currentLang === 'en') ? 'Clear input' : '清空输入框';
    delDescBtn.innerHTML = '<i class="fas fa-times"></i>';
    descriptionControls.appendChild(delDescBtn);

    descriptionContainer.appendChild(descriptionControls);

    // --- WYSIWYG 编辑（复用空白栏目格式工具 + 实时渲染规则） ---
    let isEditingDesc = false;
    let beforeEditStored = String(section.description || '');

    const applyPlaceholder = () => {
        if (section.suppressPlaceholder) {
            descriptionText.setAttribute('data-placeholder', '');
            descriptionText.setAttribute('aria-label', '');
            return;
        }
        const ph = getPlaceholderText();
        descriptionText.setAttribute('data-placeholder', ph);
        descriptionText.setAttribute('aria-label', ph);
    };

    const updateDescMeta = () => {
        const html = __normalizeCanvasRichHtml(descriptionText.innerHTML);
        const hasContent = !!html;
        descriptionText.style.fontStyle = hasContent ? 'normal' : 'italic';
        descriptionText.style.opacity = hasContent ? '1' : '0.5';
        descriptionText.title = hasContent ? getEditTitle() : (section.suppressPlaceholder ? '' : getAddTitle());
    };

    const persistDesc = ({ normalizeEditorHtml = false } = {}) => {
        const normalized = __normalizeCanvasRichHtml(__getCleanHtmlForStorage(descriptionText));
        section.description = normalized;
        if (normalizeEditorHtml) {
            descriptionText.innerHTML = normalized;
        }
        saveTempNodes();
        updateDescMeta();
    };

    const exitEditingDescription = ({ commit }) => {
        if (!isEditingDesc) return;
        isEditingDesc = false;
        descriptionContainer.classList.remove('editing');
        descriptionText.contentEditable = 'false';

        if (commit) {
            try {
                if (descEditorApi && typeof descEditorApi.flush === 'function') descEditorApi.flush();
            } catch (_) { }
            persistDesc({ normalizeEditorHtml: true });
        } else {
            section.description = beforeEditStored;
            const restored = __normalizeCanvasRichHtml(__coerceDescriptionSourceToHtml(beforeEditStored));
            descriptionText.innerHTML = restored;
            saveTempNodes();
            updateDescMeta();
        }

        if (descriptionControls) {
            descriptionControls.style.opacity = '0';
            descriptionControls.style.pointerEvents = 'none';
        }

        try {
            if (descEditorApi) {
                descEditorApi.closeAllPopovers();
                if (typeof descEditorApi.clearUndoHistory === 'function') descEditorApi.clearUndoHistory();
            }
        } catch (_) { }
    };

    const enterEditingDescription = () => {
        if (isEditingDesc) return;
        isEditingDesc = true;
        beforeEditStored = String(section.description || '');
        descriptionContainer.classList.add('editing');
        descriptionText.contentEditable = 'true';
        descriptionText.focus();
        __placeCaretAtEnd(descriptionText);
        if (descEditorApi && typeof descEditorApi.recordSnapshot === 'function') {
            // 确保初始状态被记录，以便可以撤销回初始状态
            //由于 reset 会清空栈，我们需要一个新的起点
            descEditorApi.recordSnapshot('init');
        }
        if (descriptionControls) {
            descriptionControls.style.opacity = '1';
            descriptionControls.style.pointerEvents = 'auto';
        }

    };

    // 单击也可以编辑（当没有说明时）
    // 单击进入编辑（只要不在编辑模式）
    descriptionText.addEventListener('click', (e) => {
        if (isEditingDesc) return;
        e.preventDefault();
        e.stopPropagation();
        enterEditingDescription();
    });

    // editDescBtn listener removed


    delDescBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        section.description = '';
        descriptionText.innerHTML = '';
        saveTempNodes();
        if (isEditingDesc) {
            // Keep editing, just clear content
            descriptionText.focus();
        } else {
            // Should not happen if controls are hidden when not editing, but for safety:
            isEditingDesc = false;
            descriptionContainer.classList.remove('editing');
            descriptionText.contentEditable = 'false';
        }


        try { if (descEditorApi) descEditorApi.closeAllPopovers(); } catch (_) { }
        updateDescMeta();
    });

    descriptionText.addEventListener('keydown', (e) => {
        if (!isEditingDesc) return;
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            exitEditingDescription({ commit: true });
        } else if (e.key === 'Escape') {
            e.preventDefault();
            exitEditingDescription({ commit: false });
        }
    });

    descriptionText.addEventListener('blur', () => {
        if (!isEditingDesc) return;
        exitEditingDescription({ commit: true });
    });

    // 复制时转换为 Markdown 源码格式（而非渲染后的富文本）
    descriptionText.addEventListener('copy', (e) => {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return;

        const range = selection.getRangeAt(0);
        const container = document.createElement('div');
        container.appendChild(range.cloneContents());
        const selectedHtml = container.innerHTML;

        const isAll = __isSelectionAll(descriptionText, selection);
        const htmlSource = isAll ? __getCleanHtmlForStorage(descriptionText) : selectedHtml;
        if (!htmlSource) return;

        const markdownSource = __htmlToMarkdown(htmlSource);

        // 智能优化：选中整行自动补充 Markdown 符号
        let finalSource = markdownSource;
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const commonAncestor = range.commonAncestorContainer;
            const blockEl = (commonAncestor.nodeType === 1 ? commonAncestor : commonAncestor.parentNode).closest('li, h1, h2, h3, h4, h5, h6, blockquote');
            if (blockEl && descriptionText.contains(blockEl)) {
                const blockText = blockEl.textContent.trim();
                const selectedText = selection.toString().trim();
                if (blockText && selectedText && blockText === selectedText) {
                    const tag = blockEl.tagName;
                    if (tag === 'LI') {
                        const parent = blockEl.parentElement;
                        if (parent && parent.tagName === 'OL') {
                            const index = Array.from(parent.children).indexOf(blockEl) + 1;
                            finalSource = `${index}. ${finalSource}`;
                        } else {
                            finalSource = (blockEl.classList.contains('md-task-item'))
                                ? `- ${blockEl.querySelector('input') && blockEl.querySelector('input').checked ? '[x]' : '[ ]'} ${finalSource}`
                                : `- ${finalSource}`;
                        }
                    } else if (tag === 'H1') finalSource = `# ${finalSource}`;
                    else if (tag === 'H2') finalSource = `## ${finalSource}`;
                    else if (tag === 'H3') finalSource = `### ${finalSource}`;
                    else if (tag === 'BLOCKQUOTE') finalSource = `> ${finalSource}`;
                }
            }
        }

        const safeHtml = __normalizeCanvasRichHtml(htmlSource);
        if (safeHtml) {
            try { e.clipboardData.setData('text/html', safeHtml); } catch (_) { }
            try { e.clipboardData.setData('application/x-bookmark-canvas-html', safeHtml); } catch (_) { }
        }

        e.preventDefault();
        e.clipboardData.setData('text/plain', finalSource);
        // 移除 HTML 格式
        // e.clipboardData.setData('text/html', selectedHtml);
    });

    descriptionControls.addEventListener('mousedown', (e) => {
        if (!isEditingDesc) return;
        const btn = e.target.closest('button');
        if (btn) e.preventDefault();
    });

    applyPlaceholder();
    updateDescMeta();

    const descEditorApi = __mountMdCloneDescriptionEditor({
        editor: descriptionText,
        toolbar: descriptionControls,
        formatToggleBtn: formatDescBtn,
        isEditing: () => isEditingDesc,
        enterEdit: enterEditingDescription,
        save: () => {
            if (!isEditingDesc) return;
            persistDesc({ normalizeEditorHtml: false });
        },
        nodeId: section.id
    });

    const body = document.createElement('div');
    body.className = 'temp-node-body';

    const treeContainer = document.createElement('div');
    treeContainer.className = 'bookmark-tree temp-bookmark-tree';
    treeContainer.dataset.sectionId = section.id;
    treeContainer.dataset.treeType = 'temporary';

    const treeFragment = document.createDocumentFragment();
    // [OPT] 启动防御：如果栏目处于休眠记忆状态，直接跳过昂贵的 DOM 构建
    if (section.dormant) {
        if (nodeElement) nodeElement.classList.add('dormant-content');
        treeContainer.style.display = 'none';
        treeContainer.dataset.contentHidden = 'true';
    } else {
        section.items.forEach(item => {
            const node = buildTempTreeNode(section, item, 0);
            if (node) treeFragment.appendChild(node);
        });
    }
    treeContainer.appendChild(treeFragment);
    body.appendChild(treeContainer);

    nodeElement.appendChild(header);
    nodeElement.appendChild(descriptionContainer);
    nodeElement.appendChild(body);

    // 持久化滚动：保存
    {
        let rafId = 0;
        const key = `temp-section-scroll:${section.id}`;
        body.addEventListener('scroll', () => {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => __writeJSON(key, { top: body.scrollTop || 0, left: body.scrollLeft || 0 }));
        }, { passive: true });
    }

    applyTempSectionColor(section, nodeElement, header, colorBtn, colorInput);
    makeNodeDraggable(nodeElement, section);
    makeTempNodeResizable(nodeElement, section);
    registerSectionCtrlOverlay(nodeElement);
    if (!section.dormant) {
        setupTempSectionTreeInteractions(treeContainer, section);
    }
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
    if (!isNew || savedScrollTop) {
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

/**
 * 将 Obsidian Canvas 颜色格式转换为十六进制颜色
 * Obsidian 使用数字 1-6 表示预设颜色，或直接使用十六进制
 * @param {string|number} obsidianColor - Obsidian 颜色值
 * @returns {string} - 十六进制颜色
 */
function convertObsidianColor(obsidianColor) {
    if (!obsidianColor) return null;

    // Obsidian 官方预设颜色映射 (1-6)：红橙黄绿青紫
    const OBSIDIAN_COLOR_MAP = {
        '1': '#fb464c', // 红色 (Red)
        '2': '#e9973f', // 橙色 (Orange)
        '3': '#e0de71', // 黄色 (Yellow)
        '4': '#44cf6e', // 绿色 (Green)
        '5': '#53dfdd', // 青蓝色 (Cyan)
        '6': '#a882ff'  // 紫色 (Purple)
    };

    const colorStr = String(obsidianColor).trim();

    // 如果是数字 1-6，转换为对应的十六进制颜色
    if (OBSIDIAN_COLOR_MAP[colorStr]) {
        console.log(`[Canvas] 转换 Obsidian 颜色: ${colorStr} -> ${OBSIDIAN_COLOR_MAP[colorStr]}`);
        return OBSIDIAN_COLOR_MAP[colorStr];
    }

    // 如果已经是十六进制颜色，直接返回
    if (colorStr.startsWith('#')) {
        return colorStr;
    }

    // 如果是 6 位十六进制（不带 #）
    if (/^[0-9a-f]{6}$/i.test(colorStr)) {
        return `#${colorStr}`;
    }

    // 其他情况返回原值
    console.log(`[Canvas] 保留原始颜色值: ${obsidianColor}`);
    return obsidianColor;
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

// 性能优化：懒加载阈值配置
const LAZY_LOAD_THRESHOLD = {
    maxInitialDepth: 1,      // 初始只渲染到第1层深度
    maxInitialChildren: 20,  // 每个文件夹初始最多渲染20个子项
    expandedFolders: new Set(), // 跟踪已展开的文件夹（深层）
    collapsedFolders: new Set() // 跟踪已折叠的文件夹（浅层，默认展开但被用户折叠）
};

// 临时栏目展开状态持久化
const TEMP_EXPAND_STATE_KEY = 'canvas-temp-expand-state';
let _saveTempExpandStateTimer = null;

function saveTempExpandState() {
    // debounce：300ms 内的连续调用只执行最后一次，减少 localStorage I/O
    if (_saveTempExpandStateTimer) {
        clearTimeout(_saveTempExpandStateTimer);
    }
    _saveTempExpandStateTimer = setTimeout(() => {
        _saveTempExpandStateTimer = null;
        try {
            const state = {
                expanded: Array.from(LAZY_LOAD_THRESHOLD.expandedFolders),
                collapsed: Array.from(LAZY_LOAD_THRESHOLD.collapsedFolders)
            };
            localStorage.setItem(TEMP_EXPAND_STATE_KEY, JSON.stringify(state));
        } catch (e) {
            console.warn('[Canvas] 保存临时栏目展开状态失败:', e);
        }
    }, 300);
}

function loadTempExpandState() {
    try {
        const saved = localStorage.getItem(TEMP_EXPAND_STATE_KEY);
        if (saved) {
            const state = JSON.parse(saved);
            // 兼容旧格式（数组）和新格式（对象）
            if (Array.isArray(state)) {
                LAZY_LOAD_THRESHOLD.expandedFolders = new Set(state);
            } else if (state && typeof state === 'object') {
                if (Array.isArray(state.expanded)) {
                    LAZY_LOAD_THRESHOLD.expandedFolders = new Set(state.expanded);
                }
                if (Array.isArray(state.collapsed)) {
                    LAZY_LOAD_THRESHOLD.collapsedFolders = new Set(state.collapsed);
                }
            }
            console.log('[Canvas] 恢复临时栏目展开状态:',
                LAZY_LOAD_THRESHOLD.expandedFolders.size, '个展开,',
                LAZY_LOAD_THRESHOLD.collapsedFolders.size, '个折叠');
        }
    } catch (e) {
        console.warn('[Canvas] 加载临时栏目展开状态失败:', e);
    }
}

function buildTempTreeNode(section, item, level, options = {}) {
    if (!item) return null;

    const { forceExpand = false, lazyLoad = true } = options;

    const wrapper = document.createElement('div');
    wrapper.className = 'tree-node';

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

    // 判断是否有子节点
    const hasChildren = item.type === 'folder' && item.children && item.children.length > 0;

    // 性能优化：懒加载逻辑
    // 超过阈值深度的文件夹默认折叠，不渲染子节点
    const shouldLazyLoad = lazyLoad && level >= LAZY_LOAD_THRESHOLD.maxInitialDepth && hasChildren;
    const folderId = `${section.id}-${item.id}`;

    // 计算展开状态：
    // 1. forceExpand - 强制展开
    // 2. expandedFolders.has(folderId) - 用户已展开的深层文件夹
    // 3. 浅层文件夹默认展开，除非被用户折叠（在collapsedFolders中）
    const defaultExpanded = !shouldLazyLoad && level < LAZY_LOAD_THRESHOLD.maxInitialDepth;
    const userCollapsed = LAZY_LOAD_THRESHOLD.collapsedFolders.has(folderId);
    const userExpanded = LAZY_LOAD_THRESHOLD.expandedFolders.has(folderId);
    const isExpanded = forceExpand || userExpanded || (defaultExpanded && !userCollapsed);

    if (hasChildren) {
        if (isExpanded) {
            toggle.classList.add('expanded');
        }
        // 标记该节点有子节点但可能未加载
        treeItem.dataset.hasChildren = 'true';
        treeItem.dataset.childrenLoaded = isExpanded ? 'true' : 'false';
    } else {
        toggle.style.opacity = '0';
    }

    let icon;
    if (item.type === 'folder') {
        icon = document.createElement('i');
        icon.className = 'tree-icon fas fa-folder';
        if (isExpanded && hasChildren) {
            icon.classList.remove('fa-folder');
            icon.classList.add('fa-folder-open');
        }
    } else {
        icon = document.createElement('img');
        icon.className = 'tree-icon';
        const favicon = getFaviconUrl(item.url);
        icon.src = favicon || fallbackIcon;
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

    // 如果有未加载的子节点，显示数量提示
    if (hasChildren && !isExpanded) {
        const countBadge = document.createElement('span');
        countBadge.className = 'folder-count-badge';
        countBadge.textContent = `(${item.children.length})`;
        badges.appendChild(countBadge);
    }

    treeItem.appendChild(toggle);
    treeItem.appendChild(icon);
    treeItem.appendChild(label);
    treeItem.appendChild(badges);
    wrapper.appendChild(treeItem);

    setupTempTreeNodeDropHandlers(treeItem, section, item);

    if (item.type === 'folder') {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'tree-children' + (isExpanded ? ' expanded' : '');
        childrenContainer.dataset.sectionId = section.id;
        childrenContainer.dataset.parentItemId = item.id;

        if (hasChildren && isExpanded) {
            // 渲染子节点，但限制初始渲染数量
            const childrenToRender = lazyLoad && item.children.length > LAZY_LOAD_THRESHOLD.maxInitialChildren
                ? item.children.slice(0, LAZY_LOAD_THRESHOLD.maxInitialChildren)
                : item.children;

            childrenToRender.forEach(child => {
                const childNode = buildTempTreeNode(section, child, level + 1, { lazyLoad });
                if (childNode) childrenContainer.appendChild(childNode);
            });

            // 如果有更多子节点未渲染，添加"加载更多"按钮
            if (lazyLoad && item.children.length > LAZY_LOAD_THRESHOLD.maxInitialChildren) {
                const loadMoreBtn = document.createElement('div');
                loadMoreBtn.className = 'tree-load-more';
                loadMoreBtn.dataset.sectionId = section.id;
                loadMoreBtn.dataset.parentItemId = item.id;
                loadMoreBtn.dataset.startIndex = LAZY_LOAD_THRESHOLD.maxInitialChildren;
                loadMoreBtn.innerHTML = `<i class="fas fa-ellipsis-h"></i> <span>${item.children.length - LAZY_LOAD_THRESHOLD.maxInitialChildren} more items</span>`;
                childrenContainer.appendChild(loadMoreBtn);
            }
        }

        wrapper.appendChild(childrenContainer);
    }

    return wrapper;
}

// 懒加载：展开文件夹时加载子节点
function loadFolderChildren(section, parentItemId, childrenContainer) {
    try {
        console.log('[Canvas懒加载] loadFolderChildren 被调用:', {
            sectionId: section?.id,
            parentItemId,
            hasContainer: !!childrenContainer
        });

        if (!section || !parentItemId || !childrenContainer) {
            console.warn('[Canvas懒加载] loadFolderChildren: 参数无效');
            return false;
        }

        const itemEntry = findTempItemEntry(section.id, parentItemId);
        console.log('[Canvas懒加载] findTempItemEntry 结果:', {
            found: !!itemEntry,
            hasItem: !!itemEntry?.item,
            childrenCount: itemEntry?.item?.children?.length
        });

        if (!itemEntry || !itemEntry.item) {
            console.warn('[Canvas懒加载] loadFolderChildren: 找不到项目', parentItemId, '在section:', section.id);
            // 打印section.items的所有id以便调试
            console.log('[Canvas懒加载] section.items ids:', section.items?.map(i => i.id));
            return false;
        }

        const item = itemEntry.item;
        if (!item.children || item.children.length === 0) {
            console.warn('[Canvas懒加载] loadFolderChildren: 项目没有子节点', parentItemId);
            return false;
        }

        const folderId = `${section.id}-${parentItemId}`;
        LAZY_LOAD_THRESHOLD.expandedFolders.add(folderId);
        LAZY_LOAD_THRESHOLD.collapsedFolders.delete(folderId); // 从折叠集合中移除
        saveTempExpandState(); // 持久化展开状态

        // 清空并重新渲染子节点
        childrenContainer.innerHTML = '';
        const fragment = document.createDocumentFragment();

        item.children.forEach(child => {
            try {
                const childNode = buildTempTreeNode(section, child, 1, { lazyLoad: true });
                if (childNode) fragment.appendChild(childNode);
            } catch (err) {
                console.warn('[Canvas懒加载] 渲染子节点失败:', err);
            }
        });

        childrenContainer.appendChild(fragment);

        // 更新父节点状态
        const parentTreeItem = childrenContainer.previousElementSibling;
        if (parentTreeItem) {
            parentTreeItem.dataset.childrenLoaded = 'true';
            // 移除数量提示
            const countBadge = parentTreeItem.querySelector('.folder-count-badge');
            if (countBadge) countBadge.remove();
        }

        return true;
    } catch (error) {
        console.error('[Canvas懒加载] loadFolderChildren 出错:', error);
        return false;
    }
}

// 加载更多子节点
function loadMoreChildren(section, parentItemId, startIndex, loadMoreBtn) {
    try {
        if (!section || !parentItemId || !loadMoreBtn) {
            console.warn('[Canvas懒加载] loadMoreChildren: 参数无效');
            return false;
        }

        const itemEntry = findTempItemEntry(section.id, parentItemId);
        if (!itemEntry || !itemEntry.item || !itemEntry.item.children) {
            console.warn('[Canvas懒加载] loadMoreChildren: 找不到项目', parentItemId);
            return false;
        }

        const childrenContainer = loadMoreBtn.parentElement;
        if (!childrenContainer) {
            console.warn('[Canvas懒加载] loadMoreChildren: 找不到容器');
            return false;
        }

        const remainingChildren = itemEntry.item.children.slice(startIndex);
        if (remainingChildren.length === 0) {
            loadMoreBtn.remove();
            return true;
        }

        // 移除"加载更多"按钮
        loadMoreBtn.remove();

        // 渲染剩余子节点
        const fragment = document.createDocumentFragment();
        remainingChildren.forEach(child => {
            try {
                const childNode = buildTempTreeNode(section, child, 1, { lazyLoad: true });
                if (childNode) fragment.appendChild(childNode);
            } catch (err) {
                console.warn('[Canvas懒加载] 渲染子节点失败:', err);
            }
        });

        childrenContainer.appendChild(fragment);
        return true;
    } catch (error) {
        console.error('[Canvas懒加载] loadMoreChildren 出错:', error);
        return false;
    }
}

// 清理懒加载状态（用于重置）
function clearLazyLoadState() {
    try {
        LAZY_LOAD_THRESHOLD.expandedFolders.clear();
        LAZY_LOAD_THRESHOLD.collapsedFolders.clear();
        if (_saveTempExpandStateTimer) {
            clearTimeout(_saveTempExpandStateTimer);
            _saveTempExpandStateTimer = null;
        }
        localStorage.removeItem(TEMP_EXPAND_STATE_KEY);
    } catch (_) { }
}

function setupTempSectionTreeInteractions(treeContainer, section) {
    if (!treeContainer) return;

    // 防止重复绑定
    if (treeContainer.dataset.lazyLoadBound === 'true') return;
    treeContainer.dataset.lazyLoadBound = 'true';

    // 性能优化：懒加载文件夹展开处理
    treeContainer.addEventListener('click', (e) => {
        // 处理"加载更多"按钮点击
        const loadMoreBtn = e.target.closest('.tree-load-more');
        if (loadMoreBtn) {
            e.preventDefault();
            e.stopPropagation();
            const parentItemId = loadMoreBtn.dataset.parentItemId;
            const startIndex = parseInt(loadMoreBtn.dataset.startIndex, 10) || 0;
            loadMoreChildren(section, parentItemId, startIndex, loadMoreBtn);
            return;
        }

        // 处理文件夹展开/折叠
        const treeItem = e.target.closest('.tree-item');
        if (!treeItem) return;

        // 只处理文件夹
        if (treeItem.dataset.nodeType !== 'folder') return;

        const treeNode = treeItem.closest('.tree-node');
        if (!treeNode) return;

        const childrenContainer = treeNode.querySelector(':scope > .tree-children');
        if (!childrenContainer) return;

        const parentItemId = treeItem.dataset.nodeId;
        const folderId = `${section.id}-${parentItemId}`;
        const isExpanded = childrenContainer.classList.contains('expanded');
        const nodeToggle = treeItem.querySelector('.tree-toggle');
        const nodeIcon = treeItem.querySelector('.tree-icon.fas');

        if (isExpanded) {
            // 折叠
            childrenContainer.classList.remove('expanded');
            if (nodeToggle) nodeToggle.classList.remove('expanded');
            if (nodeIcon) {
                nodeIcon.classList.remove('fa-folder-open');
                nodeIcon.classList.add('fa-folder');
            }
            // 记录折叠状态
            LAZY_LOAD_THRESHOLD.expandedFolders.delete(folderId);
            LAZY_LOAD_THRESHOLD.collapsedFolders.add(folderId);
            saveTempExpandState();
        } else {
            // 展开
            childrenContainer.classList.add('expanded');
            if (nodeToggle) nodeToggle.classList.add('expanded');
            if (nodeIcon) {
                nodeIcon.classList.remove('fa-folder');
                nodeIcon.classList.add('fa-folder-open');
            }

            // 懒加载：如果子节点未加载，现在加载
            if (treeItem.dataset.childrenLoaded === 'false' && treeItem.dataset.hasChildren === 'true') {
                loadFolderChildren(section, parentItemId, childrenContainer);
            }
            // 记录展开状态
            LAZY_LOAD_THRESHOLD.expandedFolders.add(folderId);
            LAZY_LOAD_THRESHOLD.collapsedFolders.delete(folderId);
            saveTempExpandState();
        }

        e.preventDefault();
        e.stopImmediatePropagation(); // 阻止 attachTreeEvents 再次处理导致双重切换
    });

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
            target.closest('.temp-color-popover') ||
            target.classList.contains('temp-node-color-input') ||
            (target.classList.contains('temp-node-title') && target.classList.contains('editing')) ||
            target.closest('.canvas-node-anchor') ||
            target.closest('.canvas-anchor-zone')) {
            return;
        }

        // Ctrl模式下，通过overlay处理
        if (isSectionCtrlModeEvent(e)) {
            return;
        }

        // 正常拖动
        if (e.button !== 0) return;

        lastClientX = e.clientX;
        lastClientY = e.clientY;

        CanvasState.dragState.isDragging = true;
        CanvasState.dragState.draggedElement = element;
        CanvasState.dragState.dragStartX = e.clientX;
        CanvasState.dragState.dragStartY = e.clientY;
        CanvasState.dragState.nodeStartX = section.x;
        CanvasState.dragState.nodeStartY = section.y;
        CanvasState.dragState.dragSource = 'temp-node';

        CanvasState.dragState.wheelScrollEnabled = true;

        element.classList.add('dragging');
        element.style.transition = 'none';

        e.preventDefault();
        e.stopPropagation();
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
    let delay = reason === 'viewport'
        ? CanvasState.dormancyDelays.viewport
        : CanvasState.dormancyDelays.occlusion;

    // [OPT] 动态性能策略：当栏目数量过多 (>50) 时，加速视口外休眠 (15s)，释放资源
    if (reason === 'viewport' && Array.isArray(CanvasState.tempSections) && CanvasState.tempSections.length > 50) {
        delay = 15000;
    }

    // 设置新的定时器
    const timer = setTimeout(() => {
        // 再次检查栏目是否仍然应该休眠
        const element = document.getElementById(sectionId);
        if (element && !section.dormant) {
            section.dormant = true;
            // [MOD] 不再隐藏整个元素，而是只隐藏内容，保留外框可见性
            // element.style.display = 'none';
            element.classList.add('dormant-content');

            const treeContainer = element.querySelector('.temp-bookmark-tree');
            if (treeContainer) {
                // 锁定高度，防止容器塌陷
                const rect = treeContainer.getBoundingClientRect();
                if (rect.height > 0) treeContainer.style.height = rect.height + 'px';

                // 隐藏内容以节省渲染性能
                treeContainer.style.display = 'none';
                treeContainer.dataset.contentHidden = 'true';

                // 兼容逻辑：为了防止重复卸载，这里不再执行 DOM 卸载逻辑
                // 统一使用 display: none 方案，平衡性能与体验
            }
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
    if (!section || !section.id) {
        console.warn('[Canvas休眠] wakeSection: 无效的section');
        return false;
    }

    const sectionId = section.id;

    // 取消休眠定时器
    cancelDormancyTimer(sectionId);

    // 如果已经休眠，立即唤醒
    if (section.dormant) {
        section.dormant = false;
        const element = document.getElementById(sectionId);
        if (element) {
            // [MOD] 元素本身一直可见，只需移除 dormant 类
            // element.style.display = ''; 
            element.classList.remove('dormant-content');

            const treeContainer = element.querySelector('.temp-bookmark-tree');

            // [MOD] 恢复内容显示
            if (treeContainer && treeContainer.dataset.contentHidden === 'true') {
                treeContainer.style.display = '';
                treeContainer.style.height = ''; // 解除高度锁定
                treeContainer.dataset.contentHidden = 'false';
            }

            // [兼容旧逻辑]：如果内容曾被卸载（旧版本或强制刷新导致），则重新渲染
            if (treeContainer && treeContainer.dataset.contentUnloaded === 'true') {
                try {
                    // 重新渲染书签树内容
                    treeContainer.innerHTML = '';
                    treeContainer.dataset.contentUnloaded = 'false';

                    // 检查section.items是否存在
                    if (!section.items || !Array.isArray(section.items)) {
                        console.warn('[Canvas休眠] wakeSection: section.items无效，跳过渲染');
                        return true;
                    }

                    const treeFragment = document.createDocumentFragment();
                    section.items.forEach(item => {
                        try {
                            const node = buildTempTreeNode(section, item, 0, { lazyLoad: true });
                            if (node) treeFragment.appendChild(node);
                        } catch (err) {
                            console.warn('[Canvas休眠] 渲染节点失败:', err);
                        }
                    });
                    treeContainer.appendChild(treeFragment);

                    // 重新绑定事件（使用延迟确保DOM已更新）
                    requestAnimationFrame(() => {
                        try {
                            setupTempSectionTreeInteractions(treeContainer, section);
                            if (typeof attachTreeEvents === 'function') {
                                attachTreeEvents(treeContainer);
                            }
                            if (typeof attachDragEvents === 'function') {
                                attachDragEvents(treeContainer);
                            }
                            if (typeof attachPointerDragEvents === 'function') {
                                attachPointerDragEvents(treeContainer);
                            }
                        } catch (err) {
                            console.warn('[Canvas休眠] 绑定事件失败:', err);
                        }
                    });

                    console.log('[Canvas休眠] 栏目已唤醒并重新渲染:', sectionId);
                } catch (error) {
                    console.error('[Canvas休眠] wakeSection渲染失败:', error);
                    try { renderTempNode(section); } catch (_) { }
                }
            }

            // [LazyLoad/Defense] 检查内容完整性
            // 两种情况会触发这里：
            // 1. 初始化时因为休眠跳过了内容构建（正常懒加载）
            // 2. 运行时发生异常导致 DOM 丢失（防御机制）
            const shouldHaveContent = Array.isArray(section.items) && section.items.length > 0;
            const hasContent = treeContainer && treeContainer.children.length > 0;

            if (shouldHaveContent && !hasContent) {
                // 这是正常的懒加载或恢复流程，使用 Log 而非 Warn
                console.log('[Canvas] 唤醒栏目并构建内容:', sectionId);
                renderTempNode(section);
                return true;
            }
        } else {
            // DOM 节点丢失，强制重绘
            renderTempNode(section);
        }
    }
    return true;
}

// [Defense] 全局防御：点击任何休眠节点都会尝试唤醒
// 放在这里确保只需初始化一次（文件加载时）
if (typeof window !== 'undefined' && !window._canvasDormancyClickAttached) {
    window._canvasDormancyClickAttached = true;
    document.addEventListener('mousedown', (e) => {
        // 检查点击目标是否位于休眠内容中
        const dormantEl = e.target.closest('.dormant-content');
        if (dormantEl && dormantEl.id) {
            const section = getTempSection(dormantEl.id);
            if (section && section.dormant) {
                console.log('[Canvas防御] 点击唤醒休眠节点:', section.id);
                wakeSection(section);
            }
        }
    }, true); // 使用捕获阶段，确保最早触发
}

// 强制唤醒并重新渲染栏目（用于恢复失败时）
function forceWakeAndRender(sectionId) {
    const section = getTempSection(sectionId);
    if (!section) return false;

    section.dormant = false;
    cancelDormancyTimer(sectionId);

    try {
        renderTempNode(section);
        return true;
    } catch (error) {
        console.error('[Canvas休眠] forceWakeAndRender失败:', error);
        return false;
    }
}

// 恢复并优化休眠管理逻辑
function manageSectionDormancy() {
    const workspace = document.getElementById('canvasWorkspace');
    if (!workspace) return;

    // 获取当前性能模式的缓冲区大小
    const currentSettings = CanvasState.performanceSettings[CanvasState.performanceMode];
    // [OPT] 恢复 1500px 缓冲距离，确保离得较远时才休眠，保证正常体验
    const margin = currentSettings ? Math.max(currentSettings.margin, 1500) : 1500;

    // [Fix] 防止 Resize 过程中闪烁：如果最近 300ms 内发生过 Resize，跳过本次更新
    // (Resize 事件本身会触发 updateCanvasScrollBounds -> computeCanvasContentBounds，可能间接触发重绘)
    if (Date.now() - lastResizeTime < 300) {
        return;
    }

    // 无限制模式：不执行休眠
    if (margin === Infinity) {
        CanvasState.tempSections.forEach(section => {
            cancelDormancyTimer(section.id);
            if (section.dormant) {
                wakeSection(section);
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
            wakeSection(section);
            activeCount++;
        } else {
            // [Fix] 交互过程中暂停调度新的休眠，防止快速操作时误判导致闪烁
            // 检测是否正在进行用户交互（滚动、拖动、缩放）
            const isInteracting = isScrolling || CanvasState.isPanning || CanvasState.dragState.isDragging || (workspace.classList.contains('is-zooming'));

            if (!section.dormant) {
                if (!isInteracting) {
                    const timerInfo = CanvasState.dormancyTimers.get(section.id);
                    if (!timerInfo) {
                        scheduleDormancy(section, 'viewport');
                        scheduledCount++;
                        activeCount++;
                    } else {
                        activeCount++;
                    }
                } else {
                    // 交互中：保持唤醒状态，取消可能存在的休眠倒计时
                    const timerInfo = CanvasState.dormancyTimers.get(section.id);
                    if (timerInfo) {
                        cancelDormancyTimer(section.id);
                    }
                    activeCount++;
                }
            } else {
                dormantCount++;
            }
        }
    });
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
    // Remove all edges connected to this section
    removeEdgesForNode(sectionId);

    // 重新计算序号：让剩余栏目的序号连续
    reorderSectionSequenceNumbers();

    saveTempNodes();
    scheduleBoundsUpdate();
    scheduleScrollbarUpdate();

    // 删除后重新管理休眠状态（可能唤醒休眠的栏目）
    scheduleDormancyUpdate();
}

function clearAllTempNodes() {
    const container = document.getElementById('canvasContent');
    if (!container) return;

    const lang = (typeof currentLang === 'string' && currentLang) ? currentLang : 'zh_CN';
    const isEn = lang === 'en' || lang === 'en_US' || lang === 'en-GB' || String(lang).toLowerCase().startsWith('en');
    const text = {
        noneToClear: isEn
            ? 'Nothing to clear (nodes with descriptions, custom titles, or edges are kept).'
            : '没有可清理的未标注节点（有说明、自定义标题或连接线的节点已自动跳过）。',
        confirmTitle: isEn ? 'Confirm' : '确认',
        confirmBody: (tempCount, mdCount) => isEn
            ? `Will clear:\n- ${tempCount} unlabeled temp bookmark section(s) (no description, default title)\n- ${mdCount} empty blank node(s)\n\nNote: nodes with descriptions, custom titles, or edges will be kept.\n\nContinue?`
            : `将清理：\n- ${tempCount} 个未标注的书签型临时栏目（无说明、默认标题）\n- ${mdCount} 个空的「空白栏目」\n\n注：有说明、自定义标题或连接线的节点会被保留。\n\n确定继续吗？`
    };

    const hasEdgeForNode = (nodeId) => {
        if (!nodeId) return false;
        if (!Array.isArray(CanvasState.edges) || !CanvasState.edges.length) return false;
        return CanvasState.edges.some(e => e && (e.fromNode === nodeId || e.toNode === nodeId));
    };

    const isEmptyDesc = (desc) => {
        if (typeof desc !== 'string') return true;
        return desc.trim().length === 0;
    };

    const isEmptyMdNode = (node) => {
        if (!node) return true;
        const t = (typeof node.text === 'string') ? node.text : '';
        return t.replace(/\u200B/g, '').trim().length === 0;
    };

    // 判断标题是否为自动生成的默认格式（用户未修改）
    // 自动生成的标题格式包括：
    // 1. 时间戳格式：YYYY-MM-DD HH:MM:SS
    // 2. 导入书签格式：导入的书签 (X) - 时间 / Imported Bookmarks (X) - 时间
    // 3. 浏览器拖入格式：日期 时间 | X个书签 | 浏览器拖入 / Browser drop
    // 4. 空标题
    const isAutoGeneratedTitle = (title) => {
        if (!title || typeof title !== 'string') return true;
        const t = title.trim();
        if (!t) return true;

        // 时间戳格式：YYYY-MM-DD HH:MM:SS
        if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(t)) return true;

        // 导入书签格式（中文）：导入的书签 (X) - 时间
        if (/^导入的书签\s*\(\d+\)\s*-/.test(t)) return true;

        // 导入书签格式（英文）：Imported Bookmarks (X) - 时间
        if (/^Imported Bookmarks\s*\(\d+\)\s*-/i.test(t)) return true;

        // 浏览器拖入格式：日期 时间 | X个书签 | 浏览器拖入 / Browser drop
        if (/\|\s*\d+\s*(个书签|bookmarks)\s*\|\s*(浏览器拖入|Browser drop)/i.test(t)) return true;

        // 其他情况认为是用户自定义的标题
        return false;
    };

    // 清除「未标注」的临时栏目：
    // - 说明为空
    // - 标题是自动生成的（未被用户修改）
    // - 没有连接线
    // 注：即使有书签内容，只要没有标注也会被清除
    const removableTempIds = CanvasState.tempSections
        .filter(section => section && section.id && isEmptyDesc(section.description) && isAutoGeneratedTitle(section.title) && !hasEdgeForNode(section.id))
        .map(section => section.id);

    const removableMdIds = CanvasState.mdNodes
        .filter(node => node && node.id && isEmptyMdNode(node) && !hasEdgeForNode(node.id))
        .map(node => node.id);

    const removableTempIdSet = new Set(removableTempIds);
    const removableMdIdSet = new Set(removableMdIds);

    const total = removableTempIds.length + removableMdIds.length;
    if (!total) {
        alert(text.noneToClear);
        return;
    }

    if (!confirm(text.confirmBody(removableTempIds.length, removableMdIds.length))) return;

    // 删除 DOM
    removableTempIds.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.remove();
    });
    removableMdIds.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.remove();
    });

    // 删除数据
    CanvasState.tempSections = CanvasState.tempSections.filter(section => section && !removableTempIdSet.has(section.id));
    CanvasState.mdNodes = CanvasState.mdNodes.filter(node => node && !removableMdIdSet.has(node.id));

    // 清理可能的选中态
    if (CanvasState.selectedTempSectionId && removableTempIdSet.has(CanvasState.selectedTempSectionId)) {
        CanvasState.selectedTempSectionId = null;
        try { if (typeof clearTempSelection === 'function') clearTempSelection(); } catch (_) { }
    }
    if (CanvasState.selectedMdNodeId && removableMdIdSet.has(CanvasState.selectedMdNodeId)) {
        CanvasState.selectedMdNodeId = null;
        try { if (typeof clearMdSelection === 'function') clearMdSelection(); } catch (_) { }
    }

    // 重新计算序号：让剩余临时栏目的序号连续
    reorderSectionSequenceNumbers();

    saveTempNodes();
    scheduleBoundsUpdate();
    scheduleScrollbarUpdate();
    scheduleDormancyUpdate();
}

// =============================================================================
// 清除全部（永久栏目除外）
// =============================================================================

function clearAllExceptPermanent() {
    const lang = (typeof currentLang === 'string' && currentLang) ? currentLang : 'zh_CN';
    const isEn = lang === 'en' || lang === 'en_US' || lang === 'en-GB' || String(lang).toLowerCase().startsWith('en');

    const tempCount = CanvasState.tempSections.length;
    const mdCount = CanvasState.mdNodes.length;
    const edgeCount = CanvasState.edges.length;
    const total = tempCount + mdCount;

    if (!total) {
        alert(isEn ? 'Nothing to clear.' : '没有可清理的内容。');
        return;
    }

    const confirmMsg = isEn
        ? `This will clear ALL content except the permanent section:\n\n- ${tempCount} bookmark temp section(s)\n- ${mdCount} blank node(s)\n- ${edgeCount} connection edge(s)\n\nThis action cannot be undone. Continue?`
        : `这将清除除永久栏目外的所有内容：\n\n- ${tempCount} 个书签型临时栏目\n- ${mdCount} 个空白栏目\n- ${edgeCount} 条连接线\n\n此操作不可撤销。确定继续吗？`;

    if (!confirm(confirmMsg)) return;

    // 删除所有临时栏目的DOM
    CanvasState.tempSections.forEach(section => {
        if (section && section.id) {
            const el = document.getElementById(section.id);
            if (el) el.remove();
        }
    });

    // 删除所有空白栏目的DOM
    CanvasState.mdNodes.forEach(node => {
        if (node && node.id) {
            const el = document.getElementById(node.id);
            if (el) el.remove();
        }
    });

    // 清空数据
    CanvasState.tempSections = [];
    CanvasState.mdNodes = [];
    CanvasState.edges = [];

    // 清除连接线选中状态
    CanvasState.selectedEdgeId = null;
    try { if (typeof hideEdgeToolbar === 'function') hideEdgeToolbar(); } catch (_) { }

    // 清理选中态（使用try-catch，因为这些函数可能在其他文件中定义）
    CanvasState.selectedTempSectionId = null;
    CanvasState.selectedMdNodeId = null;
    try { if (typeof clearTempSelection === 'function') clearTempSelection(); } catch (_) { }
    try { if (typeof clearMdSelection === 'function') clearMdSelection(); } catch (_) { }

    // 清空SVG中的所有连接线DOM元素
    const svg = document.querySelector('.canvas-edges');
    if (svg) {
        Array.from(svg.querySelectorAll('.canvas-edge, .canvas-edge-label, .canvas-edge-label-bg, .canvas-edge-hit-area, foreignObject.edge-label-fo')).forEach(el => {
            el.remove();
        });
    }

    // 重新渲染连接线（会清空）
    renderEdges();

    saveTempNodes();
    scheduleBoundsUpdate();
    scheduleScrollbarUpdate();
    scheduleDormancyUpdate();

    const successMsg = isEn
        ? `Cleared ${tempCount} temp section(s), ${mdCount} blank node(s), and ${edgeCount} edge(s).`
        : `已清除 ${tempCount} 个临时栏目、${mdCount} 个空白栏目和 ${edgeCount} 条连接线。`;
    showCanvasToast(successMsg, 'success');
}

// =============================================================================
// 点击清除模式
// =============================================================================

// 点击清除模式状态
let clickToClearModeActive = false;
let clickToClearSelectedIds = new Set();

function startClickToClearMode() {
    const lang = (typeof currentLang === 'string' && currentLang) ? currentLang : 'zh_CN';
    const isEn = lang === 'en' || lang === 'en_US' || lang === 'en-GB' || String(lang).toLowerCase().startsWith('en');

    const tempCount = CanvasState.tempSections.length;
    const mdCount = CanvasState.mdNodes.length;

    if (!tempCount && !mdCount) {
        alert(isEn ? 'No items to clear.' : '没有可清理的项目。');
        return;
    }

    clickToClearModeActive = true;
    clickToClearSelectedIds = new Set();

    // 添加模式标识到画布
    const workspace = document.getElementById('canvasWorkspace');
    if (workspace) {
        workspace.classList.add('click-to-clear-mode');
    }

    // 为所有临时栏目和空白栏目添加点击选择监听
    addClickToClearListeners();

    // 显示浮动工具栏
    showClickToClearToolbar();
}

function addClickToClearListeners() {
    // 为临时栏目添加点击监听
    CanvasState.tempSections.forEach(section => {
        if (!section || !section.id) return;
        const el = document.getElementById(section.id);
        if (!el) return;
        el.classList.add('click-to-clear-selectable');
        el.addEventListener('click', handleClickToClearSelect, true);
    });

    // 为空白栏目添加点击监听
    CanvasState.mdNodes.forEach(node => {
        if (!node || !node.id) return;
        const el = document.getElementById(node.id);
        if (!el) return;
        el.classList.add('click-to-clear-selectable');
        el.addEventListener('click', handleClickToClearSelect, true);
    });
}

function handleClickToClearSelect(e) {
    if (!clickToClearModeActive) return;

    e.preventDefault();
    e.stopPropagation();

    const el = e.currentTarget;
    const id = el.id;

    if (clickToClearSelectedIds.has(id)) {
        clickToClearSelectedIds.delete(id);
        el.classList.remove('click-to-clear-selected');
    } else {
        clickToClearSelectedIds.add(id);
        el.classList.add('click-to-clear-selected');
    }

    // 更新工具栏计数
    updateClickToClearToolbar();
}

function showClickToClearToolbar() {
    const lang = (typeof currentLang === 'string' && currentLang) ? currentLang : 'zh_CN';
    const isEn = lang === 'en' || lang === 'en_US' || lang === 'en-GB' || String(lang).toLowerCase().startsWith('en');

    // 移除已有的工具栏
    const existing = document.getElementById('clickToClearToolbar');
    if (existing) existing.remove();

    const toolbar = document.createElement('div');
    toolbar.id = 'clickToClearToolbar';
    toolbar.className = 'click-to-clear-toolbar';
    toolbar.innerHTML = `
        <div class="click-to-clear-toolbar-content">
            <span class="click-to-clear-hint">
                <i class="fas fa-mouse-pointer"></i>
                <span id="clickToClearHintText">${isEn ? 'Click items to select, then confirm to delete' : '点击选择要清除的项目，然后确认删除'}</span>
            </span>
            <span class="click-to-clear-count">
                <span id="clickToClearCountText">${isEn ? 'Selected' : '已选择'}:</span>
                <span id="clickToClearCountNum">0</span>
            </span>
            <div class="click-to-clear-actions">
                <button class="click-to-clear-btn select-all" id="clickToClearSelectAllBtn">
                    <i class="fas fa-check-double"></i>
                    <span>${isEn ? 'Select All' : '全选'}</span>
                </button>
                <button class="click-to-clear-btn confirm" id="clickToClearConfirmBtn" disabled>
                    <i class="fas fa-trash-alt"></i>
                    <span>${isEn ? 'Delete' : '删除'}</span>
                </button>
                <button class="click-to-clear-btn cancel" id="clickToClearCancelBtn">
                    <i class="fas fa-times"></i>
                    <span>${isEn ? 'Cancel' : '取消'}</span>
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(toolbar);

    // 绑定事件
    document.getElementById('clickToClearSelectAllBtn').addEventListener('click', selectAllForClickToClear);
    document.getElementById('clickToClearConfirmBtn').addEventListener('click', confirmClickToClear);
    document.getElementById('clickToClearCancelBtn').addEventListener('click', cancelClickToClearMode);
}

function updateClickToClearToolbar() {
    const countEl = document.getElementById('clickToClearCountNum');
    const confirmBtn = document.getElementById('clickToClearConfirmBtn');

    if (countEl) {
        countEl.textContent = clickToClearSelectedIds.size;
    }

    if (confirmBtn) {
        confirmBtn.disabled = clickToClearSelectedIds.size === 0;
    }
}

function selectAllForClickToClear() {
    // 选择所有临时栏目
    CanvasState.tempSections.forEach(section => {
        if (!section || !section.id) return;
        const el = document.getElementById(section.id);
        if (!el) return;
        clickToClearSelectedIds.add(section.id);
        el.classList.add('click-to-clear-selected');
    });

    // 选择所有空白栏目
    CanvasState.mdNodes.forEach(node => {
        if (!node || !node.id) return;
        const el = document.getElementById(node.id);
        if (!el) return;
        clickToClearSelectedIds.add(node.id);
        el.classList.add('click-to-clear-selected');
    });

    updateClickToClearToolbar();
}

function confirmClickToClear() {
    const lang = (typeof currentLang === 'string' && currentLang) ? currentLang : 'zh_CN';
    const isEn = lang === 'en' || lang === 'en_US' || lang === 'en-GB' || String(lang).toLowerCase().startsWith('en');

    const count = clickToClearSelectedIds.size;
    if (!count) return;

    // 移除已有的确认弹窗
    const existingPopup = document.getElementById('clickToClearConfirmPopup');
    if (existingPopup) existingPopup.remove();

    // 获取删除按钮的位置
    const confirmBtn = document.getElementById('clickToClearConfirmBtn');
    if (!confirmBtn) return;

    const btnRect = confirmBtn.getBoundingClientRect();

    // 创建确认弹窗
    const popup = document.createElement('div');
    popup.id = 'clickToClearConfirmPopup';
    popup.className = 'click-to-clear-confirm-popup';
    popup.style.left = `${btnRect.left + btnRect.width / 2}px`;
    popup.style.bottom = `${window.innerHeight - btnRect.top + 8}px`;

    popup.innerHTML = `
        <div class="click-to-clear-confirm-content">
            <div class="click-to-clear-confirm-icon">
                <i class="fas fa-exclamation-triangle"></i>
            </div>
            <div class="click-to-clear-confirm-text">
                ${isEn ? `Delete ${count} selected item(s)?` : `删除选中的 ${count} 个项目？`}
            </div>
            <div class="click-to-clear-confirm-hint">
                ${isEn ? 'This action cannot be undone.' : '此操作不可撤销'}
            </div>
            <div class="click-to-clear-confirm-actions">
                <button class="click-to-clear-confirm-btn cancel" id="clickToClearPopupCancelBtn">
                    ${isEn ? 'Cancel' : '取消'}
                </button>
                <button class="click-to-clear-confirm-btn delete" id="clickToClearPopupDeleteBtn">
                    <i class="fas fa-trash-alt"></i>
                    ${isEn ? 'Delete' : '删除'}
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(popup);

    // 绑定事件
    document.getElementById('clickToClearPopupCancelBtn').addEventListener('click', () => {
        popup.remove();
    });

    document.getElementById('clickToClearPopupDeleteBtn').addEventListener('click', () => {
        popup.remove();
        executeClickToClearDeletion();
    });

    // 点击弹窗外部关闭
    const handleOutsideClick = (e) => {
        if (!popup.contains(e.target) && e.target !== confirmBtn) {
            popup.remove();
            document.removeEventListener('click', handleOutsideClick);
        }
    };
    // 延迟添加监听器，避免立即触发
    setTimeout(() => {
        document.addEventListener('click', handleOutsideClick);
    }, 100);
}

// 实际执行删除操作
function executeClickToClearDeletion() {
    const lang = (typeof currentLang === 'string' && currentLang) ? currentLang : 'zh_CN';
    const isEn = lang === 'en' || lang === 'en_US' || lang === 'en-GB' || String(lang).toLowerCase().startsWith('en');

    const count = clickToClearSelectedIds.size;
    const selectedIdSet = new Set(clickToClearSelectedIds);

    // 删除选中的临时栏目
    const removedTempIds = [];
    CanvasState.tempSections.forEach(section => {
        if (section && section.id && selectedIdSet.has(section.id)) {
            removedTempIds.push(section.id);
            const el = document.getElementById(section.id);
            if (el) el.remove();
        }
    });
    CanvasState.tempSections = CanvasState.tempSections.filter(s => s && !selectedIdSet.has(s.id));

    // 删除选中的空白栏目
    const removedMdIds = [];
    CanvasState.mdNodes.forEach(node => {
        if (node && node.id && selectedIdSet.has(node.id)) {
            removedMdIds.push(node.id);
            const el = document.getElementById(node.id);
            if (el) el.remove();
        }
    });
    CanvasState.mdNodes = CanvasState.mdNodes.filter(n => n && !selectedIdSet.has(n.id));

    // 删除相关的连接线
    CanvasState.edges = CanvasState.edges.filter(edge => {
        if (!edge) return false;
        return !selectedIdSet.has(edge.fromNode) && !selectedIdSet.has(edge.toNode);
    });

    // 清理选中态
    if (CanvasState.selectedTempSectionId && selectedIdSet.has(CanvasState.selectedTempSectionId)) {
        CanvasState.selectedTempSectionId = null;
        try { if (typeof clearTempSelection === 'function') clearTempSelection(); } catch (_) { }
    }
    if (CanvasState.selectedMdNodeId && selectedIdSet.has(CanvasState.selectedMdNodeId)) {
        CanvasState.selectedMdNodeId = null;
        try { if (typeof clearMdSelection === 'function') clearMdSelection(); } catch (_) { }
    }

    // 重新计算序号
    reorderSectionSequenceNumbers();

    // 清除连接线选中状态
    CanvasState.selectedEdgeId = null;
    try { if (typeof hideEdgeToolbar === 'function') hideEdgeToolbar(); } catch (_) { }

    // 重新渲染连接线
    renderEdges();

    saveTempNodes();
    scheduleBoundsUpdate();
    scheduleScrollbarUpdate();
    scheduleDormancyUpdate();

    // 退出模式
    cancelClickToClearMode();

    const successMsg = isEn
        ? `Deleted ${count} item(s).`
        : `已删除 ${count} 个项目。`;
    showCanvasToast(successMsg, 'success');
}

function cancelClickToClearMode() {
    clickToClearModeActive = false;

    // 移除模式标识
    const workspace = document.getElementById('canvasWorkspace');
    if (workspace) {
        workspace.classList.remove('click-to-clear-mode');
    }

    // 移除所有选中状态和监听器
    CanvasState.tempSections.forEach(section => {
        if (!section || !section.id) return;
        const el = document.getElementById(section.id);
        if (!el) return;
        el.classList.remove('click-to-clear-selectable', 'click-to-clear-selected');
        el.removeEventListener('click', handleClickToClearSelect, true);
    });

    CanvasState.mdNodes.forEach(node => {
        if (!node || !node.id) return;
        const el = document.getElementById(node.id);
        if (!el) return;
        el.classList.remove('click-to-clear-selectable', 'click-to-clear-selected');
        el.removeEventListener('click', handleClickToClearSelect, true);
    });

    // 移除工具栏
    const toolbar = document.getElementById('clickToClearToolbar');
    if (toolbar) toolbar.remove();

    clickToClearSelectedIds.clear();
}

// 重新计算所有临时栏目的序号，使其连续
function reorderSectionSequenceNumbers() {
    // 按当前序号排序
    const sortedSections = CanvasState.tempSections
        .filter(s => s.sequenceNumber) // 只处理有序号的
        .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

    // 重新分配序号 1, 2, 3, ...（显示为 A, B, C, ...）
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
                    applyTempSectionBadge(badge, getTempSectionLabel(section));
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
    const _editBtnEl = document.getElementById('permanentSectionTipEditBtn');
    if (_editBtnEl) _editBtnEl.remove();
    const editBtn = null; // 移除编辑按钮引用

    const tipText = document.getElementById('permanentSectionTip');
    const tipContainer = document.getElementById('permanentSectionTipContainer');

    if (!closeBtn || !tipContainer || !tipText) {
        console.warn('[Canvas] 找不到提示相关元素');
        return;
    }

    // 说明栏改为「空白栏目」同款：contenteditable + 格式工具栏 + 实时渲染
    tipText.classList.add('md-wysiwyg-editor');
    tipText.contentEditable = 'false';
    tipText.spellcheck = false;
    tipText.style.cursor = 'pointer';

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

    // 检查是否已经关闭过 - LEGACY: Now acts as Clear button, input always open
    tipContainer.classList.remove('collapsed');

    // 多语言占位文本
    const getPlaceholderText = () => {
        const lang = typeof currentLang !== 'undefined' ? currentLang : 'zh';
        return lang === 'en' ? 'Click to add description...' : '点击添加说明...';
    };

    const getEditTitle = () => {
        const lang = typeof currentLang !== 'undefined' ? currentLang : 'zh';
        return lang === 'en' ? 'Click to edit' : '点击编辑说明';
    };
    const getAddTitle = () => {
        const lang = typeof currentLang !== 'undefined' ? currentLang : 'zh';
        return lang === 'en' ? 'Click to add description' : '点击添加说明';
    };

    const applyPlaceholder = () => {
        const ph = getPlaceholderText();
        tipText.setAttribute('data-placeholder', ph);
        tipText.setAttribute('aria-label', ph);
    };

    // 加载保存的说明文字并渲染（空内容显示占位提示）
    const savedTipRaw = (() => {
        try { return localStorage.getItem('canvas-permanent-tip-text') || ''; } catch (_) { return ''; }
    })();
    const savedTipHtml = __normalizeCanvasRichHtml(__coerceDescriptionSourceToHtml(savedTipRaw));
    tipText.innerHTML = savedTipHtml;
    try { __applyHeadingCollapse(tipText); } catch (_) { }
    applyPlaceholder();

    const updateTipMeta = () => {
        const html = __normalizeCanvasRichHtml(tipText.innerHTML);
        tipText.title = html ? getEditTitle() : getAddTitle();
    };
    updateTipMeta();

    const tipControls = tipContainer.querySelector('.permanent-section-tip-controls');
    if (tipControls) {
        tipControls.style.opacity = '0'; // 默认隐藏
        tipControls.style.pointerEvents = 'none';
        tipControls.style.transition = 'opacity 0.2s';
    }

    let formatBtn = tipControls ? tipControls.querySelector('.permanent-section-tip-format-btn') : null;
    if (tipControls && !formatBtn) {
        formatBtn = document.createElement('button');
        formatBtn.type = 'button';
        formatBtn.className = 'permanent-section-tip-format-btn';
        const label = (typeof currentLang !== 'undefined' && currentLang === 'en') ? 'Format toolbar' : '格式工具栏';
        formatBtn.title = label;
        formatBtn.setAttribute('aria-label', label);
        formatBtn.setAttribute('data-action', 'md-format-toggle');
        formatBtn.innerHTML = '<i class="fas fa-font"></i>';
        tipControls.insertBefore(formatBtn, closeBtn);
    }

    // Change Close button to Clear button
    closeBtn.innerHTML = '<i class="fas fa-times"></i>';
    const clearLabel = (typeof currentLang !== 'undefined' && currentLang === 'en') ? 'Clear input' : '清空输入框';
    closeBtn.title = clearLabel;
    closeBtn.setAttribute('aria-label', clearLabel);

    // Replace closeBtn to remove old listeners
    const newCloseBtn = closeBtn.cloneNode(true);
    closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);

    let isEditingTip = false;
    let beforeEditStored = savedTipRaw;

    const persistTip = ({ normalizeEditorHtml = false } = {}) => {
        const normalized = __normalizeCanvasRichHtml(__getCleanHtmlForStorage(tipText));
        try {
            if (normalized) localStorage.setItem('canvas-permanent-tip-text', normalized);
            else localStorage.removeItem('canvas-permanent-tip-text');
        } catch (_) { }
        if (normalizeEditorHtml) {
            tipText.innerHTML = normalized;
        }
        updateTipMeta();
    };

    const exitEditingTip = ({ commit }) => {
        if (!isEditingTip) return;
        isEditingTip = false;
        tipContainer.classList.remove('editing');
        tipText.contentEditable = 'false';

        if (commit) {
            try {
                if (typeof tipEditorApi !== 'undefined' && tipEditorApi && typeof tipEditorApi.flush === 'function') tipEditorApi.flush();
            } catch (_) { }
            persistTip({ normalizeEditorHtml: true });
        } else {
            const restored = __normalizeCanvasRichHtml(__coerceDescriptionSourceToHtml(beforeEditStored));
            tipText.innerHTML = restored;
            try {
                if (beforeEditStored) localStorage.setItem('canvas-permanent-tip-text', beforeEditStored);
                else localStorage.removeItem('canvas-permanent-tip-text');
            } catch (_) { }
            updateTipMeta();
        }

        if (tipControls) {
            tipControls.style.opacity = '0';
            tipControls.style.pointerEvents = 'none';
        }

        try {
            if (typeof tipEditorApi !== 'undefined' && tipEditorApi) {
                tipEditorApi.closeAllPopovers();
                if (typeof tipEditorApi.clearUndoHistory === 'function') tipEditorApi.clearUndoHistory();
            }
        } catch (_) { }
    };

    const enterEditingTip = () => {
        if (isEditingTip) return;
        isEditingTip = true;
        try { beforeEditStored = localStorage.getItem('canvas-permanent-tip-text') || ''; } catch (_) { beforeEditStored = ''; }

        tipContainer.classList.add('editing');
        tipText.contentEditable = 'true';
        tipText.focus();
        __placeCaretAtEnd(tipText);

        if (typeof tipEditorApi !== 'undefined' && tipEditorApi && typeof tipEditorApi.recordSnapshot === 'function') {
            tipEditorApi.recordSnapshot('init');
        }

        if (tipControls) {
            tipControls.style.opacity = '1';
            tipControls.style.pointerEvents = 'auto';
        }
    };

    // Events
    tipText.addEventListener('click', (e) => {
        if (isEditingTip) return;
        e.preventDefault();
        e.stopPropagation();
        enterEditingTip();
    });

    newCloseBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        tipText.innerHTML = '';
        try { localStorage.removeItem('canvas-permanent-tip-text'); } catch (_) { }
        updateTipMeta();
        if (isEditingTip) {
            tipText.focus();
        }
    });

    tipText.addEventListener('keydown', (e) => {
        if (!isEditingTip) return;
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            exitEditingTip({ commit: true });
        } else if (e.key === 'Escape') {
            e.preventDefault();
            exitEditingTip({ commit: false });
        }
    });

    tipText.addEventListener('blur', () => {
        if (!isEditingTip) return;
        exitEditingTip({ commit: true });
    });

    // 复制时转换为 Markdown 源码格式（而非渲染后的富文本）
    tipText.addEventListener('copy', (e) => {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return;

        const range = selection.getRangeAt(0);
        const container = document.createElement('div');
        container.appendChild(range.cloneContents());
        const selectedHtml = container.innerHTML;

        const isAll = __isSelectionAll(tipText, selection);
        const htmlSource = isAll ? __getCleanHtmlForStorage(tipText) : selectedHtml;
        if (!htmlSource) return;

        const markdownSource = __htmlToMarkdown(htmlSource);

        // 智能优化：选中整行自动补充 Markdown 符号
        let finalSource = markdownSource;
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const commonAncestor = range.commonAncestorContainer;
            const blockEl = (commonAncestor.nodeType === 1 ? commonAncestor : commonAncestor.parentNode).closest('li, h1, h2, h3, h4, h5, h6, blockquote');
            if (blockEl && tipText.contains(blockEl)) {
                const blockText = blockEl.textContent.trim();
                const selectedText = selection.toString().trim();
                if (blockText && selectedText && blockText === selectedText) {
                    const tag = blockEl.tagName;
                    if (tag === 'LI') {
                        const parent = blockEl.parentElement;
                        if (parent && parent.tagName === 'OL') {
                            const index = Array.from(parent.children).indexOf(blockEl) + 1;
                            finalSource = `${index}. ${finalSource}`;
                        } else {
                            finalSource = (blockEl.classList.contains('md-task-item'))
                                ? `- ${blockEl.querySelector('input') && blockEl.querySelector('input').checked ? '[x]' : '[ ]'} ${finalSource}`
                                : `- ${finalSource}`;
                        }
                    } else if (tag === 'H1') finalSource = `# ${finalSource}`;
                    else if (tag === 'H2') finalSource = `## ${finalSource}`;
                    else if (tag === 'H3') finalSource = `### ${finalSource}`;
                    else if (tag === 'BLOCKQUOTE') finalSource = `> ${finalSource}`;
                }
            }
        }

        const safeHtml = __normalizeCanvasRichHtml(htmlSource);
        if (safeHtml) {
            try { e.clipboardData.setData('text/html', safeHtml); } catch (_) { }
            try { e.clipboardData.setData('application/x-bookmark-canvas-html', safeHtml); } catch (_) { }
        }

        e.preventDefault();
        e.clipboardData.setData('text/plain', finalSource);
        // 移除 HTML 格式
        // e.clipboardData.setData('text/html', selectedHtml);
    });

    if (tipControls) {
        tipControls.addEventListener('mousedown', (e) => {
            if (!isEditingTip) return;
            if (e.target.closest('button')) e.preventDefault();
        });
    }

    const tipEditorApi = __mountMdCloneDescriptionEditor({
        editor: tipText,
        toolbar: tipControls || tipContainer,
        formatToggleBtn: formatBtn || newCloseBtn,
        isEditing: () => isEditingTip,
        enterEdit: enterEditingTip,
        save: () => {
            if (!isEditingTip) return;
            persistTip({ normalizeEditorHtml: false });
        },
        nodeId: 'permanentSection'
    });
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
            // 不调用 refreshBookmarkTree()，让 onCreated 事件触发增量更新
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
    // 初始蒙版同步
    refreshSectionCtrlOverlays();

    // Ctrl 按下/松开切换专属模式
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Control') {
            setSectionCtrlModeActive(true);
        }
    });
    document.addEventListener('keyup', (e) => {
        if (e.key === 'Control') {
            setSectionCtrlModeActive(false);
        }
    });
    window.addEventListener('blur', () => setSectionCtrlModeActive(false));

    // Ctrl 尺寸调整
    document.addEventListener('mousemove', (e) => {
        if (CanvasState.sectionCtrlMode && CanvasState.sectionCtrlMode.resize && CanvasState.sectionCtrlMode.resize.active) {
            applyCtrlResize(e.clientX, e.clientY);
            // Update connected edges in real-time during resize
            renderEdges();
            e.preventDefault();
            e.stopPropagation();
            return;
        }
    }, true);

    // 鼠标移动 - 拖动节点/永久栏目
    document.addEventListener('mousemove', (e) => {
        if (!CanvasState.dragState.isDragging || !CanvasState.dragState.draggedElement) return;
        if (CanvasState.dragState.dragSource !== 'temp-node' && CanvasState.dragState.dragSource !== 'permanent-section') {
            return;
        }

        // 标记正在拖动/滚动
        markScrolling();

        const handled = updateActiveDragPosition(e.clientX, e.clientY);
        if (handled) {
            e.preventDefault();
            // Update connected edges in real-time during drag
            renderEdges();
        }

        // 检查是否接近边缘，启动自动滚动
        checkEdgeAutoScroll(e.clientX, e.clientY);
    }, false);

    // 鼠标释放
    document.addEventListener('mouseup', (e) => {
        // Ctrl 缩放使用“第二次右键结束”，因此 mouseup 不结束，防止首右键立即结束
        if (CanvasState.sectionCtrlMode && CanvasState.sectionCtrlMode.resize && CanvasState.sectionCtrlMode.resize.active && e.button === 2) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        if (!CanvasState.dragState.isDragging || !CanvasState.dragState.draggedElement) {
            return;
        }

        if (CanvasState.dragState.dragSource === 'temp-node') {
            finalizeTempNodeDrag();
        } else if (CanvasState.dragState.dragSource === 'permanent-section') {
            finalizePermanentSectionDrag();
        }

        CanvasState.dragState.isDragging = false;
        CanvasState.dragState.draggedElement = null;
        CanvasState.dragState.dragSource = null;
        CanvasState.dragState.wheelScrollEnabled = false;
        CanvasState.dragState.childElements = []; // 清空子元素数组，避免后续拖动时仍带着子节点

        // 停止自动滚动
        stopEdgeAutoScroll();

        // 拖动停止后，触发完整更新
        onScrollStop();
    }, false);

    // 工具栏按钮
    const importBtn = document.getElementById('importCanvasBtn');
    const exportBtn = document.getElementById('exportCanvasBtn');

    if (importBtn) importBtn.addEventListener('click', showImportDialog);
    if (exportBtn) exportBtn.addEventListener('click', exportCanvas);

    // 清除菜单按钮 - 显示/隐藏下拉菜单
    const clearMenuBtn = document.getElementById('clearMenuBtn');
    const clearDropdown = document.getElementById('canvasClearDropdown');
    const clearDropdownMenu = document.getElementById('clearDropdownMenu');

    if (clearMenuBtn && clearDropdownMenu && clearDropdown) {
        clearMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = clearDropdownMenu.style.display === 'block';
            clearDropdownMenu.style.display = isVisible ? 'none' : 'block';
            clearDropdown.classList.toggle('open', !isVisible);
        });

        // 点击下拉菜单内部不关闭（除非点击的是菜单项）
        clearDropdownMenu.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // 点击其他地方关闭菜单
        document.addEventListener('click', (e) => {
            if (!clearDropdown.contains(e.target)) {
                clearDropdownMenu.style.display = 'none';
                clearDropdown.classList.remove('open');
            }
        });
    }

    // 清空未标注节点按钮 (原有功能)
    const clearBtn = document.getElementById('clearTempNodesBtn');
    if (clearBtn) clearBtn.addEventListener('click', clearAllTempNodes);

    // 清除规则帮助按钮 - 点击显示提示框
    const clearHelpBtn = document.getElementById('clearTempNodesHelpBtn');
    const clearRulesTooltip = document.getElementById('clearRulesTooltip');
    if (clearHelpBtn && clearRulesTooltip) {
        // 点击帮助按钮切换显示/隐藏
        clearHelpBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = clearRulesTooltip.style.display === 'block';
            clearRulesTooltip.style.display = isVisible ? 'none' : 'block';
        });

        // 点击提示框内部不关闭
        clearRulesTooltip.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // 点击其他地方关闭提示框
        document.addEventListener('click', (e) => {
            if (!clearHelpBtn.contains(e.target) && !clearRulesTooltip.contains(e.target)) {
                clearRulesTooltip.style.display = 'none';
            }
        });
    }

    // 点击清除按钮
    const clearByClickBtn = document.getElementById('clearByClickBtn');
    if (clearByClickBtn) {
        clearByClickBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // 关闭下拉菜单
            if (clearDropdownMenu) {
                clearDropdownMenu.style.display = 'none';
                clearDropdown.classList.remove('open');
            }
            // 启动点击清除模式
            startClickToClearMode();
        });
    }

    // 清除全部按钮
    const clearAllBtn = document.getElementById('clearAllBtn');
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // 关闭下拉菜单
            if (clearDropdownMenu) {
                clearDropdownMenu.style.display = 'none';
                clearDropdown.classList.remove('open');
            }
            // 执行清除全部
            clearAllExceptPermanent();
        });
    }

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

            // 【修复】检查双击位置是否被其他栏目遮挡（在栏目下方）
            // 使用 elementFromPoint 检测双击位置的最顶层元素
            const elementAtPoint = document.elementFromPoint(e.clientX, e.clientY);
            if (!elementAtPoint) return;

            // 如果最顶层元素是某个栏目或其内部元素，说明被遮挡，不生成空白栏目
            const isBlockedByTemp = !!elementAtPoint.closest('.temp-canvas-node');
            const isBlockedByPermanent = !!elementAtPoint.closest('#permanentSection');
            const isBlockedByMd = !!elementAtPoint.closest('.md-canvas-node');
            if (isBlockedByTemp || isBlockedByPermanent || isBlockedByMd) {
                console.log('[Canvas] 双击位置被栏目遮挡，不生成空白栏目');
                return;
            }

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
    const { isEn } = __getLang();
    // 创建导入对话框
    const dialog = document.createElement('div');
    dialog.className = 'import-dialog';
    dialog.id = 'canvasImportDialog';

    dialog.innerHTML = `
        <div class="import-dialog-content">
            <div class="import-dialog-header">
                <h3>${isEn ? 'Import' : '导入'}</h3>
                <button class="import-dialog-close" id="closeImportDialog">&times;</button>
            </div>
            <div class="import-dialog-body">
                <div class="import-options">
                    <div class="import-section-label">${isEn ? '📦 Canvas Snapshot' : '📦 画布快照'}</div>
                    <button class="import-option-btn" id="importCanvasZipBtn">
                        <i class="fas fa-file-archive" style="font-size: 24px;"></i>
                        <span>${isEn ? 'Import Archive (.zip / .7z)' : '导入压缩包 (.zip / .7z)'}</span>
                    </button>
                    <button class="import-option-btn" id="importCanvasFolderBtn">
                        <i class="fas fa-folder-open" style="font-size: 24px;"></i>
                        <span>${isEn ? 'Import Folder' : '导入文件夹快照'}</span>
                    </button>
                    <button class="import-option-btn" id="importCanvasJsonBtn">
                        <i class="fas fa-file-code" style="font-size: 24px;"></i>
                        <span>${isEn ? 'Import JSON (.json)' : '导入 JSON 快照 (.json)'}</span>
                    </button>
                    <div class="import-section-label" style="margin-top: 16px;">${isEn ? '📑 Bookmarks (to Temp Section)' : '📑 书签文件（导入为临时栏目）'}</div>
                    <button class="import-option-btn" id="importHtmlBtn">
                        <i class="fas fa-file-code" style="font-size: 24px;"></i>
                        <span>${isEn ? 'Import HTML Bookmarks' : '导入 HTML 书签'}</span>
                    </button>
                    <button class="import-option-btn" id="importJsonBtn">
                        <i class="fas fa-file-code" style="font-size: 24px;"></i>
                        <span>${isEn ? 'Import JSON Bookmarks' : '导入 JSON 书签'}</span>
                    </button>
                </div>
                <input type="file" id="canvasFileInput" accept=".zip,.7z,.html,.json" style="display: none;">
                <input type="file" id="canvasFolderInput" webkitdirectory directory style="display: none;">
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

    document.getElementById('importCanvasZipBtn').addEventListener('click', () => {
        const input = document.getElementById('canvasFileInput');
        // 支持 ZIP 和 7z 压缩包
        input.accept = '.zip,.7z';
        input.dataset.type = 'package-archive';
        input.click();
    });

    // 文件夹导入按钮
    document.getElementById('importCanvasFolderBtn').addEventListener('click', () => {
        const input = document.getElementById('canvasFolderInput');
        input.click();
    });

    // JSON 快照导入按钮
    document.getElementById('importCanvasJsonBtn').addEventListener('click', () => {
        const input = document.getElementById('canvasFileInput');
        input.accept = '.json';
        input.dataset.type = 'package-json';
        input.click();
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
    document.getElementById('canvasFolderInput').addEventListener('change', handleFolderImport);
}

async function handleFileImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    const type = e.target.dataset.type;

    try {
        if (type === 'package-archive' || type === 'package-json') {
            const { isEn } = __getLang();
            const ok = confirm(isEn
                ? 'Importing a canvas package will add content to the current canvas (sandboxed). Continue?'
                : '导入画布包会将内容添加到当前画布（沙箱模式）。确定继续吗？');
            if (!ok) {
                e.target.value = '';
                return;
            }

            if (type === 'package-archive') {
                // 根据文件扩展名选择处理方式
                const fileName = file.name.toLowerCase();
                if (fileName.endsWith('.zip')) {
                    await importCanvasPackageZip(file);
                } else if (fileName.endsWith('.7z')) {
                    await importCanvasPackage7z(file);
                } else {
                    throw new Error(isEn
                        ? 'Unsupported archive format. Please use .zip or .7z file.'
                        : '不支持的压缩格式。请使用 .zip 或 .7z 文件。');
                }
            } else if (type === 'package-json') {
                // JSON 单文件处理
                await importCanvasPackageJson(file);
            }
        } else {
            const text = await file.text();
            if (type === 'html') {
                await importHtmlBookmarks(text);
            } else {
                await importJsonBookmarks(text);
            }
        }

        document.getElementById('canvasImportDialog').remove();
        // 成功提示已在各导入函数中显示，这里不再重复
    } catch (error) {
        console.error('[Canvas] 导入失败:', error);
        const { isEn } = __getLang();
        showCanvasToast((isEn ? 'Import failed: ' : '导入失败: ') + (error && error.message ? error.message : error), 'error');
    }

    e.target.value = '';
}

/**
 * 处理文件夹导入
 * 支持导入已解压的画布快照文件夹
 */
async function handleFolderImport(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const { isEn } = __getLang();

    try {

        // 将文件列表转换为 Map<相对路径, 内容>
        const folderName = files[0].webkitRelativePath.split('/')[0];
        const folderFiles = new Map();

        for (const file of files) {
            // 获取相对路径（去掉根文件夹名）
            const relativePath = file.webkitRelativePath;
            const content = new Uint8Array(await file.arrayBuffer());
            folderFiles.set(relativePath, content);
        }

        await importCanvasPackageFolder(folderFiles, folderName);

        document.getElementById('canvasImportDialog').remove();
    } catch (error) {
        console.error('[Canvas] 文件夹导入失败:', error);
        showCanvasToast((isEn ? 'Import failed: ' : '导入失败: ') + (error && error.message ? error.message : error), 'error');
    }

    e.target.value = '';
}

/**
 * 3.4 格式适配器：导入 JSON 单文件
 * 直接读取并校验是否为合法的 Canvas State JSON
 */
async function importCanvasPackageJson(file) {
    const { isEn } = __getLang();
    const text = await file.text();
    let primaryState;

    try {
        primaryState = JSON.parse(text);
    } catch (parseErr) {
        throw new Error(isEn
            ? 'Invalid JSON format.'
            : 'JSON 格式无效。');
    }

    // 校验是否为合法的 Canvas State JSON
    const isValidCanvasState = (
        primaryState &&
        primaryState.exporter === 'bookmark-backup-canvas' &&
        (primaryState.storage || primaryState.canvasState)
    );

    if (!isValidCanvasState) {
        throw new Error(isEn
            ? 'This JSON file is not a valid Bookmark Canvas backup file.'
            : '此 JSON 文件不是有效的书签画布备份文件。');
    }

    const isBackupMode = primaryState.exportVersion === 2 && primaryState.canvasState;
    console.log(`[Canvas] JSON Import using ${isBackupMode ? 'BACKUP' : 'FULL'} mode`);

    const storage = primaryState.storage || {};

    // 提取 tempState
    let tempState = null;
    if (isBackupMode && primaryState.canvasState) {
        tempState = {
            sections: primaryState.canvasState.tempSections || [],
            mdNodes: primaryState.canvasState.mdNodes || [],
            edges: primaryState.canvasState.edges || [],
            tempSectionCounter: primaryState.canvasState.tempSectionCounter || 0,
            mdNodeCounter: primaryState.canvasState.mdNodeCounter || 0,
            edgeCounter: primaryState.canvasState.edgeCounter || 0
        };
    } else {
        tempState = storage[TEMP_SECTION_STORAGE_KEY] || null;
    }

    if (!tempState) {
        throw new Error(isEn ? 'Invalid package state.' : '导入包状态无效');
    }

    // 复用 zip 导入的后续逻辑
    __processSandboxedImport(tempState, storage, primaryState, file.name);
}

/**
 * 导入 HTML 书签文件（支持 Netscape Bookmark 格式及通用 HTML）
 * 
 * 支持的格式：
 * 1. Netscape Bookmark 格式（<!DOCTYPE NETSCAPE-Bookmark-file-1>）
 *    - Chrome、Firefox、Edge、Safari 等浏览器导出的标准格式
 *    - 保留完整的文件夹层级结构
 *    - 解析 <DL>/<DT>/<H3>/<A> 标签
 * 2. 通用 HTML 格式
 *    - 任何包含 <a href> 链接的 HTML 文件
 *    - 扁平化提取所有链接
 */
async function importHtmlBookmarks(html) {
    const { isEn } = __getLang();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // 检测是否为 Netscape Bookmark 格式（通过 DOCTYPE 或结构特征）
    const isNetscapeFormat = html.includes('NETSCAPE-Bookmark-file-1') ||
        html.includes('<!DOCTYPE NETSCAPE-Bookmark-file') ||
        (doc.querySelector('dl') && doc.querySelector('dt'));

    let items = [];
    let totalCount = 0;

    if (isNetscapeFormat) {
        // 使用 Netscape 格式解析器，保留层级结构
        const result = parseNetscapeBookmarkHtml(doc);
        items = result.items;
        totalCount = result.totalCount;
    } else {
        // 回退到简单的链接提取模式
        const links = doc.querySelectorAll('a[href]');
        if (links && links.length > 0) {
            items = Array.from(links).map(link => ({
                title: (link.textContent || '').trim() || link.href,
                url: link.href,
                type: 'bookmark',
                children: []
            }));
            totalCount = items.length;
        }
    }

    if (!items || items.length === 0) {
        showCanvasToast(isEn ? 'No valid bookmark links found.' : '未找到有效的书签链接', 'error');
        return;
    }

    // 创建一个新的临时栏目容器
    // 在当前视口中找一个空白位置
    const position = findAvailablePositionInViewport(TEMP_SECTION_DEFAULT_WIDTH, TEMP_SECTION_DEFAULT_HEIGHT);
    const sectionId = `temp-section-${++CanvasState.tempSectionCounter}`;
    const section = {
        id: sectionId,
        title: isEn
            ? `Imported Bookmarks (${totalCount}) - ${formatTimestampForTitle()}`
            : `导入的书签 (${totalCount}) - ${formatTimestampForTitle()}`,
        color: pickTempSectionColor(),
        x: position.x,
        y: position.y,
        width: TEMP_SECTION_DEFAULT_WIDTH,
        height: TEMP_SECTION_DEFAULT_HEIGHT,
        createdAt: Date.now(),
        items: []
    };

    // 递归转换为临时栏目格式
    const convertToTempItem = (node) => {
        const item = {
            id: `temp-${sectionId}-${++CanvasState.tempItemCounter}`,
            sectionId: sectionId,
            title: node.title || (node.url ? (isEn ? 'Untitled' : '未命名') : (isEn ? 'Folder' : '文件夹')),
            url: node.url || '',
            type: node.url ? 'bookmark' : 'folder',
            children: [],
            createdAt: Date.now()
        };

        if (node.children && Array.isArray(node.children)) {
            item.children = node.children.map(convertToTempItem).filter(Boolean);
        }

        return item;
    };

    section.items = items.map(convertToTempItem).filter(Boolean);

    CanvasState.tempSections.push(section);
    renderTempNode(section);

    // 如果找不到空白位置，需要将新栏目设置为更高的 z-index（覆盖在其他元素之上）
    if (position.needsHigherZIndex) {
        const nodeElement = document.getElementById(section.id);
        if (nodeElement) {
            nodeElement.style.zIndex = '500';  // 比其他栏目更高
            // 添加一个轻微的阴影效果，让用户知道这是覆盖在其他元素之上的
            nodeElement.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.35)';
        }
    }

    saveTempNodes();

    // 添加呼吸式闪烁效果，吸引用户注意
    const nodeElement = document.getElementById(section.id);
    if (nodeElement) {
        pulseBreathingEffect(nodeElement, 1500);
    }

    // 显示成功提示
    showCanvasToast(
        isEn ? `Successfully imported ${totalCount} bookmarks` : `成功导入 ${totalCount} 个书签`,
        'success'
    );

    // 移动视图到新栏目
    setCanvasZoom(CanvasState.zoom, section.x + section.width / 2, section.y + section.height / 2);
}

/**
 * 解析 Netscape Bookmark HTML 格式
 * 标准结构：
 *   <DL><p>
 *     <DT><H3>文件夹名</H3>
 *     <DL><p>
 *       <DT><A HREF="...">书签名</A>
 *       ...
 *     </DL><p>
 *     <DT><A HREF="...">书签名</A>
 *   </DL><p>
 */
function parseNetscapeBookmarkHtml(doc) {
    let totalCount = 0;

    // 递归解析 DL 元素
    const parseDL = (dlElement) => {
        const items = [];
        if (!dlElement) return items;

        // 遍历 DL 的直接子元素
        const children = dlElement.children;
        for (let i = 0; i < children.length; i++) {
            const child = children[i];

            // 跳过非 DT 元素（如 <p> 标签）
            if (child.tagName !== 'DT') continue;

            // 检查 DT 内部是文件夹（H3）还是书签（A）
            const h3 = child.querySelector(':scope > h3, :scope > H3');
            const anchor = child.querySelector(':scope > a, :scope > A');

            if (h3) {
                // 这是一个文件夹
                const folderTitle = (h3.textContent || '').trim() || 'Folder';

                // 查找紧随其后的 DL（文件夹内容）
                // 可能是 DT 的下一个兄弟元素，也可能在 DT 内部
                let subDL = child.querySelector(':scope > dl, :scope > DL');
                if (!subDL) {
                    // 检查下一个兄弟元素
                    let nextSibling = child.nextElementSibling;
                    while (nextSibling && nextSibling.tagName !== 'DT' && nextSibling.tagName !== 'DL') {
                        nextSibling = nextSibling.nextElementSibling;
                    }
                    if (nextSibling && (nextSibling.tagName === 'DL' || nextSibling.tagName === 'dl')) {
                        subDL = nextSibling;
                    }
                }

                const folderItem = {
                    title: folderTitle,
                    url: '',
                    type: 'folder',
                    children: subDL ? parseDL(subDL) : []
                };
                items.push(folderItem);

            } else if (anchor) {
                // 这是一个书签
                const href = anchor.getAttribute('href') || '';
                const title = (anchor.textContent || '').trim() || href;

                // 跳过无效的链接（如 javascript: 或空链接）
                if (href && !href.startsWith('javascript:') && href !== '#') {
                    const bookmarkItem = {
                        title: title,
                        url: href,
                        type: 'bookmark',
                        children: []
                    };
                    items.push(bookmarkItem);
                    totalCount++;
                }
            }
        }

        return items;
    };

    // 找到根 DL 元素
    // 通常在 <H1> 后面，或者直接是第一个 <DL>
    let rootDL = doc.querySelector('body > dl, body > DL');
    if (!rootDL) {
        // 尝试找到任何 DL
        rootDL = doc.querySelector('dl, DL');
    }

    const items = rootDL ? parseDL(rootDL) : [];

    return { items, totalCount };
}

/**
 * 导入 JSON 书签文件（支持多种格式）
 * 
 * 支持的格式：
 * 1. Chrome/Edge 内部格式：{roots: {bookmark_bar: {...}, other: {...}, synced: {...}}}
 * 2. Chrome API 格式：{id, title, url, children, dateAdded, parentId}
 * 3. Firefox 格式：{root, guid, title, uri, children, dateAdded}
 * 4. 通用数组格式：[{name/title, url/href/uri, children}, ...]
 * 5. 单对象格式：{name/title, url/href/uri, children}
 * 6. 第三方插件常用格式（兼容各种字段名）
 */
async function importJsonBookmarks(json) {
    const { isEn } = __getLang();
    let data;
    try {
        data = JSON.parse(json);
    } catch (e) {
        showCanvasToast(isEn ? 'Invalid JSON format.' : '无效的 JSON 格式', 'error');
        return;
    }

    // 统计书签总数
    let totalBookmarkCount = 0;

    // 通用转换器 - 支持多种字段名
    const convert = (node) => {
        if (!node || typeof node !== 'object') return null;

        // 获取标题：支持 title, name, label, text
        const title = node.title || node.name || node.label || node.text || '';

        // 获取 URL：支持 url, uri, href, link
        const url = node.url || node.uri || node.href || node.link || '';

        // 判断类型
        // Firefox 使用 type: "text/x-moz-place" 或 "text/x-moz-place-container"
        // Chrome 使用 type 字段或检查是否有 url
        let isFolder = false;
        if (node.type) {
            // Firefox: "text/x-moz-place-container" 是文件夹
            // Chrome: "folder" 是文件夹
            if (node.type === 'text/x-moz-place-container' ||
                node.type === 'folder' ||
                node.type === 'directory') {
                isFolder = true;
            }
        } else {
            // 没有 type 字段时：有 children 且没有 url 视为文件夹
            isFolder = !url && (node.children && Array.isArray(node.children));
        }

        // 跳过无效节点（既没有标题也没有 URL，且没有 children）
        if (!title && !url && (!node.children || node.children.length === 0)) {
            return null;
        }

        // 跳过无效的链接
        if (url && (url.startsWith('javascript:') || url === '#' || url === 'about:blank')) {
            return null;
        }

        const item = {
            title: title || (url ? (isEn ? 'Untitled' : '未命名') : (isEn ? 'Folder' : '文件夹')),
            url: url,
            type: (url && !isFolder) ? 'bookmark' : 'folder',
            children: []
        };

        if (url && !isFolder) {
            totalBookmarkCount++;
        }

        // 递归处理子节点
        if (node.children && Array.isArray(node.children)) {
            item.children = node.children.map(convert).filter(Boolean);
        }

        return item;
    };

    // 转换为临时栏目格式
    const convertToTempItem = (node, sectionId) => {
        const item = {
            id: `temp-${sectionId}-${++CanvasState.tempItemCounter}`,
            sectionId: sectionId,
            title: node.title,
            url: node.url || '',
            type: node.type,
            children: [],
            createdAt: Date.now()
        };

        if (node.children && Array.isArray(node.children)) {
            item.children = node.children.map(c => convertToTempItem(c, sectionId)).filter(Boolean);
        }

        return item;
    };

    let items = [];

    // 检测并处理不同格式
    if (data.roots) {
        // Chrome/Edge 内部格式：{roots: {bookmark_bar, other, synced}}
        console.log('[Canvas] Detected Chrome/Edge internal bookmark format');
        for (const [key, root] of Object.entries(data.roots)) {
            if (root && typeof root === 'object') {
                // 跳过 sync_transaction_version 等非书签字段
                if (typeof root === 'number' || typeof root === 'string') continue;

                if (root.children && Array.isArray(root.children)) {
                    // 创建一个代表根文件夹的节点
                    const rootName = root.name || key;
                    const rootItem = {
                        title: rootName,
                        url: '',
                        type: 'folder',
                        children: root.children.map(convert).filter(Boolean)
                    };
                    if (rootItem.children.length > 0) {
                        items.push(rootItem);
                    }
                } else if (root.url) {
                    // 单个书签
                    const item = convert(root);
                    if (item) items.push(item);
                }
            }
        }
    } else if (data.root && data.guid) {
        // Firefox JSON 格式（完整备份）
        console.log('[Canvas] Detected Firefox bookmark format');
        if (data.children && Array.isArray(data.children)) {
            data.children.forEach(child => {
                const item = convert(child);
                if (item) items.push(item);
            });
        }
    } else if (Array.isArray(data)) {
        // 数组格式 - 最通用的格式
        console.log('[Canvas] Detected array bookmark format');

        // 检查是否是 Chrome bookmarks.getTree() 的输出格式
        // 通常返回 [{id: "0", title: "", children: [...]}]
        if (data.length === 1 && data[0].children && !data[0].url) {
            // 可能是 Chrome API 格式的根节点
            data[0].children.forEach(child => {
                const item = convert(child);
                if (item) items.push(item);
            });
        } else {
            data.forEach(c => {
                const item = convert(c);
                if (item) items.push(item);
            });
        }
    } else if (data.children && Array.isArray(data.children)) {
        // 单个根节点格式（可能是 Chrome API 格式）
        console.log('[Canvas] Detected single root node format');
        data.children.forEach(child => {
            const item = convert(child);
            if (item) items.push(item);
        });
    } else {
        // 单个对象格式
        console.log('[Canvas] Detected single object format');
        const item = convert(data);
        if (item) items.push(item);
    }

    if (items.length === 0) {
        showCanvasToast(isEn ? 'No valid bookmark data found.' : '未解析到有效的书签数据', 'error');
        return;
    }

    // 创建一个新的临时栏目容器
    // 在当前视口中找一个空白位置
    const position = findAvailablePositionInViewport(TEMP_SECTION_DEFAULT_WIDTH, TEMP_SECTION_DEFAULT_HEIGHT);
    const sectionId = `temp-section-${++CanvasState.tempSectionCounter}`;
    const section = {
        id: sectionId,
        title: isEn
            ? `Imported Bookmarks (JSON, ${totalBookmarkCount}) - ${formatTimestampForTitle()}`
            : `导入的书签 (JSON, ${totalBookmarkCount}) - ${formatTimestampForTitle()}`,
        color: pickTempSectionColor(),
        x: position.x,
        y: position.y,
        width: TEMP_SECTION_DEFAULT_WIDTH,
        height: TEMP_SECTION_DEFAULT_HEIGHT,
        createdAt: Date.now(),
        items: items.map(item => convertToTempItem(item, sectionId)).filter(Boolean)
    };

    CanvasState.tempSections.push(section);
    renderTempNode(section);

    // 如果找不到空白位置，需要将新栏目设置为更高的 z-index（覆盖在其他元素之上）
    if (position.needsHigherZIndex) {
        const nodeElement = document.getElementById(section.id);
        if (nodeElement) {
            nodeElement.style.zIndex = '500';  // 比其他栏目更高
            // 添加一个轻微的阴影效果，让用户知道这是覆盖在其他元素之上的
            nodeElement.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.35)';
        }
    }

    saveTempNodes();

    // 添加呼吸式闪烁效果，吸引用户注意
    const nodeElement = document.getElementById(section.id);
    if (nodeElement) {
        pulseBreathingEffect(nodeElement, 1500);
    }

    // 显示成功提示
    showCanvasToast(
        isEn ? `Successfully imported ${totalBookmarkCount} bookmarks` : `成功导入 ${totalBookmarkCount} 个书签`,
        'success'
    );

    // 移动视图到新栏目
    setCanvasZoom(CanvasState.zoom, section.x + section.width / 2, section.y + section.height / 2);
}

function exportCanvas() {
    // 双轨导出模式选择（2.1节）
    showExportModeDialog();
}

/**
 * 双轨模式选择对话框（简化版）
 * 模式 A: Obsidian 兼容模式 - 进入路径配置
 * 模式 B: 全量备份模式 - 进入确认页面
 */
function showExportModeDialog() {
    const { isEn } = __getLang();

    // 移除已有对话框
    const existingDialog = document.getElementById('canvasExportModeDialog');
    if (existingDialog) existingDialog.remove();

    const dialog = document.createElement('div');
    dialog.className = 'import-dialog';
    dialog.id = 'canvasExportModeDialog';

    const dialogTitle = isEn ? 'Export' : '导出';
    const modeATitle = isEn ? 'Obsidian Compatible' : 'Obsidian 兼容';
    const modeAHint = isEn ? 'For viewing in Obsidian' : '用于 Obsidian，但需注意格式（详见说明）';
    const modeAHint2 = isEn ? '(some features may differ, see README)' : '';
    const modeBTitle = isEn ? 'Full Backup' : '全量备份';
    const modeBHint = isEn ? 'For import & recovery' : '用于导入与恢复';

    dialog.innerHTML = `
        <div class="import-dialog-content" style="max-width: 420px; width: 90vw;">
            <div class="import-dialog-header" style="padding: 10px 16px;">
                <h3 style="margin-left: 4px;">${dialogTitle}</h3>
                <button class="import-dialog-close" id="closeExportModeDialog" style="margin-top: 1px;">&times;</button>
            </div>
            <div class="import-dialog-body" style="padding: 16px;">
                <div class="import-options" style="gap: 12px;">
                    <!-- 模式 A: Obsidian 兼容 -->
                    <button class="import-option-btn" id="exportModeA" style="padding: 14px 16px; display: flex; align-items: center;">
                        <div style="width: 32px; display: flex; justify-content: center; margin-right: 12px;">
                            <i class="fab fa-markdown" style="font-size: 22px; color: #7c3aed;"></i>
                        </div>
                        <div style="text-align: left; flex: 1;">
                            <div style="font-size: 14px; font-weight: 600;">${modeATitle}</div>
                            <div style="font-size: 12px; color: #888; margin-top: 2px;">${modeAHint}</div>
                            ${modeAHint2 ? `<div style="font-size: 11px; color: #aaa; margin-top: 1px;">${modeAHint2}</div>` : ''}
                        </div>
                        <i class="fas fa-chevron-right" style="color: #ccc;"></i>
                    </button>
                    
                    <!-- 模式 B: 全量备份 (直接导出) -->
                    <button class="import-option-btn" id="exportModeB" style="padding: 14px 16px; display: flex; align-items: center;">
                        <div style="width: 32px; display: flex; justify-content: center; margin-right: 12px;">
                            <i class="fas fa-database" style="font-size: 20px; color: #059669;"></i>
                        </div>
                        <div style="text-align: left; flex: 1;">
                            <div style="font-size: 14px; font-weight: 600;">${modeBTitle}</div>
                            <div style="font-size: 12px; color: #888; margin-top: 2px;">${modeBHint}</div>
                        </div>
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(dialog);

    // 事件监听
    document.getElementById('closeExportModeDialog').addEventListener('click', () => {
        dialog.remove();
    });

    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) dialog.remove();
    });

    // 模式 A: 进入 Obsidian 路径配置
    document.getElementById('exportModeA').addEventListener('click', () => {
        dialog.remove();
        exportCanvasPackage({ mode: 'obsidian' }).catch((e) => {
            console.error('[Canvas] 导出失败:', e);
            const { isEn } = __getLang();
            alert((isEn ? 'Export failed: ' : '导出失败: ') + (e && e.message ? e.message : e));
        });
    });

    // 模式 B: 直接进行全量备份导出，不再显示二级确认页
    document.getElementById('exportModeB').addEventListener('click', () => {
        dialog.remove();
        exportCanvasPackage({ mode: 'full-backup' }).catch((e) => {
            console.error('[Canvas] 导出失败:', e);
            const { isEn } = __getLang();
            alert((isEn ? 'Export failed: ' : '导出失败: ') + (e && e.message ? e.message : e));
        });
    });
}

/**
 * 全量备份模式的二级确认对话框
 */
function showFullBackupConfirmDialog() {
    const { isEn } = __getLang();

    const dialog = document.createElement('div');
    dialog.className = 'import-dialog';
    dialog.id = 'canvasFullBackupConfirmDialog';

    const title = isEn ? 'Full Backup Export' : '全量备份导出';
    const desc = isEn
        ? 'This will create a complete backup package containing:'
        : '将创建一个完整的备份包，包含：';
    const item1 = isEn ? '✓ All bookmark data (permanent & temporary)' : '✓ 所有书签数据（永久栏目 & 临时栏目）';
    const item2 = isEn ? '✓ Canvas layout & connections' : '✓ 画布布局与连接线';
    const item3 = isEn ? '✓ Scroll positions & settings' : '✓ 滚动位置与设置';
    const item4 = isEn ? '✓ Structured JSON for AI analysis' : '✓ 结构化 JSON（便于 AI 分析）';
    const btnText = isEn ? 'Export Now' : '立即导出';
    const backText = isEn ? 'Back' : '返回';

    dialog.innerHTML = `
        <div class="import-dialog-content" style="max-width: 400px; width: 90vw;">
            <div class="import-dialog-header">
                <h3>${title}</h3>
                <button class="import-dialog-close" id="closeFullBackupDialog">&times;</button>
            </div>
            <div class="import-dialog-body" style="padding: 16px;">
                <div style="margin-bottom: 16px; color: #555; font-size: 13px;">${desc}</div>
                <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
                    <div style="font-size: 13px; color: #166534; line-height: 1.8;">
                        ${item1}<br>
                        ${item2}<br>
                        ${item3}<br>
                        ${item4}
                    </div>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button id="backToModeSelect" class="import-option-btn" style="flex: 1; padding: 10px; justify-content: center; background: #f3f4f6; border: 1px solid #e5e7eb;">
                        <i class="fas fa-arrow-left" style="margin-right: 6px;"></i>${backText}
                    </button>
                    <button id="confirmFullBackup" class="import-option-btn" style="flex: 2; padding: 10px; justify-content: center; background: #059669; color: white; border: none;">
                        <i class="fas fa-download" style="margin-right: 6px;"></i>${btnText}
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(dialog);

    document.getElementById('closeFullBackupDialog').addEventListener('click', () => {
        dialog.remove();
    });

    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) dialog.remove();
    });

    document.getElementById('backToModeSelect').addEventListener('click', () => {
        dialog.remove();
        showExportModeDialog();
    });

    document.getElementById('confirmFullBackup').addEventListener('click', () => {
        dialog.remove();
        exportCanvasPackage({ mode: 'full-backup' }).catch((e) => {
            console.error('[Canvas] 导出失败:', e);
            const { isEn } = __getLang();
            alert((isEn ? 'Export failed: ' : '导出失败: ') + (e && e.message ? e.message : e));
        });
    });
}

// =============================================================================
// Canvas 导入/导出（zip 包：.canvas + .md + 本体json）
// =============================================================================

function __getLang() {
    const lang = (typeof currentLang === 'string' && currentLang) ? currentLang : 'zh_CN';
    const lower = String(lang).toLowerCase();
    const isEn = lower === 'en' || lower.startsWith('en_') || lower.startsWith('en-') || lower.startsWith('en');
    return { lang, isEn };
}

function __frontmatter(meta) {
    const safe = (v) => String(v == null ? '' : v).replace(/\r?\n/g, ' ').trim();
    return [
        '---',
        'exporter: bookmark-backup-canvas',
        'exportVersion: 1',
        `exportedAt: ${safe(meta.exportedAt)}`,
        `source: ${safe(meta.source)}`,
        `sourceId: ${safe(meta.sourceId)}`,
        `title: ${safe(meta.title)}`,
        '---',
        ''
    ].join('\n');
}

function __stripZwsp(s) {
    return String(s || '').replace(/\u200B/g, '');
}

/**
 * Convert HTML content to Markdown source code for Obsidian rendering.
 * This function traverses the DOM and converts HTML elements to their Markdown equivalents.
 */
function __htmlToMarkdown(html) {
    if (!html || typeof html !== 'string') return '';
    const stripped = __stripZwsp(html).trim();
    if (!stripped) return '';

    // If it doesn't look like HTML, return as-is (already Markdown)
    const looksLikeHtml = /<\s*(?:a|p|div|span|br|strong|em|b|i|u|del|s|mark|code|blockquote|ul|ol|li|hr|h[1-6]|font|center|pre|sup|sub)\b/i.test(stripped);
    if (!looksLikeHtml) return stripped;

    const tmp = document.createElement('div');
    tmp.innerHTML = stripped;

    const processNode = (node) => {
        if (!node) return '';
        if (node.nodeType === Node.TEXT_NODE) {
            return (node.textContent || '').replace(/\u200B/g, '');
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return '';

        const tag = node.tagName.toLowerCase();
        const childContent = () => Array.from(node.childNodes).map(processNode).join('');

        switch (tag) {
            case 'br':
                return '\n';
            case 'p':
            case 'div': {
                const align = node.getAttribute('align');
                const style = node.getAttribute('style');
                if (align || style) {
                    let attrs = '';
                    if (align) attrs += ` align="${align}"`;
                    if (style) attrs += ` style="${style}"`;
                    return `<${tag}${attrs}>${childContent()}</${tag}>\n`;
                }
                return childContent() + '\n';
            }
            case 'details':
                return `<details>${childContent()}</details>\n`;
            case 'summary':
                return `<summary>${childContent()}</summary>\n`;
            case 'input': {
                if (node.type === 'checkbox') {
                    const isChecked = node.hasAttribute('checked') || node.checked;
                    return `- [${isChecked ? 'x' : ' '}] `;
                }
                return '';
            }
            case 'strong':
            case 'b':
                return `**${childContent()}**`;
            case 'em':
            case 'i':
                return `*${childContent()}*`;
            case 'u':
                return `<u>${childContent()}</u>`;
            case 'del':
            case 's':
            case 'strike':
                return `~~${childContent()}~~`;
            case 'mark':
                return `==${childContent()}==`;
            case 'code':
                return `\`${childContent()}\``;
            case 'pre':
                return '```\n' + childContent() + '\n```\n';
            case 'sup':
                return `<sup>${childContent()}</sup>`;
            case 'sub':
                return `<sub>${childContent()}</sub>`;
            case 'a': {
                const href = node.getAttribute('href') || '';
                const text = childContent() || href;
                return `[${text}](${href})`;
            }
            case 'h1':
                return `# ${childContent()}\n`;
            case 'h2':
                return `## ${childContent()}\n`;
            case 'h3':
                return `### ${childContent()}\n`;
            case 'h4':
                return `#### ${childContent()}\n`;
            case 'h5':
                return `##### ${childContent()}\n`;
            case 'h6':
                return `###### ${childContent()}\n`;
            case 'blockquote':
                return childContent().split('\n').map(line => `> ${line}`).join('\n') + '\n';
            case 'ul':
                return Array.from(node.children).map((li, idx) => {
                    const content = processNode(li).replace(/^- /, '').trim();
                    return `- ${content}`;
                }).join('\n') + '\n';
            case 'ol':
                return Array.from(node.children).map((li, idx) => {
                    const content = processNode(li).replace(/^\d+\. /, '').trim();
                    return `${idx + 1}. ${content}`;
                }).join('\n') + '\n';
            case 'li':
                return childContent();
            case 'hr':
                return '---\n';
            case 'img': {
                const src = node.getAttribute('src') || '';
                const alt = node.getAttribute('alt') || '';
                return `![${alt}](${src})`;
            }
            case 'font': {
                const color = node.getAttribute('color');
                if (color) {
                    return `<font color="${color}">${childContent()}</font>`;
                }
                return childContent();
            }
            case 'span': {
                const style = node.getAttribute('style');
                // Preserve span if it has style (e.g. color, background)
                if (style) {
                    return `<span style="${style}">${childContent()}</span>`;
                }
                return childContent();
            }
            case 'center':
                return `<center>${childContent()}</center>`;
            default:
                return childContent();
        }
    };

    const result = Array.from(tmp.childNodes).map(processNode).join('');
    // Clean up excessive newlines
    return result.replace(/\n{3,}/g, '\n\n').trim();
}

function __isValidUrl(url) {
    const u = String(url || '').trim();
    if (!u) return false;
    try {
        const parsed = new URL(u);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

function __escapeMarkdownLinkText(text) {
    return String(text || '').replace(/]/g, '\\]');
}

const __toAlphaLabel = (n) => {
    if (n <= 0) return '';
    let s = '';
    while (n > 0) {
        n--;
        s = String.fromCharCode(65 + (n % 26)) + s;
        n = Math.floor(n / 26);
    }
    return s;
};

// Helper to get permanent expanded state
const __getPermanentExpandedSet = () => {
    try {
        const s = localStorage.getItem('treeExpandedNodeIds');
        return new Set(JSON.parse(s || '[]'));
    } catch (_) {
        return new Set();
    }
};

const __getTempSectionCollapsedSet = (sectionId) => {
    if (!sectionId) return new Set();
    try {
        const key = `temp-section-collapsed:${sectionId}`;
        const s = localStorage.getItem(key);
        return new Set(JSON.parse(s || '[]'));
    } catch (_) {
        return new Set();
    }
};

/**
 * @param {Array} items
 * @param {number} depth
 * @param {Object} options
 * @param {string} options.checkType - 'permanent' or 'temp' or 'none'
 * @param {Set} options.permanentExpandedSet - for permanent section
 * @param {string} options.tempSectionId - for temp section
 */
function __toTreeMarkdownLines(items, depth = 0, options = {}) {
    const lines = [];
    // Styles for tree visualization (mimicking the HTML canvas look)
    const BORDER_COLOR = 'rgba(130, 130, 130, 0.3)';
    // Children container: renders the vertical line
    const containerStyle = `border-left: 1px solid ${BORDER_COLOR}; margin-left: 7px; padding-left: 16px; position: relative; display: flex; flex-direction: column;`;
    // Item wrapper: holds connector and content
    const itemWrapperStyle = `position: relative; margin-bottom: 2px;`;
    // Connector: horizontal line from parent's vertical border to item
    // We position it relative to the padding-left of the container.
    const connectorStyle = `position: absolute; top: 12px; left: -16px; width: 12px; height: 1px; background-color: ${BORDER_COLOR}; pointer-events: none;`;

    const labelStyle = `display: inline-flex; align-items: center; gap: 6px; vertical-align: middle; text-decoration: none; color: inherit; font-size: 14px; line-height: 24px; max-width: 100%; overflow: hidden;`;
    const summaryStyle = `cursor: pointer; list-style: none; display: flex; align-items: center; outline: none;`;
    const textStyle = `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;

    const { checkType, permanentExpandedSet, tempSectionId } = options;

    (items || []).forEach((item) => {
        if (!item) return;
        let titleRaw = String(item.title || item.name || item.url || 'Untitled').trim();
        // Remove excesive spaces and newlines
        titleRaw = titleRaw.replace(/\s+/g, ' ');

        // HTML escape title
        const titleSafe = titleRaw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

        const connector = depth > 0
            ? `<span style="${connectorStyle}"></span>`
            : '';

        if (item.type === 'bookmark' || item.url) {
            const url = String(item.url || '').trim();
            const ok = __isValidUrl(url);
            const safeUrl = ok ? url : '#';
            const suffix = ok ? '' : ' <small style="color:red; opacity:0.7;">(invalid)</small>';

            // Icon
            let iconSrc = getFaviconUrl && getFaviconUrl(safeUrl);
            if (!iconSrc) iconSrc = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZ3dCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjOTE5MTkxIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiPjwvY2lyY2xlPjwvc3ZnPg==';

            lines.push(`<div style="${itemWrapperStyle}">`);
            lines.push(`  ${connector}`);
            lines.push(`  <a href="${safeUrl}" target="_blank" style="${labelStyle}" title="${titleSafe}">`);
            lines.push(`    <img src="${iconSrc}" style="width:16px; height:16px; object-fit:contain; border-radius:3px; flex-shrink: 0;" />`);
            lines.push(`    <span style="${textStyle}">${titleSafe}</span>`);
            lines.push(`  </a>${suffix}`);
            lines.push(`</div>`);
            return;
        }

        // Folder
        const folderName = titleSafe || 'Folder';
        let isExpanded = true;

        if (checkType === 'permanent') {
            if (item.id && permanentExpandedSet) {
                isExpanded = permanentExpandedSet.has(String(item.id));
            } else {
                isExpanded = false;
            }
        } else if (checkType === 'temp' && tempSectionId && item.id && typeof LAZY_LOAD_THRESHOLD !== 'undefined') {
            const folderId = `${tempSectionId}-${item.id}`;
            const maxDepth = LAZY_LOAD_THRESHOLD.maxInitialDepth || 1;
            const userCollapsed = LAZY_LOAD_THRESHOLD.collapsedFolders.has(folderId);
            const userExpanded = LAZY_LOAD_THRESHOLD.expandedFolders.has(folderId);
            const defaultExpanded = depth < maxDepth;
            isExpanded = userExpanded || (defaultExpanded && !userCollapsed);
        }

        const openAttr = isExpanded ? ' open' : '';
        const hasChildren = Array.isArray(item.children) && item.children.length > 0;

        // Empty folder indicator
        const emptyIndicator = hasChildren ? '' : ` <span style="opacity:0.5; font-size: 0.9em; margin-left: 6px;">(empty)</span>`;

        lines.push(`<div style="${itemWrapperStyle}">`);
        lines.push(`  ${connector}`);
        lines.push(`  <details${openAttr}>`);
        lines.push(`    <summary style="${summaryStyle}">`);
        lines.push(`      <span style="${labelStyle}" title="${folderName}">`);
        lines.push(`        <span style="font-size:16px; line-height:1; flex-shrink: 0;">📁</span>`);
        lines.push(`        <span style="${textStyle}">${folderName}</span>`);
        lines.push(`        ${emptyIndicator}`);
        lines.push(`      </span>`);
        lines.push(`    </summary>`);

        if (hasChildren) {
            lines.push(`    <div style="${containerStyle}">`);
            lines.push(...__toTreeMarkdownLines(item.children, depth + 1, options));
            lines.push(`    </div>`);
        }

        lines.push(`  </details>`);
        lines.push(`</div>`);
    });
    return lines;
}

function __buildPermanentBookmarksMarkdown(bookmarkTree) {
    const { isEn } = __getLang();
    const exportedAt = new Date().toISOString();

    // 1. Get Title from DOM (in case user modified it via CSS/hack, or just use translated default)
    const domTitleEl = document.getElementById('permanentSectionTitle');
    const domTitle = domTitleEl ? domTitleEl.textContent.trim() : '';
    const title = domTitle || (isEn ? 'Permanent Bookmarks' : '书签树 (永久栏目)');

    // 2. Get Description (Markdown) form LocalStorage
    let rawDesc = '';
    try { rawDesc = localStorage.getItem('canvas-permanent-tip-text') || ''; } catch (_) { }
    const descMd = __htmlToMarkdown(rawDesc);

    // Frontmatter removed to hide properties in Obsidian Canvas
    /* const header = __frontmatter({
        exportedAt,
        source: 'permanent',
        sourceId: 'chrome-bookmarks',
        title
    }); */

    const body = [];
    // Title header removed
    // body.push(`# ${title}`);
    // body.push('');

    if (descMd) {
        body.push(descMd);
        body.push('');
        body.push('---');
        body.push('');
    }

    const root = Array.isArray(bookmarkTree) ? bookmarkTree[0] : null;
    const roots = root && Array.isArray(root.children) ? root.children : [];

    // Prepare options for expanded state
    const permanentExpandedSet = __getPermanentExpandedSet();
    // Default roots (1, 2, 3) to expanded if the set is empty (fresh start)?? 
    // Actually, usually Bar (1) is expanded. If set is empty, maybe user never toggled anything or cleared data.
    // Let's stick to the set. If empty, everything collapsed (except maybe we want to force roots open?).
    // Obsidian usually likes clean md. <details> is good.

    const getRootSectionName = (node) => {
        if (!node) return 'Bookmarks';
        if (node.id === '1') return isEn ? 'Bookmark Bar' : '书签栏';
        if (node.id === '2') return isEn ? 'Other Bookmarks' : '其他书签';
        if (node.id === '3') return isEn ? 'Mobile Bookmarks' : '移动设备书签';
        const t = String(node.title || node.name || '').trim();
        return t || (isEn ? 'Bookmarks' : '书签');
    };

    const toPayload = (node) => {
        if (!node) return null;
        if (node.url) {
            return { id: node.id, type: 'bookmark', title: node.title || node.name || node.url, url: node.url };
        }
        const children = Array.isArray(node.children) ? node.children.map(toPayload).filter(Boolean) : [];
        return { id: node.id, type: 'folder', title: node.title || node.name || (isEn ? 'Folder' : '文件夹'), children };
    };

    const parts = [];
    parts.push(...body);

    roots.forEach((r) => {
        const sectionName = getRootSectionName(r);
        parts.push(`## ${sectionName}`);
        const children = Array.isArray(r.children) ? r.children.map(toPayload).filter(Boolean) : [];

        // For roots, we might want to just list them. But usually they are headers.
        // The children of roots are the actual folders/bookmarks.

        const lines = __toTreeMarkdownLines(children, 0, {
            checkType: 'permanent',
            permanentExpandedSet
        });

        if (lines.length) parts.push(lines.join('\n'));
        parts.push('');
    });

    return parts.join('\n').trimEnd() + '\n';
}

function __buildTempSectionMarkdown(section) {
    const { isEn } = __getLang();
    const exportedAt = new Date().toISOString();

    // 1. Title & Sequence
    const rawTitle = String((section && section.title) || (isEn ? 'Temp Section' : '临时栏目'));
    const seqLabel = getTempSectionLabel(section);
    const fullTitle = seqLabel ? `${seqLabel}. ${rawTitle}` : rawTitle;

    // Frontmatter removed
    /* const header = __frontmatter({
        exportedAt,
        source: 'tempSection',
        sourceId: section && section.id ? section.id : '',
        title: fullTitle,
        color: (section && section.color) ? section.color : ''
    }); */

    const body = [];
    // Title header removed
    // body.push(`# ${fullTitle}`);
    // body.push('');

    // 2. Description (Markdown)
    const descHtml = section && typeof section.description === 'string' ? section.description : '';
    const descMd = __htmlToMarkdown(descHtml);
    if (descMd) {
        body.push(descMd);
        body.push('');
        body.push('---');
        body.push('');
    }

    // 3. Items
    const items = section && Array.isArray(section.items) ? section.items : [];

    // Pass temp section ID for collapsed state checking
    const lines = __toTreeMarkdownLines(items, 0, {
        checkType: 'temp',
        tempSectionId: section ? section.id : null
    });

    if (lines.length) {
        body.push(lines.join('\n'));
        body.push('');
    }

    return (body.join('\n')).trimEnd() + '\n';
}

function __buildMdNodeMarkdown(node) {
    const exportedAt = new Date().toISOString();
    // Frontmatter removed
    /* const header = __frontmatter({
        exportedAt,
        source: 'mdNode',
        sourceId: node && node.id ? node.id : '',
        title: '',
        color: (node && node.color) ? node.color : ''
    }); */
    // Convert HTML content to Markdown
    // Prefer node.html (rich text source) over node.text (plain text)
    // Legacy nodes might only have node.text
    const rawContent = (node && typeof node.html === 'string' && node.html)
        ? node.html
        : ((node && typeof node.text === 'string') ? node.text : '');

    const stripped = __stripZwsp(rawContent || '');
    const textMd = __htmlToMarkdown(stripped);

    // Remove first line (used as filename) to avoid duplication in content
    const lines = textMd.split('\n');
    if (lines.length > 0) {
        lines.shift();
    }
    const finalMd = lines.join('\n').trim();

    return (finalMd + '\n').replace(/\r\n/g, '\n');
}


/**
 * [EDITABLE MODE] Build Permanent Sections Markdown (Headings + List)
 */
function __buildPermanentBookmarksMarkdownEditable(bookmarkTree) {
    const { isEn } = __getLang();

    const body = [];

    // 2. Description
    let rawDesc = '';
    try { rawDesc = localStorage.getItem('canvas-permanent-tip-text') || ''; } catch (_) { }
    const descMd = __htmlToMarkdown(rawDesc);
    if (descMd) {
        body.push(descMd);
        body.push('');
    }

    const root = Array.isArray(bookmarkTree) ? bookmarkTree[0] : null;
    const roots = root && Array.isArray(root.children) ? root.children : [];

    const getRootSectionName = (node) => {
        if (!node) return 'Bookmarks';
        if (node.id === '1') return isEn ? 'Bookmark Bar' : '书签栏';
        if (node.id === '2') return isEn ? 'Other Bookmarks' : '其他书签';
        if (node.id === '3') return isEn ? 'Mobile Bookmarks' : '移动设备书签';
        const t = String(node.title || node.name || '').trim();
        return t || (isEn ? 'Bookmarks' : '书签');
    };

    // Clean URL - remove newlines and extra spaces
    const cleanUrl = (url) => {
        if (!url) return '';
        return String(url).replace(/[\r\n\s]+/g, '').trim();
    };

    // Clean title for markdown link
    const cleanTitle = (t) => {
        if (!t) return '';
        // Remove newlines, escape brackets
        return String(t).replace(/[\r\n]+/g, ' ').replace(/([[\]()])/g, '\\$1').trim();
    };

    // Truncate long titles to prevent overly long lines in Obsidian
    const MAX_TITLE_LENGTH = 80;
    const truncateTitle = (title, url) => {
        if (!title) return '';
        // If title is essentially a URL (starts with http/https or equals the URL)
        const isUrlTitle = /^https?:\/\//i.test(title) || title === url;
        if (isUrlTitle && url) {
            try {
                const parsed = new URL(url);
                const domain = parsed.hostname.replace(/^www\./, '');
                const pathPart = parsed.pathname.length > 1 ? parsed.pathname.substring(0, 20) : '';
                const shortTitle = domain + (pathPart ? pathPart + '...' : '');
                return shortTitle.length > MAX_TITLE_LENGTH ? shortTitle.substring(0, MAX_TITLE_LENGTH) + '...' : shortTitle;
            } catch (_) {
                // Fallback: just truncate
                return title.length > MAX_TITLE_LENGTH ? title.substring(0, MAX_TITLE_LENGTH) + '...' : title;
            }
        }
        // Normal title: truncate if too long
        return title.length > MAX_TITLE_LENGTH ? title.substring(0, MAX_TITLE_LENGTH) + '...' : title;
    };

    roots.forEach((r) => {
        const sectionName = getRootSectionName(r);
        body.push(`## ${sectionName}`);
        body.push('');

        // Process nodes recursively, using headings for folders up to H6, then nested lists
        const processNodes = (nodes, headingLevel, listIndent = 0) => {
            if (!nodes) return;
            const useListMode = headingLevel >= 6; // Switch to list mode when we would exceed H6

            nodes.forEach(node => {
                if (node.url) {
                    // Bookmark - always as list item
                    const rawTitle = cleanTitle(node.title || node.name) || cleanUrl(node.url);
                    const bmUrl = cleanUrl(node.url);
                    const bmTitle = truncateTitle(rawTitle, bmUrl);
                    const indent = useListMode ? '  '.repeat(listIndent) : '';
                    body.push(`${indent}- [${bmTitle}](${bmUrl})`);
                } else {
                    // Folder
                    const folderTitle = cleanTitle(node.title || node.name || (isEn ? 'Folder' : '文件夹'));

                    if (useListMode) {
                        // Deep folder: use nested list with 📁 icon
                        const indent = '  '.repeat(listIndent);
                        body.push(`${indent}- 📁 **${folderTitle}**`);

                        if (node.children && node.children.length > 0) {
                            processNodes(node.children, headingLevel, listIndent + 1);
                        }
                    } else {
                        // Shallow folder: use heading
                        const nextLevel = headingLevel + 1;
                        body.push('');
                        body.push(`${'#'.repeat(nextLevel)} ${folderTitle}`);
                        body.push('');

                        if (node.children && node.children.length > 0) {
                            processNodes(node.children, nextLevel, 0);
                        }
                    }
                }
            });
        };

        if (r.children) {
            processNodes(r.children, 2); // Start at H2 context, so first level folders become H3
        }

        body.push('');
    });

    return body.join('\n').trimEnd() + '\n';
}

/**
 * [EDITABLE MODE] Build Temp Section Markdown (Headings + List)
 */
function __buildTempSectionMarkdownEditable(section) {
    const { isEn } = __getLang();

    const body = [];

    const descHtml = section && typeof section.description === 'string' ? section.description : '';
    const descMd = __htmlToMarkdown(descHtml);
    if (descMd) {
        body.push(descMd);
        body.push('');
        body.push('---');
        body.push('');
    }

    const items = section && Array.isArray(section.items) ? section.items : [];

    // Clean URL - remove newlines and extra spaces
    const cleanUrl = (url) => {
        if (!url) return '';
        return String(url).replace(/[\r\n\s]+/g, '').trim();
    };

    // Clean title for markdown link
    const cleanTitle = (t) => {
        if (!t) return '';
        return String(t).replace(/[\r\n]+/g, ' ').replace(/([[\]()])/g, '\\$1').trim();
    };

    // Truncate long titles to prevent overly long lines in Obsidian
    const MAX_TITLE_LENGTH = 80;
    const truncateTitle = (title, url) => {
        if (!title) return '';
        // If title is essentially a URL (starts with http/https or equals the URL)
        const isUrlTitle = /^https?:\/\//i.test(title) || title === url;
        if (isUrlTitle && url) {
            try {
                const parsed = new URL(url);
                const domain = parsed.hostname.replace(/^www\./, '');
                const pathPart = parsed.pathname.length > 1 ? parsed.pathname.substring(0, 20) : '';
                const shortTitle = domain + (pathPart ? pathPart + '...' : '');
                return shortTitle.length > MAX_TITLE_LENGTH ? shortTitle.substring(0, MAX_TITLE_LENGTH) + '...' : shortTitle;
            } catch (_) {
                // Fallback: just truncate
                return title.length > MAX_TITLE_LENGTH ? title.substring(0, MAX_TITLE_LENGTH) + '...' : title;
            }
        }
        // Normal title: truncate if too long
        return title.length > MAX_TITLE_LENGTH ? title.substring(0, MAX_TITLE_LENGTH) + '...' : title;
    };

    // Process nodes recursively, using headings for folders up to H6, then nested lists
    const processNodes = (nodes, headingLevel, listIndent = 0) => {
        if (!nodes) return;
        const useListMode = headingLevel >= 6; // Switch to list mode when we would exceed H6

        nodes.forEach(node => {
            if (node.url) {
                // Bookmark - always as list item
                const rawTitle = cleanTitle(node.title || node.name) || cleanUrl(node.url);
                const bmUrl = cleanUrl(node.url);
                const bmTitle = truncateTitle(rawTitle, bmUrl);
                const indent = useListMode ? '  '.repeat(listIndent) : '';
                body.push(`${indent}- [${bmTitle}](${bmUrl})`);
            } else if (node.children || node.items) {
                // Folder
                const folderTitle = cleanTitle(node.title || node.name || (isEn ? 'Folder' : '文件夹'));
                const children = node.children || node.items || [];

                if (useListMode) {
                    // Deep folder: use nested list with 📁 icon
                    const indent = '  '.repeat(listIndent);
                    body.push(`${indent}- 📁 **${folderTitle}**`);

                    if (children.length > 0) {
                        processNodes(children, headingLevel, listIndent + 1);
                    }
                } else {
                    // Shallow folder: use heading
                    const nextLevel = headingLevel + 1;
                    body.push('');
                    body.push(`${'#'.repeat(nextLevel)} ${folderTitle}`);
                    body.push('');

                    if (children.length > 0) {
                        processNodes(children, nextLevel, 0);
                    }
                }
            } else {
                // Empty folder or just text
                const folderTitle = cleanTitle(node.title || node.name || (isEn ? 'Folder' : '文件夹'));
                const indent = useListMode ? '  '.repeat(listIndent) : '';
                body.push(`${indent}- 📁 **${folderTitle}**`);
            }
        });
    };

    processNodes(items, 1);

    return body.join('\n').trimEnd() + '\n';
}


/**
 * [SECURITY] Sanitize Imported URL
 * Prevent XSS (javascript:) and other dangerous schemes.
 * Allow common productivity schemes (obsidian:, zotero:, etc.)
 */
function __sanitizeImportUrl(url) {
    if (!url) return '';
    const trimmed = String(url).trim();
    if (!trimmed) return '';

    // Allow relative paths (for Obsidian internal links?) - no, usually bookmarks are absolute.
    // If it starts with #, ok.
    if (trimmed.startsWith('#')) return trimmed;

    try {
        const u = new URL(trimmed);
        const protocol = u.protocol.toLowerCase();
        // Whitelist protocols
        // http, https, ftp, mailto, tel
        // obsidian, zotero, onenote, notion (productivity tools)
        // chrome, edge, extension (browser internal? maybe risky if pointing to settings) -> let's allowed standard web + apps
        const allowed = [
            'http:', 'https:', 'ftp:', 'mailto:', 'tel:',
            'obsidian:', 'zotero:', 'onenote:', 'notion:', 'vscode:', 'raycast:'
        ];
        if (allowed.includes(protocol)) return trimmed;

        // Block javascript, data, vbscript
        return `unsafe:${trimmed}`;
    } catch (_) {
        // If URL parsing fails, it might be a relative path or weird string.
        // Check for javascript: explictly
        if (/^\s*(javascript|vbscript|data):/i.test(trimmed)) {
            return `unsafe:${trimmed}`;
        }
        return trimmed; // Return as is (maybe relative path)
    }
}

/**
 * [PARSER] Parse "Editable Mode" Markdown back to Tree Structure
 */
function __parseEditableMarkdownToTree(mdContent) {
    const lines = mdContent.split(/\r?\n/);
    const rootChildren = [];

    // Stack for Heading Hierarchy
    // Stack[0] is always formatting root (Level 1/H1 context)
    // When we see H2 (Level 2), we push to stack.
    let headingStack = [{ level: 1, children: rootChildren }];

    // Helper for List Indentation Hierarchy (within a heading block)
    // This resets whenever a new Heading is encountered.
    // Format: { indent: number, children: Array }
    let listStack = [];

    const getCurrentContainer = (lineIndent) => {
        // 1. Prefer List Stack if active and indent matches deep nesting
        if (listStack.length > 0) {
            // Find parent in list stack with indent < lineIndent
            while (listStack.length > 0 && listStack[listStack.length - 1].indent >= lineIndent) {
                listStack.pop();
            }
            if (listStack.length > 0) {
                return listStack[listStack.length - 1].children;
            }
        }
        // 2. Fallback to Heading Stack (Current Heading Context)
        return headingStack[headingStack.length - 1].children;
    };

    lines.forEach(line => {
        if (!line.trim() || line.trim() === '---') return;

        // 0. Detect Indentation (4 spaces = 1 level basically, or tabs)
        const indentMatch = line.match(/^(\s*)/);
        const indentStr = indentMatch ? indentMatch[1] : '';
        // Approximate indent level: 2 spaces or 1 tab?
        // Let's count length. '    ' is 4.
        const indentLen = indentStr.replace(/\t/g, '    ').length;

        const trimmed = line.trim();

        // 1. Check for Headings (# Title) - Headings ALWAYS reset list context
        const headingMatch = trimmed.match(/^(#+)\s+(.*)/);
        if (headingMatch) {
            listStack = []; // Reset list nesting on new heading

            const hLevel = headingMatch[1].length;
            const title = headingMatch[2].trim();

            if (hLevel === 1) return; // Ignore H1 (File Title)

            // Adjust Heading Stack
            while (headingStack.length > 1 && headingStack[headingStack.length - 1].level >= hLevel) {
                headingStack.pop();
            }

            const folderNode = {
                id: `imported-folder-h-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
                type: 'folder',
                title: title,
                children: []
            };

            // Add to current heading parent
            headingStack[headingStack.length - 1].children.push(folderNode);

            // Push self as new context
            headingStack.push({ level: hLevel, children: folderNode.children });
            return;
        }

        // 2. Check for Bookmarks (- [Title](URL))
        const linkMatch = trimmed.match(/^-\s+\[(.*?)\]\((.*?)\)/);
        if (linkMatch) {
            const title = linkMatch[1].trim();
            const rawUrl = linkMatch[2].trim();
            const url = __sanitizeImportUrl(rawUrl);

            const bmNode = {
                id: `imported-bm-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
                type: 'bookmark',
                title: title || url,
                url: url
            };

            getCurrentContainer(indentLen).push(bmNode);
            return;
        }

        // 3. Check for Folder in List (- 📁 **Title** or - **Title**)
        // Support both with and without folder icon
        const boldFolderMatch = trimmed.match(/^-\s+(?:📁\s*)?\*\*(.*?)\*\*/);
        if (boldFolderMatch) {
            const title = boldFolderMatch[1].trim();
            const folderNode = {
                id: `imported-folder-list-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
                type: 'folder',
                title: title,
                children: []
            };

            getCurrentContainer(indentLen).push(folderNode);

            // Push to List Stack to capture children
            // Logic: This item is at 'indentLen'. Its children will have specific indent > this.
            listStack.push({ indent: indentLen, children: folderNode.children });
            return;
        }
    });

    return rootChildren;
}

/**
 * [PARSER] Parse "Visual Mode" HTML (with <details>, <a href>) back to Tree Structure
 */
function __parseVisualHtmlToTree(htmlContent) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');

    const parseNode = (element) => {
        const results = [];

        // Find all direct children that are wrappers
        const wrappers = element.querySelectorAll(':scope > div');

        wrappers.forEach(wrapper => {
            // Check for bookmark (anchor link)
            const anchor = wrapper.querySelector(':scope > a[href]');
            if (anchor) {
                const rawUrl = anchor.getAttribute('href') || '';
                const url = __sanitizeImportUrl(rawUrl);
                const titleSpan = anchor.querySelector('span:last-child');
                const title = titleSpan ? titleSpan.textContent.trim() : anchor.textContent.trim();

                if (url && url !== '#' && !url.startsWith('unsafe:')) {
                    results.push({
                        id: `imported-bm-v-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
                        type: 'bookmark',
                        title: title || url,
                        url: url
                    });
                }
                return;
            }

            // Check for folder (details element)
            const details = wrapper.querySelector(':scope > details');
            if (details) {
                const summary = details.querySelector(':scope > summary');
                const titleSpan = summary ? summary.querySelector('span span:last-child') : null;
                const title = titleSpan ? titleSpan.textContent.trim() :
                    (summary ? summary.textContent.trim().replace(/^📁\s*/, '') : 'Folder');

                // Find children container (the div after summary with border-left style)
                const childrenContainer = details.querySelector(':scope > div');
                const children = childrenContainer ? parseNode(childrenContainer) : [];

                results.push({
                    id: `imported-folder-v-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
                    type: 'folder',
                    title: title,
                    children: children
                });
            }
        });

        return results;
    };

    // Start parsing from body
    return parseNode(doc.body);
}

/**
 * [AUTO PARSER] Detect format and parse accordingly
 * Visual Mode: Contains <details>, <a href=
 * Editable Mode: Contains Markdown headings (## ...) and lists (- [...](...)
 */
function __parseMarkdownAuto(content) {
    if (!content || typeof content !== 'string') return [];

    const trimmed = content.trim();

    // Detect Visual Mode (HTML with <details> or styled <a href>)
    const hasDetails = /<details[\s>]/i.test(trimmed);
    const hasStyledAnchor = /<a\s+href=.*style=/i.test(trimmed);
    const hasHtmlDiv = /<div\s+style=/i.test(trimmed);

    if (hasDetails || (hasStyledAnchor && hasHtmlDiv)) {
        console.log('[Canvas Import] Detected Visual Mode (HTML format)');
        return __parseVisualHtmlToTree(trimmed);
    }

    // Default to Editable Mode (Markdown)
    console.log('[Canvas Import] Detected Editable Mode (Markdown format)');
    return __parseEditableMarkdownToTree(trimmed);
}

function __toUint8(text) {
    return new TextEncoder().encode(String(text || ''));
}

const __crc32Table = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
    }
    return table;
})();

function __crc32(bytes) {
    let crc = 0 ^ -1;
    for (let i = 0; i < bytes.length; i++) {
        crc = (crc >>> 8) ^ __crc32Table[(crc ^ bytes[i]) & 0xFF];
    }
    return (crc ^ -1) >>> 0;
}

function __zipStore(files) {
    // files: Array<{ name: string, data: Uint8Array }>
    const parts = [];
    const central = [];
    let offset = 0;

    const writeU16 = (v) => {
        const b = new Uint8Array(2);
        new DataView(b.buffer).setUint16(0, v, true);
        return b;
    };
    const writeU32 = (v) => {
        const b = new Uint8Array(4);
        new DataView(b.buffer).setUint32(0, v >>> 0, true);
        return b;
    };

    const dosTime = 0;
    const dosDate = 0;
    const gpFlag = 0x0800; // UTF-8
    const method = 0; // store

    files.forEach((f) => {
        const name = String(f.name || '').replace(/^\/+/, '');
        const nameBytes = __toUint8(name);
        const data = f.data instanceof Uint8Array ? f.data : new Uint8Array();
        const crc = __crc32(data);

        const localHeader = [
            writeU32(0x04034b50),
            writeU16(20),
            writeU16(gpFlag),
            writeU16(method),
            writeU16(dosTime),
            writeU16(dosDate),
            writeU32(crc),
            writeU32(data.length),
            writeU32(data.length),
            writeU16(nameBytes.length),
            writeU16(0)
        ];
        parts.push(...localHeader, nameBytes, data);

        const centralHeader = [
            writeU32(0x02014b50),
            writeU16(0x031E),
            writeU16(20),
            writeU16(gpFlag),
            writeU16(method),
            writeU16(dosTime),
            writeU16(dosDate),
            writeU32(crc),
            writeU32(data.length),
            writeU32(data.length),
            writeU16(nameBytes.length),
            writeU16(0),
            writeU16(0),
            writeU16(0),
            writeU16(0),
            writeU32(0),
            writeU32(offset)
        ];
        central.push(...centralHeader, nameBytes);

        const localSize = localHeader.reduce((sum, b) => sum + b.length, 0) + nameBytes.length + data.length;
        offset += localSize;
    });

    const centralSize = central.reduce((sum, b) => sum + b.length, 0);
    const end = [
        writeU32(0x06054b50),
        writeU16(0),
        writeU16(0),
        writeU16(files.length),
        writeU16(files.length),
        writeU32(centralSize),
        writeU32(offset),
        writeU16(0)
    ];

    return new Blob([...parts, ...central, ...end], { type: 'application/zip' });
}

function __sanitizeFilename(name) {
    return (name || '').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/^\.+/, '').trim() || 'Untitled';
}

async function exportCanvasPackage(options = {}) {
    const exportMode = options.mode || 'obsidian'; // 'obsidian' or 'full-backup'
    const isFullBackupMode = exportMode === 'full-backup';
    const { isEn } = __getLang();
    const api = (typeof browserAPI !== 'undefined' && browserAPI.bookmarks) ? browserAPI.bookmarks : (chrome && chrome.bookmarks ? chrome.bookmarks : null);
    if (!api || typeof api.getTree !== 'function') {
        alert(isEn ? 'Bookmarks API not available.' : '当前环境不支持书签API，无法导出永久栏目。');
        return;
    }

    try { saveTempNodes(); } catch (_) { }
    try { savePermanentSectionPosition(); } catch (_) { }

    const pad2 = (n) => String(n).padStart(2, '0');
    const now = new Date();
    const ymd = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;

    const exportedAt = new Date().toISOString();
    // zip 保存到浏览器默认下载目录下的固定父目录：bookmark-canvas-export/
    // 需求：不同日期的 zip 都归档在同一个文件夹下
    const downloadFolder = 'bookmark-canvas-export';
    // 默认导出文件夹名（也作为默认 zip 名与默认 .canvas 名）
    // - zh_CN: 书签画布-YYYYMMDD
    // - en: bookmark-canvas-YYYYMMDD
    const defaultExportRoot = isEn ? `bookmark-canvas-${ymd}` : `书签画布-${ymd}`;

    const files = [];

    // -------------------------------------------------------------------------
    // 模式 B: 全量备份 (Direct JSON Download)
    // -------------------------------------------------------------------------
    if (isFullBackupMode) {
        const tempStateRaw = localStorage.getItem(TEMP_SECTION_STORAGE_KEY);
        const permanentPosRaw = localStorage.getItem('permanent-section-position');
        const perfMode = localStorage.getItem('canvas-performance-mode');

        // Collect scroll positions
        const scrollState = {};
        const permanentScroll = localStorage.getItem('permanent-section-scroll');
        if (permanentScroll) {
            try { scrollState['permanent-section-scroll'] = JSON.parse(permanentScroll); } catch (_) { }
        }
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('temp-section-scroll:')) {
                try {
                    scrollState[key] = JSON.parse(localStorage.getItem(key));
                } catch (_) { }
            }
        }

        const bookmarkTree = await api.getTree();

        const backupState = {
            exporter: 'bookmark-backup-canvas',
            exportVersion: 2,
            exportedAt,
            exportMode: 'full-backup',
            description: isEn
                ? 'Full backup file for Bookmark Canvas. Contains complete bookmark tree and all canvas data.'
                : '书签画布完整备份文件。包含完整的书签树和所有画布数据。',
            storage: {
                [TEMP_SECTION_STORAGE_KEY]: tempStateRaw ? JSON.parse(tempStateRaw) : null,
                'permanent-section-position': permanentPosRaw ? JSON.parse(permanentPosRaw) : null,
                'canvas-performance-mode': perfMode || null,
                ...scrollState
            },
            permanentTreeSnapshot: bookmarkTree,
            canvasState: {
                tempSections: CanvasState.tempSections,
                mdNodes: CanvasState.mdNodes,
                edges: CanvasState.edges,
                tempSectionCounter: CanvasState.tempSectionCounter,
                mdNodeCounter: CanvasState.mdNodeCounter,
                edgeCounter: CanvasState.edgeCounter
            }
        };

        const jsonString = JSON.stringify(backupState, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const filename = `bookmark-canvas-backup-${ymd}.json`;

        if (chrome && chrome.downloads && typeof chrome.downloads.download === 'function') {
            chrome.downloads.download({
                url: url,
                filename: `${downloadFolder}/${filename}`,
                saveAs: false,
                conflictAction: 'uniquify'
            }, () => {
                setTimeout(() => URL.revokeObjectURL(url), 10000);
            });
        } else {
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 10000);
        }

        alert(isEn
            ? `Exported Full Backup: ${filename}`
            : `已导出全量备份：${filename}`);

        return; // <--- 结束执行，跳过后续的 ZIP 生成逻辑
    }

    // -------------------------------------------------------------------------
    // 模式 A: Obsidian 兼容模式 (ZIP Package)
    // -------------------------------------------------------------------------
    const normalizeVaultPrefix = (input) => {
        let s = String(input == null ? '' : input).trim();
        if (!s) return '';
        s = s.replace(/\\/g, '/');
        s = s.replace(/^\.\/+/, '');
        s = s.replace(/^\/+/, '');
        s = s.replace(/\/+$/, '');
        s = s.replace(/\/{2,}/g, '/');
        return s;
    };

    const promptVaultPrefixViaDialog = (defaultValue) => new Promise((resolve) => {
        const title = isEn ? 'Export: Obsidian Path' : '导出：Obsidian 路径';
        const hl = (t) => `<font color="#ffff00">${t}</font>`;
        const arrow = '<div style="margin:8px 0; line-height:1; display:flex; justify-content:center;"><i class="fas fa-arrow-down"></i></div>';
        const contentMaxWidthPx = isEn ? 660 : 620;
        const exampleShiftPx = 14;

        const exampleFolderName = isEn
            ? `bookmark-canvas-${ymd} (example)/`
            : `书签画布-${ymd}（示例）/`;

        const intro = isEn
            ? 'Please follow the steps below to ensure Obsidian can locate the exported .md files.'
            : '请按以下流程选择位置，确保 Obsidian 能正确找到导出的 .md 文件。';

        const stepTitle = isEn
            ? `Where will you place <code>${exampleFolderName}</code> inside your Obsidian vault?`
            : `把 <code>${exampleFolderName}</code> 放入 Obsidian vault（仓库）里的哪个位置。`;

        const stepA = isEn
            ? `If you put it under an existing vault's ${hl('root')}, keep the default value and ${hl('click Confirm')}.`
            : `-若把它直接放在${hl('已有仓库的根目录')}下，请保持默认值，${hl('直接点击确认')}即可。`;

        const stepB = isEn
            ? `If you put it under an existing vault's ${hl('subfolder')}, enter the ${hl('relative path')}.`
            : `-若把它放在${hl('已有仓库的某个子文件夹')}下，请输入${hl('相对路径')}。`;

        const stepBExample = isEn
            ? `<div style="position:relative;text-align:center;">
  <span style="position:absolute;left:0;font-weight:600;">Put into:</span>
  <span style="display:inline-block; transform: translateX(${exampleShiftPx}px);"><code>Personal/Bookmarks/...</code></span>
</div>
<div style="transform: translateX(${exampleShiftPx}px);">${arrow}</div>
<div style="text-align:center;">Input: <code>Personal/Bookmarks/${defaultExportRoot}</code></div>`
            : `<div style="position:relative;text-align:center;">
  <span style="position:absolute;left:0;font-weight:600;">放入：</span>
  <span style="display:inline-block; transform: translateX(${exampleShiftPx}px);"><code>个人/书签/...</code></span>
</div>
<div style="transform: translateX(${exampleShiftPx}px);">${arrow}</div>
<div style="text-align:center;">输入框填：<code>个人/书签/${defaultExportRoot}</code> 即可</div>`;

        const stepC = isEn
            ? `If you use it as a ${hl('standalone vault')}, ${hl('clear the input')} and click Confirm.`
            : `-若把它直接作为一个独立的仓库，请${hl('清空输入框')}，点击确认即可。`;

        const formatLabel = isEn ? 'Content Format:' : '内容格式：';
        const formatOptionVisual = isEn ? 'Visual Cards (HTML)' : '视觉卡片 (HTML)';
        const formatOptionVisualDesc = isEn ? 'Best for viewing, looks like cards.' : '类似卡片网格，适合查看与存档。';
        const formatOptionEdit = isEn ? 'Editable (Headings + List)' : '编辑模式 (标题 + 列表)';
        const formatOptionEditDesc = isEn ? 'Best for editing, uses standard Markdown.' : '使用标准 Markdown，利于编辑和整理。';

        const inputLabel = isEn
            ? 'Enter path'
            : '请输入路径';

        const dialog = document.createElement('div');
        dialog.className = 'import-dialog';
        dialog.id = 'canvasExportVaultPrefixDialog';
        dialog.innerHTML = `
		            <div class="import-dialog-content" style="width:max-content;max-width:min(92vw, ${contentMaxWidthPx}px);box-sizing:border-box;">
			                <div class="import-dialog-header">
			                    <h3>${title}</h3>
			                    <button class="import-dialog-close" id="closeCanvasExportVaultPrefixDialog" style="transform: translateY(1px);">&times;</button>
			                </div>
	                <div class="import-dialog-body" style="padding: 18px;">
	                    <div style="margin: 0 0 6px; font-weight: 600;">${inputLabel}</div>
	                    <div style="display:flex; gap:8px; align-items:center;">
	                        <input id="canvasExportVaultPrefixInput" type="text" style="flex:1; padding: 9px 10px; border: 1px solid #d0d7de; border-radius: 8px;" />
	                        <button id="canvasExportVaultPrefixOk" class="import-option-btn" style="width:auto; padding: 9px 12px;">
	                            ${isEn ? 'OK' : '确定'}
	                        </button>
	                    </div>

                        <div style="margin-top: 16px;">
                            <div style="margin: 0 0 8px; font-weight: 600;">${formatLabel}</div>
                            <div style="display: flex; gap: 12px; flex-direction: column;">
                                <label style="display: flex; align-items: flex-start; gap: 8px; cursor: pointer;">
                                    <input type="radio" name="canvasExportFormat" value="visual" checked style="margin-top: 4px;">
                                    <div>
                                        <div style="font-weight: 600; font-size: 13px;">${formatOptionVisual}</div>
                                        <div style="font-size: 12px; color: #666;">${formatOptionVisualDesc}</div>
                                    </div>
                                </label>
                                <label style="display: flex; align-items: flex-start; gap: 8px; cursor: pointer;">
                                    <input type="radio" name="canvasExportFormat" value="editable" style="margin-top: 4px;">
                                    <div>
                                        <div style="font-weight: 600; font-size: 13px;">${formatOptionEdit}</div>
                                        <div style="font-size: 12px; color: #666;">${formatOptionEditDesc}</div>
                                    </div>
                                </label>
                            </div>
                        </div>

                    <hr style="border:0;border-top:1px solid #e5e7eb;margin: 16px 0 12px;">

                    <div style="margin-bottom: 10px; line-height: 1.6;">
                        <div style="margin-bottom: 8px;">${intro}</div>
                        <div style="margin: 6px 0 10px; font-weight: 600;">${stepTitle}</div>
                        <div style="border-top:1px solid #e5e7eb;width:60%;margin: 6px 0 10px;"></div>
                        <div style="margin: 6px 0;">${stepA}</div>
	                        <div style="margin: 10px 0 6px;">${stepB}</div>
	                        <div style="margin: 6px 0 10px; text-align: center;">
	                            <div style="display: inline-block; padding: 4px 8px; border: 1px solid #e5e7eb; border-radius: 10px; background: rgba(255, 255, 255, 0.04); line-height: 1.5; box-sizing: border-box; text-align: center; max-width: 100%;">
	                                <div style="font-weight: 600; margin: 0 0 1px; text-align: left;">${isEn ? 'Example:' : '例如：'}</div>
	                                <div style="text-align: center;">
	                                    ${stepBExample}
	                                </div>
	                            </div>
	                        </div>
	                        <div style="margin: 6px 0 0;">${stepC}</div>
                    </div>
                </div>
            </div>
        `;

        const cleanup = (val) => {
            try { dialog.remove(); } catch (_) { }
            resolve(val);
        };

        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) cleanup(null);
        });

        document.body.appendChild(dialog);

        const closeBtn = document.getElementById('closeCanvasExportVaultPrefixDialog');
        if (closeBtn) closeBtn.addEventListener('click', () => cleanup(null));

        const getFormat = () => {
            const el = document.querySelector('input[name="canvasExportFormat"]:checked');
            return el ? el.value : 'visual';
        };

        const input = document.getElementById('canvasExportVaultPrefixInput');
        if (input) {
            input.value = String(defaultValue || '');
            try { input.focus(); input.select(); } catch (_) { }
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    cleanup({
                        path: String(input.value || ''),
                        format: getFormat()
                    });
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cleanup(null);
                }
            });
        }



        const okBtn = document.getElementById('canvasExportVaultPrefixOk');
        if (okBtn) okBtn.addEventListener('click', () => cleanup({
            path: input ? String(input.value || '') : String(defaultValue || ''),
            format: getFormat()
        }));
    });

    // 让用户决定"导出文件夹在 vault 内的相对位置"，以适配：
    // - vault 根目录下（默认）：bookmark-canvas-export/...
    // - vault 的子文件夹下：SomeFolder/bookmark-canvas-export/...
    // - 或把 bookmark-canvas-export/ 直接作为一个独立 vault 根目录（portable canvas）

    // 只有 Obsidian 模式才需要路径配置对话框
    // 全量备份模式直接使用默认路径
    // 全量备份模式直接使用默认路径
    let vaultPrefixInput;
    let exportFormat = 'visual'; // 'visual' | 'editable'

    if (isFullBackupMode) {
        // 全量备份模式：直接使用默认值，不显示路径对话框
        vaultPrefixInput = defaultExportRoot;
    } else {
        // Obsidian 模式：显示路径配置对话框
        const result = await promptVaultPrefixViaDialog(defaultExportRoot);
        if (result === null) {
            return;
        }
        vaultPrefixInput = result.path;
        exportFormat = result.format || 'visual';

    }
    const vaultPrefix = normalizeVaultPrefix(vaultPrefixInput);

    const isValidFolderPath = (p) => {
        if (!p) return true;
        const segs = String(p).split('/');
        for (const seg of segs) {
            if (!seg || seg === '.' || seg === '..') return false;
            if (/[<>:"\\|?*\x00-\x1F]/.test(seg)) return false;
            if (/[. ]$/.test(seg)) return false;
        }
        return true;
    };

    if (vaultPrefix && !isValidFolderPath(vaultPrefix)) {
        alert(isEn ? 'Invalid folder path. Please use a valid folder name.' : '路径不合法，请使用合法的文件夹命名。');
        return;
    }

    const exportRoot = vaultPrefix ? vaultPrefix.split('/').slice(-1)[0] : defaultExportRoot;

    // 1) Markdown files
    // 1) Markdown files
    const bookmarkTree = await api.getTree();
    const permanentMdRel = isEn ? 'Permanent Sections.md' : '永久栏目.md';

    // Choose builder based on format
    const permanentBuilder = exportFormat === 'editable' ? __buildPermanentBookmarksMarkdownEditable : __buildPermanentBookmarksMarkdown;
    files.push({ name: `${exportRoot}/${permanentMdRel}`, data: __toUint8(permanentBuilder(bookmarkTree)) });

    const tempSectionMdPaths = [];
    const tempMdFolder = isEn ? 'Temporary Sections' : '临时栏目';
    CanvasState.tempSections.forEach((section) => {
        if (!section || !section.id) return;

        const seqLabel = getTempSectionLabel(section);
        const rawTitle = section.title || (isEn ? 'Temp Section' : '临时栏目');
        const fileTitle = seqLabel ? `${seqLabel}. ${rawTitle}` : rawTitle;
        const safeTitle = __sanitizeFilename(fileTitle);

        const rel = `${tempMdFolder}/${safeTitle}.md`;
        tempSectionMdPaths.push({ id: section.id, rel });

        // Choose builder based on format
        const tempBuilder = exportFormat === 'editable' ? __buildTempSectionMarkdownEditable : __buildTempSectionMarkdown;
        files.push({ name: `${exportRoot}/${rel}`, data: __toUint8(tempBuilder(section)) });
    });

    const mdNodeMdPaths = [];
    const mdNodeFolder = isEn ? 'Blank Sections' : '空白栏目';
    const usedNodePaths = new Set();

    (CanvasState.mdNodes || []).forEach((node) => {
        if (!node || !node.id) return;

        // Use first line of text as filename
        let titleCandidate = (node.text || '').replace(/\u200B/g, '').trim();
        if (!titleCandidate && node.html) {
            const div = document.createElement('div');
            div.innerHTML = node.html;
            titleCandidate = (div.textContent || '').replace(/\u200B/g, '').trim();
        }
        titleCandidate = titleCandidate.split('\n')[0].trim();

        let safeName = __sanitizeFilename(titleCandidate);
        if (!safeName || safeName === 'Untitled') safeName = node.id;

        let rel = `${mdNodeFolder}/${safeName}.md`;
        // Handle name collision
        if (usedNodePaths.has(rel)) {
            rel = `${mdNodeFolder}/${safeName}_${node.id}.md`;
        }
        usedNodePaths.add(rel);

        mdNodeMdPaths.push({ id: node.id, rel });
        files.push({ name: `${exportRoot}/${rel}`, data: __toUint8(__buildMdNodeMarkdown(node)) });
    });

    const buildCanvasData = ({ vaultRelativePrefix }) => {
        // Obsidian Canvas 的 file 节点保存的是 vault-relative path（相对 vault 根目录的路径）。
        // 因此若用户把导出文件夹放在 vault 的子目录中，需要把该子目录前缀写进 file 字段。
        const prefix = normalizeVaultPrefix(vaultRelativePrefix);
        const withPrefix = (relPath) => {
            const rel = String(relPath || '').replace(/^\/+/, '');
            return prefix ? `${prefix}/${rel}` : rel;
        };
        const canvasData = { nodes: [], edges: [] };

        const permanentSectionEl = document.getElementById('permanentSection');
        const permanentLeft = permanentSectionEl ? (parseFloat(permanentSectionEl.style.left) || 0) : 0;
        const permanentTop = permanentSectionEl ? (parseFloat(permanentSectionEl.style.top) || 0) : 0;
        const permanentW = permanentSectionEl ? (permanentSectionEl.offsetWidth || 600) : 600;
        const permanentH = permanentSectionEl ? (permanentSectionEl.offsetHeight || 600) : 600;
        canvasData.nodes.push({
            id: 'permanent-section',
            type: 'file',
            x: Math.round(permanentLeft),
            y: Math.round(permanentTop),
            width: Math.round(permanentW),
            height: Math.round(permanentH),
            file: withPrefix(permanentMdRel),
            color: '4'
        });

        tempSectionMdPaths.forEach(({ id, rel }) => {
            const section = CanvasState.tempSections.find(s => s && s.id === id);
            if (!section) return;
            canvasData.nodes.push({
                id,
                type: 'file',
                x: Math.round(section.x || 0),
                y: Math.round(section.y || 0),
                width: Math.round(section.width || TEMP_SECTION_DEFAULT_WIDTH),
                height: Math.round(section.height || TEMP_SECTION_DEFAULT_HEIGHT),
                file: withPrefix(rel),
                color: section.color || null
            });
        });

        mdNodeMdPaths.forEach(({ id, rel }) => {
            const node = (CanvasState.mdNodes || []).find(n => n && n.id === id);
            if (!node) return;
            const color = node.colorHex || node.color || null;
            canvasData.nodes.push({
                id,
                type: 'file',
                x: Math.round(node.x || 0),
                y: Math.round(node.y || 0),
                width: Math.round(node.width || MD_NODE_DEFAULT_WIDTH),
                height: Math.round(node.height || MD_NODE_DEFAULT_HEIGHT),
                file: withPrefix(rel),
                ...(color ? { color } : {})
            });
        });

        if (Array.isArray(CanvasState.edges)) {
            canvasData.edges = CanvasState.edges.map(edge => {
                const dir = edge.direction || 'none';
                const fromEnd = (dir === 'both') ? 'arrow' : 'none';
                const toEnd = (dir === 'forward' || dir === 'both') ? 'arrow' : 'none';
                const colorHex = edge.colorHex || presetToHex(edge.color) || null;
                const base = {
                    id: edge.id,
                    fromNode: edge.fromNode,
                    fromSide: edge.fromSide || 'right',
                    toNode: edge.toNode,
                    toSide: edge.toSide || 'left',
                    fromEnd,
                    toEnd
                };
                if (edge.label && String(edge.label).trim()) base.label = edge.label;
                if (colorHex) base.color = colorHex;
                return base;
            });
        }

        return canvasData;
    };

    // 2) .canvas file
    // 由用户输入的 vaultPrefix 决定 .canvas 内的 file 路径：
    // - vault 根目录：保持默认（bookmark-canvas-export）
    // - vault 子目录：填写 Exports/bookmark-canvas-export
    // - 独立 vault：留空（file 路径将是 permanent-bookmarks.md / temp-sections/...）
    const canvasForVault = buildCanvasData({ vaultRelativePrefix: vaultPrefix });
    const canvasFileName = `${exportRoot}.canvas`;
    files.push({ name: `${exportRoot}/${canvasFileName}`, data: __toUint8(JSON.stringify(canvasForVault, null, 2)) });

    // 3) Full state json (for full import)
    const tempStateRaw = localStorage.getItem(TEMP_SECTION_STORAGE_KEY);
    const permanentPosRaw = localStorage.getItem('permanent-section-position');
    const perfMode = localStorage.getItem('canvas-performance-mode');

    // Collect scroll positions
    const scrollState = {};
    const permanentScroll = localStorage.getItem('permanent-section-scroll');
    if (permanentScroll) {
        try { scrollState['permanent-section-scroll'] = JSON.parse(permanentScroll); } catch (_) { }
    }
    // Collect temp section scroll positions
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('temp-section-scroll:')) {
            try {
                scrollState[key] = JSON.parse(localStorage.getItem(key));
            } catch (_) { }
        }
    }

    // 3.1) Supplementary layer (bookmark-canvas.full.json) - 补充层
    // [CHANGED] We no longer export 'style-data.json' for Obsidian Mode.
    // Obsidian Mode relies purely on .canvas and .md files to ensure edits in Obsidian are preserved.
    // We only keep this object construction if we want to include it in Full Backup (merged) or for legacy reasons.
    // For now, only generate it if specifically needed, but per request, we stop exporting it for standard Obsidian export.
    /* 
    const fullState = { ... };
    files.push({ name: `${exportRoot}/bookmark-canvas.style-data.json`, data: __toUint8(JSON.stringify(fullState, null, 2)) });
    */

    // 3.2) Core data layer (bookmark-canvas.backup.json) - 核心数据层
    // 仅在"模式 B"（全量备份模式）下生成
    if (isFullBackupMode) {
        const backupState = {
            exporter: 'bookmark-backup-canvas',
            exportVersion: 2, // 核心数据层使用版本2
            exportedAt,
            exportMode: 'full-backup',
            description: isEn
                ? 'Full backup file for Bookmark Canvas. Contains complete bookmark tree and all canvas data.'
                : '书签画布完整备份文件。包含完整的书签树和所有画布数据。',
            storage: {
                [TEMP_SECTION_STORAGE_KEY]: tempStateRaw ? JSON.parse(tempStateRaw) : null,
                'permanent-section-position': permanentPosRaw ? JSON.parse(permanentPosRaw) : null,
                'canvas-performance-mode': perfMode || null,
                ...scrollState
            },
            // 核心数据层包含完整书签树快照
            permanentTreeSnapshot: bookmarkTree,
            // 包含当前画布所有栏目的完整数据对象树
            canvasState: {
                tempSections: CanvasState.tempSections,
                mdNodes: CanvasState.mdNodes,
                edges: CanvasState.edges,
                tempSectionCounter: CanvasState.tempSectionCounter,
                mdNodeCounter: CanvasState.mdNodeCounter,
                edgeCounter: CanvasState.edgeCounter
            }
        };
        files.push({ name: `${exportRoot}/bookmark-canvas.backup.json`, data: __toUint8(JSON.stringify(backupState, null, 2)) });
    }

    // 4) Import guide for Obsidian

    const readmeName = isEn ? 'README_Import_Rules.md' : '说明_导入规则.md';
    const compatText = isEn
        ? `
# README

All exported content is fully supported. Please note the following:

## 1. Bookmarks
You can freely view and edit bookmark content in Obsidian. Note:
- **Structure**: If you plan to re-import this data, please do **NOT** rename files or change the folder structure.
- **Additions**: You can use standard Obsidian features (links, tags). Avoid complex non-standard modifications if re-import is needed.

## 2. Text Editing
You are free to edit Markdown content in Obsidian.
> **Note**: Edits made in Obsidian are for external use only and will **NOT** be reflected if you re-import this package. Import restores the exact state at the time of export.

## 3. Connection Lines
Fully compatible with Obsidian Canvas.

## 4. Grouping (v3.0 Limitation)
The current version (v3.0) does **NOT** support Obsidian's native grouping feature. Groups created in Obsidian cannot be re-imported.
`
        : `
# 说明

所有导出的内容均完全支持。请注意以下事项：

## 1. 书签
可以在 Obsidian 中自由查看和编辑书签内容。注意：
- **结构保持**：若您计划将此数据**重新导入**回本扩展，请**不要**修改文件名或目录结构。
- **新增内容**：支持标准 Obsidian 语法。若为了再次导入，请避免破坏原有的元数据格式。

## 2. 文本编辑
可以在 Obsidian 中自由编辑 Markdown 内容。
> **注意**：在 Obsidian 中的修改仅供外部使用，重新导入包时**不会**包含这些修改（导入将恢复导出时的原始状态）。

## 3. 连接线
与 Obsidian Canvas 完全兼容。

## 4. 分组（v3.0 限制）
当前版本（v3.0）**不支持** Obsidian 原生分组功能。在 Obsidian 中创建的分组无法重新导入。
`;

    const isVisualExport = exportFormat === 'visual';
    const aiGuideText = isEn
        ? [
            `## AI Editing/Import Guidelines (${isVisualExport ? 'Visual Export' : 'Editable Export'})`,
            '',
            'The following rules are based on the current Obsidian-compatible import/export implementation to keep structure stable.',
            '',
            '### 0. General',
            '- You **may** rename files or folders, **but** you must update the `.canvas` `file` paths to match the new `.md` locations.',
            '- Do not add Obsidian Group nodes (v3.0 does not support groups).',
            '',
            '### 1. Permanent Section (`Permanent Sections.md`)',
            '- Do **not** rename the permanent section file. Keep it as `Permanent Sections.md` so the importer can recognize it.',
            ...(isVisualExport
                ? [
                    '- Bookmarks: keep `<a href>` links.',
                    '- Folders: keep `<details> / <summary>` structure.'
                ]
                : [
                    '- Root groups use `##` (e.g., Bookmark Bar / Other Bookmarks).',
                    '- Folder levels use headings `###` → `######` (H3–H6).',
                    '- Deeper folders (beyond H6) must use nested list: `- 📁 **Title**` with indentation.',
                    '- Bookmarks: `- [Title](URL)`.'
                ]),
            '',
            '### 2. Temporary Sections (`Temporary Sections/*.md`)',
            '- If you rename files or add/remove sections, **synchronize the `.canvas` file** so `file` paths and node IDs match.',
            ...(isVisualExport
                ? [
                    '- Bookmarks: keep `<a href>` links.',
                    '- Folders: keep `<details> / <summary>` structure.'
                ]
                : [
                    '- Folder levels use headings `###` → `######` (H3–H6).',
                    '- Deeper folders (beyond H6) must use nested list: `- 📁 **Title**` with indentation.',
                    '- Bookmarks: `- [Title](URL)`.'
                ]),
            '',
            '### 3. Blank Sections (`Blank Sections/*.md`)',
            '- Free-form text is allowed. If you rename files or add/remove nodes, **synchronize the `.canvas` file** so `file` paths and node IDs match.',
            ...(isVisualExport
                ? [
                    '',
                    '### 4. Visual Mode (HTML Cards)',
                    '- Keep the structure: `<details> / <summary> / <a href>`.',
                    '- Each node must keep its outer `<div>` wrapper, otherwise items may be lost.'
                ]
                : []),
            '',
            '### 5. Edges & Positions (`.canvas`)',
            '- You may edit `x/y/width/height`. Import will preserve relative positions (batch offset applied).',
            '- Edges must reference valid node IDs; if you change an ID, update edges too.',
            '- Known limitation: Obsidian import mainly keeps basic connections; color/direction may be lost and some edges can be ignored.',
            '',
            '### 6. URL Schemes',
            '- Only these schemes are safely imported: `http/https/ftp/mailto/tel/obsidian/zotero/onenote/notion/vscode/raycast`.',
            '- `chrome://`, `edge://`, `javascript:`, `data:` may be filtered or marked as `unsafe:`.',
            '',
            '### Import Steps'
        ].join('\n')
        : [
            `## 修改/导入规范（AI专用）（${isVisualExport ? '可视化导出' : '编辑模式导出'}）`,
            '',
            '以下规范基于当前导入/导出实现（Obsidian 兼容模式），用于**保证结构稳定、可被正确导入**：',
            '',
            '### 0. 总原则',
            '- **允许**修改文件名或目录结构，但必须同步修改 `.canvas` 里的 `file` 路径，使其能找到对应 `.md`。',
            '- 不要新增 Obsidian 的分组（Group）节点（v3.0 不支持）。',
            '',
            '### 1. 永久栏目（`永久栏目.md`）',
            '- 永久栏目文件名**不要改**（保持为 `永久栏目.md`），否则导入识别会失败。',
            ...(isVisualExport
                ? [
                    '- 书签：保留 `<a href>` 链接。',
                    '- 文件夹：保留 `<details> / <summary>` 结构。'
                ]
                : [
                    '- 根分组使用 `##`（如：书签栏 / 其他书签）。',
                    '- 文件夹层级使用标题 `###` → `######`（H3–H6）。',
                    '- 超过 H6 的更深层文件夹使用缩进列表：`- 📁 **标题**`。',
                    '- 书签：`- [标题](URL)`。'
                ]),
            '',
            '### 2. 临时栏目（`临时栏目/*.md`）',
            '- 若重命名或新增/删除临时栏目文件，请**同步修改 `.canvas`**，确保 `file` 路径与节点 ID 一致。',
            ...(isVisualExport
                ? [
                    '- 书签：保留 `<a href>` 链接。',
                    '- 文件夹：保留 `<details> / <summary>` 结构。'
                ]
                : [
                    '- 文件夹层级使用标题 `###` → `######`（H3–H6）。',
                    '- 超过 H6 的更深层文件夹使用缩进列表：`- 📁 **标题**`。',
                    '- 书签：`- [标题](URL)`。'
                ]),
            '',
            '### 3. 空白栏目（`空白栏目/*.md`）',
            '- 可自由编辑；若重命名或新增/删除空白栏目文件，请**同步修改 `.canvas`**，确保 `file` 路径与节点 ID 一致。',
            ...(isVisualExport
                ? [
                    '',
                    '### 4. 可视化模式（HTML 卡片）',
                    '- 必须保留结构：`<details> / <summary> / <a href>`。',
                    '- 每个节点必须保留外层 `<div>` 包裹，否则可能丢失节点。'
                ]
                : []),
            '',
            '### 5. 连接线与位置（`.canvas`）',
            '- 位置可改：`x/y/width/height` 会被导入（导入时会整体平移，保持相对位置）。',
            '- 连接线需保证 `fromNode/toNode` 指向存在的节点 ID；改 ID 要同步改边。',
            '- 已知限制：Obsidian 模式导入主要保留基础连线关系，颜色/方向等可能丢失，部分连线可能被忽略。',
            '',
            '### 6. URL 协议限制',
            '- 仅保证 `http/https/ftp/mailto/tel/obsidian/zotero/onenote/notion/vscode/raycast` 等协议安全导入。',
            '- `chrome://`、`edge://`、`javascript:`、`data:` 可能被过滤或标记为 `unsafe:`。',
            '',
            '### 导入步骤'
        ].join('\n');

    const guide = [
        __frontmatter({
            exportedAt,
            source: 'exportGuide',
            sourceId: 'bookmark-canvas-export',
            title: isEn ? 'Obsidian Import Rules' : 'Obsidian 导入规则'
        }),
        compatText,
        '',
        '-----------------------------------------------------------------------------',
        aiGuideText,
        isEn ? `1) Unzip: ${exportRoot}.zip` : `1）解压：${exportRoot}.zip`,
        isEn
            ? `2) Put the folder \`${exportRoot}/\` into your vault at: \`${(vaultPrefix ? (vaultPrefix.split('/').slice(0, -1).join('/') || '(vault root)') : '(standalone vault)')}\`.`
            : `2）把文件夹 \`${exportRoot}/\` 放到仓库：\`${(vaultPrefix ? (vaultPrefix.split('/').slice(0, -1).join('/') || '（vault根目录）') : '（独立vault）')}\`。`,
        isEn
            ? `3) Open: \`${exportRoot}/${canvasFileName}\`.`
            : `3）打开：\`${exportRoot}/${canvasFileName}\`。`,
        '',
        isEn
            ? 'If you only copy the .canvas file without the .md files, Canvas will show “.md could not be found”.'
            : '注意：如果只拷贝 .canvas 文件而没有同时拷贝对应的 .md 文件，Canvas 会显示“.md could not be found”。',
        ''
    ].join('\n');
    files.push({ name: `${exportRoot}/${readmeName}`, data: __toUint8(guide) });

    const zipBlob = __zipStore(files);
    const zipUrl = URL.createObjectURL(zipBlob);
    const zipName = `${exportRoot}.zip`;

    // 优先使用 downloads API：支持子目录（浏览器默认下载目录下的 bookmark-canvas-export/）
    if (chrome && chrome.downloads && typeof chrome.downloads.download === 'function') {
        chrome.downloads.download({
            url: zipUrl,
            filename: `${downloadFolder}/${zipName}`,
            saveAs: false,
            conflictAction: 'uniquify'
        }, (downloadId) => {
            if (chrome.runtime && chrome.runtime.lastError) {
                console.warn('[Canvas] chrome.downloads.download failed, fallback to <a> tag:', chrome.runtime.lastError);
                const a = document.createElement('a');
                a.href = zipUrl;
                a.download = zipName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(zipUrl), 10000);
            } else {
                setTimeout(() => URL.revokeObjectURL(zipUrl), 10000);
            }
        });
    } else {
        const a = document.createElement('a');
        a.href = zipUrl;
        a.download = zipName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(zipUrl), 10000);
    }

    alert(isEn
        ? `Exported: ${zipName}(Downloads / ${downloadFolder} /)`
        : `已导出：${zipName}（默认下载目录 / ${downloadFolder} /）。`);
}

/**
 * 解压 ZIP 文件（支持 store 和 deflate 压缩方式）
 * 使用中央目录方式解析，正确支持 macOS 压缩的 ZIP 文件
 * @param {ArrayBuffer} arrayBuffer - ZIP 文件的 ArrayBuffer
 * @returns {Promise<Map<string, Uint8Array>>} - 文件名到内容的 Map
 */
async function __unzipStore(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const files = new Map();

    const readU16 = (o) => dv.getUint16(o, true);
    const readU32 = (o) => dv.getUint32(o, true);

    // 检查是否支持 DecompressionStream
    const supportsDeflate = typeof DecompressionStream !== 'undefined';

    // 1. 查找 End of Central Directory (EOCD)
    let eocdOffset = -1;
    for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 65536; i--) {
        if (readU32(i) === 0x06054b50) {
            eocdOffset = i;
            break;
        }
    }

    if (eocdOffset === -1) {
        throw new Error('无效的 ZIP 文件：未找到中央目录');
    }

    const cdEntryCount = readU16(eocdOffset + 10);
    const cdOffset = readU32(eocdOffset + 16);
    console.log(`[ZIP] 中央目录: ${cdEntryCount} 个条目, 偏移 ${cdOffset}`);

    // 2. 遍历中央目录
    let cdPos = cdOffset;
    for (let i = 0; i < cdEntryCount; i++) {
        if (cdPos + 46 > bytes.length || readU32(cdPos) !== 0x02014b50) break;

        const gpFlag = readU16(cdPos + 8);
        const method = readU16(cdPos + 10);
        const compSize = readU32(cdPos + 20);
        const nameLen = readU16(cdPos + 28);
        const extraLen = readU16(cdPos + 30);
        const commentLen = readU16(cdPos + 32);
        const localOffset = readU32(cdPos + 42);

        const name = new TextDecoder(gpFlag & 0x0800 ? 'utf-8' : 'utf-8')
            .decode(bytes.slice(cdPos + 46, cdPos + 46 + nameLen));

        cdPos += 46 + nameLen + extraLen + commentLen;

        // 跳过目录和 macOS 元数据
        const baseName = name.split('/').pop();
        if (name.endsWith('/') || name.includes('__MACOSX') || baseName.startsWith('._')) {
            console.log(`[ZIP] 跳过: ${name}`);
            continue;
        }

        // 3. 读取本地文件头获取数据位置
        const localNameLen = readU16(localOffset + 26);
        const localExtraLen = readU16(localOffset + 28);
        const dataStart = localOffset + 30 + localNameLen + localExtraLen;
        const compressedData = bytes.slice(dataStart, dataStart + compSize);

        console.log(`[ZIP] 条目: "${name}", method=${method}, size=${compSize}`);

        // 4. 解压
        if (method === 0) {
            files.set(name, compressedData);
        } else if (method === 8) {
            if (!supportsDeflate) {
                throw new Error('浏览器不支持 Deflate 解压');
            }
            const decompressed = await __inflateDeflate(compressedData);
            files.set(name, decompressed);
            console.log(`[ZIP] 解压: ${name}, ${compSize} -> ${decompressed.length}`);
        } else {
            throw new Error(`不支持的压缩方法 ${method}`);
        }
    }

    console.log(`[ZIP] 完成，共 ${files.size} 个文件`);
    return files;
}

/**
 * 使用 DecompressionStream 解压 Deflate 数据
 * @param {Uint8Array} compressed - 压缩的数据
 * @returns {Promise<Uint8Array>} - 解压后的数据
 */
async function __inflateDeflate(compressed) {
    // DecompressionStream 需要 'deflate-raw' 格式（不带 zlib 头）
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();

    // 写入压缩数据
    writer.write(compressed);
    writer.close();

    // 读取解压后的数据
    const chunks = [];
    let totalLength = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalLength += value.length;
    }

    // 合并所有块
    const result = new Uint8Array(totalLength);
    let pos = 0;
    for (const chunk of chunks) {
        result.set(chunk, pos);
        pos += chunk.length;
    }

    return result;
}

function __resetCanvasDomAndStateForImport() {
    const container = document.getElementById('canvasContent');
    if (container) {
        container.querySelectorAll('.temp-canvas-node').forEach(el => el.remove());
        container.querySelectorAll('.md-canvas-node').forEach(el => el.remove());
    }
    CanvasState.tempSections = [];
    CanvasState.mdNodes = [];
    CanvasState.edges = [];
    CanvasState.tempSectionCounter = 0;
    CanvasState.tempItemCounter = 0;
    CanvasState.colorCursor = 0;
    CanvasState.mdNodeCounter = 0;
    CanvasState.edgeCounter = 0;
    CanvasState.selectedTempSectionId = null;
    CanvasState.selectedMdNodeId = null;
    CanvasState.selectedEdgeId = null;
    try { hideEdgeToolbar(); } catch (_) { }
    try { clearTempSelection(); } catch (_) { }
    try { clearMdSelection(); } catch (_) { }
}

function __applyImportedTempState(state) {
    if (!state || typeof state !== 'object') throw new Error('导入失败：状态文件无效');
    CanvasState.tempSections = Array.isArray(state.sections) ? state.sections : [];
    CanvasState.tempSectionCounter = state.tempSectionCounter || CanvasState.tempSections.length;
    CanvasState.tempItemCounter = state.tempItemCounter || 0;
    CanvasState.colorCursor = state.colorCursor || 0;
    CanvasState.mdNodes = Array.isArray(state.mdNodes) ? state.mdNodes : [];
    CanvasState.mdNodeCounter = state.mdNodeCounter || CanvasState.mdNodes.length || 0;
    CanvasState.edges = Array.isArray(state.edges) ? state.edges : [];
    CanvasState.edgeCounter = state.edgeCounter || CanvasState.edges.length || 0;

    CanvasState.tempSections.forEach(section => {
        try { renderTempNode(section); } catch (e) { console.warn('[Canvas] 渲染临时栏目失败:', e); }
    });
    CanvasState.mdNodes.forEach(node => {
        try { renderMdNode(node); } catch (e) { console.warn('[Canvas] 渲染空白栏目失败:', e); }
    });
    try { renderEdges(); } catch (_) { }

    try { reorderSectionSequenceNumbers(); } catch (_) { }
    try { updateCanvasScrollBounds(); } catch (_) { }
    try { updateScrollbarThumbs(); } catch (_) { }
    try { scheduleDormancyUpdate(); } catch (_) { }
}

async function importCanvasPackageZip(file) {
    const { isEn } = __getLang();
    const buf = await file.arrayBuffer();
    const zipFiles = await __unzipStore(buf);

    // 4.2 数据信任链：
    // 优先查找 bookmark-canvas.backup.json（全量备份模式）
    // 若不存在，则尝试查找 .canvas 文件（Obsidian 兼容模式）
    let backupJsonName = null;
    let canvasFileName = null;

    // 记录所有文件用于调试
    console.log('[Canvas] ZIP 包含的文件:', Array.from(zipFiles.keys()));

    for (const name of zipFiles.keys()) {
        // 获取文件名（不含路径）
        const baseName = name.split('/').pop();

        // 查找 backup.json - 支持任意目录深度
        if (baseName === 'bookmark-canvas.backup.json') {
            backupJsonName = name;
            console.log('[Canvas] 找到备份文件:', name);
        }

        // 查找 .canvas 文件 - 支持任意目录深度
        if (baseName.endsWith('.canvas')) {
            if (!canvasFileName) {
                canvasFileName = name;
                console.log('[Canvas] 找到 canvas 文件:', name);
            }
        }
    }

    let tempState = null;
    let storage = null;
    let primaryState = {}; // Mock primary state for compatibility

    // Mode A: Full Backup (JSON)
    if (backupJsonName) {
        console.log(`[Canvas] Import using BACKUP mode: ${backupJsonName}`);
        const primaryJsonText = new TextDecoder('utf-8').decode(zipFiles.get(backupJsonName));
        primaryState = JSON.parse(primaryJsonText);
        storage = primaryState.storage || null;

        if (primaryState.canvasState) {
            tempState = {
                sections: primaryState.canvasState.tempSections || [],
                mdNodes: primaryState.canvasState.mdNodes || [],
                edges: primaryState.canvasState.edges || [],
                tempSectionCounter: primaryState.canvasState.tempSectionCounter || 0,
                mdNodeCounter: primaryState.canvasState.mdNodeCounter || 0,
                edgeCounter: primaryState.canvasState.edgeCounter || 0
            };
        } else if (storage && storage[TEMP_SECTION_STORAGE_KEY]) {
            tempState = storage[TEMP_SECTION_STORAGE_KEY];
        }
    }
    // Mode B: Obsidian Canvas (Reconstruct from .canvas + .md)
    else if (canvasFileName) {
        console.log(`[Canvas] Import using OBSIDIAN CANVAS mode: ${canvasFileName}`);
        const canvasText = new TextDecoder('utf-8').decode(zipFiles.get(canvasFileName));
        const canvasData = JSON.parse(canvasText);

        // Reconstruct tempState from Canvas Data
        tempState = {
            sections: [], // Will map Canvas Groups/Files to TempSections
            mdNodes: [],
            edges: [],
            tempSectionCounter: 0,
            mdNodeCounter: 0,
            edgeCounter: 0
        };

        // Helper to find file in zip
        const findFile = (relPath) => {
            // relPath in canvas is relative to canvas file. 
            // Zip keys might be "Root/Sub/File.md" or just "File.md".
            // We try exact match first or fuzzy match.
            // If canvasFileName is "Root/Board.canvas", then relPaths are relative to "Root/".

            // Simplification: We search for suffix match because we control the export structure.
            // Export structure: Root/File.md

            // Try strict match first assuming flattened structure or standard export
            if (zipFiles.has(relPath)) return zipFiles.get(relPath);

            // Try finding by suffix (e.g. "Temporary Sections/A. Foo.md")
            for (const [key, val] of zipFiles) {
                if (key.endsWith(relPath) || relPath.endsWith(key)) return val;
                // Handle path separators
                const normKey = key.replace(/\\/g, '/');
                const normRel = relPath.replace(/\\/g, '/');
                if (normKey.includes(normRel)) return val;
            }
            return null;
        };

        const nodes = canvasData.nodes || [];
        const edges = canvasData.edges || [];

        // Map Canvas ID to our ID
        const idMap = {};

        nodes.forEach(node => {
            if (node.type === 'file' && node.file && node.file.endsWith('.md')) {
                const fileBytes = findFile(node.file);
                if (!fileBytes) return;

                const fileText = new TextDecoder('utf-8').decode(fileBytes);

                // Identify type based on filename
                const isPermanent = node.file.includes('Permanent Sections') || node.file.includes('永久栏目') || node.file.includes('Permanent Bookmarks') || node.file.includes('永久书签');
                const isTempSection = node.file.includes('Temporary Sections/') || node.file.includes('临时栏目/');
                const isMdNode = node.file.includes('Blank Sections/') || node.file.includes('空白栏目/');

                if (isPermanent) {
                    // Reconstruct Snapshot Permanent Section
                    // We don't have the tree data in Mode A, but we have position.
                    // Wait, in Editable Mode, do we parse the MD to get the list?
                    // YES! If user edited it, we can recover it as a snapshot list!

                    const items = __parseMarkdownAuto(fileText);
                    const sectionId = node.id; // 使用原始 node.id 以便边缘正确映射
                    tempState.sections.push({
                        id: sectionId,
                        title: '[Restored] Permanent Sections',
                        x: node.x,
                        y: node.y,
                        width: node.width,
                        height: node.height,
                        color: convertObsidianColor(node.color) || '#44cf6e',
                        items: items, // Restored items!
                        isSnapshot: true
                    });
                    // We need to map this in storage for scroll if possible, but IDs changed.
                } else if (isTempSection) {
                    // Restore Temp Section
                    const items = __parseMarkdownAuto(fileText);
                    const sectionId = node.id; // Use canvas ID as base if possible, or gen new

                    // Extract title from filename or md content?
                    // Filename: "A. Title.md"
                    const fileName = node.file.split('/').pop().replace('.md', '');
                    // Regex to strip "A. "
                    const titleMatch = fileName.match(/^[A-Z]+\.\s+(.*)/);
                    const title = titleMatch ? titleMatch[1] : fileName;

                    // Sequence: map 'A' to number?
                    // Let's just generate new sequence or rely on import logic to reassign.

                    tempState.sections.push({
                        id: sectionId,
                        title: title,
                        x: node.x,
                        y: node.y,
                        width: node.width,
                        height: node.height,
                        color: convertObsidianColor(node.color) || '#fb464c',
                        items: items,
                        description: '' // todo: parse description from md if possible
                    });
                } else if (isMdNode) {
                    // Restore Blank Section
                    // MdNodes just need text content
                    const sectionId = node.id;
                    const convertedColor = convertObsidianColor(node.color);
                    const isHex = convertedColor && convertedColor.startsWith('#');
                    tempState.mdNodes.push({
                        id: sectionId,
                        x: node.x,
                        y: node.y,
                        width: node.width,
                        height: node.height,
                        color: isHex ? null : node.color,
                        colorHex: isHex ? convertedColor : null,
                        text: fileText // or html? markdown is fine, we render md
                    });
                }
            } else if (node.type === 'text') {
                // Direct text nodes in canvas?
                tempState.mdNodes.push({
                    id: node.id,
                    x: node.x,
                    y: node.y,
                    width: node.width,
                    height: node.height,
                    text: node.text
                });
            }
        });

        // Restore Edges
        /* 
        edges.forEach(edge => {
             // Map IDs and add to tempState.edges
             // Canvas uses 'fromNode', 'fromSide', 'toNode', 'toSide'
             // We use 'source', 'target'
             tempState.edges.push({
                 id: edge.id,
                 source: edge.fromNode,
                 target: edge.toNode,
                 label: edge.label || ''
             });
        });
        */
        // Edges logic is complex due to ID matching, let's skip for MVP or try direct map
        tempState.edges = edges.map(e => {
            const convertedColor = convertObsidianColor(e.color);
            // 如果是十六进制颜色，存储到 colorHex；如果是预设数字，存储到 color
            const isHex = convertedColor && convertedColor.startsWith('#');
            return {
                id: e.id,
                fromNode: e.fromNode,
                toNode: e.toNode,
                fromSide: e.fromSide || '',
                toSide: e.toSide || '',
                label: e.label || '',
                color: isHex ? null : e.color,
                colorHex: isHex ? convertedColor : null
            };
        });

    } else {
        throw new Error(isEn
            ? 'Invalid Package: Missing both backup.json and .canvas file.'
            : '无效包：缺少 backup.json 或 .canvas 文件。');
    }

    if (!tempState) {
        throw new Error(isEn ? 'Invalid package state.' : '导入包状态无效');
    }

    // 调用共享的沙箱导入处理逻辑
    __processSandboxedImport(tempState, storage, primaryState, file.name);
}

/**
 * 导入 7z 压缩包
 * 注意：7z 格式使用 LZMA/LZMA2 压缩，浏览器原生不支持
 * 暂时提示用户使用文件夹导入，未来可引入 7z 解压库
 */
async function importCanvasPackage7z(file) {
    const { isEn } = __getLang();

    // 检查文件头以确认是 7z 格式
    const buf = await file.arrayBuffer();
    const header = new Uint8Array(buf.slice(0, 6));
    const is7z = header[0] === 0x37 && header[1] === 0x7A &&
        header[2] === 0xBC && header[3] === 0xAF &&
        header[4] === 0x27 && header[5] === 0x1C;

    if (!is7z) {
        throw new Error(isEn
            ? 'Invalid 7z file format.'
            : '无效的 7z 文件格式。');
    }

    // 暂不支持直接解压 7z，提示用户使用文件夹导入
    throw new Error(isEn
        ? '.7z format requires external decompression. Please extract the archive first and use "Import Folder" instead.'
        : '.7z 格式需要外部解压。请先解压文件，然后使用「导入文件夹快照」功能。');
}

/**
 * 导入已解压的画布快照文件夹
 * 与 importCanvasPackageZip 类似，但处理的是已解压的文件夹
 * @param {Map<string, Uint8Array>} folderFiles - 文件夹中的文件 Map<路径, 内容>
 * @param {string} folderName - 文件夹名称
 */
async function importCanvasPackageFolder(folderFiles, folderName) {
    const { isEn } = __getLang();

    // 4.2 数据信任链：
    // 优先查找 bookmark-canvas.backup.json（全量备份模式）
    // 若不存在，则尝试查找 .canvas 文件（Obsidian 兼容模式）
    let backupJsonName = null;
    let canvasFileName = null;

    for (const name of folderFiles.keys()) {
        if (name.endsWith('/bookmark-canvas.backup.json') || name.endsWith('bookmark-canvas.backup.json')) {
            backupJsonName = name;
        }
        if (name.endsWith('.canvas') && !name.includes('/')) {
            canvasFileName = name;
        } else if (name.endsWith('.canvas')) {
            if (!canvasFileName) canvasFileName = name;
        }
    }

    let tempState = null;
    let storage = null;
    let primaryState = {};

    // Mode A: Full Backup (JSON)
    if (backupJsonName) {
        console.log(`[Canvas] Folder Import using BACKUP mode: ${backupJsonName}`);
        const primaryJsonText = new TextDecoder('utf-8').decode(folderFiles.get(backupJsonName));
        primaryState = JSON.parse(primaryJsonText);
        storage = primaryState.storage || null;

        if (primaryState.canvasState) {
            tempState = {
                sections: primaryState.canvasState.tempSections || [],
                mdNodes: primaryState.canvasState.mdNodes || [],
                edges: primaryState.canvasState.edges || [],
                tempSectionCounter: primaryState.canvasState.tempSectionCounter || 0,
                mdNodeCounter: primaryState.canvasState.mdNodeCounter || 0,
                edgeCounter: primaryState.canvasState.edgeCounter || 0
            };
        } else if (storage && storage[TEMP_SECTION_STORAGE_KEY]) {
            tempState = storage[TEMP_SECTION_STORAGE_KEY];
        }
    }
    // Mode B: Obsidian Canvas (Reconstruct from .canvas + .md)
    else if (canvasFileName) {
        console.log(`[Canvas] Folder Import using OBSIDIAN CANVAS mode: ${canvasFileName}`);
        const canvasText = new TextDecoder('utf-8').decode(folderFiles.get(canvasFileName));
        const canvasData = JSON.parse(canvasText);

        tempState = {
            sections: [],
            mdNodes: [],
            edges: [],
            tempSectionCounter: 0,
            mdNodeCounter: 0,
            edgeCounter: 0
        };

        // Helper to find file in folder
        const findFile = (relPath) => {
            if (folderFiles.has(relPath)) return folderFiles.get(relPath);

            for (const [key, val] of folderFiles) {
                if (key.endsWith(relPath) || relPath.endsWith(key)) return val;
                const normKey = key.replace(/\\/g, '/');
                const normRel = relPath.replace(/\\/g, '/');
                if (normKey.includes(normRel)) return val;
            }
            return null;
        };

        const nodes = canvasData.nodes || [];
        const edges = canvasData.edges || [];

        nodes.forEach(node => {
            if (node.type === 'file' && node.file && node.file.endsWith('.md')) {
                const fileBytes = findFile(node.file);
                if (!fileBytes) return;

                const fileText = new TextDecoder('utf-8').decode(fileBytes);

                const isPermanent = node.file.includes('Permanent Sections') || node.file.includes('永久栏目') || node.file.includes('Permanent Bookmarks') || node.file.includes('永久书签');
                const isTempSection = node.file.includes('Temporary Sections/') || node.file.includes('临时栏目/');
                const isMdNode = node.file.includes('Blank Sections/') || node.file.includes('空白栏目/');

                if (isPermanent) {
                    const items = __parseMarkdownAuto(fileText);
                    const sectionId = node.id; // 使用原始 node.id 以便边缘正确映射
                    tempState.sections.push({
                        id: sectionId,
                        title: '[Restored] Permanent Sections',
                        x: node.x,
                        y: node.y,
                        width: node.width,
                        height: node.height,
                        color: convertObsidianColor(node.color) || '#44cf6e',
                        items: items,
                        isSnapshot: true
                    });
                } else if (isTempSection) {
                    const items = __parseMarkdownAuto(fileText);
                    const sectionId = node.id;
                    const fileName = node.file.split('/').pop().replace('.md', '');
                    const titleMatch = fileName.match(/^[A-Z]+\.\s+(.*)/);
                    const title = titleMatch ? titleMatch[1] : fileName;

                    tempState.sections.push({
                        id: sectionId,
                        title: title,
                        x: node.x,
                        y: node.y,
                        width: node.width,
                        height: node.height,
                        color: convertObsidianColor(node.color) || '#fb464c',
                        items: items,
                        description: ''
                    });
                } else if (isMdNode) {
                    const sectionId = node.id;
                    const convertedColor = convertObsidianColor(node.color);
                    const isHex = convertedColor && convertedColor.startsWith('#');
                    tempState.mdNodes.push({
                        id: sectionId,
                        x: node.x,
                        y: node.y,
                        width: node.width,
                        height: node.height,
                        color: isHex ? null : node.color,
                        colorHex: isHex ? convertedColor : null,
                        text: fileText
                    });
                }
            } else if (node.type === 'text') {
                tempState.mdNodes.push({
                    id: node.id,
                    x: node.x,
                    y: node.y,
                    width: node.width,
                    height: node.height,
                    text: node.text
                });
            }
        });

        tempState.edges = edges.map(e => {
            const convertedColor = convertObsidianColor(e.color);
            const isHex = convertedColor && convertedColor.startsWith('#');
            return {
                id: e.id,
                fromNode: e.fromNode,
                toNode: e.toNode,
                fromSide: e.fromSide || '',
                toSide: e.toSide || '',
                label: e.label || '',
                color: isHex ? null : e.color,
                colorHex: isHex ? convertedColor : null
            };
        });

    } else {
        throw new Error(isEn
            ? 'Invalid Folder: Missing both backup.json and .canvas file.'
            : '无效文件夹：缺少 backup.json 或 .canvas 文件。');
    }

    if (!tempState) {
        throw new Error(isEn ? 'Invalid folder state.' : '文件夹状态无效');
    }

    __processSandboxedImport(tempState, storage, primaryState, folderName);
}

/**
 * 沙箱导入核心处理逻辑
 * 被 importCanvasPackageZip 和 importCanvasPackageJson 共同使用
 * @param {Object} tempState - 临时栏目状态数据
 * @param {Object} storage - 存储数据（滚动位置等）
 * @param {Object} primaryState - 原始状态对象（用于获取书签树快照等）
 * @param {string} [importFileName] - 导入的文件名
 */
function __processSandboxedImport(tempState, storage, primaryState, importFileName = '') {
    const { isEn } = __getLang();

    // 不再覆盖localStorage，而是直接进行沙箱导入
    // localStorage.setItem(TEMP_SECTION_STORAGE_KEY, JSON.stringify(tempState));

    // 1. Conflict Resolution & ID Remapping
    // We must remap ALL IDs in the imported state to prevent collision with existing nodes.
    // Also converts the imported "permanent-section" into a "Snapshot Temp Section".
    const { remappedNodes, remappedEdges, remappedScrolls } = __remapImportedData(tempState, storage, primaryState);

    // 2. Calculate Bounding Box of the imported batch
    const bounds = __calculateNodesBoundingBox(remappedNodes);

    // 3. Find "Empty Space" in the current layout
    // We look for the right-most edge of current content
    const currentContentRight = __findCurrentContentRightBound();
    const SPACING = 200;
    const targetX = currentContentRight + SPACING;

    // Calculate offset to move the batch to targetX
    // Align vertical center of batch to vertical center of viewport (roughly) or 0
    const offsetX = targetX - bounds.minX;
    const offsetY = -bounds.minY + 100; // Place slightly down from 0

    // 4. Create the "Group Container"
    const PADDING = 60;
    // 使用传入的文件名作为标题
    const containerLabel = importFileName || (isEn
        ? `📦 Imported Package(${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()})`
        : `📦 导入的包(${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()})`);

    const containerHint = isEn
        ? 'Items inside this frame will be removed if you delete this group. Move items OUT to keep them.'
        : '删除此分组时，框内的项目会一并删除。将项目移出框外可保留它们。';

    const containerNode = {
        id: `import -group - ${Date.now()}`,
        type: 'md',
        subtype: 'import-container', // Special flag
        x: targetX - PADDING,
        y: bounds.minY + offsetY - PADDING,
        width: bounds.width + (PADDING * 2),
        height: bounds.height + (PADDING * 2),
        text: '', // No text, just UI
        // 移除背景样式，只保留纯文字，样式移入 CSS 以支持主题适配
        html: `< div class= "import-group-label" > ${containerLabel}</div >
        <div class="import-group-hint">${containerHint}</div>`,
        color: 'transparent',
        style: 'border: 2px dashed #bbb; background: rgba(0,0,0,0.02);' // No z-index, rely on DOM order
    };

    // 5. Apply Offset to all imported nodes
    remappedNodes.tempSections.forEach(s => { s.x += offsetX; s.y += offsetY; });
    remappedNodes.mdNodes.forEach(n => { n.x += offsetX; n.y += offsetY; });

    console.log(`[Canvas] Sandboxed Import Stats:
        - Sections: ${remappedNodes.tempSections.length}
        - MdNodes: ${remappedNodes.mdNodes.length}
        - Edges: ${remappedEdges.length}
        - Offset: (${offsetX}, ${offsetY})`);

    // 6. Merge into CanvasState
    CanvasState.tempSections.push(...remappedNodes.tempSections);
    // Put container FIRST so it renders at the bottom (DOM order)
    CanvasState.mdNodes.unshift(containerNode);
    CanvasState.mdNodes.push(...remappedNodes.mdNodes);
    CanvasState.edges.push(...remappedEdges);

    // 7. Restore Scrolls (Mapped to new IDs)
    Object.keys(remappedScrolls).forEach(scKey => {
        localStorage.setItem(scKey, JSON.stringify(remappedScrolls[scKey]));
    });

    // 8. Render & Persistence
    // First render all nodes so they exist in the DOM
    CanvasState.tempSections.forEach(s => renderTempNode(s));
    CanvasState.mdNodes.forEach(n => renderMdNode(n)); // Renders the group too
    saveTempNodes();

    // Then render edges after nodes are in the DOM
    // Use requestAnimationFrame to ensure DOM is fully updated
    requestAnimationFrame(() => {
        renderEdges();
        // Schedule another render to ensure all edges are properly positioned
        setTimeout(() => {
            renderEdges();
            scheduleBoundsUpdate();
        }, 100);
    });

    // 9. Auto-Pan to the new group (镜头跟随)
    const cx = containerNode.x + containerNode.width / 2;
    const cy = containerNode.y + containerNode.height / 2;
    // Zoom out slightly to see the whole package if it's big
    const fitZoom = Math.min(1, (window.innerWidth - 100) / containerNode.width);
    const z = Math.max(0.2, Math.min(1, fitZoom));

    setCanvasZoom(z, cx, cy, { recomputeBounds: false }); // Set zoom first
    CanvasState.panOffsetX = (window.innerWidth / 2) - (cx * z);
    CanvasState.panOffsetY = (window.innerHeight / 2) - (cy * z);
    updateCanvasScrollBounds();
    savePanOffsetThrottled();

    console.log('[Canvas] Import successful. ID Remapped, Offset applied, Group created.');
}

/**
 * 5.1 数据结构适配器 (Adapter Layer)
 * 将 chrome.bookmarks.getTree 返回的数据结构转换为 Canvas 内部的 TempSection items 格式
 * @param {Array} chromeTree - Chrome 书签树 (chrome.bookmarks.getTree 返回值)
 * @returns {Array} Canvas items 格式
 */
function __adaptChromeTreeToCanvasItems(chromeTree) {
    if (!chromeTree || !Array.isArray(chromeTree)) return [];

    const convertNode = (node) => {
        if (!node) return null;

        // 书签
        if (node.url) {
            return {
                id: `snapshot - ${node.id || Date.now()} - ${Math.random().toString(36).substr(2, 5)}`,
                type: 'bookmark',
                title: node.title || node.name || node.url,
                url: node.url
            };
        }

        // 文件夹
        const children = Array.isArray(node.children)
            ? node.children.map(convertNode).filter(Boolean)
            : [];

        return {
            id: `snapshot - ${node.id || Date.now()} - ${Math.random().toString(36).substr(2, 5)}`,
            type: 'folder',
            title: node.title || node.name || 'Folder',
            children: children
        };
    };

    // Chrome 书签树的根节点结构：[{ id: "0", children: [书签栏, 其他书签, ...] }]
    const root = chromeTree[0];
    if (!root || !Array.isArray(root.children)) return [];

    // 返回根节点下的所有子节点（书签栏、其他书签等）
    return root.children.map(convertNode).filter(Boolean);
}

// Helper: Remap all IDs to avoid collisions
function __remapImportedData(tempState, fullStorage, primaryState = {}) {
    const { isEn } = __getLang();
    const idMap = new Map(); // oldId -> newId

    const getNewId = (old) => {
        if (!old) return old; // Return if null/undefined
        if (!idMap.has(old)) idMap.set(old, `imported - ${Date.now()} - ${Math.floor(Math.random() * 100000)}`);
        return idMap.get(old);
    };

    const newTempSections = [];
    const newMdNodes = [];
    const newEdges = [];
    const newScrolls = {};

    // 1. Handle Permanent Section (Convert to Snapshot - 永久栏目降级策略)
    // 导入包中的"永久栏目"不可覆盖浏览器真实书签
    // 它将自动转换为一个"快照临时栏目"
    if (fullStorage && fullStorage['permanent-section-position']) {
        const permPos = fullStorage['permanent-section-position'];
        const snapshotId = getNewId('permanent-section');

        // 尝试从核心数据层获取书签树快照
        let snapshotItems = [];
        let hasBookmarkData = false;

        if (primaryState && primaryState.permanentTreeSnapshot) {
            // 核心数据层包含完整书签树，进行适配
            const bookmarkTree = primaryState.permanentTreeSnapshot;
            snapshotItems = __adaptChromeTreeToCanvasItems(bookmarkTree);
            hasBookmarkData = snapshotItems.length > 0;
        }

        const snapshotTitle = isEn
            ? `[Snapshot] Permanent Sections(${new Date().toLocaleDateString()})`
            : `[快照] 永久栏目(${new Date().toLocaleDateString()})`;

        const snapshotDesc = hasBookmarkData
            ? (isEn
                ? '<p><em>This is a snapshot of the imported permanent bookmarks. It is read-only and not synced with the browser.</em></p>'
                : '<p><em>此为导入的永久栏目快照。内容只读，与浏览器断开同步。</em></p>')
            : (isEn
                ? '<p><em>(Permanent section position snapshot. Bookmark data not available in this export format.)</em></p>'
                : '<p><em>(永久栏目位置快照。此导出格式不包含书签数据。)</em></p>');

        const snapshotSection = {
            id: snapshotId,
            title: snapshotTitle,
            x: parseFloat(permPos.left) || 0,
            y: parseFloat(permPos.top) || 0,
            width: parseFloat(permPos.width) || 600,
            height: parseFloat(permPos.height) || 600,
            color: '4', // Greenish - 颜色区分
            items: snapshotItems,
            description: snapshotDesc,
            isSnapshot: true // 标记为快照
        };
        newTempSections.push(snapshotSection);

        // Remap scroll
        if (fullStorage && fullStorage['permanent-section-scroll']) {
            newScrolls[`temp - section - scroll: ${snapshotId}`] = fullStorage['permanent-section-scroll'];
        }
    }

    // 2. Remap Temp Sections
    if (Array.isArray(tempState.sections)) {
        tempState.sections.forEach(sec => {
            const newId = getNewId(sec.id);
            const newSec = JSON.parse(JSON.stringify(sec));
            newSec.id = newId;
            // Iterate items to remap internal IDs if needed? 
            // Usually internal item IDs are unique per section. But let's keep them as is.

            newTempSections.push(newSec);

            // Remap scroll
            const oldScrollKey = `temp - section - scroll: ${sec.id}`;
            if (fullStorage && fullStorage[oldScrollKey]) {
                newScrolls[`temp - section - scroll: ${newId}`] = fullStorage[oldScrollKey];
            }
        });
    }

    // 3. Remap Md Nodes
    if (Array.isArray(tempState.mdNodes)) {
        tempState.mdNodes.forEach(node => {
            const newId = getNewId(node.id);
            // Ensure style/color are preserved
            const newNode = { ...node, id: newId };
            newMdNodes.push(newNode);
        });
    } else {
        console.warn('[Canvas] Import: No mdNodes found in tempState', tempState);
    }

    // 4. Remap Edges
    if (Array.isArray(tempState.edges)) {
        tempState.edges.forEach(edge => {
            const newFrom = idMap.has(edge.fromNode) ? idMap.get(edge.fromNode) : null;
            const newTo = idMap.has(edge.toNode) ? idMap.get(edge.toNode) : null;

            // Only keep edge if both ends exist in the imported set (or maybe connected to existing? No, pure import)
            // If linked to 'permanent-section', it maps to our new snapshot.
            if (newFrom && newTo) {
                const newEdge = { ...edge, id: getNewId(edge.id), fromNode: newFrom, toNode: newTo };
                newEdges.push(newEdge);
            } else {
                console.warn(`[Canvas] Skipping edge ${edge.id}: Ends not found in import batch.From: ${edge.fromNode} -> ${newFrom}, To: ${edge.toNode} -> ${newTo} `);
            }
        });
    } else {
        console.warn('[Canvas] Import: No edges found in tempState');
    }

    return { remappedNodes: { tempSections: newTempSections, mdNodes: newMdNodes }, remappedEdges: newEdges, remappedScrolls: newScrolls };
}

function __calculateNodesBoundingBox(nodesPayload) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const all = [...nodesPayload.tempSections, ...nodesPayload.mdNodes];

    if (all.length === 0) return { minX: 0, minY: 0, width: 800, height: 600 };

    all.forEach(n => {
        const x = parseFloat(n.x) || 0;
        const y = parseFloat(n.y) || 0;
        const w = parseFloat(n.width) || 300;
        const h = parseFloat(n.height) || 300;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x + w > maxX) maxX = x + w;
        if (y + h > maxY) maxY = y + h;
    });

    return { minX, minY, width: maxX - minX, height: maxY - minY };
}

function __findCurrentContentRightBound() {
    let maxX = -Infinity;

    // Check Permanent Section
    const perm = document.getElementById('permanentSection');
    if (perm) {
        const rect = perm.getBoundingClientRect(); // This is viewport relative. We need Canvas Coords.
        // Better to check style or saved state
        const left = parseFloat(perm.style.left) || 0;
        const width = perm.offsetWidth || 600;
        if (left + width > maxX) maxX = left + width;
    }

    // Check Temp Sections
    CanvasState.tempSections.forEach(s => {
        const r = s.x + (s.width || 400);
        if (r > maxX) maxX = r;
    });

    // Check Md Nodes
    CanvasState.mdNodes.forEach(n => {
        const r = n.x + (n.width || 300);
        if (r > maxX) maxX = r;
    });

    return maxX === -Infinity ? 100 : maxX;
}

// Special Render Logic for "Import Container" (Group)
// We need to inject this into 'renderMdNode' or handle it there. 
// For now, let's modify the behavior by checking the subtype inside renderMdNode logic?
// No, 'renderMdNode' in previous context treats html/text.
// We can use the existing 'renderMdNode' and just ensuring the DELETE logic works as requested.

function __setupImportContainerEvents(nodeElement, node) {
    // This function is called after renderMdNode creates the element
    if (node.subtype !== 'import-container') return;

    // Note: The delete functionality is now handled by the toolbar's delete button
    // which shows a popover with "Delete Frame Only" and "Delete All Content" options.
    // No additional UI is needed here.
}


function deleteImportGroup(groupId) {
    const groupNode = CanvasState.mdNodes.find(n => n.id === groupId);
    if (!groupNode) return;

    // 1. Calculate Group Rect
    const gx = groupNode.x;
    const gy = groupNode.y;
    const gw = groupNode.width;
    const gh = groupNode.height;

    // 2. Find internal items
    const idsToRemove = { temp: [], md: [] };

    // Check Temp Sections
    CanvasState.tempSections.forEach(s => {
        // Simple center point check or full containment? 
        // User said "inside". Let's use checking if Center is inside.
        const cx = s.x + (s.width / 2);
        const cy = s.y + (s.height / 2);
        if (cx > gx && cx < gx + gw && cy > gy && cy < gy + gh) {
            idsToRemove.temp.push(s.id);
        }
    });

    // Check MD Nodes (exclude the group itself)
    CanvasState.mdNodes.forEach(n => {
        if (n.id === groupId) return;
        const cx = n.x + (n.width / 2);
        const cy = n.y + (n.height / 2);
        if (cx > gx && cx < gx + gw && cy > gy && cy < gy + gh) {
            idsToRemove.md.push(n.id);
        }
    });

    // 3. Delete items
    idsToRemove.temp.forEach(id => removeTempNode(id)); // This handles DOM removal and state update
    idsToRemove.md.forEach(id => removeMdNode(id));

    // 4. Delete Group
    removeMdNode(groupId);

    console.log('[Canvas] Import Group Deleted. Items removed:', idsToRemove);
}

function formatSectionText(section) {
    const lines = [`# ${section.title || '临时栏目'} `, ''];

    const appendItem = (item, depth = 0) => {
        const indent = '  '.repeat(depth);
        if (item.type === 'bookmark') {
            const title = item.title || item.url || '未命名书签';
            const url = item.url || '#';
            lines.push(`${indent} -[${title}](${url})`);
        } else {
            lines.push(`${indent} - ${item.title || '未命名文件夹'} `);
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


/**
 * 自动调整 import-container 大小以包裹内容
 * 策略：检查所有大部分区域（>50%）位于容器内的节点，如果它们超出容器边界，则扩展容器。
 */
function autoResizeImportContainers() {
    const containers = CanvasState.mdNodes.filter(n => n.subtype === 'import-container');
    if (containers.length === 0) return;

    let changed = false;
    const PADDING = 60;

    containers.forEach(container => {
        const children = [];

        const cx = container.x;
        const cy = container.y;
        const cw = container.width;
        const ch = container.height;

        // 辅助函数：计算重叠并判断是否应该包含
        const shouldContain = (node) => {
            if (node.id === container.id) return false;

            // 计算重叠区域
            const interLeft = Math.max(node.x, cx);
            const interTop = Math.max(node.y, cy);
            const interRight = Math.min(node.x + node.width, cx + cw);
            const interBottom = Math.min(node.y + node.height, cy + ch);

            if (interLeft < interRight && interTop < interBottom) {
                const intersectionArea = (interRight - interLeft) * (interBottom - interTop);
                const nodeArea = node.width * node.height;
                // 只有当超过 40% 的面积在容器内时，才强制容器包裹它
                // 稍微降低阈值(40%)以增加粘性，或者50%
                return (intersectionArea / nodeArea) > 0.4;
            }
            return false;
        };

        CanvasState.tempSections.forEach(node => {
            if (shouldContain(node)) children.push(node);
        });

        CanvasState.mdNodes.forEach(node => {
            if (shouldContain(node)) children.push(node);
        });

        if (children.length === 0) return;

        // 计算所有“内部”节点的边界
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        children.forEach(c => {
            if (c.x < minX) minX = c.x;
            if (c.y < minY) minY = c.y;
            if (c.x + c.width > maxX) maxX = c.x + c.width;
            if (c.y + c.height > maxY) maxY = c.y + c.height;
        });

        // 仅在需要扩大时更新（单向增长，防止内容减少时容器缩成一团，除非用户手动调整）
        // 实际上用户需求是“跟随...改变”，可能也期望缩回去？
        // 但为了安全性，通常在这里只做扩大。如果要做缩小，需要知道容器的“初始”大小吗？
        // 或者，我们可以让容器总是 tightly fitted to content + padding。
        // 如果我们让 it tightly fitted，那么当我们把节点移出后，容器会自动缩小吗？
        // 会的。如果移出后，remaining content 的 bbox 变小了，计算出的 newRight 就会变小。
        // 这其实更加灵活。

        // 计算新的理想边界 (tight fit)
        // 限制：不能小于某个最小尺寸（或者原始对齐？）
        // 这里简单地总是适应内容

        // 但是要注意，如果容器本身很大，而内容很小（刚导入时的留白），一动就会缩回去。
        // 这可能不是用户想要的（突然变小）。
        // 只有当内容**超出**当前边界时才扩大？
        // 用户原话：“超过他们的时候，他们也能够跟随...改变”。这通过了“扩大”的测试。
        // 是否缩小？如果不缩小，会有很多空地。
        // 综合考虑，只做扩大比较稳妥，避免意外的布局跳变。

        const currentRight = container.x + container.width;
        const currentBottom = container.y + container.height;

        const contentLeft = minX - PADDING;
        const contentTop = minY - PADDING;
        const contentRight = maxX + PADDING;
        const contentBottom = maxY + PADDING;

        let newX = container.x;
        let newY = container.y;
        let newWidth = container.width;
        let newHeight = container.height;
        let hasResize = false;

        // 检查左边界
        if (contentLeft < container.x) {
            newX = contentLeft;
            newWidth += (container.x - contentLeft);
            hasResize = true;
        }

        // 检查上边界
        if (contentTop < container.y) {
            newY = contentTop;
            newHeight += (container.y - contentTop);
            hasResize = true;
        }

        // 检查右边界 (需要基于新的 X)
        if (contentRight > newX + newWidth) {
            newWidth = contentRight - newX;
            hasResize = true;
        }

        // 检查下边界 (需要基于新的 Y)
        if (contentBottom > newY + newHeight) {
            newHeight = contentBottom - newY;
            hasResize = true;
        }

        if (hasResize) {
            container.x = newX;
            container.y = newY;
            container.width = newWidth;
            container.height = newHeight;

            // Update DOM
            const el = document.getElementById(container.id);
            if (el) {
                el.style.left = newX + 'px';
                el.style.top = newY + 'px';
                el.style.width = newWidth + 'px';
                el.style.height = newHeight + 'px';
            }
            changed = true;
        }
    });

    if (changed) {
        try { scheduleBoundsUpdate(); } catch (_) { }
    }
}

function saveTempNodes() {
    // 保存前执行自动 resize
    autoResizeImportContainers();

    try {
        const state = {
            sections: CanvasState.tempSections,
            tempSectionCounter: CanvasState.tempSectionCounter,
            tempItemCounter: CanvasState.tempItemCounter,
            colorCursor: CanvasState.colorCursor,
            tempSectionLastColor: CanvasState.tempSectionLastColor || TEMP_SECTION_DEFAULT_COLOR,
            tempSectionPrevColor: CanvasState.tempSectionPrevColor || null,
            // 新增：保存 Markdown 文本卡片
            mdNodes: CanvasState.mdNodes,
            mdNodeCounter: CanvasState.mdNodeCounter,
            // 新增：保存连接线
            edges: CanvasState.edges,
            edgeCounter: CanvasState.edgeCounter,
            timestamp: Date.now()
        };
        localStorage.setItem(TEMP_SECTION_STORAGE_KEY, JSON.stringify(state));

        // 每次画布状态持久化后，尝试调度一次缩略图更新（带去抖）
        if (typeof window !== 'undefined' && typeof window.requestCanvasThumbnailUpdate === 'function') {
            try {
                window.requestCanvasThumbnailUpdate('saveTempNodes');
            } catch (e) {
                // 缩略图更新失败不影响正常保存，静默处理
            }
        }
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
        CanvasState.tempSectionLastColor = TEMP_SECTION_DEFAULT_COLOR;
        CanvasState.tempSectionPrevColor = null;
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
            CanvasState.tempSectionLastColor = state.tempSectionLastColor || TEMP_SECTION_DEFAULT_COLOR;
            CanvasState.tempSectionPrevColor = state.tempSectionPrevColor || null;
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
            // 首次使用：加载初始演示模板
            CanvasState.tempSections = [];
            const demoTemplate = createInitialDemoTemplate();
            CanvasState.mdNodes = demoTemplate.mdNodes;
            CanvasState.mdNodeCounter = demoTemplate.mdNodeCounter;
            CanvasState.edges = demoTemplate.edges;
            CanvasState.edgeCounter = demoTemplate.edgeCounter;
            console.log('[Canvas] 首次使用，加载演示模板');
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

        // 第一次打开 Canvas：把视口定位到「快捷键说明 + 使用说明 + 永久栏目」三卡片的中心
        // 仅在“首次打开”且本次确实加载了演示模板（无保存数据）时触发，避免影响已有用户的布局。
        const openedKey = 'bookmark-canvas-has-opened';
        const hasOpenedCanvas = localStorage.getItem(openedKey) === 'true';
        if (!hasOpenedCanvas) {
            if (!loaded) {
                try { locateToIntroCardsCenter(); } catch (_) { }
            }
            try { localStorage.setItem(openedKey, 'true'); } catch (_) { }
        }
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
    // 设置样式：Z-Index 介于 Container(5) 和 TempSections(10) 之间
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.zIndex = '7';
    svg.style.pointerEvents = 'none'; // Pass through clicks to container unless hitting a path
    // Insert as first child so it's behind everything
    content.insertBefore(svg, content.firstChild);

    // Create arrowhead marker once for edge directions
    try {
        if (!svg.querySelector('#edge-arrowhead')) {
            const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
            marker.setAttribute('id', 'edge-arrowhead');
            // Smaller, subtler arrowhead
            marker.setAttribute('markerWidth', '8');
            marker.setAttribute('markerHeight', '8');
            marker.setAttribute('refX', '7');
            marker.setAttribute('refY', '4');
            marker.setAttribute('orient', 'auto-start-reverse');
            marker.setAttribute('markerUnits', 'strokeWidth');
            const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            p.setAttribute('d', 'M0,0 L8,4 L0,8 z');
            p.setAttribute('fill', 'context-stroke');
            p.setAttribute('stroke', 'none');
            marker.appendChild(p);
            defs.appendChild(marker);
            svg.appendChild(defs);
        }
    } catch (_) { }
}

function addAnchorsToNode(nodeElement, nodeId) {
    if (!nodeElement) return;
    // Remove existing anchors and zones if any to avoid duplicates
    nodeElement.querySelectorAll('.canvas-node-anchor, .canvas-anchor-zone').forEach(el => el.remove());

    ['top', 'right', 'bottom', 'left'].forEach(side => {
        // Create hover zone first (so it can affect anchor via sibling selector if needed, 
        // though we might use JS for more reliable hover handling if CSS is tricky)
        const zone = document.createElement('div');
        zone.className = `canvas - anchor - zone zone - ${side} `;
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

    // 左键点击临时栏目（书签型）中的书签链接时，按全局默认打开方式处理
    if (tempLinkClickHandler) {
        document.removeEventListener('click', tempLinkClickHandler, true);
        document.removeEventListener('click', tempLinkClickHandler, false);
    }
    tempLinkClickHandler = (e) => {
        const link = e.target && e.target.closest('.temp-canvas-node a.tree-bookmark-link');
        if (!link) return;
        // 修饰键交给浏览器默认行为
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        // 阻止其它监听器重复处理
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
        const url = link.getAttribute('href');
        // 解析作用域上下文（临时栏目）
        const tempNode = link.closest('.temp-canvas-node[data-section-id]');
        const scopedContext = tempNode ? { treeType: 'temporary', sectionId: tempNode.dataset.sectionId } : { treeType: 'permanent' };
        try {
            if (window.defaultOpenMode === undefined && typeof window.getDefaultOpenMode === 'function') {
                window.defaultOpenMode = window.getDefaultOpenMode();
            }
        } catch (_) { }
        const mode = (typeof window !== 'undefined' && window.defaultOpenMode) || 'new-tab';
        if (mode === 'new-window') {
            if (typeof window.openBookmarkNewWindow === 'function') window.openBookmarkNewWindow(url, false); else window.open(url, '_blank');
        } else if (mode === 'incognito') {
            if (typeof window.openBookmarkNewWindow === 'function') window.openBookmarkNewWindow(url, true); else window.open(url, '_blank');
        } else if (mode === 'specific-window') {
            if (typeof window.openInSpecificWindow === 'function') window.openInSpecificWindow(url); else window.open(url, '_blank');
        } else if (mode === 'scoped-window') {
            if (typeof window.openInScopedWindow === 'function') window.openInScopedWindow(url, { context: scopedContext }); else window.open(url, '_blank');
        } else if (mode === 'specific-group') {
            if (typeof window.openInSpecificTabGroup === 'function') window.openInSpecificTabGroup(url); else window.open(url, '_blank');
        } else if (mode === 'scoped-group') {
            if (typeof window.openInScopedTabGroup === 'function') window.openInScopedTabGroup(url, { context: scopedContext }); else window.open(url, '_blank');
        } else if (mode === 'same-window-specific-group') {
            if (typeof window.openInSameWindowSpecificGroup === 'function') window.openInSameWindowSpecificGroup(url, { context: scopedContext }); else window.open(url, '_blank');
        } else {
            if (typeof window.openBookmarkNewTab === 'function') window.openBookmarkNewTab(url); else window.open(url, '_blank');
        }
    };
    document.addEventListener('click', tempLinkClickHandler, true);
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
            const fromNodeId = CanvasState.connectionStart.nodeId;
            const fromSide = CanvasState.connectionStart.side;
            // Block same-node connections entirely
            if (toNodeId === fromNodeId) {
                console.log('[Canvas] 忽略同栏目的锚点连接');
            } else if (toNodeId !== fromNodeId || toSide !== fromSide) {
                addEdge(fromNodeId, fromSide, toNodeId, toSide);

                // Delay toolbar appearance for md-canvas-node after connection
                if (nodeEl && nodeEl.classList.contains('md-canvas-node')) {
                    nodeEl.classList.add('connection-just-finished');
                    setTimeout(() => {
                        nodeEl.classList.remove('connection-just-finished');
                    }, 1000);
                }
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
    // Block self-connections between anchors of the same node
    if (fromNode === toNode) {
        console.log('[Canvas] 忽略同栏目的锚点连接');
        return;
    }

    const id = `edge - ${++CanvasState.edgeCounter} -${Date.now()} `;
    CanvasState.edges.push({
        id,
        fromNode,
        fromSide,
        toNode,
        toSide,
        direction: 'none', // 'none' | 'forward' | 'both'
        color: null, // 预设颜色编号 (1-6) 或 null
        colorHex: null, // 自定义十六进制颜色
        label: '' // 连接线文字标签
    });
    renderEdges();
    saveTempNodes();
}

// Remove all edges attached to a given node (section/md/permanent)
function removeEdgesForNode(nodeId) {
    const before = CanvasState.edges.length;
    const removed = [];
    CanvasState.edges = CanvasState.edges.filter(e => {
        const match = (e.fromNode === nodeId) || (e.toNode === nodeId);
        if (match) removed.push(e.id);
        return !match;
    });
    if (removed.includes(CanvasState.selectedEdgeId)) {
        CanvasState.selectedEdgeId = null;
        hideEdgeToolbar();
    }
    if (removed.length) {
        renderEdges();
        saveTempNodes();
        console.log(`[Canvas] 已移除与节点 ${nodeId} 相连的连接线: ${removed.length}/${before}`);
    }
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
    Array.from(svg.querySelectorAll('.canvas-edge, .canvas-edge-label, .canvas-edge-label-bg, .canvas-edge-hit-area, foreignObject.edge-label-fo')).forEach(el => {
        if (el.id !== 'temp-connection-path') el.remove();
    });

    // Stable z-order: render selected edge last to keep it on top
    const selectedId = CanvasState.selectedEdgeId || null;
    const edgesToRender = selectedId
        ? CanvasState.edges.filter(e => e.id !== selectedId).concat(CanvasState.edges.filter(e => e.id === selectedId))
        : CanvasState.edges.slice();

    edgesToRender.forEach(edge => {
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

        // 应用颜色（使用 inline style 优先级高于样式表）
        const edgeColor = edge.colorHex || presetToHex(edge.color) || null;
        if (edgeColor) {
            path.style.stroke = edgeColor;
        } else {
            path.style.stroke = '';
        }
        // Apply arrow markers according to direction
        const dir = edge.direction || 'none';
        if (dir === 'forward') {
            path.setAttribute('marker-end', 'url(#edge-arrowhead)');
            path.removeAttribute('marker-start');
        } else if (dir === 'both') {
            path.setAttribute('marker-end', 'url(#edge-arrowhead)');
            path.setAttribute('marker-start', 'url(#edge-arrowhead)');
        } else {
            path.removeAttribute('marker-end');
            path.removeAttribute('marker-start');
        }
        // 选中时发光（使用与线条相同的颜色）
        if (edge.id === CanvasState.selectedEdgeId) {
            const glow = edgeColor || '#66bbff';
            path.style.filter = `drop-shadow(0 0 2px ${glow}66) drop-shadow(0 0 6px ${glow}99)`;
        } else {
            path.style.filter = '';
        }

        updateEdgePath(edge, path);
        svg.appendChild(path);

        // 点击事件绑定到不可见的宽区域
        hitArea.addEventListener('click', (e) => {
            console.log('[Edge] Edge clicked:', edge.id);
            e.stopPropagation();
            selectEdge(edge.id, e.clientX, e.clientY);
        });

        // 双击连接线直接进入编辑标签
        hitArea.addEventListener('dblclick', (e) => {
            console.log('[Edge] Edge double-clicked:', edge.id);
            e.stopPropagation();
            e.preventDefault();
            editEdgeLabel(edge.id);
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

    // 使用贝塞尔曲线中点放置标签，和曲线保持一致
    const curveMid = getEdgeCurveMidpoint(edge);
    const midX = curveMid ? curveMid.x : (start.x + end.x) / 2;
    const midY = curveMid ? curveMid.y : (start.y + end.y) / 2;

    // 先创建背景挖空矩形（让连线在文字区域下方留出空白）
    const textProbe = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    textProbe.setAttribute('class', 'canvas-edge-label');
    textProbe.setAttribute('x', midX);
    textProbe.setAttribute('y', midY);
    textProbe.setAttribute('text-anchor', 'middle');
    textProbe.setAttribute('dominant-baseline', 'middle');
    textProbe.textContent = edge.label;
    svg.appendChild(textProbe);

    // 计算文字尺寸
    let textWidth = 0;
    try { textWidth = textProbe.getComputedTextLength ? textProbe.getComputedTextLength() : 0; } catch (_) { }
    // 优先用BBox高度，回退到估算
    let textHeight = 16;
    try {
        const bb = textProbe.getBBox ? textProbe.getBBox() : null;
        if (bb && bb.height) textHeight = Math.ceil(bb.height);
    } catch (_) { }
    const padX = 6;
    const padY = 2;

    // 读取画布背景色，尽量与当前画布背景一致，形成“挖空”效果
    const getCanvasBg = () => {
        try {
            const ws = document.getElementById('canvasWorkspace');
            if (ws) {
                const cs = getComputedStyle(ws);
                const bg = cs && cs.backgroundColor ? cs.backgroundColor : null;
                if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
            }
            const container = document.querySelector('.canvas-main-container');
            if (container) {
                const cs = getComputedStyle(container);
                const bg = cs && cs.backgroundColor ? cs.backgroundColor : null;
                if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
            }
        } catch (_) { }
        return '#ffffff';
    };
    const bgColor = getCanvasBg();

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', (midX - textWidth / 2 - padX).toString());
    rect.setAttribute('y', (midY - textHeight / 2 - padY).toString());
    rect.setAttribute('width', (textWidth + padX * 2).toString());
    rect.setAttribute('height', (textHeight + padY * 2).toString());
    rect.setAttribute('rx', '4');
    rect.setAttribute('ry', '4');
    rect.setAttribute('fill', bgColor);
    rect.setAttribute('class', 'canvas-edge-label-bg');
    rect.setAttribute('data-edge-id', edge.id);
    rect.style.pointerEvents = 'none';

    // 计算完成后移除探针文本
    try { textProbe.remove(); } catch (_) { }
    // 将背景矩形插入到真实文本之前（盖住连线）
    svg.appendChild(rect);

    // 创建标签文本元素（放在矩形之上）
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('class', 'canvas-edge-label');
    text.setAttribute('data-edge-id', edge.id);
    text.setAttribute('x', midX);
    text.setAttribute('y', midY);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.textContent = edge.label;

    // 应用颜色（inline style 覆盖样式表）
    const edgeColor = edge.colorHex || presetToHex(edge.color) || null;
    if (edgeColor) {
        text.style.fill = edgeColor;
    } else {
        text.style.fill = '';
    }

    svg.appendChild(text);

    // 标签点击事件：直接进入就地编辑
    text.addEventListener('click', (e) => {
        e.stopPropagation();
        try { selectEdge(edge.id, e.clientX, e.clientY); } catch (_) { }
        startEdgeLabelInlineEdit(edge.id);
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
    let left = parseFloat(el.style.left) || 0;
    let top = parseFloat(el.style.top) || 0;

    // 检查是否有 transform: translate() 应用（拖动过程中）
    const transform = el.style.transform;
    if (transform && transform.includes('translate')) {
        const match = transform.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
        if (match) {
            const translateX = parseFloat(match[1]) || 0;
            const translateY = parseFloat(match[2]) || 0;
            left += translateX;
            top += translateY;
        }
    }

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

// Compute Bezier control points for an edge with aesthetics tuned for long distances
function computeEdgeControlPoints(x1, y1, x2, y2, side1, side2) {
    const ddx = x2 - x1;
    const ddy = y2 - y1;
    const adx = Math.abs(ddx);
    const ady = Math.abs(ddy);
    const dist = Math.hypot(ddx, ddy);
    const z = (CanvasState && CanvasState.zoom) ? CanvasState.zoom : 1;

    const isHoriz = s => (s === 'left' || s === 'right');
    const isVert = s => (s === 'top' || s === 'bottom');
    const offsetAlongSide = (side, x, y, amt) => {
        switch (side) {
            case 'top': return { x, y: y - amt };
            case 'bottom': return { x, y: y + amt };
            case 'left': return { x: x - amt, y };
            case 'right': return { x: x + amt, y };
            default: return { x, y };
        }
    };

    // Near: compact "bracket" curve; Far: gentle curve with capped offset (avoid ugly large bows)
    const nearThreshold = 220 / z;
    const nearAmt = Math.min(Math.max(dist * 0.45, 24 / z), 80 / z);
    const alongAmt = Math.min(Math.max(dist * 0.22, 40 / z), 160 / z);

    let cp1x = x1, cp1y = y1, cp2x = x2, cp2y = y2;

    if (dist < nearThreshold) {
        ({ x: cp1x, y: cp1y } = offsetAlongSide(side1, x1, y1, nearAmt));
        if (side2) ({ x: cp2x, y: cp2y } = offsetAlongSide(side2, x2, y2, nearAmt));
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        if (isHoriz(side1) && isHoriz(side2)) {
            cp1y = y1 + (my - y1) * 0.12;
            cp2y = y2 + (my - y2) * 0.12;
        } else if (isVert(side1) && isVert(side2)) {
            cp1x = x1 + (mx - x1) * 0.12;
            cp2x = x2 + (mx - x2) * 0.12;
        }
    } else {
        ({ x: cp1x, y: cp1y } = offsetAlongSide(side1, x1, y1, alongAmt));
        if (side2) ({ x: cp2x, y: cp2y } = offsetAlongSide(side2, x2, y2, alongAmt));
        // Very subtle perpendicular bend to avoid perfectly flat arcs and reduce crossings
        const bend = Math.min(12 / z, alongAmt * 0.15);
        if (isHoriz(side1)) { cp1y += (ddy === 0 ? 1 : Math.sign(ddy)) * bend; }
        else { cp1x += (ddx === 0 ? 1 : Math.sign(ddx)) * bend; }
        if (isHoriz(side2)) { cp2y -= (ddy === 0 ? 1 : Math.sign(ddy)) * bend; }
        else { cp2x -= (ddx === 0 ? 1 : Math.sign(ddx)) * bend; }
    }

    // Stable jitter to avoid perfect overlap; skip for temp preview (side2 may be null)
    const sideCode = s => (s === 'top' ? 1 : s === 'bottom' ? 2 : s === 'left' ? 3 : s === 'right' ? 4 : 0);
    const c1 = sideCode(side1) | 0; const c2 = sideCode(side2) | 0;
    const pairCode = (Math.min(c1, c2) * 31 + Math.max(c1, c2)) | 0;
    const sx = Math.floor(x1 + x2) | 0;
    const sy = Math.floor(y1 + y2) | 0;
    const seed = (((sx * 73856093) ^ (sy * 19349663) ^ (pairCode * 83492791)) >>> 0) % 1000;
    const jitterFactor = seed / 1000 - 0.5;
    const jitterAmp = side2 ? Math.min(6, alongAmt * 0.2) : 0;
    const jx = jitterFactor * jitterAmp;
    const jy = -jitterFactor * jitterAmp;
    if (adx >= ady) { cp1y += jy; cp2y += jy; } else { cp1x += jx; cp2x += jx; }

    return { cp1x, cp1y, cp2x, cp2y };
}

function getEdgePathD(x1, y1, x2, y2, side1, side2) {
    const { cp1x, cp1y, cp2x, cp2y } = computeEdgeControlPoints(x1, y1, x2, y2, side1, side2);
    return `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
}

// 计算边曲线在 t=0.5 处的中点（与 getEdgePathD 使用相同的控制点逻辑）
function getEdgeCurveMidpoint(edge) {
    const start = getAnchorPosition(edge.fromNode, edge.fromSide);
    const end = getAnchorPosition(edge.toNode, edge.toSide);
    if (!start || !end) return null;
    const x1 = start.x, y1 = start.y;
    const x2 = end.x, y2 = end.y;
    const { cp1x, cp1y, cp2x, cp2y } = computeEdgeControlPoints(x1, y1, x2, y2, edge.fromSide, edge.toSide);
    const midX = (x1 + 3 * cp1x + 3 * cp2x + x2) / 8;
    const midY = (y1 + 3 * cp1y + 3 * cp2y + y2) / 8;
    return { x: midX, y: midY };
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

    // Multi-language support - 每次显示都更新内容以确保语言正确
    const lang = typeof currentLang !== 'undefined' ? currentLang : 'zh';
    const deleteTitle = lang === 'en' ? 'Delete' : '删除';
    const colorTitle = lang === 'en' ? 'Color' : '颜色';
    const focusTitle = lang === 'en' ? 'Locate and zoom' : '定位并放大';
    const directionTitle = lang === 'en' ? 'Line direction' : '连接线方向';
    const labelTitle = lang === 'en' ? 'Edit label' : '编辑标签';

    toolbar.innerHTML = `
        <button class="md-node-toolbar-btn" data-action="edge-delete" data-tooltip="${deleteTitle}">
            <i class="far fa-trash-alt"></i>
        </button>
        <button class="md-node-toolbar-btn" data-action="edge-color-toggle" data-tooltip="${colorTitle}">
            <i class="fas fa-palette"></i>
        </button>
        <button class="md-node-toolbar-btn" data-action="edge-focus" data-tooltip="${focusTitle}">
            <i class="fas fa-search-plus"></i>
        </button>
        <button class="md-node-toolbar-btn" data-action="edge-direction" data-tooltip="${directionTitle}">
            <i class="fas fa-arrows-alt-h"></i>
        </button>
        <button class="md-node-toolbar-btn" data-action="edge-label" data-tooltip="${labelTitle}">
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
            } else if (action === 'md-color-picker-toggle') {
                // 通过委托打开原生颜色选择器
                const pop = ensureEdgeColorPopover(toolbar, currentEdge);
                const picker = pop.querySelector('.md-rgb-picker');
                const input = pop.querySelector('.md-color-input');
                if (picker && input) {
                    picker.classList.add('open');
                    setTimeout(() => input.click(), 30);
                }
            } else if (action === 'edge-focus') {
                // 复用空白栏目的定位逻辑
                locateAndZoomToEdge(currentEdgeId);
            } else if (action === 'edge-direction') {
                // 打开方向选择器
                toggleEdgeDirectionPopover(toolbar, currentEdge, btn);
            } else if (action === 'edge-label') {
                editEdgeLabel(currentEdgeId);
            } else if (action === 'md-color-preset') {
                const preset = String(btn.getAttribute('data-color') || '').trim();
                // 更新颜色历史
                const newColor = presetToHex(preset);
                if (newColor && currentEdge.colorHex) {
                    CanvasState.edgePrevColor = currentEdge.colorHex;
                }
                setEdgeColor(currentEdge, preset);
                closeEdgeColorPopover(toolbar);
            } else if (action === 'edge-direction-set') {
                const dir = String(btn.getAttribute('data-dir') || 'none');
                setEdgeDirection(currentEdge, dir);
                closeEdgeDirectionPopover(toolbar);
            } else if (action === 'edge-color-custom') {
                const customColor = btn.getAttribute('data-color');
                if (customColor) {
                    // 更新颜色历史
                    if (currentEdge.colorHex) {
                        CanvasState.edgePrevColor = currentEdge.colorHex;
                    }
                    currentEdge.color = null;
                    currentEdge.colorHex = customColor;
                    renderEdges();
                    saveTempNodes();
                    closeEdgeColorPopover(toolbar);
                }
            } else if (action === 'edge-color-recent') {
                // 上一次颜色
                const recentColor = btn.getAttribute('data-color') || CanvasState.edgePrevColor;
                if (recentColor) {
                    const oldColor = currentEdge.colorHex;
                    currentEdge.color = null;
                    currentEdge.colorHex = recentColor;
                    renderEdges();
                    // 交换颜色历史
                    if (oldColor) {
                        CanvasState.edgePrevColor = oldColor;
                    }
                    saveTempNodes();
                    closeEdgeColorPopover(toolbar);
                }
            }
        });
        toolbar.dataset.eventsBound = 'true';
    }
}

// 更新连接线工具栏位置（使用 canvas-content 坐标系）
function updateEdgeToolbarPosition() {
    const toolbar = document.getElementById('edge-toolbar');
    if (!toolbar || !toolbar.parentElement) {
        // 即使工具栏不存在，也尝试更新编辑器位置（在缩放/移动时）
        const editorOnly = document.getElementById('edge-label-editor');
        if (editorOnly && editorOnly.dataset.edgeId) {
            const edge = CanvasState.edges.find(e => e.id === editorOnly.dataset.edgeId);
            if (!edge) return;
            const start = getAnchorPosition(edge.fromNode, edge.fromSide);
            const end = getAnchorPosition(edge.toNode, edge.toSide);
            if (!start || !end) return;
            const curveMid = getEdgeCurveMidpoint(edge);
            const midX = curveMid ? curveMid.x : (start.x + end.x) / 2;
            const midY = curveMid ? curveMid.y : (start.y + end.y) / 2;
            const z = (CanvasState && CanvasState.zoom) ? CanvasState.zoom : 1;
            const offsetPx = 18;
            editorOnly.style.left = `${midX}px`;
            editorOnly.style.top = `${midY - (offsetPx / z)}px`;
            editorOnly.style.transform = `translate(-50%, -50%) scale(${(1 / z).toFixed(5)})`;
        }
        return;
    }

    const edgeId = toolbar.dataset.edgeId;
    if (!edgeId) return;

    const edge = CanvasState.edges.find(e => e.id === edgeId);
    if (!edge) return;

    const start = getAnchorPosition(edge.fromNode, edge.fromSide);
    const end = getAnchorPosition(edge.toNode, edge.toSide);

    if (!start || !end) return;

    // 工具栏定位于贝塞尔曲线中点
    const curveMid = getEdgeCurveMidpoint(edge);
    const midX = curveMid ? curveMid.x : (start.x + end.x) / 2;
    const midY = curveMid ? curveMid.y : (start.y + end.y) / 2;

    // 工具栏显示在中点上方（使用 canvas-content 坐标系），根据缩放比例调整偏移
    const z = (CanvasState && CanvasState.zoom) ? CanvasState.zoom : 1;
    toolbar.style.left = `${midX}px`;
    toolbar.style.top = `${midY - (40 / z)}px`;
    toolbar.style.transform = 'translateX(-50%)'; // 居中对齐

    // 同步更新正在编辑的输入框位置
    const editor = document.getElementById('edge-label-editor');
    if (editor && editor.dataset.edgeId === edgeId) {
        const offsetPx = 18;
        editor.style.left = `${midX}px`;
        editor.style.top = `${midY - (offsetPx / z)}px`;
        editor.style.transform = `translate(-50%, -50%) scale(${(1 / z).toFixed(5)})`;
    }
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
    const recentTitle = lang === 'en' ? 'Previous color' : '上一次颜色';

    // 使用 Obsidian Canvas 风格的颜色（与空白栏目完全一致）
    pop.innerHTML = `
        <span class="md-color-chip" data-action="edge-color-custom" data-color="#888888" style="background:#888888" title="${lang === 'en' ? 'Gray' : '灰色'}"></span>
        <span class="md-color-chip" data-action="edge-color-custom" data-color="#66bbff" style="background:#66bbff" title="${lang === 'en' ? 'Default Blue' : '默认蓝色'}"></span>
        <span class="md-color-chip" data-action="md-color-preset" data-color="1" style="background:#fb464c"></span>
        <span class="md-color-chip" data-action="md-color-preset" data-color="2" style="background:#e9973f"></span>
        <span class="md-color-chip" data-action="md-color-preset" data-color="3" style="background:#e0de71"></span>
        <span class="md-color-chip" data-action="md-color-preset" data-color="4" style="background:#44cf6e"></span>
        <span class="md-color-chip" data-action="md-color-preset" data-color="5" style="background:#53dfdd"></span>
        <span class="md-color-chip" data-action="md-color-preset" data-color="6" style="background:#a882ff"></span>
        <span class="md-color-divider" aria-hidden="true"></span>
        <span class="md-color-chip md-color-recent-chip" data-action="edge-color-recent" title="${recentTitle}"></span>
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

    // 上一次颜色功能
    const recentChipEl = pop.querySelector('.md-color-recent-chip');
    const resolveHistoryColor = (value) => {
        const normalized = normalizeHexColor(value || '');
        return normalized ? `#${normalized}` : '#66bbff';
    };
    const syncHistoryChip = (value) => {
        if (!recentChipEl) return;
        const safe = resolveHistoryColor(value);
        recentChipEl.dataset.color = safe;
        recentChipEl.style.backgroundColor = safe;
    };
    // 初始化上一次颜色
    syncHistoryChip(CanvasState.edgePrevColor || '#66bbff');

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
    const pop = toolbar.querySelector('.md-color-popover:not(.md-direction-popover)');
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

// 方向弹层（与色盘风格一致）
function ensureEdgeDirectionPopover(toolbar, edge) {
    let pop = toolbar.querySelector('.md-direction-popover');
    if (pop) return pop;
    pop = document.createElement('div');
    pop.className = 'md-color-popover md-direction-popover';
    const lang = typeof currentLang !== 'undefined' ? currentLang : 'zh';
    const noneText = lang === 'en' ? 'None' : '无方向';
    const singleText = lang === 'en' ? 'Single' : '单向';
    const bothText = lang === 'en' ? 'Both' : '双向';
    pop.innerHTML = `
        <span class="md-color-chip dir-chip" data-action="edge-direction-set" data-dir="none" title="${noneText}"><i class="fas fa-minus"></i></span>
        <span class="md-color-chip dir-chip" data-action="edge-direction-set" data-dir="forward" title="${singleText}"><i class="fas fa-long-arrow-alt-right"></i></span>
        <span class="md-color-chip dir-chip" data-action="edge-direction-set" data-dir="both" title="${bothText}"><i class="fas fa-arrows-alt-h"></i></span>
    `;
    toolbar.appendChild(pop);
    return pop;
}

function toggleEdgeDirectionPopover(toolbar, edge, anchorBtn) {
    const pop = ensureEdgeDirectionPopover(toolbar, edge);
    const isOpen = pop.classList.contains('open');
    // 关闭色盘，避免重叠
    closeEdgeColorPopover(toolbar);
    if (isOpen) {
        pop.classList.remove('open');
        return;
    }
    pop.classList.add('open');
    const onDoc = (e) => {
        if (!toolbar.contains(e.target)) {
            closeEdgeDirectionPopover(toolbar);
            document.removeEventListener('mousedown', onDoc, true);
        }
    };
    document.addEventListener('mousedown', onDoc, true);
}

function closeEdgeDirectionPopover(toolbar) {
    const pop = toolbar.querySelector('.md-direction-popover');
    if (pop) pop.classList.remove('open');
}

function setEdgeDirection(edge, dir) {
    if (!edge) return;
    const v = (dir === 'forward' || dir === 'both') ? dir : 'none';
    edge.direction = v;
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
    // 向后兼容：按钮调用改为就地编辑
    startEdgeLabelInlineEdit(edgeId);
}

// 就地编辑连接线标签（不再使用 prompt）
function startEdgeLabelInlineEdit(edgeId) {
    const edge = CanvasState.edges.find(e => e.id === edgeId);
    const svg = document.querySelector('.canvas-edges');
    if (!edge || !svg) return;

    // 清除已有的编辑器
    const existingFo = svg.querySelector(`foreignObject[data-edge-id="${edgeId}"]`);
    if (existingFo) { try { existingFo.remove(); } catch (_) { } }

    // 移除原文字（若存在）
    const textEl = svg.querySelector(`text.canvas-edge-label[data-edge-id="${edgeId}"]`);
    if (textEl) { try { textEl.remove(); } catch (_) { } }

    // 计算放置位置
    const start = getAnchorPosition(edge.fromNode, edge.fromSide);
    const end = getAnchorPosition(edge.toNode, edge.toSide);
    if (!start || !end) return;
    const mid = getEdgeCurveMidpoint(edge) || { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };

    // 使用探针测量当前文本尺寸（用户单位）
    const probe = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    probe.setAttribute('class', 'canvas-edge-label');
    probe.textContent = edge.label || '';
    probe.setAttribute('x', mid.x);
    probe.setAttribute('y', mid.y);
    probe.setAttribute('text-anchor', 'middle');
    probe.setAttribute('dominant-baseline', 'middle');
    svg.appendChild(probe);
    let textW = 30, textH = 16;
    try {
        textW = Math.max(30, probe.getComputedTextLength ? probe.getComputedTextLength() : 30);
        const bb = probe.getBBox ? probe.getBBox() : null;
        textH = Math.max(16, bb && bb.height ? Math.ceil(bb.height) : 16);
    } catch (_) { }
    try { probe.remove(); } catch (_) { }

    const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    fo.setAttribute('data-edge-id', edgeId);
    fo.setAttribute('class', 'edge-label-fo');
    fo.setAttribute('x', (mid.x - textW / 2).toString());
    fo.setAttribute('y', (mid.y - textH / 2).toString());
    fo.setAttribute('width', (textW).toString());
    fo.setAttribute('height', (textH).toString());
    fo.style.pointerEvents = 'all';

    const div = document.createElement('div');
    div.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    div.className = 'edge-label-inline';
    div.contentEditable = 'true';
    div.textContent = edge.label || '';
    div.style.whiteSpace = 'nowrap';
    div.style.padding = '0';
    div.style.margin = '0';
    div.style.background = 'transparent';
    div.style.outline = 'none';
    div.style.border = 'none';
    div.style.cursor = 'text';
    div.style.userSelect = 'text';
    div.style.WebkitUserSelect = 'text';
    div.style.minWidth = 'max-content'; // 确保内容完全显示
    div.style.width = 'max-content'; // 自动适应内容宽度
    // 字体样式与SVG文本一致
    div.style.fontSize = '16px';
    div.style.fontWeight = '500';
    const edgeColor = edge.colorHex || presetToHex(edge.color) || '';
    if (edgeColor) div.style.color = edgeColor;

    // 挖空矩形（如未存在则创建）
    let rect = svg.querySelector(`rect.canvas-edge-label-bg[data-edge-id="${edgeId}"]`);
    if (!rect) {
        rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('class', 'canvas-edge-label-bg');
        rect.setAttribute('data-edge-id', edgeId);
        rect.setAttribute('rx', '4');
        rect.setAttribute('ry', '4');
        rect.style.pointerEvents = 'none';
        try {
            const ws = document.getElementById('canvasWorkspace');
            const bg = ws ? getComputedStyle(ws).backgroundColor : getComputedStyle(document.querySelector('.canvas-main-container')).backgroundColor;
            rect.setAttribute('fill', bg || '#fff');
        } catch (_) { rect.setAttribute('fill', '#fff'); }
        svg.appendChild(rect);
    }

    const layout = () => {
        const z = (CanvasState && CanvasState.zoom) ? CanvasState.zoom : 1;
        // 使用 scrollWidth 获取实际内容宽度，而不是被截断的宽度
        const r = div.getBoundingClientRect();
        const actualWidth = Math.max(r.width, div.scrollWidth);
        const w = Math.max(12, actualWidth / z);
        const h = Math.max(14, r.height / z);
        fo.setAttribute('x', (mid.x - w / 2).toString());
        fo.setAttribute('y', (mid.y - h / 2).toString());
        fo.setAttribute('width', w.toString());
        fo.setAttribute('height', h.toString());
        rect.setAttribute('x', (mid.x - (w / 2) - 4).toString());
        rect.setAttribute('y', (mid.y - (h / 2) - 2).toString());
        rect.setAttribute('width', (w + 8).toString());
        rect.setAttribute('height', (h + 4).toString());
    };

    const apply = () => {
        const val = (div.textContent || '').trim();
        edge.label = val;
        try { fo.remove(); } catch (_) { }
        renderEdges();
        saveTempNodes();
    };
    const cancel = () => {
        try { fo.remove(); } catch (_) { }
        renderEdges();
    };

    div.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); apply(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    div.addEventListener('input', () => layout());
    div.addEventListener('blur', () => apply());
    ['mousedown', 'click', 'dblclick'].forEach(evt => div.addEventListener(evt, ev => ev.stopPropagation()));

    fo.appendChild(div);
    svg.appendChild(fo);
    requestAnimationFrame(() => {
        layout();
        div.focus();
        try {
            const range = document.createRange();
            range.selectNodeContents(div);
            range.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        } catch (_) { }
    });
}

// =============================================================================
// 导出模块
// =============================================================================

window.CanvasModule = {
    init: initCanvasView,
    enhance: enhanceBookmarkTreeForCanvas, // 增强书签树的Canvas功能
    clear: clearAllTempNodes,
    updateFullscreenButton: updateFullscreenButtonState,
    updateShortcutDisplays: updateShortcutDisplays, // 更新快捷键显示
    CanvasState: CanvasState, // 导出状态供外部访问（如指针拖拽）
    createTempNode: createTempNode, // 导出创建临时节点函数
    createMdNode: createMdNode,
    // 定位 API：供外部（history.js / 标记页）调用
    locatePermanent: locateToPermanentSection,
    locateSection: locateToTempSection,
    locateElement: locateToElement,
    // 性能优化：休眠管理
    scheduleDormancyUpdate: scheduleDormancyUpdate,
    forceWakeAndRender: forceWakeAndRender,
    clearLazyLoadState: clearLazyLoadState,
    // 懒加载：供拖拽模块调用
    loadFolderChildren: loadFolderChildren,
    getTempSection: getTempSection,
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
