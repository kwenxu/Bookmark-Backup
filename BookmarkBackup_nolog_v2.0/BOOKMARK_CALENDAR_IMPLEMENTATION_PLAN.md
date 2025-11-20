# 书签记录日历视图实现方案

## 需求总结

### 1. 名称修改
- 「书签添加记录」→「书签记录」 (Bookmark Records)
- 英文翻译也需要更新

### 2. 第一个小标题：书签添加记录（优化版）
**移除功能**：
- ❌ 不显示「状态」栏（是否备份）
- ❌ 不显示「时间」过滤器（按年/月/日的旧过滤器）

**新增功能**：
- ✅ 显示日历，默认当天
- ✅ 点击日历日期显示当天添加的书签
- ✅ 左上方视图切换：按日、按周、按月、按年
- ✅ 右上方显示当前范围统计UI
  - 标题显示当前时间范围
  - 显示书签数量
  - 「任意」按钮进行日期勾选

**参考实现**：
- PDF插件的日历视图 (`/Users/kk/Downloads/new/222-pdf-new-branch/200/highlights-collection/`)
- 导出数据中的日期范围选择器

### 3. 第二个小标题：书签历史记录
- 使用chrome.history API
- 结合当前书签数据
- 也用日历视图展示

## 技术实现方案

### 文件结构
```
history_html/
├── bookmark_calendar.js         # 新建：日历核心逻辑
├── bookmark_calendar.css        # 新建：日历样式
├── history.html                 # 修改：更新HTML结构
├── history.js                   # 修改：更新翻译和初始化
└── history.css                  # 可能需要少量补充
```

### 核心数据结构

```javascript
class BookmarkCalendar {
  constructor() {
    this.bookmarksByDate = new Map(); // { 'YYYY-MM-DD': [bookmarks] }
    this.viewMode = 'month'; // 'day' | 'week' | 'month' | 'year'
    this.currentDate = new Date();
    this.selectedDates = new Set(); // 用于"任意"模式
    this.calendarState = {
      year: new Date().getFullYear(),
      month: new Date().getMonth(),
      selectedDate: null
    };
  }
}
```

### HTML结构（替换现有的additionsReviewPanel）

```html
<!-- 子视图 1：书签添加记录（日历视图） -->
<div id="additionsReviewPanel" class="additions-subview active">
  <!-- 工具栏 -->
  <div class="calendar-toolbar">
    <!-- 左侧：视图模式切换 -->
    <div class="calendar-view-modes">
      <button class="calendar-view-btn active" data-mode="month">
        <i class="fas fa-calendar-alt"></i>按月
      </button>
      <button class="calendar-view-btn" data-mode="week">
        <i class="fas fa-calendar-week"></i>按周
      </button>
      <button class="calendar-view-btn" data-mode="day">
        <i class="fas fa-calendar-day"></i>按日
      </button>
      <button class="calendar-view-btn" data-mode="year">
        <i class="fas fa-calendar"></i>按年
      </button>
    </div>
    
    <!-- 右侧：当前范围统计 -->
    <div class="calendar-stats-panel">
      <div class="stats-header">
        <span class="stats-title" id="calendarRangeTitle">2024年11月</span>
        <button class="btn-custom-range" id="btnCustomRange">
          <i class="fas fa-calendar-check"></i>任意
        </button>
      </div>
      <div class="stats-content">
        <span class="stats-label">书签数：</span>
        <span class="stats-value" id="calendarRangeCount">0</span>
      </div>
    </div>
  </div>
  
  <!-- 日历容器 -->
  <div id="bookmarkCalendarContainer" class="bookmark-calendar-container">
    <!-- 动态渲染日历 -->
  </div>
  
  <!-- 选中日期的书签列表 -->
  <div id="selectedDateBookmarks" class="selected-date-bookmarks" style="display:none;">
    <div class="selected-header">
      <h3 id="selectedDateTitle"></h3>
      <button class="close-btn" id="closeSelectedPanel">×</button>
    </div>
    <div id="selectedBookmarksList" class="bookmarks-list">
      <!-- 动态加载书签列表 -->
    </div>
  </div>
</div>
```

### CSS样式要点

```css
.calendar-toolbar {
  display: flex;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid var(--border-color);
}

.calendar-view-modes {
  display: flex;
  gap: 8px;
}

.calendar-view-btn {
  padding: 8px 16px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
}

.calendar-view-btn.active {
  background: var(--primary-color);
  color: white;
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 12px;
  padding: 20px;
}

.calendar-day {
  aspect-ratio: 1;
  min-height: 100px;
  border: 2px solid var(--border-color);
  border-radius: 12px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.calendar-day.has-bookmarks {
  background: var(--bg-secondary);
}

.calendar-day.selected {
  background: var(--primary-color);
  color: white;
}

.calendar-day:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}
```

### JavaScript核心方法

