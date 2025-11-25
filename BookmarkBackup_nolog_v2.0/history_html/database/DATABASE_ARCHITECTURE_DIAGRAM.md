# 三库架构数据流程图

## 架构总览图

```mermaid
graph TB
    subgraph "用户操作层"
        U1[访问网页]
        U2[创建/删除书签]
        U3[删除历史记录]
    end

    subgraph "浏览器事件层"
        E1[history.onVisited]
        E2[bookmarks.onCreated]
        E3[bookmarks.onRemoved]
        E4[history.onVisitRemoved]
    end

    subgraph "DatabaseManager 数据管理层"
        DM[DatabaseManager]
        DM1[handleHistoryVisited]
        DM2[handleBookmarkCreated]
        DM3[handleBookmarkRemoved]
        DM4[handleHistoryVisitRemoved]
    end

    subgraph "三个永久存储库"
        DB1[("存储库1<br/>AllHistoryDatabase<br/>所有浏览记录")]
        DB2[("存储库2<br/>BookmarkDatabase<br/>书签URL+标题")]
        DB3[("存储库3<br/>BookmarkHistoryDatabase<br/>书签关联记录<br/>(DB1 ∩ DB2)")]
    end

    subgraph "数据同步层"
        CAL[BrowsingHistoryCalendar<br/>bookmarksByDate]
        SYNC[syncFromDatabaseManager]
    end

    subgraph "UI展示层 (三个功能页面)"
        UI1[点击记录<br/>browsingHistoryPanel]
        UI2[点击排行<br/>browsingRankingPanel]
        UI3[书签关联页面<br/>browsingRelatedPanel]
    end

    %% 用户操作 → 浏览器事件
    U1 --> E1
    U2 --> E2
    U2 --> E3
    U3 --> E4

    %% 浏览器事件 → DatabaseManager
    E1 --> DM1
    E2 --> DM2
    E3 --> DM3
    E4 --> DM4

    %% DatabaseManager → 三个存储库
    DM1 --> DB1
    DM1 -.匹配检查.-> DB2
    DM1 -.匹配则添加.-> DB3

    DM2 --> DB2
    DM2 -.查询历史.-> DB1
    DM2 -.添加匹配.-> DB3

    DM3 --> DB2
    DM3 --> DB3

    DM4 --> DB1
    DM4 --> DB3

    %% 存储库 → 数据同步
    DB3 --> SYNC
    SYNC --> CAL

    %% 数据同步 → UI展示
    CAL --> UI1
    CAL --> UI2
    CAL --> UI3

    %% 样式
    classDef storage fill:#e1f5ff,stroke:#01579b,stroke-width:3px
    classDef manager fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef ui fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    
    class DB1,DB2,DB3 storage
    class DM,DM1,DM2,DM3,DM4 manager
    class UI1,UI2,UI3 ui
```

## 数据调用关系详解

```mermaid
graph LR
    subgraph "存储库层 (持久化)"
        DB1[(存储库1<br/>AllHistory<br/>全部历史)]
        DB2[(存储库2<br/>Bookmarks<br/>全部书签)]
        DB3[(存储库3<br/>BookmarkHistory<br/>书签历史)]
    end

    subgraph "数据访问层"
        DM[DatabaseManager<br/>统一管理]
    end

    subgraph "缓存层"
        CAL[BrowsingHistoryCalendar<br/>bookmarksByDate<br/>Map结构缓存]
    end

    subgraph "UI层 - 三个功能页面"
        UI1[📅 点击记录]
        UI2[📊 点击排行]
        UI3[🔗 书签关联页面]
    end

    %% 存储库关系
    DB1 -.URL+标题.-> DB2
    DB2 -.匹配.-> DB3
    DB1 -.筛选.-> DB3

    %% DatabaseManager管理存储库
    DM --> DB1
    DM --> DB2
    DM --> DB3

    %% 同步到缓存
    DB3 -->|syncFromDatabaseManager| CAL

    %% UI调用关系
    CAL -->|读取数据| UI1
    CAL -->|统计分析| UI2
    CAL -->|标识书签| UI3

    %% 点击排行的特殊调用
    UI2 -.直接访问.-> DM
    DM -.获取书签库.-> DB2

    %% 书签关联的特殊调用
    UI3 -.直接访问.-> DM
    DM -.获取书签库.-> DB2

    style DB1 fill:#bbdefb
    style DB2 fill:#c8e6c9
    style DB3 fill:#ffccbc
    style CAL fill:#fff9c4
    style UI1 fill:#f8bbd0
    style UI2 fill:#f8bbd0
    style UI3 fill:#f8bbd0
```

