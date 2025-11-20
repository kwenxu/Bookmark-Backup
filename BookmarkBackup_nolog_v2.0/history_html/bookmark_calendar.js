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
    // 获取星期几的翻译
    if (typeof i18n === 'undefined' || typeof currentLang === 'undefined') {
        return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][index];
    }
    return i18n.calendarWeekdays[currentLang][index] || '';
}

function tm(index) {
    // 获取月份名称的翻译 (0-11)
    if (typeof i18n === 'undefined' || typeof currentLang === 'undefined') {
        return ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'][index];
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

class BookmarkCalendar {
    constructor() {
        this.bookmarksByDate = new Map(); // { 'YYYY-MM-DD': [bookmarks] }
        this.currentYear = new Date().getFullYear();
        this.currentMonth = new Date().getMonth();
        this.currentWeekStart = null;
        this.currentDay = null;
        this.viewLevel = 'month'; // 默认月视图 'year' | 'month' | 'week' | 'day'
        
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
        
        // 跳转到最近有书签的月份
        this.jumpToRecentBookmarks();
        
        // 预热favicon缓存
        this.preloadFavicons();
        
        this.setupBreadcrumb();
        this.render();
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

    parseBookmarks(node) {
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
                dateAdded: date
            });
        }
        
        if (node.children) {
            node.children.forEach(child => this.parseBookmarks(child));
        }
    }

    getDateKey(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    getWeekNumber(date) {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + 4 - (d.getDay() || 7));
        const yearStart = new Date(d.getFullYear(), 0, 1);
        return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    }

    jumpToRecentBookmarks() {
        // 默认显示当前日期
        const today = new Date();
        this.currentYear = today.getFullYear();
        this.currentMonth = today.getMonth();
        this.currentDay = today;
        
        // 计算当前周的开始日期（周日为第一天）
        this.currentWeekStart = new Date(today);
        this.currentWeekStart.setDate(today.getDate() - today.getDay());
        
        console.log('[BookmarkCalendar] 默认显示当月当天:', this.currentYear, '年', this.currentMonth + 1, '月');
    }

    // ========== 面包屑导航 ==========
    
    setupBreadcrumb() {
        document.getElementById('breadcrumbYear')?.addEventListener('click', () => this.navigateToYear());
        document.getElementById('breadcrumbMonth')?.addEventListener('click', () => this.navigateToMonth());
        document.getElementById('breadcrumbWeek')?.addEventListener('click', () => this.navigateToWeek());
    }

    updateBreadcrumb() {
        // 年
        document.getElementById('breadcrumbYearText').textContent = t('calendarYear', this.currentYear);
        
        // 月
        const monthBtn = document.getElementById('breadcrumbMonth');
        const sep1 = document.getElementById('separator1');
        if (this.viewLevel === 'month' || this.viewLevel === 'week' || this.viewLevel === 'day') {
            monthBtn.style.display = 'block';
            sep1.style.display = 'inline';
            document.getElementById('breadcrumbMonthText').textContent = tm(this.currentMonth);
            monthBtn.classList.toggle('active', this.viewLevel === 'month');
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
        } else {
            dayBtn.style.display = 'none';
            sep3.style.display = 'none';
        }
        
        document.getElementById('breadcrumbYear').classList.toggle('active', this.viewLevel === 'year');
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
                break;
            case 'week':
                this.renderWeekView(container);
                break;
            case 'day':
                this.renderDayView(container);
                break;
        }
        
        this.updateBreadcrumb();
    }

    // ========== 月视图（默认） ==========
    
    renderMonthView(container) {
        const wrapper = document.createElement('div');
        wrapper.style.padding = '20px';
        
        // 上方：周数 + 日历
        const topSection = document.createElement('div');
        topSection.style.display = 'flex';
        topSection.style.gap = '20px';
        
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
        column.style.minWidth = '50px';
        column.style.borderRight = '1px solid var(--border-color)';
        column.style.paddingRight = '10px';
        
        const header = document.createElement('div');
        header.style.height = '40px';
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'center';
        header.style.fontSize = '12px';
        header.style.color = 'var(--text-tertiary)';
        header.textContent = t('calendarWeekLabel');
        column.appendChild(header);
        
        const firstDay = new Date(this.currentYear, this.currentMonth, 1);
        const lastDay = new Date(this.currentYear, this.currentMonth + 1, 0);
        
        // 计算需要显示的周数行
        const startDayOfWeek = firstDay.getDay();
        const daysInMonth = lastDay.getDate();
        const totalCells = startDayOfWeek + daysInMonth;
        const numRows = Math.ceil(totalCells / 7);
        
        let currentWeekStart = new Date(firstDay);
        currentWeekStart.setDate(firstDay.getDate() - startDayOfWeek);
        
        // 为每一行创建周数
        for (let row = 0; row < numRows; row++) {
            const weekNum = this.getWeekNumber(currentWeekStart);
            const weekStartCopy = new Date(currentWeekStart);
            
            const weekDiv = document.createElement('div');
            // 高度计算：(日历单元格宽度 + gap) 使其与日历行对齐
            weekDiv.style.height = 'calc((100% - 40px - ' + (numRows - 1) * 10 + 'px) / ' + numRows + ')';
            weekDiv.style.minHeight = '60px';
            weekDiv.style.display = 'flex';
            weekDiv.style.alignItems = 'center';
            weekDiv.style.justifyContent = 'center';
            weekDiv.style.cursor = 'pointer';
            weekDiv.style.borderRadius = '6px';
            weekDiv.style.transition = 'all 0.2s';
            weekDiv.style.fontSize = '14px';
            weekDiv.style.fontWeight = '500';
            weekDiv.textContent = weekNum;
            
            weekDiv.addEventListener('click', () => {
                this.currentWeekStart = weekStartCopy;
                this.viewLevel = 'week';
                this.render();
            });
            
            weekDiv.addEventListener('mouseenter', () => {
                weekDiv.style.background = 'var(--bg-secondary)';
            });
            
            weekDiv.addEventListener('mouseleave', () => {
                weekDiv.style.background = 'transparent';
            });
            
            column.appendChild(weekDiv);
            currentWeekStart.setDate(currentWeekStart.getDate() + 7);
        }
        
        return column;
    }

    createMonthCalendar() {
        const wrapper = document.createElement('div');
        wrapper.style.flex = '1';
        
        // 导航
        const header = document.createElement('div');
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
        
        // 日历网格
        const grid = document.createElement('div');
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(7, 1fr)';
        grid.style.gap = '10px';
        
        // 星期标题
        for (let i = 0; i < 7; i++) {
            const weekday = document.createElement('div');
            weekday.style.textAlign = 'center';
            weekday.style.fontWeight = '600';
            weekday.style.color = 'var(--text-secondary)';
            weekday.style.padding = '8px 0';
            weekday.textContent = tw(i);
            grid.appendChild(weekday);
        }
        
        // 空白格
        const firstDay = new Date(this.currentYear, this.currentMonth, 1);
        for (let i = 0; i < firstDay.getDay(); i++) {
            grid.appendChild(document.createElement('div'));
        }
        
        // 天数
        const daysInMonth = new Date(this.currentYear, this.currentMonth + 1, 0).getDate();
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(this.currentYear, this.currentMonth, day);
            const dateKey = this.getDateKey(date);
            const bookmarks = this.bookmarksByDate.get(dateKey) || [];
            
            const dayCell = document.createElement('div');
            dayCell.style.aspectRatio = '1';
            dayCell.style.border = '1px solid var(--border-color)';
            dayCell.style.borderRadius = '8px';
            dayCell.style.padding = '8px';
            dayCell.style.cursor = bookmarks.length > 0 ? 'pointer' : 'default';
            dayCell.style.background = bookmarks.length > 0 ? 'var(--bg-secondary)' : 'var(--bg-primary)';
            dayCell.style.transition = 'all 0.2s';
            
            dayCell.innerHTML = `
                <div style="font-weight: 600;">${day}</div>
                ${bookmarks.length > 0 ? `<div style="font-size: 12px; color: var(--accent-primary); margin-top: 4px;">${t('calendarBookmarkCount', bookmarks.length)}</div>` : ''}
            `;
            
            if (bookmarks.length > 0) {
                dayCell.addEventListener('click', () => {
                    this.currentDay = date;
                    this.viewLevel = 'day';
                    this.render();
                });
                
                dayCell.addEventListener('mouseenter', () => {
                    dayCell.style.transform = 'scale(1.05)';
                });
                
                dayCell.addEventListener('mouseleave', () => {
                    dayCell.style.transform = 'scale(1)';
                });
            }
            
            grid.appendChild(dayCell);
        }
        
        wrapper.appendChild(grid);
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
            
            if (bookmarks.length > 0) {
                const weekNum = this.getWeekNumber(date);
                if (!bookmarksByWeek.has(weekNum)) {
                    bookmarksByWeek.set(weekNum, []);
                }
                bookmarksByWeek.get(weekNum).push({ date, bookmarks });
                totalCount += bookmarks.length;
            }
        }
        
        if (totalCount === 0) {
            section.innerHTML = `<p style="text-align:center;color:var(--text-secondary);">${t('calendarNoBookmarksThisMonth')}</p>`;
            return section;
        }
        
        const title = document.createElement('h3');
        title.style.marginBottom = '20px';
        title.textContent = t('calendarTotalThisMonth', totalCount);
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
        
        // 默认选中第一周的第一天
        const firstWeekData = bookmarksByWeek.get(sortedWeeks[0]);
        let selectedDateKey = this.getDateKey(firstWeekData[0].date);
        
        sortedWeeks.forEach((weekNum, weekIndex) => {
            const weekData = bookmarksByWeek.get(weekNum);
            const weekCount = weekData.reduce((sum, item) => sum + item.bookmarks.length, 0);
            
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
            weekHeader.dataset.expanded = weekIndex === 0 ? 'true' : 'false';
            
            weekHeader.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span>
                        <i class="fas fa-chevron-${weekIndex === 0 ? 'down' : 'right'}" style="font-size:12px;margin-right:6px;"></i>
                        <i class="fas fa-calendar-week"></i> ${t('calendarWeek', weekNum)}
                    </span>
                    <span style="font-size:12px;opacity:0.8;">${t('calendarBookmarkCount', weekCount)}</span>
                </div>
            `;
            
            // 日期子菜单容器
            const daysContainer = document.createElement('div');
            daysContainer.style.marginLeft = '12px';
            daysContainer.style.marginTop = '4px';
            daysContainer.style.display = weekIndex === 0 ? 'block' : 'none';
            daysContainer.dataset.weekNum = weekNum;
            
            // 为每一天创建菜单项
            weekData.forEach(({ date, bookmarks }, dayIndex) => {
                const dateKey = this.getDateKey(date);
                
                const dayMenuItem = document.createElement('div');
                dayMenuItem.style.padding = '8px 12px';
                dayMenuItem.style.marginBottom = '4px';
                dayMenuItem.style.borderRadius = '6px';
                dayMenuItem.style.cursor = 'pointer';
                dayMenuItem.style.transition = 'all 0.2s';
                dayMenuItem.style.fontSize = '13px';
                dayMenuItem.dataset.dateKey = dateKey;
                
                // 第一周的第一天默认选中
                if (weekIndex === 0 && dayIndex === 0) {
                    dayMenuItem.style.background = 'rgba(33, 150, 243, 0.15)';
                    dayMenuItem.style.color = 'var(--accent-primary)';
                    dayMenuItem.style.fontWeight = '600';
                    dayMenuItem.style.border = '1px solid var(--accent-primary)';
                } else {
                    dayMenuItem.style.background = 'transparent';
                    dayMenuItem.style.color = 'var(--text-primary)';
                    dayMenuItem.style.border = '1px solid transparent';
                }
                
                dayMenuItem.innerHTML = `
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span>${tw(date.getDay())} ${date.getMonth() + 1}/${date.getDate()}</span>
                        <span style="font-size:12px;opacity:0.8;">${t('calendarBookmarkCount', bookmarks.length)}</span>
                    </div>
                `;
                
                dayMenuItem.addEventListener('click', (e) => {
                    e.stopPropagation();
                    
                    // 更新所有日期菜单的选中状态
                    sidebar.querySelectorAll('div[data-date-key]').forEach(item => {
                        item.style.background = 'transparent';
                        item.style.color = 'var(--text-primary)';
                        item.style.fontWeight = 'normal';
                        item.style.border = '1px solid transparent';
                    });
                    
                    dayMenuItem.style.background = 'rgba(33, 150, 243, 0.15)';
                    dayMenuItem.style.color = 'var(--accent-primary)';
                    dayMenuItem.style.fontWeight = '600';
                    dayMenuItem.style.border = '1px solid var(--accent-primary)';
                    
                    selectedDateKey = dateKey;
                    renderDayContent(date, bookmarks);
                });
                
                dayMenuItem.addEventListener('mouseenter', () => {
                    if (dayMenuItem.dataset.dateKey !== selectedDateKey) {
                        dayMenuItem.style.background = 'rgba(128, 128, 128, 0.1)';
                        dayMenuItem.style.border = '1px solid var(--border-color)';
                    }
                });
                
                dayMenuItem.addEventListener('mouseleave', () => {
                    if (dayMenuItem.dataset.dateKey !== selectedDateKey) {
                        dayMenuItem.style.background = 'transparent';
                        dayMenuItem.style.border = '1px solid transparent';
                    }
                });
                
                daysContainer.appendChild(dayMenuItem);
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
                weekHeader.style.borderLeft = '3px solid var(--accent-primary)';
            });
            
            weekHeader.addEventListener('mouseleave', () => {
                weekHeader.style.background = 'var(--bg-secondary)';
                weekHeader.style.borderLeft = '3px solid transparent';
            });
            
            weekMenuContainer.appendChild(weekHeader);
            weekMenuContainer.appendChild(daysContainer);
            sidebar.appendChild(weekMenuContainer);
        });
        
        // 渲染右侧内容 - 显示某一天的书签
        const renderDayContent = (date, bookmarks, wd = weekdays) => {
            contentArea.innerHTML = '';
            
            const dayHeader = document.createElement('div');
            dayHeader.style.fontSize = '18px';
            dayHeader.style.fontWeight = '700';
            dayHeader.style.color = 'var(--text-primary)';
            dayHeader.style.marginBottom = '20px';
            dayHeader.style.paddingBottom = '12px';
            dayHeader.style.borderBottom = '2px solid var(--accent-primary)';
            dayHeader.style.display = 'flex';
            dayHeader.style.justifyContent = 'space-between';
            dayHeader.style.alignItems = 'center';
            
            dayHeader.innerHTML = `
                <span><i class="fas fa-calendar-day"></i> ${tw(date.getDay())} ${t('calendarMonthDay', date.getMonth() + 1, date.getDate())}</span>
                <span style="font-size:14px;color:var(--text-secondary);">${t('calendarBookmarksCount', bookmarks.length)}</span>
            `;
            
            contentArea.appendChild(dayHeader);
            
            // 使用折叠功能
            const bookmarkList = this.createCollapsibleBookmarkList(bookmarks);
            contentArea.appendChild(bookmarkList);
        };
        
        // 渲染右侧内容 - 显示某周的所有书签（按日分组）
        const renderWeekContent = (weekNum, weekData) => {
            contentArea.innerHTML = '';
            
            const weekHeader = document.createElement('div');
            weekHeader.style.fontSize = '18px';
            weekHeader.style.fontWeight = '700';
            weekHeader.style.color = 'var(--text-primary)';
            weekHeader.style.marginBottom = '20px';
            weekHeader.style.paddingBottom = '12px';
            weekHeader.style.borderBottom = '2px solid var(--accent-primary)';
            weekHeader.style.display = 'flex';
            weekHeader.style.justifyContent = 'space-between';
            weekHeader.style.alignItems = 'center';
            
            const totalCount = weekData.reduce((sum, item) => sum + item.bookmarks.length, 0);
            
            weekHeader.innerHTML = `
                <span><i class="fas fa-calendar-week"></i> ${t('calendarWeek', weekNum)}</span>
                <span style="font-size:14px;color:var(--text-secondary);">${t('calendarBookmarksCount', totalCount)}</span>
            `;
            
            contentArea.appendChild(weekHeader);
            
            // 按日显示
            weekData.forEach(({ date, bookmarks }) => {
                const daySection = document.createElement('div');
                daySection.style.marginBottom = '24px';
                
                const dayTitle = document.createElement('div');
                dayTitle.style.fontSize = '15px';
                dayTitle.style.fontWeight = '600';
                dayTitle.style.color = 'var(--accent-primary)';
                dayTitle.style.marginBottom = '12px';
                dayTitle.style.paddingBottom = '8px';
                dayTitle.style.borderBottom = '1px solid var(--accent-primary)';
                dayTitle.innerHTML = `<i class="fas fa-calendar-day"></i> ${tw(date.getDay())} ${t('calendarMonthDay', date.getMonth() + 1, date.getDate())} (${t('calendarBookmarkCount', bookmarks.length)})`;
                
                daySection.appendChild(dayTitle);
                
                const bookmarkList = this.createCollapsibleBookmarkList(bookmarks);
                daySection.appendChild(bookmarkList);
                
                contentArea.appendChild(daySection);
            });
        };
        
        // 初始显示第一周的所有内容
        renderWeekContent(sortedWeeks[0], firstWeekData);
        
        panelContainer.appendChild(sidebar);
        panelContainer.appendChild(contentArea);
        section.appendChild(panelContainer);
        
        return section;
    }

    createBookmarkItem(bookmark) {
        const item = document.createElement('div');
        item.style.display = 'flex';
        item.style.alignItems = 'flex-start';
        item.style.gap = '12px';
        item.style.padding = '10px';
        item.style.border = '1px solid var(--border-color)';
        item.style.borderRadius = '6px';
        item.style.marginBottom = '8px';
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
        faviconImg.style.marginTop = '2px';
        faviconImg.style.flexShrink = '0';
        faviconImg.alt = '';
        
        // 使用全局的 getFaviconUrl 函数（如果存在）
        if (typeof getFaviconUrl === 'function') {
            faviconImg.src = getFaviconUrl(bookmark.url);
        } else {
            // 降级方案
            faviconImg.src = `chrome://favicon/${bookmark.url}`;
        }
        
        item.appendChild(faviconImg);
        
        // 信息区域
        const infoDiv = document.createElement('div');
        infoDiv.style.flex = '1';
        infoDiv.style.minWidth = '0';
        infoDiv.innerHTML = `
            <div style="font-size:14px;font-weight:500;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                ${this.escapeHtml(bookmark.title)}
            </div>
            <div style="font-size:12px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                ${this.escapeHtml(bookmark.url)}
            </div>
        `;
        item.appendChild(infoDiv);
        
        // 时间区域
        const timeDiv = document.createElement('div');
        timeDiv.style.fontSize = '12px';
        timeDiv.style.color = 'var(--text-tertiary)';
        timeDiv.style.whiteSpace = 'nowrap';
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
            item.style.background = 'var(--bg-secondary)';
            item.style.borderColor = 'var(--accent-primary)';
        });
        
        item.addEventListener('mouseleave', () => {
            item.style.background = 'transparent';
            item.style.borderColor = 'var(--border-color)';
        });
        
        return item;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // 创建可折叠的书签列表
    createCollapsibleBookmarkList(bookmarks, containerId) {
        const container = document.createElement('div');
        const COLLAPSE_THRESHOLD = 10; // 超过10个就折叠
        
        if (bookmarks.length === 0) return container;
        
        const shouldCollapse = bookmarks.length > COLLAPSE_THRESHOLD;
        const initialShowCount = shouldCollapse ? COLLAPSE_THRESHOLD : bookmarks.length;
        
        // 显示初始的书签
        for (let i = 0; i < initialShowCount; i++) {
            container.appendChild(this.createBookmarkItem(bookmarks[i]));
        }
        
        // 如果需要折叠，添加隐藏的书签和展开按钮
        if (shouldCollapse) {
            const hiddenContainer = document.createElement('div');
            hiddenContainer.style.display = 'none';
            hiddenContainer.dataset.collapsed = 'true';
            
            for (let i = COLLAPSE_THRESHOLD; i < bookmarks.length; i++) {
                hiddenContainer.appendChild(this.createBookmarkItem(bookmarks[i]));
            }
            
            container.appendChild(hiddenContainer);
            
            // 展开/收起按钮
            const toggleBtn = document.createElement('button');
            toggleBtn.style.width = '100%';
            toggleBtn.style.padding = '8px';
            toggleBtn.style.marginTop = '8px';
            toggleBtn.style.border = '1px dashed var(--border-color)';
            toggleBtn.style.borderRadius = '6px';
            toggleBtn.style.background = 'transparent';
            toggleBtn.style.color = 'var(--accent-primary)';
            toggleBtn.style.cursor = 'pointer';
            toggleBtn.style.fontSize = '13px';
            toggleBtn.style.transition = 'all 0.2s';
            toggleBtn.innerHTML = `<i class="fas fa-chevron-down"></i> ${t('calendarExpandMore', bookmarks.length - COLLAPSE_THRESHOLD)}`;
            
            toggleBtn.addEventListener('click', () => {
                const isCollapsed = hiddenContainer.dataset.collapsed === 'true';
                if (isCollapsed) {
                    hiddenContainer.style.display = 'block';
                    hiddenContainer.dataset.collapsed = 'false';
                    toggleBtn.innerHTML = `<i class="fas fa-chevron-up"></i> ${t('calendarCollapse')}`;
                } else {
                    hiddenContainer.style.display = 'none';
                    hiddenContainer.dataset.collapsed = 'true';
                    toggleBtn.innerHTML = `<i class="fas fa-chevron-down"></i> ${t('calendarExpandMore', bookmarks.length - COLLAPSE_THRESHOLD)}`;
                }
            });
            
            toggleBtn.addEventListener('mouseenter', () => {
                toggleBtn.style.background = 'var(--bg-secondary)';
                toggleBtn.style.borderColor = 'var(--accent-primary)';
            });
            
            toggleBtn.addEventListener('mouseleave', () => {
                toggleBtn.style.background = 'transparent';
                toggleBtn.style.borderColor = 'var(--border-color)';
            });
            
            container.appendChild(toggleBtn);
        }
        
        return container;
    }

    // ========== 周视图 ==========
    
    renderWeekView(container) {
        const wrapper = document.createElement('div');
        wrapper.style.padding = '20px';
        
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
        
        for (let i = 0; i < 7; i++) {
            const date = new Date(this.currentWeekStart);
            date.setDate(this.currentWeekStart.getDate() + i);
            const dateKey = this.getDateKey(date);
            const bookmarks = this.bookmarksByDate.get(dateKey) || [];
            
            if (bookmarks.length > 0) allBookmarks.push({ date, bookmarks });
            
            const dayCard = document.createElement('div');
            dayCard.className = 'week-day-card';
            dayCard.innerHTML = `
                <div class="week-day-header">
                    <div class="week-day-name">${tw(i)}</div>
                    <div class="week-day-date">${date.getDate()}</div>
                </div>
                <div class="week-day-count">${t('calendarBookmarkCount', bookmarks.length)}</div>
            `;
            
            if (bookmarks.length > 0) {
                dayCard.addEventListener('click', () => {
                    this.currentDay = date;
                    this.viewLevel = 'day';
                    this.render();
                });
            }
            
            weekContainer.appendChild(dayCard);
        }
        
        wrapper.appendChild(weekContainer);
        
        if (allBookmarks.length > 0) {
            const section = document.createElement('div');
            section.style.marginTop = '40px';
            const totalCount = allBookmarks.reduce((sum, item) => sum + item.bookmarks.length, 0);
            
            const title = document.createElement('h3');
            title.style.marginBottom = '20px';
            title.textContent = t('calendarTotalThisWeek', totalCount);
            section.appendChild(title);
            
            // 左右分栏布局
            const panelContainer = document.createElement('div');
            panelContainer.style.display = 'flex';
            panelContainer.style.gap = '20px';
            panelContainer.style.minHeight = '400px';
            
            // 左侧菜单栏
            const sidebar = document.createElement('div');
            sidebar.style.width = '180px';
            sidebar.style.flexShrink = '0';
            sidebar.style.borderRight = '1px solid var(--border-color)';
            sidebar.style.paddingRight = '20px';
            
            // 右侧内容区
            const contentArea = document.createElement('div');
            contentArea.style.flex = '1';
            contentArea.style.minWidth = '0';
            
            // 默认选中第一天
            let selectedDateKey = this.getDateKey(allBookmarks[0].date);
            
            allBookmarks.forEach(({ date, bookmarks }, index) => {
                const dateKey = this.getDateKey(date);
                
                // 左侧菜单项
                const menuItem = document.createElement('div');
                menuItem.style.padding = '12px';
                menuItem.style.marginBottom = '8px';
                menuItem.style.borderRadius = '8px';
                menuItem.style.cursor = 'pointer';
                menuItem.style.transition = 'all 0.2s';
                menuItem.style.fontSize = '14px';
                menuItem.dataset.dateKey = dateKey;
                
                if (index === 0) {
                    menuItem.style.background = 'var(--accent-primary)';
                    menuItem.style.color = 'white';
                    menuItem.style.fontWeight = '600';
                } else {
                    menuItem.style.background = 'transparent';
                    menuItem.style.color = 'var(--text-primary)';
                }
                
                menuItem.innerHTML = `
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        <div style="font-size:13px;opacity:0.9;">${weekdays[date.getDay()]}</div>
                        <div style="font-weight:600;">${date.getMonth() + 1}/${date.getDate()}</div>
                        <div style="font-size:12px;opacity:0.8;">${bookmarks.length}个</div>
                    </div>
                `;
                
                menuItem.addEventListener('click', () => {
                    // 更新选中状态
                    sidebar.querySelectorAll('div[data-date-key]').forEach(item => {
                        item.style.background = 'transparent';
                        item.style.color = 'var(--text-primary)';
                        item.style.fontWeight = 'normal';
                    });
                    menuItem.style.background = 'var(--accent-primary)';
                    menuItem.style.color = 'white';
                    menuItem.style.fontWeight = '600';
                    
                    // 显示对应天的内容
                    selectedDateKey = dateKey;
                    renderDayContent(date, bookmarks);
                });
                
                menuItem.addEventListener('mouseenter', () => {
                    if (menuItem.dataset.dateKey !== selectedDateKey) {
                        menuItem.style.background = 'var(--bg-secondary)';
                    }
                });
                
                menuItem.addEventListener('mouseleave', () => {
                    if (menuItem.dataset.dateKey !== selectedDateKey) {
                        menuItem.style.background = 'transparent';
                    }
                });
                
                sidebar.appendChild(menuItem);
            });
            
            // 渲染右侧内容
            const renderDayContent = (date, bookmarks) => {
                contentArea.innerHTML = '';
                
                const dayHeader = document.createElement('div');
                dayHeader.style.fontSize = '18px';
                dayHeader.style.fontWeight = '700';
                dayHeader.style.color = 'var(--text-primary)';
                dayHeader.style.marginBottom = '20px';
                dayHeader.style.paddingBottom = '12px';
                dayHeader.style.borderBottom = '2px solid var(--accent-primary)';
                dayHeader.innerHTML = `<i class="fas fa-calendar-day"></i> ${tw(date.getDay())} ${t('calendarMonthDay', date.getMonth() + 1, date.getDate())}`;
                
                contentArea.appendChild(dayHeader);
                
                // 使用折叠功能
                const bookmarkList = this.createCollapsibleBookmarkList(bookmarks);
                contentArea.appendChild(bookmarkList);
            };
            
            // 初始显示第一天
            renderDayContent(allBookmarks[0].date, allBookmarks[0].bookmarks);
            
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
        
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.marginBottom = '20px';
        header.innerHTML = `
            <button class="calendar-nav-btn" id="prevDay"><i class="fas fa-chevron-left"></i></button>
            <div style="font-size:18px;font-weight:600;">${t('calendarYearMonthDay', this.currentDay.getFullYear(), this.currentDay.getMonth() + 1, this.currentDay.getDate())}</div>
            <button class="calendar-nav-btn" id="nextDay"><i class="fas fa-chevron-right"></i></button>
        `;
        wrapper.appendChild(header);
        
        header.querySelector('#prevDay').addEventListener('click', () => {
            this.currentDay.setDate(this.currentDay.getDate() - 1);
            this.render();
        });
        
        header.querySelector('#nextDay').addEventListener('click', () => {
            this.currentDay.setDate(this.currentDay.getDate() + 1);
            this.render();
        });
        
        const dateKey = this.getDateKey(this.currentDay);
        const bookmarks = this.bookmarksByDate.get(dateKey) || [];
        
        if (bookmarks.length === 0) {
            wrapper.innerHTML += `<div class="calendar-empty-state"><i class="fas fa-calendar-day"></i><p>${t('calendarNoBookmarksThisDay')}</p></div>`;
            container.appendChild(wrapper);
            return;
        }
        
        const byHour = new Map();
        bookmarks.forEach(bm => {
            const hour = bm.dateAdded.getHours();
            if (!byHour.has(hour)) byHour.set(hour, []);
            byHour.get(hour).push(bm);
        });
        
        wrapper.innerHTML += `<h3 style="margin-bottom:20px;">${t('calendarTotalThisDay', bookmarks.length)}</h3>`;
        
        for (let hour = 0; hour < 24; hour++) {
            const hourBookmarks = byHour.get(hour);
            if (!hourBookmarks) continue;
            
            const hourSection = document.createElement('div');
            hourSection.style.marginBottom = '24px';
            hourSection.innerHTML = `<div class="bookmarks-group-title">${String(hour).padStart(2, '0')}:00 - ${String(hour).padStart(2, '0')}:59 (${hourBookmarks.length}个)</div>`;
            hourBookmarks.sort((a, b) => a.dateAdded - b.dateAdded);
            
            // 使用折叠功能
            const bookmarkList = this.createCollapsibleBookmarkList(hourBookmarks);
            hourSection.appendChild(bookmarkList);
            
            wrapper.appendChild(hourSection);
        }
        
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
}

// 初始化
window.initBookmarkCalendar = function() {
    if (window.bookmarkCalendarInstance) {
        window.bookmarkCalendarInstance.render();
        return;
    }
    
    window.bookmarkCalendarInstance = new BookmarkCalendar();
};

// 语言切换时更新日历翻译
window.updateBookmarkCalendarLanguage = function() {
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
