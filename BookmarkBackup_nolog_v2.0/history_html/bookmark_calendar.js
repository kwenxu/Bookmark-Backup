// 书签日历 - iOS风格层级导航
// 默认月视图，每个视图下方显示书签列表

// 翻译辅助函数
function t(key, ...args) {
    if (typeof i18n === 'undefined' || typeof currentLang === 'undefined') {
        return key; // 降级方案
    }
    let text = i18n[key] ? i18n[key][currentLang] : key;
    // 替换占位符 {0}, {1}, etc.
    args.forEach((arg, index) => {
        text = text.replace(`{${index}}`, arg);
    });
    return text;
}

function tw(index) {
    // 获取星期几的翻译（缩写）
    if (typeof i18n === 'undefined' || typeof currentLang === 'undefined') {
        return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][index];
    }
    return i18n.calendarWeekdays[currentLang][index] || '';
}

function twFull(index) {
    // 获取星期几的完整名称
    if (typeof i18n === 'undefined' || typeof currentLang === 'undefined') {
        return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][index];
    }
    return i18n.calendarWeekdaysFull[currentLang][index] || '';
}

function tm(index) {
    // 获取月份名称的翻译 (0-11)
    if (typeof i18n === 'undefined' || typeof currentLang === 'undefined') {
        return ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'][index];
    }
    return i18n.calendarMonthNames[currentLang][index] || '';
}

function formatYearMonth(year, month) {
    // 格式化年月显示 (month是0-11)
    if (typeof i18n === 'undefined' || typeof currentLang === 'undefined') {
        return `${year}年${month + 1}月`;
    }
    const monthName = tm(month);
    return t('calendarYearMonth', year, monthName).replace('{0}', year).replace('{1}', monthName);
}

// 按小时分组书签
function groupBookmarksByHour(bookmarks) {
    const groups = {}; // { hour: [bookmarks] }

    bookmarks.forEach(bm => {
        const hour = bm.dateAdded.getHours();
        if (!groups[hour]) {
            groups[hour] = [];
        }
        groups[hour].push(bm);
    });

    return groups;
}

class BookmarkCalendar {
    constructor() {
        this.bookmarksByDate = new Map(); // { 'YYYY-MM-DD': [bookmarks] }
        this.currentYear = new Date().getFullYear();
        this.currentMonth = new Date().getMonth();
        this.currentWeekStart = null;
        this.currentDay = null;
        this.viewLevel = 'month'; // 默认月视图 'year' | 'month' | 'week' | 'day'
        this.selectMode = false; // 勾选模式
        this.selectedDates = new Set(); // 已勾选的日期集合 'YYYY-MM-DD'
        this.bookmarkSortAsc = false; // 书签排序：true=正序，false=倒序（默认倒序）
        this.sortButtonCooldown = false; // 排序按钮点击防抖标志

        // 拖拽勾选相关状态
        this.isDragging = false; // 是否正在拖拽
        this.dragStartDate = null; // 拖拽起始的日期key
        this.dragStartPos = null; // 拖拽起始位置
        this.dragMinDistance = 10; // 拖拽最小距离(px)
        this.renderDebounceTimer = null; // 防抖定时器

        this.init();
    }

    async init() {
        console.log('[BookmarkCalendar] 初始化...');

        // 初始化FaviconCache（如果可用）
        if (typeof FaviconCache !== 'undefined' && FaviconCache.init) {
            try {
                await FaviconCache.init();
                console.log('[BookmarkCalendar] FaviconCache初始化完成');
            } catch (error) {
                console.warn('[BookmarkCalendar] FaviconCache初始化失败:', error);
            }
        }

        await this.loadBookmarkData();

        // 从localStorage恢复勾选模式和视图状态
        this.restoreSelectMode();

        // 如果没有恢复视图状态，则跳转到最近有书签的月份（默认当月+当天）
        const savedViewState = localStorage.getItem('bookmarkCalendar_viewState');
        if (!savedViewState) {
            this.jumpToRecentBookmarks();
        }

        // 确保currentWeekStart总是有值（某些视图需要）
        if (!this.currentWeekStart) {
            const today = new Date();
            const todayDay = today.getDay() || 7;
            this.currentWeekStart = new Date(today);
            this.currentWeekStart.setDate(today.getDate() - todayDay + 1);
            this.currentWeekStart.setHours(0, 0, 0, 0);
        }

        // 预热favicon缓存
        this.preloadFavicons();

        this.setupBreadcrumb();
        this.setupDragEvents();
        this.render();

        // 恢复后更新按钮状态
        this.updateSelectModeButton();
    }

    // 从localStorage恢复勾选模式和视图状态
    restoreSelectMode() {
        const savedSelectMode = localStorage.getItem('bookmarkCalendar_selectMode');
        const savedSelectedDates = localStorage.getItem('bookmarkCalendar_selectedDates');
        const savedViewState = localStorage.getItem('bookmarkCalendar_viewState');
        const savedSortAsc = localStorage.getItem('bookmarkCalendar_sortAsc');

        if (savedSelectMode === 'true') {
            this.selectMode = true;
        }

        // 恢复排序状态
        if (savedSortAsc !== null) {
            this.bookmarkSortAsc = savedSortAsc === 'true';
        }

        if (savedSelectedDates) {
            try {
                const dates = JSON.parse(savedSelectedDates);
                this.selectedDates = new Set(dates);
                console.log('[BookmarkCalendar] 恢复选中日期:', this.selectedDates.size);
            } catch (error) {
                console.warn('[BookmarkCalendar] 恢复选中日期失败:', error);
                this.selectedDates = new Set();
            }
        }

        // 恢复视图状态（级别、年月周日）
        if (savedViewState) {
            try {
                const viewState = JSON.parse(savedViewState);
                this.viewLevel = viewState.viewLevel || 'month';
                this.currentYear = viewState.currentYear || new Date().getFullYear();
                this.currentMonth = viewState.currentMonth || new Date().getMonth();

                if (viewState.currentWeekStart) {
                    this.currentWeekStart = new Date(viewState.currentWeekStart);
                }
                if (viewState.currentDay) {
                    this.currentDay = new Date(viewState.currentDay);
                }

                console.log('[BookmarkCalendar] 恢复视图状态:', {
                    viewLevel: this.viewLevel,
                    year: this.currentYear,
                    month: this.currentMonth
                });
            } catch (error) {
                console.warn('[BookmarkCalendar] 恢复视图状态失败:', error);
            }
        }
    }

    // 保存勾选模式和视图状态到localStorage
    saveSelectMode() {
        // 只保存selectMode（不清除selectedDates）
        localStorage.setItem('bookmarkCalendar_selectMode', this.selectMode ? 'true' : 'false');

        // 如果在勾选模式下，保存选中的日期
        if (this.selectMode) {
            localStorage.setItem('bookmarkCalendar_selectedDates', JSON.stringify(Array.from(this.selectedDates)));
        }
        // 如果退出勾选模式，不清除selectedDates（已在toggleSelectMode中处理）

        // 始终保存视图状态
        const viewState = {
            viewLevel: this.viewLevel,
            currentYear: this.currentYear,
            currentMonth: this.currentMonth,
            currentWeekStart: this.currentWeekStart ? this.currentWeekStart.toISOString() : null,
            currentDay: this.currentDay ? this.currentDay.toISOString() : null
        };
        localStorage.setItem('bookmarkCalendar_viewState', JSON.stringify(viewState));
    }

    // 清除勾选模式的临时记忆
    clearSelectModeMemory() {
        localStorage.removeItem('bookmarkCalendar_selectMode');
        localStorage.removeItem('bookmarkCalendar_selectedDates');
        localStorage.removeItem('bookmarkCalendar_viewState');
    }

    // 更新勾选模式按钮的视觉状态
    updateSelectModeButton() {
        const btn = document.getElementById('calendarSelectModeBtn');
        if (!btn) return;

        if (this.selectMode) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    }

    // 设置全局拖拽事件
    setupDragEvents() {
        // 全局mousemove：用于计算拖拽距离
        document.addEventListener('mousemove', (e) => {
            this.lastMouseEvent = e; // 记录最后的鼠标位置，供mouseenter中使用
            if (this.isDragging && this.dragStartPos) {
                // 计算从起始位置的距离
                const dx = e.clientX - this.dragStartPos.x;
                const dy = e.clientY - this.dragStartPos.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                // 只有当距离超过阈值时才认为是真正的拖拽
                if (distance > this.dragMinDistance) {
                    // 这是真实拖拽，防抖render
                    this.debouncedRender();
                }
            }
        });

        // 全局mouseup：结束拖拽
        document.addEventListener('mouseup', (e) => {
            if (this.isDragging) {
                // 计算最终的拖拽距离
                const distance = this.dragStartPos ?
                    Math.sqrt(Math.pow(e.clientX - this.dragStartPos.x, 2) +
                        Math.pow(e.clientY - this.dragStartPos.y, 2)) : 0;

                // 如果距离小于阈值，说明是单点，执行防抖render
                // 如果是真实拖拽，则直接render（可能已经防抖过多次了）
                this.render();

                // 保存勾选状态
                if (this.selectMode) {
                    this.saveSelectMode();
                }

                // 重置状态
                this.isDragging = false;
                this.dragStartDate = null;
                this.dragStartPos = null;
            }
        });

        // 防止拖拽时选中文本
        document.addEventListener('selectstart', (e) => {
            if (this.isDragging) {
                e.preventDefault();
            }
        });
    }

    // 防抖render - 拖拽中频繁更新视图
    debouncedRender() {
        if (this.renderDebounceTimer) {
            clearTimeout(this.renderDebounceTimer);
        }
        this.renderDebounceTimer = setTimeout(() => {
            this.render();
            this.renderDebounceTimer = null;
        }, 50); // 50ms防抖
    }

    preloadFavicons() {
        // 收集所有书签URL
        const allUrls = [];
        for (const bookmarks of this.bookmarksByDate.values()) {
            bookmarks.forEach(bm => {
                if (bm.url) allUrls.push(bm.url);
            });
        }

        // 预热favicon缓存
        if (typeof warmupFaviconCache === 'function') {
            warmupFaviconCache(allUrls).catch(err => {
                console.warn('[BookmarkCalendar] Favicon预热失败:', err);
            });
        }
    }

    async loadBookmarkData() {
        try {
            const bookmarks = await chrome.bookmarks.getTree();
            this.parseBookmarks(bookmarks[0]);
            console.log('[BookmarkCalendar] 加载完成，共', this.bookmarksByDate.size, '个日期');
        } catch (error) {
            console.error('[BookmarkCalendar] 加载失败:', error);
        }
    }

    parseBookmarks(node, parentPath = []) {
        if (node.url && node.dateAdded) {
            const date = new Date(node.dateAdded);
            const dateKey = this.getDateKey(date);

            if (!this.bookmarksByDate.has(dateKey)) {
                this.bookmarksByDate.set(dateKey, []);
            }

            this.bookmarksByDate.get(dateKey).push({
                id: node.id,
                title: node.title,
                url: node.url,
                dateAdded: date,
                folderPath: parentPath.slice() // 记录父文件夹路径
            });
        }

        if (node.children) {
            const newPath = node.title ? [...parentPath, node.title] : parentPath;
            node.children.forEach(child => this.parseBookmarks(child, newPath));
        }
    }

    getDateKey(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    isToday(date) {
        const today = new Date();
        return date.getFullYear() === today.getFullYear() &&
            date.getMonth() === today.getMonth() &&
            date.getDate() === today.getDate();
    }

    // ISO 8601 周数计算(全球统一标准)
    // 规则: 1) 周一为一周开始 2) 第一周包含当年第一个周四
    getWeekNumber(date) {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        // 将日期调整到当周的周四
        d.setDate(d.getDate() + 4 - (d.getDay() || 7));
        // 获取该周四所在年份的1月1日
        const yearStart = new Date(d.getFullYear(), 0, 1);
        // 计算周数
        const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
        return weekNo;
    }

    // 获取某周的周一日期(ISO 8601标准)
    getMondayOfWeek(year, weekNum) {
        const jan4 = new Date(year, 0, 4);
        const jan4Day = jan4.getDay() || 7; // 1=周一, 7=周日
        const mondayOfWeek1 = new Date(jan4);
        mondayOfWeek1.setDate(jan4.getDate() - jan4Day + 1);
        const targetMonday = new Date(mondayOfWeek1);
        targetMonday.setDate(mondayOfWeek1.getDate() + (weekNum - 1) * 7);
        return targetMonday;
    }

    jumpToRecentBookmarks() {
        // 默认显示当前日期
        const today = new Date();
        this.currentYear = today.getFullYear();
        this.currentMonth = today.getMonth();
        this.currentDay = today;

        // 计算当前周的周一(ISO 8601标准)
        const todayDay = today.getDay() || 7; // 1-7 (周一到周日)
        this.currentWeekStart = new Date(today);
        this.currentWeekStart.setDate(today.getDate() - todayDay + 1);

        console.log('[BookmarkCalendar] 默认显示当月当天:', this.currentYear, '年', this.currentMonth + 1, '月');
    }

    // ========== 面包屑导航 ==========

    setupBreadcrumb() {
        document.getElementById('breadcrumbYear')?.addEventListener('click', () => this.navigateToYear());
        document.getElementById('breadcrumbMonth')?.addEventListener('click', () => this.navigateToMonth());
        document.getElementById('breadcrumbWeek')?.addEventListener('click', () => this.navigateToWeek());

        // 勾选模式按钮
        document.getElementById('calendarSelectModeBtn')?.addEventListener('click', () => this.toggleSelectMode());

        // 定位至今天按钮
        document.getElementById('calendarLocateTodayBtn')?.addEventListener('click', () => this.locateToToday());

        // 导出按钮
        document.getElementById('calendarExportBtn')?.addEventListener('click', () => this.openExportModal());

        // 导出模态框初始化
        this.setupExportUI();

        // 设置下拉菜单功能
        this.setupDropdownMenus();
    }

    setupDropdownMenus() {
        // 为当前视图的下拉触发器添加点击事件（只处理 bookmark 日历自己的触发器）
        const triggers = document.querySelectorAll('.breadcrumb-dropdown-trigger');
        triggers.forEach(trigger => {
            const targetId = trigger.getAttribute('data-target');
            if (!targetId || !targetId.startsWith('breadcrumb')) return;

            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const menu = document.getElementById(`${targetId}-menu`);

                // 关闭其他所有菜单
                document.querySelectorAll('.breadcrumb-dropdown-menu').forEach(m => {
                    if (m !== menu) m.classList.remove('show');
                });

                // 切换当前菜单
                if (menu) {
                    const isShowing = menu.classList.contains('show');
                    menu.classList.toggle('show');

                    // 如果菜单打开，填充候选项
                    if (!isShowing) {
                        this.populateDropdownMenu(targetId, menu);
                    }
                }
            });
        });

        // 点击页面其他地方关闭所有菜单
        document.addEventListener('click', () => {
            document.querySelectorAll('.breadcrumb-dropdown-menu').forEach(menu => {
                menu.classList.remove('show');
            });
        });