## 三个页面的数据调用细节

```mermaid
graph TB
    subgraph "📅 点击记录 (browsingHistoryPanel)"
        P1[日历视图]
        P1A[读取 bookmarksByDate]
        P1B[按日期分组显示]
        P1C[展示URL + 标题 + 时间]
    end

    subgraph "📊 点击排行 (browsingRankingPanel)"
        P2[排行榜视图]
        P2A[遍历 bookmarksByDate]
        P2B[从 DatabaseManager<br/>获取书签映射]
        P2C[按书签聚合统计]
        P2D[URL+标题匹配<br/>合并计数]
        P2E[时间范围筛选<br/>day/week/month/year]
        P2F[排序显示 Top 50]
    end

    subgraph "🔗 书签关联页面 (browsingRelatedPanel)"
        P3[关联记录视图]
        P3A[查询浏览器历史API]
        P3B[从 DatabaseManager<br/>获取书签集合]
        P3C[URL 匹配标识]
        P3D[标题匹配标识]
        P3E[黄色高亮书签记录]
        P3F[显示所有历史<br/>区分书签/非书签]
    end

    subgraph "数据源"
        CAL[bookmarksByDate<br/>来自存储库3]
        DB2[存储库2<br/>书签URL+标题]
        API[浏览器History API]
    end

    %% 点击记录的调用
    CAL --> P1A
    P1A --> P1B --> P1C

    %% 点击排行的调用
    CAL --> P2A
    DB2 --> P2B
    P2A --> P2C
    P2B --> P2D
    P2C --> P2D --> P2E --> P2F

    %% 书签关联的调用
    API --> P3A
    DB2 --> P3B
    P3A --> P3C
    P3A --> P3D
    P3B --> P3C
    P3B --> P3D
    P3C --> P3E
    P3D --> P3E
    P3E --> P3F

    style CAL fill:#fff9c4,stroke:#f57f17,stroke-width:2px
    style DB2 fill:#c8e6c9,stroke:#2e7d32,stroke-width:2px
    style API fill:#e1bee7,stroke:#6a1b9a,stroke-width:2px
```

## 增量更新流程图

```mermaid
sequenceDiagram
    participant User as 👤 用户
    participant Browser as 🌐 浏览器
    participant BG as background.js
    participant DM as DatabaseManager
    participant DB1 as 存储库1<br/>AllHistory
    participant DB2 as 存储库2<br/>Bookmarks
    participant DB3 as 存储库3<br/>BookmarkHistory
    participant CAL as Calendar<br/>缓存层
    participant UI as 📱 UI页面

    %% === 场景1: 访问网页（增量添加历史记录） ===
    rect rgb(200, 230, 201)
        Note over User,UI: 🟢 场景1: 用户访问网页
        User->>Browser: 访问 https://example.com
        Browser->>BG: history.onVisited事件
        BG->>DM: handleHistoryVisited(visitItem)
        
        DM->>DB1: add(record)
        Note over DB1: 添加到所有历史记录
        
        DM->>DB2: matches(record)?
        Note over DB2: 检查URL或标题<br/>是否匹配书签
        
        alt URL匹配 或 标题匹配
            DB2-->>DM: true (匹配)
            DM->>DB3: add(record)
            Note over DB3: 添加到书签历史
        else 不匹配
            DB2-->>DM: false
            Note over DM: 不添加到存储库3
        end
        
        DM->>DM: scheduleSave() 延迟2秒保存
        DM->>CAL: emit('updated') 立即派发事件
        CAL->>CAL: syncFromDatabaseManager()
        Note over CAL: 从DB3同步数据<br/>更新bookmarksByDate
        
        CAL->>UI: 触发界面刷新
        Note over UI: 等待数据同步<br/>(最多2秒)
        UI->>UI: 重新渲染
    end

    %% === 场景2: 创建书签（增量添加书签） ===
    rect rgb(255, 224, 178)
        Note over User,UI: 🟡 场景2: 用户创建书签
        User->>Browser: 添加书签<br/>URL: https://example.com<br/>标题: "示例网站"
        Browser->>BG: bookmarks.onCreated事件
        BG->>DM: handleBookmarkCreated(bookmark)
        
        DM->>DB2: add(bookmark)
        Note over DB2: 添加到书签库
        
        DM->>DB1: getByUrlOrTitle(url, title)
        Note over DB1: 查询历史记录<br/>匹配URL或标题
        
        alt 找到匹配的历史记录
            DB1-->>DM: [record1, record2, ...]
            loop 遍历每条记录
                DM->>DB3: add(record)
            end
            Note over DB3: 批量添加历史记录
        else 没有匹配记录
            DB1-->>DM: []
            Note over DM: 暂无历史记录<br/>等待用户访问
        end
        
        DM->>DM: scheduleSave()
        DM->>CAL: emit('updated')
        CAL->>CAL: syncFromDatabaseManager()
        CAL->>UI: 触发界面刷新
        UI->>UI: 重新渲染
    end
```

