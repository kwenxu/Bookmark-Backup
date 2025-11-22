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
        return ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][index];
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
        
        // 设置下拉菜单功能
        this.setupDropdownMenus();
    }
    
    setupDropdownMenus() {
        // 为所有下拉触发器添加点击事件
        const triggers = document.querySelectorAll('.breadcrumb-dropdown-trigger');
        triggers.forEach(trigger => {
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const targetId = trigger.getAttribute('data-target');
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
        } else {
            btn?.classList.remove('active');
            this.selectedDates.clear(); // 退出勾选模式时清空选择
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
        column.style.display = 'flex';
        column.style.flexDirection = 'column';
        
        // 占位：与右侧月份导航对齐
        const navPlaceholder = document.createElement('div');
        navPlaceholder.style.display = 'flex';
        navPlaceholder.style.alignItems = 'center';
        navPlaceholder.style.justifyContent = 'center';
        navPlaceholder.style.marginBottom = '20px';
        navPlaceholder.style.minHeight = '40px'; // 匹配导航按钮的高度
        column.appendChild(navPlaceholder);
        
        // 周标签：与右侧星期标题对齐
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'center';
        header.style.fontSize = '12px';
        header.style.color = 'var(--text-tertiary)';
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
        weeksContainer.style.display = 'grid';
        weeksContainer.style.gridTemplateRows = `repeat(${numRows}, 1fr)`;
        weeksContainer.style.gap = '10px';
        weeksContainer.style.flex = '1';
        
        // 为每一行创建周数
        for (let row = 0; row < numRows; row++) {
            const weekNum = this.getWeekNumber(weekMonday);
            const weekMondayCopy = new Date(weekMonday);
            
            const weekDiv = document.createElement('div');
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
        
        // 获取一周开始日(中文:周一=1, 英文:周日=0)
        const weekStartDay = (typeof currentLang !== 'undefined' && currentLang === 'zh_CN') ? 1 : 0;
        
        // 星期标题行（独立于日历网格）
        const weekdayHeader = document.createElement('div');
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
            
            dayCell.addEventListener('click', () => {
                if (this.selectMode) {
                    // 勾选模式：切换选中状态
                    if (this.selectedDates.has(dateKey)) {
                        this.selectedDates.delete(dateKey);
                    } else {
                        this.selectedDates.add(dateKey);
                    }
                    this.render();
                } else if (bookmarks.length > 0) {
                    // 普通模式：进入日视图
                    this.currentDay = date;
                    // 更新currentWeekStart为该日期所在周的周一(ISO 8601标准)
                    const dateDay = date.getDay() || 7;
                    this.currentWeekStart = new Date(date);
                    this.currentWeekStart.setDate(date.getDate() - dateDay + 1);
                    this.viewLevel = 'day';
                    this.render();
                }
            });
            
            if (!this.selectMode && bookmarks.length > 0) {
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
        
        if (totalCount === 0) {
            const emptyText = this.selectMode ? (currentLang === 'en' ? 'No selected dates with bookmarks' : '未选中包含书签的日期') : t('calendarNoBookmarksThisMonth');
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
        
        // 判断是否是当前月（决定默认显示模式）
        const now = new Date();
        const isCurrentMonth = (this.currentYear === now.getFullYear() && this.currentMonth === now.getMonth());
        const shouldShowAllByDefault = !this.selectMode && !isCurrentMonth;
        
        // 默认选中第一周的第一天
        const firstWeekData = bookmarksByWeek.get(sortedWeeks[0]);
        let selectedDateKey = this.getDateKey(firstWeekData[0].date);
        
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
                    const hours = Object.keys(hourGroups).map(Number).sort((a, b) => a - b);
                    
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
            
            dayHeader.innerHTML = `
                <span><i class="fas fa-calendar-day"></i> ${tw(date.getDay())} ${t('calendarMonthDay', date.getMonth() + 1, date.getDate())}${isDayToday ? ` <span style="color: ${todayColor};">(${currentLang === 'en' ? 'Today' : '今天'})</span>` : ''}</span>
                <span style="font-size:14px;color:var(--text-secondary);">${t('calendarBookmarksCount', bookmarks.length)}</span>
            `;
            
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
            
            hourHeader.innerHTML = `
                <span>
                    <i class="fas fa-calendar-day"></i> ${tw(date.getDay())} ${t('calendarMonthDay', date.getMonth() + 1, date.getDate())}${isDayToday ? ` <span style="color: ${todayColor};">(${currentLang === 'en' ? 'Today' : '今天'})</span>` : ''}
                    <span style="margin-left:12px;">${String(hour).padStart(2, '0')}:00-${String(hour).padStart(2, '0')}:59</span>
                </span>
                <span style="font-size:14px;color:var(--text-secondary);">${t('calendarBookmarksCount', hourBookmarks.length)}</span>
            `;
            
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
            
            weekHeader.innerHTML = `
                <span><i class="fas fa-calendar-week"></i> ${t('calendarWeek', weekNum)}</span>
                <span style="font-size:14px;color:var(--text-secondary);">${t('calendarBookmarksCount', totalCount)}</span>
            `;
            
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
            
            allHeader.innerHTML = `
                <span><i class="fas ${headerIcon}"></i> ${headerText}</span>
                <span style="font-size:14px;color:var(--text-secondary);">${t('calendarBookmarksCount', totalCount)}</span>
            `;
            
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
                    dayTitle.style.color = 'var(--text-primary)';
                    dayTitle.style.marginBottom = '12px';
                    dayTitle.style.paddingLeft = '8px';
                    dayTitle.style.borderLeft = `3px solid ${themeColor}`;
                    dayTitle.innerHTML = `${twFull(date.getDay())}, ${t('calendarMonthDay', date.getMonth() + 1, date.getDate())}${isDayToday ? ` <span style="color: ${todayColor};">(${currentLang === 'en' ? 'Today' : '今天'})</span>` : ''} - ${t('calendarBookmarkCount', bookmarks.length)}`;
                    daySection.appendChild(dayTitle);
                    
                    bookmarks.sort((a, b) => a.dateAdded - b.dateAdded);
                    const bookmarkList = this.createCollapsibleBookmarkList(bookmarks);
                    daySection.appendChild(bookmarkList);
                    
                    weekSection.appendChild(daySection);
                });
                
                contentArea.appendChild(weekSection);
            });
        };
        
        // 初始显示逻辑
        if (this.selectMode) {
            // 勾选模式：显示所有选中的
            renderAllContent();
        } else if (shouldShowAllByDefault) {
            // 普通模式 + 非当前月：显示All模式
            allMenuItem.style.background = 'rgba(33, 150, 243, 0.15)';
            allMenuItem.style.color = 'var(--accent-primary)';
            allMenuItem.style.fontWeight = '600';
            allMenuItem.style.border = '1px solid var(--accent-primary)';
            renderAllContent();
        } else {
            // 普通模式 + 当前月：显示第一周
            renderWeekContent(sortedWeeks[0], firstWeekData);
        }
        
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
            const borderColor = this.selectMode ? '#4CAF50' : 'var(--accent-primary)';
            item.style.background = 'var(--bg-secondary)';
            item.style.borderColor = borderColor;
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
            const btnColor = this.selectMode ? '#4CAF50' : 'var(--accent-primary)';
            toggleBtn.style.borderRadius = '6px';
            toggleBtn.style.background = 'transparent';
            toggleBtn.style.color = btnColor;
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
                const hoverColor = this.selectMode ? '#4CAF50' : 'var(--accent-primary)';
                toggleBtn.style.background = 'var(--bg-secondary)';
                toggleBtn.style.borderColor = hoverColor;
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
            
            dayCard.addEventListener('click', () => {
                if (this.selectMode) {
                    // 勾选模式：切换选中状态
                    if (this.selectedDates.has(dateKey)) {
                        this.selectedDates.delete(dateKey);
                    } else {
                        this.selectedDates.add(dateKey);
                    }
                    this.render();
                } else if (bookmarks.length > 0) {
                    // 普通模式：进入日视图
                    this.currentDay = date;
                    // currentWeekStart已经设置正确，无需更新
                    this.viewLevel = 'day';
                    this.render();
                }
            });
            
            weekContainer.appendChild(dayCard);
        }
        
        wrapper.appendChild(weekContainer);
        
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
                    const hours = Object.keys(hourGroups).map(Number).sort((a, b) => a - b);
                    
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
                dayHeader.innerHTML = `<i class="fas fa-calendar-day"></i> ${twFull(date.getDay())}, ${t('calendarMonthDay', date.getMonth() + 1, date.getDate())}${isDayToday ? ` <span style="color: ${todayColor};">(${currentLang === 'en' ? 'Today' : '今天'})</span>` : ''}`;
                
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
                
                hourHeader.innerHTML = `
                    <span>
                        <i class="fas fa-calendar-day"></i> ${twFull(date.getDay())}, ${t('calendarMonthDay', date.getMonth() + 1, date.getDate())}${isDayToday ? ` <span style="color: ${todayColor};">(${currentLang === 'en' ? 'Today' : '今天'})</span>` : ''}
                        <span style="margin-left:12px;">${String(hour).padStart(2, '0')}:00-${String(hour).padStart(2, '0')}:59</span>
                    </span>
                    <span style="font-size:14px;color:var(--text-secondary);">${t('calendarBookmarksCount', hourBookmarks.length)}</span>
                `;
                
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
                
                allHeader.innerHTML = `
                    <span><i class="fas ${headerIcon}"></i> ${headerText}</span>
                    <span style="font-size:14px;color:var(--text-secondary);">${t('calendarBookmarksCount', totalBookmarks)}</span>
                `;
                
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
                    dayTitle.style.color = themeColor;
                    dayTitle.style.marginBottom = '16px';
                    dayTitle.style.paddingBottom = '8px';
                    dayTitle.style.borderBottom = `1px solid ${themeColor}`;
                    dayTitle.innerHTML = `${twFull(date.getDay())}, ${t('calendarMonthDay', date.getMonth() + 1, date.getDate())}${isDayToday ? ` <span style="color: ${todayColor};">(${currentLang === 'en' ? 'Today' : '今天'})</span>` : ''} - ${t('calendarBookmarkCount', bookmarks.length)}`;
                    daySection.appendChild(dayTitle);
                    
                    bookmarks.sort((a, b) => a.dateAdded - b.dateAdded);
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
                // 普通模式 + 当前周：显示第一天
                renderDayContent(filteredBookmarks[0].date, filteredBookmarks[0].bookmarks);
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
        
        // 如果书签数量<=10，直接按小时显示；>10则添加左侧时间段菜单
        if (bookmarks.length <= 10) {
            // 直接按小时显示
            const byHour = new Map();
            bookmarks.forEach(bm => {
                const hour = bm.dateAdded.getHours();
                if (!byHour.has(hour)) byHour.set(hour, []);
                byHour.get(hour).push(bm);
            });
            
            for (let hour = 0; hour < 24; hour++) {
                const hourBookmarks = byHour.get(hour);
                if (!hourBookmarks) continue;
                
                const themeColor = this.selectMode ? '#4CAF50' : 'var(--accent-primary)';
                
                const hourSection = document.createElement('div');
                hourSection.style.marginBottom = '24px';
                
                const hourTitle = document.createElement('div');
                hourTitle.className = 'bookmarks-group-title';
                hourTitle.style.color = themeColor;
                hourTitle.style.borderBottomColor = themeColor;
                hourTitle.textContent = `${String(hour).padStart(2, '0')}:00 - ${String(hour).padStart(2, '0')}:59 (${t('calendarBookmarkCount', hourBookmarks.length)})`;
                hourSection.appendChild(hourTitle);
                
                hourBookmarks.sort((a, b) => a.dateAdded - b.dateAdded);
                
                const bookmarkList = this.createCollapsibleBookmarkList(hourBookmarks);
                hourSection.appendChild(bookmarkList);
                
                wrapper.appendChild(hourSection);
            }
        } else {
            // 左右分栏布局：左侧时间段菜单，右侧内容
            const panelContainer = document.createElement('div');
            panelContainer.style.display = 'flex';
            panelContainer.style.gap = '20px';
            panelContainer.style.minHeight = '400px';
            
            // 左侧时间段菜单栏
            const sidebar = document.createElement('div');
            sidebar.style.width = '180px';
            sidebar.style.flexShrink = '0';
            sidebar.style.borderRight = '1px solid var(--border-color)';
            sidebar.style.paddingRight = '20px';
            
            // 右侧内容区
            const contentArea = document.createElement('div');
            contentArea.style.flex = '1';
            contentArea.style.minWidth = '0';
            
            // 按小时分组
            const hourGroups = groupBookmarksByHour(bookmarks);
            const hours = Object.keys(hourGroups).map(Number).sort((a, b) => a - b);
            
            // 默认选中第一个有数据的小时
            let selectedHour = hours[0];
            
            hours.forEach((hour, index) => {
                const hourBookmarks = hourGroups[hour];
                
                // 左侧小时菜单项
                const menuItem = document.createElement('div');
                menuItem.style.padding = '12px';
                menuItem.style.marginBottom = '8px';
                menuItem.style.borderRadius = '8px';
                menuItem.style.cursor = 'pointer';
                menuItem.style.transition = 'all 0.2s';
                menuItem.style.fontSize = '14px';
                menuItem.dataset.hour = hour;
                
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
                        <div style="font-size:13px;opacity:0.9;">${String(hour).padStart(2, '0')}:00-${String(hour).padStart(2, '0')}:59</div>
                        <div style="font-size:12px;opacity:0.8;">${t('calendarBookmarkCount', hourBookmarks.length)}</div>
                    </div>
                `;
                
                menuItem.addEventListener('click', () => {
                    // 更新选中状态
                    sidebar.querySelectorAll('div[data-hour]').forEach(item => {
                        item.style.background = 'transparent';
                        item.style.color = 'var(--text-primary)';
                        item.style.fontWeight = 'normal';
                    });
                    menuItem.style.background = 'var(--accent-primary)';
                    menuItem.style.color = 'white';
                    menuItem.style.fontWeight = '600';
                    
                    // 显示对应小时的内容
                    selectedHour = hour;
                    renderHourContent(hour, hourBookmarks);
                });
                
                menuItem.addEventListener('mouseenter', () => {
                    if (Number(menuItem.dataset.hour) !== selectedHour) {
                        menuItem.style.background = 'var(--bg-secondary)';
                    }
                });
                
                menuItem.addEventListener('mouseleave', () => {
                    if (Number(menuItem.dataset.hour) !== selectedHour) {
                        menuItem.style.background = 'transparent';
                    }
                });
                
                sidebar.appendChild(menuItem);
            });
            
            // 渲染右侧小时内容
            const renderHourContent = (hour, hourBookmarks) => {
                contentArea.innerHTML = '';
                
                const themeColor = this.selectMode ? '#4CAF50' : 'var(--accent-primary)';
                
                const hourHeader = document.createElement('div');
                hourHeader.style.fontSize = '18px';
                hourHeader.style.fontWeight = '700';
                hourHeader.style.color = 'var(--text-primary)';
                hourHeader.style.marginBottom = '20px';
                hourHeader.style.paddingBottom = '12px';
                hourHeader.style.borderBottom = `2px solid ${themeColor}`;
                hourHeader.innerHTML = `${String(hour).padStart(2, '0')}:00-${String(hour).padStart(2, '0')}:59`;
                
                contentArea.appendChild(hourHeader);
                
                // 显示该小时的书签列表（带折叠）
                const bookmarkList = this.createCollapsibleBookmarkList(hourBookmarks);
                contentArea.appendChild(bookmarkList);
            };
            
            // 初始显示第一个小时
            renderHourContent(selectedHour, hourGroups[selectedHour]);
            
            panelContainer.appendChild(sidebar);
            panelContainer.appendChild(contentArea);
            wrapper.appendChild(panelContainer);
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