        // 防止点击菜单内部时关闭菜单
        document.querySelectorAll('.breadcrumb-dropdown-menu').forEach(menu => {
            menu.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        });
    }

    populateDropdownMenu(targetId, menu) {
        menu.innerHTML = ''; // 清空现有内容
        let activeItem = null; // 用于存储当前激活的项

        if (targetId === 'breadcrumbYear') {
            // 生成年份候选项（当前年份前后各5年）
            const currentYear = new Date().getFullYear();
            const startYear = currentYear - 5;
            const endYear = currentYear + 5;

            for (let year = endYear; year >= startYear; year--) {
                const item = document.createElement('div');
                item.className = 'breadcrumb-dropdown-item';
                if (year === this.currentYear) {
                    item.classList.add('active');
                    activeItem = item; // 记录激活项
                }
                item.textContent = t('calendarYear', year);
                item.addEventListener('click', () => {
                    this.currentYear = year;
                    this.viewLevel = 'year';
                    this.render();
                    menu.classList.remove('show');
                });
                menu.appendChild(item);
            }
        } else if (targetId === 'breadcrumbMonth') {
            // 生成月份候选项（1-12月）
            for (let month = 0; month < 12; month++) {
                const item = document.createElement('div');
                item.className = 'breadcrumb-dropdown-item';
                if (month === this.currentMonth) {
                    item.classList.add('active');
                    activeItem = item; // 记录激活项
                }
                item.textContent = tm(month);
                item.addEventListener('click', () => {
                    this.currentMonth = month;
                    this.viewLevel = 'month';
                    this.render();
                    menu.classList.remove('show');
                });
                menu.appendChild(item);
            }
        } else if (targetId === 'breadcrumbWeek') {
            // 生成本月所有周的候选项
            const firstDayOfMonth = new Date(this.currentYear, this.currentMonth, 1);
            const lastDayOfMonth = new Date(this.currentYear, this.currentMonth + 1, 0);

            let weekStart = new Date(firstDayOfMonth);
            const startDay = weekStart.getDay() || 7;
            weekStart.setDate(weekStart.getDate() - startDay + 1);

            while (weekStart <= lastDayOfMonth) {
                const weekNum = this.getWeekNumber(weekStart);
                const weekStartCopy = new Date(weekStart);

                const item = document.createElement('div');
                item.className = 'breadcrumb-dropdown-item';

                // 检查是否是当前周
                if (this.currentWeekStart &&
                    weekStartCopy.getTime() === this.currentWeekStart.getTime()) {
                    item.classList.add('active');
                    activeItem = item; // 记录激活项
                }

                item.textContent = t('calendarWeek', weekNum);
                item.addEventListener('click', () => {
                    this.currentWeekStart = weekStartCopy;
                    this.viewLevel = 'week';
                    this.render();
                    menu.classList.remove('show');
                });
                menu.appendChild(item);

                weekStart.setDate(weekStart.getDate() + 7);
            }
        } else if (targetId === 'breadcrumbDay') {
            // 生成本周所有日期的候选项
            for (let i = 0; i < 7; i++) {
                const date = new Date(this.currentWeekStart);
                date.setDate(date.getDate() + i);

                const item = document.createElement('div');
                item.className = 'breadcrumb-dropdown-item';

                if (this.currentDay &&
                    date.toDateString() === this.currentDay.toDateString()) {
                    item.classList.add('active');
                    activeItem = item; // 记录激活项
                }

                item.textContent = t('calendarMonthDay', date.getMonth() + 1, date.getDate());
                item.addEventListener('click', () => {
                    this.currentDay = new Date(date);
                    this.viewLevel = 'day';
                    this.render();
                    menu.classList.remove('show');
                });
                menu.appendChild(item);
            }
        }

        // 如果找到了激活项，直接定位到该项位置（无动画）
        if (activeItem) {
            // 使用 setTimeout 确保 DOM 已经渲染完成
            setTimeout(() => {
                activeItem.scrollIntoView({
                    behavior: 'auto',  // 立即定位，无动画
                    block: 'center'    // 居中显示
                });
            }, 10);
        }
    }

    toggleSelectMode() {
        this.selectMode = !this.selectMode;
        const btn = document.getElementById('calendarSelectModeBtn');
        if (this.selectMode) {
            btn?.classList.add('active');
            this.saveSelectMode(); // 进入勾选模式时保存
        } else {
            btn?.classList.remove('active');
            this.selectedDates.clear(); // 退出勾选模式时清空选择
            this.clearSelectModeMemory(); // 清除临时记忆
        }
        this.render();
    }

    locateToToday() {
        const today = new Date();
        this.currentYear = today.getFullYear();
        this.currentMonth = today.getMonth();
        this.currentDay = today;
        // 计算当前周的周一(ISO 8601标准)
        const todayDay = today.getDay() || 7;
        this.currentWeekStart = new Date(today);
        this.currentWeekStart.setDate(today.getDate() - todayDay + 1);
        this.viewLevel = 'month';
        this.render();

        // 添加呼吸动画到今天的格子
        setTimeout(() => {
            const todayCell = document.querySelector('.calendar-day[data-is-today="true"]');
            if (todayCell) {
                todayCell.classList.add('breathe-animation');
                setTimeout(() => {
                    todayCell.classList.remove('breathe-animation');
                }, 1200);
            }
        }, 100);
    }

    updateBreadcrumb() {
        const activeColor = this.selectMode ? '#4CAF50' : 'var(--accent-primary)';

        // 年
        const yearBtn = document.getElementById('breadcrumbYear');
        document.getElementById('breadcrumbYearText').textContent = t('calendarYear', this.currentYear);
        yearBtn.classList.toggle('active', this.viewLevel === 'year');
        if (this.viewLevel === 'year') {
            yearBtn.style.color = activeColor;
        } else {
            yearBtn.style.color = '';
        }

        // 月
        const monthBtn = document.getElementById('breadcrumbMonth');
        const sep1 = document.getElementById('separator1');
        if (this.viewLevel === 'month' || this.viewLevel === 'week' || this.viewLevel === 'day') {
            monthBtn.style.display = 'block';
            sep1.style.display = 'inline';
            document.getElementById('breadcrumbMonthText').textContent = tm(this.currentMonth);
            monthBtn.classList.toggle('active', this.viewLevel === 'month');
            if (this.viewLevel === 'month') {
                monthBtn.style.color = activeColor;
            } else {
                monthBtn.style.color = '';
            }
        } else {
            monthBtn.style.display = 'none';
            sep1.style.display = 'none';
        }

        // 周
        const weekBtn = document.getElementById('breadcrumbWeek');
        const sep2 = document.getElementById('separator2');
        if (this.viewLevel === 'week' || this.viewLevel === 'day') {
            weekBtn.style.display = 'block';
            sep2.style.display = 'inline';
            const weekNum = this.getWeekNumber(this.currentWeekStart);
            document.getElementById('breadcrumbWeekText').textContent = t('calendarWeek', weekNum);
            weekBtn.classList.toggle('active', this.viewLevel === 'week');
            if (this.viewLevel === 'week') {
                weekBtn.style.color = activeColor;
            } else {
                weekBtn.style.color = '';
            }
        } else {
            weekBtn.style.display = 'none';
            sep2.style.display = 'none';
        }

        // 日
        const dayBtn = document.getElementById('breadcrumbDay');
        const sep3 = document.getElementById('separator3');
        if (this.viewLevel === 'day') {
            dayBtn.style.display = 'block';
            sep3.style.display = 'inline';
            document.getElementById('breadcrumbDayText').textContent =
                t('calendarMonthDay', this.currentDay.getMonth() + 1, this.currentDay.getDate());
            dayBtn.classList.add('active');
            dayBtn.style.color = activeColor;
        } else {
            dayBtn.style.display = 'none';
            sep3.style.display = 'none';
        }
    }

    navigateToYear() {
        this.viewLevel = 'year';
        this.render();
    }

    navigateToMonth() {
        this.viewLevel = 'month';
        this.render();
    }

    navigateToWeek() {
        this.viewLevel = 'week';
        this.render();
    }

    // ========== 渲染主函数 ==========

    render() {
        const container = document.getElementById('bookmarkCalendarView');
        if (!container) return;

        container.innerHTML = '';

        switch (this.viewLevel) {
            case 'year':
                this.renderYearView(container);
                break;
            case 'month':
                this.renderMonthView(container);
                // 月视图完成后，同步左右两侧的高度
                requestAnimationFrame(() => {
                    this.syncMonthViewHeights();
                });
                break;
            case 'week':
                this.renderWeekView(container);
                break;
            case 'day':
                this.renderDayView(container);
                break;
        }

        this.updateBreadcrumb();

        // 控制面包屑导航处导出按钮的显示：只在年视图显示
        const breadcrumbExportBtn = document.getElementById('calendarExportBtn');
        if (breadcrumbExportBtn) {
            if (this.viewLevel === 'year') {
                breadcrumbExportBtn.style.display = 'flex';
            } else {
                breadcrumbExportBtn.style.display = 'none';
            }
        }

        // 每次render后保存状态（勾选状态和视图状态）
        this.saveSelectMode();
    }

    // 同步月视图左右两侧的高度对齐
    syncMonthViewHeights() {
        const topSection = document.querySelector('[data-calendar-top-section]');
        if (!topSection) return;

        const weeksColumn = topSection.querySelector('[data-weeks-column]');
        const calendarWrapper = topSection.querySelector('[data-calendar-wrapper]');

        if (!weeksColumn || !calendarWrapper) return;

        // 同步顶部导航和周标签的高度
        const navPlaceholder = weeksColumn.querySelector('[data-nav-placeholder]');
        const rightHeader = calendarWrapper.querySelector('[data-calendar-header]');
        if (navPlaceholder && rightHeader) {
            const rightHeaderHeight = rightHeader.offsetHeight;
            navPlaceholder.style.height = rightHeaderHeight + 'px';
            navPlaceholder.style.minHeight = rightHeaderHeight + 'px';
        }

        // 同步周标签和weekday标题的高度
        const weekHeader = weeksColumn.querySelector('[data-week-label]');
        const weekdayHeader = calendarWrapper.querySelector('[data-weekday-header]');
        if (weekHeader && weekdayHeader) {
            const weekdayHeaderHeight = weekdayHeader.offsetHeight;
            weekHeader.style.height = weekdayHeaderHeight + 'px';
            weekHeader.style.minHeight = weekdayHeaderHeight + 'px';
        }

        // 同步周数容器和日历网格的高度及行高
        const weeksContainer = weeksColumn.querySelector('[data-weeks-container]');
        const grid = calendarWrapper.querySelector('[data-calendar-grid]');
        if (weeksContainer && grid) {
            const gridHeight = grid.offsetHeight;
            const gridRows = weeksContainer.querySelectorAll('[data-week-div]').length;
            weeksContainer.style.height = gridHeight + 'px';

            // 计算gap的总高度
            const gap = 10; // 与grid的gap一致
            const totalGapHeight = (gridRows - 1) * gap;
            const availableHeight = gridHeight - totalGapHeight;
            const rowHeight = availableHeight / gridRows;

            weeksContainer.style.gridTemplateRows = `repeat(${gridRows}, ${rowHeight}px)`;

            // 同步每一行的高度
            weeksContainer.querySelectorAll('[data-week-div]').forEach((weekDiv) => {
                weekDiv.style.height = rowHeight + 'px';
            });
        }
    }

    // ========== 月视图（默认） ==========

    renderMonthView(container) {
        const wrapper = document.createElement('div');
        wrapper.style.padding = '20px';

        // 上方：周数 + 日历
        const topSection = document.createElement('div');
        topSection.style.display = 'flex';
        topSection.style.gap = '20px';
        topSection.setAttribute('data-calendar-top-section', '');

        // 左侧周数
        topSection.appendChild(this.createWeeksColumn());

        // 右侧日历
        topSection.appendChild(this.createMonthCalendar());

        wrapper.appendChild(topSection);

        // 下方：本月书签列表（按周、日分组）
        wrapper.appendChild(this.createMonthBookmarksList());

        container.appendChild(wrapper);
    }

    createWeeksColumn() {
        const column = document.createElement('div');
        column.setAttribute('data-weeks-column', '');
        column.style.minWidth = '50px';
        column.style.borderRight = '1px solid var(--border-color)';
        column.style.paddingRight = '10px';
        column.style.display = 'flex';
        column.style.flexDirection = 'column';

        // 占位：与右侧月份导航对齐
        const navPlaceholder = document.createElement('div');
        navPlaceholder.setAttribute('data-nav-placeholder', '');
        navPlaceholder.style.display = 'flex';
        navPlaceholder.style.alignItems = 'center';
        navPlaceholder.style.justifyContent = 'center';
        navPlaceholder.style.marginBottom = '20px';
        navPlaceholder.style.minHeight = '40px'; // 匹配导航按钮的高度
        column.appendChild(navPlaceholder);

        // 周标签：与右侧星期标题对齐
        const header = document.createElement('div');
        header.setAttribute('data-week-label', '');
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'center';
        header.style.fontSize = '18px';
        header.style.fontWeight = '700';
        header.style.color = '#2196F3';
        header.style.padding = '8px 0';
        header.style.marginBottom = '10px';
        header.textContent = t('calendarWeekLabel');
        column.appendChild(header);

        const firstDay = new Date(this.currentYear, this.currentMonth, 1);
        const lastDay = new Date(this.currentYear, this.currentMonth + 1, 0);

        // 获取一周开始日(中文:周一=1, 英文:周日=0)
        const weekStartDay = (typeof currentLang !== 'undefined' && currentLang === 'zh_CN') ? 1 : 0;

        // 计算需要显示的周数行(基于显示的周开始日)
        const firstDayOfWeek = firstDay.getDay();
        let offset = (firstDayOfWeek - weekStartDay + 7) % 7;
        const daysInMonth = lastDay.getDate();
        const totalCells = offset + daysInMonth;
        const numRows = Math.ceil(totalCells / 7);

        // 计算每行对应的周数(使用ISO 8601标准)
        // 找到月视图第一行对应的周一(不管显示从周几开始,周数都基于周一)
        let weekMonday = new Date(firstDay);
        const firstDayDay = firstDay.getDay() || 7; // 1-7 (周一到周日)
        weekMonday.setDate(firstDay.getDate() - firstDayDay + 1); // 调整到当周周一

        // 创建周数容器，使其与右侧日历单元格对齐
        const weeksContainer = document.createElement('div');
        weeksContainer.setAttribute('data-weeks-container', '');
        weeksContainer.style.display = 'grid';
        weeksContainer.style.gridTemplateRows = `repeat(${numRows}, 1fr)`;
        weeksContainer.style.gap = '10px';
        weeksContainer.style.flex = '1';

        // 为每一行创建周数
        for (let row = 0; row < numRows; row++) {
            const weekNum = this.getWeekNumber(weekMonday);
            const weekMondayCopy = new Date(weekMonday);

            const weekDiv = document.createElement('div');
            weekDiv.setAttribute('data-week-div', '');
            weekDiv.style.display = 'flex';
            weekDiv.style.alignItems = 'center';
            weekDiv.style.justifyContent = 'center';
            weekDiv.style.cursor = 'pointer';
            weekDiv.style.borderRadius = '6px';
            weekDiv.style.transition = 'all 0.2s';
            weekDiv.style.fontSize = '14px';
            weekDiv.style.fontWeight = '600';
            weekDiv.style.color = '#2196F3';
            weekDiv.textContent = weekNum;

            weekDiv.addEventListener('click', () => {
                this.currentWeekStart = weekMondayCopy;
                this.viewLevel = 'week';
                this.render();
            });

            weekDiv.addEventListener('mouseenter', () => {
                weekDiv.style.background = 'var(--bg-secondary)';
            });

            weekDiv.addEventListener('mouseleave', () => {
                weekDiv.style.background = 'transparent';
            });

            weeksContainer.appendChild(weekDiv);
            weekMonday.setDate(weekMonday.getDate() + 7); // 下一周的周一
        }

        column.appendChild(weeksContainer);
        return column;
    }

    createMonthCalendar() {
        const wrapper = document.createElement('div');
        wrapper.setAttribute('data-calendar-wrapper', '');
        wrapper.style.flex = '1';

        // 导航
        const header = document.createElement('div');
        header.setAttribute('data-calendar-header', '');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.marginBottom = '20px';

        header.innerHTML = `
            <button class="calendar-nav-btn" id="prevMonth">
                <i class="fas fa-chevron-left"></i>
            </button>
            <div style="font-size: 18px; font-weight: 600;" id="monthViewHeaderTitle">
                ${formatYearMonth(this.currentYear, this.currentMonth)}
            </div>
            <button class="calendar-nav-btn" id="nextMonth">
                <i class="fas fa-chevron-right"></i>
            </button>
        `;
        wrapper.appendChild(header);

        header.querySelector('#prevMonth').addEventListener('click', () => {
            if (this.currentMonth === 0) {
                this.currentYear--;
                this.currentMonth = 11;
            } else {
                this.currentMonth--;
            }
            this.render();
        });

        header.querySelector('#nextMonth').addEventListener('click', () => {
            if (this.currentMonth === 11) {
                this.currentYear++;
                this.currentMonth = 0;
            } else {
                this.currentMonth++;
            }
            this.render();
        });

        // 获取一周开始日(中文:周一=1, 英文:周日=0)
        const weekStartDay = (typeof currentLang !== 'undefined' && currentLang === 'zh_CN') ? 1 : 0;

        // 星期标题行（独立于日历网格）
        const weekdayHeader = document.createElement('div');
        weekdayHeader.setAttribute('data-weekday-header', '');
        weekdayHeader.style.display = 'grid';
        weekdayHeader.style.gridTemplateColumns = 'repeat(7, 1fr)';
        weekdayHeader.style.gap = '10px';
        weekdayHeader.style.marginBottom = '10px';

        for (let i = 0; i < 7; i++) {
            const weekday = document.createElement('div');
            weekday.style.textAlign = 'center';
            weekday.style.fontWeight = '600';
            weekday.style.color = 'var(--text-secondary)';
            weekday.style.padding = '8px 0';
            const dayIndex = (weekStartDay + i) % 7;
            weekday.textContent = tw(dayIndex);
            weekdayHeader.appendChild(weekday);
        }
        wrapper.appendChild(weekdayHeader);

        // 日历网格（仅包含日期单元格）
        const grid = document.createElement('div');
        grid.setAttribute('data-calendar-grid', '');
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(7, 1fr)';
        grid.style.gap = '10px';

        // 空白格(根据周开始日调整)
        const firstDay = new Date(this.currentYear, this.currentMonth, 1);
        const firstDayOfWeek = firstDay.getDay();
        let blankCells = (firstDayOfWeek - weekStartDay + 7) % 7;
        for (let i = 0; i < blankCells; i++) {
            grid.appendChild(document.createElement('div'));
        }

        // 天数
        const daysInMonth = new Date(this.currentYear, this.currentMonth + 1, 0).getDate();
        const today = new Date();

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(this.currentYear, this.currentMonth, day);
            const dateKey = this.getDateKey(date);
            const bookmarks = this.bookmarksByDate.get(dateKey) || [];
            const isTodayCell = this.isToday(date);

            const dayCell = document.createElement('div');
            dayCell.className = 'calendar-day';
            dayCell.style.aspectRatio = '1';
            dayCell.style.position = 'relative';
            dayCell.style.border = isTodayCell ? '2px solid #2196F3' : '1px solid var(--border-color)';
            dayCell.style.borderRadius = '8px';
            dayCell.style.padding = '8px';
            dayCell.style.cursor = 'pointer';
            dayCell.style.background = bookmarks.length > 0 ? 'var(--bg-secondary)' : 'var(--bg-primary)';
            dayCell.style.transition = 'all 0.2s';
            dayCell.dataset.dateKey = dateKey;
            dayCell.dataset.isToday = isTodayCell ? 'true' : 'false';

            // 勾选模式下的样式
            if (this.selectedDates.has(dateKey)) {
                dayCell.classList.add('selected');
            }

            const countColor = this.selectMode ? '#4CAF50' : 'var(--accent-primary)';
            dayCell.innerHTML = `
                <div style="font-weight: 600;">${day}</div>
                ${bookmarks.length > 0 ? `<div style="font-size: 12px; color: ${countColor}; margin-top: 4px;">${t('calendarBookmarkCount', bookmarks.length)}</div>` : ''}
                ${isTodayCell ? `<div style="position: absolute; bottom: 4px; right: 4px; font-size: 10px; color: #2196F3; font-weight: 600;">${currentLang === 'en' ? 'Today' : '今天'}</div>` : ''}
            `;

            // 勾选模式下的事件处理
            if (this.selectMode) {
                // 只有有书签数据的格子才能被勾选
                if (bookmarks.length > 0) {
                    // 鼠标进入：拖拽中时勾选（不立即render，通过防抖render）
                    dayCell.addEventListener('mouseenter', () => {
                        if (this.isDragging && this.dragStartPos) {
                            // 计算距离
                            const pageEvent = this.lastMouseEvent || { clientX: this.dragStartPos.x, clientY: this.dragStartPos.y };
                            const distance = Math.sqrt(
                                Math.pow(pageEvent.clientX - this.dragStartPos.x, 2) +
                                Math.pow(pageEvent.clientY - this.dragStartPos.y, 2)
                            );

                            // 只有在真实拖拽时（距离>阈值）才添加选中
                            if (distance > this.dragMinDistance) {
                                this.selectedDates.add(dateKey);
                                dayCell.classList.add('selected');
                                // 防抖render，不要频繁全部重新渲染
                                this.debouncedRender();
                            }
                        }
                    });

                    // mouseup时如果是单击，则切换选中状态
                    dayCell.addEventListener('mouseup', (e) => {
                        if (this.isDragging && this.dragStartPos) {
                            const distance = Math.sqrt(
                                Math.pow(e.clientX - this.dragStartPos.x, 2) +
                                Math.pow(e.clientY - this.dragStartPos.y, 2)
                            );

                            // 单击：距离<阈值，切换选中状态
                            if (distance <= this.dragMinDistance) {
                                if (this.selectedDates.has(dateKey)) {
                                    this.selectedDates.delete(dateKey);
                                } else {
                                    this.selectedDates.add(dateKey);
                                }
                            }
                        }
                    });
                } else {
                    // 空白格子：显示为不可用状态
                    dayCell.style.opacity = '0.5';
                }
            } else {
                // 普通模式：点击进入日视图
                dayCell.addEventListener('click', () => {
                    if (bookmarks.length > 0) {
                        this.currentDay = date;
                        // 更新currentWeekStart为该日期所在周的周一(ISO 8601标准)
                        const dateDay = date.getDay() || 7;
                        this.currentWeekStart = new Date(date);
                        this.currentWeekStart.setDate(date.getDate() - dateDay + 1);
                        this.viewLevel = 'day';
                        this.render();
                    }
                });

                if (bookmarks.length > 0) {
                    dayCell.addEventListener('mouseenter', () => {
                        dayCell.style.transform = 'scale(1.05)';
                    });

                    dayCell.addEventListener('mouseleave', () => {
                        dayCell.style.transform = 'scale(1)';
                    });
                }
            }

            grid.appendChild(dayCell);
        }

        wrapper.appendChild(grid);

        // 勾选模式：在整个日历容器上监听mousedown，允许单击和拖拽
        if (this.selectMode) {
            wrapper.addEventListener('mousedown', (e) => {
                // 检查是否点击在有效格子上
                const dayCell = e.target.closest('.calendar-day');
                if (!dayCell || !dayCell.dataset.dateKey) {
                    // 不是点击在日历格子上，不处理
                    return;
                }

                const dateKey = dayCell.dataset.dateKey;
                const bookmarks = this.bookmarksByDate.get(dateKey) || [];

                // 只处理有数据的格子
                if (bookmarks.length > 0) {
                    e.preventDefault();  // 只在点击格子时才preventDefault
                    this.isDragging = true;
                    this.dragStartPos = { x: e.clientX, y: e.clientY };
                    this.dragStartDate = dateKey;
                }
            });
        }

        return wrapper;
    }

    createMonthBookmarksList() {
        const section = document.createElement('div');
        section.style.marginTop = '40px';

        // 收集本月书签，按周分组
        const daysInMonth = new Date(this.currentYear, this.currentMonth + 1, 0).getDate();
        const bookmarksByWeek = new Map(); // week -> [{date, bookmarks}]
        let totalCount = 0;

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(this.currentYear, this.currentMonth, day);
            const dateKey = this.getDateKey(date);
            const bookmarks = this.bookmarksByDate.get(dateKey) || [];

            // 勾选模式下只显示勾选的日期
            if (this.selectMode && !this.selectedDates.has(dateKey)) {
                continue;
            }

            if (bookmarks.length > 0) {
                const weekNum = this.getWeekNumber(date);
                if (!bookmarksByWeek.has(weekNum)) {
                    bookmarksByWeek.set(weekNum, []);
                }
                bookmarksByWeek.get(weekNum).push({ date, bookmarks });
                totalCount += bookmarks.length;
            }
        }

        // 判断是否是当前月（决定默认显示模式）
        const now = new Date();
        const isCurrentMonth = (this.currentYear === now.getFullYear() && this.currentMonth === now.getMonth());

        // 当月：即使今天没有书签，也要在列表中出现一个“今天(0)”的条目
        if (isCurrentMonth) {
            const todayKey = this.getDateKey(now);
            let hasToday = false;
            for (const weekData of bookmarksByWeek.values()) {
                if (weekData.some(({ date }) => this.getDateKey(date) === todayKey)) {
                    hasToday = true;
                    break;
                }
            }
            if (!hasToday) {
                const weekNum = this.getWeekNumber(now);
                if (!bookmarksByWeek.has(weekNum)) {
                    bookmarksByWeek.set(weekNum, []);
                }
                bookmarksByWeek.get(weekNum).push({ date: new Date(now), bookmarks: [] });
            }
        }

        if (totalCount === 0 && !isCurrentMonth) {
            const emptyText = this.selectMode
                ? (currentLang === 'en' ? 'No selected dates with bookmarks' : '未选中包含书签的日期')
                : t('calendarNoBookmarksThisMonth');
            section.innerHTML = `<p style="text-align:center;color:var(--text-secondary);">${emptyText}</p>`;
            return section;
        }

        const title = document.createElement('h3');
        title.style.marginBottom = '20px';
        // 勾选模式下使用绿色标题
        if (this.selectMode) {
            title.className = 'select-mode-title';
            title.textContent = (currentLang === 'en' ? 'Selected: ' : '已选中：') + totalCount + (currentLang === 'en' ? ' bookmarks' : ' 个书签');
        } else {
            title.textContent = t('calendarTotalThisMonth', totalCount);
        }
        section.appendChild(title);

        // 左右分栏布局
        const panelContainer = document.createElement('div');
        panelContainer.style.display = 'flex';
        panelContainer.style.gap = '20px';
        panelContainer.style.minHeight = '400px';

        // 左侧菜单栏
        const sidebar = document.createElement('div');
        sidebar.style.width = '200px';
        sidebar.style.flexShrink = '0';
        sidebar.style.borderRight = '1px solid var(--border-color)';
        sidebar.style.paddingRight = '20px';

        // 右侧内容区
        const contentArea = document.createElement('div');
        contentArea.style.flex = '1';
        contentArea.style.minWidth = '0';

        const sortedWeeks = Array.from(bookmarksByWeek.keys()).sort((a, b) => a - b);

        // 是否默认显示「全部」（非当前月）
        const shouldShowAllByDefault = !this.selectMode && !isCurrentMonth;

        // 默认选中日期 key：当前月则优先今天，否则第一周的第一天
        const firstWeekData = bookmarksByWeek.get(sortedWeeks[0]);
        let selectedDateKey = this.getDateKey(firstWeekData[0].date);
        if (isCurrentMonth) {
            // 始终优先选中今天（即使今天没有数据，createMonthBookmarksList开头已经保证了今天会被加入列表）
            selectedDateKey = this.getDateKey(now);
        }

        // 添加「All」0级菜单（所有模式下都显示）
        const allMenuItem = document.createElement('div');
        allMenuItem.style.padding = '12px';
        allMenuItem.style.borderRadius = '8px';
        allMenuItem.style.cursor = 'pointer';
        allMenuItem.style.transition = 'all 0.2s';
        allMenuItem.style.fontSize = '14px';
        allMenuItem.style.fontWeight = '600';
        allMenuItem.style.marginBottom = '12px';
        allMenuItem.dataset.menuType = 'all';

        // 勾选模式下默认选中（绿色），普通模式下也默认选中（蓝色），统一从「全部」开始
        if (this.selectMode) {
            allMenuItem.style.background = '#4CAF50';
            allMenuItem.style.color = 'white';
            allMenuItem.style.border = '1px solid #4CAF50';
        } else {
            allMenuItem.style.background = 'rgba(33, 150, 243, 0.15)';
            allMenuItem.style.color = 'var(--accent-primary)';
            allMenuItem.style.fontWeight = '600';
            allMenuItem.style.border = '1px solid var(--accent-primary)';
        }

        allMenuItem.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <span><i class="fas fa-th-large"></i> ${currentLang === 'en' ? 'All' : '全部'}</span>
                <span style="font-size:12px;opacity:0.9;">${totalCount}</span>
            </div>
        `;

        allMenuItem.addEventListener('click', () => {
            // 取消其他菜单项的选中状态
            sidebar.querySelectorAll('[data-date-key]').forEach(item => {
                item.style.background = 'transparent';
                item.style.color = 'var(--text-primary)';
                item.style.fontWeight = 'normal';
                item.style.border = '1px solid transparent';
                item.classList.remove('select-mode-menu-active');
            });

            // 设置All菜单为选中状态
            if (this.selectMode) {
                allMenuItem.style.background = '#4CAF50';
                allMenuItem.style.color = 'white';
                allMenuItem.style.border = '1px solid #4CAF50';
            } else {
                allMenuItem.style.background = 'rgba(33, 150, 243, 0.15)';
                allMenuItem.style.color = 'var(--accent-primary)';
                allMenuItem.style.fontWeight = '600';
                allMenuItem.style.border = '1px solid var(--accent-primary)';
            }

            // 显示所有书签
            renderAllContent();
        });

        allMenuItem.addEventListener('mouseenter', () => {
            const isSelected = this.selectMode ?
                (allMenuItem.style.background === 'rgb(76, 175, 80)') :
                (allMenuItem.style.background === 'rgba(33, 150, 243, 0.15)');
            if (!isSelected) {
                allMenuItem.style.background = 'rgba(128, 128, 128, 0.1)';
            }
        });

        allMenuItem.addEventListener('mouseleave', () => {
            if (allMenuItem.style.background === 'rgba(128, 128, 128, 0.1)') {
                allMenuItem.style.background = 'transparent';
            }
        });

        sidebar.appendChild(allMenuItem);

        sortedWeeks.forEach((weekNum, weekIndex) => {
            const weekData = bookmarksByWeek.get(weekNum);
            const weekCount = weekData.reduce((sum, item) => sum + item.bookmarks.length, 0);

            // 在勾选模式下，默认展开所有周；否则只展开第一周
            const shouldExpand = this.selectMode ? true : (weekIndex === 0);

            // 周菜单项容器
            const weekMenuContainer = document.createElement('div');
            weekMenuContainer.style.marginBottom = '4px';

            // 周标题
            const weekHeader = document.createElement('div');
            weekHeader.style.padding = '10px 12px';
            weekHeader.style.borderRadius = '8px';
            weekHeader.style.cursor = 'pointer';
            weekHeader.style.transition = 'all 0.2s';
            weekHeader.style.fontSize = '14px';
            weekHeader.style.fontWeight = '600';
            weekHeader.style.background = 'var(--bg-secondary)';
            weekHeader.style.color = 'var(--text-primary)';
            weekHeader.dataset.weekNum = weekNum;
            weekHeader.dataset.expanded = shouldExpand ? 'true' : 'false';

            weekHeader.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span>
                        <i class="fas fa-chevron-${shouldExpand ? 'down' : 'right'}" style="font-size:12px;margin-right:6px;"></i>
                        <i class="fas fa-calendar-week"></i> ${t('calendarWeek', weekNum)}
                    </span>
                    <span style="font-size:12px;opacity:0.8;">${t('calendarBookmarkCount', weekCount)}</span>
                </div>
            `;

            // 日期子菜单容器
            const daysContainer = document.createElement('div');
            daysContainer.style.marginLeft = '12px';
            daysContainer.style.marginTop = '4px';
            daysContainer.style.display = shouldExpand ? 'block' : 'none';
            daysContainer.dataset.weekNum = weekNum;

            // 为每一天创建菜单项
            weekData.forEach(({ date, bookmarks }, dayIndex) => {
                const dateKey = this.getDateKey(date);
                const hasTimePeriods = bookmarks.length > 10; // 是否需要时间段子菜单
                const isDayToday = this.isToday(date);

                // 日期菜单项容器
                const dayMenuContainer = document.createElement('div');
                dayMenuContainer.style.marginBottom = '4px';

                const dayMenuItem = document.createElement('div');
                dayMenuItem.style.padding = '8px 12px';
                dayMenuItem.style.borderRadius = '6px';
                dayMenuItem.style.cursor = 'pointer';
                dayMenuItem.style.transition = 'all 0.2s';
                dayMenuItem.style.fontSize = '13px';
                dayMenuItem.dataset.dateKey = dateKey;
                // 在勾选模式下，默认展开所有有小时菜单的日期
                dayMenuItem.dataset.expanded = (this.selectMode && hasTimePeriods) ? 'true' : 'false';

                // 第一周的第一天默认选中（仅在普通模式下且是当前月）
                if (weekIndex === 0 && dayIndex === 0 && !this.selectMode && !shouldShowAllByDefault) {
                    dayMenuItem.style.background = 'rgba(33, 150, 243, 0.15)';
                    dayMenuItem.style.color = 'var(--accent-primary)';
                    dayMenuItem.style.fontWeight = '600';
                    dayMenuItem.style.border = '1px solid var(--accent-primary)';
                } else {
                    dayMenuItem.style.background = 'transparent';
                    dayMenuItem.style.color = 'var(--text-primary)';
                    dayMenuItem.style.border = '1px solid transparent';
                }

                const isExpanded = (this.selectMode && hasTimePeriods);
                dayMenuItem.innerHTML = `
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span>
                            ${hasTimePeriods ? `<i class="fas fa-chevron-${isExpanded ? 'down' : 'right'}" style="font-size:10px;margin-right:4px;"></i>` : ''}
                            ${tw(date.getDay())} ${date.getMonth() + 1}/${date.getDate()}${isDayToday ? ` <span style="color: #2196F3;">(${currentLang === 'en' ? 'Today' : '今天'})</span>` : ''}
                        </span>
                        <span style="font-size:12px;opacity:0.8;">${t('calendarBookmarkCount', bookmarks.length)}</span>
                    </div>
                `;

                // 小时子菜单容器（三级菜单）
                let hoursContainer = null;
                if (hasTimePeriods) {
                    hoursContainer = document.createElement('div');
                    hoursContainer.style.marginLeft = '16px';
                    hoursContainer.style.marginTop = '4px';
                    hoursContainer.style.display = isExpanded ? 'block' : 'none';
                    hoursContainer.dataset.dateKey = dateKey;

                    // 按小时分组
                    const hourGroups = groupBookmarksByHour(bookmarks);
                    const hours = Object.keys(hourGroups).map(Number).sort((a, b) => {
                        return this.bookmarkSortAsc ? (a - b) : (b - a);
                    });

                    hours.forEach(hour => {
                        const hourBookmarks = hourGroups[hour];

                        const hourMenuItem = document.createElement('div');
                        hourMenuItem.style.padding = '6px 10px';
                        hourMenuItem.style.marginBottom = '3px';
                        hourMenuItem.style.borderRadius = '4px';
                        hourMenuItem.style.cursor = 'pointer';
                        hourMenuItem.style.transition = 'all 0.2s';
                        hourMenuItem.style.fontSize = '12px';
                        hourMenuItem.style.background = 'transparent';
                        hourMenuItem.style.color = 'var(--text-primary)';
                        hourMenuItem.style.border = '1px solid transparent';
                        hourMenuItem.dataset.hour = hour;
                        hourMenuItem.dataset.parentDateKey = dateKey;

                        hourMenuItem.innerHTML = `
                            <div style="display:flex;justify-content:space-between;align-items:center;">
                                <span>${String(hour).padStart(2, '0')}:00-${String(hour).padStart(2, '0')}:59</span>
                                <span style="font-size:11px;opacity:0.8;">${hourBookmarks.length}</span>
                            </div>
                        `;

                        hourMenuItem.addEventListener('click', (e) => {
                            e.stopPropagation();

                            // 更新所有小时的选中状态
                            sidebar.querySelectorAll('div[data-hour]').forEach(item => {
                                item.style.background = 'transparent';
                                item.style.color = 'var(--text-primary)';
                                item.style.border = '1px solid transparent';
                            });

                            if (this.selectMode) {
                                // 勾选模式：绿色样式
                                hourMenuItem.style.background = 'rgba(76, 175, 80, 0.1)';
                                hourMenuItem.style.color = '#4CAF50';
                                hourMenuItem.style.border = '1px solid rgba(76, 175, 80, 0.3)';
                            } else {
                                // 普通模式：蓝色样式
                                hourMenuItem.style.background = 'rgba(33, 150, 243, 0.1)';
                                hourMenuItem.style.color = 'var(--accent-primary)';
                                hourMenuItem.style.border = '1px solid rgba(33, 150, 243, 0.3)';
                            }

                            renderHourContent(date, hour, hourBookmarks);
                        });

                        hourMenuItem.addEventListener('mouseenter', () => {
                            if (hourMenuItem.style.background === 'transparent') {
                                hourMenuItem.style.background = 'rgba(128, 128, 128, 0.05)';
                            }
                        });

                        hourMenuItem.addEventListener('mouseleave', () => {
                            if (hourMenuItem.style.border === '1px solid transparent') {
                                hourMenuItem.style.background = 'transparent';
                            }
                        });

                        hoursContainer.appendChild(hourMenuItem);
                    });
                }

                dayMenuItem.addEventListener('click', (e) => {
                    e.stopPropagation();

                    // 取消All菜单的选中状态
                    const allMenu = sidebar.querySelector('[data-menu-type="all"]');
                    if (allMenu) {
                        allMenu.style.background = 'transparent';
                        allMenu.style.color = 'var(--text-primary)';
                        allMenu.style.border = '1px solid transparent';
                    }

                    // 更新所有日期菜单的选中状态
                    sidebar.querySelectorAll('div[data-date-key]').forEach(item => {
                        item.style.background = 'transparent';
                        item.style.color = 'var(--text-primary)';
                        item.style.fontWeight = 'normal';
                        item.style.border = '1px solid transparent';
                        item.classList.remove('select-mode-menu-active');
                    });

                    if (this.selectMode) {
                        // 勾选模式：绿色样式
                        dayMenuItem.classList.add('select-mode-menu-active');
                        dayMenuItem.style.background = '#4CAF50';
                        dayMenuItem.style.color = 'white';
                        dayMenuItem.style.fontWeight = '600';
                        dayMenuItem.style.border = '1px solid #4CAF50';
                    } else {
                        // 普通模式：蓝色样式
                        dayMenuItem.style.background = 'rgba(33, 150, 243, 0.15)';
                        dayMenuItem.style.color = 'var(--accent-primary)';
                        dayMenuItem.style.fontWeight = '600';
                        dayMenuItem.style.border = '1px solid var(--accent-primary)';
                    }

                    selectedDateKey = dateKey;

                    if (hasTimePeriods) {
                        // 有小时子菜单，切换展开/收起
                        const isExpanded = dayMenuItem.dataset.expanded === 'true';
                        const icon = dayMenuItem.querySelector('.fa-chevron-right, .fa-chevron-down');

                        if (isExpanded) {
                            // 已展开，收起子菜单
                            hoursContainer.style.display = 'none';
                            dayMenuItem.dataset.expanded = 'false';
                            if (icon) {
                                icon.classList.remove('fa-chevron-down');
                                icon.classList.add('fa-chevron-right');
                            }
                        } else {
                            // 未展开，展开子菜单
                            hoursContainer.style.display = 'block';
                            dayMenuItem.dataset.expanded = 'true';
                            if (icon) {
                                icon.classList.remove('fa-chevron-right');
                                icon.classList.add('fa-chevron-down');
                            }
                        }

                        // 无论是否展开，右侧都显示当天所有书签
                        renderDayContent(date, bookmarks);
                    } else {
                        // 没有小时子菜单，直接显示内容
                        renderDayContent(date, bookmarks);
                    }
                });

                dayMenuItem.addEventListener('mouseenter', () => {
                    if (dayMenuItem.dataset.dateKey !== selectedDateKey || hasTimePeriods) {
                        dayMenuItem.style.background = 'rgba(128, 128, 128, 0.1)';
                        dayMenuItem.style.border = '1px solid var(--border-color)';
                    }
                });

                dayMenuItem.addEventListener('mouseleave', () => {
                    if (dayMenuItem.dataset.dateKey !== selectedDateKey) {
                        dayMenuItem.style.background = 'transparent';
                        dayMenuItem.style.border = '1px solid transparent';
                    } else if (!hasTimePeriods) {
                        dayMenuItem.style.background = 'rgba(33, 150, 243, 0.15)';
                        dayMenuItem.style.border = '1px solid var(--accent-primary)';
                    }
                });

                dayMenuContainer.appendChild(dayMenuItem);
                if (hoursContainer) {
                    dayMenuContainer.appendChild(hoursContainer);
                }
                daysContainer.appendChild(dayMenuContainer);
            });

            // 周标题点击：展开子菜单 + 显示该周所有内容
            weekHeader.addEventListener('click', () => {
                const isExpanded = weekHeader.dataset.expanded === 'true';
                const icon = weekHeader.querySelector('.fa-chevron-down, .fa-chevron-right');

                // 展开/收起子菜单
                if (isExpanded) {
                    daysContainer.style.display = 'none';
                    weekHeader.dataset.expanded = 'false';
                    icon.classList.remove('fa-chevron-down');
                    icon.classList.add('fa-chevron-right');
                } else {
                    daysContainer.style.display = 'block';
                    weekHeader.dataset.expanded = 'true';
                    icon.classList.remove('fa-chevron-right');
                    icon.classList.add('fa-chevron-down');
                }

                // 右侧显示该周的所有书签（按日分组）
                renderWeekContent(weekNum, weekData);
            });

            weekHeader.addEventListener('mouseenter', () => {
                weekHeader.style.background = 'rgba(128, 128, 128, 0.15)';
                const borderColor = this.selectMode ? '#4CAF50' : 'var(--accent-primary)';
                weekHeader.style.borderLeft = `3px solid ${borderColor}`;
            });

            weekHeader.addEventListener('mouseleave', () => {
                weekHeader.style.background = 'var(--bg-secondary)';
                weekHeader.style.borderLeft = '3px solid transparent';
            });

            weekMenuContainer.appendChild(weekHeader);
            weekMenuContainer.appendChild(daysContainer);
            sidebar.appendChild(weekMenuContainer);
        });

        // 渲染右侧内容 - 显示某一天的书签（<=10个）
        const renderDayContent = (date, bookmarks) => {
            contentArea.innerHTML = '';

            const isDayToday = this.isToday(date);
            const themeColor = this.selectMode ? '#4CAF50' : 'var(--accent-primary)';
            const todayColor = this.selectMode ? '#4CAF50' : '#2196F3';

            const dayHeader = document.createElement('div');
            dayHeader.style.fontSize = '18px';
            dayHeader.style.fontWeight = '700';
            dayHeader.style.color = 'var(--text-primary)';
            dayHeader.style.marginBottom = '20px';
            dayHeader.style.paddingBottom = '12px';
            dayHeader.style.borderBottom = `2px solid ${themeColor}`;
            dayHeader.style.display = 'flex';
            dayHeader.style.justifyContent = 'space-between';
            dayHeader.style.alignItems = 'center';

            // 创建标题和书签数量的容器
            const titleContainer = document.createElement('div');
            titleContainer.style.display = 'flex';
            titleContainer.style.alignItems = 'baseline';
            titleContainer.style.gap = '12px';
            titleContainer.innerHTML = `
                <span><i class="fas fa-calendar-day"></i> ${tw(date.getDay())} ${t('calendarMonthDay', date.getMonth() + 1, date.getDate())}${isDayToday ? ` <span style="color: ${todayColor};">(${currentLang === 'en' ? 'Today' : '今天'})</span>` : ''}</span>
                <span style="font-size:14px;color:var(--text-secondary);">${t('calendarBookmarksCount', bookmarks.length)}</span>
            `;

            // 创建导出按钮
            const headerText = `${tw(date.getDay())} ${t('calendarMonthDay', date.getMonth() + 1, date.getDate())}`;
            const exportBtn = this.createInlineExportButton({
                title: headerText,
                type: 'day',
                data: { date: new Date(date) }
            });
            
            // 创建排序按钮
            const sortBtn = this.createSortToggleButton();
            
            // 创建按钮容器
            const buttonsContainer = document.createElement('div');
            buttonsContainer.style.display = 'flex';
            buttonsContainer.style.gap = '8px';
            buttonsContainer.appendChild(exportBtn);
            buttonsContainer.appendChild(sortBtn);
            
            dayHeader.appendChild(titleContainer);
            dayHeader.appendChild(buttonsContainer);
            contentArea.appendChild(dayHeader);

            if (!bookmarks.length) {
                const empty = document.createElement('p');
                empty.style.marginTop = '12px';
                empty.style.color = 'var(--text-secondary)';
                empty.textContent = t('calendarNoBookmarksThisDay');
                contentArea.appendChild(empty);
                return;
            }

            // 直接显示书签列表
            const bookmarkList = this.createCollapsibleBookmarkList(bookmarks);
            contentArea.appendChild(bookmarkList);
        };

        // 渲染右侧内容 - 显示某个小时的书签（>10个时）
        const renderHourContent = (date, hour, hourBookmarks) => {
            contentArea.innerHTML = '';

            const isDayToday = this.isToday(date);
            const themeColor = this.selectMode ? '#4CAF50' : 'var(--accent-primary)';
            const todayColor = this.selectMode ? '#4CAF50' : '#2196F3';

            const hourHeader = document.createElement('div');
            hourHeader.style.fontSize = '18px';
            hourHeader.style.fontWeight = '700';
            hourHeader.style.color = 'var(--text-primary)';
            hourHeader.style.marginBottom = '20px';
            hourHeader.style.paddingBottom = '12px';
            hourHeader.style.borderBottom = `2px solid ${themeColor}`;
            hourHeader.style.display = 'flex';
            hourHeader.style.justifyContent = 'space-between';
            hourHeader.style.alignItems = 'center';

            // 创建标题和书签数量的容器
            const titleContainer = document.createElement('div');
            titleContainer.style.display = 'flex';
            titleContainer.style.alignItems = 'baseline';
            titleContainer.style.gap = '12px';
            titleContainer.innerHTML = `
                <span>
                    <i class="fas fa-calendar-day"></i> ${tw(date.getDay())} ${t('calendarMonthDay', date.getMonth() + 1, date.getDate())}${isDayToday ? ` <span style="color: ${todayColor};">(${currentLang === 'en' ? 'Today' : '今天'})</span>` : ''}
                    <span style="margin-left:12px;">${String(hour).padStart(2, '0')}:00-${String(hour).padStart(2, '0')}:59</span>
                </span>
                <span style="font-size:14px;color:var(--text-secondary);">${t('calendarBookmarksCount', hourBookmarks.length)}</span>
            `;

            // 创建导出按钮 - 包含完整日期
            const fullDatePart = currentLang === 'zh_CN'
                ? `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
                : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            const headerText = `${fullDatePart} ${String(hour).padStart(2, '0')}:00-${String(hour).padStart(2, '0')}:59`;
            const exportBtn = this.createInlineExportButton({
                title: headerText,
                type: 'hour',
                data: { date: new Date(date), hour }
            });
            
            // 创建排序按钮
            const sortBtn = this.createSortToggleButton();
            
            // 创建按钮容器
            const buttonsContainer = document.createElement('div');
            buttonsContainer.style.display = 'flex';
            buttonsContainer.style.gap = '8px';
            buttonsContainer.appendChild(exportBtn);
            buttonsContainer.appendChild(sortBtn);
            
            hourHeader.appendChild(titleContainer);
            hourHeader.appendChild(buttonsContainer);
            contentArea.appendChild(hourHeader);

            // 显示该小时的书签列表（带折叠）
            const bookmarkList = this.createCollapsibleBookmarkList(hourBookmarks);
            contentArea.appendChild(bookmarkList);
        };

        // 渲染右侧内容 - 显示某周的所有书签（按日分组）
        const renderWeekContent = (weekNum, weekData) => {
            contentArea.innerHTML = '';

            const themeColor = this.selectMode ? '#4CAF50' : 'var(--accent-primary)';

            const weekHeader = document.createElement('div');
            weekHeader.style.fontSize = '18px';
            weekHeader.style.fontWeight = '700';
            weekHeader.style.color = 'var(--text-primary)';
            weekHeader.style.marginBottom = '20px';
            weekHeader.style.paddingBottom = '12px';
            weekHeader.style.borderBottom = `2px solid ${themeColor}`;
            weekHeader.style.display = 'flex';
            weekHeader.style.justifyContent = 'space-between';
            weekHeader.style.alignItems = 'center';

            const totalCount = weekData.reduce((sum, item) => sum + item.bookmarks.length, 0);

            // 创建标题和书签数量的容器
            const titleContainer = document.createElement('div');
            titleContainer.style.display = 'flex';
            titleContainer.style.alignItems = 'baseline';
            titleContainer.style.gap = '12px';
            titleContainer.innerHTML = `
                <span><i class="fas fa-calendar-week"></i> ${t('calendarWeek', weekNum)}</span>
                <span style="font-size:14px;color:var(--text-secondary);">${t('calendarBookmarksCount', totalCount)}</span>
            `;

            // 创建导出按钮
            const headerText = t('calendarWeek', weekNum);
            const weekStart = new Date(weekData[0].date);
            weekStart.setHours(0, 0, 0, 0);
            const exportBtn = this.createInlineExportButton({
                title: headerText,
                type: 'week',
                data: { weekNum, weekStart }
            });
            
            // 创建排序按钮
            const sortBtn = this.createSortToggleButton();
            
            // 创建按钮容器
            const buttonsContainer = document.createElement('div');
            buttonsContainer.style.display = 'flex';
            buttonsContainer.style.gap = '8px';
            buttonsContainer.appendChild(exportBtn);
            buttonsContainer.appendChild(sortBtn);
            
            weekHeader.appendChild(titleContainer);
            weekHeader.appendChild(buttonsContainer);
            contentArea.appendChild(weekHeader);

            // 按日显示
            weekData.forEach(({ date, bookmarks }) => {
                const daySection = document.createElement('div');
                daySection.style.marginBottom = '24px';

                const isDayToday = this.isToday(date);
                const themeColor = this.selectMode ? '#4CAF50' : 'var(--accent-primary)';
                const todayColor = this.selectMode ? '#4CAF50' : '#2196F3';

                const dayTitle = document.createElement('div');
                dayTitle.style.fontSize = '15px';
                dayTitle.style.fontWeight = '600';
                dayTitle.style.color = themeColor;
                dayTitle.style.marginBottom = '12px';
                dayTitle.style.paddingBottom = '8px';
                dayTitle.style.borderBottom = `1px solid ${themeColor}`;
                dayTitle.innerHTML = `<i class="fas fa-calendar-day"></i> ${tw(date.getDay())} ${t('calendarMonthDay', date.getMonth() + 1, date.getDate())} (${t('calendarBookmarkCount', bookmarks.length)})${isDayToday ? ` <span style="color: ${todayColor};">(${currentLang === 'en' ? 'Today' : '今天'})</span>` : ''}`;

                daySection.appendChild(dayTitle);

                const bookmarkList = this.createCollapsibleBookmarkList(bookmarks);
                daySection.appendChild(bookmarkList);

                contentArea.appendChild(daySection);
            });
        };

        // 渲染右侧内容 - 显示所有日期的书签（勾选模式和普通模式通用）
        const renderAllContent = () => {
            contentArea.innerHTML = '';

            const themeColor = this.selectMode ? '#4CAF50' : 'var(--accent-primary)';

            const allHeader = document.createElement('div');
            allHeader.style.fontSize = '18px';
            allHeader.style.fontWeight = '700';
            allHeader.style.color = 'var(--text-primary)';
            allHeader.style.marginBottom = '20px';
            allHeader.style.paddingBottom = '12px';
            allHeader.style.borderBottom = `2px solid ${themeColor}`;
            allHeader.style.display = 'flex';
            allHeader.style.justifyContent = 'space-between';
            allHeader.style.alignItems = 'center';

            const headerIcon = this.selectMode ? 'fa-check-circle' : 'fa-th-large';
            const headerText = this.selectMode ?
                (currentLang === 'en' ? 'All Selected Bookmarks' : '所有选中的书签') :
                (currentLang === 'en' ? 'All Bookmarks This Month' : '本月所有书签');

            // 创建标题和书签数量的容器
            const titleContainer = document.createElement('div');
            titleContainer.style.display = 'flex';
            titleContainer.style.alignItems = 'baseline';
            titleContainer.style.gap = '12px';
            titleContainer.innerHTML = `
                <span><i class="fas ${headerIcon}"></i> ${headerText}</span>
                <span style="font-size:14px;color:var(--text-secondary);">${t('calendarBookmarksCount', totalCount)}</span>
            `;

            // 创建导出按钮
            const exportBtn = this.createInlineExportButton({
                title: headerText,
                type: 'all',
                data: { viewLevel: 'month', year: this.currentYear, month: this.currentMonth }
            });
            
            // 创建排序按钮
            const sortBtn = this.createSortToggleButton();
            
            // 创建按钮容器
            const buttonsContainer = document.createElement('div');
            buttonsContainer.style.display = 'flex';
            buttonsContainer.style.gap = '8px';
            buttonsContainer.appendChild(exportBtn);
            buttonsContainer.appendChild(sortBtn);
            
            allHeader.appendChild(titleContainer);
            allHeader.appendChild(buttonsContainer);
            contentArea.appendChild(allHeader);

            // 按周分组显示
            sortedWeeks.forEach(weekNum => {
                const weekData = bookmarksByWeek.get(weekNum);

                const weekSection = document.createElement('div');
                weekSection.style.marginBottom = '32px';

                const weekTitle = document.createElement('div');
                weekTitle.style.fontSize = '16px';
                weekTitle.style.fontWeight = '600';
                weekTitle.style.color = themeColor;
                weekTitle.style.marginBottom = '16px';
                weekTitle.style.paddingBottom = '8px';
                weekTitle.style.borderBottom = `1px solid ${themeColor}`;
                weekTitle.textContent = t('calendarWeek', weekNum);
                weekSection.appendChild(weekTitle);

                // 按日显示
                weekData.forEach(({ date, bookmarks }) => {
                    const daySection = document.createElement('div');
                    daySection.style.marginBottom = '24px';

                    const isDayToday = this.isToday(date);
                    const todayColor = '#4CAF50';

                    const dayTitle = document.createElement('div');
                    dayTitle.style.fontSize = '15px';
                    dayTitle.style.fontWeight = '600';
                    dayTitle.style.color = 'var(--accent-primary)';
                    dayTitle.style.marginBottom = '12px';
                    dayTitle.style.paddingLeft = '8px';
                    dayTitle.style.borderLeft = `3px solid ${themeColor}`;
                    dayTitle.innerHTML = `${twFull(date.getDay())}, ${t('calendarMonthDay', date.getMonth() + 1, date.getDate())}${isDayToday ? ` <span style="color: ${todayColor};">(${currentLang === 'en' ? 'Today' : '今天'})</span>` : ''} - ${t('calendarBookmarkCount', bookmarks.length)}`;
                    daySection.appendChild(dayTitle);

                    const bookmarkList = this.createCollapsibleBookmarkList(bookmarks);
                    daySection.appendChild(bookmarkList);

                    weekSection.appendChild(daySection);
                });

                contentArea.appendChild(weekSection);
            });
        };

        // 初始显示逻辑
        if (this.selectMode) {
            // 勾选模式：始终展示「全部选中」
            renderAllContent();
        } else if (shouldShowAllByDefault) {
            // 非当前月：优先展示「本月全部」
            renderAllContent();
        } else {
            // 当前月：优先展示“今天”对应的日视图（如果存在），否则退回全部
            const initialDayItem = sidebar.querySelector(`div[data-date-key="${selectedDateKey}"]`);
            if (initialDayItem) {
                // 直接触发一次点击，复用现有高亮和内容逻辑
                initialDayItem.click();
            } else {
                // 理论上当前月今天一定存在（开头已处理），但作为兜底
                renderAllContent();
            }
        }

        panelContainer.appendChild(sidebar);
        panelContainer.appendChild(contentArea);
        section.appendChild(panelContainer);

        return section;
    }

    createBookmarkItem(bookmark, showTreeLines = false, isLast = false) {
        const wrapper = document.createElement('div');
        wrapper.style.position = 'relative';
        wrapper.style.paddingLeft = showTreeLines ? '20px' : '0';

        // 添加树状连接线
        if (showTreeLines) {
            // 横向连接线
            const horizontalLine = document.createElement('div');
            horizontalLine.style.position = 'absolute';
            horizontalLine.style.left = '0';
            horizontalLine.style.top = '18px';
            horizontalLine.style.width = '12px';
            horizontalLine.style.height = '1px';
            horizontalLine.style.background = 'var(--border-color)';
            horizontalLine.style.opacity = '0.5';
            wrapper.appendChild(horizontalLine);
        }

        const item = document.createElement('div');
        item.style.display = 'flex';
        item.style.alignItems = 'flex-start';
        item.style.gap = '8px';
        item.style.padding = '8px 10px';
        item.style.border = '1px solid var(--border-color)';
        item.style.borderRadius = '6px';
        item.style.marginBottom = '6px';
        item.style.cursor = 'pointer';
        item.style.transition = 'all 0.2s';
        item.dataset.bookmarkUrl = bookmark.url;

        const time = bookmark.dateAdded.toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit'
        });

        // 创建favicon图标
        const faviconImg = document.createElement('img');
        faviconImg.className = 'bookmark-favicon';
        faviconImg.style.width = '16px';
        faviconImg.style.height = '16px';
        faviconImg.style.flexShrink = '0';
        faviconImg.style.marginTop = '2px'; // 微调对齐
        faviconImg.alt = '';

        // 使用全局的 getFaviconUrl 函数（如果存在）
        if (typeof getFaviconUrl === 'function') {
            faviconImg.src = getFaviconUrl(bookmark.url);
        } else {
            // 降级方案
            faviconImg.src = `chrome://favicon/${bookmark.url}`;
        }

        item.appendChild(faviconImg);

        // 信息区域（只显示标题，移除URL）
        const infoDiv = document.createElement('div');
        infoDiv.style.flex = '1';
        infoDiv.style.minWidth = '0';
        infoDiv.innerHTML = `
            <div style="font-size:13px;font-weight:500;word-break:break-word;line-height:1.4;" title="${this.escapeHtml(bookmark.title)}">
                ${this.escapeHtml(bookmark.title)}
            </div>
        `;
        item.appendChild(infoDiv);

        // 时间区域
        const timeDiv = document.createElement('div');
        timeDiv.style.fontSize = '11px';
        timeDiv.style.color = 'var(--text-tertiary)';
        timeDiv.style.whiteSpace = 'nowrap';
        timeDiv.style.flexShrink = '0';
        timeDiv.style.marginTop = '2px'; // 微调对齐
        timeDiv.textContent = time;
        item.appendChild(timeDiv);

        // 异步加载高质量favicon（如果FaviconCache可用）
        if (typeof FaviconCache !== 'undefined' && FaviconCache.fetch) {
            FaviconCache.fetch(bookmark.url).then(faviconUrl => {
                if (faviconUrl) {
                    faviconImg.src = faviconUrl;
                }
            }).catch(() => {
                // 静默处理错误
            });
        }

        item.addEventListener('click', () => {
            chrome.tabs.create({ url: bookmark.url });
        });

        item.addEventListener('mouseenter', () => {
            const borderColor = this.selectMode ? '#4CAF50' : 'var(--accent-primary)';
            item.style.background = 'var(--bg-secondary)';
            item.style.borderColor = borderColor;
        });

        item.addEventListener('mouseleave', () => {
            item.style.background = 'transparent';
            item.style.borderColor = 'var(--border-color)';
        });

        wrapper.appendChild(item);
        return wrapper;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // 构建书签树结构
    buildBookmarkTree(bookmarks) {
        const root = {
            title: 'Root',
            children: [],
            bookmarks: [],
            path: []
        };

        bookmarks.forEach(bookmark => {
            let currentNode = root;

            // 遍历文件夹路径，构建树
            bookmark.folderPath.forEach((folderName, index) => {
                let childNode = currentNode.children.find(child => child.title === folderName);

                if (!childNode) {
                    childNode = {
                        title: folderName,
                        children: [],
                        bookmarks: [],
                        path: bookmark.folderPath.slice(0, index + 1)
                    };
                    currentNode.children.push(childNode);
                }

                currentNode = childNode;
            });

            // 将书签添加到对应的叶子节点
            currentNode.bookmarks.push(bookmark);
        });

        return root;
    }

    // 渲染树节点（递归）
    renderTreeNode(node, level = 0, expandToLevel = 0, isLastChild = false) {
        const nodeContainer = document.createElement('div');
        const themeColor = this.selectMode ? '#4CAF50' : 'var(--accent-primary)';

        // 判断当前层级是否应该展开：
        // expandToLevel 指定展开到哪一层
        // level 0 是根节点（虚拟的），level 1 是书签栏/其他书签，level 2 是用户文件夹
        const shouldExpandThisLevel = level > 0 && level <= expandToLevel;

        // 如果是根节点，直接渲染子节点
        if (level === 0) {
            node.children.forEach((child, index) => {
                const isLast = index === node.children.length - 1 && node.bookmarks.length === 0;
                nodeContainer.appendChild(this.renderTreeNode(child, level + 1, expandToLevel, isLast));
            });
            // 根节点的书签（未分类）
            if (node.bookmarks.length > 0) {
                const uncategorizedFolder = document.createElement('div');
                uncategorizedFolder.style.marginBottom = shouldExpandThisLevel ? '12px' : '0';

                const folderHeader = this.createFolderHeader(
                    currentLang === 'en' ? 'Uncategorized' : '未分类',
                    [],
                    node.bookmarks.length,
                    level
                );
                uncategorizedFolder.appendChild(folderHeader);

                const bookmarksContainer = document.createElement('div');
                bookmarksContainer.style.paddingLeft = `${(level + 1) * 16}px`;
                bookmarksContainer.style.display = shouldExpandThisLevel ? 'block' : 'none';
                bookmarksContainer.appendChild(this.renderBookmarkList(node.bookmarks));
                uncategorizedFolder.appendChild(bookmarksContainer);

                this.attachFolderToggle(folderHeader, bookmarksContainer, uncategorizedFolder, !shouldExpandThisLevel);
                nodeContainer.appendChild(uncategorizedFolder);
            }
            return nodeContainer;
        }

        // 文件夹容器（添加树状线）
        const folderContainer = document.createElement('div');
        folderContainer.style.position = 'relative';
        folderContainer.style.marginBottom = shouldExpandThisLevel ? '12px' : '0';
        folderContainer.dataset.treeLevel = level;

        // 添加树状连接线
        if (level > 0) {
            folderContainer.style.paddingLeft = '20px';

            // 纵向连接线（从上一级延伸下来）
            if (!isLastChild) {
                const verticalLine = document.createElement('div');
                verticalLine.style.position = 'absolute';
                verticalLine.style.left = '0';
                verticalLine.style.top = '0';
                verticalLine.style.width = '1px';
                verticalLine.style.height = '100%';
                verticalLine.style.background = 'var(--border-color)';
                verticalLine.style.opacity = '0.5';
                folderContainer.appendChild(verticalLine);
            } else {
                // 最后一个子节点的纵线只到中间
                const verticalLine = document.createElement('div');
                verticalLine.style.position = 'absolute';
                verticalLine.style.left = '0';
                verticalLine.style.top = '0';
                verticalLine.style.width = '1px';
                verticalLine.style.height = '18px';
                verticalLine.style.background = 'var(--border-color)';
                verticalLine.style.opacity = '0.5';
                folderContainer.appendChild(verticalLine);
            }

            // 横向连接线（连接到文件夹标题）
            const horizontalLine = document.createElement('div');
            horizontalLine.style.position = 'absolute';
            horizontalLine.style.left = '0';
            horizontalLine.style.top = '18px';
            horizontalLine.style.width = '12px';
            horizontalLine.style.height = '1px';
            horizontalLine.style.background = 'var(--border-color)';
            horizontalLine.style.opacity = '0.5';
            folderContainer.appendChild(horizontalLine);
        }

        // 文件夹标题
        const folderHeader = this.createFolderHeader(node.title, node.path,
            node.bookmarks.length + this.countAllBookmarks(node), level);
        if (level > 0) {
            folderHeader.style.marginLeft = '0';
        }
        folderContainer.appendChild(folderHeader);

        // 子内容容器
        const childrenContainer = document.createElement('div');
        childrenContainer.style.display = shouldExpandThisLevel ? 'block' : 'none';
        childrenContainer.style.paddingLeft = '20px'; // 缩进与树状线对齐
        childrenContainer.style.position = 'relative';

        // 为子内容添加纵向连接线
        if (level > 0 && (node.bookmarks.length > 0 || node.children.length > 0)) {
            const childrenVerticalLine = document.createElement('div');
            childrenVerticalLine.style.position = 'absolute';
            childrenVerticalLine.style.left = '0';
            childrenVerticalLine.style.top = '0';
            childrenVerticalLine.style.width = '1px';
            childrenVerticalLine.style.height = '100%';
            childrenVerticalLine.style.background = 'var(--border-color)';
            childrenVerticalLine.style.opacity = '0.5';
            childrenContainer.appendChild(childrenVerticalLine);
        }

        // 先渲染当前文件夹的书签
        if (node.bookmarks.length > 0) {
            const bookmarksWrapper = document.createElement('div');
            bookmarksWrapper.style.position = 'relative';
            bookmarksWrapper.appendChild(this.renderBookmarkList(node.bookmarks, level > 0));
            childrenContainer.appendChild(bookmarksWrapper);
        }

        // 再渲染子文件夹
        node.children.forEach((child, index) => {
            const isLast = index === node.children.length - 1;
            childrenContainer.appendChild(this.renderTreeNode(child, level + 1, expandToLevel, isLast));
        });

        folderContainer.appendChild(childrenContainer);

        // 添加折叠功能
        this.attachFolderToggle(folderHeader, childrenContainer, folderContainer, !shouldExpandThisLevel);

        return folderContainer;
    }

    // 创建文件夹标题
    createFolderHeader(title, path, count, level) {
        const folderHeader = document.createElement('div');
        folderHeader.style.display = 'flex';
        folderHeader.style.alignItems = 'center';
        folderHeader.style.gap = '8px';
        folderHeader.style.padding = '6px 8px';
        folderHeader.style.background = 'var(--bg-secondary)';
        folderHeader.style.borderRadius = '6px';
        folderHeader.style.cursor = 'pointer';
        folderHeader.style.marginBottom = '6px';
        folderHeader.style.transition = 'all 0.2s';
        // 不在这里设置 collapsed 状态，由 attachFolderToggle 控制

        const themeColor = this.selectMode ? '#4CAF50' : 'var(--accent-primary)';

        // 创建路径显示（每个文件夹用椭圆框框住）
        // level > 1 时只显示当前文件夹名称，level = 1 时显示完整路径
        let pathHTML = '';
        if (level > 1) {
            // 子层级：只显示当前文件夹名称
            pathHTML = `<span style="display:inline-block;background:rgba(128,128,128,0.1);border-radius:12px;padding:2px 8px;margin:2px;font-size:11px;white-space:nowrap;">${this.escapeHtml(title)}</span>`;
        } else if (path.length > 0) {
            // 顶层：显示完整路径
            pathHTML = path.map(folder =>
                `<span style="display:inline-block;background:rgba(128,128,128,0.1);border-radius:12px;padding:2px 8px;margin:2px;font-size:11px;white-space:nowrap;">${this.escapeHtml(folder)}</span>`
            ).join('<span style="margin:0 2px;color:var(--text-tertiary);font-size:11px;">/</span>');
        } else {
            pathHTML = `<span style="display:inline-block;background:rgba(128,128,128,0.1);border-radius:12px;padding:2px 8px;margin:2px;font-size:11px;">${this.escapeHtml(title)}</span>`;
        }

        folderHeader.innerHTML = `
            <i class="fas fa-chevron-down" style="font-size:10px;color:${themeColor};flex-shrink:0;"></i>
            <i class="fas fa-folder" style="color:${themeColor};font-size:12px;flex-shrink:0;"></i>
            <div style="flex:1;min-width:0;display:flex;flex-wrap:wrap;align-items:center;">${pathHTML}</div>
            <span style="font-size:11px;color:var(--text-tertiary);flex-shrink:0;">${count}</span>
        `;

        return folderHeader;
    }

    // 附加文件夹折叠功能
    attachFolderToggle(folderHeader, childrenContainer, folderContainer, defaultCollapsed = false) {
        // 设置初始状态
        if (defaultCollapsed) {
            folderHeader.dataset.collapsed = 'true';
            const chevron = folderHeader.querySelector('.fa-chevron-down');
            if (chevron) {
                chevron.classList.remove('fa-chevron-down');
                chevron.classList.add('fa-chevron-right');
            }
        } else {
            // 展开状态
            folderHeader.dataset.collapsed = 'false';
            // chevron 已经是 fa-chevron-down，不需要修改
        }

        folderHeader.addEventListener('click', () => {
            const isCollapsed = folderHeader.dataset.collapsed === 'true';
            const chevron = folderHeader.querySelector('.fa-chevron-down, .fa-chevron-right');

            if (isCollapsed) {
                childrenContainer.style.display = 'block';
                folderHeader.dataset.collapsed = 'false';
                folderContainer.style.marginBottom = '12px';
                chevron.classList.remove('fa-chevron-right');
                chevron.classList.add('fa-chevron-down');
            } else {
                childrenContainer.style.display = 'none';
                folderHeader.dataset.collapsed = 'true';
                folderContainer.style.marginBottom = '0';
                chevron.classList.remove('fa-chevron-down');
                chevron.classList.add('fa-chevron-right');
            }
        });

        folderHeader.addEventListener('mouseenter', () => {
            folderHeader.style.background = 'var(--bg-tertiary)';
        });

        folderHeader.addEventListener('mouseleave', () => {
            folderHeader.style.background = 'var(--bg-secondary)';
        });
    }

    // 渲染书签列表（带折叠）
    renderBookmarkList(bookmarks, showTreeLines = false) {
        const container = document.createElement('div');
        container.style.marginBottom = '8px';

        const BOOKMARK_COLLAPSE_THRESHOLD = 10;
        const shouldCollapseBookmarks = bookmarks.length > BOOKMARK_COLLAPSE_THRESHOLD;

        // 显示前5个书签
        const visibleCount = shouldCollapseBookmarks ? BOOKMARK_COLLAPSE_THRESHOLD : bookmarks.length;
        for (let i = 0; i < visibleCount; i++) {
            const isLastVisible = !shouldCollapseBookmarks && i === bookmarks.length - 1;
            container.appendChild(this.createBookmarkItem(bookmarks[i], showTreeLines, isLastVisible));
        }

        // 如果超过5个，创建隐藏容器和展开按钮
        if (shouldCollapseBookmarks) {
            const hiddenBookmarksContainer = document.createElement('div');
            hiddenBookmarksContainer.style.display = 'none';
            hiddenBookmarksContainer.dataset.collapsed = 'true';

            for (let i = BOOKMARK_COLLAPSE_THRESHOLD; i < bookmarks.length; i++) {
                const isLast = i === bookmarks.length - 1;
                hiddenBookmarksContainer.appendChild(this.createBookmarkItem(bookmarks[i], showTreeLines, isLast));
            }

            container.appendChild(hiddenBookmarksContainer);

            // 展开/收起按钮（改进UI）
            const toggleBtn = document.createElement('button');
            toggleBtn.style.width = '100%';
            toggleBtn.style.padding = '8px 12px';
            toggleBtn.style.marginTop = '8px';
            toggleBtn.style.border = '1px solid var(--border-color)';
            const btnColor = this.selectMode ? '#4CAF50' : 'var(--accent-primary)';
            toggleBtn.style.borderRadius = '6px';
            toggleBtn.style.background = 'var(--bg-secondary)';
            toggleBtn.style.color = 'var(--text-primary)';
            toggleBtn.style.cursor = 'pointer';
            toggleBtn.style.fontSize = '12px';
            toggleBtn.style.fontWeight = '500';
            toggleBtn.style.transition = 'all 0.2s';
            toggleBtn.style.display = 'flex';
            toggleBtn.style.alignItems = 'center';
            toggleBtn.style.justifyContent = 'center';
            toggleBtn.style.gap = '6px';

            const hiddenCount = bookmarks.length - BOOKMARK_COLLAPSE_THRESHOLD;
            const expandText = currentLang === 'en' ? `Show ${hiddenCount} more` : `展开更多 ${hiddenCount} 个`;
            const collapseText = currentLang === 'en' ? 'Show less' : '收起';

            toggleBtn.innerHTML = `
                <i class="fas fa-chevron-down" style="color:${btnColor};"></i>
                <span>${expandText}</span>
            `;

            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isCollapsed = hiddenBookmarksContainer.dataset.collapsed === 'true';
                if (isCollapsed) {
                    hiddenBookmarksContainer.style.display = 'block';
                    hiddenBookmarksContainer.dataset.collapsed = 'false';
                    toggleBtn.innerHTML = `
                        <i class="fas fa-chevron-up" style="color:${btnColor};"></i>
                        <span>${collapseText}</span>
                    `;
                } else {
                    hiddenBookmarksContainer.style.display = 'none';
                    hiddenBookmarksContainer.dataset.collapsed = 'true';
                    toggleBtn.innerHTML = `
                        <i class="fas fa-chevron-down" style="color:${btnColor};"></i>
                        <span>${expandText}</span>
                    `;
                }
            });

            toggleBtn.addEventListener('mouseenter', () => {
                const hoverColor = this.selectMode ? '#4CAF50' : 'var(--accent-primary)';
                toggleBtn.style.background = 'var(--bg-tertiary)';
                toggleBtn.style.borderColor = hoverColor;
                toggleBtn.style.color = hoverColor;
            });

            toggleBtn.addEventListener('mouseleave', () => {
                toggleBtn.style.background = 'var(--bg-secondary)';
                toggleBtn.style.borderColor = 'var(--border-color)';
                toggleBtn.style.color = 'var(--text-primary)';
            });

            container.appendChild(toggleBtn);
        }

        return container;
    }

    // 计算节点下所有书签数量
    countAllBookmarks(node) {
        let count = 0;
        node.children.forEach(child => {
            count += child.bookmarks.length + this.countAllBookmarks(child);
        });
        return count;
    }

    // 创建可折叠的书签列表（树状结构，参考永久栏目）
    createCollapsibleBookmarkList(bookmarks, containerId) {
        const container = document.createElement('div');

        if (bookmarks.length === 0) return container;

        // 根据排序状态对书签进行排序
        const sortedBookmarks = [...bookmarks].sort((a, b) => {
            // 按添加时间排序
            const timeCompare = a.dateAdded - b.dateAdded;
            return this.bookmarkSortAsc ? timeCompare : -timeCompare;
        });

        // 根据书签总数决定展开到哪个层级
        // ≤10个: 展开到书签层级（全部展开，包括书签）
        // 11-25个: 展开到第三层级（文件夹的子文件夹）
        // >25个: 展开到第二层级（只展开顶层文件夹）
        let expandToLevel;
        if (sortedBookmarks.length <= 10) {
            expandToLevel = 999; // 全部展开（包括书签）
        } else if (sortedBookmarks.length <= 25) {
            expandToLevel = 3; // 展开到第三层级
        } else {
            expandToLevel = 2; // 展开到第二层级
        }

        // 构建树结构
        const tree = this.buildBookmarkTree(sortedBookmarks);

        // 渲染树（传入展开层级参数）
        const treeContainer = this.renderTreeNode(tree, 0, expandToLevel);
        container.appendChild(treeContainer);

        return container;
    }

    // ========== 周视图 ==========

    renderWeekView(container) {
        const wrapper = document.createElement('div');
        wrapper.style.padding = '20px';

        // 获取一周开始日(中文:周一=1, 英文:周日=0)
        const weekStartDay = (typeof currentLang !== 'undefined' && currentLang === 'zh_CN') ? 1 : 0;

        // currentWeekStart始终是ISO周一,但显示顺序根据语言调整
        const weekEnd = new Date(this.currentWeekStart);
        weekEnd.setDate(this.currentWeekStart.getDate() + 6);

        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.marginBottom = '20px';
        header.innerHTML = `
            <button class="calendar-nav-btn" id="prevWeek"><i class="fas fa-chevron-left"></i></button>
            <div style="font-size:18px;font-weight:600;">${t('calendarMonthDay', this.currentWeekStart.getMonth() + 1, this.currentWeekStart.getDate())} - ${t('calendarMonthDay', weekEnd.getMonth() + 1, weekEnd.getDate())}</div>
            <button class="calendar-nav-btn" id="nextWeek"><i class="fas fa-chevron-right"></i></button>
        `;
        wrapper.appendChild(header);

        header.querySelector('#prevWeek').addEventListener('click', () => {
            this.currentWeekStart.setDate(this.currentWeekStart.getDate() - 7);
            this.render();
        });

        header.querySelector('#nextWeek').addEventListener('click', () => {
            this.currentWeekStart.setDate(this.currentWeekStart.getDate() + 7);
            this.render();
        });

        const weekContainer = document.createElement('div');
        weekContainer.className = 'week-view-container';
        const allBookmarks = [];

        // 根据语言调整显示顺序
        // 中文: 周一(i=0)到周日(i=6)
        // 英文: 周日(i=-1)到周六(i=5)
        const displayOffset = weekStartDay === 0 ? -1 : 0;

        for (let i = 0; i < 7; i++) {
            const date = new Date(this.currentWeekStart);
            date.setDate(this.currentWeekStart.getDate() + displayOffset + i);
            const dateKey = this.getDateKey(date);
            const bookmarks = this.bookmarksByDate.get(dateKey) || [];
            const isTodayCard = this.isToday(date);
            const dayOfWeek = date.getDay(); // 0-6 (周日到周六)

            if (bookmarks.length > 0) allBookmarks.push({ date, bookmarks });

            const dayCard = document.createElement('div');
            dayCard.className = 'week-day-card';
            dayCard.style.position = 'relative';
            dayCard.dataset.dateKey = dateKey;

            // 如果是今天，添加蓝色边框
            if (isTodayCard) {
                dayCard.style.border = '2px solid #2196F3';
            }

            // 勾选模式下的样式
            if (this.selectedDates.has(dateKey)) {
                dayCard.classList.add('selected');
            }

            const countColor = this.selectMode ? '#4CAF50' : 'var(--accent-primary)';

            dayCard.innerHTML = `
                <div class="week-day-header">
                    <div class="week-day-name">${tw(dayOfWeek)}</div>
                    <div class="week-day-date">${date.getDate()}</div>
                </div>
                <div class="week-day-count" style="color: ${countColor};">${t('calendarBookmarkCount', bookmarks.length)}</div>
                ${isTodayCard ? `<div style="position: absolute; bottom: 4px; right: 4px; font-size: 11px; color: #2196F3; font-weight: 600;">${currentLang === 'en' ? 'Today' : '今天'}</div>` : ''}
            `;

            // 勾选模式下的事件处理
            if (this.selectMode) {
                // 只有有书签数据的格子才能被勾选
                if (bookmarks.length > 0) {
                    // 鼠标进入：拖拽中时勾选（防抖render）
                    dayCard.addEventListener('mouseenter', () => {
                        if (this.isDragging && this.dragStartPos) {
                            // 计算距离
                            const pageEvent = this.lastMouseEvent || { clientX: this.dragStartPos.x, clientY: this.dragStartPos.y };
                            const distance = Math.sqrt(
                                Math.pow(pageEvent.clientX - this.dragStartPos.x, 2) +
                                Math.pow(pageEvent.clientY - this.dragStartPos.y, 2)
                            );

                            // 只有在真实拖拽时（距离>阈值）才添加选中
                            if (distance > this.dragMinDistance) {
                                this.selectedDates.add(dateKey);
                                dayCard.classList.add('selected');
                                // 防抖render
                                this.debouncedRender();
                            }
                        }
                    });

                    // mouseup时如果是单击，则切换选中状态
                    dayCard.addEventListener('mouseup', (e) => {
                        if (this.isDragging && this.dragStartPos) {
                            const distance = Math.sqrt(
                                Math.pow(e.clientX - this.dragStartPos.x, 2) +
                                Math.pow(e.clientY - this.dragStartPos.y, 2)
                            );

                            // 单击：距离<阈值，切换选中状态
                            if (distance <= this.dragMinDistance) {
                                if (this.selectedDates.has(dateKey)) {
                                    this.selectedDates.delete(dateKey);
                                } else {
                                    this.selectedDates.add(dateKey);
                                }
                            }
                        }
                    });
                } else {
                    // 空白格子：显示为不可用状态
                    dayCard.style.opacity = '0.5';
                }
            } else {
                // 普通模式：点击进入日视图
                dayCard.addEventListener('click', () => {
                    if (bookmarks.length > 0) {
                        this.currentDay = date;
                        // currentWeekStart已经设置正确，无需更新
                        this.viewLevel = 'day';
                        this.render();
                    }
                });
            }

            weekContainer.appendChild(dayCard);
        }

        wrapper.appendChild(weekContainer);

        // 勾选模式：在整个周视图容器上监听mousedown，允许单击和拖拽
        if (this.selectMode) {
            weekContainer.addEventListener('mousedown', (e) => {
                // 检查是否点击在有效格子上
                const dayCard = e.target.closest('.week-day-card');
                if (!dayCard || !dayCard.dataset.dateKey) {
                    // 不是点击在周卡片上，不处理
                    return;
                }

                const dateKey = dayCard.dataset.dateKey;
                const bookmarks = this.bookmarksByDate.get(dateKey) || [];

                // 只处理有数据的格子
                if (bookmarks.length > 0) {
                    e.preventDefault();  // 只在点击格子时才preventDefault
                    this.isDragging = true;
                    this.dragStartPos = { x: e.clientX, y: e.clientY };
                    this.dragStartDate = dateKey;
                }
            });
        }

        // 勾选模式下过滤书签
        let filteredBookmarks = allBookmarks;
        if (this.selectMode) {
            filteredBookmarks = allBookmarks.filter(({ date }) => this.selectedDates.has(this.getDateKey(date)));
        }

        if (filteredBookmarks.length > 0) {
            const section = document.createElement('div');
            section.style.marginTop = '40px';
            const totalCount = filteredBookmarks.reduce((sum, item) => sum + item.bookmarks.length, 0);

            const title = document.createElement('h3');
            title.style.marginBottom = '20px';
            // 勾选模式下使用绿色标题
            if (this.selectMode) {
                title.className = 'select-mode-title';
                title.textContent = (currentLang === 'en' ? 'Selected: ' : '已选中：') + totalCount + (currentLang === 'en' ? ' bookmarks' : ' 个书签');
            } else {
                title.textContent = t('calendarTotalThisWeek', totalCount);
            }
            section.appendChild(title);

            // 左右分栏布局
            const panelContainer = document.createElement('div');
            panelContainer.style.display = 'flex';
            panelContainer.style.gap = '20px';
            panelContainer.style.minHeight = '400px';

            // 左侧菜单栏
            const sidebar = document.createElement('div');
            sidebar.style.width = '200px';
            sidebar.style.flexShrink = '0';
            sidebar.style.borderRight = '1px solid var(--border-color)';
            sidebar.style.paddingRight = '20px';

            // 右侧内容区
            const contentArea = document.createElement('div');
            contentArea.style.flex = '1';
            contentArea.style.minWidth = '0';

            // 判断是否是当前周（决定默认显示模式）
            const now = new Date();
            const nowDay = now.getDay() || 7;
            const currentWeekMonday = new Date(now);
            currentWeekMonday.setDate(now.getDate() - nowDay + 1);
            currentWeekMonday.setHours(0, 0, 0, 0);
            const isCurrentWeek = (this.currentWeekStart.getTime() === currentWeekMonday.getTime());
            const shouldShowAllByDefault = !this.selectMode && !isCurrentWeek;

            // 默认选中第一天
            let selectedDateKey = this.getDateKey(filteredBookmarks[0].date);

            // 添加「All」0级菜单（所有模式下都显示）
            const totalBookmarks = filteredBookmarks.reduce((sum, item) => sum + item.bookmarks.length, 0);

            const allMenuItem = document.createElement('div');
            allMenuItem.style.padding = '12px';
            allMenuItem.style.borderRadius = '8px';
            allMenuItem.style.cursor = 'pointer';
            allMenuItem.style.transition = 'all 0.2s';
            allMenuItem.style.fontSize = '14px';
            allMenuItem.style.fontWeight = '600';
            allMenuItem.style.marginBottom = '12px';
            allMenuItem.dataset.menuType = 'all';

            // 勾选模式下默认选中（绿色），普通模式下未选中（透明）
            if (this.selectMode) {
                allMenuItem.style.background = '#4CAF50';
                allMenuItem.style.color = 'white';
                allMenuItem.style.border = '1px solid #4CAF50';
            } else {
                allMenuItem.style.background = 'transparent';
                allMenuItem.style.color = 'var(--text-primary)';
                allMenuItem.style.border = '1px solid transparent';
            }

            allMenuItem.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span><i class="fas fa-th-large"></i> ${currentLang === 'en' ? 'All' : '全部'}</span>
                    <span style="font-size:12px;opacity:0.9;">${totalBookmarks}</span>
                </div>
            `;

            allMenuItem.addEventListener('click', () => {
                // 取消其他菜单项的选中状态
                sidebar.querySelectorAll('[data-date-key]').forEach(item => {
                    item.style.background = 'transparent';
                    item.style.color = 'var(--text-primary)';
                    item.style.fontWeight = 'normal';
                    item.classList.remove('select-mode-menu-active');
                });

                // 取消小时菜单项的选中状态
                sidebar.querySelectorAll('div[data-hour]').forEach(item => {
                    item.style.background = 'transparent';
                    item.style.color = 'var(--text-primary)';
                    item.style.border = '1px solid transparent';
                });

                // 设置All菜单为选中状态
                if (this.selectMode) {
                    allMenuItem.style.background = '#4CAF50';
                    allMenuItem.style.color = 'white';
                    allMenuItem.style.border = '1px solid #4CAF50';
                } else {
                    allMenuItem.style.background = 'rgba(33, 150, 243, 0.15)';
                    allMenuItem.style.color = 'var(--accent-primary)';
                    allMenuItem.style.fontWeight = '600';
                    allMenuItem.style.border = '1px solid var(--accent-primary)';
                }

                // 显示所有书签
                renderAllContent();
            });

            allMenuItem.addEventListener('mouseenter', () => {
                const isSelected = this.selectMode ?
                    (allMenuItem.style.background === 'rgb(76, 175, 80)') :
                    (allMenuItem.style.background === 'rgba(33, 150, 243, 0.15)');
                if (!isSelected) {
                    allMenuItem.style.background = 'rgba(128, 128, 128, 0.1)';
                }
            });

            allMenuItem.addEventListener('mouseleave', () => {
                if (allMenuItem.style.background === 'rgba(128, 128, 128, 0.1)') {
                    allMenuItem.style.background = 'transparent';
                }
            });

            sidebar.appendChild(allMenuItem);

            filteredBookmarks.forEach(({ date, bookmarks }, index) => {
                const dateKey = this.getDateKey(date);
                const hasTimePeriods = bookmarks.length > 10; // 是否需要时间段子菜单
                const isDayToday = this.isToday(date);

                // 日期菜单项容器
                const dayMenuContainer = document.createElement('div');
                dayMenuContainer.style.marginBottom = '8px';

                // 左侧菜单项
                const menuItem = document.createElement('div');
                menuItem.style.padding = '12px';
                menuItem.style.borderRadius = '8px';
                menuItem.style.cursor = 'pointer';
                menuItem.style.transition = 'all 0.2s';
                menuItem.style.fontSize = '14px';
                menuItem.style.position = 'relative';
                menuItem.dataset.dateKey = dateKey;
                // 在勾选模式下，默认展开所有有小时菜单的日期
                menuItem.dataset.expanded = (this.selectMode && hasTimePeriods) ? 'true' : 'false';

                // 第一天默认选中（仅在普通模式下且是当前周）
                if (index === 0 && !this.selectMode && !shouldShowAllByDefault) {
                    menuItem.style.background = 'var(--accent-primary)';
                    menuItem.style.color = 'white';
                    menuItem.style.fontWeight = '600';
                } else {
                    menuItem.style.background = 'transparent';
                    menuItem.style.color = 'var(--text-primary)';
                }

                const isExpanded = (this.selectMode && hasTimePeriods);
                menuItem.innerHTML = `
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        <div style="display:flex;align-items:center;gap:4px;">
                            ${hasTimePeriods ? `<i class="fas fa-chevron-${isExpanded ? 'down' : 'right'}" style="font-size:9px;"></i>` : ''}
                            <span style="font-size:14px;font-weight:600;">${twFull(date.getDay())}</span>
                        </div>
                        <div style="font-size:13px;opacity:0.85;">${t('calendarMonthDay', date.getMonth() + 1, date.getDate())}</div>
                        <div style="font-size:12px;opacity:0.7;">${t('calendarBookmarkCount', bookmarks.length)}</div>
                    </div>
                    ${isDayToday ? `<div style="position: absolute; bottom: 4px; right: 4px; font-size: 11px; color: ${index === 0 ? 'white' : '#2196F3'}; font-weight: 600;">${currentLang === 'en' ? 'Today' : '今天'}</div>` : ''}
                `;

                // 小时子菜单容器（二级菜单）
                let hoursContainer = null;
                if (hasTimePeriods) {
                    hoursContainer = document.createElement('div');
                    hoursContainer.style.marginLeft = '12px';
                    hoursContainer.style.marginTop = '4px';
                    hoursContainer.style.display = isExpanded ? 'block' : 'none';
                    hoursContainer.dataset.dateKey = dateKey;

                    // 按小时分组
                    const hourGroups = groupBookmarksByHour(bookmarks);
                    const hours = Object.keys(hourGroups).map(Number).sort((a, b) => {
                        return this.bookmarkSortAsc ? (a - b) : (b - a);
                    });

                    hours.forEach(hour => {
                        const hourBookmarks = hourGroups[hour];

                        const hourMenuItem = document.createElement('div');
                        hourMenuItem.style.padding = '6px 10px';
                        hourMenuItem.style.marginBottom = '3px';
                        hourMenuItem.style.borderRadius = '4px';
                        hourMenuItem.style.cursor = 'pointer';
                        hourMenuItem.style.transition = 'all 0.2s';
                        hourMenuItem.style.fontSize = '12px';
                        hourMenuItem.style.background = 'transparent';
                        hourMenuItem.style.color = 'var(--text-primary)';
                        hourMenuItem.style.border = '1px solid transparent';
                        hourMenuItem.dataset.hour = hour;
                        hourMenuItem.dataset.parentDateKey = dateKey;

                        hourMenuItem.innerHTML = `
                            <div style="display:flex;justify-content:space-between;align-items:center;">
                                <span>${String(hour).padStart(2, '0')}:00-${String(hour).padStart(2, '0')}:59</span>
                                <span style="font-size:11px;opacity:0.8;">${hourBookmarks.length}</span>
                            </div>
                        `;

                        hourMenuItem.addEventListener('click', (e) => {
                            e.stopPropagation();

                            // 更新所有小时的选中状态
                            sidebar.querySelectorAll('div[data-hour]').forEach(item => {
                                item.style.background = 'transparent';
                                item.style.color = 'var(--text-primary)';
                                item.style.border = '1px solid transparent';
                            });

                            if (this.selectMode) {
                                // 勾选模式：绿色样式
                                hourMenuItem.style.background = 'rgba(76, 175, 80, 0.1)';
                                hourMenuItem.style.color = '#4CAF50';
                                hourMenuItem.style.border = '1px solid rgba(76, 175, 80, 0.3)';
                            } else {
                                // 普通模式：蓝色样式
                                hourMenuItem.style.background = 'rgba(33, 150, 243, 0.1)';
                                hourMenuItem.style.color = 'var(--accent-primary)';
                                hourMenuItem.style.border = '1px solid rgba(33, 150, 243, 0.3)';
                            }

                            renderHourContent(date, hour, hourBookmarks);
                        });

                        hourMenuItem.addEventListener('mouseenter', () => {
                            if (hourMenuItem.style.background === 'transparent') {
                                hourMenuItem.style.background = 'rgba(128, 128, 128, 0.05)';
                            }
                        });

                        hourMenuItem.addEventListener('mouseleave', () => {
                            if (hourMenuItem.style.border === '1px solid transparent') {
                                hourMenuItem.style.background = 'transparent';
                            }
                        });

                        hoursContainer.appendChild(hourMenuItem);
                    });
                }

                menuItem.addEventListener('click', () => {
                    // 取消All菜单的选中状态
                    const allMenu = sidebar.querySelector('[data-menu-type="all"]');
                    if (allMenu) {
                        allMenu.style.background = 'transparent';
                        allMenu.style.color = 'var(--text-primary)';
                        allMenu.style.border = '1px solid transparent';
                    }

                    // 更新选中状态
                    sidebar.querySelectorAll('div[data-date-key]').forEach(item => {
                        item.style.background = 'transparent';
                        item.style.color = 'var(--text-primary)';
                        item.style.fontWeight = 'normal';
                        item.classList.remove('select-mode-menu-active');
                    });

                    // 取消小时菜单项的选中状态
                    sidebar.querySelectorAll('div[data-hour]').forEach(item => {
                        item.style.background = 'transparent';
                        item.style.color = 'var(--text-primary)';
                        item.style.border = '1px solid transparent';
                    });

                    if (this.selectMode) {
                        // 勾选模式：绿色样式
                        menuItem.classList.add('select-mode-menu-active');
                        menuItem.style.background = '#4CAF50';
                        menuItem.style.color = 'white';
                        menuItem.style.fontWeight = '600';
                    } else {
                        // 普通模式：蓝色样式
                        menuItem.style.background = 'var(--accent-primary)';
                        menuItem.style.color = 'white';
                        menuItem.style.fontWeight = '600';
                    }

                    selectedDateKey = dateKey;

                    if (hasTimePeriods) {
                        // 有小时子菜单，切换展开/收起
                        const isExpanded = menuItem.dataset.expanded === 'true';
                        const icon = menuItem.querySelector('.fa-chevron-right, .fa-chevron-down');

                        if (isExpanded) {
                            // 已展开，收起子菜单
                            hoursContainer.style.display = 'none';
                            menuItem.dataset.expanded = 'false';
                            if (icon) {
                                icon.classList.remove('fa-chevron-down');
                                icon.classList.add('fa-chevron-right');
                            }
                        } else {
                            // 未展开，展开子菜单
                            hoursContainer.style.display = 'block';
                            menuItem.dataset.expanded = 'true';
                            if (icon) {
                                icon.classList.remove('fa-chevron-right');
                                icon.classList.add('fa-chevron-down');
                            }
                        }

                        // 无论是否展开，右侧都显示当天所有书签
                        renderDayContent(date, bookmarks);
                    } else {
                        // 没有小时子菜单，直接显示内容
                        renderDayContent(date, bookmarks);
                    }
                });

                menuItem.addEventListener('mouseenter', () => {
                    if (menuItem.dataset.dateKey !== selectedDateKey || hasTimePeriods) {
                        menuItem.style.background = 'var(--bg-secondary)';
                    }
                });

                menuItem.addEventListener('mouseleave', () => {
                    if (menuItem.dataset.dateKey !== selectedDateKey) {
                        menuItem.style.background = 'transparent';
                    } else if (!hasTimePeriods) {
                        menuItem.style.background = 'var(--accent-primary)';
                    }
                });

                dayMenuContainer.appendChild(menuItem);
                if (hoursContainer) {
                    dayMenuContainer.appendChild(hoursContainer);
                }
                sidebar.appendChild(dayMenuContainer);
            });

            // 渲染右侧内容 - 显示某一天的书签（<=10个）
            const renderDayContent = (date, bookmarks) => {
                contentArea.innerHTML = '';

                const isDayToday = this.isToday(date);
                const themeColor = this.selectMode ? '#4CAF50' : 'var(--accent-primary)';
                const todayColor = this.selectMode ? '#4CAF50' : '#2196F3';

                const dayHeader = document.createElement('div');
                dayHeader.style.fontSize = '18px';
                dayHeader.style.fontWeight = '700';
                dayHeader.style.color = 'var(--text-primary)';
                dayHeader.style.marginBottom = '20px';
                dayHeader.style.paddingBottom = '12px';
                dayHeader.style.borderBottom = `2px solid ${themeColor}`;
                dayHeader.style.display = 'flex';
                dayHeader.style.justifyContent = 'space-between';
                dayHeader.style.alignItems = 'center';

                // 创建标题和书签数量的容器
                const titleContainer = document.createElement('div');
                titleContainer.style.display = 'flex';
                titleContainer.style.alignItems = 'baseline';
                titleContainer.style.gap = '12px';
                titleContainer.innerHTML = `
                    <span><i class="fas fa-calendar-day"></i> ${twFull(date.getDay())}, ${t('calendarMonthDay', date.getMonth() + 1, date.getDate())}${isDayToday ? ` <span style="color: ${todayColor};">(${currentLang === 'en' ? 'Today' : '今天'})</span>` : ''}</span>
                    <span style="font-size:14px;color:var(--text-secondary);">${t('calendarBookmarksCount', bookmarks.length)}</span>
                `;

                // 创建导出按钮
                const headerText = `${twFull(date.getDay())} ${t('calendarMonthDay', date.getMonth() + 1, date.getDate())}`;
                const exportBtn = this.createInlineExportButton({
                    title: headerText,
                    type: 'day',
                    data: { date: new Date(date) }
                });
                
                // 创建排序按钮
                const sortBtn = this.createSortToggleButton();
                
                // 创建按钮容器
                const buttonsContainer = document.createElement('div');
                buttonsContainer.style.display = 'flex';
                buttonsContainer.style.gap = '8px';
                buttonsContainer.appendChild(exportBtn);
                buttonsContainer.appendChild(sortBtn);
                
                dayHeader.appendChild(titleContainer);
                dayHeader.appendChild(buttonsContainer);
                contentArea.appendChild(dayHeader);

                // 直接显示书签列表
                const bookmarkList = this.createCollapsibleBookmarkList(bookmarks);
                contentArea.appendChild(bookmarkList);
            };

            // 渲染右侧内容 - 显示某个小时的书签（>10个时）
            const renderHourContent = (date, hour, hourBookmarks) => {
                contentArea.innerHTML = '';

                const isDayToday = this.isToday(date);
                const themeColor = this.selectMode ? '#4CAF50' : 'var(--accent-primary)';
                const todayColor = this.selectMode ? '#4CAF50' : '#2196F3';

                const hourHeader = document.createElement('div');
                hourHeader.style.fontSize = '18px';
                hourHeader.style.fontWeight = '700';
                hourHeader.style.color = 'var(--text-primary)';
                hourHeader.style.marginBottom = '20px';
                hourHeader.style.paddingBottom = '12px';
                hourHeader.style.borderBottom = `2px solid ${themeColor}`;
                hourHeader.style.display = 'flex';
                hourHeader.style.justifyContent = 'space-between';
                hourHeader.style.alignItems = 'center';

                // 创建标题和书签数量的容器
                const titleContainer = document.createElement('div');
                titleContainer.style.display = 'flex';
                titleContainer.style.alignItems = 'baseline';
                titleContainer.style.gap = '12px';
                titleContainer.innerHTML = `
                    <span>
                        <i class="fas fa-calendar-day"></i> ${twFull(date.getDay())}, ${t('calendarMonthDay', date.getMonth() + 1, date.getDate())}${isDayToday ? ` <span style="color: ${todayColor};">(${currentLang === 'en' ? 'Today' : '今天'})</span>` : ''}
                        <span style="margin-left:12px;">${String(hour).padStart(2, '0')}:00-${String(hour).padStart(2, '0')}:59</span>
                    </span>
                    <span style="font-size:14px;color:var(--text-secondary);">${t('calendarBookmarksCount', hourBookmarks.length)}</span>
                `;

                // 创建导出按钮 - 包含完整日期
                const fullDatePart = currentLang === 'zh_CN'
                    ? `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
                    : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                const headerText = `${fullDatePart} ${String(hour).padStart(2, '0')}:00-${String(hour).padStart(2, '0')}:59`;
                const exportBtn = this.createInlineExportButton({
                    title: headerText,
                    type: 'hour',
                    data: { date: new Date(date), hour }
                });
                
                // 创建排序按钮
                const sortBtn = this.createSortToggleButton();
                
                // 创建按钮容器
                const buttonsContainer = document.createElement('div');
                buttonsContainer.style.display = 'flex';
                buttonsContainer.style.gap = '8px';
                buttonsContainer.appendChild(exportBtn);
                buttonsContainer.appendChild(sortBtn);
                
                hourHeader.appendChild(titleContainer);
                hourHeader.appendChild(buttonsContainer);
                contentArea.appendChild(hourHeader);

                // 显示该小时的书签列表（带折叠）
                const bookmarkList = this.createCollapsibleBookmarkList(hourBookmarks);
                contentArea.appendChild(bookmarkList);
            };

            // 渲染右侧内容 - 显示所有日期的书签（勾选模式和普通模式通用）
            const renderAllContent = () => {
                contentArea.innerHTML = '';

                const themeColor = this.selectMode ? '#4CAF50' : 'var(--accent-primary)';

                const allHeader = document.createElement('div');
                allHeader.style.fontSize = '18px';
                allHeader.style.fontWeight = '700';
                allHeader.style.color = 'var(--text-primary)';
                allHeader.style.marginBottom = '20px';
                allHeader.style.paddingBottom = '12px';
                allHeader.style.borderBottom = `2px solid ${themeColor}`;
                allHeader.style.display = 'flex';
                allHeader.style.justifyContent = 'space-between';
                allHeader.style.alignItems = 'center';

                const totalBookmarks = filteredBookmarks.reduce((sum, item) => sum + item.bookmarks.length, 0);

                const headerIcon = this.selectMode ? 'fa-check-circle' : 'fa-th-large';
                const headerText = this.selectMode ?
                    (currentLang === 'en' ? 'All Selected Bookmarks' : '所有选中的书签') :
                    (currentLang === 'en' ? 'All Bookmarks This Week' : '本周所有书签');

                // 创建标题和书签数量的容器
                const titleContainer = document.createElement('div');
                titleContainer.style.display = 'flex';
                titleContainer.style.alignItems = 'baseline';
                titleContainer.style.gap = '12px';
                titleContainer.innerHTML = `
                    <span><i class="fas ${headerIcon}"></i> ${headerText}</span>
                    <span style="font-size:14px;color:var(--text-secondary);">${t('calendarBookmarksCount', totalBookmarks)}</span>
                `;

                // 创建导出按钮
                const exportBtn = this.createInlineExportButton({
                    title: headerText,
                    type: 'all',
                    data: { viewLevel: 'week', weekStart: this.currentWeekStart }
                });
                
                // 创建排序按钮
                const sortBtn = this.createSortToggleButton();
                
                // 创建按钮容器
                const buttonsContainer = document.createElement('div');
                buttonsContainer.style.display = 'flex';
                buttonsContainer.style.gap = '8px';
                buttonsContainer.appendChild(exportBtn);
                buttonsContainer.appendChild(sortBtn);
                
                allHeader.appendChild(titleContainer);
                allHeader.appendChild(buttonsContainer);
                contentArea.appendChild(allHeader);

                // 按日显示
                filteredBookmarks.forEach(({ date, bookmarks }) => {
                    const daySection = document.createElement('div');
                    daySection.style.marginBottom = '32px';

                    const isDayToday = this.isToday(date);
                    const todayColor = '#4CAF50';

                    const dayTitle = document.createElement('div');
                    dayTitle.style.fontSize = '16px';
                    dayTitle.style.fontWeight = '600';
                    dayTitle.style.color = 'var(--accent-primary)';
                    dayTitle.style.marginBottom = '16px';
                    dayTitle.style.paddingBottom = '8px';
                    dayTitle.style.borderBottom = `1px solid ${themeColor}`;
                    dayTitle.innerHTML = `${twFull(date.getDay())}, ${t('calendarMonthDay', date.getMonth() + 1, date.getDate())}${isDayToday ? ` <span style="color: ${todayColor};">(${currentLang === 'en' ? 'Today' : '今天'})</span>` : ''} - ${t('calendarBookmarkCount', bookmarks.length)}`;
                    daySection.appendChild(dayTitle);

                    const bookmarkList = this.createCollapsibleBookmarkList(bookmarks);
                    daySection.appendChild(bookmarkList);

                    contentArea.appendChild(daySection);
                });
            };

            // 初始显示逻辑
            if (this.selectMode) {
                // 勾选模式：显示所有选中的
                renderAllContent();
            } else if (shouldShowAllByDefault) {
                // 普通模式 + 非当前周：显示All模式
                allMenuItem.style.background = 'rgba(33, 150, 243, 0.15)';
                allMenuItem.style.color = 'var(--accent-primary)';
                allMenuItem.style.fontWeight = '600';
                allMenuItem.style.border = '1px solid var(--accent-primary)';
                renderAllContent();
            } else {
                // 普通模式 + 当前周：默认显示All模式
                allMenuItem.style.background = 'rgba(33, 150, 243, 0.15)';
                allMenuItem.style.color = 'var(--accent-primary)';
                allMenuItem.style.fontWeight = '600';
                allMenuItem.style.border = '1px solid var(--accent-primary)';
                renderAllContent();
            }

            panelContainer.appendChild(sidebar);
            panelContainer.appendChild(contentArea);
            section.appendChild(panelContainer);

            wrapper.appendChild(section);
        }

        container.appendChild(wrapper);
    }

    // ========== 日视图 ==========

    renderDayView(container) {
        const wrapper = document.createElement('div');
        wrapper.style.padding = '20px';

        // 构建标题,如果是今天则添加标注
        const dateTitle = t('calendarYearMonthDay', this.currentDay.getFullYear(), this.currentDay.getMonth() + 1, this.currentDay.getDate());
        const todaySuffix = this.isToday(this.currentDay) ? (currentLang === 'en' ? ' (Today)' : '（今天）') : '';

        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.marginBottom = '20px';
        header.innerHTML = `
            <button class="calendar-nav-btn" id="prevDay"><i class="fas fa-chevron-left"></i></button>
            <div style="font-size:18px;font-weight:600;">${dateTitle}${todaySuffix}</div>
            <button class="calendar-nav-btn" id="nextDay"><i class="fas fa-chevron-right"></i></button>
        `;
        wrapper.appendChild(header);

        header.querySelector('#prevDay').addEventListener('click', () => {
            this.currentDay.setDate(this.currentDay.getDate() - 1);
            // 同步更新currentWeekStart为新日期所在周的周一(ISO 8601标准)
            const dayOfWeek = this.currentDay.getDay() || 7;
            this.currentWeekStart = new Date(this.currentDay);
            this.currentWeekStart.setDate(this.currentDay.getDate() - dayOfWeek + 1);
            this.render();
        });

        header.querySelector('#nextDay').addEventListener('click', () => {
            this.currentDay.setDate(this.currentDay.getDate() + 1);
            // 同步更新currentWeekStart为新日期所在周的周一(ISO 8601标准)
            const dayOfWeek = this.currentDay.getDay() || 7;
            this.currentWeekStart = new Date(this.currentDay);
            this.currentWeekStart.setDate(this.currentDay.getDate() - dayOfWeek + 1);
            this.render();
        });

        const dateKey = this.getDateKey(this.currentDay);
        const bookmarks = this.bookmarksByDate.get(dateKey) || [];

        if (bookmarks.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'calendar-empty-state';
            emptyState.innerHTML = `<i class="fas fa-calendar-day"></i><p>${t('calendarNoBookmarksThisDay')}</p>`;
            wrapper.appendChild(emptyState);
            container.appendChild(wrapper);
            return;
        }

        const title = document.createElement('h3');
        title.style.marginBottom = '20px';
        title.textContent = t('calendarTotalThisDay', bookmarks.length);
        wrapper.appendChild(title);

        // 日视图：左侧「全部 + 时间段」菜单，右侧内容
        const panelContainer = document.createElement('div');
        panelContainer.style.display = 'flex';
        panelContainer.style.gap = '20px';
        panelContainer.style.minHeight = '400px';

        const sidebar = document.createElement('div');
        sidebar.style.width = '200px';
        sidebar.style.flexShrink = '0';
        sidebar.style.borderRight = '1px solid var(--border-color)';
        sidebar.style.paddingRight = '20px';

        const contentArea = document.createElement('div');
        contentArea.style.flex = '1';
        contentArea.style.minWidth = '0';

        // 按小时分组
        const hourGroups = groupBookmarksByHour(bookmarks);
        const hours = Object.keys(hourGroups).map(Number).sort((a, b) => {
            return this.bookmarkSortAsc ? (a - b) : (b - a);
        });

        let selectedMode = 'all'; // 'all' | 'hour'
        let selectedHour = null;

        const themeColor = this.selectMode ? '#4CAF50' : 'var(--accent-primary)';
        const allLabel = currentLang === 'en' ? 'All' : '全部';

        // 「全部」菜单项
        const allMenuItem = document.createElement('div');
        allMenuItem.style.padding = '10px 12px';
        allMenuItem.style.marginBottom = '8px';
        allMenuItem.style.borderRadius = '8px';
        allMenuItem.style.cursor = 'pointer';
        allMenuItem.style.transition = 'all 0.2s';
        allMenuItem.style.fontSize = '14px';
        allMenuItem.style.fontWeight = '600';
        allMenuItem.dataset.menuType = 'all';

        const applyAllActiveStyle = (active) => {
            if (active) {
                if (this.selectMode) {
                    allMenuItem.style.background = 'rgba(76, 175, 80, 0.15)';
                    allMenuItem.style.color = '#4CAF50';
                    allMenuItem.style.border = '1px solid rgba(76, 175, 80, 0.4)';
                } else {
                    allMenuItem.style.background = 'rgba(33, 150, 243, 0.15)';
                    allMenuItem.style.color = 'var(--accent-primary)';
                    allMenuItem.style.border = '1px solid var(--accent-primary)';
                }
            } else {
                allMenuItem.style.background = 'transparent';
                allMenuItem.style.color = 'var(--text-primary)';
                allMenuItem.style.border = '1px solid transparent';
            }
        };

        applyAllActiveStyle(true);

        allMenuItem.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <span><i class="fas fa-th-large"></i> ${allLabel}</span>
                <span style="font-size:12px;opacity:0.8;">${t('calendarBookmarkCount', bookmarks.length)}</span>
            </div>
        `;

        allMenuItem.addEventListener('click', () => {
            selectedMode = 'all';
            selectedHour = null;

            applyAllActiveStyle(true);
            sidebar.querySelectorAll('div[data-hour]').forEach(item => {
                item.style.background = 'transparent';
                item.style.color = 'var(--text-primary)';
                item.style.border = '1px solid transparent';
                item.style.fontWeight = 'normal';
            });

            renderAllContent();
        });

        sidebar.appendChild(allMenuItem);

        // 小时菜单项
        hours.forEach(hour => {
            const hourBookmarks = hourGroups[hour];
            const menuItem = document.createElement('div');
            menuItem.style.padding = '10px 12px';
            menuItem.style.marginBottom = '6px';
            menuItem.style.borderRadius = '8px';
            menuItem.style.cursor = 'pointer';
            menuItem.style.transition = 'all 0.2s';
            menuItem.style.fontSize = '13px';
            menuItem.style.background = 'transparent';
            menuItem.style.color = 'var(--text-primary)';
            menuItem.style.border = '1px solid transparent';
            menuItem.dataset.hour = hour;

            menuItem.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span>${String(hour).padStart(2, '0')}:00-${String(hour).padStart(2, '0')}:59</span>
                    <span style="font-size:11px;opacity:0.8;">${hourBookmarks.length}</span>
                </div>
            `;

            menuItem.addEventListener('click', () => {
                selectedMode = 'hour';
                selectedHour = hour;

                applyAllActiveStyle(false);
                sidebar.querySelectorAll('div[data-hour]').forEach(item => {
                    item.style.background = 'transparent';
                    item.style.color = 'var(--text-primary)';
                    item.style.border = '1px solid transparent';
                    item.style.fontWeight = 'normal';
                });

                if (this.selectMode) {
                    menuItem.style.background = 'rgba(76, 175, 80, 0.1)';
                    menuItem.style.color = '#4CAF50';
                    menuItem.style.border = '1px solid rgba(76, 175, 80, 0.3)';
                } else {
                    menuItem.style.background = 'rgba(33, 150, 243, 0.1)';
                    menuItem.style.color = 'var(--accent-primary)';
                    menuItem.style.border = '1px solid rgba(33, 150, 243, 0.3)';
                }
                menuItem.style.fontWeight = '600';

                renderHourContent(hour, hourBookmarks);
            });

            menuItem.addEventListener('mouseenter', () => {
                if (selectedMode === 'hour' && selectedHour === hour) return;
                if (menuItem.style.background === 'transparent') {
                    menuItem.style.background = 'rgba(128, 128, 128, 0.05)';
                }
            });

            menuItem.addEventListener('mouseleave', () => {
                if (selectedMode === 'hour' && selectedHour === hour) return;
                if (menuItem.style.border === '1px solid transparent') {
                    menuItem.style.background = 'transparent';
                }
            });

            sidebar.appendChild(menuItem);
        });

        const renderAllContent = () => {
            contentArea.innerHTML = '';

            const allHeader = document.createElement('div');
            allHeader.style.fontSize = '18px';
            allHeader.style.fontWeight = '700';
            allHeader.style.color = 'var(--text-primary)';
            allHeader.style.marginBottom = '20px';
            allHeader.style.paddingBottom = '12px';
            allHeader.style.borderBottom = `2px solid ${themeColor}`;
            allHeader.style.display = 'flex';
            allHeader.style.justifyContent = 'space-between';
            allHeader.style.alignItems = 'center';

            // 创建标题和书签数量的容器
            const titleContainer = document.createElement('div');
            titleContainer.style.display = 'flex';
            titleContainer.style.alignItems = 'baseline';
            titleContainer.style.gap = '12px';
            titleContainer.innerHTML = `
                <span><i class="fas fa-th-large"></i> ${allLabel}</span>
                <span style="font-size:14px;color:var(--text-secondary);">${t('calendarBookmarksCount', bookmarks.length)}</span>
            `;

            // 创建导出按钮 - 日视图下使用「全部」作为标题
            const dayTitle = t('calendarYearMonthDay', this.currentDay.getFullYear(), this.currentDay.getMonth() + 1, this.currentDay.getDate());
            const headerText = currentLang === 'zh_CN' ? `${dayTitle}` : dayTitle;
            const exportBtn = this.createInlineExportButton({
                title: headerText,
                type: 'all',
                data: { viewLevel: 'day', date: this.currentDay }
            });
            
            // 创建排序按钮
            const sortBtn = this.createSortToggleButton();
            
            // 创建按钮容器
            const buttonsContainer = document.createElement('div');
            buttonsContainer.style.display = 'flex';
            buttonsContainer.style.gap = '8px';
            buttonsContainer.appendChild(exportBtn);
            buttonsContainer.appendChild(sortBtn);
            
            allHeader.appendChild(titleContainer);
            allHeader.appendChild(buttonsContainer);
            contentArea.appendChild(allHeader);

            // 「全部」模式下：把当天所有书签合在一起显示为一个整体列表
            const allBookmarks = [];
            hours.forEach(hour => {
                const hourBookmarks = hourGroups[hour];
                if (hourBookmarks && hourBookmarks.length) {
                    allBookmarks.push(...hourBookmarks);
                }
            });

            if (!allBookmarks.length) {
                const empty = document.createElement('p');
                empty.style.marginTop = '12px';
                empty.style.color = 'var(--text-secondary)';
                empty.textContent = t('calendarNoBookmarksThisDay');
                contentArea.appendChild(empty);
                return;
            }

            const list = this.createCollapsibleBookmarkList(allBookmarks);
            contentArea.appendChild(list);
        };

        const renderHourContent = (hour, hourBookmarks) => {
            contentArea.innerHTML = '';

            const hourHeader = document.createElement('div');
            hourHeader.style.fontSize = '18px';
            hourHeader.style.fontWeight = '700';
            hourHeader.style.color = 'var(--text-primary)';
            hourHeader.style.marginBottom = '20px';
            hourHeader.style.paddingBottom = '12px';
            hourHeader.style.borderBottom = `2px solid ${themeColor}`;
            hourHeader.style.display = 'flex';
            hourHeader.style.justifyContent = 'space-between';
            hourHeader.style.alignItems = 'center';

            // 创建标题和书签数量的容器
            const titleContainer = document.createElement('div');
            titleContainer.style.display = 'flex';
            titleContainer.style.alignItems = 'baseline';
            titleContainer.style.gap = '12px';
            titleContainer.innerHTML = `
                <span>${String(hour).padStart(2, '0')}:00-${String(hour).padStart(2, '0')}:59</span>
                <span style="font-size:14px;color:var(--text-secondary);">${t('calendarBookmarksCount', hourBookmarks.length)}</span>
            `;

            // 创建导出按钮 - 包含完整日期
            const fullDate = currentLang === 'zh_CN' 
                ? `${this.currentDay.getFullYear()}年${this.currentDay.getMonth() + 1}月${this.currentDay.getDate()}日`
                : `${this.currentDay.getFullYear()}-${String(this.currentDay.getMonth() + 1).padStart(2, '0')}-${String(this.currentDay.getDate()).padStart(2, '0')}`;
            const headerText = `${fullDate} ${String(hour).padStart(2, '0')}:00-${String(hour).padStart(2, '0')}:59`;
            const exportBtn = this.createInlineExportButton({
                title: headerText,
                type: 'hour',
                data: { date: this.currentDay, hour }
            });
            
            // 创建排序按钮
            const sortBtn = this.createSortToggleButton();
            
            // 创建按钮容器
            const buttonsContainer = document.createElement('div');
            buttonsContainer.style.display = 'flex';
            buttonsContainer.style.gap = '8px';
            buttonsContainer.appendChild(exportBtn);
            buttonsContainer.appendChild(sortBtn);
            
            hourHeader.appendChild(titleContainer);
            hourHeader.appendChild(buttonsContainer);
            contentArea.appendChild(hourHeader);

            const list = this.createCollapsibleBookmarkList(hourBookmarks);
            contentArea.appendChild(list);
        };

        // 默认进入日视图时：选中「全部」，显示当天所有时间段
        renderAllContent();

        panelContainer.appendChild(sidebar);
        panelContainer.appendChild(contentArea);
        wrapper.appendChild(panelContainer);

        container.appendChild(wrapper);
    }

    // ========== 年视图 ==========

    renderYearView(container) {
        const wrapper = document.createElement('div');
        wrapper.style.padding = '20px';

        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.marginBottom = '20px';
        header.innerHTML = `
            <button class="calendar-nav-btn" id="prevYear"><i class="fas fa-chevron-left"></i></button>
            <div style="font-size:18px;font-weight:600;">${t('calendarYear', this.currentYear)}</div>
            <button class="calendar-nav-btn" id="nextYear"><i class="fas fa-chevron-right"></i></button>
        `;
        wrapper.appendChild(header);

        header.querySelector('#prevYear').addEventListener('click', () => {
            this.currentYear--;
            this.render();
        });

        header.querySelector('#nextYear').addEventListener('click', () => {
            this.currentYear++;
            this.render();
        });

        const yearGrid = document.createElement('div');
        yearGrid.className = 'year-view-grid';

        for (let month = 0; month < 12; month++) {
            const daysInMonth = new Date(this.currentYear, month + 1, 0).getDate();
            let count = 0;

            for (let day = 1; day <= daysInMonth; day++) {
                const dateKey = this.getDateKey(new Date(this.currentYear, month, day));
                count += (this.bookmarksByDate.get(dateKey) || []).length;
            }

            const monthCard = document.createElement('div');
            monthCard.className = 'month-card';
            monthCard.innerHTML = `
                <div class="month-card-title">${tm(month)}</div>
                <div class="month-card-count">${count}</div>
                <div class="month-card-label">${t('calendarBookmarksCount', '').replace(/\d+\s*/, '')}</div>
            `;

            monthCard.addEventListener('click', () => {
                this.currentMonth = month;
                this.viewLevel = 'month';
                this.render();
            });

            yearGrid.appendChild(monthCard);
        }

        wrapper.appendChild(yearGrid);
        container.appendChild(wrapper);
    }

    // ========== 导出功能 ==========

    // 创建内联导出按钮（用于标题右侧）
    // scopeData: { title: string, type: string, data: object }
    // 例如: { title: "第45周", type: "week", data: { weekNum: 45, weekStart: Date } }
    createInlineExportButton(scopeData) {
        // 兼容旧的字符串参数
        if (typeof scopeData === 'string') {
            scopeData = { title: scopeData, type: 'custom', data: {} };
        }

        const btn = document.createElement('button');
        btn.className = 'calendar-action-btn';
        
        // 只显示图标
        const icon = document.createElement('i');
        icon.className = 'fas fa-file-export';
        btn.appendChild(icon);

        // 创建tooltip（使用与其他按钮相同的样式）
        const tooltip = document.createElement('span');
        tooltip.className = 'btn-tooltip';
        tooltip.textContent = currentLang === 'zh_CN' ? '导出记录' : 'Export Records';
        btn.appendChild(tooltip);

        // 点击打开导出弹窗，并记录当前范围信息
        btn.addEventListener('click', () => {
            this.currentExportScope = scopeData;
            this.currentExportScopeTitle = scopeData.title;
            this.openExportModal();
        });

        return btn;
    }

    // 创建排序切换按钮（用于标题右侧，导出按钮旁边）
    createSortToggleButton() {
        const btn = document.createElement('button');
        btn.className = 'calendar-action-btn';
        
        // 如果处于冷却期，添加防抖类
        if (this.sortButtonCooldown) {
            btn.classList.add('sort-cooldown');
        }
        
        // 显示图标（根据当前排序状态）
        const icon = document.createElement('i');
        icon.className = this.bookmarkSortAsc ? 'fas fa-sort-amount-down' : 'fas fa-sort-amount-up';
        btn.appendChild(icon);

        // 创建tooltip（使用与其他按钮相同的样式）
        const tooltip = document.createElement('span');
        tooltip.className = 'btn-tooltip';
        const t = window.i18n || {};
        const updateTooltip = () => {
            tooltip.textContent = this.bookmarkSortAsc 
                ? (t.currentAscending?.[currentLang] || (currentLang === 'zh_CN' ? '当前：正序' : 'Current: Ascending'))
                : (t.currentDescending?.[currentLang] || (currentLang === 'zh_CN' ? '当前：倒序' : 'Current: Descending'));
        };
        updateTooltip();
        btn.appendChild(tooltip);

        // 点击切换排序方向并重新渲染，添加防抖效果
        btn.addEventListener('click', () => {
            // 设置冷却标志
            this.sortButtonCooldown = true;
            
            this.bookmarkSortAsc = !this.bookmarkSortAsc;
            // 保存排序状态
            localStorage.setItem('bookmarkCalendar_sortAsc', this.bookmarkSortAsc.toString());
            updateTooltip();
            this.render(); // 重新渲染当前视图
            
            // 800ms后清除冷却标志并移除所有按钮上的防抖类
            setTimeout(() => {
                this.sortButtonCooldown = false;
                // 移除所有排序按钮上的 sort-cooldown 类
                document.querySelectorAll('.calendar-action-btn.sort-cooldown').forEach(btn => {
                    btn.classList.remove('sort-cooldown');
                });
            }, 800);
        });

        return btn;
    }

    setupExportUI() {
        const modal = document.getElementById('exportModal');
        const closeBtn = document.getElementById('closeExportModal');
        const doExportBtn = document.getElementById('doExportBtn');

        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                modal.classList.remove('show');
            });
        }

        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.classList.remove('show');
            });
        }

        if (doExportBtn) {
            doExportBtn.addEventListener('click', () => this.handleExport());
        }
    }

    openExportModal() {
        const modal = document.getElementById('exportModal');
        if (!modal) return;

        // 更新范围说明 - 使用当前导出范围标题
        const scopeText = document.getElementById('exportScopeText');
        if (scopeText) {
            // 如果有currentExportScopeTitle，直接使用它
            if (this.currentExportScopeTitle) {
                scopeText.textContent = this.currentExportScopeTitle;
            } else if (this.selectMode) {
                // 勾选模式：过滤掉没有数据的日期
                const dates = Array.from(this.selectedDates)
                    .filter(dateKey => {
                        const bookmarks = this.bookmarksByDate.get(dateKey);
                        return bookmarks && bookmarks.length > 0;
                    })
                    .sort();

                if (dates.length === 0) {
                    scopeText.textContent = currentLang === 'zh_CN' ? '未选中任何日期' : 'No dates selected';
                } else {
                    // 检查是否同月
                    const months = [...new Set(dates.map(dateKey => dateKey.substring(0, 7)))];

                    if (months.length === 1) {
                        // 同月：显示为 "10月：1、7、8"
                        const [y, m] = months[0].split('-').map(Number);
                        const days = dates.map(dateKey => {
                            const [, , d] = dateKey.split('-').map(Number);
                            return d;
                        }).join('、');

                        scopeText.textContent = currentLang === 'zh_CN'
                            ? `当前勾选 ${m}月：${days}`
                            : `Selected ${months[0]}: ${days}`;
                    } else {
                        // 跨月：显示完整日期
                        const formatDate = (dateKey) => {
                            const [y, m, d] = dateKey.split('-').map(Number);
                            return `${m}-${d}`;
                        };
                        const dateList = dates.map(formatDate).join('、');
                        scopeText.textContent = currentLang === 'zh_CN'
                            ? `当前勾选：${dateList}`
                            : `Selected: ${dateList}`;
                    }
                }
            } else {
                // 非勾选模式：显示当前视图范围
                let text = '';
                switch (this.viewLevel) {
                    case 'year': text = t('calendarYear', this.currentYear); break;
                    case 'month': text = formatYearMonth(this.currentYear, this.currentMonth); break;
                    case 'week':
                        const weekNum = this.getWeekNumber(this.currentWeekStart);
                        text = `${t('calendarYear', this.currentYear)} ${t('calendarWeek', weekNum)}`;
                        break;
                    case 'day':
                        text = t('calendarYearMonthDay', this.currentYear, this.currentMonth + 1, this.currentDay.getDate()).replace('{0}', this.currentYear).replace('{1}', this.currentMonth + 1).replace('{2}', this.currentDay.getDate());
                        break;
                }
                scopeText.textContent = i18n.exportScopeCurrent[currentLang] + text;
            }
        }

        modal.classList.add('show');
    }

    async handleExport() {
        const modal = document.getElementById('exportModal');
        const doExportBtn = document.getElementById('doExportBtn');
        const originalBtnText = doExportBtn.innerHTML;

        try {
            doExportBtn.disabled = true;
            doExportBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${i18n.exportBtnProcessing[currentLang]}`;

            // 获取选项
            const mode = document.querySelector('input[name="exportMode"]:checked')?.value || 'records';
            const formats = Array.from(document.querySelectorAll('input[name="exportFormat"]:checked')).map(cb => cb.value);

            if (formats.length === 0) {
                alert(i18n.exportErrorNoFormat[currentLang]);
                return;
            }

            // 获取数据
            const exportData = await this.getExportData(mode);
            if (!exportData || exportData.children.length === 0) {
                alert(i18n.exportErrorNoData[currentLang]);
                return;
            }

            // 生成文件名（不包含时间戳）
            const filenameBase = this.generateExportFilename(mode);

            // 导出 HTML
            if (formats.includes('html') || formats.includes('copy')) {
                const htmlContent = this.generateNetscapeHTML(exportData);

                if (formats.includes('html')) {
                    this.downloadFile(htmlContent, `${filenameBase}.html`, 'text/html');
                }

                if (formats.includes('copy')) {
                    await this.copyToClipboard(htmlContent);
                    if (formats.length === 1) {
                        alert(i18n.exportSuccessCopy[currentLang]);
                    }
                }
            }

            // 导出 JSON
            if (formats.includes('json')) {
                const jsonContent = JSON.stringify(exportData, null, 2);
                this.downloadFile(jsonContent, `${filenameBase}.json`, 'application/json');
            }

            modal.classList.remove('show');

        } catch (error) {
            console.error('导出失败:', error);
            alert(i18n.error[currentLang] + ': ' + error.message);
        } finally {
            doExportBtn.disabled = false;
            doExportBtn.innerHTML = originalBtnText;
        }
    }

    // 辅助：判断日期是否在当前导出范围内
    checkDateInScope(dateKey) {
        // 如果有记录的导出范围，使用它
        if (this.currentExportScope && this.currentExportScope.type) {
            const scope = this.currentExportScope;
            const [y, m, day] = dateKey.split('-').map(Number);
            const localDate = new Date(y, m - 1, day);

            switch (scope.type) {
                case 'week':
                    if (scope.data && scope.data.weekStart) {
                        const start = new Date(scope.data.weekStart);
                        start.setHours(0, 0, 0, 0);
                        const end = new Date(start);
                        end.setDate(end.getDate() + 6);
                        end.setHours(23, 59, 59, 999);
                        return localDate >= start && localDate <= end;
                    }
                    break;
                case 'day':
                    if (scope.data && scope.data.date) {
                        const targetDate = new Date(scope.data.date);
                        return this.getDateKey(localDate) === this.getDateKey(targetDate);
                    }
                    break;
                case 'hour':
                    if (scope.data && scope.data.date) {
                        const targetDate = new Date(scope.data.date);
                        if (this.getDateKey(localDate) !== this.getDateKey(targetDate)) {
                            return false;
                        }
                        // 对于hour类型，还需要检查具体的书签是否在这个小时内
                        // 这个检查会在后面的书签过滤中进行
                        return true;
                    }
                    break;
                case 'all':
                    // "全部"类型，使用当前视图级别
                    // 这个会回退到原来的逻辑
                    break;
            }
        }

        if (this.selectMode) {
            return this.selectedDates.has(dateKey);
        }

        if (this.viewLevel === 'year') {
            return dateKey.startsWith(`${this.currentYear}-`);
        }
        if (this.viewLevel === 'month') {
            const m = String(this.currentMonth + 1).padStart(2, '0');
            return dateKey.startsWith(`${this.currentYear}-${m}-`);
        }
        if (this.viewLevel === 'day') {
            return dateKey === this.getDateKey(this.currentDay);
        }
        if (this.viewLevel === 'week') {
            const [y, m, day] = dateKey.split('-').map(Number);
            const localDate = new Date(y, m - 1, day);

            const start = new Date(this.currentWeekStart);
            start.setHours(0, 0, 0, 0);
            const end = new Date(start);
            end.setDate(end.getDate() + 6);
            end.setHours(23, 59, 59, 999);

            return localDate >= start && localDate <= end;
        }
        return false;
    }

    // 辅助：判断书签是否在当前导出范围内（用于hour类型过滤）
    checkBookmarkInScope(bookmark) {
        // 如果是hour类型，需要检查书签的小时
        if (this.currentExportScope && this.currentExportScope.type === 'hour') {
            const scope = this.currentExportScope;
            if (scope.data && scope.data.hour !== undefined) {
                const bookmarkHour = bookmark.dateAdded.getHours();
                return bookmarkHour === scope.data.hour;
            }
        }
        // 其他类型不需要额外过滤
        return true;
    }

    // 辅助：获取导出范围名称（用于文件夹命名）
    getExportScopeName() {
        // 优先使用记录的导出范围标题
        if (this.currentExportScope && this.currentExportScope.title) {
            return this.currentExportScope.title;
        }

        if (this.selectMode) {
            // 勾选模式：过滤掉没有数据的日期，并格式化显示
            const dates = Array.from(this.selectedDates)
                .filter(dateKey => {
                    const bookmarks = this.bookmarksByDate.get(dateKey);
                    return bookmarks && bookmarks.length > 0;
                })
                .sort();

            if (dates.length === 0) {
                return currentLang === 'zh_CN' ? '未选中任何日期' : 'No dates selected';
            }

            // 检查是否同月
            const months = [...new Set(dates.map(dateKey => dateKey.substring(0, 7)))];

            if (months.length === 1) {
                // 同月：显示为 "当前勾选 10月：1、7、8"
                const [y, m] = months[0].split('-').map(Number);
                const days = dates.map(dateKey => {
                    const [, , d] = dateKey.split('-').map(Number);
                    return d;
                }).join('、');

                return currentLang === 'zh_CN'
                    ? `当前勾选 ${m}月：${days}`
                    : `Selected ${months[0]}: ${days}`;
            } else {
                // 跨月：显示完整日期
                const formatDate = (dateKey) => {
                    const [y, m, d] = dateKey.split('-').map(Number);
                    return `${m}-${d}`;
                };
                const dateList = dates.map(formatDate).join('、');
                return currentLang === 'zh_CN'
                    ? `当前勾选：${dateList}`
                    : `Selected: ${dateList}`;
            }
        }
        switch (this.viewLevel) {
            case 'year': return t('calendarYear', this.currentYear);
            case 'month': return formatYearMonth(this.currentYear, this.currentMonth);
            case 'week':
                const weekNum = this.getWeekNumber(this.currentWeekStart);
                // 需要组合 年 + 周
                return `${t('calendarYear', this.currentYear)} ${t('calendarWeek', weekNum)}`;
            case 'day':
                return t('calendarYearMonthDay', this.currentYear, this.currentMonth + 1, this.currentDay.getDate()).replace('{0}', this.currentYear).replace('{1}', this.currentMonth + 1).replace('{2}', this.currentDay.getDate());
            default: return i18n.exportRootTitle[currentLang];
        }
    }

    // 生成导出文件名（根据模式和范围）
    generateExportFilename(mode) {
        // 根据模式确定前缀
        let prefix = '';
        let prefixEn = '';
        switch (mode) {
            case 'records':
                prefix = '现记录';
                prefixEn = 'Records Only';
                break;
            case 'context':
                prefix = '现记录+上下文';
                prefixEn = 'Context Export';
                break;
            case 'collection':
                prefix = '集合导出';
                prefixEn = 'Collection Export';
                break;
            default:
                prefix = '现记录';
                prefixEn = 'Records Only';
        }

        // 根据当前语言选择前缀
        const modePrefix = currentLang === 'zh_CN' ? prefix : prefixEn;

        // 获取范围后缀 - 优先使用currentExportScopeTitle
        let scopeSuffix = '';
        if (this.currentExportScopeTitle) {
            // 清理标题中的特殊字符，用于文件名
            scopeSuffix = this.currentExportScopeTitle
                .replace(/[\s\/\\:*?"<>|]/g, '_')
                .replace(/_+/g, '_')
                .replace(/^_|_$/g, '');
        } else {
            scopeSuffix = this.getExportScopeSuffix();
        }

        // 组合文件名
        return scopeSuffix ? `${modePrefix}_${scopeSuffix}` : modePrefix;
    }

    // 获取导出范围后缀（用于文件名）
    getExportScopeSuffix() {
        if (this.selectMode) {
            // 勾选模式：过滤掉没有数据的日期
            const dates = Array.from(this.selectedDates)
                .filter(dateKey => {
                    const bookmarks = this.bookmarksByDate.get(dateKey);
                    return bookmarks && bookmarks.length > 0;
                })
                .sort();

            if (dates.length === 0) return '';

            // 检查是否同月
            const months = [...new Set(dates.map(dateKey => dateKey.substring(0, 7)))];

            if (months.length === 1) {
                // 同月：显示为 "10月：1、7、8"
                const [y, m] = months[0].split('-').map(Number);
                const days = dates.map(dateKey => {
                    const [, , d] = dateKey.split('-').map(Number);
                    return d;
                }).join('、');

                return currentLang === 'zh_CN'
                    ? `${m}月-${days.replace(/、/g, '_')}`
                    : `${months[0]}-${days.replace(/、/g, '_')}`;
            } else {
                // 跨月：显示完整日期
                const formatDate = (dateKey) => {
                    const [y, m, d] = dateKey.split('-').map(Number);
                    return `${m}-${d}`;
                };

                if (dates.length <= 5) {
                    return dates.map(formatDate).join('_');
                } else {
                    const first5 = dates.slice(0, 5).map(formatDate).join('_');
                    return `${first5}_etc`;
                }
            }
        } else {
            // 非勾选模式：根据视图层级显示范围
            switch (this.viewLevel) {
                case 'year':
                    return `${this.currentYear}`;
                case 'month':
                    return `${this.currentYear}-${String(this.currentMonth + 1).padStart(2, '0')}`;
                case 'week':
                    const weekNum = this.getWeekNumber(this.currentWeekStart);
                    return `${this.currentYear}-W${String(weekNum).padStart(2, '0')}`;
                case 'day':
                    return `${this.currentYear}-${String(this.currentMonth + 1).padStart(2, '0')}-${String(this.currentDay.getDate()).padStart(2, '0')}`;
                default:
                    return '';
            }
        }
    }

    async getExportData(mode) {
        const root = {
            title: i18n.exportRootTitle[currentLang],
            children: []
        };

        // 1. 创建顶层大文件夹（包含时间/范围信息）
        const mainFolderName = this.getExportScopeName();
        const mainFolder = {
            title: mainFolderName,
            type: 'folder',
            children: []
        };
        root.children.push(mainFolder);

        // 辅助函数：获取或创建子文件夹
        const getOrCreateFolder = (parent, name) => {
            let folder = parent.children.find(c => c.type === 'folder' && c.title === name);
            if (!folder) {
                folder = { title: name, type: 'folder', children: [] };
                parent.children.push(folder);
            }
            return folder;
        };

        // 2. 收集所有符合范围的书签（按日期排序）
        const sortedDateKeys = [...this.bookmarksByDate.keys()].sort();
        let allTargetBookmarks = []; // 用于 collection 和 context 模式

        // 判断是否是单日导出（不需要日期子文件夹）
        const isSingleDayExport = !this.selectMode && this.viewLevel === 'day';

        if (mode === 'records') {
            // RECORDS 模式：根据导出范围简化层级结构
            const ensurePath = (rootNode, pathArray) => {
                let current = rootNode;
                for (const folderName of pathArray) {
                    current = getOrCreateFolder(current, folderName);
                }
                return current;
            };

            for (const dateKey of sortedDateKeys) {
                if (!this.checkDateInScope(dateKey)) continue;

                const bookmarks = this.bookmarksByDate.get(dateKey);
                if (!bookmarks || bookmarks.length === 0) continue; // 过滤空白日期

                const [y, m, d] = dateKey.split('-').map(Number);
                const date = new Date(y, m - 1, d);

                // 判断目标文件夹：单日直接用主文件夹，多日需要创建日期子文件夹
                let targetFolder;

                if (isSingleDayExport) {
                    // 单日导出：直接用主文件夹，不创建日期子文件夹
                    targetFolder = mainFolder;
                } else {
                    // 多日导出：创建日期子文件夹
                    let dayFolderName;
                    if (currentLang === 'zh_CN') {
                        // 中文格式
                        if (this.selectMode || this.viewLevel === 'year' || this.viewLevel === 'month') {
                            // 跨度大：显示月日+星期 "11月05日 周二"
                            dayFolderName = `${String(m).padStart(2, '0')}月${String(d).padStart(2, '0')}日 ${tw(date.getDay())}`;
                        } else {
                            // 周视图：只显示日期+星期 "05日 周二"
                            dayFolderName = `${String(d).padStart(2, '0')}日 ${tw(date.getDay())}`;
                        }
                    } else {
                        // 英文格式
                        const monthNamesShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                        const dayOfWeekShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                        if (this.selectMode || this.viewLevel === 'year' || this.viewLevel === 'month') {
                            // 跨度大：显示月日+星期 "Nov 05 Mon"
                            dayFolderName = `${monthNamesShort[m - 1]} ${String(d).padStart(2, '0')} ${dayOfWeekShort[date.getDay()]}`;
                        } else {
                            // 周视图：只显示日期+星期 "05 Mon"
                            dayFolderName = `${String(d).padStart(2, '0')} ${dayOfWeekShort[date.getDay()]}`;
                        }
                    }
                    targetFolder = getOrCreateFolder(mainFolder, dayFolderName);
                }

                // 在目标文件夹下，重建原始目录结构
                bookmarks.forEach(bm => {
                    // 检查书签是否在导出范围内（用于hour类型过滤）
                    if (!this.checkBookmarkInScope(bm)) return;

                    const path = bm.folderPath || [];
                    const parentFolder = ensurePath(targetFolder, path);

                    parentFolder.children.push({
                        title: bm.title,
                        url: bm.url,
                        addDate: bm.dateAdded.getTime() / 1000,
                        type: 'bookmark'
                    });
                });
            }

        } else {
            // COLLECTION 和 CONTEXT 模式：先扁平化收集所有书签
            for (const dateKey of sortedDateKeys) {
                if (this.checkDateInScope(dateKey)) {
                    const bookmarks = this.bookmarksByDate.get(dateKey);
                    if (bookmarks && bookmarks.length > 0) { // 过滤空白日期
                        // 过滤出在范围内的书签（用于hour类型）
                        const filteredBookmarks = bookmarks.filter(bm => this.checkBookmarkInScope(bm));
                        if (filteredBookmarks.length > 0) {
                            allTargetBookmarks.push(...filteredBookmarks);
                        }
                    }
                }
            }

            if (allTargetBookmarks.length === 0) return root;

            if (mode === 'collection') {
                // COLLECTION 模式：按日期分组，扁平化放在日期文件夹下

                if (isSingleDayExport) {
                    // 单日导出：直接扁平化放在主文件夹下
                    allTargetBookmarks.forEach(bm => {
                        mainFolder.children.push({
                            title: bm.title,
                            url: bm.url,
                            addDate: bm.dateAdded.getTime() / 1000,
                            type: 'bookmark'
                        });
                    });
                } else {
                    // 多日导出：按日期创建子文件夹
                    const bookmarksByDate = new Map();
                    allTargetBookmarks.forEach(bm => {
                        const dateKey = this.getDateKey(bm.dateAdded);
                        if (!bookmarksByDate.has(dateKey)) {
                            bookmarksByDate.set(dateKey, []);
                        }
                        bookmarksByDate.get(dateKey).push(bm);
                    });

                    // 按日期排序
                    const sortedDates = [...bookmarksByDate.keys()].sort();

                    sortedDates.forEach(dateKey => {
                        const [y, m, d] = dateKey.split('-').map(Number);
                        const date = new Date(y, m - 1, d);
                        const bookmarks = bookmarksByDate.get(dateKey);

                        // 格式化日期文件夹名
                        let dayFolderName;
                        if (currentLang === 'zh_CN') {
                            if (this.selectMode || this.viewLevel === 'year' || this.viewLevel === 'month') {
                                dayFolderName = `${String(m).padStart(2, '0')}月${String(d).padStart(2, '0')}日 ${tw(date.getDay())}`;
                            } else {
                                dayFolderName = `${String(d).padStart(2, '0')}日 ${tw(date.getDay())}`;
                            }
                        } else {
                            const monthNamesShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                            const dayOfWeekShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                            if (this.selectMode || this.viewLevel === 'year' || this.viewLevel === 'month') {
                                dayFolderName = `${monthNamesShort[m - 1]} ${String(d).padStart(2, '0')} ${dayOfWeekShort[date.getDay()]}`;
                            } else {
                                dayFolderName = `${String(d).padStart(2, '0')} ${dayOfWeekShort[date.getDay()]}`;
                            }
                        }

                        const dayFolder = getOrCreateFolder(mainFolder, dayFolderName);

                        // 扁平化放入书签
                        bookmarks.forEach(bm => {
                            dayFolder.children.push({
                                title: bm.title,
                                url: bm.url,
                                addDate: bm.dateAdded.getTime() / 1000,
                                type: 'bookmark'
                            });
                        });
                    });
                }

            } else if (mode === 'context') {
                // CONTEXT 模式：按父文件夹分组，并包含兄弟节点
                const ids = allTargetBookmarks.map(bm => bm.id);
                const parentIds = new Set();

                const getBookmarks = (idList) => new Promise((resolve) => {
                    if (!chrome.bookmarks) { resolve([]); return; }
                    chrome.bookmarks.get(idList, (results) => {
                        if (chrome.runtime.lastError) {
                            console.warn(chrome.runtime.lastError);
                            resolve([]);
                        } else {
                            resolve(results);
                        }
                    });
                });

                // 批量获取书签以得到 parentId
                for (let i = 0; i < ids.length; i += 50) {
                    const chunk = ids.slice(i, i + 50);
                    const nodes = await getBookmarks(chunk);
                    nodes?.forEach(node => parentIds.add(node.parentId));
                }

                // 对每个父文件夹，获取其所有子节点（上下文）
                for (const parentId of parentIds) {
                    try {
                        const [folderNode] = await new Promise(r => chrome.bookmarks.get(parentId, r));
                        if (!folderNode) continue;

                        const children = await new Promise(r => chrome.bookmarks.getChildren(parentId, r));

                        // 创建文件夹节点
                        const folderObj = {
                            title: folderNode.title,
                            addDate: folderNode.dateAdded,
                            lastModified: folderNode.dateGroupModified,
                            type: 'folder',
                            children: children.map(child => {
                                if (child.url) {
                                    return {
                                        title: child.title,
                                        url: child.url,
                                        addDate: child.dateAdded,
                                        type: 'bookmark'
                                    };
                                } else {
                                    return {
                                        title: child.title,
                                        type: 'folder',
                                        children: []
                                    };
                                }
                            })
                        };
                        // 将文件夹加入到主文件夹下
                        mainFolder.children.push(folderObj);
                    } catch (e) {
                        console.warn('Error processing folder context:', e);
                    }
                }
            }
        }

        return root;
    }

    generateNetscapeHTML(root) {
        let html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
`;

        const processNode = (node) => {
            let chunk = '';
            if (node.type === 'bookmark') {
                chunk += `    <DT><A HREF="${node.url}" ADD_DATE="${Math.floor(node.addDate || 0)}">${this.escapeHtml(node.title)}</A>\n`;
            } else if (node.children) {
                if (node.title !== "Bookmark Export" && node.title !== "Root") {
                    chunk += `    <DT><H3 ADD_DATE="${Math.floor(node.addDate || 0)}" LAST_MODIFIED="${Math.floor(node.lastModified || 0)}">${this.escapeHtml(node.title)}</H3>\n`;
                }
                chunk += `    <DL><p>\n`;
                node.children.forEach(child => {
                    chunk += processNode(child);
                });
                chunk += `    </DL><p>\n`;
            }
            return chunk;
        };

        root.children.forEach(child => {
            html += processNode(child);
        });

        html += `</DL><p>`;
        return html;
    }

    escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    downloadFile(content, filename, type) {
        const blob = new Blob([content], { type: type });
        const url = URL.createObjectURL(blob);

        // 尝试使用 chrome.downloads API 以支持子目录
        if (chrome.downloads) {
            // 确定文件夹名称：中文环境下使用中文，否则使用英文
            const folderName = i18n.exportFolderName[currentLang] || 'Bookmark Records';

            chrome.downloads.download({
                url: url,
                filename: `${folderName}/${filename}`,
                saveAs: false,
                conflictAction: 'uniquify'
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    console.warn('chrome.downloads API failed, falling back to <a> tag:', chrome.runtime.lastError);
                    this._downloadFallback(url, filename);
                } else {
                    // 下载成功启动，延迟释放URL
                    setTimeout(() => URL.revokeObjectURL(url), 10000);
                }
            });
        } else {
            // 降级方案
            this._downloadFallback(url, filename);
        }
    }

    _downloadFallback(url, filename) {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
        } catch (err) {
            console.error('复制失败:', err);
            const textarea = document.createElement('textarea');
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        }
    }
}

// 初始化
window.initBookmarkCalendar = function () {
    if (window.bookmarkCalendarInstance) {
        window.bookmarkCalendarInstance.render();
        return;
    }

    window.bookmarkCalendarInstance = new BookmarkCalendar();
};

// 语言切换时更新日历翻译
window.updateBookmarkCalendarLanguage = function () {
    if (window.bookmarkCalendarInstance) {
        window.bookmarkCalendarInstance.render();
    }
};

// 自动初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => window.initBookmarkCalendar(), 500);
    });
} else {
    setTimeout(() => window.initBookmarkCalendar(), 500);
}