## 减量更新流程图

```mermaid
sequenceDiagram
    participant User as 👤 用户
    participant Browser as 🌐 浏览器
    participant BG as background.js
    participant DM as DatabaseManager
    participant DB1 as 存储库1<br/>AllHistory
    participant DB2 as 存储库2<br/>Bookmarks
    participant DB3 as 存储库3<br/>BookmarkHistory
    participant CAL as Calendar<br/>缓存层
    participant UI as 📱 UI页面

    %% === 场景3: 删除书签（减量删除） ===
    rect rgb(255, 205, 210)
        Note over User,UI: 🔴 场景3: 用户删除书签
        User->>Browser: 删除书签<br/>URL: https://example.com
        Browser->>BG: bookmarks.onRemoved事件
        BG->>DM: handleBookmarkRemoved(removeInfo)
        
        DM->>DB2: remove(url, title)
        Note over DB2: 从书签库删除
        
        DM->>DB3: removeByUrl(url)
        Note over DB3: 删除该URL的<br/>所有关联记录
        
        DM->>DM: scheduleSave()
        DM->>CAL: emit('updated')
        CAL->>CAL: syncFromDatabaseManager()
        Note over CAL: DB3数据减少<br/>bookmarksByDate更新
        
        CAL->>UI: 触发界面刷新
        UI->>UI: 重新渲染<br/>记录消失
    end

    %% === 场景4: 删除历史记录（减量删除） ===
    rect rgb(209, 196, 233)
        Note over User,UI: 🟣 场景4: 用户删除历史记录
        User->>Browser: 清除历史记录<br/>或删除特定URL
        Browser->>BG: history.onVisitRemoved事件
        BG->>DM: handleHistoryVisitRemoved(removeInfo)
        
        alt 清除所有历史
            DM->>DB1: clear()
            DM->>DB3: clear()
            Note over DB1,DB3: 清空所有数据
        else 删除特定URL
            DM->>DB1: removeByUrl(url)
            DM->>DB2: hasUrl(url)?
            Note over DB2: 检查是否是书签
            
            alt 是书签
                DB2-->>DM: true
                DM->>DB3: removeByUrl(url)
                Note over DB3: 从书签历史删除
            else 不是书签
                DB2-->>DM: false
                Note over DM: 不处理DB3
            end
        end
        
        DM->>DM: scheduleSave()
        DM->>CAL: emit('updated')
        CAL->>CAL: syncFromDatabaseManager()
        CAL->>UI: 触发界面刷新
        UI->>UI: 重新渲染
    end
```

## 数据同步和UI刷新详细流程