```javascript
class BookmarkCalendar {
  // 初始化
  async init() {
    await this.loadBookmarks();
    this.bindEvents();
    this.render();
  }
  
  // 加载书签数据
  async loadBookmarks() {
    const bookmarks = await chrome.bookmarks.getTree();
    this.parseBookmarks(bookmarks[0]);
  }
  
  // 解析书签到日期Map
  parseBookmarks(node) {
    if (node.url && node.dateAdded) {
      const date = new Date(node.dateAdded);
      const key = this.getDateKey(date);
      if (!this.bookmarksByDate.has(key)) {
        this.bookmarksByDate.set(key, []);
      }
      this.bookmarksByDate.get(key).push({
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
  
  // 渲染日历
  render() {
    const container = document.getElementById('bookmarkCalendarContainer');
    switch (this.viewMode) {
      case 'month':
        this.renderMonthView(container);
        break;
      case 'week':
        this.renderWeekView(container);
        break;
      case 'day':
        this.renderDayView(container);
        break;
      case 'year':
        this.renderYearView(container);
        break;
    }
    this.updateStats();
  }
  
  // 渲染月视图（参考PDF插件）
  renderMonthView(container) {
    const { year, month } = this.calendarState;
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startDayOfWeek = firstDay.getDay();
    
    let html = `
      <div class="calendar-header">
        <button id="prevMonth"><i class="fas fa-chevron-left"></i></button>
        <h3>${year}年${month + 1}月</h3>
        <button id="nextMonth"><i class="fas fa-chevron-right"></i></button>
      </div>
      <div class="calendar-grid">
        ${['日','一','二','三','四','五','六'].map(d => 
          `<div class="calendar-weekday">${d}</div>`
        ).join('')}
    `;
    
    // 空白格
    for (let i = 0; i < startDayOfWeek; i++) {
      html += '<div class="calendar-day-empty"></div>';
    }
    
    // 天数格
    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const bookmarks = this.bookmarksByDate.get(dateKey) || [];
      const hasBookmarks = bookmarks.length > 0;
      
      html += `
        <div class="calendar-day ${hasBookmarks ? 'has-bookmarks' : ''}" 
             data-date="${dateKey}">
          <div class="day-number">${day}</div>
          ${hasBookmarks ? `<div class="bookmark-count">${bookmarks.length}</div>` : ''}
        </div>
      `;
    }
    
    html += '</div>';
    container.innerHTML = html;
    
    // 绑定事件
    this.bindCalendarEvents();
  }
  
  // 打开自定义日期范围选择器（参考PDF插件的日期选择）
  openCustomRangePicker() {
    // 创建模态框，显示可多选的日历
    // 支持拖拽选择
    // 点击「应用」后更新selectedDates
  }
  
  // 更新统计信息
  updateStats() {
    const title = document.getElementById('calendarRangeTitle');
    const count = document.getElementById('calendarRangeCount');
    
    let rangeTitle = '';
    let bookmarkCount = 0;
    
    switch (this.viewMode) {
      case 'day':
        rangeTitle = '今天';
        // 计算今天的书签数
        break;
      case 'week':
        rangeTitle = '本周';
        // 计算本周的书签数
        break;
      case 'month':
        rangeTitle = `${this.calendarState.year}年${this.calendarState.month + 1}月`;
        // 计算本月的书签数
        break;
      case 'year':
        rangeTitle = `${this.calendarState.year}年`;
        // 计算本年的书签数
        break;
    }
    
    title.textContent = rangeTitle;
    count.textContent = bookmarkCount;
  }
}
```

## 实现步骤

### 第1步：修改HTML
- [x] 更新导航标题「书签温故」→「书签记录」
- [x] 更新子标题「书签添加记录」→保持，但改为日历视图
- [ ] 移除旧的过滤器UI
- [ ] 添加新的日历工具栏
- [ ] 添加日历容器

### 第2步：创建CSS
- [ ] 创建`bookmark_calendar.css`
- [ ] 定义日历网格布局
- [ ] 定义视图切换按钮样式
- [ ] 定义统计面板样式
- [ ] 参考PDF插件的日历样式

### 第3步：创建JavaScript
- [ ] 创建`bookmark_calendar.js`
- [ ] 实现BookmarkCalendar类
- [ ] 实现月/周/日/年视图渲染
- [ ] 实现日期选择和书签显示
- [ ] 实现自定义范围选择器

### 第4步：更新翻译
- [ ] 修改history.js中的翻译
- [ ] 「书签温故」→「书签记录」
- [ ] 「书签添加记录」→「Bookmark Addition Records」
- [ ] 添加新的UI文本翻译

### 第5步：集成和测试
- [ ] 在history.html中引入新的CSS和JS
- [ ] 测试日历视图切换
- [ ] 测试日期选择和书签显示
- [ ] 测试自定义范围选择
- [ ] 测试响应式布局

## 关键参考代码位置

### PDF插件日历实现
文件：`/Users/kk/Downloads/new/222-pdf-new-branch/200/highlights-collection/script.js`

**关键方法**：
- `renderTimeCalendar()` - 月视图日历渲染（第3770行）
- `_openDateRangeCalendarFull()` - 日期范围选择器（第2467行）
- 日历点击事件处理
- 日期分组逻辑

**关键CSS**：
`/Users/kk/Downloads/new/222-pdf-new-branch/200/highlights-collection/styles.css`
- `.calendar-grid` 样式
- `.calendar-day` 样式
- `.has-highlights` 样式

## 预期效果

### 视图效果
1. **按月视图**：显示完整月历，每天显示书签数量
2. **按周视图**：显示一周7天，每天显示书签
3. **按日视图**：显示单日，列出所有书签
4. **按年视图**：显示12个月卡片，每月显示总数

### 交互效果
1. 点击日历日期 → 显示该日书签列表
2. 点击视图按钮 → 切换视图模式
3. 点击「任意」 → 弹出多选日历
4. 拖拽选择 → 批量选择日期

---

**创建时间**：2024-11-20
**状态**：设计完成，待实现