```mermaid
flowchart TB
    Start([用户操作触发])
    
    subgraph "事件处理层"
        Event[浏览器事件触发]
        Handler[DatabaseManager处理]
    end
    
    subgraph "存储层操作"
        UpdateDB1[更新存储库1<br/>AllHistory]
        UpdateDB2[更新存储库2<br/>Bookmarks]
        UpdateDB3[更新存储库3<br/>BookmarkHistory]
        Match{匹配检查<br/>URL或标题}
    end
    
    subgraph "数据同步"
        Save[scheduleSave<br/>延迟2秒保存]
        Emit[emit 立即派发事件<br/>browsingDataUpdated]
        Listen[Calendar监听事件]
        Sync[syncFromDatabaseManager<br/>从DB3同步数据]
        Update[更新bookmarksByDate]
    end
    
    subgraph "UI刷新"
        Announce[派发旧事件<br/>browsingHistoryCacheUpdated]
        Wait[等待数据同步<br/>最多2秒]
        Check{数据就绪?}
        Render[重新渲染界面]
    end
    
    Start --> Event
    Event --> Handler
    
    Handler --> UpdateDB1
    Handler --> UpdateDB2
    Handler --> Match
    
    Match -->|匹配| UpdateDB3
    Match -->|不匹配| Save
    
    UpdateDB1 --> Save
    UpdateDB2 --> Save
    UpdateDB3 --> Save
    
    Save --> Emit
    Emit --> Listen
    Listen --> Sync
    Sync --> Update
    Update --> Announce
    
    Announce --> Wait
    Wait --> Check
    Check -->|就绪| Render
    Check -->|超时| Render
    
    Render --> End([显示更新结果])
    
    style UpdateDB1 fill:#bbdefb
    style UpdateDB2 fill:#c8e6c9
    style UpdateDB3 fill:#ffccbc
    style Wait fill:#fff9c4,stroke:#f57f17,stroke-width:3px
    style Render fill:#f8bbd0
```

## 关键时间节点

```mermaid
gantt
    title 增量更新完整时序（从用户操作到UI显示）
    dateFormat X
    axisFormat %Lms

    section 事件触发
    用户操作 :milestone, m1, 0, 0
    浏览器事件 :a1, 0, 5
    
    section DatabaseManager
    事件处理 :a2, 5, 10
    更新存储库 :a3, 10, 50
    匹配检查 :a4, 30, 20
    
    section 数据同步
    派发事件(立即) :milestone, m2, 50, 0
    Calendar监听 :a5, 50, 10
    同步数据 :a6, 60, 100
    
    section UI刷新
    等待数据(最多2000ms) :crit, a7, 160, 50
    数据就绪 :milestone, m3, 210, 0
    重新渲染 :a8, 210, 40
    显示完成 :milestone, m4, 250, 0
    
    section 后台保存
    延迟保存(2秒后) :a9, 50, 2000
```

## 三个页面的刷新策略对比

| 页面 | 数据来源 | 实时性要求 | 等待策略 | 渲染方式 |
|------|---------|-----------|---------|---------|
| **点击记录** | bookmarksByDate | 高 | 等待2秒 | 日历视图 |
| **点击排行** | bookmarksByDate + BookmarkDB | 高 | **等待2秒** | Top50排行 |
| **书签关联** | History API + BookmarkDB | 高 | **等待2秒** | 列表+标识 |

## 性能优化要点

```mermaid
mindmap
  root((数据流优化))
    存储层
      延迟保存 2秒
      批量写入
      索引优化
    同步层
      立即派发事件
      异步同步数据
      增量更新
    UI层
      等待机制 2秒
      防抖渲染
      虚拟滚动
    缓存策略
      bookmarksByDate Map
      书签集合 Set
      URL标题映射
```

## 总结

### 核心设计理念
1. **存储库独立**：三个库各司其职，职责分明
2. **事件驱动**：所有更新通过事件系统同步
3. **延迟保存**：减少IO，立即派发事件提高响应
4. **智能等待**：UI层等待数据同步，确保显示正确
5. **双重匹配**：URL + 标题并集匹配，覆盖更全

### 数据流向
```
用户操作 
  → 浏览器事件 
  → DatabaseManager 
  → 三个存储库 
  → 立即派发事件 
  → Calendar同步 
  → 等待数据就绪 
  → UI刷新显示
```

### 关键时间点
- **0ms**: 用户操作
- **50ms**: 存储库更新完成，派发事件
- **150ms**: Calendar同步完成
- **210ms**: 数据就绪，开始渲染
- **250ms**: UI显示更新（用户感知）
- **2050ms**: 后台保存到chrome.storage完成

### 用户体验
- ✅ **实时性好**：< 300ms看到更新
- ✅ **准确性高**：等待数据同步完成
- ✅ **性能优异**：资源占用极低
- ✅ **稳定可靠**：超时保护机制
