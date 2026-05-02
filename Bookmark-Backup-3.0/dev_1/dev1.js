(function () {
    'use strict';

    if (window.__dev1ExperimentLoaded) return;
    window.__dev1ExperimentLoaded = true;

    const DEV1_VIEW_KEY = 'dev-1';
    const DEV1_QUEUE_STORAGE_KEY = 'dev1_experiment_queue_v1';
    const DEV1_REVIEW_STORAGE_KEY = 'dev1_experiment_review_v1';
    const DEV1_WHITELIST_STORAGE_KEY = 'dev1_experiment_whitelist_v1';
    const DEV1_QUEUE_BATCH_SIZE_STORAGE_KEY = 'dev1_experiment_queue_batch_size_v2';
    const DEV1_REVIEW_AUTO_REVIEW_MS_STORAGE_KEY = 'dev1_experiment_review_auto_review_ms_v1';
    const DEV1_REVIEW_WINDOW_EVENT_KEY = 'dev1ReviewWindowEventV1';

    const runtimeApi = (typeof chrome !== 'undefined' && chrome.runtime)
        ? chrome
        : (typeof browser !== 'undefined' ? browser : null);

    const SOURCE_BOOKMARKS = 'bookmarks';
    const SOURCE_CHANGES = 'changes';
    const SOURCE_ALL_TABS = 'all_tabs';
    const SOURCE_KEYS = [SOURCE_BOOKMARKS, SOURCE_CHANGES, SOURCE_ALL_TABS];
    const FILTER_KEYS = ['bookmark', 'folder', 'domain', 'subdomain'];
    const SCOPE_UI_KIND_KEYS = ['folder', 'domain', 'subdomain', 'bookmark', 'whitelist'];
    const CHANGES_VIEW_MODE_KEYS = ['simple', 'detailed', 'collection'];
    const SCOPE_TREE_CHILD_BATCH = 120;
    const REVIEW_AUTO_REVIEW_DEFAULT_MS = 500;
    const REVIEW_AUTO_REVIEW_MIN_MS = 100;
    const REVIEW_AUTO_REVIEW_MAX_MS = 60000;
    const QUEUE_BATCH_SIZE_DEFAULT = 10;
    const QUEUE_BATCH_SIZE_MIN = 1;
    const QUEUE_BATCH_SIZE_MAX = 50;

    function createEmptyFilterOptions() {
        return {
            bookmark: [],
            folder: [],
            domain: [],
            subdomain: []
        };
    }

    function createEmptyFilters() {
        return {
            bookmark: new Set(),
            folder: new Set(),
            domain: new Set(),
            subdomain: new Set()
        };
    }

    function createSourceState() {
        return {
            items: [],
            filteredItems: [],
            filterOptions: createEmptyFilterOptions(),
            filters: createEmptyFilters(),
            folderBadgeByPath: new Map(),
            scopeTreeNodes: [],
            loadError: ''
        };
    }

    function createScopeFolderTreeUiMapState() {
        return {
            [SOURCE_BOOKMARKS]: { expanded: new Set(), loaded: new Map() },
            [SOURCE_CHANGES]: { expanded: new Set(), loaded: new Map() },
            [SOURCE_ALL_TABS]: { expanded: new Set(), loaded: new Map() }
        };
    }

    function createScopeGroupedUiState() {
        return {
            [SOURCE_BOOKMARKS]: {
                domain: { expanded: new Set(), loaded: new Map() },
                subdomain: { expanded: new Set(), loaded: new Map() }
            },
            [SOURCE_CHANGES]: {
                domain: { expanded: new Set(), loaded: new Map() },
                subdomain: { expanded: new Set(), loaded: new Map() }
            },
            [SOURCE_ALL_TABS]: {
                domain: { expanded: new Set(), loaded: new Map() },
                subdomain: { expanded: new Set(), loaded: new Map() }
            }
        };
    }

    function createScopeUiState() {
        return {
            sourceKey: SOURCE_CHANGES,
            kind: 'folder',
            currentChangesResolvedMode: 'collection',
            keyword: '',
            lazy: {
                sourceKey: SOURCE_CHANGES,
                kind: 'folder',
                options: [],
                offset: 0,
                pageSize: 120
            },
            folderTreeUi: createScopeFolderTreeUiMapState(),
            groupedUi: createScopeGroupedUiState()
        };
    }

    function createEmptyReviewSession() {
        return {
            windowId: null,
            acknowledged: false,
            submitted: false,
            submittedAt: '',
            lastSyncedAt: '',
            queueSignature: '',
            batchKeys: [],
            initialBatchKeys: []
        };
    }

    function ensureSourceStateShape(sourceKey) {
        if (!state.sources || typeof state.sources !== 'object') {
            state.sources = {};
        }

        let sourceState = state.sources[sourceKey];
        if (!sourceState || typeof sourceState !== 'object') {
            sourceState = createSourceState();
            state.sources[sourceKey] = sourceState;
        }

        if (!Array.isArray(sourceState.items)) sourceState.items = [];
        if (!Array.isArray(sourceState.filteredItems)) sourceState.filteredItems = [];
        if (!sourceState.filterOptions || typeof sourceState.filterOptions !== 'object') {
            sourceState.filterOptions = createEmptyFilterOptions();
        }
        FILTER_KEYS.forEach((kind) => {
            if (!Array.isArray(sourceState.filterOptions[kind])) {
                sourceState.filterOptions[kind] = [];
            }
        });

        if (!sourceState.filters || typeof sourceState.filters !== 'object') {
            sourceState.filters = createEmptyFilters();
        }
        FILTER_KEYS.forEach((kind) => {
            const raw = sourceState.filters[kind];
            if (raw instanceof Set) return;
            if (Array.isArray(raw)) {
                sourceState.filters[kind] = new Set(raw.map(v => String(v || '')));
                return;
            }
            sourceState.filters[kind] = new Set();
        });

        if (!(sourceState.folderBadgeByPath instanceof Map)) {
            sourceState.folderBadgeByPath = new Map(Array.isArray(sourceState.folderBadgeByPath) ? sourceState.folderBadgeByPath : []);
        }
        if (!Array.isArray(sourceState.scopeTreeNodes)) {
            sourceState.scopeTreeNodes = [];
        }

        sourceState.loadError = String(sourceState.loadError || '');
        return sourceState;
    }

    const state = {
        sourceItems: [],
        filteredItems: [],
        sources: {
            [SOURCE_BOOKMARKS]: createSourceState(),
            [SOURCE_CHANGES]: createSourceState(),
            [SOURCE_ALL_TABS]: createSourceState()
        },
        scopePanelOpen: false,
        scopeUi: createScopeUiState(),
        captureRunState: null,
        lockedQueueItems: [],
        whitelistKeys: new Set(),
        whitelistDomainKeys: new Set(),
        whitelistSubdomainKeys: new Set(),
        reviewSession: createEmptyReviewSession(),
        reviewActiveKey: '',
        reviewActiveSinceMs: 0,
        reviewAutoReviewMs: REVIEW_AUTO_REVIEW_DEFAULT_MS,
        reviewSettingsOpen: false,
        queueBatchSize: QUEUE_BATCH_SIZE_DEFAULT,
        queueBatchIndex: 0,
        reviewSyncEventTimerId: null,
        reviewAutoReviewTimerId: null,
        reviewWindowClosePreserveId: null,
        reviewWindowEventAt: 0,
        workflowSteps: {
            openDone: false,
            submitDone: false,
            runDone: false
        },
        workflowStepsBatchIndex: null,
        reviewSyncInFlight: false,
        running: false,
        initialized: false
    };

    function resetWorkflowSteps() {
        state.workflowSteps = {
            openDone: false,
            submitDone: false,
            runDone: false
        };
        state.workflowStepsBatchIndex = null;
    }

    function markWorkflowStep(stepKey, done = true) {
        if (!state.workflowSteps || typeof state.workflowSteps !== 'object') {
            resetWorkflowSteps();
        }
        if (!['openDone', 'submitDone', 'runDone'].includes(String(stepKey || ''))) return;
        state.workflowSteps[stepKey] = done === true;
        state.workflowStepsBatchIndex = state.queueBatchIndex ?? 0;
    }

    function isWorkflowStepDone(stepKey) {
        if ((state.workflowStepsBatchIndex ?? null) !== (state.queueBatchIndex ?? 0)) return false;
        return state.workflowSteps?.[stepKey] === true;
    }

    function isReviewOpenStepSatisfied(queueItems = getCurrentQueueBatchItems()) {
        if (isExistingTabReviewMode(queueItems)) return true;
        return getReviewWindowId() != null
            && isQueuePreparedWithExistingTabs(queueItems);
    }

    function isReviewSubmitStepSatisfied(queueItems = getCurrentQueueBatchItems()) {
        return shouldBypassReviewForQueue(queueItems)
            || (isExistingTabReviewMode(queueItems) && isReviewSatisfiedForQueue(queueItems))
            || (getReviewWindowId() != null && isReviewSatisfiedForQueue(queueItems))
            || isWorkflowStepDone('submitDone');
    }

    const i18n = {
        zh_CN: {
            navTitle: '网页快照',
            navDesc: '来源：当前变化 / 书签树 / 所有窗口Tab → 选取范围点“完成”更新队列 → 点“在新窗口打开”复核并提交后执行抓取导出 MHTML',
            navHelp: '先点“选取范围”勾选并点“完成”更新队列，再点“在新窗口打开”人工确认页面，提交复核后执行抓取导出 MHTML；白名单项可免复核直接抓取。',
            refreshSource: '刷新书签数据',
            runCapture: '执行抓取并导出',
            runStartBtn: '开始',
            runPauseBtn: '暂停',
            runCancelBtn: '撤销',
            pickScope: '选取范围',
            clearFilters: '清空筛选',
            tipRefreshSource: '从书签源重新拉取队列数据，不会执行抓取。',
            tipRunCapture: '对当前筛选队列执行抓取与导出。',
            tipRunStart: '开始执行当前待抓取队列。',
            tipRunPause: '暂停当前执行中的抓取任务。',
            tipRunCancel: '撤销当前执行中的抓取任务（不清空队列）。',
            tipPickScope: '打开范围面板，选择本次执行的书签范围。',
            tipClearFilters: '清空范围筛选并恢复全量队列。',
            loading: '正在加载书签数据...',
            noChanges: '当前没有可抓取书签。',
            sourceError: '读取书签数据失败',
            sourcePartialError: '部分范围加载失败',
            runStart: '开始执行抓取任务...',
            runPausing: '正在请求暂停...',
            runCanceling: '正在请求撤销...',
            runDone: '抓取任务完成',
            runPaused: '抓取任务已暂停',
            runCancelled: '抓取任务已撤销',
            runFailed: '抓取任务失败',
            runPauseFailed: '暂停失败',
            runCancelFailed: '撤销失败',
            runControlNoActive: '当前没有正在执行的抓取任务。',
            dimBookmark: '书签',
            dimFolder: '书签树',
            dimCurrentChanges: '当前变化',
            dimDomain: '域名',
            dimSubdomain: '子域名',
            dimAllTabs: '所有窗口Tab页面',
            dimWhitelist: '白名单',
            changesModeSimple: '简略',
            changesModeDetailed: '详细',
            changesModeCollection: '集合',
            scopeCurrentChangesModePrefix: '跟随当前变化视图',
            scopeRefreshCurrentChanges: '刷新当前变化',
            scopeRefreshingCurrentChanges: '正在刷新当前变化...',
            exportFormats: '导出格式',
            exportTypesLabel: '导出类型',
            mhtmlLoadedHint: 'MHTML 使用 Chrome 官方 pageCapture.saveAsMHTML API。它只能保存抓取瞬间浏览器已经加载出来的页面状态；论坛、长列表等虚拟滚动或懒加载内容支持可能不好，未渲染区域可能空白或缺失，当前无法在本地补齐这些未加载内容。',
            exportHelp: '导出配置：固定导出 MHTML 文件到网页快照文件夹；不再生成 ZIP。复核列表由队列批大小控制。',
            exportModeSingleFile: '文件夹直出',
            exportModeBatchZip: '文件夹直出',
            queueBatchSizeLabel: '每批',
            queueBatchSizeTip: '控制每个队列列表最多打开和导出的 URL 数，默认 10。',
            queueBatchSizeUpdated: '队列批大小已更新。',
            queueBatchTitle: '列表',
            queueBatchPrevious: '上一批',
            queueBatchNext: '下一批',
            queueTitle: '网页快照抓取队列',
            queueHelp: '复核设置',
            reviewSettingsIntro: '队列按批大小分成多个列表，复核窗口每次只打开当前列表；自动复核时间只影响停留标记，点击“提交复核”仍会批量确认当前列表。',
            queueHelpAutoWarning: '页面停留达到设置时间后，会自动记为已复核。',
            queueHelpSubmitWarning: '点击“提交复核”就是对当前列表做最终手动批量确认，未逐个停留的条目也会标为已复核。',
            queueHelpWarning: '关闭页面是双向同步：清空队列或在队列里删除条目会关闭对应页面；关闭复核窗口里的页面也会移出对应队列项。',
            reviewSettingsTitle: '复核设置',
            reviewSettingsOpen: '复核设置',
            reviewAutoReviewMsLabel: '自动复核停留时间',
            reviewAutoReviewMsHint: '单位：毫秒；最小 100。设置为 100 毫秒时，基本就是点击页面后立即复核。',
            reviewSettingsCancel: '取消',
            reviewSettingsSave: '保存',
            reviewSettingsSaved: '复核停留时间已更新。',
            queueClear: '清空',
            queueCleared: '抓取队列已清空。',
            queueClearConfirm: '确认清空当前抓取队列与复核状态，并关闭复核窗口吗？',
            queueEmpty: '当前筛选条件下没有待抓取 URL',
            queueSelectScopeFirst: '请先在“选取范围”里勾选至少一项并点击“完成”。',
            queueOps: '操作',
            queueOpDelete: '删除',
            queueOpWhitelistAdd: '进白名单',
            queueOpWhitelistRemove: '移出白名单',
            queueRowDeleted: '已删除队列项。',
            queueRowWhitelistOn: '已加入白名单。',
            queueRowWhitelistOff: '已移出白名单。',
            queueFocusTabFailed: '跳转到对应页面失败',
            colWhitelist: '白名单',
            whitelistOn: '免复核',
            whitelistOff: '需复核',
            tipWhitelistToggle: '加入白名单后可免复核自动抓取。',
            tipQueueClear: '清空当前抓取队列（范围选择/复核状态/锁定队列），并关闭复核窗口。',
            reviewSyncNow: '刷新',
            reviewOpenWindow: '在新窗口打开',
            reviewSubmit: '提交复核',
            reviewNeedSubmit: '请先完成复核：页面停留达到设置时间后会自动确认，或点击“提交复核”手动批量确认。',
            reviewSubmittedReady: '已提交复核，可执行抓取。',
            reviewItemPending: '待复核',
            reviewItemActive: '复核中',
            reviewItemReviewed: '已复核',
            reviewItemExistingTabActive: '活跃页面',
            reviewStateIdle: '尚未开始复核',
            reviewStatePending: '复核中（未提交）',
            reviewStateSubmitted: '已提交复核',
            reviewStateReviewed: '已复核',
            reviewExistingTabModeReady: '已打开页面，可检查后直接提交复核',
            reviewExistingTabUnavailable: '已打开页面不可用，请刷新队列或改用复核窗口。',
            reviewExistingTabPromoteFailed: '当前列表没有全部匹配到已打开页面，请先点击“在新窗口打开”。',
            reviewStateBypassWhitelist: '白名单免复核',
            reviewWindowLabel: '复核窗口',
            reviewWindowMissing: '当前列表需要先点击“在新窗口打开”。',
            reviewQueueChanged: '复核窗口队列发生变化，请重新勾选并提交。',
            reviewQueueReady: '抓取队列已更新，请点击“在新窗口打开”进行复核。',
            reviewSyncFailed: '刷新复核队列失败',
            reviewWindowClosedBatchRemoved: '复核窗口已关闭，对应队列项已移除。',
            tipReviewSyncNow: '手动从复核窗口拉取当前已打开页面，并同步到待抓取队列。',
            tipReviewOpenWindow: '按当前抓取队列在新窗口打开复核页面。',
            tipReviewSubmit: '提交本次复核结果，提交后才允许执行抓取。',
            reviewPreparing: '正在打开复核窗口...',
            reviewReady: '复核窗口已打开，请先人工确认页面，再点击执行抓取。',
            reviewFailed: '打开复核窗口失败',
            reviewBypassReady: '当前队列全部命中白名单，已免复核，可直接执行抓取。',
            reviewSelectedSummary: '已选',
            reviewReviewedSummary: '复核',
            reviewCountBookmarks: '书签',
            reviewCountFolders: '文件夹',
            scopeExistingQueuePrefix: '已存在',
            scopeTitle: '网页快照·选取范围',
            scopeSearchPlaceholder: '搜索当前维度...',
            scopeSameDataHint: '同一批书签数据，切换不同选择视角（树 / 域名 / 子域名）',
            scopeSelectedInDimension: '当前标签已选',
            scopeSelectedTotal: '当前来源已选总数',
            scopeClearCurrentKind: '清空全部',
            scopeDone: '完成',
            scopeListEmpty: '当前维度暂无可选项。',
            scopeDisabled: '当前范围未启用',
            scopeNoBookmarkData: '当前没有可抓取书签。',
            scopeNoChangeData: '当前没有可抓取的变化书签。',
            scopeLazyLoading: '滚动加载更多...',
            scopeLazyLoaded: '已加载',
            scopeLazyAllLoaded: '当前维度已全部加载',
            sourceLabelBookmarkApi: '全量书签',
            sourceLabelCurrentChanges: '当前变化',
            sourceLabelAllTabs: '所有窗口Tab',
            rootFolderLabel: '（根目录）',
            rootSubdomainLabel: '（无子域名）',
            scopeNoTabData: '当前没有可抓取的已打开页面。',
            scopeRefreshingAllTabs: '正在刷新所有窗口Tab...',
            scopeWhitelistEmpty: '当前还没有白名单条目。',
            scopeWhitelistAddDomain: '域名全白',
            scopeWhitelistAddSubdomain: '子域名全白',
            scopeWhitelistRemoveUrl: '移除URL',
            scopeWhitelistByDomainOn: '该域名已加入白名单规则。',
            scopeWhitelistByDomainOff: '该域名已移出白名单规则。',
            scopeWhitelistBySubdomainOn: '该子域名已加入白名单规则。',
            scopeWhitelistBySubdomainOff: '该子域名已移出白名单规则。',
            scopeWhitelistCleared: '白名单已清空。',
            scopeWhitelistBadge: '白名单',
            fmtMhtml: 'MHTML',
            fmtMhtmlOfficial: '官方 MHTML API',
            runBlockedNoFormat: '请至少选择一种导出格式。',
            runBlockedNoQueue: '当前没有可执行的 URL。',
            colIndex: '#',
            colOps: '操作',
            colTitle: '名字',
            colUrl: 'URL',
            colFolder: '文件夹路径',
            colDomain: '域名',
            colSubdomain: '子域名',
            colAction: '来源',
            colStatus: '状态',
            statusOk: '成功',
            statusPartial: '部分成功',
            statusFail: '失败',
            recoveryTitle: '抓取稳定性状态',
            recoveryNone: '暂无抓取运行记录。',
            recoveryRunId: '任务 ID',
            recoveryState: '任务状态',
            recoveryStartedAt: '开始时间',
            recoveryUpdatedAt: '最近更新时间',
            recoveryTargetFolder: '导出目录',
            recoveryMode: '导出模式',
            recoveryBatchProgress: '批次进度',
            recoveryPending: '待处理',
            recoveryResume: '恢复未完成任务',
            recoveryRefresh: '刷新抓取状态',
            recoveryStatusRunning: '运行中',
            recoveryStatusInterrupted: '已中断',
            recoveryStatusPaused: '已暂停',
            recoveryStatusCancelled: '已撤销',
            recoveryStatusCompleted: '已完成',
            recoveryStatusFailed: '执行失败',
            recoveryStatusUnknown: '未知状态',
            recoveryHintResumable: '检测到可恢复任务：可继续执行未完成项（失败项/未完成项）。',
            recoveryHintNoResume: '当前没有可恢复的未完成任务。',
            recoveryHintCancelled: '任务已撤销。如需重新执行，请直接点击“开始”。',
            recoveryResumeStart: '正在恢复未完成任务...',
            recoveryResumeDone: '恢复任务完成',
            recoveryResumeFailed: '恢复任务失败',
            tipRecoveryResume: '继续未完成任务，已成功项会按恢复策略跳过。',
            tipRecoveryRefresh: '刷新抓取运行状态与恢复提示。',
            parseError: '书签数据解析失败',
            invalidRuntime: '扩展运行环境不可用',
            unknown: '未知'
        },
        en: {
            navTitle: 'Web Snapshot',
            navDesc: 'Source: Current Changes / Bookmark Tree / All Window Tabs -> pick scope and click Done to update queue -> click Open in New Window for review, then submit before MHTML capture/export',
            navHelp: 'Pick scope and click Done to update the queue, then click Open in New Window to manually verify pages before MHTML capture/export; whitelisted URLs can bypass review.',
            refreshSource: 'Refresh Bookmark Source',
            runCapture: 'Run Capture & Export',
            runStartBtn: 'Start',
            runPauseBtn: 'Pause',
            runCancelBtn: 'Cancel',
            pickScope: 'Pick Scope',
            clearFilters: 'Clear Filters',
            tipRefreshSource: 'Reload queue data from bookmark source without running capture.',
            tipRunCapture: 'Run capture/export for the currently filtered queue.',
            tipRunStart: 'Start capture/export for the current queue.',
            tipRunPause: 'Pause the active capture task.',
            tipRunCancel: 'Cancel the active capture task without clearing the queue.',
            tipPickScope: 'Open scope panel and choose the execution range.',
            tipClearFilters: 'Clear scope filters and restore the full queue.',
            loading: 'Loading bookmark source...',
            noChanges: 'No bookmarks are available for capture.',
            sourceError: 'Failed to read bookmark source',
            sourcePartialError: 'Part of range sources failed to load',
            runStart: 'Capture task started...',
            runPausing: 'Requesting pause...',
            runCanceling: 'Requesting cancel...',
            runDone: 'Capture task finished',
            runPaused: 'Capture task paused',
            runCancelled: 'Capture task canceled',
            runFailed: 'Capture task failed',
            runPauseFailed: 'Pause failed',
            runCancelFailed: 'Cancel failed',
            runControlNoActive: 'No capture task is currently running.',
            dimBookmark: 'Bookmark',
            dimFolder: 'Bookmark Tree',
            dimCurrentChanges: 'Current Changes',
            dimDomain: 'Domain',
            dimSubdomain: 'Subdomain',
            dimAllTabs: 'All Window Tabs Pages',
            dimWhitelist: 'Whitelist',
            changesModeSimple: 'Simple',
            changesModeDetailed: 'Detailed',
            changesModeCollection: 'Collection',
            scopeCurrentChangesModePrefix: 'Following Current Changes View',
            scopeRefreshCurrentChanges: 'Refresh Current Changes',
            scopeRefreshingCurrentChanges: 'Refreshing Current Changes...',
            exportFormats: 'Export Formats',
            exportTypesLabel: 'Format Types',
            mhtmlLoadedHint: 'MHTML uses Chrome\'s official pageCapture.saveAsMHTML API. It can only save the page state already loaded in the browser at capture time; forums, long lists, virtual scrolling, and lazy-loaded content may be incomplete or blank, and this local capture flow cannot reconstruct content that was never loaded.',
            exportHelp: 'Export setup: MHTML files are written directly to the Web Snapshot folder; ZIP output is no longer generated. Review lists still follow the queue batch size.',
            exportModeSingleFile: 'Folder Files',
            exportModeBatchZip: 'Folder Files',
            queueBatchSizeLabel: 'Batch',
            queueBatchSizeTip: 'Controls the maximum URLs opened and exported per queue list. Default is 10.',
            queueBatchSizeUpdated: 'Queue batch size updated.',
            queueBatchTitle: 'List',
            queueBatchPrevious: 'Previous batch',
            queueBatchNext: 'Next batch',
            queueTitle: 'Web Snapshot Capture Queue',
            queueHelp: 'Review settings',
            reviewSettingsIntro: 'The queue is split into lists by batch size, and the review window opens only the current list. Auto-review time only affects dwell marking; "Submit Review" still batch-confirms the current list.',
            queueHelpAutoWarning: 'A page is marked reviewed automatically after staying open for the configured time.',
            queueHelpSubmitWarning: '"Submit Review" is the final manual batch confirmation for the current list, so items not visited one by one are also marked reviewed.',
            queueHelpWarning: 'Page closing is bidirectional: clearing the queue or deleting a queue row closes the matching page; closing a review-window page removes the matching queue row.',
            reviewSettingsTitle: 'Review Settings',
            reviewSettingsOpen: 'Review Settings',
            reviewAutoReviewMsLabel: 'Auto-review dwell time',
            reviewAutoReviewMsHint: 'Unit: milliseconds; minimum 100. At 100 ms, clicking a page is effectively enough to review it.',
            reviewSettingsCancel: 'Cancel',
            reviewSettingsSave: 'Save',
            reviewSettingsSaved: 'Review dwell time updated.',
            queueClear: 'Clear',
            queueCleared: 'Capture queue cleared.',
            queueClearConfirm: 'Clear current capture queue and review state, and close the review window?',
            queueEmpty: 'No URL matches the current filter set',
            queueSelectScopeFirst: 'Pick at least one item in Scope Picker and click Done.',
            queueOps: 'Actions',
            queueOpDelete: 'Delete',
            queueOpWhitelistAdd: 'Whitelist',
            queueOpWhitelistRemove: 'Unwhitelist',
            queueRowDeleted: 'Queue item deleted.',
            queueRowWhitelistOn: 'Added to whitelist.',
            queueRowWhitelistOff: 'Removed from whitelist.',
            queueFocusTabFailed: 'Failed to jump to the matching page',
            colWhitelist: 'Whitelist',
            whitelistOn: 'Bypass',
            whitelistOff: 'Review',
            tipWhitelistToggle: 'Whitelisted URLs bypass manual review in automated capture.',
            tipQueueClear: 'Clear current capture queue (scope/review/locked queue) and close the review window.',
            reviewSyncNow: 'Refresh',
            reviewOpenWindow: 'Open in New Window',
            reviewSubmit: 'Submit Review',
            reviewNeedSubmit: 'Complete review first: stay on each page for the configured time, or click "Submit Review" to batch-confirm manually.',
            reviewSubmittedReady: 'Review submitted. Ready to run capture.',
            reviewItemPending: 'Pending Review',
            reviewItemActive: 'Reviewing',
            reviewItemReviewed: 'Reviewed',
            reviewItemExistingTabActive: 'Active Page',
            reviewStateIdle: 'Review not started',
            reviewStatePending: 'Review in progress (not submitted)',
            reviewStateSubmitted: 'Review submitted',
            reviewStateReviewed: 'Reviewed',
            reviewExistingTabModeReady: 'Opened pages are ready. Check them and submit review directly',
            reviewExistingTabUnavailable: 'Opened pages are unavailable. Refresh the queue or use the review window.',
            reviewExistingTabPromoteFailed: 'Not every item in this list matches an opened page. Click "Open in New Window" first.',
            reviewStateBypassWhitelist: 'Whitelist Bypass',
            reviewWindowLabel: 'Review Window',
            reviewWindowMissing: 'This list needs "Open in New Window" first.',
            reviewQueueChanged: 'Review queue changed. Please re-check and submit again.',
            reviewQueueReady: 'Queue updated. Click "Open in New Window" to start review.',
            reviewSyncFailed: 'Failed to refresh review queue',
            reviewWindowClosedBatchRemoved: 'Review window closed. Matching queue items were removed.',
            tipReviewSyncNow: 'Manually pull currently open pages from the review window and sync them to the queue.',
            tipReviewOpenWindow: 'Open review pages in a new window for the current queue.',
            tipReviewSubmit: 'Submit review result. Capture is blocked before submission.',
            reviewPreparing: 'Opening review window...',
            reviewReady: 'Review window is ready. Verify pages first, then run capture.',
            reviewFailed: 'Failed to open review window',
            reviewBypassReady: 'All queued URLs are whitelisted. Review is bypassed and capture can run directly.',
            reviewSelectedSummary: 'Selected',
            reviewReviewedSummary: 'Reviewed',
            reviewCountBookmarks: 'Bookmarks',
            reviewCountFolders: 'Folders',
            scopeExistingQueuePrefix: 'Existing',
            scopeTitle: 'Web Snapshot Scope Picker',
            scopeSearchPlaceholder: 'Search in current dimension...',
            scopeSameDataHint: 'Same bookmark dataset, different selection views (Tree / Domain / Subdomain)',
            scopeSelectedInDimension: 'Selected In Current Tab',
            scopeSelectedTotal: 'Total Selected In Current Source',
            scopeClearCurrentKind: 'Clear All',
            scopeDone: 'Done',
            scopeListEmpty: 'No options in current dimension.',
            scopeDisabled: 'This scope is disabled',
            scopeNoBookmarkData: 'No bookmark is available for capture.',
            scopeNoChangeData: 'No changed bookmark is available for capture.',
            scopeLazyLoading: 'Scroll to load more...',
            scopeLazyLoaded: 'Loaded',
            scopeLazyAllLoaded: 'All options loaded',
            sourceLabelBookmarkApi: 'Full Bookmarks',
            sourceLabelCurrentChanges: 'Current Changes',
            sourceLabelAllTabs: 'All Window Tabs',
            rootFolderLabel: '(Root)',
            rootSubdomainLabel: '(No subdomain)',
            scopeNoTabData: 'No open tab page is available for capture.',
            scopeRefreshingAllTabs: 'Refreshing all window tabs...',
            scopeWhitelistEmpty: 'No whitelist entries yet.',
            scopeWhitelistAddDomain: 'Whitelist Domain',
            scopeWhitelistAddSubdomain: 'Whitelist Subdomain',
            scopeWhitelistRemoveUrl: 'Remove URL',
            scopeWhitelistByDomainOn: 'Domain rule added to whitelist.',
            scopeWhitelistByDomainOff: 'Domain rule removed from whitelist.',
            scopeWhitelistBySubdomainOn: 'Subdomain rule added to whitelist.',
            scopeWhitelistBySubdomainOff: 'Subdomain rule removed from whitelist.',
            scopeWhitelistCleared: 'Whitelist cleared.',
            scopeWhitelistBadge: 'Whitelisted',
            fmtMhtml: 'MHTML',
            fmtMhtmlOfficial: 'Official MHTML API',
            runBlockedNoFormat: 'Pick at least one export format.',
            runBlockedNoQueue: 'No URLs available to run.',
            colIndex: '#',
            colOps: 'Ops',
            colTitle: 'Name',
            colUrl: 'URL',
            colFolder: 'Folder Path',
            colDomain: 'Domain',
            colSubdomain: 'Subdomain',
            colAction: 'Source',
            colStatus: 'Status',
            statusOk: 'Success',
            statusPartial: 'Partial',
            statusFail: 'Failed',
            recoveryTitle: 'Capture Stability State',
            recoveryNone: 'No capture run record yet.',
            recoveryRunId: 'Run ID',
            recoveryState: 'Run State',
            recoveryStartedAt: 'Started At',
            recoveryUpdatedAt: 'Updated At',
            recoveryTargetFolder: 'Export Folder',
            recoveryMode: 'Export Mode',
            recoveryBatchProgress: 'Batch Progress',
            recoveryPending: 'Pending',
            recoveryResume: 'Resume Unfinished Run',
            recoveryRefresh: 'Refresh Capture State',
            recoveryStatusRunning: 'Running',
            recoveryStatusInterrupted: 'Interrupted',
            recoveryStatusPaused: 'Paused',
            recoveryStatusCancelled: 'Canceled',
            recoveryStatusCompleted: 'Completed',
            recoveryStatusFailed: 'Failed',
            recoveryStatusUnknown: 'Unknown',
            recoveryHintResumable: 'A resumable run was found. You can continue unfinished/failed items.',
            recoveryHintNoResume: 'No unfinished run is available to resume.',
            recoveryHintCancelled: 'Run was canceled. Click Start to run again.',
            recoveryResumeStart: 'Resuming unfinished run...',
            recoveryResumeDone: 'Resume finished',
            recoveryResumeFailed: 'Resume failed',
            tipRecoveryResume: 'Continue unfinished work. Completed items are skipped by resume strategy.',
            tipRecoveryRefresh: 'Refresh capture run state and resumable hint.',
            parseError: 'Failed to parse bookmark payload',
            invalidRuntime: 'Extension runtime unavailable',
            unknown: 'Unknown'
        }
    };

    function getLangKey() {
        return window.currentLang === 'en' ? 'en' : 'zh_CN';
    }

    function t(key) {
        const lang = getLangKey();
        return (i18n[lang] && i18n[lang][key]) || i18n.zh_CN[key] || key;
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getCurrentViewSafe() {
        try {
            if (typeof currentView === 'string' && currentView) return currentView;
        } catch (_) { }
        return '';
    }

    function getActiveRoot() {
        return document.getElementById('dev1App');
    }

    function setStatus(text, type = '') {
        const statusEl = document.getElementById('dev1Status');
        const message = String(text || '').trim();
        const normalizedTypeRaw = String(type || '').trim().toLowerCase();
        const normalizedType = (normalizedTypeRaw === 'error'
            || normalizedTypeRaw === 'success'
            || normalizedTypeRaw === 'warning'
            || normalizedTypeRaw === 'info')
            ? normalizedTypeRaw
            : '';
        if (statusEl) {
            statusEl.textContent = message;
            statusEl.classList.remove('error', 'success', 'warning');
            if (normalizedType === 'error') statusEl.classList.add('error');
            if (normalizedType === 'success') statusEl.classList.add('success');
            if (normalizedType === 'warning') statusEl.classList.add('warning');
        }
        if (!message) return;
        if (!statusEl && normalizedType && typeof window.showToast === 'function') {
            window.showToast(message, normalizedType, 2000);
        }
    }

    function normalizeChangesViewMode(mode, fallback = 'collection') {
        const value = String(mode || '').trim().toLowerCase();
        if (CHANGES_VIEW_MODE_KEYS.includes(value)) return value;
        const safeFallback = String(fallback || '').trim().toLowerCase();
        return CHANGES_VIEW_MODE_KEYS.includes(safeFallback) ? safeFallback : 'collection';
    }

    function getLiveCurrentChangesExportMode() {
        try {
            const previewRoot = document.getElementById('changesTreePreviewInline');
            const rememberedModeRaw = String(window.__currentChangesPreviewMode || '').trim();
            const hasRememberedMode = rememberedModeRaw.length > 0;
            if (!previewRoot && !hasRememberedMode) return '';

            let previewMode = '';
            if (previewRoot && typeof window.__getChangesPreviewMode === 'function') {
                previewMode = String(window.__getChangesPreviewMode() || '').trim().toLowerCase();
            } else if (hasRememberedMode) {
                previewMode = rememberedModeRaw.toLowerCase();
            }

            if (previewMode === 'collection') return 'collection';
            if (previewMode === 'detailed') return 'detailed';
            if (previewMode === 'compact' || previewMode === 'simple') return 'simple';
            return '';
        } catch (_) {
            return '';
        }
    }

    async function fetchCurrentChangesPayloadFromVisualSource(options = {}) {
        const forceRefresh = options && options.forceRefresh === true;
        if (typeof window.__buildCurrentChangesVisualPayloadForDev1 !== 'function') return null;

        try {
            const response = await window.__buildCurrentChangesVisualPayloadForDev1({ forceRefresh });
            if (!response || response.success !== true || !response.payload || typeof response.payload !== 'object') {
                return null;
            }

            const resolvedMode = normalizeChangesViewMode(response?.mode, 'collection');
            if (state.scopeUi && typeof state.scopeUi === 'object') {
                state.scopeUi.currentChangesResolvedMode = resolvedMode;
            }

            return {
                payload: response.payload,
                mode: resolvedMode
            };
        } catch (_) {
            return null;
        }
    }

    function clearAllScopeSelections() {
        SOURCE_KEYS.forEach((sourceKey) => {
            const sourceState = getSourceState(sourceKey);
            FILTER_KEYS.forEach((kind) => {
                sourceState.filters[kind].clear();
            });
        });
        resetWorkflowSteps();
    }

    function resetScopePanelSessionState({ clearSelections = false, keepChangesMode = true } = {}) {
        const previousMode = normalizeChangesViewMode(state.scopeUi?.currentChangesResolvedMode, 'collection');
        state.scopeUi = createScopeUiState();
        if (keepChangesMode) {
            state.scopeUi.currentChangesResolvedMode = previousMode;
        }
        if (clearSelections) {
            clearAllScopeSelections();
            applyAllFilters();
        }
    }

    function normalizeQueueMetadataIndex(value) {
        if (value == null || String(value).trim() === '') return null;
        const number = Number(value);
        if (!Number.isFinite(number) || number < 0) return null;
        return Math.floor(number);
    }

    function normalizeQueueItem(rawItem) {
        const url = String(rawItem?.url || '').trim();
        if (!url) return null;

        const parsedUrl = normalizeUrl(url);
        const inferredHost = String(parsedUrl?.hostname || '').trim().toLowerCase().replace(/^www\./, '');
        const rawHost = String(rawItem?.host || rawItem?.domain || '').trim().toLowerCase();
        const host = rawHost || inferredHost;
        const domainParts = getDomainParts(host);
        const domain = String(rawItem?.domain || '').trim().toLowerCase() || domainParts.domain || domainParts.host || '';
        const rawSubdomain = String(rawItem?.subdomain || '').trim().toLowerCase();
        const subdomain = rawSubdomain || (domainParts.hasSubdomain ? domainParts.host : '__root__');
        const rawSubdomainLabel = String(rawItem?.subdomainLabel || '').trim();
        const subdomainLabel = rawSubdomainLabel || (subdomain === '__root__' ? t('rootSubdomainLabel') : subdomain);

        const existingTabIdRaw = Number(rawItem?.existingTabId);
        const existingTabId = Number.isFinite(existingTabIdRaw) ? Math.floor(existingTabIdRaw) : null;
        const reviewWindowIdRaw = Number(rawItem?.reviewWindowId);
        const reviewWindowId = Number.isFinite(reviewWindowIdRaw) ? Math.floor(reviewWindowIdRaw) : null;
        const rawLastAccessed = Number(rawItem?.reviewLastAccessed ?? rawItem?.lastAccessed);
        const reviewLastAccessed = Number.isFinite(rawLastAccessed) ? Math.floor(rawLastAccessed) : 0;
        const queueBatchIndex = normalizeQueueMetadataIndex(rawItem?.queueBatchIndex);
        const queueBatchPosition = normalizeQueueMetadataIndex(rawItem?.queueBatchPosition);
        const queueDisplayIndex = normalizeQueueMetadataIndex(rawItem?.queueDisplayIndex);
        return {
            title: String(rawItem?.title || '').trim() || url,
            url,
            folderPath: String(rawItem?.folderPath || '').trim(),
            domain,
            subdomain,
            subdomainLabel,
            actionText: String(rawItem?.actionText || '').trim(),
            host,
            sourceLabel: String(rawItem?.sourceLabel || '').trim(),
            reviewWindowId,
            existingTabId,
            useExistingTab: existingTabId != null && rawItem?.useExistingTab === true,
            reviewed: rawItem?.reviewed === true,
            reviewedAt: String(rawItem?.reviewedAt || '').trim(),
            reviewWindowActive: rawItem?.reviewWindowActive === true || rawItem?.active === true,
            reviewLastAccessed,
            queueBatchIndex,
            queueBatchPosition,
            queueDisplayIndex
        };
    }

    function cloneQueueItems(items) {
        if (!Array.isArray(items)) return [];
        const queue = [];
        const seen = new Set();
        items.forEach((item) => {
            const normalized = normalizeQueueItem(item);
            if (!normalized) return;
            const key = String(normalized.url || '').trim();
            if (!key || seen.has(key)) return;
            seen.add(key);
            queue.push(normalized);
        });
        return queue;
    }

    function buildQueueSignature(items) {
        const list = cloneQueueItems(items);
        const parts = list.map((item) => {
            const tabId = Number.isFinite(Number(item?.existingTabId))
                ? Math.floor(Number(item.existingTabId))
                : -1;
            return `${tabId}::${String(item?.url || '').trim()}`;
        }).filter(Boolean).sort();
        return parts.join('|');
    }

    function buildQueueReviewStateSignature(items) {
        const list = cloneQueueItems(items);
        const parts = list.map((item) => {
            const key = getReviewQueueItemKey(item);
            if (!key) return '';
            return `${key}::${item?.reviewed === true ? '1' : '0'}::${item?.reviewWindowActive === true ? '1' : '0'}`;
        }).filter(Boolean).sort();
        return parts.join('|');
    }

    function normalizeWhitelistKey(rawUrl) {
        const value = String(rawUrl || '').trim();
        if (!value) return '';
        try {
            const parsed = new URL(value);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
            return parsed.toString();
        } catch (_) {
            return '';
        }
    }

    function normalizeExistingTabMatchKey(rawUrl) {
        const value = String(rawUrl || '').trim();
        if (!value) return '';
        try {
            const parsed = new URL(value);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
            parsed.hash = '';
            return parsed.toString();
        } catch (_) {
            return '';
        }
    }

    function normalizeWhitelistKeys(raw) {
        const set = new Set();
        if (!Array.isArray(raw)) return set;
        raw.forEach((entry) => {
            const key = normalizeWhitelistKey(entry);
            if (key) set.add(key);
        });
        return set;
    }

    function normalizeDomainWhitelistKey(rawDomain) {
        return String(rawDomain || '').trim().toLowerCase().replace(/^www\./, '');
    }

    function normalizeSubdomainWhitelistKey(rawSubdomain) {
        const value = String(rawSubdomain || '').trim().toLowerCase().replace(/^www\./, '');
        if (!value || value === '__root__') return '';
        return value;
    }

    function normalizeWhitelistRuleKeys(raw, normalizeFn) {
        const set = new Set();
        if (!Array.isArray(raw) || typeof normalizeFn !== 'function') return set;
        raw.forEach((entry) => {
            const key = normalizeFn(entry);
            if (key) set.add(key);
        });
        return set;
    }

    function loadSavedWhitelist() {
        try {
            const raw = localStorage.getItem(DEV1_WHITELIST_STORAGE_KEY);
            if (!raw) {
                state.whitelistKeys = new Set();
                state.whitelistDomainKeys = new Set();
                state.whitelistSubdomainKeys = new Set();
                return;
            }
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                state.whitelistKeys = normalizeWhitelistKeys(parsed);
                state.whitelistDomainKeys = new Set();
                state.whitelistSubdomainKeys = new Set();
                return;
            }
            state.whitelistKeys = normalizeWhitelistKeys(parsed?.urls);
            state.whitelistDomainKeys = normalizeWhitelistRuleKeys(parsed?.domains, normalizeDomainWhitelistKey);
            state.whitelistSubdomainKeys = normalizeWhitelistRuleKeys(parsed?.subdomains, normalizeSubdomainWhitelistKey);
        } catch (_) {
            state.whitelistKeys = new Set();
            state.whitelistDomainKeys = new Set();
            state.whitelistSubdomainKeys = new Set();
        }
    }

    function persistWhitelist() {
        try {
            const urls = Array.from(state.whitelistKeys || [])
                .map(entry => normalizeWhitelistKey(entry))
                .filter(Boolean)
                .sort();
            const domains = Array.from(state.whitelistDomainKeys || [])
                .map(entry => normalizeDomainWhitelistKey(entry))
                .filter(Boolean)
                .sort();
            const subdomains = Array.from(state.whitelistSubdomainKeys || [])
                .map(entry => normalizeSubdomainWhitelistKey(entry))
                .filter(Boolean)
                .sort();

            if (!urls.length && !domains.length && !subdomains.length) {
                localStorage.removeItem(DEV1_WHITELIST_STORAGE_KEY);
                return;
            }
            localStorage.setItem(DEV1_WHITELIST_STORAGE_KEY, JSON.stringify({
                urls,
                domains,
                subdomains
            }));
        } catch (_) { }
    }

    function resolveQueueItemDomainSubdomain(item) {
        const domainFromItem = normalizeDomainWhitelistKey(item?.domain || '');
        const subdomainFromItem = normalizeSubdomainWhitelistKey(item?.subdomain || '');
        if (domainFromItem || subdomainFromItem) {
            return {
                domain: domainFromItem,
                subdomain: subdomainFromItem
            };
        }

        const parsed = normalizeUrl(item?.url || '');
        const host = String(parsed?.hostname || '').trim().toLowerCase().replace(/^www\./, '');
        const domainParts = getDomainParts(host);
        return {
            domain: normalizeDomainWhitelistKey(domainParts.domain || domainParts.host || ''),
            subdomain: normalizeSubdomainWhitelistKey(domainParts.hasSubdomain ? domainParts.host : '')
        };
    }

    function isQueueItemDomainWhitelisted(item) {
        const domainKey = resolveQueueItemDomainSubdomain(item).domain;
        if (!domainKey) return false;
        return state.whitelistDomainKeys instanceof Set && state.whitelistDomainKeys.has(domainKey);
    }

    function isQueueItemSubdomainWhitelisted(item) {
        const subdomainKey = resolveQueueItemDomainSubdomain(item).subdomain;
        if (!subdomainKey) return false;
        return state.whitelistSubdomainKeys instanceof Set && state.whitelistSubdomainKeys.has(subdomainKey);
    }

    function isQueueItemWhitelisted(item) {
        const key = normalizeWhitelistKey(item?.url || '');
        const byUrl = key && state.whitelistKeys instanceof Set && state.whitelistKeys.has(key);
        if (byUrl) return true;
        if (isQueueItemSubdomainWhitelisted(item)) return true;
        if (isQueueItemDomainWhitelisted(item)) return true;
        return false;
    }

    function setQueueItemWhitelist(rawUrl, enabled) {
        const key = normalizeWhitelistKey(rawUrl);
        if (!key) return;
        if (!(state.whitelistKeys instanceof Set)) {
            state.whitelistKeys = new Set();
        }
        if (enabled) {
            state.whitelistKeys.add(key);
        } else {
            state.whitelistKeys.delete(key);
        }
        persistWhitelist();
    }

    function setQueueDomainWhitelist(rawDomain, enabled) {
        const key = normalizeDomainWhitelistKey(rawDomain);
        if (!key) return;
        if (!(state.whitelistDomainKeys instanceof Set)) {
            state.whitelistDomainKeys = new Set();
        }
        if (enabled) {
            state.whitelistDomainKeys.add(key);
        } else {
            state.whitelistDomainKeys.delete(key);
        }
        persistWhitelist();
    }

    function setQueueSubdomainWhitelist(rawSubdomain, enabled) {
        const key = normalizeSubdomainWhitelistKey(rawSubdomain);
        if (!key) return;
        if (!(state.whitelistSubdomainKeys instanceof Set)) {
            state.whitelistSubdomainKeys = new Set();
        }
        if (enabled) {
            state.whitelistSubdomainKeys.add(key);
        } else {
            state.whitelistSubdomainKeys.delete(key);
        }
        persistWhitelist();
    }

    function getQueueReviewRequiredCount(items) {
        if (!Array.isArray(items) || items.length === 0) return 0;
        let count = 0;
        items.forEach((item) => {
            if (!isQueueItemWhitelisted(item)) {
                count += 1;
            }
        });
        return count;
    }

    function shouldBypassReviewForQueue(items) {
        return Array.isArray(items)
            && items.length > 0
            && getQueueReviewRequiredCount(items) === 0;
    }

    function getBookmarkFolderCounts(items) {
        const list = Array.isArray(items) ? items : [];
        const bookmarkCount = list.length;
        const folderSet = new Set();
        list.forEach((item) => {
            const folderPath = String(item?.folderPath || '').trim();
            if (folderPath) folderSet.add(folderPath);
        });
        return {
            bookmarkCount,
            folderCount: folderSet.size
        };
    }

    function getScopeSelectionSummaryCounts(sourceState, kind, whitelistCount = 0) {
        if (kind === 'whitelist') {
            return {
                bookmarkCount: Math.max(0, Number(whitelistCount) || 0),
                folderCount: 0
            };
        }

        const bookmarkSelectedCount = Number(sourceState?.filters?.bookmark?.size) || 0;
        const folderSelectedCount = Number(sourceState?.filters?.folder?.size) || 0;
        if (bookmarkSelectedCount > 0 || folderSelectedCount > 0) {
            return {
                bookmarkCount: bookmarkSelectedCount,
                folderCount: folderSelectedCount
            };
        }

        return getBookmarkFolderCounts(sourceState?.filteredItems || []);
    }

    function getScopeExistingQueueMatchCounts(sourceState, kind) {
        if (kind === 'whitelist') {
            return {
                bookmarkCount: 0,
                folderCount: 0
            };
        }

        const queueUrlKeys = new Set(
            cloneQueueItems(state.lockedQueueItems)
                .map(item => getQueueItemStableKey(item))
                .filter(Boolean)
        );
        if (queueUrlKeys.size === 0) {
            return {
                bookmarkCount: 0,
                folderCount: 0
            };
        }

        const selectedItems = Array.isArray(sourceState?.filteredItems) ? sourceState.filteredItems : [];
        const matchedItems = selectedItems
            .filter((item) => queueUrlKeys.has(normalizeWhitelistKey(item?.url || '')));
        return getBookmarkFolderCounts(matchedItems);
    }

    function normalizeReviewSession(raw) {
        const hasWindowId = raw?.windowId != null && String(raw.windowId).trim() !== '';
        const rawWindowId = hasWindowId ? Number(raw.windowId) : NaN;
        const windowId = Number.isFinite(rawWindowId) ? Math.floor(rawWindowId) : null;
        const batchKeys = Array.isArray(raw?.batchKeys)
            ? Array.from(new Set(raw.batchKeys.map(v => String(v || '').trim()).filter(Boolean)))
            : [];
        const initialBatchKeys = Array.isArray(raw?.initialBatchKeys)
            ? Array.from(new Set(raw.initialBatchKeys.map(v => String(v || '').trim()).filter(Boolean)))
            : [];
        return {
            windowId: windowId != null ? windowId : null,
            acknowledged: raw?.acknowledged === true,
            submitted: raw?.submitted === true,
            submittedAt: String(raw?.submittedAt || '').trim(),
            lastSyncedAt: String(raw?.lastSyncedAt || '').trim(),
            queueSignature: String(raw?.queueSignature || '').trim(),
            batchKeys,
            initialBatchKeys
        };
    }

    function normalizeQueueBatchSize(value) {
        if (value == null || String(value).trim() === '') return QUEUE_BATCH_SIZE_DEFAULT;
        const size = Number(value);
        if (!Number.isFinite(size)) return QUEUE_BATCH_SIZE_DEFAULT;
        return Math.max(QUEUE_BATCH_SIZE_MIN, Math.min(QUEUE_BATCH_SIZE_MAX, Math.floor(size)));
    }

    function normalizeReviewAutoReviewMs(value) {
        if (value == null || String(value).trim() === '') return REVIEW_AUTO_REVIEW_DEFAULT_MS;
        const duration = Number(value);
        if (!Number.isFinite(duration)) return REVIEW_AUTO_REVIEW_DEFAULT_MS;
        return Math.max(REVIEW_AUTO_REVIEW_MIN_MS, Math.min(REVIEW_AUTO_REVIEW_MAX_MS, Math.floor(duration)));
    }

    function getReviewAutoReviewMs() {
        state.reviewAutoReviewMs = normalizeReviewAutoReviewMs(state.reviewAutoReviewMs);
        return state.reviewAutoReviewMs;
    }

    function getReviewAutoReviewHelpText() {
        return getLangKey() === 'en'
            ? 'A page is marked reviewed automatically after staying open for X ms.'
            : '页面停留达到 X 毫秒后，会自动记为已复核。';
    }

    function loadSavedReviewAutoReviewMs() {
        try {
            const raw = localStorage.getItem(DEV1_REVIEW_AUTO_REVIEW_MS_STORAGE_KEY);
            state.reviewAutoReviewMs = normalizeReviewAutoReviewMs(raw);
        } catch (_) {
            state.reviewAutoReviewMs = REVIEW_AUTO_REVIEW_DEFAULT_MS;
        }
    }

    function persistReviewAutoReviewMs() {
        try {
            localStorage.setItem(DEV1_REVIEW_AUTO_REVIEW_MS_STORAGE_KEY, String(getReviewAutoReviewMs()));
        } catch (_) { }
    }

    function setReviewAutoReviewMs(value) {
        const nextDuration = normalizeReviewAutoReviewMs(value);
        state.reviewAutoReviewMs = nextDuration;
        persistReviewAutoReviewMs();
        return nextDuration;
    }

    function loadSavedQueueBatchSize() {
        try {
            const raw = localStorage.getItem(DEV1_QUEUE_BATCH_SIZE_STORAGE_KEY);
            state.queueBatchSize = normalizeQueueBatchSize(raw);
        } catch (_) {
            state.queueBatchSize = QUEUE_BATCH_SIZE_DEFAULT;
        }
    }

    function persistQueueBatchSize() {
        try {
            localStorage.setItem(DEV1_QUEUE_BATCH_SIZE_STORAGE_KEY, String(normalizeQueueBatchSize(state.queueBatchSize)));
        } catch (_) { }
    }

    function setQueueBatchSize(value) {
        const nextSize = normalizeQueueBatchSize(value);
        if (state.queueBatchSize === nextSize) return;
        state.queueBatchSize = nextSize;
        state.queueBatchIndex = 0;
        if (Array.isArray(state.lockedQueueItems) && state.lockedQueueItems.length > 0) {
            state.lockedQueueItems = assignQueueBatchMetadata(state.lockedQueueItems, nextSize, { force: true });
            persistQueueSnapshot();
        }
        persistQueueBatchSize();
    }

    function loadSavedReviewSession() {
        try {
            const raw = localStorage.getItem(DEV1_REVIEW_STORAGE_KEY);
            if (!raw) {
                state.reviewSession = createEmptyReviewSession();
                return;
            }
            const parsed = JSON.parse(raw);
            state.reviewSession = normalizeReviewSession(parsed);
        } catch (_) {
            state.reviewSession = createEmptyReviewSession();
        }
    }

    function persistReviewSession() {
        try {
            const session = normalizeReviewSession(state.reviewSession || {});
            if (session.windowId == null) {
                localStorage.removeItem(DEV1_REVIEW_STORAGE_KEY);
                return;
            }
            localStorage.setItem(DEV1_REVIEW_STORAGE_KEY, JSON.stringify(session));
        } catch (_) { }
    }

    function setReviewSession(next) {
        const merged = {
            ...normalizeReviewSession(state.reviewSession || {}),
            ...(next && typeof next === 'object' ? next : {})
        };
        state.reviewSession = normalizeReviewSession(merged);
        persistReviewSession();
    }

    function clearReviewSession() {
        state.reviewSession = createEmptyReviewSession();
        persistReviewSession();
        cancelReviewSyncTimers();
        clearReviewTrackingState();
        state.reviewWindowClosePreserveId = null;
        markWorkflowStep('openDone', false);
        markWorkflowStep('submitDone', false);
    }

    function getReviewWindowId() {
        const raw = Number(state.reviewSession?.windowId);
        return Number.isFinite(raw) ? Math.floor(raw) : null;
    }

    function isReviewSubmitted() {
        return state.reviewSession?.submitted === true;
    }

    function clearReviewAutoReviewTimer() {
        if (state.reviewAutoReviewTimerId != null) {
            clearTimeout(state.reviewAutoReviewTimerId);
        }
        state.reviewAutoReviewTimerId = null;
    }

    function cancelReviewSyncTimers() {
        if (state.reviewSyncEventTimerId != null) {
            clearTimeout(state.reviewSyncEventTimerId);
        }
        state.reviewSyncEventTimerId = null;
        clearReviewAutoReviewTimer();
    }

    function ensureReviewEventSyncState() {
        if (getCurrentViewSafe() !== DEV1_VIEW_KEY) {
            cancelReviewSyncTimers();
            return;
        }
        if (getReviewWindowId() == null) {
            cancelReviewSyncTimers();
            return;
        }
        scheduleReviewAutoReviewCheck(getReviewWindowId());
    }

    function queueReviewWindowEventSync(windowId, event = {}) {
        const reviewWindowId = Number(windowId);
        if (!Number.isFinite(reviewWindowId) || Math.floor(reviewWindowId) !== getReviewWindowId()) return;
        if (state.running) return;

        const reason = String(event?.reason || 'changed').trim() || 'changed';
        const isWindowClosing = event?.isWindowClosing === true || reason === 'window-removed';
        if (isWindowClosing) {
            if (Math.floor(reviewWindowId) === Number(state.reviewWindowClosePreserveId)) {
                cancelReviewSyncTimers();
                return;
            }
            const { remainingQueue } = removeReviewQueueItemsByWindowId(reviewWindowId);
            clearReviewSession();
            rerenderAllDataPanels();
            setStatus(remainingQueue.length <= 0 ? t('queueCleared') : t('reviewWindowClosedBatchRemoved'), 'success');
            return;
        }

        const eventTabId = Number(event?.tabId);
        if (reason === 'tab-removed' && Number.isFinite(eventTabId)) {
            removeReviewQueueItemByTabId(eventTabId, reviewWindowId);
            rerenderAllDataPanels();
        }

        const removeBatchOnMissing = event?.removeBatchOnMissing === true;
        const pruneMissingItems = event?.pruneMissingItems === true || reason === 'tab-removed';
        if (reason !== 'auto-review-timer') {
            clearReviewAutoReviewTimer();
        }

        if (state.reviewSyncEventTimerId != null) {
            clearTimeout(state.reviewSyncEventTimerId);
        }
        state.reviewSyncEventTimerId = setTimeout(() => {
            state.reviewSyncEventTimerId = null;
            if (getCurrentViewSafe() !== DEV1_VIEW_KEY || getReviewWindowId() !== Math.floor(reviewWindowId)) return;
            if (state.reviewSyncInFlight) {
                queueReviewWindowEventSync(reviewWindowId, event);
                return;
            }
            syncReviewWindowQueue({ silentStatus: true, fromEvent: true, removeBatchOnMissing, pruneMissingItems }).then((synced) => {
                if (synced && reason !== 'tab-removed' && reason !== 'window-removed') {
                    scheduleReviewAutoReviewCheck(reviewWindowId);
                }
            }).catch(() => { });
        }, 80);
    }

    function handleReviewWindowChangedEvent(message) {
        if (!message || message.action !== 'dev1ReviewWindowChanged') return;
        const eventAt = Number(message.at);
        if (Number.isFinite(eventAt)) {
            if (eventAt < Number(state.reviewWindowEventAt || 0)) return;
            state.reviewWindowEventAt = eventAt;
        }
        queueReviewWindowEventSync(message.windowId, message);
    }

    function loadSavedQueueSnapshot() {
        try {
            const raw = localStorage.getItem(DEV1_QUEUE_STORAGE_KEY);
            if (!raw) {
                state.lockedQueueItems = [];
                return;
            }
            const parsed = JSON.parse(raw);
            state.lockedQueueItems = assignQueueBatchMetadata(parsed);
            persistQueueSnapshot();
        } catch (_) {
            state.lockedQueueItems = [];
        }
    }

    function persistQueueSnapshot() {
        try {
            const payload = cloneQueueItems(state.lockedQueueItems);
            if (!payload.length) {
                localStorage.removeItem(DEV1_QUEUE_STORAGE_KEY);
                return;
            }
            localStorage.setItem(DEV1_QUEUE_STORAGE_KEY, JSON.stringify(payload));
        } catch (_) { }
    }

    function setLockedQueueItems(items) {
        state.lockedQueueItems = assignQueueBatchMetadata(items);
        persistQueueSnapshot();
    }

    function mergeExistingTabMetadata(existingItem, selectedItem) {
        const tabId = Number(selectedItem?.existingTabId);
        if (!(selectedItem?.useExistingTab === true && Number.isFinite(tabId))) {
            return existingItem;
        }
        return {
            ...existingItem,
            sourceLabel: existingItem?.sourceLabel || selectedItem?.sourceLabel || '',
            actionText: selectedItem?.actionText || existingItem?.actionText || '',
            existingTabId: Math.floor(tabId),
            useExistingTab: true,
            reviewWindowId: null,
            reviewWindowActive: false,
            reviewLastAccessed: 0,
            reviewed: false,
            reviewedAt: ''
        };
    }

    function appendLockedQueueItems(items) {
        const existingQueue = cloneQueueItems(state.lockedQueueItems);
        const selectedItems = cloneQueueItems(items);
        if (selectedItems.length === 0) {
            return {
                queue: existingQueue,
                addedCount: 0,
                skippedCount: 0
            };
        }

        const keyIndexMap = new Map();
        existingQueue.forEach((item, index) => {
            const key = getQueueItemStableKey(item);
            if (key && !keyIndexMap.has(key)) keyIndexMap.set(key, index);
        });
        const nextQueue = existingQueue.slice();
        let addedCount = 0;
        let skippedCount = 0;
        selectedItems.forEach((item) => {
            const key = getQueueItemStableKey(item);
            if (!key) return;
            if (keyIndexMap.has(key)) {
                skippedCount += 1;
                return;
            }
            keyIndexMap.set(key, nextQueue.length);
            nextQueue.push(item);
            addedCount += 1;
        });

        if (addedCount > 0 || existingQueue.length === 0) {
            setLockedQueueItems(nextQueue);
        }

        return {
            queue: cloneQueueItems(state.lockedQueueItems),
            addedCount,
            skippedCount
        };
    }

    function clearLockedQueueItems() {
        state.lockedQueueItems = [];
        persistQueueSnapshot();
        resetWorkflowSteps();
    }

    function getExecutionQueueItems() {
        if (getReviewWindowId() != null) {
            if (!Array.isArray(state.lockedQueueItems)) return [];
            if (!hasValidQueueBatchMetadataSet(state.lockedQueueItems)) {
                state.lockedQueueItems = assignQueueBatchMetadata(state.lockedQueueItems, getQueueBatchSize(), { force: true });
                persistQueueSnapshot();
            }
            return state.lockedQueueItems;
        }
        if (Array.isArray(state.lockedQueueItems) && state.lockedQueueItems.length > 0) {
            if (!hasValidQueueBatchMetadataSet(state.lockedQueueItems)) {
                state.lockedQueueItems = assignQueueBatchMetadata(state.lockedQueueItems, getQueueBatchSize(), { force: true });
                persistQueueSnapshot();
            }
            return state.lockedQueueItems;
        }
        return Array.isArray(state.filteredItems) ? state.filteredItems : [];
    }

    function getQueueItemStableKey(item) {
        return normalizeWhitelistKey(item?.url || '');
    }

    function getQueueBatchSize() {
        return normalizeQueueBatchSize(state.queueBatchSize);
    }

    function hasQueueBatchMetadata(item) {
        return normalizeQueueMetadataIndex(item?.queueBatchIndex) != null
            && normalizeQueueMetadataIndex(item?.queueBatchPosition) != null
            && normalizeQueueMetadataIndex(item?.queueDisplayIndex) != null;
    }

    function hasValidQueueBatchMetadataSet(items = [], batchSize = getQueueBatchSize()) {
        const list = Array.isArray(items) ? items : [];
        if (!list.length || !list.every(hasQueueBatchMetadata)) return false;

        const normalizedBatchSize = normalizeQueueBatchSize(batchSize);
        const seenPositions = new Set();
        const seenDisplayIndexes = new Set();
        for (const item of list) {
            const batchIndex = normalizeQueueMetadataIndex(item?.queueBatchIndex);
            const batchPosition = normalizeQueueMetadataIndex(item?.queueBatchPosition);
            const displayIndex = normalizeQueueMetadataIndex(item?.queueDisplayIndex);
            if (batchIndex == null || batchPosition == null || displayIndex == null) return false;
            if (batchPosition >= normalizedBatchSize) return false;

            const positionKey = `${batchIndex}:${batchPosition}`;
            if (seenPositions.has(positionKey) || seenDisplayIndexes.has(displayIndex)) return false;
            seenPositions.add(positionKey);
            seenDisplayIndexes.add(displayIndex);
        }
        return true;
    }

    function assignQueueBatchMetadata(items = [], batchSize = getQueueBatchSize(), { force = false } = {}) {
        const list = cloneQueueItems(items);
        const normalizedBatchSize = normalizeQueueBatchSize(batchSize);
        if (!force && hasValidQueueBatchMetadataSet(list, normalizedBatchSize)) {
            return list;
        }
        return list.map((item, index) => ({
            ...item,
            queueBatchIndex: Math.floor(index / normalizedBatchSize),
            queueBatchPosition: index % normalizedBatchSize,
            queueDisplayIndex: index
        }));
    }

    function getQueueItemDisplayIndex(item, fallbackIndex = 0) {
        const raw = normalizeQueueMetadataIndex(item?.queueDisplayIndex);
        return raw != null
            ? raw
            : Math.max(0, Math.floor(Number(fallbackIndex) || 0));
    }

    function getQueueBatches(items = getExecutionQueueItems()) {
        const list = assignQueueBatchMetadata(items);
        const batchSize = getQueueBatchSize();
        const grouped = new Map();
        list.forEach((item, index) => {
            const rawBatchIndex = normalizeQueueMetadataIndex(item?.queueBatchIndex);
            const batchId = rawBatchIndex != null ? rawBatchIndex : Math.floor(index / batchSize);
            if (!grouped.has(batchId)) {
                grouped.set(batchId, {
                    batchId,
                    items: []
                });
            }
            grouped.get(batchId).items.push(item);
        });

        return Array.from(grouped.values())
            .sort((a, b) => a.batchId - b.batchId)
            .map((batch, index) => {
                const sortedItems = batch.items.slice().sort((a, b) => {
                    const positionA = normalizeQueueMetadataIndex(a?.queueBatchPosition);
                    const positionB = normalizeQueueMetadataIndex(b?.queueBatchPosition);
                    if (positionA != null && positionB != null && positionA !== positionB) {
                        return positionA - positionB;
                    }
                    return getQueueItemDisplayIndex(a) - getQueueItemDisplayIndex(b);
                });
                const displayIndexes = sortedItems.map((item, localIndex) => getQueueItemDisplayIndex(item, index * batchSize + localIndex));
                const start = displayIndexes.length ? Math.min(...displayIndexes) : index * batchSize;
                const end = displayIndexes.length ? Math.max(...displayIndexes) + 1 : start;
                return {
                    index,
                    batchId: batch.batchId,
                    start,
                    end,
                    items: sortedItems
                };
            });
    }

    function clampQueueBatchIndex(items = getExecutionQueueItems()) {
        const batches = getQueueBatches(items);
        const maxIndex = Math.max(0, batches.length - 1);
        const current = Number(state.queueBatchIndex);
        state.queueBatchIndex = Number.isFinite(current)
            ? Math.max(0, Math.min(maxIndex, Math.floor(current)))
            : 0;
        return state.queueBatchIndex;
    }

    function getCurrentQueueBatch(items = getExecutionQueueItems()) {
        const batches = getQueueBatches(items);
        if (!batches.length) return { index: 0, start: 0, end: 0, items: [] };
        const batchIndex = clampQueueBatchIndex(items);
        return batches[batchIndex] || batches[0];
    }

    function getCurrentQueueBatchItems(items = getExecutionQueueItems()) {
        return getCurrentQueueBatch(items).items;
    }

    async function selectQueueBatchIndex(rawIndex, { rerender = true } = {}) {
        const queueItems = getExecutionQueueItems();
        const batches = getQueueBatches(queueItems);
        if (!batches.length) return false;

        const maxIndex = batches.length - 1;
        const nextIndex = Math.max(0, Math.min(maxIndex, Math.floor(Number(rawIndex) || 0)));
        const currentIndex = clampQueueBatchIndex(queueItems);
        if (nextIndex === currentIndex) return false;

        state.queueBatchIndex = nextIndex;
        if (rerender) {
            rerenderAllDataPanels();
        }
        return true;
    }

    function getReviewBatchKeySet({ useInitialBatchKeys = false } = {}) {
        const keys = useInitialBatchKeys && Array.isArray(state.reviewSession?.initialBatchKeys) && state.reviewSession.initialBatchKeys.length > 0
            ? state.reviewSession.initialBatchKeys
            : (Array.isArray(state.reviewSession?.batchKeys) ? state.reviewSession.batchKeys : []);
        return new Set(
            keys.map(v => String(v || '').trim()).filter(Boolean)
        );
    }

    function buildReviewBatchKeys(items = []) {
        return Array.from(new Set(
            cloneQueueItems(items)
                .map(item => getQueueItemStableKey(item))
                .filter(Boolean)
        ));
    }

    function getQueueItemSlotKey(item) {
        const batchIndex = normalizeQueueMetadataIndex(item?.queueBatchIndex);
        const batchPosition = normalizeQueueMetadataIndex(item?.queueBatchPosition);
        if (batchIndex != null && batchPosition != null) {
            return `batch:${batchIndex}:${batchPosition}`;
        }
        const displayIndex = normalizeQueueMetadataIndex(item?.queueDisplayIndex);
        return displayIndex != null ? `display:${displayIndex}` : '';
    }

    function mergeReviewItemsForBatch(batchItems = [], reviewItems = [], { pruneMissingItems = true } = {}) {
        const normalizedBatchItems = cloneQueueItems(batchItems);
        const batchItemByKey = new Map();
        normalizedBatchItems.forEach((item) => {
            const key = getQueueItemStableKey(item);
            if (key && !batchItemByKey.has(key)) {
                batchItemByKey.set(key, item);
            }
        });

        const normalizedReviewItems = cloneQueueItems(reviewItems).map((item, index) => {
            const itemSlotKey = getQueueItemSlotKey(item);
            const previous = batchItemByKey.get(getQueueItemStableKey(item))
                || (itemSlotKey ? null : normalizedBatchItems[index])
                || null;
            if (!previous) return item;
            return {
                ...item,
                queueBatchIndex: previous.queueBatchIndex,
                queueBatchPosition: previous.queueBatchPosition,
                queueDisplayIndex: previous.queueDisplayIndex
            };
        });

        if (pruneMissingItems) return normalizedReviewItems;

        const reviewItemBySlot = new Map();
        normalizedReviewItems.forEach((item) => {
            const slotKey = getQueueItemSlotKey(item);
            if (slotKey && !reviewItemBySlot.has(slotKey)) {
                reviewItemBySlot.set(slotKey, item);
            }
        });

        const mergedItems = normalizedBatchItems.map((item) => {
            const slotKey = getQueueItemSlotKey(item);
            return (slotKey && reviewItemBySlot.get(slotKey)) || item;
        });
        const knownSlots = new Set(mergedItems.map(item => getQueueItemSlotKey(item)).filter(Boolean));
        normalizedReviewItems.forEach((item) => {
            const slotKey = getQueueItemSlotKey(item);
            if (slotKey && knownSlots.has(slotKey)) return;
            mergedItems.push(item);
        });
        return mergedItems;
    }

    function getCurrentReviewBatchKeySet(items = getExecutionQueueItems(), options = {}) {
        const sessionKeys = getReviewBatchKeySet(options);
        if (sessionKeys.size > 0) return sessionKeys;
        return new Set(buildReviewBatchKeys(getCurrentQueueBatchItems(items)));
    }

    function mergeReviewBatchIntoLockedQueue(batchItems = [], reviewItems = [], { pruneMissingItems = true } = {}) {
        const normalizedBatchItems = cloneQueueItems(batchItems);
        const batchKeys = new Set(buildReviewBatchKeys(normalizedBatchItems));
        const mergedBatchItems = mergeReviewItemsForBatch(normalizedBatchItems, reviewItems, { pruneMissingItems });
        const currentQueue = cloneQueueItems(
            Array.isArray(state.lockedQueueItems) && state.lockedQueueItems.length > 0
                ? state.lockedQueueItems
                : getExecutionQueueItems()
        );

        if (!currentQueue.length || batchKeys.size === 0) {
            setLockedQueueItems(mergedBatchItems);
            return mergedBatchItems;
        }

        const firstBatchIndex = currentQueue.findIndex(item => batchKeys.has(getQueueItemStableKey(item)));
        const keptQueue = currentQueue.filter(item => !batchKeys.has(getQueueItemStableKey(item)));
        const fallbackInsertIndex = Math.min(
            Math.max(0, Math.floor(Number(state.queueBatchIndex) || 0)) * getQueueBatchSize(),
            keptQueue.length
        );
        const insertIndex = firstBatchIndex >= 0 ? Math.min(firstBatchIndex, keptQueue.length) : fallbackInsertIndex;
        const nextQueue = [
            ...keptQueue.slice(0, insertIndex),
            ...mergedBatchItems,
            ...keptQueue.slice(insertIndex)
        ];
        setLockedQueueItems(nextQueue);
        return nextQueue;
    }

    function removeCurrentReviewBatchFromQueue(previousItems = state.lockedQueueItems, options = {}) {
        const previousQueue = cloneQueueItems(previousItems);
        const batchKeySet = getCurrentReviewBatchKeySet(previousQueue, options);
        const rawReviewWindowId = Number(options?.reviewWindowId);
        const reviewWindowId = Number.isFinite(rawReviewWindowId) ? Math.floor(rawReviewWindowId) : null;
        const remainingQueue = previousQueue.filter((item) => {
            const itemWindowId = getQueueItemReviewWindowId(item);
            if (reviewWindowId != null && itemWindowId === reviewWindowId) return false;
            if (batchKeySet.size > 0 && batchKeySet.has(getQueueItemStableKey(item))) return false;
            return true;
        });
        setLockedQueueItems(remainingQueue);
        clampQueueBatchIndex(remainingQueue);
        if (remainingQueue.length <= 0) {
            clearAllScopeSelections();
            applyAllFilters();
        }
        return remainingQueue;
    }

    function removeReviewQueueItemsByPredicate(predicate) {
        if (typeof predicate !== 'function') return { removed: false, remainingQueue: cloneQueueItems(state.lockedQueueItems) };
        const previousQueue = cloneQueueItems(state.lockedQueueItems);
        let removed = false;
        const remainingQueue = previousQueue.filter((item) => {
            if (predicate(item)) {
                removed = true;
                return false;
            }
            return true;
        });
        if (removed) {
            setLockedQueueItems(remainingQueue);
            clampQueueBatchIndex(remainingQueue);
            if (remainingQueue.length <= 0) {
                clearAllScopeSelections();
                applyAllFilters();
            }
        }
        return { removed, remainingQueue };
    }

    function removeReviewQueueItemByTabId(tabId, reviewWindowId = null) {
        const normalizedTabId = Number(tabId);
        if (!Number.isFinite(normalizedTabId)) {
            return { removed: false, remainingQueue: cloneQueueItems(state.lockedQueueItems) };
        }
        const normalizedWindowId = Number(reviewWindowId);
        const hasWindowId = Number.isFinite(normalizedWindowId);
        return removeReviewQueueItemsByPredicate((item) => {
            const itemTabId = getQueueItemTabId(item);
            if (itemTabId !== Math.floor(normalizedTabId)) return false;
            if (!hasWindowId) return true;
            const itemWindowId = getQueueItemReviewWindowId(item);
            return itemWindowId == null || itemWindowId === Math.floor(normalizedWindowId);
        });
    }

    function removeReviewQueueItemsByWindowId(reviewWindowId) {
        const normalizedWindowId = Number(reviewWindowId);
        if (!Number.isFinite(normalizedWindowId)) {
            return { removed: false, remainingQueue: cloneQueueItems(state.lockedQueueItems) };
        }
        return removeReviewQueueItemsByPredicate((item) => {
            return getQueueItemReviewWindowId(item) === Math.floor(normalizedWindowId);
        });
    }

    function getActiveQueueItems(items = getExecutionQueueItems()) {
        return Array.isArray(items) ? items : [];
    }

    function getQueueItemTabId(item) {
        const raw = Number(item?.existingTabId);
        return Number.isFinite(raw) ? Math.floor(raw) : null;
    }

    function getQueueItemReviewWindowId(item) {
        const raw = Number(item?.reviewWindowId);
        return Number.isFinite(raw) ? Math.floor(raw) : null;
    }

    function isExistingTabReviewQueueItem(item) {
        const tabId = getQueueItemTabId(item);
        return item?.useExistingTab === true
            && tabId != null
            && getQueueItemReviewWindowId(item) == null;
    }

    function isExistingTabReviewMode(items = getCurrentQueueBatchItems()) {
        const activeItems = getActiveQueueItems(items);
        return Array.isArray(activeItems)
            && activeItems.length > 0
            && activeItems.every(item => isExistingTabReviewQueueItem(item));
    }

    function getReviewQueueItemKey(item) {
        const tabId = getQueueItemTabId(item);
        const url = normalizeWhitelistKey(item?.url || '');
        if (tabId != null) return `tab:${tabId}:${url}`;
        return url ? `url:${url}` : '';
    }

    function getActiveReviewQueueItem(items = getCurrentQueueBatchItems()) {
        return cloneQueueItems(items).find(item => item?.reviewWindowActive === true) || null;
    }

    function shouldScheduleReviewAutoReviewCheck() {
        if (isReviewSubmitted()) return false;
        const activeKey = String(state.reviewActiveKey || '');
        const activeSince = Number(state.reviewActiveSinceMs);
        if (!activeKey || !Number.isFinite(activeSince) || activeSince <= 0) return false;
        const activeItem = getActiveReviewQueueItem();
        if (!activeItem || activeItem?.reviewed === true) return false;
        return getReviewQueueItemKey(activeItem) === activeKey;
    }

    function scheduleReviewAutoReviewCheck(windowId = getReviewWindowId()) {
        clearReviewAutoReviewTimer();
        const reviewWindowId = Number(windowId);
        if (!Number.isFinite(reviewWindowId) || Math.floor(reviewWindowId) !== getReviewWindowId()) return;
        if (state.running || getCurrentViewSafe() !== DEV1_VIEW_KEY) return;
        if (!shouldScheduleReviewAutoReviewCheck()) return;

        const activeSince = Number(state.reviewActiveSinceMs) || Date.now();
        const delayMs = Math.max(20, getReviewAutoReviewMs() - (Date.now() - activeSince) + 20);
        state.reviewAutoReviewTimerId = setTimeout(() => {
            state.reviewAutoReviewTimerId = null;
            if (state.running || getCurrentViewSafe() !== DEV1_VIEW_KEY) return;
            if (getReviewWindowId() !== Math.floor(reviewWindowId)) return;
            if (!shouldScheduleReviewAutoReviewCheck()) return;
            queueReviewWindowEventSync(reviewWindowId, { reason: 'auto-review-timer' });
        }, delayMs);
    }

    function clearReviewTrackingState() {
        clearReviewAutoReviewTimer();
        state.reviewActiveKey = '';
        state.reviewActiveSinceMs = 0;
    }

    function getReviewedQueueItems(items = getExecutionQueueItems()) {
        const activeItems = getActiveQueueItems(items);
        if (isReviewSubmitted()) return activeItems;
        return activeItems.filter(item => item?.reviewed === true);
    }

    function isReviewSatisfiedForQueue(items = getExecutionQueueItems()) {
        const activeItems = getActiveQueueItems(items);
        if (!activeItems.length) return false;
        if (isReviewSubmitted()) return true;
        return activeItems.every(item => item?.reviewed === true || isQueueItemWhitelisted(item));
    }

    function applyAutoReviewTracking(items, nowMs = Date.now()) {
        const queue = cloneQueueItems(items);
        if (!queue.length) {
            clearReviewTrackingState();
            return queue;
        }

        const activeItem = queue.find(item => item?.reviewWindowActive === true);
        const activeKey = getReviewQueueItemKey(activeItem);
        if (!activeItem || !activeKey) {
            clearReviewTrackingState();
            return queue;
        }

        if (state.reviewActiveKey !== activeKey) {
            state.reviewActiveKey = activeKey;
            state.reviewActiveSinceMs = nowMs;
            return queue;
        }

        const activeSince = Number(state.reviewActiveSinceMs) || nowMs;
        if (nowMs - activeSince < getReviewAutoReviewMs()) return queue;

        const reviewedAt = new Date(nowMs).toISOString();
        return queue.map((item) => {
            if (getReviewQueueItemKey(item) !== activeKey || item?.reviewed === true) return item;
            return {
                ...item,
                reviewed: true,
                reviewedAt
            };
        });
    }

    function findQueueItemIndexByUrl(items, rawUrl) {
        const target = normalizeWhitelistKey(rawUrl);
        if (!target || !Array.isArray(items)) return -1;
        return items.findIndex((item) => normalizeWhitelistKey(item?.url || '') === target);
    }

    function updateLockedQueueAfterManualEdit(nextItems, { clearReviewWhenEmpty = true } = {}) {
        const nextQueue = cloneQueueItems(nextItems);
        setLockedQueueItems(nextQueue);

        if (nextQueue.length <= 0) {
            if (clearReviewWhenEmpty) {
                clearReviewSession();
            } else {
                setReviewSession({
                    acknowledged: false,
                    submitted: false,
                    submittedAt: '',
                    queueSignature: ''
                });
            }
            return nextQueue;
        }

        setReviewSession({
            acknowledged: false,
            submitted: false,
            submittedAt: '',
            queueSignature: buildQueueSignature(nextQueue)
        });
        return nextQueue;
    }

    async function closeReviewWindowForCurrentSession({ preserveQueue = true } = {}) {
        const reviewWindowId = getReviewWindowId();
        if (reviewWindowId == null) return true;
        if (preserveQueue) {
            state.reviewWindowClosePreserveId = reviewWindowId;
            setTimeout(() => {
                if (Number(state.reviewWindowClosePreserveId) === reviewWindowId) {
                    state.reviewWindowClosePreserveId = null;
                }
            }, 5000);
        }

        const response = await sendRuntimeMessage({
            action: 'dev1CloseReviewWindow',
            windowId: reviewWindowId
        }, 20000);
        return !!(response && response.success === true);
    }

    async function clearQueueAndReviewState({ closeReviewWindow = false, clearScope = true } = {}) {
        if (closeReviewWindow) {
            await closeReviewWindowForCurrentSession();
        }
        if (clearScope) {
            clearAllScopeSelections();
        }
        clearReviewSession();
        clearLockedQueueItems();
        applyAllFilters();
    }

    function normalizeSourceKey(sourceKey) {
        const value = String(sourceKey || '').trim();
        if (value === SOURCE_CHANGES) return SOURCE_CHANGES;
        if (value === SOURCE_ALL_TABS) return SOURCE_ALL_TABS;
        return SOURCE_BOOKMARKS;
    }

    function getSourceState(sourceKey) {
        return ensureSourceStateShape(normalizeSourceKey(sourceKey));
    }

    function normalizeUrl(rawUrl) {
        try {
            const url = new URL(String(rawUrl || '').trim());
            if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
            return url;
        } catch (_) {
            return null;
        }
    }

    const MULTI_PART_SUFFIXES = new Set([
        'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
        'co.uk', 'org.uk', 'gov.uk', 'ac.uk',
        'co.jp',
        'com.au', 'net.au', 'org.au',
        'co.nz',
        'com.hk', 'com.tw', 'com.sg'
    ]);

    function getDomainParts(hostname) {
        const host = String(hostname || '').trim().toLowerCase().replace(/^www\./, '');
        if (!host) return { host: '', domain: '', hasSubdomain: false };
        const isIPv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
        const isIPv6 = host.includes(':');
        if (isIPv4 || isIPv6 || host === 'localhost' || host.endsWith('.local')) {
            return { host, domain: host, hasSubdomain: false };
        }

        const labels = host.split('.').filter(Boolean);
        if (labels.length <= 2) {
            return { host, domain: host, hasSubdomain: false };
        }

        const suffix2 = labels.slice(-2).join('.');
        const domain = (labels.length >= 3 && MULTI_PART_SUFFIXES.has(suffix2))
            ? labels.slice(-3).join('.')
            : labels.slice(-2).join('.');

        return {
            host,
            domain,
            hasSubdomain: host !== domain
        };
    }

    function tokenizeScopeSearchKeyword(keyword) {
        return String(keyword || '')
            .trim()
            .toLowerCase()
            .split(/\s+/)
            .map(token => String(token || '').trim())
            .filter(Boolean);
    }

    function isScopeCjkToken(token) {
        return /[\u3400-\u9fff]/.test(String(token || ''));
    }

    function isScopeLikelyUrlToken(token) {
        const t = String(token || '').trim().toLowerCase();
        if (!t) return false;
        if (/^[a-z][a-z0-9+.-]*:/.test(t)) return true;
        if (t.startsWith('www.')) return true;
        if (t.includes('/') || t.includes('\\') || t.includes(':') || t.includes('?') || t.includes('#') || t.includes('=')) return true;
        if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(t)) return true;
        return false;
    }

    function getScopeSearchTokenLength(token) {
        try {
            return Array.from(String(token || '')).length;
        } catch (_) {
            return String(token || '').length;
        }
    }

    function shouldEnableScopePathFieldMatch(query) {
        const q = String(query || '').trim();
        if (!q) return false;
        return q.includes('/') || q.includes('\\') || q.includes('>');
    }

    function scoreScopeSearchFields(fields, tokens, options = {}) {
        const normalizedTitle = String(fields?.title || '').trim().toLowerCase();
        const normalizedUrl = String(fields?.url || '').trim().toLowerCase();
        const normalizedHost = String(fields?.host || '').trim().toLowerCase();
        const normalizedDomain = String(fields?.domain || '').trim().toLowerCase();
        const normalizedPath = String(fields?.path || '').trim().toLowerCase();
        const normalizedPathAlt = String(fields?.pathAlt || '').trim().toLowerCase();
        const normalizedQuery = String(options?.query || '').trim().toLowerCase();
        const allowPathMatch = options?.allowPathMatch === true;
        const domainOnly = options?.domainOnly === true;

        let score = 0;
        if (normalizedQuery) {
            if (normalizedHost && normalizedHost === normalizedQuery) score += 170;
            if (normalizedDomain && normalizedDomain === normalizedQuery) score += 165;
            if (!domainOnly && normalizedTitle && normalizedTitle === normalizedQuery) score += 220;
        }

        for (const token of tokens) {
            if (!token) continue;
            const tokenLen = getScopeSearchTokenLength(token);
            const isCjk = isScopeCjkToken(token);
            const isUrlLike = isScopeLikelyUrlToken(token);
            const allowTitleContains = isCjk || tokenLen >= 3;
            const allowDomainFieldMatch = isUrlLike || tokenLen >= 4;
            const allowPathFieldMatch = allowPathMatch && (isUrlLike || isCjk || tokenLen >= 2);
            const allowUrlFieldMatch = !domainOnly && (isUrlLike || tokenLen >= 2);

            let matched = false;
            if (!domainOnly) {
                if (normalizedTitle && normalizedTitle === token) { score += 160; matched = true; }
                else if (normalizedTitle && normalizedTitle.startsWith(token)) { score += 120; matched = true; }
                else if (allowTitleContains && normalizedTitle && normalizedTitle.includes(token)) { score += 90; matched = true; }
            }

            if (!matched && allowDomainFieldMatch) {
                if (normalizedHost && normalizedHost === token) { score += 110; matched = true; }
                else if (normalizedHost && normalizedHost.startsWith(token)) { score += 88; matched = true; }
                else if (normalizedHost && normalizedHost.includes(token)) { score += 82; matched = true; }
                else if (normalizedDomain && normalizedDomain.includes(token)) { score += 78; matched = true; }
            }

            if (!matched && allowUrlFieldMatch && normalizedUrl && normalizedUrl.includes(token)) {
                score += isUrlLike ? 86 : 58;
                matched = true;
            }

            if (!matched && !domainOnly && allowPathFieldMatch) {
                if (normalizedPath && normalizedPath.includes(token)) { score += 50; matched = true; }
                else if (normalizedPathAlt && normalizedPathAlt.includes(token)) { score += 45; matched = true; }
            }

            if (!matched) return -Infinity;
        }

        return score;
    }

    function matchesScopeSearchFields(fields, keyword, options = {}) {
        const query = String(keyword || '').trim().toLowerCase();
        if (!query) return true;
        const tokens = tokenizeScopeSearchKeyword(query);
        if (!tokens.length) return true;
        return scoreScopeSearchFields(fields, tokens, {
            query,
            allowPathMatch: options?.allowPathMatch === true,
            domainOnly: options?.domainOnly === true
        }) > -Infinity;
    }

    function sendRuntimeMessage(payload, timeoutMs = 180000) {
        return new Promise((resolve, reject) => {
            if (!runtimeApi || !runtimeApi.runtime || typeof runtimeApi.runtime.sendMessage !== 'function') {
                reject(new Error(t('invalidRuntime')));
                return;
            }

            let done = false;
            const timer = setTimeout(() => {
                if (done) return;
                done = true;
                reject(new Error('Runtime request timeout'));
            }, Math.max(1000, Number(timeoutMs) || 180000));

            try {
                runtimeApi.runtime.sendMessage(payload, (response) => {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    const runtimeError = runtimeApi.runtime.lastError;
                    if (runtimeError) {
                        reject(new Error(runtimeError.message || 'Runtime error'));
                        return;
                    }
                    resolve(response);
                });
            } catch (error) {
                if (done) return;
                done = true;
                clearTimeout(timer);
                reject(error);
            }
        });
    }

    function normalizeRuntimeErrorMessage(error, fallbackText = '') {
        const fallback = String(fallbackText || t('sourceError')).trim();
        const raw = String(error?.message || '').trim();
        if (!raw) return fallback;
        if (/message port closed before a response was received/i.test(raw)) {
            return getLangKey() === 'en'
                ? 'Extension response was interrupted. Reload the extension and retry.'
                : '扩展响应被中断，请重载扩展后重试。';
        }
        return raw;
    }

    function formatTimeText(isoText) {
        const raw = String(isoText || '').trim();
        if (!raw) return '-';
        const date = new Date(raw);
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return raw;
        try {
            return date.toLocaleString();
        } catch (_) {
            return raw;
        }
    }

    function getCaptureRunStatusLabel(status, interruptedReason = '') {
        const value = String(status || '').trim().toLowerCase();
        if (value === 'running') return t('recoveryStatusRunning');
        if (value === 'interrupted') {
            const reason = String(interruptedReason || '').trim().toLowerCase();
            if (reason === 'paused_by_user') return t('recoveryStatusPaused');
            if (reason === 'cancelled_by_user') return t('recoveryStatusCancelled');
            return t('recoveryStatusInterrupted');
        }
        if (value === 'completed') return t('recoveryStatusCompleted');
        if (value === 'failed') return t('recoveryStatusFailed');
        return t('recoveryStatusUnknown');
    }

    function updateRunPrimaryButton(runIsActive) {
        const runBtn = document.getElementById('dev1RunBtn');
        if (!runBtn) return;
        const active = runIsActive === true;
        const stepNumber = isExistingTabReviewMode(getActiveQueueItems(getCurrentQueueBatchItems())) ? 2 : 3;
        const textEl = runBtn.querySelector('span');
        runBtn.title = active ? t('tipRunPause') : t('tipRunStart');
        runBtn.classList.toggle('primary', !active);
        runBtn.classList.toggle('dev1-step-done', isWorkflowStepDone('runDone'));
        if (textEl) {
            textEl.textContent = `${stepNumber}. ${active ? t('runPauseBtn') : t('runStartBtn')}`;
        }
    }

    function renderCaptureRunStatePanel() {
        const wrap = document.getElementById('dev1RecoveryWrap');
        if (!wrap) {
            const runIsActive = state.running || String(state.captureRunState?.status || '').toLowerCase() === 'running';
            const cancelBtn = document.getElementById('dev1CancelBtn');
            if (cancelBtn) cancelBtn.disabled = !runIsActive;
            updateRunPrimaryButton(runIsActive);
            return;
        }

        const runState = state.captureRunState;
        if (!runState || typeof runState !== 'object') {
            wrap.innerHTML = `<div class="dev1-empty">${escapeHtml(t('recoveryNone'))}</div>`;
            const cancelBtn = document.getElementById('dev1CancelBtn');
            if (cancelBtn) cancelBtn.disabled = true;
            updateRunPrimaryButton(false);
            return;
        }

        const summary = runState.summary && typeof runState.summary === 'object' ? runState.summary : {};
        const total = Number(summary.total) || 0;
        const ok = Number(summary.successCount) || 0;
        const partial = Number(summary.partialCount) || 0;
        const fail = Number(summary.failureCount) || 0;
        const pending = Number(summary.pendingCount) || 0;
        const interruptedReason = String(runState.interruptedReason || '').trim().toLowerCase();
        const statusLabel = getCaptureRunStatusLabel(runState.status, interruptedReason);
        const hint = interruptedReason === 'cancelled_by_user'
            ? t('recoveryHintCancelled')
            : (runState.resumable ? t('recoveryHintResumable') : t('recoveryHintNoResume'));
        const mode = String(runState.mode || runState.options?.exportMode || '').trim().toLowerCase();
        const modeLabel = mode === 'batch-zip' ? t('exportModeBatchZip') : t('exportModeSingleFile');
        const batches = Array.isArray(runState.batches) ? runState.batches : [];
        const completedBatchCount = batches.filter((batch) => String(batch?.status || '').trim().toLowerCase() === 'completed').length;
        const pendingBatchCount = batches.filter((batch) => String(batch?.status || '').trim().toLowerCase() !== 'completed').length;
        const zipArtifactCount = Array.isArray(runState.artifacts)
            ? runState.artifacts.filter((artifact) => String(artifact?.kind || '').trim().toLowerCase() === 'zip' && String(artifact?.terminalState || '').trim().toLowerCase() === 'complete').length
            : 0;
        const batchProgressText = mode === 'batch-zip'
            ? `${completedBatchCount} / ${Math.max(completedBatchCount, batches.length)} (zip ${zipArtifactCount}, pending ${pendingBatchCount})`
            : '-';

        wrap.innerHTML = `
            <div class="dev1-health-grid">
                <div class="dev1-health-row"><span>${escapeHtml(t('recoveryRunId'))}</span><strong>${escapeHtml(runState.runId || '-')}</strong></div>
                <div class="dev1-health-row"><span>${escapeHtml(t('recoveryState'))}</span><strong>${escapeHtml(statusLabel)}</strong></div>
                <div class="dev1-health-row"><span>${escapeHtml(t('recoveryStartedAt'))}</span><strong>${escapeHtml(formatTimeText(runState.startedAt))}</strong></div>
                <div class="dev1-health-row"><span>${escapeHtml(t('recoveryUpdatedAt'))}</span><strong>${escapeHtml(formatTimeText(runState.updatedAt))}</strong></div>
                <div class="dev1-health-row"><span>${escapeHtml(t('recoveryTargetFolder'))}</span><strong>${escapeHtml(runState.targetFolder || '-')}</strong></div>
                <div class="dev1-health-row"><span>${escapeHtml(t('recoveryMode'))}</span><strong>${escapeHtml(modeLabel)}</strong></div>
                <div class="dev1-health-row"><span>${escapeHtml(t('recoveryBatchProgress'))}</span><strong>${escapeHtml(batchProgressText)}</strong></div>
                <div class="dev1-health-row"><span>${escapeHtml(t('recoveryPending'))}</span><strong>${escapeHtml(`${pending} / ${total} (${t('statusOk')} ${ok} | ${t('statusPartial')} ${partial} | ${t('statusFail')} ${fail})`)}</strong></div>
            </div>
            <div class="dev1-note">${escapeHtml(hint)}</div>
        `;

        const resumeBtn = document.getElementById('dev1ResumeBtn');
        if (resumeBtn) {
            resumeBtn.disabled = state.running || !runState.resumable || String(runState.status || '').toLowerCase() === 'running';
        }
        const cancelBtn = document.getElementById('dev1CancelBtn');
        const runIsActive = state.running || String(runState.status || '').toLowerCase() === 'running';
        if (cancelBtn) cancelBtn.disabled = !runIsActive;
        updateRunPrimaryButton(runIsActive);
    }

    async function refreshCaptureRunState({ silent = false } = {}) {
        try {
            const response = await sendRuntimeMessage({
                action: 'dev1GetCaptureRunState',
                includeResults: false
            }, 20000);

            if (!response || response.success !== true) {
                throw new Error(response?.error || t('runFailed'));
            }

            state.captureRunState = response.state && typeof response.state === 'object'
                ? response.state
                : null;

            renderCaptureRunStatePanel();

            if (!silent && String(state.captureRunState?.status || '').toLowerCase() === 'running') {
                setStatus(t('recoveryStatusRunning'), 'warning');
            }
        } catch (error) {
            state.captureRunState = null;
            renderCaptureRunStatePanel();
            if (!silent) {
                setStatus(error?.message || t('runFailed'), 'error');
            }
        }
    }

    async function queryBookmarkTreeInPage() {
        if (!runtimeApi || !runtimeApi.bookmarks || typeof runtimeApi.bookmarks.getTree !== 'function') {
            throw new Error('Bookmark API unavailable in page context');
        }
        return await new Promise((resolve, reject) => {
            try {
                runtimeApi.bookmarks.getTree((nodes) => {
                    const runtimeError = runtimeApi.runtime?.lastError;
                    if (runtimeError) {
                        reject(new Error(runtimeError.message || 'Failed to read bookmark tree'));
                        return;
                    }
                    resolve(Array.isArray(nodes) ? nodes : []);
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    function buildBookmarkRawItemsFromTree(tree) {
        const rootNodes = Array.isArray(tree) ? tree : [];
        const items = [];
        const seen = new Set();

        function walk(nodes, parentPath = []) {
            if (!Array.isArray(nodes)) return;
            nodes.forEach((node) => {
                if (!node || typeof node !== 'object') return;

                const hasChildren = Array.isArray(node.children) && node.children.length > 0;
                const title = String(node.title || '').trim();
                const nextPath = hasChildren && title ? parentPath.concat([title]) : parentPath;
                const parsed = normalizeUrl(node.url || '');
                if (parsed) {
                    const id = String(node.id || '').trim();
                    const folderPath = parentPath.join(' / ');
                    const dedupeKey = `${id || parsed.toString()}::${folderPath}`;
                    if (!seen.has(dedupeKey)) {
                        seen.add(dedupeKey);
                        items.push({
                            id,
                            url: parsed.toString(),
                            title: title || parsed.toString(),
                            folderPath,
                            folderFilterKey: folderPath || '__root__',
                            folderFilterLabel: folderPath || t('rootFolderLabel'),
                            actionText: ''
                        });
                    }
                }

                if (hasChildren) walk(node.children, nextPath);
            });
        }

        walk(rootNodes, []);
        return items;
    }

    async function fetchBookmarkSourcePayload() {
        let firstError = null;
        try {
            const response = await sendRuntimeMessage({
                action: 'dev1GetBookmarkCaptureSource',
                lang: getLangKey()
            }, 30000);

            if (!response || response.success !== true || !Array.isArray(response.items)) {
                throw new Error(response?.error || t('sourceError'));
            }

            return response;
        } catch (error) {
            firstError = error;
        }

        try {
            const tree = await queryBookmarkTreeInPage();
            const items = buildBookmarkRawItemsFromTree(tree);
            return {
                success: true,
                source: 'bookmarks_api_page',
                items
            };
        } catch (fallbackError) {
            const firstText = String(firstError?.message || '').trim();
            const secondText = String(fallbackError?.message || '').trim();
            throw new Error([firstText, secondText].filter(Boolean).join(' | ') || t('sourceError'));
        }
    }

    async function fetchAllWindowTabsSourcePayload() {
        const response = await sendRuntimeMessage({
            action: 'dev1GetAllWindowTabsSource',
            lang: getLangKey()
        }, 30000);

        if (!response || response.success !== true || !Array.isArray(response.items)) {
            throw new Error(response?.error || t('sourceError'));
        }
        return response;
    }

    async function fetchCurrentChangesPayload(options = {}) {
        const forceRefresh = options && options.forceRefresh === true;
        const visualPayload = await fetchCurrentChangesPayloadFromVisualSource({ forceRefresh });
        if (visualPayload) {
            return visualPayload;
        }

        const liveMode = getLiveCurrentChangesExportMode();
        const response = await sendRuntimeMessage({
            action: 'buildCurrentChangesManualExport',
            ...(liveMode ? { mode: liveMode } : {}),
            format: 'json',
            lang: getLangKey()
        }, 30000);

        if (!response || response.success !== true || typeof response.content !== 'string') {
            throw new Error(response?.error || t('sourceError'));
        }

        try {
            const payload = JSON.parse(response.content);
            const resolvedMode = normalizeChangesViewMode(response?.mode, liveMode || 'collection');
            if (state.scopeUi && typeof state.scopeUi === 'object') {
                state.scopeUi.currentChangesResolvedMode = resolvedMode;
            }
            return {
                payload,
                mode: resolvedMode
            };
        } catch (_) {
            throw new Error(t('parseError'));
        }
    }

    function stripChangeActionPrefix(rawTitle) {
        return String(rawTitle || '').replace(/^\[(\+|-|~>>|~|>>)]\s*/g, '').trim();
    }

    function parseChangeActionFromTitle(rawTitle) {
        const title = String(rawTitle || '').trim();
        if (!title) return '';
        if (/^\[~>>\]/.test(title)) return 'modified+moved';
        if (/^\[\+\]/.test(title)) return 'added';
        if (/^\[-\]/.test(title)) return 'deleted';
        if (/^\[~\]/.test(title)) return 'modified';
        if (/^\[>>\]/.test(title)) return 'moved';
        const stripped = stripChangeActionPrefix(title).toLowerCase();
        if (stripped === '修改+移动' || stripped === 'modified+moved') return 'modified+moved';
        if (stripped === '新增' || stripped === 'added') return 'added';
        if (stripped === '删除' || stripped === 'deleted') return 'deleted';
        if (stripped === '修改' || stripped === 'modified') return 'modified';
        if (stripped === '移动' || stripped === 'moved') return 'moved';
        return '';
    }

    function formatChangeActionText(action) {
        const zh = getLangKey() !== 'en';
        if (action === 'modified+moved') return zh ? '修改+移动' : 'Modified+Moved';
        if (action === 'added') return zh ? '新增' : 'Added';
        if (action === 'deleted') return zh ? '删除' : 'Deleted';
        if (action === 'modified') return zh ? '修改' : 'Modified';
        if (action === 'moved') return zh ? '移动' : 'Moved';
        return '';
    }

    function normalizeChangeActionType(rawAction, fallback = '') {
        const text = String(rawAction || '').trim().toLowerCase();
        if (!text) return String(fallback || '').trim().toLowerCase();
        if (text.includes('modified') && text.includes('moved')) return 'modified+moved';
        if (text.includes('修改') && text.includes('移动')) return 'modified+moved';
        if (text.includes('added') || text === '新增') return 'added';
        if (text.includes('deleted') || text === '删除') return 'deleted';
        if (text.includes('modified') || text === '修改') return 'modified';
        if (text.includes('moved') || text === '移动') return 'moved';
        return String(fallback || '').trim().toLowerCase();
    }

    const CHANGE_MASK_ADDED = 1;
    const CHANGE_MASK_DELETED = 2;
    const CHANGE_MASK_MODIFIED = 4;
    const CHANGE_MASK_MOVED = 8;

    function getChangeMaskByActionType(actionTypeRaw) {
        const actionType = String(actionTypeRaw || '').trim().toLowerCase();
        if (!actionType) return 0;
        let mask = 0;
        if (actionType.includes('added') || actionType.includes('新增')) mask |= CHANGE_MASK_ADDED;
        if (actionType.includes('deleted') || actionType.includes('删除')) mask |= CHANGE_MASK_DELETED;
        if (actionType.includes('modified') || actionType.includes('修改')) mask |= CHANGE_MASK_MODIFIED;
        if (actionType.includes('moved') || actionType.includes('移动')) mask |= CHANGE_MASK_MOVED;
        return mask;
    }

    function getScopeChangeClassByActionType(actionTypeRaw) {
        const normalized = normalizeChangeActionType(actionTypeRaw, '');
        if (normalized === 'added') return 'tree-change-added';
        if (normalized === 'deleted') return 'tree-change-deleted';
        if (normalized === 'modified+moved') return 'tree-change-mixed';
        if (normalized === 'modified') return 'tree-change-modified';
        if (normalized === 'moved') return 'tree-change-moved';
        return '';
    }

    function getScopeTitleChangeClass(sourceKey, actionTypeRaw = '') {
        if (sourceKey !== SOURCE_CHANGES) return '';
        return getScopeChangeClassByActionType(actionTypeRaw);
    }

    function renderScopeChangeBadgesHtml(mask) {
        const normalizedMask = Number(mask) || 0;
        if (!normalizedMask) return '';

        let html = '<span class="change-badges">';
        if (normalizedMask & CHANGE_MASK_ADDED) {
            html += '<span class="change-badge added"><span class="badge-symbol">+</span></span>';
        }
        if (normalizedMask & CHANGE_MASK_DELETED) {
            html += '<span class="change-badge deleted"><span class="badge-symbol">-</span></span>';
        }
        if (normalizedMask & CHANGE_MASK_MODIFIED) {
            html += '<span class="change-badge modified"><span class="badge-symbol">~</span></span>';
        }
        if (normalizedMask & CHANGE_MASK_MOVED) {
            html += '<span class="change-badge moved"><span class="badge-symbol">>></span></span>';
        }
        html += '</span>';
        return html;
    }

    function renderScopePathBadgesHtml(mask) {
        const normalizedMask = Number(mask) || 0;
        if (!normalizedMask) return '';
        const containsTitle = getLangKey() === 'en' ? 'Contains changes' : '此文件夹下有变化';

        let html = `<span class="path-badges"><span class="path-dot" title="${escapeHtml(containsTitle)}">•</span>`;
        if (normalizedMask & CHANGE_MASK_ADDED) html += '<span class="path-symbol added" title="+">+</span>';
        if (normalizedMask & CHANGE_MASK_DELETED) html += '<span class="path-symbol deleted" title="-">-</span>';
        if (normalizedMask & CHANGE_MASK_MODIFIED) html += '<span class="path-symbol modified" title="~">~</span>';
        if (normalizedMask & CHANGE_MASK_MOVED) html += '<span class="path-symbol moved" title=">>">>></span>';
        html += '</span>';
        return html;
    }

    function buildSourceItemsFromBookmarkPayload(payload) {
        const rawItems = Array.isArray(payload?.items) ? payload.items : [];
        const results = [];
        const seen = new Set();

        rawItems.forEach((rawItem, index) => {
            const parsed = normalizeUrl(rawItem?.url || '');
            if (!parsed) return;

            const folderPath = String(rawItem?.folderPath || '').trim();
            const dedupeKey = `${String(rawItem?.id || '').trim()}::${parsed.toString()}::${folderPath}`;
            if (seen.has(dedupeKey)) return;
            seen.add(dedupeKey);

            const host = String(rawItem?.host || parsed.hostname || '').trim().toLowerCase().replace(/^www\./, '');
            const domainParts = getDomainParts(host);
            const domain = String(rawItem?.domain || '').trim().toLowerCase() || domainParts.domain || domainParts.host || '';
            const rawSubdomain = String(rawItem?.subdomain || '').trim().toLowerCase();
            const subdomain = rawSubdomain || (domainParts.hasSubdomain ? domainParts.host : '__root__');

            results.push({
                index,
                sourceKey: SOURCE_BOOKMARKS,
                sourceLabel: t('sourceLabelBookmarkApi'),
                id: String(rawItem?.id || '').trim(),
                bookmarkFilterKey: String(rawItem?.id || '').trim() || `${parsed.toString()}#${index}`,
                url: parsed.toString(),
                title: String(rawItem?.title || '').trim() || parsed.toString(),
                folderPath,
                folderFilterKey: String(rawItem?.folderFilterKey || '').trim() || folderPath || '__root__',
                folderFilterLabel: String(rawItem?.folderFilterLabel || '').trim() || folderPath || t('rootFolderLabel'),
                domain,
                subdomain,
                subdomainLabel: subdomain === '__root__' ? t('rootSubdomainLabel') : subdomain,
                actionText: '',
                actionType: '',
                host: host || domain
            });
        });

        results.sort((a, b) => {
            const titleCompare = String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
            if (titleCompare !== 0) return titleCompare;
            const folderCompare = String(a.folderPath || '').localeCompare(String(b.folderPath || ''), undefined, { sensitivity: 'base' });
            if (folderCompare !== 0) return folderCompare;
            return String(a.url || '').localeCompare(String(b.url || ''));
        });

        return results;
    }

    function buildSourceItemsFromAllTabsPayload(payload) {
        const rawItems = Array.isArray(payload?.items) ? payload.items : [];
        const results = [];
        const seenTabIds = new Set();

        rawItems.forEach((rawItem, index) => {
            const parsed = normalizeUrl(rawItem?.url || '');
            if (!parsed) return;

            const existingTabIdRaw = Number(rawItem?.existingTabId ?? rawItem?.tabId);
            const existingTabId = Number.isFinite(existingTabIdRaw) ? Math.floor(existingTabIdRaw) : null;
            if (existingTabId == null || seenTabIds.has(existingTabId)) return;
            seenTabIds.add(existingTabId);

            const folderPath = String(rawItem?.folderPath || '').trim();
            const host = String(rawItem?.host || parsed.hostname || '').trim().toLowerCase().replace(/^www\./, '');
            const domainParts = getDomainParts(host);
            const domain = String(rawItem?.domain || '').trim().toLowerCase() || domainParts.domain || domainParts.host || '';
            const rawSubdomain = String(rawItem?.subdomain || '').trim().toLowerCase();
            const subdomain = rawSubdomain || (domainParts.hasSubdomain ? domainParts.host : '__root__');

            results.push({
                index,
                sourceKey: SOURCE_ALL_TABS,
                sourceLabel: t('sourceLabelAllTabs'),
                id: String(rawItem?.id || '').trim() || `tab_${existingTabId}`,
                bookmarkFilterKey: `tab_${existingTabId}`,
                url: parsed.toString(),
                title: String(rawItem?.title || '').trim() || parsed.toString(),
                folderPath,
                folderFilterKey: String(rawItem?.folderFilterKey || '').trim() || folderPath || '__root__',
                folderFilterLabel: String(rawItem?.folderFilterLabel || '').trim() || folderPath || t('rootFolderLabel'),
                domain,
                subdomain,
                subdomainLabel: subdomain === '__root__' ? t('rootSubdomainLabel') : subdomain,
                actionText: getLangKey() === 'en' ? 'Open Tab' : '已打开Tab',
                actionType: '',
                host: host || domain,
                existingTabId,
                useExistingTab: true
            });
        });

        results.sort((a, b) => {
            const titleCompare = String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
            if (titleCompare !== 0) return titleCompare;
            return String(a.url || '').localeCompare(String(b.url || ''));
        });

        return results;
    }

    function buildSourceItemsFromChangesPayload(payload) {
        const rootNodes = Array.isArray(payload?.children) ? payload.children : [];
        const results = [];
        const seen = new Set();
        const folderBadgeByPath = new Map();
        const bookmarkNodeKeyCount = new Map();

        function isChangesMetaTitle(rawTitle) {
            const title = stripChangeActionPrefix(String(rawTitle || '').trim());
            if (!title) return false;
            return /前缀说明|prefix\s+legend|操作统计|operation\s+counts|导出时间|export\s+time|书签变化导出|bookmark\s+changes\s+export/i.test(title);
        }

        function normalizeFolderPath(pathSegments, options = {}) {
            const stripPrefix = options && options.stripPrefix === true;
            return (pathSegments || [])
                .map((segment) => {
                    const value = String(segment || '').trim();
                    if (!value) return '';
                    return stripPrefix ? stripChangeActionPrefix(value) : value;
                })
                .filter(Boolean)
                .join(' / ');
        }

        function markFolderBadgeByPath(pathSegments, actionType) {
            const normalizedAction = normalizeChangeActionType(actionType, '');
            const mask = getChangeMaskByActionType(normalizedAction);
            if (!mask) return;
            const rawPath = normalizeFolderPath(pathSegments, { stripPrefix: false });
            if (!rawPath) return;
            const current = Number(folderBadgeByPath.get(rawPath)) || 0;
            folderBadgeByPath.set(rawPath, current | mask);
        }

        function nextBookmarkTreeNodeKey(baseKey) {
            const normalized = String(baseKey || '').trim();
            if (!normalized) return '';
            const count = (Number(bookmarkNodeKeyCount.get(normalized)) || 0) + 1;
            bookmarkNodeKeyCount.set(normalized, count);
            return count > 1 ? `${normalized}::${count}` : normalized;
        }

        function buildBookmarkNode(node, pathSegments, actionType) {
            const rawTitle = String(node?.title || '').trim();
            if (isChangesMetaTitle(rawTitle)) return null;
            const parsed = normalizeUrl(node?.url || '');
            if (!parsed) return null;
            if (String(parsed.protocol || '').toLowerCase() === 'about:') return null;

            const folderPath = normalizeFolderPath(pathSegments, { stripPrefix: false });
            const folderFilterKey = folderPath || '__root__';
            const baseBookmarkKey = `${parsed.toString()}::${folderFilterKey}`;
            const treeBookmarkKey = nextBookmarkTreeNodeKey(baseBookmarkKey);
            if (!treeBookmarkKey) return null;

            const host = String(parsed.hostname || '').trim().toLowerCase().replace(/^www\./, '');
            const domainParts = getDomainParts(host);
            const domain = domainParts.domain || domainParts.host || '';
            const subdomain = domainParts.hasSubdomain ? domainParts.host : '__root__';
            const normalizedAction = normalizeChangeActionType(actionType || '', '');
            const title = stripChangeActionPrefix(rawTitle) || parsed.toString();
            const badgeMask = getChangeMaskByActionType(normalizedAction);

            if (!seen.has(baseBookmarkKey)) {
                seen.add(baseBookmarkKey);
                results.push({
                    index: results.length,
                    sourceKey: SOURCE_CHANGES,
                    sourceLabel: t('sourceLabelCurrentChanges'),
                    id: '',
                    bookmarkFilterKey: baseBookmarkKey,
                    url: parsed.toString(),
                    title,
                    folderPath,
                    folderFilterKey,
                    folderFilterLabel: folderPath || t('rootFolderLabel'),
                    domain,
                    subdomain,
                    subdomainLabel: subdomain === '__root__' ? t('rootSubdomainLabel') : subdomain,
                    actionText: formatChangeActionText(normalizedAction),
                    actionType: normalizedAction || '',
                    host: host || domain
                });
            }

            return {
                kind: 'bookmark',
                key: treeBookmarkKey,
                filterKey: baseBookmarkKey,
                label: title,
                url: parsed.toString(),
                host: host || domain,
                domain,
                folderPath,
                actionType: normalizedAction,
                badgeMask
            };
        }

        function convertPayloadNodesToScopeTree(nodes, pathSegments = [], actionHint = '') {
            if (!Array.isArray(nodes)) return [];

            const converted = [];
            nodes.forEach((node) => {
                if (!node || typeof node !== 'object') return;

                const rawTitle = String(node.title || '').trim();
                const parsedAction = parseChangeActionFromTitle(rawTitle);
                const changeTypeAction = normalizeChangeActionType(node.changeType || '', '');
                const action = normalizeChangeActionType(parsedAction || changeTypeAction || actionHint || '', '');
                const hasChildren = Array.isArray(node.children) && node.children.length > 0;
                const bookmarkNode = buildBookmarkNode(node, pathSegments, action);
                if (bookmarkNode) {
                    converted.push(bookmarkNode);
                    return;
                }

                if (!hasChildren && (!rawTitle || isChangesMetaTitle(rawTitle))) {
                    return;
                }

                if (!rawTitle || isChangesMetaTitle(rawTitle)) {
                    const fallbackChildren = convertPayloadNodesToScopeTree(node.children, pathSegments, action);
                    if (fallbackChildren.length > 0) {
                        converted.push(...fallbackChildren);
                    }
                    return;
                }

                const nextPathSegments = pathSegments.concat([rawTitle]);
                markFolderBadgeByPath(nextPathSegments, action);
                const childNodes = hasChildren
                    ? convertPayloadNodesToScopeTree(node.children, nextPathSegments, action)
                    : [];

                let badgeMask = getChangeMaskByActionType(action);
                let bookmarkCount = 0;
                childNodes.forEach((childNode) => {
                    if (!childNode || typeof childNode !== 'object') return;
                    if (childNode.kind === 'bookmark') {
                        bookmarkCount += 1;
                    } else {
                        bookmarkCount += Number(childNode.count) || 0;
                    }
                    badgeMask |= Number(childNode.badgeMask) || 0;
                });

                const folderKey = normalizeFolderPath(nextPathSegments, { stripPrefix: false }) || '__root__';
                if (folderKey && badgeMask) {
                    const current = Number(folderBadgeByPath.get(folderKey)) || 0;
                    folderBadgeByPath.set(folderKey, current | badgeMask);
                }

                converted.push({
                    kind: 'folder',
                    key: folderKey,
                    label: rawTitle,
                    count: bookmarkCount,
                    badgeMask,
                    actionType: action,
                    children: childNodes
                });
            });

            return converted;
        }

        const scopeTreeNodes = convertPayloadNodesToScopeTree(rootNodes, [], '');
        return {
            items: results,
            folderBadgeByPath,
            scopeTreeNodes
        };
    }

    function buildFilterOptions(items) {
        const bookmarkMap = new Map();
        items.forEach((item) => {
            const key = item.bookmarkFilterKey || item.url;
            if (!key || bookmarkMap.has(key)) return;
            bookmarkMap.set(key, {
                key,
                label: `${item.title} (${item.host || item.domain || item.url})`,
                count: 1,
                url: item.url || '',
                host: item.host || item.domain || ''
            });
        });
        const bookmark = Array.from(bookmarkMap.values())
            .sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));

        const folderMap = new Map();
        const domainMap = new Map();
        const subdomainMap = new Map();

        items.forEach((item) => {
            const folderKey = String(item.folderFilterKey || '__root__').trim() || '__root__';
            const folderLabel = String(item.folderFilterLabel || t('rootFolderLabel')).trim() || t('rootFolderLabel');
            const folderRec = folderMap.get(folderKey) || { label: folderLabel, count: 0 };
            folderRec.count += 1;
            folderMap.set(folderKey, folderRec);

            if (item.domain) {
                domainMap.set(item.domain, (domainMap.get(item.domain) || 0) + 1);
            }

            const subKey = item.subdomain || '__root__';
            subdomainMap.set(subKey, (subdomainMap.get(subKey) || 0) + 1);
        });

        const folder = Array.from(folderMap.entries())
            .map(([key, value]) => ({ key, label: value.label, count: value.count }))
            .sort((a, b) => a.label.localeCompare(b.label));

        const domain = Array.from(domainMap.entries())
            .map(([key, count]) => ({ key, label: key, count }))
            .sort((a, b) => a.label.localeCompare(b.label));

        const subdomain = Array.from(subdomainMap.entries())
            .map(([key, count]) => ({
                key,
                label: key === '__root__' ? t('rootSubdomainLabel') : key,
                count
            }))
            .sort((a, b) => a.label.localeCompare(b.label));

        return {
            bookmark,
            folder,
            domain,
            subdomain
        };
    }

    function getNoDataMessageBySource(sourceKey) {
        if (sourceKey === SOURCE_CHANGES) return t('scopeNoChangeData');
        if (sourceKey === SOURCE_ALL_TABS) return t('scopeNoTabData');
        return t('scopeNoBookmarkData');
    }

    function pruneFiltersAgainstOptions(sourceKey) {
        const sourceState = getSourceState(sourceKey);
        FILTER_KEYS.forEach((kind) => {
            const allowed = new Set((sourceState.filterOptions[kind] || []).map(opt => opt.key));
            const next = new Set();
            sourceState.filters[kind].forEach((value) => {
                if (allowed.has(value)) next.add(value);
            });
            sourceState.filters[kind] = next;
        });
    }

    function normalizeFolderScopeKey(rawKey) {
        return String(rawKey || '__root__').trim() || '__root__';
    }

    function matchesSelectedFolderScope(itemFolderKey, selectedFolderSet) {
        if (!(selectedFolderSet instanceof Set) || selectedFolderSet.size === 0) return false;
        const normalizedItemKey = normalizeFolderScopeKey(itemFolderKey);
        for (const selected of selectedFolderSet) {
            const selectedKey = normalizeFolderScopeKey(selected);
            if (selectedKey === '__root__') {
                if (normalizedItemKey === '__root__') return true;
                continue;
            }
            if (normalizedItemKey === selectedKey || normalizedItemKey.startsWith(`${selectedKey} / `)) {
                return true;
            }
        }
        return false;
    }

    function applyFiltersForSource(sourceKey) {
        const sourceState = getSourceState(sourceKey);

        const hasBookmark = sourceState.filters.bookmark.size > 0;
        const hasFolder = sourceState.filters.folder.size > 0;
        const hasDomain = sourceState.filters.domain.size > 0;
        const hasSubdomain = sourceState.filters.subdomain.size > 0;
        const hasAnySelection = hasBookmark || hasFolder || hasDomain || hasSubdomain;
        if (!hasAnySelection) {
            sourceState.filteredItems = [];
            return;
        }

        sourceState.filteredItems = (sourceState.items || []).filter((item) => {
            const bookmarkMatched = hasBookmark && sourceState.filters.bookmark.has(item.bookmarkFilterKey || item.url);
            const folderMatched = hasFolder && matchesSelectedFolderScope(item.folderFilterKey || '__root__', sourceState.filters.folder);
            const domainMatched = hasDomain && sourceState.filters.domain.has(item.domain);
            const subdomainMatched = hasSubdomain && sourceState.filters.subdomain.has(item.subdomain || '__root__');
            return bookmarkMatched || folderMatched || domainMatched || subdomainMatched;
        });
    }

    function mergeSelectedItems() {
        const allMap = new Map();
        const selectedMap = new Map();

        SOURCE_KEYS.forEach((sourceKey) => {
            const sourceState = getSourceState(sourceKey);
            const sourceItems = Array.isArray(sourceState.items) ? sourceState.items : [];
            sourceItems.forEach((item) => {
                const key = String(item.url || '').trim();
                if (!key) return;
                if (!allMap.has(key)) {
                    allMap.set(key, { ...item });
                    return;
                }
                const existing = allMap.get(key);
                if (!existing.folderPath && item.folderPath) existing.folderPath = item.folderPath;
                if (!existing.title && item.title) existing.title = item.title;
            });

            const filtered = Array.isArray(sourceState.filteredItems) ? sourceState.filteredItems : [];
            filtered.forEach((item) => {
                const key = String(item.url || '').trim();
                if (!key) return;
                if (!selectedMap.has(key)) {
                    selectedMap.set(key, {
                        ...item,
                        _sourceSet: new Set([item.sourceLabel || sourceKey]),
                        _actionSet: new Set([item.actionText || '']),
                        existingTabId: Number.isFinite(Number(item.existingTabId)) ? Math.floor(Number(item.existingTabId)) : null,
                        useExistingTab: item.useExistingTab === true && Number.isFinite(Number(item.existingTabId))
                    });
                    return;
                }
                const existing = selectedMap.get(key);
                existing._sourceSet.add(item.sourceLabel || sourceKey);
                if (item.actionText) existing._actionSet.add(item.actionText);
                if (!existing.folderPath && item.folderPath) existing.folderPath = item.folderPath;
                if (!existing.title && item.title) existing.title = item.title;
                if (!existing.domain && item.domain) existing.domain = item.domain;
                if (!existing.subdomainLabel && item.subdomainLabel) existing.subdomainLabel = item.subdomainLabel;
                if ((!existing.useExistingTab || existing.existingTabId == null)
                    && item.useExistingTab === true
                    && Number.isFinite(Number(item.existingTabId))) {
                    existing.existingTabId = Math.floor(Number(item.existingTabId));
                    existing.useExistingTab = true;
                }
            });
        });

        state.sourceItems = Array.from(allMap.values());
        state.filteredItems = Array.from(selectedMap.values()).map((item) => {
            const sourceText = Array.from(item._sourceSet).filter(Boolean).join(' + ');
            const actionText = Array.from(item._actionSet).filter(Boolean).join(' | ');
            return {
                ...item,
                actionText: [sourceText, actionText].filter(Boolean).join(' · ')
            };
        });
    }

    function applyAllFilters() {
        SOURCE_KEYS.forEach((sourceKey) => {
            applyFiltersForSource(sourceKey);
        });
        mergeSelectedItems();
    }

    function hasAnyScopeSelection() {
        return SOURCE_KEYS.some((sourceKey) => {
            const sourceState = getSourceState(sourceKey);
            return FILTER_KEYS.some((kind) => sourceState.filters[kind].size > 0);
        });
    }

    function getActiveScopeSourceKey() {
        const kind = getActiveScopeKind();
        if (kind === 'domain' || kind === 'subdomain') return SOURCE_BOOKMARKS;
        return normalizeSourceKey(state.scopeUi?.sourceKey);
    }

    function getActiveScopeKind() {
        const kind = String(state.scopeUi?.kind || '').trim();
        return SCOPE_UI_KIND_KEYS.includes(kind) ? kind : 'folder';
    }

    function getCurrentChangesViewMode() {
        return normalizeChangesViewMode(state.scopeUi?.currentChangesResolvedMode, 'collection');
    }

    function getCurrentChangesModeLabel(mode) {
        const normalized = normalizeChangesViewMode(mode, 'collection');
        if (normalized === 'simple') return t('changesModeSimple');
        if (normalized === 'detailed') return t('changesModeDetailed');
        return t('changesModeCollection');
    }

    function getCurrentScopeSelectedInKind(sourceState, kind) {
        if (kind === 'whitelist') {
            return state.whitelistKeys instanceof Set ? state.whitelistKeys.size : 0;
        }
        if (kind === 'folder') {
            return (sourceState.filters.folder.size || 0) + (sourceState.filters.bookmark.size || 0);
        }
        if (!sourceState?.filters?.[kind]) return 0;
        return sourceState.filters[kind].size || 0;
    }

    function getCurrentScopeSelectedTotal(sourceKey) {
        const sourceState = getSourceState(sourceKey);
        return FILTER_KEYS.reduce((acc, kind) => acc + sourceState.filters[kind].size, 0);
    }

    function createScopeFolderTreeUiState() {
        return {
            expanded: new Set(),
            loaded: new Map()
        };
    }

    function ensureScopeFolderTreeUiState(sourceKey) {
        const normalized = normalizeSourceKey(sourceKey);
        if (!state.scopeUi || typeof state.scopeUi !== 'object') {
            state.scopeUi = {};
        }
        if (!state.scopeUi.folderTreeUi || typeof state.scopeUi.folderTreeUi !== 'object') {
            state.scopeUi.folderTreeUi = {};
        }

        let treeUi = state.scopeUi.folderTreeUi[normalized];
        if (!treeUi || typeof treeUi !== 'object') {
            treeUi = createScopeFolderTreeUiState();
            state.scopeUi.folderTreeUi[normalized] = treeUi;
        }
        if (!(treeUi.expanded instanceof Set)) {
            treeUi.expanded = new Set(Array.isArray(treeUi.expanded) ? treeUi.expanded : []);
        }
        if (!(treeUi.loaded instanceof Map)) {
            treeUi.loaded = new Map(Array.isArray(treeUi.loaded) ? treeUi.loaded : []);
        }
        return treeUi;
    }

    function ensureScopeGroupedUiState(sourceKey, kind) {
        const normalizedSource = normalizeSourceKey(sourceKey);
        const normalizedKind = kind === 'subdomain' ? 'subdomain' : 'domain';

        if (!state.scopeUi || typeof state.scopeUi !== 'object') {
            state.scopeUi = {};
        }
        if (!state.scopeUi.groupedUi || typeof state.scopeUi.groupedUi !== 'object') {
            state.scopeUi.groupedUi = {};
        }

        let sourceGrouped = state.scopeUi.groupedUi[normalizedSource];
        if (!sourceGrouped || typeof sourceGrouped !== 'object') {
            sourceGrouped = {};
            state.scopeUi.groupedUi[normalizedSource] = sourceGrouped;
        }

        let groupedUi = sourceGrouped[normalizedKind];
        if (!groupedUi || typeof groupedUi !== 'object') {
            groupedUi = createScopeFolderTreeUiState();
            sourceGrouped[normalizedKind] = groupedUi;
        }
        if (!(groupedUi.expanded instanceof Set)) {
            groupedUi.expanded = new Set(Array.isArray(groupedUi.expanded) ? groupedUi.expanded : []);
        }
        if (!(groupedUi.loaded instanceof Map)) {
            groupedUi.loaded = new Map(Array.isArray(groupedUi.loaded) ? groupedUi.loaded : []);
        }
        return groupedUi;
    }

    function getScopeKindIconClass(kind) {
        if (kind === 'folder') return 'fa-folder';
        if (kind === 'domain') return 'fa-globe';
        if (kind === 'subdomain') return 'fa-sitemap';
        return 'fa-bookmark';
    }

    function renderScopeOptionIconHtml(kind, opt) {
        const url = String(opt?.url || '').trim();
        const hasGetFavicon = (typeof getFaviconUrl === 'function');
        if (kind === 'bookmark' && url && hasGetFavicon) {
            const favicon = String(getFaviconUrl(url) || '').trim();
            if (favicon) {
                return `<img class="tree-icon dev1-scope-option-favicon" data-bookmark-url="${escapeHtml(url)}" src="${escapeHtml(favicon)}" alt="">`;
            }
        }
        return `<i class="fas ${escapeHtml(getScopeKindIconClass(kind))} dev1-scope-option-kind-icon"></i>`;
    }

    function buildScopeOptionRowHtml(sourceKey, kind, opt, checked) {
        const key = String(opt?.key || '');
        const label = String(opt?.label || '');
        const count = Number(opt?.count) || 0;
        const sourceText = sourceKey === SOURCE_CHANGES
            ? t('sourceLabelCurrentChanges')
            : (sourceKey === SOURCE_ALL_TABS ? t('sourceLabelAllTabs') : t('sourceLabelBookmarkApi'));
        return `
            <label class="manual-selector-item dev1-scope-option-item ${checked ? 'selected' : ''}">
                <input type="checkbox" class="add-result-checkbox dev1-scope-option-checkbox"
                    data-source="${escapeHtml(sourceKey)}"
                    data-kind="${escapeHtml(kind)}"
                    data-key="${escapeHtml(key)}"
                    ${checked ? 'checked' : ''}>
                <div class="manual-selector-item-info">
                    <div class="manual-selector-item-header">
                        <span class="dev1-scope-option-icon">${renderScopeOptionIconHtml(kind, opt)}</span>
                        <span class="manual-selector-item-name">${escapeHtml(label)}</span>
                        <span class="manual-selector-item-badge">${escapeHtml(String(count))}</span>
                    </div>
                    <div class="manual-selector-item-meta">
                        <i class="fas fa-layer-group"></i>
                        <span>${escapeHtml(sourceText)}</span>
                    </div>
                </div>
            </label>
        `;
    }

    function createUnifiedScopeFolderNode(key, label) {
        return {
            kind: 'folder',
            key,
            label,
            count: 0,
            badgeMask: 0,
            folders: new Map(),
            bookmarks: []
        };
    }

    function filterUnifiedScopeTreeNodes(nodes, keyword) {
        const query = String(keyword || '').trim();
        if (!query) return nodes;
        const allowPathMatch = shouldEnableScopePathFieldMatch(query);

        function visit(node) {
            if (!node) return null;

            if (node.kind === 'bookmark') {
                const matched = matchesScopeSearchFields({
                    title: node.label,
                    url: node.url,
                    host: node.host,
                    domain: node.domain,
                    path: node.folderPath
                }, query, { allowPathMatch });
                return matched ? node : null;
            }

            const selfMatch = matchesScopeSearchFields({
                title: node.label,
                path: node.key
            }, query, { allowPathMatch });
            const rawChildren = Array.isArray(node.children) ? node.children : [];
            if (selfMatch) {
                return {
                    ...node,
                    children: rawChildren
                };
            }

            const filteredChildren = rawChildren
                .map(child => visit(child))
                .filter(Boolean);
            if (filteredChildren.length === 0) return null;
            return {
                ...node,
                children: filteredChildren
            };
        }

        return (nodes || [])
            .map(node => visit(node))
            .filter(Boolean);
    }

    function buildFlatScopeSearchOptionsFromTree(nodes, keyword) {
        const query = String(keyword || '').trim();
        if (!query) return [];
        const allowPathMatch = shouldEnableScopePathFieldMatch(query);
        const results = [];
        const seen = new Set();

        function pushOption(kind, key, payload = {}) {
            const normalizedKind = kind === 'folder' ? 'folder' : 'bookmark';
            const normalizedKey = String(key || '').trim();
            if (!normalizedKey) return;
            const dedupeKey = `${normalizedKind}::${normalizedKey}`;
            if (seen.has(dedupeKey)) return;
            seen.add(dedupeKey);
            results.push({
                kind: normalizedKind,
                key: normalizedKey,
                ...payload
            });
        }

        (function visit(list) {
            (list || []).forEach((node) => {
                if (!node || typeof node !== 'object') return;

                if (node.kind === 'bookmark') {
                    const bookmarkKey = getScopeSelectionBookmarkKey(node);
                    const matched = matchesScopeSearchFields({
                        title: node.label,
                        url: node.url,
                        host: node.host,
                        domain: node.domain,
                        path: node.folderPath
                    }, query, { allowPathMatch });
                    if (matched) {
                        pushOption('bookmark', bookmarkKey, {
                            label: String(node.label || ''),
                            url: String(node.url || '').trim(),
                            host: String(node.host || '').trim(),
                            count: 1,
                            actionType: String(node.actionType || '').trim(),
                            badgeMask: Number(node.badgeMask) || getChangeMaskByActionType(node.actionType || '')
                        });
                    }
                    return;
                }

                const folderKey = String(node.key || '').trim();
                const matched = matchesScopeSearchFields({
                    title: node.label,
                    path: node.key
                }, query, { allowPathMatch });
                if (matched) {
                    pushOption('folder', folderKey, {
                        label: String(node.label || ''),
                        count: Math.max(0, Number(node.count) || 0),
                        actionType: String(node.actionType || '').trim(),
                        badgeMask: Number(node.badgeMask) || 0
                    });
                }

                visit(node.children || []);
            });
        })(nodes || []);

        return results.sort((a, b) => {
            if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
            const labelCompare = String(a.label || '').localeCompare(String(b.label || ''), undefined, { sensitivity: 'base' });
            if (labelCompare !== 0) return labelCompare;
            return String(a.key || '').localeCompare(String(b.key || ''), undefined, { sensitivity: 'base' });
        });
    }

    function buildUnifiedScopeTreeModel(sourceItems, keyword = '', options = {}) {
        const folderBadgeByPath = options?.folderBadgeByPath instanceof Map ? options.folderBadgeByPath : null;
        const root = {
            folders: new Map(),
            bookmarks: []
        };
        const seenBookmarkKeys = new Set();

        function normalizeSegmentLabel(rawSegment) {
            const normalized = stripChangeActionPrefix(String(rawSegment || '').trim());
            return normalized || String(rawSegment || '').trim();
        }

        (sourceItems || []).forEach((item) => {
            const bookmarkKey = String(item?.bookmarkFilterKey || item?.url || '').trim();
            if (!bookmarkKey || seenBookmarkKeys.has(bookmarkKey)) return;
            seenBookmarkKeys.add(bookmarkKey);

            const bookmarkChangeMask = getChangeMaskByActionType(item?.actionType || '');
            const folderPath = String(item?.folderPath || '').trim();
            const segments = folderPath
                ? folderPath
                    .split(' / ')
                    .map(s => normalizeSegmentLabel(s))
                    .filter(Boolean)
                : [];
            let cursor = root;
            let pathAcc = '';

            segments.forEach((segment) => {
                pathAcc = pathAcc ? `${pathAcc} / ${segment}` : segment;
                let folderNode = cursor.folders.get(pathAcc);
                if (!folderNode) {
                    folderNode = createUnifiedScopeFolderNode(pathAcc, segment);
                    cursor.folders.set(pathAcc, folderNode);
                }
                folderNode.count += 1;
                folderNode.badgeMask |= bookmarkChangeMask;
                cursor = folderNode;
            });

            cursor.bookmarks.push({
                kind: 'bookmark',
                key: bookmarkKey,
                filterKey: bookmarkKey,
                label: String(item?.title || item?.url || t('unknown')).trim() || t('unknown'),
                url: String(item?.url || '').trim(),
                host: String(item?.host || item?.domain || '').trim(),
                domain: String(item?.domain || '').trim(),
                folderPath: folderPath,
                actionType: String(item?.actionType || '').trim(),
                badgeMask: bookmarkChangeMask
            });
        });

        if (folderBadgeByPath && folderBadgeByPath.size > 0) {
            folderBadgeByPath.forEach((maskRaw, rawPath) => {
                const mask = Number(maskRaw) || 0;
                if (!mask) return;
                const segments = String(rawPath || '')
                    .split(' / ')
                    .map(s => normalizeSegmentLabel(s))
                    .filter(Boolean);
                if (segments.length === 0) return;
                let cursor = root;
                let pathAcc = '';
                let missingNode = false;
                segments.forEach((segment) => {
                    if (missingNode) return;
                    pathAcc = pathAcc ? `${pathAcc} / ${segment}` : segment;
                    const folderNode = cursor.folders.get(pathAcc);
                    if (!folderNode) {
                        missingNode = true;
                        return;
                    }
                    folderNode.badgeMask |= mask;
                    cursor = folderNode;
                });
            });
        }

        const compareLabel = (a, b) => String(a?.label || '').localeCompare(String(b?.label || ''), undefined, { sensitivity: 'base' });
        const compareBookmark = (a, b) => {
            const labelCompare = compareLabel(a, b);
            if (labelCompare !== 0) return labelCompare;
            return String(a?.url || '').localeCompare(String(b?.url || ''));
        };

        function finalizeFolderNode(folderNode) {
            const childFolders = Array.from(folderNode.folders.values())
                .sort(compareLabel)
                .map(finalizeFolderNode);
            const childBookmarks = (folderNode.bookmarks || []).slice().sort(compareBookmark);
            let badgeMask = Number(folderNode.badgeMask) || 0;
            childFolders.forEach((childFolder) => {
                badgeMask |= Number(childFolder?.badgeMask || 0);
            });
            childBookmarks.forEach((childBookmark) => {
                badgeMask |= Number(childBookmark?.badgeMask || 0);
            });
            return {
                kind: 'folder',
                key: String(folderNode.key || ''),
                label: String(folderNode.label || ''),
                count: Number(folderNode.count) || 0,
                badgeMask,
                children: [...childFolders, ...childBookmarks]
            };
        }

        const rootFolderNodes = Array.from(root.folders.values())
            .sort(compareLabel)
            .map(finalizeFolderNode);
        const rootBookmarks = (root.bookmarks || []).slice().sort(compareBookmark);

        const nodes = [];
        if (rootBookmarks.length > 0) {
            let rootBadgeMask = 0;
            rootBookmarks.forEach((bookmark) => {
                rootBadgeMask |= Number(bookmark?.badgeMask || 0);
            });
            nodes.push({
                kind: 'folder',
                key: '__root__',
                label: t('rootFolderLabel'),
                count: rootBookmarks.length,
                badgeMask: rootBadgeMask,
                children: rootBookmarks
            });
        }
        nodes.push(...rootFolderNodes);

        const filteredNodes = filterUnifiedScopeTreeNodes(nodes, keyword);
        const folderKeySet = new Set();
        const folderChildCountMap = new Map();
        (function walk(list) {
            (list || []).forEach((node) => {
                if (!node || node.kind !== 'folder') return;
                const key = String(node.key || '').trim();
                if (key) {
                    folderKeySet.add(key);
                    folderChildCountMap.set(key, Array.isArray(node.children) ? node.children.length : 0);
                }
                walk(node.children || []);
            });
        })(filteredNodes);

        return {
            nodes: filteredNodes,
            folderKeySet,
            folderChildCountMap
        };
    }

    function buildScopeTreeMeta(nodes) {
        const folderKeySet = new Set();
        const folderChildCountMap = new Map();

        (function walk(list) {
            (list || []).forEach((node) => {
                if (!node || node.kind !== 'folder') return;
                const key = String(node.key || '').trim();
                if (key) {
                    folderKeySet.add(key);
                    folderChildCountMap.set(key, Array.isArray(node.children) ? node.children.length : 0);
                }
                walk(node.children || []);
            });
        })(nodes || []);

        return { folderKeySet, folderChildCountMap };
    }

    function pruneScopeTreeUiState(treeUi, folderKeySet) {
        if (!treeUi || !(treeUi.expanded instanceof Set) || !(treeUi.loaded instanceof Map)) return;
        treeUi.expanded.forEach((key) => {
            if (!folderKeySet.has(key)) treeUi.expanded.delete(key);
        });
        Array.from(treeUi.loaded.keys()).forEach((key) => {
            if (!folderKeySet.has(key)) treeUi.loaded.delete(key);
        });
    }

    function ensureFolderNodeLazyOffset(treeUi, folderKey, totalChildren) {
        const total = Math.max(0, Number(totalChildren) || 0);
        if (total === 0) {
            treeUi.loaded.delete(folderKey);
            return 0;
        }

        const current = Math.max(0, Number(treeUi.loaded.get(folderKey)) || 0);
        if (current > 0) {
            const normalized = Math.min(total, current);
            if (normalized !== current) treeUi.loaded.set(folderKey, normalized);
            return normalized;
        }

        const initial = Math.min(total, SCOPE_TREE_CHILD_BATCH);
        treeUi.loaded.set(folderKey, initial);
        return initial;
    }

    function getScopeSelectionBookmarkKey(node) {
        return String(node?.filterKey || node?.key || '').trim();
    }

    function buildFullScopeTreeNodesForSource(sourceKey, sourceState) {
        if (sourceKey === SOURCE_CHANGES && Array.isArray(sourceState.scopeTreeNodes) && sourceState.scopeTreeNodes.length > 0) {
            return sourceState.scopeTreeNodes;
        }
        const treeData = buildUnifiedScopeTreeModel(sourceState.items || [], '', {
            folderBadgeByPath: sourceState.folderBadgeByPath
        });
        return Array.isArray(treeData?.nodes) ? treeData.nodes : [];
    }

    function collectFolderSubtreeSelectionKeys(sourceKey, sourceState, folderKey) {
        const normalizedFolderKey = normalizeFolderScopeKey(folderKey);
        const folderKeys = new Set();
        const bookmarkKeys = new Set();
        if (!normalizedFolderKey) {
            return { folderKeys, bookmarkKeys };
        }

        function collectAll(node) {
            if (!node || typeof node !== 'object' || node.kind !== 'folder') return;
            const currentFolderKey = normalizeFolderScopeKey(node.key);
            if (currentFolderKey) folderKeys.add(currentFolderKey);
            const children = Array.isArray(node.children) ? node.children : [];
            children.forEach((child) => {
                if (!child || typeof child !== 'object') return;
                if (child.kind === 'folder') {
                    collectAll(child);
                    return;
                }
                const bookmarkKey = getScopeSelectionBookmarkKey(child);
                if (bookmarkKey) bookmarkKeys.add(bookmarkKey);
            });
        }

        function visit(nodes) {
            const list = Array.isArray(nodes) ? nodes : [];
            for (const node of list) {
                if (!node || typeof node !== 'object' || node.kind !== 'folder') continue;
                const currentFolderKey = normalizeFolderScopeKey(node.key);
                if (currentFolderKey === normalizedFolderKey) {
                    collectAll(node);
                    return true;
                }
                if (visit(node.children || [])) return true;
            }
            return false;
        }

        const fullTreeNodes = buildFullScopeTreeNodesForSource(sourceKey, sourceState);
        visit(fullTreeNodes);

        if (folderKeys.size === 0) {
            folderKeys.add(normalizedFolderKey);
        }
        if (bookmarkKeys.size === 0) {
            (sourceState.items || []).forEach((item) => {
                if (!item || typeof item !== 'object') return;
                if (!matchesSelectedFolderScope(item.folderFilterKey || '__root__', new Set([normalizedFolderKey]))) return;
                const bookmarkKey = String(item.bookmarkFilterKey || item.url || '').trim();
                if (bookmarkKey) bookmarkKeys.add(bookmarkKey);
            });
        }

        return { folderKeys, bookmarkKeys };
    }

    function normalizeScopeBookmarkFilterKey(sourceKey, sourceState, rawKey) {
        const normalized = String(rawKey || '').trim();
        if (!normalized) return '';

        const hasExact = (sourceState.items || []).some((item) => {
            return String(item?.bookmarkFilterKey || item?.url || '').trim() === normalized;
        });
        if (hasExact) return normalized;

        if (sourceKey === SOURCE_CHANGES) {
            const fallback = normalized.replace(/::\d+$/, '');
            if (fallback && fallback !== normalized) {
                const hasFallback = (sourceState.items || []).some((item) => {
                    return String(item?.bookmarkFilterKey || item?.url || '').trim() === fallback;
                });
                if (hasFallback) return fallback;
            }
        }

        return normalized;
    }

    function renderUnifiedScopeTreeChildrenHtml(children, sourceKey, sourceState, treeUi, depth, options = {}) {
        return (children || [])
            .map(child => renderUnifiedScopeTreeNodeHtml(child, sourceKey, sourceState, treeUi, depth, options))
            .join('');
    }

    function renderUnifiedScopeTreeNodeHtml(node, sourceKey, sourceState, treeUi, depth, options = {}) {
        if (!node || typeof node !== 'object') return '';
        const forceExpandAll = options && options.forceExpandAll === true;

        if (node.kind === 'bookmark') {
            const key = getScopeSelectionBookmarkKey(node);
            const checked = sourceState.filters.bookmark.has(key);
            const host = String(node.host || '').trim();
            const titleChangeClass = getScopeTitleChangeClass(sourceKey, node.actionType || '');
            const changeBadgesHtml = sourceKey === SOURCE_CHANGES
                ? renderScopeChangeBadgesHtml(node.badgeMask || getChangeMaskByActionType(node.actionType || ''))
                : '';
            const hostHtml = host
                ? `<span class="dev1-folder-tree-host" title="${escapeHtml(host)}">${escapeHtml(host)}</span>`
                : '';
            return `
                <div class="folder-tree-node is-bookmark" style="--tree-depth:${Number(depth) || 0};">
                    <label class="folder-tree-item dev1-folder-tree-item is-bookmark ${checked ? 'selected' : ''} ${escapeHtml(titleChangeClass)}">
                        <span class="dev1-folder-tree-toggle-spacer" aria-hidden="true"></span>
                        <input type="checkbox" class="add-result-checkbox dev1-scope-option-checkbox"
                            data-source="${escapeHtml(sourceKey)}"
                            data-kind="bookmark"
                            data-key="${escapeHtml(key)}"
                            ${checked ? 'checked' : ''}>
                        <span class="dev1-folder-tree-bookmark-icon">${renderScopeOptionIconHtml('bookmark', { url: node.url })}</span>
                        <span class="folder-tree-title tree-label" title="${escapeHtml(String(node.label || ''))}">${escapeHtml(String(node.label || ''))}</span>
                        ${changeBadgesHtml}
                        ${hostHtml}
                    </label>
                </div>
            `;
        }

        const folderKey = String(node.key || '').trim();
        const checked = sourceState.filters.folder.has(folderKey);
        const children = Array.isArray(node.children) ? node.children : [];
        const hasChildren = children.length > 0;
        const expanded = hasChildren && (forceExpandAll || treeUi.expanded.has(folderKey));
        const loadedCount = expanded
            ? (forceExpandAll ? children.length : ensureFolderNodeLazyOffset(treeUi, folderKey, children.length))
            : 0;
        const visibleChildren = expanded ? children.slice(0, loadedCount) : [];
        const remaining = Math.max(0, children.length - loadedCount);
        const childrenHtml = expanded
            ? renderUnifiedScopeTreeChildrenHtml(visibleChildren, sourceKey, sourceState, treeUi, depth + 1, options)
            : '';
        const loadMoreHtml = expanded && remaining > 0
            ? `
                <button type="button" class="dev1-folder-tree-load-more"
                    data-source="${escapeHtml(sourceKey)}"
                    data-folder-key="${escapeHtml(folderKey)}"
                    data-total="${escapeHtml(String(children.length))}"
                    style="--tree-depth:${Number(depth) || 0};">
                    ${escapeHtml(getLangKey() === 'en' ? `Load more (${remaining} remaining)` : `加载更多（剩余 ${remaining} 项）`)}
                </button>
            `
            : '';
        const toggleDisabled = hasChildren ? '' : 'disabled';
        const toggleExpanded = expanded ? 'true' : 'false';
        const folderIcon = expanded ? 'fa-folder-open' : 'fa-folder';
        const folderTitleChangeClass = getScopeTitleChangeClass(sourceKey, node.actionType || '');
        const pathBadgesHtml = sourceKey === SOURCE_CHANGES
            ? renderScopePathBadgesHtml(node.badgeMask || 0)
            : '';

        return `
            <div class="folder-tree-node" style="--tree-depth:${Number(depth) || 0};">
                <div class="folder-tree-item dev1-folder-tree-item ${checked ? 'selected' : ''} ${escapeHtml(folderTitleChangeClass)}" data-folder-key="${escapeHtml(folderKey)}">
                    <button type="button" class="dev1-folder-tree-toggle ${expanded ? 'expanded' : ''}"
                        data-source="${escapeHtml(sourceKey)}"
                        data-folder-key="${escapeHtml(folderKey)}"
                        aria-label="${escapeHtml(getLangKey() === 'en' ? 'Toggle folder' : '展开或折叠文件夹')}"
                        aria-expanded="${escapeHtml(toggleExpanded)}"
                        ${toggleDisabled}>
                        <i class="fas fa-chevron-right"></i>
                    </button>
                    <input type="checkbox" class="add-result-checkbox dev1-scope-option-checkbox"
                        data-source="${escapeHtml(sourceKey)}"
                        data-kind="folder"
                        data-key="${escapeHtml(folderKey)}"
                        ${checked ? 'checked' : ''}>
                    <i class="fas ${escapeHtml(folderIcon)} dev1-folder-tree-folder-icon"></i>
                    <span class="folder-tree-title tree-label" title="${escapeHtml(String(node.label || ''))}">${escapeHtml(String(node.label || ''))}</span>
                    ${pathBadgesHtml}
                    <span class="folder-count">${escapeHtml(String(Number(node.count) || 0))}</span>
                </div>
                <div class="folder-tree-children ${expanded ? 'expanded' : ''}" ${expanded ? '' : 'hidden'}>
                    ${childrenHtml}
                    ${loadMoreHtml}
                </div>
            </div>
        `;
    }

    function renderUnifiedScopeTreeHtml(treeNodes, sourceKey, sourceState, options = {}) {
        const treeUi = ensureScopeFolderTreeUiState(sourceKey);
        return renderUnifiedScopeTreeChildrenHtml(treeNodes, sourceKey, sourceState, treeUi, 0, options);
    }

    function buildScopeSearchFlatRowHtml(sourceKey, sourceState, option) {
        const kind = option?.kind === 'folder' ? 'folder' : 'bookmark';
        const key = String(option?.key || '').trim();
        if (!key) return '';
        const normalizedBookmarkKey = kind === 'bookmark'
            ? normalizeScopeBookmarkFilterKey(sourceKey, sourceState, key)
            : '';
        const checked = kind === 'bookmark'
            ? !!normalizedBookmarkKey && sourceState.filters.bookmark.has(normalizedBookmarkKey)
            : sourceState.filters.folder.has(key);
        const label = String(option?.label || '').trim() || t('unknown');
        const count = Math.max(0, Number(option?.count) || 0);
        const badgeHtml = count > 0
            ? `<span class="manual-selector-item-badge">${escapeHtml(String(count))}</span>`
            : '';
        const titleChangeClass = getScopeTitleChangeClass(sourceKey, option?.actionType || '');
        const changeBadgesHtml = sourceKey === SOURCE_CHANGES
            ? renderScopeChangeBadgesHtml(option?.badgeMask || getChangeMaskByActionType(option?.actionType || ''))
            : '';
        return `
            <label class="manual-selector-item dev1-scope-option-item ${checked ? 'selected' : ''} ${escapeHtml(titleChangeClass)}">
                <input type="checkbox" class="add-result-checkbox dev1-scope-option-checkbox"
                    data-source="${escapeHtml(sourceKey)}"
                    data-kind="${escapeHtml(kind)}"
                    data-key="${escapeHtml(key)}"
                    ${checked ? 'checked' : ''}>
                <div class="manual-selector-item-info">
                    <div class="manual-selector-item-header">
                        <span class="dev1-scope-option-icon">${renderScopeOptionIconHtml(kind, option || {})}</span>
                        <span class="manual-selector-item-name">${escapeHtml(label)}</span>
                        ${changeBadgesHtml}
                        ${badgeHtml}
                    </div>
                </div>
            </label>
        `;
    }

    function toggleScopeFolderTreeExpand(sourceKey, folderKey, forcedExpanded = null) {
        const normalizedFolderKey = String(folderKey || '').trim();
        if (!normalizedFolderKey) return;
        const treeUi = ensureScopeFolderTreeUiState(sourceKey);
        const currentlyExpanded = treeUi.expanded.has(normalizedFolderKey);
        const nextExpanded = forcedExpanded == null ? !currentlyExpanded : !!forcedExpanded;
        if (nextExpanded) {
            treeUi.expanded.add(normalizedFolderKey);
            if (!treeUi.loaded.has(normalizedFolderKey)) {
                treeUi.loaded.set(normalizedFolderKey, 0);
            }
        } else {
            treeUi.expanded.delete(normalizedFolderKey);
        }
    }

    function loadMoreScopeFolderTreeChildren(sourceKey, folderKey, totalChildren) {
        const normalizedFolderKey = String(folderKey || '').trim();
        if (!normalizedFolderKey) return;
        const total = Math.max(0, Number(totalChildren) || 0);
        if (total <= 0) return;
        const treeUi = ensureScopeFolderTreeUiState(sourceKey);
        const current = Math.max(0, Number(treeUi.loaded.get(normalizedFolderKey)) || 0);
        const next = Math.min(total, current + SCOPE_TREE_CHILD_BATCH);
        treeUi.loaded.set(normalizedFolderKey, next);
    }

    function buildScopeGroupedDimensionModel(sourceItems, kind, keyword = '') {
        const normalizedKind = kind === 'subdomain' ? 'subdomain' : 'domain';
        const groupMap = new Map();

        (sourceItems || []).forEach((item) => {
            const bookmarkKey = String(item?.bookmarkFilterKey || item?.url || '').trim();
            if (!bookmarkKey) return;

            let groupKey = '';
            if (normalizedKind === 'domain') {
                groupKey = String(item?.domain || '').trim().toLowerCase();
                if (!groupKey) return;
            } else {
                const rawSubdomain = String(item?.subdomain || '').trim().toLowerCase();
                groupKey = rawSubdomain || '__root__';
            }

            let group = groupMap.get(groupKey);
            if (!group) {
                group = {
                    key: groupKey,
                    label: normalizedKind === 'subdomain' && groupKey === '__root__'
                        ? t('rootSubdomainLabel')
                        : groupKey,
                    totalCount: 0,
                    badgeMask: 0,
                    children: [],
                    seenBookmarkKeys: new Set()
                };
                groupMap.set(groupKey, group);
            }

            if (group.seenBookmarkKeys.has(bookmarkKey)) return;
            group.seenBookmarkKeys.add(bookmarkKey);
            group.totalCount += 1;
            const actionType = normalizeChangeActionType(item?.actionType || '', '');
            const badgeMask = getChangeMaskByActionType(actionType);
            group.badgeMask |= badgeMask;
            group.children.push({
                key: bookmarkKey,
                label: String(item?.title || item?.url || t('unknown')).trim() || t('unknown'),
                url: String(item?.url || '').trim(),
                host: String(item?.host || '').trim().toLowerCase(),
                domain: String(item?.domain || '').trim().toLowerCase(),
                subdomain: String(item?.subdomain || '').trim().toLowerCase() || '__root__',
                folderPath: String(item?.folderPath || '').trim(),
                actionType,
                badgeMask
            });
        });

        const compareByLabel = (a, b) => {
            const titleCompare = String(a?.label || '').localeCompare(String(b?.label || ''), undefined, { sensitivity: 'base' });
            if (titleCompare !== 0) return titleCompare;
            return String(a?.url || '').localeCompare(String(b?.url || ''), undefined, { sensitivity: 'base' });
        };

        const query = String(keyword || '').trim();
        const allowPathMatch = shouldEnableScopePathFieldMatch(query);
        const groups = Array.from(groupMap.values())
            .map((group) => {
                const allChildren = (group.children || []).slice().sort(compareByLabel);
                if (!query) {
                    return {
                        key: group.key,
                        label: group.label,
                        totalCount: group.totalCount,
                        displayCount: group.totalCount,
                        badgeMask: Number(group.badgeMask) || 0,
                        children: allChildren
                    };
                }

                const selfMatched = matchesScopeSearchFields({
                    title: group.label,
                    host: group.key,
                    domain: group.key
                }, query, { allowPathMatch });
                if (selfMatched) {
                    return {
                        key: group.key,
                        label: group.label,
                        totalCount: group.totalCount,
                        displayCount: group.totalCount,
                        badgeMask: Number(group.badgeMask) || 0,
                        children: allChildren
                    };
                }

                const matchedChildren = allChildren.filter((child) => {
                    return matchesScopeSearchFields({
                        title: child.label,
                        url: child.url,
                        host: child.host,
                        domain: child.domain,
                        path: child.folderPath
                    }, query, { allowPathMatch });
                });
                if (matchedChildren.length === 0) return null;
                return {
                    key: group.key,
                    label: group.label,
                    totalCount: group.totalCount,
                    displayCount: matchedChildren.length,
                    badgeMask: matchedChildren.reduce((acc, child) => acc | (Number(child?.badgeMask) || 0), 0),
                    children: matchedChildren
                };
            })
            .filter(Boolean)
            .sort((a, b) => {
                if (Number(b.displayCount) !== Number(a.displayCount)) {
                    return Number(b.displayCount) - Number(a.displayCount);
                }
                return String(a.label || '').localeCompare(String(b.label || ''), undefined, { sensitivity: 'base' });
            });

        return {
            groups,
            groupKeySet: new Set(groups.map(group => String(group.key || '').trim()).filter(Boolean))
        };
    }

    function renderScopeGroupedDimensionChildHtml(sourceKey, kind, groupKey, child) {
        const title = String(child?.label || t('unknown'));
        const url = String(child?.url || '').trim();
        const host = String(child?.host || '').trim().toLowerCase();
        const domain = String(child?.domain || '').trim().toLowerCase();
        const subdomain = String(child?.subdomain || '').trim().toLowerCase();
        const childBadgeMask = Number(child?.badgeMask) || getChangeMaskByActionType(child?.actionType || '');
        const childTitleChangeClass = getScopeTitleChangeClass(sourceKey, child?.actionType || '');
        const changeBadgesHtml = sourceKey === SOURCE_CHANGES
            ? renderScopeChangeBadgesHtml(childBadgeMask)
            : '';

        let meta = '';
        if (kind === 'domain') {
            const hostLabel = host && host !== groupKey ? host : '';
            meta = [hostLabel, url].filter(Boolean).join(' · ');
        } else {
            const domainLabel = domain && domain !== subdomain ? domain : '';
            meta = [domainLabel, url].filter(Boolean).join(' · ');
        }
        if (!meta) meta = url || host || domain || '-';

        return `
            <div class="dev1-scope-group-child-row">
                <span class="dev1-scope-group-child-icon">${renderScopeOptionIconHtml('bookmark', { url })}</span>
                <div class="dev1-scope-group-child-main">
                    <div class="dev1-scope-group-child-title-row">
                        <div class="dev1-scope-group-child-title tree-label ${escapeHtml(childTitleChangeClass)}" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
                        ${changeBadgesHtml}
                    </div>
                    <div class="dev1-scope-group-child-meta" title="${escapeHtml(meta)}">${escapeHtml(meta)}</div>
                </div>
            </div>
        `;
    }

    function isScopeGroupWhitelisted(kind, groupKey) {
        const normalizedKind = kind === 'subdomain' ? 'subdomain' : 'domain';
        if (normalizedKind === 'domain') {
            const normalizedDomain = normalizeDomainWhitelistKey(groupKey);
            return !!(normalizedDomain
                && state.whitelistDomainKeys instanceof Set
                && state.whitelistDomainKeys.has(normalizedDomain));
        }
        const normalizedSubdomain = normalizeSubdomainWhitelistKey(groupKey === '__root__' ? '' : groupKey);
        return !!(normalizedSubdomain
            && state.whitelistSubdomainKeys instanceof Set
            && state.whitelistSubdomainKeys.has(normalizedSubdomain));
    }

    function renderScopeGroupedDimensionHtml(sourceKey, kind, sourceState, groupedData) {
        const groupedUi = ensureScopeGroupedUiState(sourceKey, kind);
        const groups = Array.isArray(groupedData?.groups) ? groupedData.groups : [];
        return groups.map((group) => {
            const groupKey = String(group?.key || '').trim();
            const hasChildren = Array.isArray(group?.children) && group.children.length > 0;
            const expanded = hasChildren && groupedUi.expanded.has(groupKey);
            const loadedCount = expanded ? ensureFolderNodeLazyOffset(groupedUi, groupKey, group.children.length) : 0;
            const visibleChildren = expanded ? group.children.slice(0, loadedCount) : [];
            const remaining = Math.max(0, (group.children || []).length - loadedCount);
            const checked = sourceState.filters[kind].has(groupKey);
            const iconClass = kind === 'subdomain' ? 'fa-sitemap' : 'fa-globe';
            const toggleDisabled = hasChildren ? '' : 'disabled';
            const countText = Number(group.displayCount) < Number(group.totalCount)
                ? `${Number(group.displayCount)}/${Number(group.totalCount)}`
                : String(Number(group.totalCount) || 0);
            const groupPathBadgesHtml = sourceKey === SOURCE_CHANGES
                ? renderScopePathBadgesHtml(group.badgeMask || 0)
                : '';
            const whitelistMarkHtml = isScopeGroupWhitelisted(kind, groupKey)
                ? `
                    <span class="dev1-scope-group-whitelist-mark"
                        title="${escapeHtml(t('scopeWhitelistBadge'))}"
                        aria-label="${escapeHtml(t('scopeWhitelistBadge'))}">
                        <i class="fas fa-shield-alt"></i>
                    </span>
                `
                : '';
            const childrenHtml = expanded
                ? visibleChildren.map((child) => renderScopeGroupedDimensionChildHtml(sourceKey, kind, groupKey, child)).join('')
                : '';
            const loadMoreHtml = expanded && remaining > 0
                ? `
                    <button type="button" class="dev1-scope-group-load-more"
                        data-source="${escapeHtml(sourceKey)}"
                        data-kind="${escapeHtml(kind)}"
                        data-group-key="${escapeHtml(groupKey)}"
                        data-total="${escapeHtml(String(group.children.length))}">
                        ${escapeHtml(getLangKey() === 'en' ? `Load more (${remaining} remaining)` : `加载更多（剩余 ${remaining} 项）`)}
                    </button>
                `
                : '';
            return `
                <div class="dev1-scope-group-node">
                    <div class="dev1-scope-group-row ${checked ? 'selected' : ''}" data-kind="${escapeHtml(kind)}" data-group-key="${escapeHtml(groupKey)}">
                        <button type="button" class="dev1-scope-group-toggle ${expanded ? 'expanded' : ''}"
                            data-source="${escapeHtml(sourceKey)}"
                            data-kind="${escapeHtml(kind)}"
                            data-group-key="${escapeHtml(groupKey)}"
                            aria-label="${escapeHtml(getLangKey() === 'en' ? 'Toggle group' : '展开或收起候选项')}"
                            aria-expanded="${expanded ? 'true' : 'false'}"
                            ${toggleDisabled}>
                            <i class="fas fa-chevron-right"></i>
                        </button>
                        <input type="checkbox" class="add-result-checkbox dev1-scope-option-checkbox"
                            data-source="${escapeHtml(sourceKey)}"
                            data-kind="${escapeHtml(kind)}"
                            data-key="${escapeHtml(groupKey)}"
                            ${checked ? 'checked' : ''}>
                        <i class="fas ${escapeHtml(iconClass)} dev1-scope-group-kind-icon"></i>
                        <span class="dev1-scope-group-title-wrap">
                            <span class="dev1-scope-group-title tree-label" title="${escapeHtml(String(group?.label || ''))}">${escapeHtml(String(group?.label || ''))}</span>
                            ${whitelistMarkHtml}
                        </span>
                        ${groupPathBadgesHtml}
                        <span class="dev1-scope-group-count">${escapeHtml(countText)}</span>
                    </div>
                    <div class="dev1-scope-group-children" ${expanded ? '' : 'hidden'}>
                        ${childrenHtml}
                        ${loadMoreHtml}
                    </div>
                </div>
            `;
        }).join('');
    }

    function toggleScopeGroupedDimensionExpand(sourceKey, kind, groupKey, forcedExpanded = null) {
        const normalizedGroupKey = String(groupKey || '').trim();
        if (!normalizedGroupKey) return;
        const groupedUi = ensureScopeGroupedUiState(sourceKey, kind);
        const currentlyExpanded = groupedUi.expanded.has(normalizedGroupKey);
        const nextExpanded = forcedExpanded == null ? !currentlyExpanded : !!forcedExpanded;
        if (nextExpanded) {
            groupedUi.expanded.add(normalizedGroupKey);
            if (!groupedUi.loaded.has(normalizedGroupKey)) {
                groupedUi.loaded.set(normalizedGroupKey, 0);
            }
        } else {
            groupedUi.expanded.delete(normalizedGroupKey);
        }
    }

    function loadMoreScopeGroupedDimensionChildren(sourceKey, kind, groupKey, totalChildren) {
        const normalizedGroupKey = String(groupKey || '').trim();
        if (!normalizedGroupKey) return;
        const total = Math.max(0, Number(totalChildren) || 0);
        if (total <= 0) return;
        const groupedUi = ensureScopeGroupedUiState(sourceKey, kind);
        const current = Math.max(0, Number(groupedUi.loaded.get(normalizedGroupKey)) || 0);
        const next = Math.min(total, current + SCOPE_TREE_CHILD_BATCH);
        groupedUi.loaded.set(normalizedGroupKey, next);
    }

    function buildWhitelistScopeEntries(keyword = '') {
        const sourceByUrl = new Map();
        (state.sourceItems || []).forEach((item) => {
            const key = normalizeWhitelistKey(item?.url || '');
            if (!key || sourceByUrl.has(key)) return;
            sourceByUrl.set(key, item);
        });

        const entries = Array.from(state.whitelistKeys || []).map((entry) => {
            const url = normalizeWhitelistKey(entry);
            if (!url) return null;
            const sourceItem = sourceByUrl.get(url);
            const resolved = resolveQueueItemDomainSubdomain(sourceItem || { url });
            const domain = normalizeDomainWhitelistKey(sourceItem?.domain || resolved.domain || '');
            const subdomain = normalizeSubdomainWhitelistKey(sourceItem?.subdomain || resolved.subdomain || '');
            const subdomainLabel = subdomain || t('rootSubdomainLabel');
            const title = String(sourceItem?.title || url || '').trim() || url;

            return {
                key: url,
                url,
                title,
                domain,
                subdomain,
                subdomainLabel,
                domainWhitelisted: domain && state.whitelistDomainKeys instanceof Set && state.whitelistDomainKeys.has(domain),
                subdomainWhitelisted: subdomain && state.whitelistSubdomainKeys instanceof Set && state.whitelistSubdomainKeys.has(subdomain)
            };
        }).filter(Boolean);

        const query = String(keyword || '').trim();
        const allowPathMatch = shouldEnableScopePathFieldMatch(query);
        const filteredEntries = !query
            ? entries
            : entries.filter((entry) => matchesScopeSearchFields({
                title: entry.title,
                url: entry.url,
                host: entry.subdomain || '',
                domain: entry.domain || ''
            }, query, { allowPathMatch }));

        return filteredEntries.sort((a, b) => {
            const domainCompare = String(a.domain || '').localeCompare(String(b.domain || ''), undefined, { sensitivity: 'base' });
            if (domainCompare !== 0) return domainCompare;
            const titleCompare = String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
            if (titleCompare !== 0) return titleCompare;
            return String(a.url || '').localeCompare(String(b.url || ''), undefined, { sensitivity: 'base' });
        });
    }

    function renderWhitelistScopeEntriesHtml(entries) {
        return (entries || []).map((entry) => {
            return renderWhitelistScopeEntryHtml(entry);
        }).join('');
    }

    function renderWhitelistScopeEntryHtml(entry) {
        if (!entry || typeof entry !== 'object') return '';
            const domainButtonClass = entry.domainWhitelisted ? 'active' : '';
            const subdomainButtonClass = entry.subdomainWhitelisted ? 'active' : '';
            const domainDisabledAttr = entry.domain ? '' : 'disabled';
            const subdomainButtonHtml = entry.subdomain
                ? `
                        <button type="button" class="dev1-whitelist-rule-btn ${subdomainButtonClass}"
                            data-op="subdomain"
                            data-subdomain="${escapeHtml(entry.subdomain || '')}"
                            title="${escapeHtml(t('scopeWhitelistAddSubdomain'))}">
                            ${escapeHtml(t('scopeWhitelistAddSubdomain'))}
                        </button>
                    `
                : '';
            return `
                <div class="dev1-whitelist-scope-item">
                    <div class="dev1-whitelist-scope-main">
                        <div class="dev1-whitelist-scope-title" title="${escapeHtml(entry.title)}">${escapeHtml(entry.title)}</div>
                        <div class="dev1-whitelist-scope-meta" title="${escapeHtml(entry.url)}">${escapeHtml(entry.url)}</div>
                        <div class="dev1-whitelist-scope-meta">${escapeHtml(entry.domain || '-')} · ${escapeHtml(entry.subdomainLabel || '-')}</div>
                    </div>
                    <div class="dev1-whitelist-scope-actions">
                        <button type="button" class="dev1-whitelist-rule-btn ${domainButtonClass}"
                            data-op="domain"
                            data-domain="${escapeHtml(entry.domain || '')}"
                            title="${escapeHtml(t('scopeWhitelistAddDomain'))}"
                            ${domainDisabledAttr}>${escapeHtml(t('scopeWhitelistAddDomain'))}</button>
                        ${subdomainButtonHtml}
                        <button type="button" class="dev1-whitelist-rule-btn danger"
                            data-op="remove-url"
                            data-url="${escapeHtml(entry.url)}"
                            title="${escapeHtml(t('scopeWhitelistRemoveUrl'))}">${escapeHtml(t('scopeWhitelistRemoveUrl'))}</button>
                    </div>
                </div>
            `;
    }

    function buildScopeLazyRowHtml(sourceKey, sourceState, activeKind, option, mode = 'default') {
        const normalizedMode = String(mode || '').trim().toLowerCase();
        if (normalizedMode === 'search-flat') {
            return buildScopeSearchFlatRowHtml(sourceKey, sourceState, option);
        }
        if (normalizedMode === 'whitelist') {
            return renderWhitelistScopeEntryHtml(option);
        }
        const key = String(option?.key || '');
        const checked = sourceState.filters[activeKind].has(key);
        return buildScopeOptionRowHtml(sourceKey, activeKind, option, checked);
    }

    function renderScopeLazyFooter(listEl) {
        if (!listEl) return;
        const oldFooter = listEl.querySelector('.dev1-scope-lazy-row');
        if (oldFooter) oldFooter.remove();

        const lazyState = state.scopeUi?.lazy;
        if (!lazyState || !Array.isArray(lazyState.options)) return;
        const total = lazyState.options.length;
        const loaded = Number(lazyState.offset) || 0;
        if (total <= 0) return;

        const allLoaded = loaded >= total;
        const secondaryText = allLoaded ? t('scopeLazyAllLoaded') : t('scopeLazyLoading');
        const iconClass = allLoaded ? 'fa-check-circle' : 'fa-angle-double-down';
        listEl.insertAdjacentHTML('beforeend', `
            <div class="dev1-scope-lazy-row ${allLoaded ? 'done' : ''}">
                <span class="dev1-scope-lazy-main">${escapeHtml(t('scopeLazyLoaded'))} ${loaded}/${total}</span>
                <span class="dev1-scope-lazy-sub"><i class="fas ${escapeHtml(iconClass)}"></i> ${escapeHtml(secondaryText)}</span>
            </div>
        `);
    }

    function appendScopeOptionPage() {
        const listEl = document.getElementById('dev1ScopeOptionList');
        if (!listEl) return;

        const lazyState = state.scopeUi?.lazy;
        if (!lazyState || !Array.isArray(lazyState.options)) return;
        const sourceKey = getActiveScopeSourceKey();
        const kind = getActiveScopeKind();
        const sourceState = getSourceState(sourceKey);
        const mode = String(lazyState.mode || 'default').trim().toLowerCase();
        if (lazyState.offset >= lazyState.options.length) {
            renderScopeLazyFooter(listEl);
            return;
        }

        const start = Math.max(0, Number(lazyState.offset) || 0);
        const end = Math.min(start + (Number(lazyState.pageSize) || 120), lazyState.options.length);
        const html = lazyState.options.slice(start, end).map((opt) => {
            return buildScopeLazyRowHtml(sourceKey, sourceState, kind, opt, mode);
        }).join('');

        const oldFooter = listEl.querySelector('.dev1-scope-lazy-row');
        if (oldFooter) oldFooter.remove();
        listEl.insertAdjacentHTML('beforeend', html);
        lazyState.offset = end;
        renderScopeLazyFooter(listEl);
    }

    function tryLoadMoreScopeOptions(force = false) {
        const listEl = document.getElementById('dev1ScopeOptionList');
        if (!listEl) return;
        const lazyState = state.scopeUi?.lazy;
        if (!lazyState || !Array.isArray(lazyState.options)) return;
        if (lazyState.offset >= lazyState.options.length) return;

        if (!force) {
            const threshold = Math.max(160, Math.floor(listEl.clientHeight * 0.5));
            if (listEl.scrollTop + listEl.clientHeight + threshold < listEl.scrollHeight) {
                return;
            }
        }
        appendScopeOptionPage();
    }

    function renderScopeSelector() {
        const sourceKey = getActiveScopeSourceKey();
        const kind = getActiveScopeKind();
        const sourceState = getSourceState(sourceKey);

        const kindTabs = document.querySelectorAll('.dev1-scope-kind-tab');
        kindTabs.forEach((tab) => {
            if (!(tab instanceof HTMLButtonElement)) return;
            const tabKind = String(tab.dataset.kind || '').trim();
            const isActive = tabKind === 'changes-folder'
                ? (sourceKey === SOURCE_CHANGES && kind === 'folder')
                : (tabKind === 'folder'
                    ? (sourceKey === SOURCE_BOOKMARKS && kind === 'folder')
                    : tabKind === 'all-tabs'
                        ? (sourceKey === SOURCE_ALL_TABS && kind === 'folder')
                    : tabKind === kind);
            tab.classList.toggle('active', isActive);
        });

        const changesInfoWrap = document.getElementById('dev1ScopeCurrentChangesInfo');
        if (changesInfoWrap) {
            const showChangesControls = sourceKey === SOURCE_CHANGES && kind === 'folder';
            changesInfoWrap.hidden = !showChangesControls;
            changesInfoWrap.style.display = showChangesControls ? '' : 'none';
        }
        const changesModeLabelEl = document.getElementById('dev1ScopeCurrentChangesMode');
        if (changesModeLabelEl) {
            const changesMode = getCurrentChangesViewMode();
            changesModeLabelEl.textContent = `${t('scopeCurrentChangesModePrefix')}: ${getCurrentChangesModeLabel(changesMode)}`;
        }

        const searchInput = document.getElementById('dev1ScopeSearchInput');
        const keyword = String(state.scopeUi?.keyword || '');
        if (searchInput) {
            if (searchInput.placeholder !== t('scopeSearchPlaceholder')) {
                searchInput.placeholder = t('scopeSearchPlaceholder');
            }
            if (searchInput.value !== keyword) searchInput.value = keyword;
        }

        const whitelistCount = state.whitelistKeys instanceof Set ? state.whitelistKeys.size : 0;
        const selectedHeaderSummaryEl = document.getElementById('dev1ScopeSelectedSummaryHeader');
        if (selectedHeaderSummaryEl) {
            const headerCounts = getScopeSelectionSummaryCounts(sourceState, kind, whitelistCount);
            const summaryText = `${t('reviewSelectedSummary')} ${t('reviewCountBookmarks')} ${headerCounts.bookmarkCount} · ${t('reviewCountFolders')} ${headerCounts.folderCount}`;
            selectedHeaderSummaryEl.textContent = summaryText;
        }
        const existingSummaryEl = document.getElementById('dev1ScopeExistingSummary');
        if (existingSummaryEl) {
            const existingCounts = getScopeExistingQueueMatchCounts(sourceState, kind);
            const hasExisting = existingCounts.bookmarkCount > 0 || existingCounts.folderCount > 0;
            existingSummaryEl.hidden = !hasExisting;
            existingSummaryEl.textContent = hasExisting
                ? `${t('scopeExistingQueuePrefix')} ${t('reviewCountBookmarks')} ${existingCounts.bookmarkCount} · ${t('reviewCountFolders')} ${existingCounts.folderCount}`
                : '';
        }
        const clearKindBtn = document.getElementById('dev1ScopeClearKindBtn');
        if (clearKindBtn) {
            clearKindBtn.disabled = kind === 'whitelist'
                ? whitelistCount <= 0
                : !hasAnyScopeSelection();
        }

        const listEl = document.getElementById('dev1ScopeOptionList');
        if (!listEl) return;
        listEl.classList.remove('folder-tree-mode');
        listEl.classList.remove('scope-group-mode');

        if (kind === 'whitelist') {
            const entries = buildWhitelistScopeEntries(String(keyword || ''));
            if (!entries.length) {
                listEl.innerHTML = `<div class="add-results-empty">${escapeHtml(t('scopeWhitelistEmpty'))}</div>`;
                state.scopeUi.lazy = {
                    sourceKey,
                    kind,
                    mode: 'whitelist',
                    options: [],
                    offset: 0,
                    pageSize: 120
                };
                return;
            }
            listEl.scrollTop = 0;
            listEl.innerHTML = '';
            state.scopeUi.lazy = {
                sourceKey,
                kind,
                mode: 'whitelist',
                options: entries,
                offset: 0,
                pageSize: 120
            };
            appendScopeOptionPage();
            let guard = 0;
            while (guard < 3 && listEl.scrollHeight <= (listEl.clientHeight + 24)) {
                const before = state.scopeUi.lazy.offset;
                tryLoadMoreScopeOptions(true);
                if (state.scopeUi.lazy.offset === before) break;
                guard += 1;
            }
            return;
        }

        if (kind === 'folder') {
            listEl.classList.add('folder-tree-mode');
            const keywordText = String(keyword || '').trim();

            if (keywordText) {
                const fullTreeNodes = buildFullScopeTreeNodesForSource(sourceKey, sourceState);
                const flatSearchOptions = buildFlatScopeSearchOptionsFromTree(fullTreeNodes, keywordText);
                if (flatSearchOptions.length === 0) {
                    const errorText = String(sourceState.loadError || '').trim();
                    listEl.innerHTML = `<div class="add-results-empty">${escapeHtml(errorText || getNoDataMessageBySource(sourceKey))}</div>`;
                    state.scopeUi.lazy = {
                        sourceKey,
                        kind,
                        mode: 'search-flat',
                        options: [],
                        offset: 0,
                        pageSize: 120
                    };
                    return;
                }
                listEl.scrollTop = 0;
                listEl.innerHTML = '';
                state.scopeUi.lazy = {
                    sourceKey,
                    kind,
                    mode: 'search-flat',
                    options: flatSearchOptions,
                    offset: 0,
                    pageSize: 120
                };
                appendScopeOptionPage();
                let guard = 0;
                while (guard < 3 && listEl.scrollHeight <= (listEl.clientHeight + 24)) {
                    const before = state.scopeUi.lazy.offset;
                    tryLoadMoreScopeOptions(true);
                    if (state.scopeUi.lazy.offset === before) break;
                    guard += 1;
                }
                return;
            }

            let treeData = null;
            if (sourceKey === SOURCE_CHANGES && Array.isArray(sourceState.scopeTreeNodes) && sourceState.scopeTreeNodes.length > 0) {
                const filteredNodes = filterUnifiedScopeTreeNodes(sourceState.scopeTreeNodes, keywordText);
                const treeMeta = buildScopeTreeMeta(filteredNodes);
                treeData = {
                    nodes: filteredNodes,
                    folderKeySet: treeMeta.folderKeySet,
                    folderChildCountMap: treeMeta.folderChildCountMap
                };
            } else {
                treeData = buildUnifiedScopeTreeModel(sourceState.items, keywordText, {
                    folderBadgeByPath: sourceState.folderBadgeByPath
                });
            }
            const treeUi = ensureScopeFolderTreeUiState(sourceKey);
            pruneScopeTreeUiState(treeUi, treeData.folderKeySet);
            if (!treeData.nodes || treeData.nodes.length === 0) {
                const errorText = String(sourceState.loadError || '').trim();
                listEl.innerHTML = `<div class="add-results-empty">${escapeHtml(errorText || getNoDataMessageBySource(sourceKey))}</div>`;
                state.scopeUi.lazy = {
                    sourceKey,
                    kind,
                    mode: 'default',
                    options: [],
                    offset: 0,
                    pageSize: 120
                };
                return;
            }
            listEl.innerHTML = `
                <div class="folder-tree-container">
                    ${renderUnifiedScopeTreeHtml(treeData.nodes, sourceKey, sourceState, { forceExpandAll: false })}
                </div>
            `;
            state.scopeUi.lazy = {
                sourceKey,
                kind,
                mode: 'default',
                options: [],
                offset: 0,
                pageSize: 120
            };
            return;
        }

        if (kind === 'domain' || kind === 'subdomain') {
            listEl.classList.add('scope-group-mode');
            const keywordText = String(keyword || '');
            const groupedData = buildScopeGroupedDimensionModel(sourceState.items, kind, keywordText);
            const groupedUi = ensureScopeGroupedUiState(sourceKey, kind);
            pruneScopeTreeUiState(groupedUi, groupedData.groupKeySet);
            const normalizedKeyword = keywordText.trim().toLowerCase();
            const previousKeyword = String(groupedUi.searchKeyword || '').trim().toLowerCase();
            if (normalizedKeyword) {
                if (normalizedKeyword !== previousKeyword) {
                    groupedUi.expanded = new Set(
                        (groupedData.groups || [])
                            .map(group => String(group?.key || '').trim())
                            .filter(Boolean)
                    );
                }
            } else if (previousKeyword) {
                groupedUi.searchKeyword = '';
            }
            groupedUi.searchKeyword = normalizedKeyword;
            if (!groupedData.groups || groupedData.groups.length === 0) {
                const errorText = String(sourceState.loadError || '').trim();
                listEl.innerHTML = `<div class="add-results-empty">${escapeHtml(errorText || getNoDataMessageBySource(sourceKey))}</div>`;
                state.scopeUi.lazy = {
                    sourceKey,
                    kind,
                    mode: 'default',
                    options: [],
                    offset: 0,
                    pageSize: 120
                };
                return;
            }
            listEl.innerHTML = `
                <div class="dev1-scope-group-container">
                    ${renderScopeGroupedDimensionHtml(sourceKey, kind, sourceState, groupedData)}
                </div>
            `;
            state.scopeUi.lazy = {
                sourceKey,
                kind,
                mode: 'default',
                options: [],
                offset: 0,
                pageSize: 120
            };
            return;
        }

        let options = Array.isArray(sourceState.filterOptions[kind]) ? sourceState.filterOptions[kind] : [];
        const normalizedKeyword = String(keyword || '').trim();
        const allowPathMatch = shouldEnableScopePathFieldMatch(normalizedKeyword);
        if (normalizedKeyword) {
            options = options.filter((opt) => {
                return matchesScopeSearchFields({
                    title: String(opt?.label || ''),
                    domain: String(opt?.key || ''),
                    path: String(opt?.key || '')
                }, normalizedKeyword, {
                    allowPathMatch,
                    domainOnly: kind === 'domain' || kind === 'subdomain'
                });
            });
        }

        if (options.length === 0) {
            const errorText = String(sourceState.loadError || '').trim();
            listEl.innerHTML = `<div class="add-results-empty">${escapeHtml(errorText || getNoDataMessageBySource(sourceKey))}</div>`;
            return;
        }

        listEl.scrollTop = 0;
        listEl.innerHTML = '';
        state.scopeUi.lazy = {
            sourceKey,
            kind,
            mode: 'default',
            options,
            offset: 0,
            pageSize: 120
        };
        appendScopeOptionPage();
        let guard = 0;
        while (guard < 3 && listEl.scrollHeight <= (listEl.clientHeight + 24)) {
            const before = state.scopeUi.lazy.offset;
            tryLoadMoreScopeOptions(true);
            if (state.scopeUi.lazy.offset === before) break;
            guard += 1;
        }
    }

    function renderQueueItemNameIconHtml(item) {
        const url = String(item?.url || '').trim();
        if (url && typeof getFaviconUrl === 'function') {
            const favicon = String(getFaviconUrl(url) || '').trim();
            if (favicon) {
                return `<img class="dev1-queue-name-favicon" src="${escapeHtml(favicon)}" alt="">`;
            }
        }
        return '<i class="fas fa-bookmark dev1-queue-name-fallback-icon" aria-hidden="true"></i>';
    }

    function renderQueueTable() {
        const wrap = document.getElementById('dev1QueueWrap');
        if (!wrap) return;

        const queueItems = getExecutionQueueItems();
        if (!Array.isArray(queueItems) || queueItems.length === 0) {
            const hint = hasAnyScopeSelection() ? t('queueEmpty') : t('queueSelectScopeFirst');
            wrap.innerHTML = `<div class="dev1-empty">${escapeHtml(hint)}</div>`;
            return;
        }

        const currentBatch = getCurrentQueueBatch(queueItems);
        const rows = currentBatch.items.map((item, localIndex) => {
            const index = getQueueItemDisplayIndex(item, currentBatch.start + localIndex);
            const whitelistByUrl = state.whitelistKeys instanceof Set
                && state.whitelistKeys.has(normalizeWhitelistKey(item?.url || ''));
            const whitelistEnabled = isQueueItemWhitelisted(item);
            const subdomainText = String(item.subdomainLabel || item.subdomain || '').trim() || t('rootSubdomainLabel');
            const titleText = String(item.title || '').trim() || t('unknown');
            const nameIconHtml = renderQueueItemNameIconHtml(item);
            const deleteTip = t('queueOpDelete');
            const whitelistTip = whitelistByUrl ? t('queueOpWhitelistRemove') : t('queueOpWhitelistAdd');
            const rowTabId = getQueueItemTabId(item);
            const rowHasTab = rowTabId != null;
            const existingTabQueueItem = isExistingTabReviewQueueItem(item);
            const reviewStateClass = item?.reviewed === true
                ? 'success'
                : (existingTabQueueItem ? 'info' : (item?.reviewWindowActive === true ? 'warning' : 'neutral'));
            const reviewStateText = item?.reviewed === true
                ? t('reviewItemReviewed')
                : (existingTabQueueItem ? t('reviewItemExistingTabActive') : (item?.reviewWindowActive === true ? t('reviewItemActive') : t('reviewItemPending')));
            return `
                <tr class="is-focusable" data-queue-url="${escapeHtml(item.url || '')}" ${rowHasTab ? `data-tab-id="${escapeHtml(String(rowTabId))}"` : ''}>
                    <td class="dev1-col-ops">
                        <div class="dev1-queue-ops">
                            <button type="button" class="dev1-queue-op-btn danger" data-op="delete" data-url="${escapeHtml(item.url || '')}" data-tip="${escapeHtml(deleteTip)}" aria-label="${escapeHtml(deleteTip)}">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                            <button type="button" class="dev1-queue-op-btn ${whitelistEnabled ? 'active' : ''}" data-op="whitelist" data-url="${escapeHtml(item.url || '')}" data-tip="${escapeHtml(whitelistTip)}" aria-label="${escapeHtml(whitelistTip)}">
                                <i class="fas fa-shield-alt"></i>
                            </button>
                        </div>
                    </td>
                    <td class="dev1-col-status"><span class="dev1-pill ${escapeHtml(reviewStateClass)}">${escapeHtml(reviewStateText)}</span></td>
                    <td class="dev1-col-index">${index + 1}</td>
                    <td class="dev1-col-title">
                        <div class="dev1-queue-name-wrap" title="${escapeHtml(titleText)}">
                            <span class="dev1-queue-name-icon">${nameIconHtml}</span>
                            <span class="dev1-queue-name-text">${escapeHtml(titleText)}</span>
                        </div>
                    </td>
                    <td class="dev1-col-url">
                        <a class="dev1-url-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener" title="${escapeHtml(item.url)}">${escapeHtml(item.url)}</a>
                    </td>
                    <td class="dev1-col-domain">${escapeHtml(item.domain || '-')}</td>
                    <td class="dev1-col-subdomain"><div class="dev1-cell-title" title="${escapeHtml(subdomainText)}">${escapeHtml(subdomainText)}</div></td>
                    <td class="dev1-col-action"><div class="dev1-cell-title" title="${escapeHtml(item.actionText || '-')}">${escapeHtml(item.actionText || '-')}</div></td>
                </tr>
            `;
        }).join('');

        wrap.innerHTML = `
            <table class="dev1-table dev1-table-queue">
                <thead>
                    <tr>
                        <th>${escapeHtml(t('colOps'))}</th>
                        <th>${escapeHtml(t('colStatus'))}</th>
                        <th>${escapeHtml(t('colIndex'))}</th>
                        <th>${escapeHtml(t('colTitle'))}</th>
                        <th>${escapeHtml(t('colUrl'))}</th>
                        <th>${escapeHtml(t('colDomain'))}</th>
                        <th>${escapeHtml(t('colSubdomain'))}</th>
                        <th>${escapeHtml(t('colAction'))}</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;
    }

    function renderReviewWorkflowPanel() {
        const selectedSummaryEl = document.getElementById('dev1ReviewSelectedSummary');
        const statusEl = document.getElementById('dev1ReviewWorkflowStatus');
        const openReviewBtn = document.getElementById('dev1OpenReviewBtn');
        const submitBtn = document.getElementById('dev1ReviewSubmitBtn');
        const syncBtn = document.getElementById('dev1ReviewSyncBtn');
        const batchSizeInput = document.getElementById('dev1QueueBatchSizeInput');
        const batchPrevBtn = document.getElementById('dev1QueueBatchPrevBtn');
        const batchNextBtn = document.getElementById('dev1QueueBatchNextBtn');
        const batchPageLabel = document.getElementById('dev1QueueBatchPageLabel');
        if (!selectedSummaryEl || !statusEl || !submitBtn || !syncBtn) return;

        const windowId = getReviewWindowId();
        const allQueueItems = getExecutionQueueItems();
        const batches = getQueueBatches(allQueueItems);
        const currentBatch = getCurrentQueueBatch(allQueueItems);
        const queueItems = currentBatch.items;
        const activeQueueItems = getActiveQueueItems(queueItems);
        const queueCount = Array.isArray(activeQueueItems) ? activeQueueItems.length : 0;
        const existingTabReviewMode = isExistingTabReviewMode(activeQueueItems);
        const bypassReview = shouldBypassReviewForQueue(activeQueueItems);
        const reviewSatisfied = isReviewSatisfiedForQueue(activeQueueItems);
        const openStepSatisfied = isReviewOpenStepSatisfied(activeQueueItems);
        const submitStepSatisfied = isReviewSubmitStepSatisfied(activeQueueItems);
        const runIsActive = state.running || String(state.captureRunState?.status || '').toLowerCase() === 'running';
        const selectedCounts = getBookmarkFolderCounts(activeQueueItems);
        const reviewedItems = windowId != null || existingTabReviewMode || isReviewSubmitted()
            ? getReviewedQueueItems(queueItems)
            : [];
        const reviewedCounts = getBookmarkFolderCounts(reviewedItems);
        const bypassDisplayCounts = bypassReview ? selectedCounts : reviewedCounts;
        const isEn = getLangKey() === 'en';
        const currentBatchNumber = Math.max(1, (normalizeQueueMetadataIndex(currentBatch.batchId) ?? currentBatch.index) + 1);
        const maxBatchNumber = Math.max(1, ...batches.map(batch => (normalizeQueueMetadataIndex(batch.batchId) ?? batch.index) + 1));
        const batchPrefix = `${t('queueBatchTitle')} ${currentBatchNumber}`;

        if (openReviewBtn) {
            const openTextEl = openReviewBtn.querySelector('span');
            if (openTextEl) openTextEl.textContent = `1. ${t('reviewOpenWindow')}`;
            openReviewBtn.hidden = existingTabReviewMode;
            openReviewBtn.classList.toggle('dev1-step-done', openStepSatisfied || isWorkflowStepDone('openDone'));
            openReviewBtn.disabled = existingTabReviewMode || state.running || queueCount <= 0;
        }
        if (submitBtn) {
            const submitTextEl = submitBtn.querySelector('span');
            if (submitTextEl) submitTextEl.textContent = `${existingTabReviewMode ? 1 : 2}. ${t('reviewSubmit')}`;
            submitBtn.hidden = false;
            submitBtn.classList.toggle('dev1-step-done', submitStepSatisfied);
        }
        updateRunPrimaryButton(runIsActive);

        if (syncBtn) {
            syncBtn.disabled = state.running || windowId == null;
        }
        if (batchSizeInput instanceof HTMLInputElement) {
            if (document.activeElement !== batchSizeInput) {
                batchSizeInput.value = String(getQueueBatchSize());
            }
            batchSizeInput.disabled = state.running;
        }
        if (batchPageLabel) {
            batchPageLabel.textContent = `${t('queueBatchTitle')} ${currentBatchNumber} / ${maxBatchNumber}`;
        }
        if (batchPrevBtn instanceof HTMLButtonElement) {
            batchPrevBtn.disabled = state.running || batches.length <= 1 || currentBatch.index <= 0;
        }
        if (batchNextBtn instanceof HTMLButtonElement) {
            batchNextBtn.disabled = state.running || batches.length <= 1 || currentBatch.index >= batches.length - 1;
        }

        selectedSummaryEl.textContent = isEn
            ? `${batchPrefix} · ${t('reviewSelectedSummary')}: ${t('reviewCountBookmarks')} ${selectedCounts.bookmarkCount} · ${t('reviewCountFolders')} ${selectedCounts.folderCount}`
            : `${batchPrefix} · ${t('reviewSelectedSummary')}：${t('reviewCountBookmarks')} ${selectedCounts.bookmarkCount} · ${t('reviewCountFolders')} ${selectedCounts.folderCount}`;

        if (bypassReview) {
            statusEl.textContent = isEn
                ? `${t('reviewReviewedSummary')}: ${t('reviewCountBookmarks')} ${bypassDisplayCounts.bookmarkCount} · ${t('reviewCountFolders')} ${bypassDisplayCounts.folderCount} · ${t('reviewStateBypassWhitelist')}`
                : `${t('reviewReviewedSummary')}：${t('reviewCountBookmarks')} ${bypassDisplayCounts.bookmarkCount} · ${t('reviewCountFolders')} ${bypassDisplayCounts.folderCount} · ${t('reviewStateBypassWhitelist')}`;
            submitBtn.disabled = state.running || (!existingTabReviewMode && windowId == null) || queueCount <= 0;
            return;
        }

        let stateText = t('reviewStateIdle');
        if (existingTabReviewMode) {
            stateText = isReviewSubmitted()
                ? t('reviewStateSubmitted')
                : (reviewSatisfied ? t('reviewStateReviewed') : t('reviewExistingTabModeReady'));
        } else if (windowId != null) {
            stateText = isReviewSubmitted()
                ? t('reviewStateSubmitted')
                : (reviewSatisfied ? t('reviewStateReviewed') : t('reviewStatePending'));
        }
        statusEl.textContent = isEn
            ? `${t('reviewReviewedSummary')}: ${t('reviewCountBookmarks')} ${reviewedCounts.bookmarkCount} · ${t('reviewCountFolders')} ${reviewedCounts.folderCount} · ${stateText}`
            : `${t('reviewReviewedSummary')}：${t('reviewCountBookmarks')} ${reviewedCounts.bookmarkCount} · ${t('reviewCountFolders')} ${reviewedCounts.folderCount} · ${stateText}`;

        submitBtn.disabled = state.running
            || (!existingTabReviewMode && windowId == null)
            || queueCount <= 0;
    }

    function rerenderAllDataPanels() {
        renderScopeSelector();
        renderCaptureRunStatePanel();
        renderQueueTable();
        renderReviewWorkflowPanel();
    }

    function renderScopePanelVisibility() {
        const scopeModal = document.getElementById('dev1ScopeModal');
        if (scopeModal) {
            scopeModal.classList.toggle('show', state.scopePanelOpen === true);
            scopeModal.setAttribute('aria-hidden', state.scopePanelOpen === true ? 'false' : 'true');
        }
        const scopeBtn = document.getElementById('dev1ScopeBtn');
        if (scopeBtn) {
            scopeBtn.classList.toggle('active', state.scopePanelOpen === true);
            scopeBtn.setAttribute('aria-expanded', state.scopePanelOpen === true ? 'true' : 'false');
        }
    }

    function renderReviewSettingsVisibility() {
        const modal = document.getElementById('dev1ReviewSettingsModal');
        if (modal) {
            modal.classList.toggle('show', state.reviewSettingsOpen === true);
            modal.setAttribute('aria-hidden', state.reviewSettingsOpen === true ? 'false' : 'true');
        }
        const settingsBtn = document.getElementById('dev1ReviewSettingsBtn');
        if (settingsBtn) {
            settingsBtn.classList.toggle('active', state.reviewSettingsOpen === true);
            settingsBtn.setAttribute('aria-expanded', state.reviewSettingsOpen === true ? 'true' : 'false');
        }
        const input = document.getElementById('dev1ReviewAutoReviewMsInput');
        if (input instanceof HTMLInputElement && document.activeElement !== input) {
            input.value = String(getReviewAutoReviewMs());
        }
        const autoHelp = document.getElementById('dev1ReviewAutoReviewHelpText');
        if (autoHelp) {
            autoHelp.textContent = getReviewAutoReviewHelpText();
        }
    }

    function openReviewSettingsModal() {
        state.reviewSettingsOpen = true;
        renderReviewSettingsVisibility();
        const input = document.getElementById('dev1ReviewAutoReviewMsInput');
        if (input instanceof HTMLInputElement) {
            input.value = String(getReviewAutoReviewMs());
            input.focus();
            input.select();
        }
    }

    function closeReviewSettingsModal() {
        state.reviewSettingsOpen = false;
        renderReviewSettingsVisibility();
    }

    function commitReviewSettingsModal() {
        const input = document.getElementById('dev1ReviewAutoReviewMsInput');
        const nextDuration = setReviewAutoReviewMs(input instanceof HTMLInputElement ? input.value : state.reviewAutoReviewMs);
        if (input instanceof HTMLInputElement) input.value = String(nextDuration);
        closeReviewSettingsModal();
        if (getReviewWindowId() != null) {
            scheduleReviewAutoReviewCheck(getReviewWindowId());
        }
        rerenderAllDataPanels();
        setStatus(t('reviewSettingsSaved'), 'success');
    }

    function toggleScopeOptionCheckboxFromContainer(container) {
        if (!(container instanceof HTMLElement)) return false;
        const checkbox = container.querySelector('input.dev1-scope-option-checkbox');
        if (!(checkbox instanceof HTMLInputElement)) return false;
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    function bindRootEvents(root) {
        if (!root) return;

        const runBtn = root.querySelector('#dev1RunBtn');
        if (runBtn) {
            runBtn.addEventListener('click', () => {
                const runIsActive = state.running || String(state.captureRunState?.status || '').toLowerCase() === 'running';
                const action = runIsActive ? pauseCaptureTask : startCaptureTask;
                action().catch((error) => {
                    setStatus(error?.message || (runIsActive ? t('runPauseFailed') : t('runFailed')), 'error');
                });
            });
        }

        const cancelBtn = root.querySelector('#dev1CancelBtn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                cancelCaptureTask().catch((error) => {
                    setStatus(error?.message || t('runCancelFailed'), 'error');
                });
            });
        }

        const reviewSyncBtn = root.querySelector('#dev1ReviewSyncBtn');
        if (reviewSyncBtn) {
            reviewSyncBtn.addEventListener('click', () => {
                syncReviewWindowQueue({ silentStatus: false, pruneMissingItems: true }).then((synced) => {
                    if (synced) {
                        scheduleReviewAutoReviewCheck(getReviewWindowId());
                    }
                }).catch((error) => {
                    setStatus(`${t('reviewSyncFailed')}: ${error?.message || ''}`, 'error');
                });
            });
        }

        const reviewSubmitBtn = root.querySelector('#dev1ReviewSubmitBtn');
        if (reviewSubmitBtn) {
            reviewSubmitBtn.addEventListener('click', async () => {
                try {
                    await submitReviewWorkflow();
                } catch (error) {
                    setStatus(error?.message || t('reviewNeedSubmit'), 'warning');
                }
            });
        }

        const reviewSettingsBtn = root.querySelector('#dev1ReviewSettingsBtn');
        if (reviewSettingsBtn) {
            reviewSettingsBtn.addEventListener('click', (event) => {
                event.preventDefault();
                openReviewSettingsModal();
            });
        }

        const reviewSettingsCloseBtn = root.querySelector('#dev1ReviewSettingsModalClose');
        if (reviewSettingsCloseBtn) {
            reviewSettingsCloseBtn.addEventListener('click', closeReviewSettingsModal);
        }
        const reviewSettingsCancelBtn = root.querySelector('#dev1ReviewSettingsCancelBtn');
        if (reviewSettingsCancelBtn) {
            reviewSettingsCancelBtn.addEventListener('click', closeReviewSettingsModal);
        }
        const reviewSettingsSaveBtn = root.querySelector('#dev1ReviewSettingsSaveBtn');
        if (reviewSettingsSaveBtn) {
            reviewSettingsSaveBtn.addEventListener('click', commitReviewSettingsModal);
        }
        const reviewSettingsInput = root.querySelector('#dev1ReviewAutoReviewMsInput');
        if (reviewSettingsInput instanceof HTMLInputElement) {
            reviewSettingsInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    commitReviewSettingsModal();
                }
            });
            reviewSettingsInput.addEventListener('blur', () => {
                reviewSettingsInput.value = String(normalizeReviewAutoReviewMs(reviewSettingsInput.value));
            });
        }
        const reviewSettingsModal = root.querySelector('#dev1ReviewSettingsModal');
        if (reviewSettingsModal) {
            reviewSettingsModal.addEventListener('click', (event) => {
                if (event.target === reviewSettingsModal) {
                    closeReviewSettingsModal();
                }
            });
        }

        const openReviewBtn = root.querySelector('#dev1OpenReviewBtn');
        if (openReviewBtn) {
            openReviewBtn.addEventListener('click', async () => {
                const queueItems = getActiveQueueItems(getCurrentQueueBatchItems());
                if (!Array.isArray(queueItems) || queueItems.length === 0) {
                    setStatus(hasAnyScopeSelection() ? t('runBlockedNoQueue') : t('queueSelectScopeFirst'), 'warning');
                    return;
                }
                if (isExistingTabReviewMode(queueItems)) {
                    setStatus(t('reviewExistingTabModeReady'), 'info');
                    renderReviewWorkflowPanel();
                    return;
                }
                try {
                    await prepareReviewWindowForQueue(queueItems);
                } catch (error) {
                    setStatus(`${t('reviewFailed')}: ${error?.message || ''}`, 'error');
                }
            });
        }

        const scopeBtn = root.querySelector('#dev1ScopeBtn');
        if (scopeBtn) {
            scopeBtn.addEventListener('click', async () => {
                resetScopePanelSessionState({ clearSelections: true, keepChangesMode: true });
                try {
                    await refreshSource({ force: true });
                } catch (error) {
                    setStatus(error?.message || t('sourceError'), 'error');
                }
                state.scopePanelOpen = true;
                renderScopePanelVisibility();
            });
        }

        const scopeModalCloseBtn = root.querySelector('#dev1ScopeModalClose');
        if (scopeModalCloseBtn) {
            scopeModalCloseBtn.addEventListener('click', () => {
                state.scopePanelOpen = false;
                resetScopePanelSessionState({ clearSelections: true, keepChangesMode: true });
                renderScopePanelVisibility();
                rerenderAllDataPanels();
            });
        }
        const scopeDoneBtn = root.querySelector('#dev1ScopeDoneBtn');
        if (scopeDoneBtn) {
            scopeDoneBtn.addEventListener('click', async () => {
                applyAllFilters();
                const selectedItems = cloneQueueItems(state.filteredItems);
                const previousQueue = cloneQueueItems(state.lockedQueueItems);
                const appendResult = appendLockedQueueItems(selectedItems);
                state.scopePanelOpen = false;
                resetScopePanelSessionState({ clearSelections: true, keepChangesMode: true });
                renderScopePanelVisibility();
                rerenderAllDataPanels();
                if (selectedItems.length === 0 && previousQueue.length > 0) {
                    setStatus(t('queueSelectScopeFirst'), 'warning');
                    return;
                }
                if (selectedItems.length > 0 && appendResult.addedCount <= 0 && previousQueue.length > 0) {
                    setStatus(t('reviewQueueReady'), 'success');
                    return;
                }
                const queueItems = getCurrentQueueBatchItems();
                if (!Array.isArray(queueItems) || queueItems.length === 0) {
                    setStatus(t('queueSelectScopeFirst'), 'warning');
                    return;
                }
                if (shouldBypassReviewForQueue(queueItems)) {
                    setStatus(t('reviewBypassReady'), 'success');
                    renderReviewWorkflowPanel();
                    return;
                }
                setStatus(t('reviewQueueReady'), 'success');
            });
        }

        const scopeModal = root.querySelector('#dev1ScopeModal');
        if (scopeModal) {
            scopeModal.addEventListener('click', (event) => {
                if (event.target === scopeModal) {
                    state.scopePanelOpen = false;
                    resetScopePanelSessionState({ clearSelections: true, keepChangesMode: true });
                    renderScopePanelVisibility();
                    rerenderAllDataPanels();
                }
            });
        }

        const queueBatchSizeInput = root.querySelector('#dev1QueueBatchSizeInput');
        if (queueBatchSizeInput instanceof HTMLInputElement) {
            const applyQueueBatchSizeChange = async () => {
                const previousSize = getQueueBatchSize();
                const nextSize = normalizeQueueBatchSize(queueBatchSizeInput.value);
                queueBatchSizeInput.value = String(nextSize);
                if (state.running) return;
                if (nextSize === previousSize) return;

                try {
                    if (getReviewWindowId() != null) {
                        await closeReviewWindowForCurrentSession();
                    }
                } catch (_) { }
                clearReviewSession();
                setQueueBatchSize(nextSize);
                clampQueueBatchIndex();
                rerenderAllDataPanels();
                setStatus(t('queueBatchSizeUpdated'), 'success');
            };
            queueBatchSizeInput.addEventListener('change', () => {
                applyQueueBatchSizeChange().catch((error) => {
                    queueBatchSizeInput.value = String(getQueueBatchSize());
                    setStatus(error?.message || t('runFailed'), 'error');
                });
            });
        }
        const batchPrevBtn = root.querySelector('#dev1QueueBatchPrevBtn');
        if (batchPrevBtn) {
            batchPrevBtn.addEventListener('click', () => {
                selectQueueBatchIndex(state.queueBatchIndex - 1).catch((error) => {
                    setStatus(error?.message || t('runFailed'), 'error');
                });
            });
        }
        const batchNextBtn = root.querySelector('#dev1QueueBatchNextBtn');
        if (batchNextBtn) {
            batchNextBtn.addEventListener('click', () => {
                selectQueueBatchIndex(state.queueBatchIndex + 1).catch((error) => {
                    setStatus(error?.message || t('runFailed'), 'error');
                });
            });
        }
        const clearBtn = root.querySelector('#dev1ClearFiltersBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', async () => {
                if (typeof window.confirm === 'function') {
                    const confirmed = window.confirm(t('queueClearConfirm'));
                    if (!confirmed) return;
                }
                try {
                    await clearQueueAndReviewState({ closeReviewWindow: true, clearScope: true });
                } catch (error) {
                    setStatus(`${t('reviewSyncFailed')}: ${error?.message || ''}`, 'warning');
                    return;
                }
                rerenderAllDataPanels();
                setStatus(t('queueCleared'), 'success');
            });
        }

        const kindTabs = root.querySelectorAll('.dev1-scope-kind-tab');
        kindTabs.forEach((tab) => {
            tab.addEventListener('click', async () => {
                if (!(tab instanceof HTMLButtonElement)) return;
                const kind = String(tab.dataset.kind || '').trim();
                if (kind === 'changes-folder') {
                    state.scopeUi.sourceKey = SOURCE_CHANGES;
                    state.scopeUi.kind = 'folder';
                    state.scopeUi.keyword = '';
                    try {
                        await refreshCurrentChangesSource({ silentStatus: false, forceRefresh: true });
                    } catch (error) {
                        setStatus(error?.message || t('sourceError'), 'error');
                    }
                    return;
                }
                if (kind === 'folder') {
                    state.scopeUi.sourceKey = SOURCE_BOOKMARKS;
                    state.scopeUi.kind = 'folder';
                    state.scopeUi.keyword = '';
                    renderScopeSelector();
                    return;
                }
                if (kind === 'all-tabs') {
                    state.scopeUi.sourceKey = SOURCE_ALL_TABS;
                    state.scopeUi.kind = 'folder';
                    state.scopeUi.keyword = '';
                    refreshAllTabsSource({ silentStatus: false }).catch((error) => {
                        setStatus(error?.message || t('sourceError'), 'error');
                    });
                    return;
                }
                if (kind === 'whitelist') {
                    state.scopeUi.sourceKey = SOURCE_BOOKMARKS;
                    state.scopeUi.kind = 'whitelist';
                    state.scopeUi.keyword = '';
                    renderScopeSelector();
                    return;
                }
                if (!SCOPE_UI_KIND_KEYS.includes(kind)) return;
                if (kind === 'domain' || kind === 'subdomain') {
                    state.scopeUi.sourceKey = SOURCE_BOOKMARKS;
                }
                state.scopeUi.kind = kind;
                state.scopeUi.keyword = '';
                renderScopeSelector();
            });
        });

        const refreshCurrentChangesBtn = root.querySelector('#dev1ScopeRefreshChangesBtn');
        if (refreshCurrentChangesBtn) {
            refreshCurrentChangesBtn.addEventListener('click', () => {
                refreshCurrentChangesSource({ silentStatus: false }).catch((error) => {
                    setStatus(error?.message || t('sourceError'), 'error');
                });
            });
        }

        const scopeSearchInput = root.querySelector('#dev1ScopeSearchInput');
        if (scopeSearchInput) {
            scopeSearchInput.addEventListener('input', () => {
                state.scopeUi.keyword = String(scopeSearchInput.value || '');
                renderScopeSelector();
            });
        }
        const scopeOptionList = root.querySelector('#dev1ScopeOptionList');
        if (scopeOptionList) {
            scopeOptionList.addEventListener('scroll', () => {
                tryLoadMoreScopeOptions(false);
            });
            scopeOptionList.addEventListener('click', (event) => {
                const target = event.target;
                if (!(target instanceof HTMLElement)) return;

                const whitelistRuleBtn = target.closest('.dev1-whitelist-rule-btn[data-op]');
                if (whitelistRuleBtn instanceof HTMLButtonElement) {
                    const op = String(whitelistRuleBtn.dataset.op || '').trim();
                    if (op === 'remove-url') {
                        const url = String(whitelistRuleBtn.dataset.url || '').trim();
                        setQueueItemWhitelist(url, false);
                        rerenderAllDataPanels();
                        setStatus(t('queueRowWhitelistOff'), 'success');
                        return;
                    }
                    if (op === 'domain') {
                        const domain = String(whitelistRuleBtn.dataset.domain || '').trim();
                        const currentEnabled = state.whitelistDomainKeys instanceof Set
                            && state.whitelistDomainKeys.has(normalizeDomainWhitelistKey(domain));
                        setQueueDomainWhitelist(domain, !currentEnabled);
                        rerenderAllDataPanels();
                        setStatus(!currentEnabled ? t('scopeWhitelistByDomainOn') : t('scopeWhitelistByDomainOff'), 'success');
                        return;
                    }
                    if (op === 'subdomain') {
                        const subdomain = String(whitelistRuleBtn.dataset.subdomain || '').trim();
                        const currentEnabled = state.whitelistSubdomainKeys instanceof Set
                            && state.whitelistSubdomainKeys.has(normalizeSubdomainWhitelistKey(subdomain));
                        setQueueSubdomainWhitelist(subdomain, !currentEnabled);
                        rerenderAllDataPanels();
                        setStatus(!currentEnabled ? t('scopeWhitelistBySubdomainOn') : t('scopeWhitelistBySubdomainOff'), 'success');
                        return;
                    }
                }

                const groupedLoadMoreBtn = target.closest('.dev1-scope-group-load-more');
                if (groupedLoadMoreBtn instanceof HTMLButtonElement) {
                    const sourceKey = String(groupedLoadMoreBtn.dataset.source || '').trim();
                    const kind = String(groupedLoadMoreBtn.dataset.kind || '').trim();
                    const groupKey = String(groupedLoadMoreBtn.dataset.groupKey || '').trim();
                    const total = Number(groupedLoadMoreBtn.dataset.total) || 0;
                    if ((kind === 'domain' || kind === 'subdomain') && groupKey && total > 0) {
                        loadMoreScopeGroupedDimensionChildren(sourceKey, kind, groupKey, total);
                        renderScopeSelector();
                    }
                    return;
                }

                const loadMoreBtn = target.closest('.dev1-folder-tree-load-more');
                if (loadMoreBtn instanceof HTMLButtonElement) {
                    const sourceKey = String(loadMoreBtn.dataset.source || '').trim();
                    const folderKey = String(loadMoreBtn.dataset.folderKey || '').trim();
                    const total = Number(loadMoreBtn.dataset.total) || 0;
                    if (folderKey && total > 0) {
                        loadMoreScopeFolderTreeChildren(sourceKey, folderKey, total);
                        renderScopeSelector();
                    }
                    return;
                }

                const groupedToggleBtn = target.closest('.dev1-scope-group-toggle');
                if (groupedToggleBtn instanceof HTMLButtonElement) {
                    const sourceKey = String(groupedToggleBtn.dataset.source || '').trim();
                    const kind = String(groupedToggleBtn.dataset.kind || '').trim();
                    const groupKey = String(groupedToggleBtn.dataset.groupKey || '').trim();
                    if ((kind === 'domain' || kind === 'subdomain') && groupKey) {
                        toggleScopeGroupedDimensionExpand(sourceKey, kind, groupKey);
                        renderScopeSelector();
                    }
                    return;
                }

                const toggleBtn = target.closest('.dev1-folder-tree-toggle');
                if (toggleBtn instanceof HTMLButtonElement) {
                    const sourceKey = String(toggleBtn.dataset.source || '').trim();
                    const folderKey = String(toggleBtn.dataset.folderKey || '').trim();
                    if (folderKey) {
                        toggleScopeFolderTreeExpand(sourceKey, folderKey);
                        renderScopeSelector();
                    }
                    return;
                }

                if (target.closest('input.dev1-scope-option-checkbox')) {
                    return;
                }

                const groupedRow = target.closest('.dev1-scope-group-row[data-group-key]');
                if (groupedRow instanceof HTMLElement) {
                    toggleScopeOptionCheckboxFromContainer(groupedRow);
                    return;
                }

                const folderItem = target.closest('.dev1-folder-tree-item[data-folder-key]');
                if (folderItem instanceof HTMLElement) {
                    toggleScopeOptionCheckboxFromContainer(folderItem);
                }
            });
        }

        const queueWrap = root.querySelector('#dev1QueueWrap');
        if (queueWrap) {
            queueWrap.addEventListener('click', (event) => {
                const target = event.target;
                if (!(target instanceof HTMLElement)) return;
                const opBtn = target.closest('.dev1-queue-op-btn[data-op][data-url]');
                if (opBtn instanceof HTMLButtonElement) {
                    if (state.running) return;

                    const op = String(opBtn.dataset.op || '').trim();
                    const rawUrl = String(opBtn.dataset.url || '').trim();
                    if (!rawUrl) return;

                    if (op === 'delete') {
                        handleQueueDeleteAction(rawUrl).catch((error) => {
                            setStatus(error?.message || t('runFailed'), 'error');
                        });
                        return;
                    }
                    if (op === 'whitelist') {
                        handleQueueWhitelistToggleAction(rawUrl);
                    }
                    return;
                }

                const queueRow = target.closest('tr[data-queue-url]');
                if (queueRow instanceof HTMLElement) {
                    const tabId = Number(queueRow.dataset.tabId);
                    const rawUrl = String(queueRow.dataset.queueUrl || '').trim();
                    event.preventDefault();
                    focusQueueTab(Number.isFinite(tabId) ? tabId : null, rawUrl).catch((error) => {
                        setStatus(`${t('queueFocusTabFailed')}: ${error?.message || ''}`, 'warning');
                    });
                }
            });
        }

        const clearKindBtn = root.querySelector('#dev1ScopeClearKindBtn');
        if (clearKindBtn) {
            clearKindBtn.addEventListener('click', async () => {
                if (getActiveScopeKind() === 'whitelist') {
                    state.whitelistKeys = new Set();
                    state.whitelistDomainKeys = new Set();
                    state.whitelistSubdomainKeys = new Set();
                    persistWhitelist();
                    rerenderAllDataPanels();
                    setStatus(t('scopeWhitelistCleared'), 'success');
                    return;
                }
                try {
                    await clearQueueAndReviewState({ closeReviewWindow: true, clearScope: true });
                } catch (error) {
                    setStatus(`${t('reviewSyncFailed')}: ${error?.message || ''}`, 'warning');
                    return;
                }
                rerenderAllDataPanels();
                setStatus(t('queueCleared'), 'success');
            });
        }

        const resumeBtn = root.querySelector('#dev1ResumeBtn');
        if (resumeBtn) {
            resumeBtn.addEventListener('click', () => {
                resumeCaptureTask().catch((error) => {
                    setStatus(error?.message || t('recoveryResumeFailed'), 'error');
                });
            });
        }

        const refreshRunStateBtn = root.querySelector('#dev1RefreshRunStateBtn');
        if (refreshRunStateBtn) {
            refreshRunStateBtn.addEventListener('click', () => {
                refreshCaptureRunState().catch((error) => {
                    setStatus(error?.message || t('runFailed'), 'error');
                });
            });
        }

        if (root.dataset.dev1ChangeBound !== 'true') {
            root.dataset.dev1ChangeBound = 'true';
            root.addEventListener('change', (event) => {
                const target = event.target;
                if (!target || !(target instanceof HTMLInputElement)) return;

                if (target.classList.contains('dev1-scope-option-checkbox')) {
                    const sourceKey = String(target.dataset.source || '').trim();
                    const kind = String(target.dataset.kind || '').trim();
                    const key = String(target.dataset.key || '').trim();
                    const sourceState = getSourceState(sourceKey);
                    if (!sourceState.filters[kind]) return;

                    if (kind === 'folder') {
                        const subtree = collectFolderSubtreeSelectionKeys(sourceKey, sourceState, key);
                        if (target.checked) {
                            subtree.folderKeys.forEach((folderKey) => {
                                sourceState.filters.folder.add(folderKey);
                            });
                            subtree.bookmarkKeys.forEach((bookmarkKey) => {
                                sourceState.filters.bookmark.add(bookmarkKey);
                            });
                        } else {
                            subtree.folderKeys.forEach((folderKey) => {
                                sourceState.filters.folder.delete(folderKey);
                            });
                            subtree.bookmarkKeys.forEach((bookmarkKey) => {
                                sourceState.filters.bookmark.delete(bookmarkKey);
                            });
                        }
                    } else {
                        const normalizedKey = kind === 'bookmark'
                            ? normalizeScopeBookmarkFilterKey(sourceKey, sourceState, key)
                            : key;
                        if (!normalizedKey) return;
                        if (target.checked) {
                            sourceState.filters[kind].add(normalizedKey);
                        } else {
                            sourceState.filters[kind].delete(normalizedKey);
                        }
                    }

                    applyAllFilters();
                    rerenderAllDataPanels();
                    return;
                }

            });
        }
    }

    function getSelectedFormats() {
        return {
            mhtml: true
        };
    }

    function getSelectedCaptureMode() {
        // 固定为可见窗口复核流程，不再提供候选模式。
        return 'visible';
    }

    function getSelectedExportMode() {
        return 'single-file';
    }

    function getSelectedBatchSize() {
        return getQueueBatchSize();
    }

    function isQueuePreparedWithExistingTabs(queueItems) {
        if (!Array.isArray(queueItems) || queueItems.length === 0) return false;
        return queueItems.every((item) => {
            return item?.useExistingTab === true && Number.isFinite(Number(item?.existingTabId));
        });
    }

    async function hasLiveExistingTabsForQueue(queueItems, options = {}) {
        if (!Array.isArray(queueItems) || queueItems.length === 0) return false;
        const tabIds = Array.from(new Set(
            queueItems
                .map(item => Number(item?.existingTabId))
                .filter(id => Number.isFinite(id))
                .map(id => Math.floor(id))
        ));
        if (!tabIds.length) return false;

        const response = await sendRuntimeMessage({
            action: 'dev1CheckExistingTabsAlive',
            tabIds,
            items: queueItems.map((item) => ({
                tabId: item?.existingTabId,
                url: item?.url
            })),
            options: {
                wakeDiscarded: false,
                waitForComplete: options?.waitForComplete !== false
            }
        }, 20000);

        if (!response || response.success !== true || !Array.isArray(response.aliveTabIds)) {
            return false;
        }

        const aliveSet = new Set(
            response.aliveTabIds
                .map(id => Number(id))
                .filter(id => Number.isFinite(id))
                .map(id => Math.floor(id))
        );
        return queueItems.every((item) => {
            const tabId = Number(item?.existingTabId);
            return item?.useExistingTab === true
                && Number.isFinite(tabId)
                && aliveSet.has(Math.floor(tabId));
        });
    }

    async function promoteCurrentBatchToExistingTabs(queueItems) {
        const activeItems = getActiveQueueItems(queueItems);
        if (!Array.isArray(activeItems) || activeItems.length === 0) return activeItems;

        let allTabsPayload = null;
        try {
            allTabsPayload = await fetchAllWindowTabsSourcePayload();
        } catch (_) {
            return activeItems;
        }

        const metadataByUrl = new Map();
        (Array.isArray(allTabsPayload?.items) ? allTabsPayload.items : []).forEach((rawItem) => {
            const key = normalizeExistingTabMatchKey(rawItem?.url || '');
            const tabIdRaw = Number(rawItem?.existingTabId ?? rawItem?.tabId);
            if (!key || !Number.isFinite(tabIdRaw) || metadataByUrl.has(key)) return;
            metadataByUrl.set(key, {
                existingTabId: Math.floor(tabIdRaw),
                useExistingTab: true,
                actionText: getLangKey() === 'en' ? 'Open Tab' : '已打开Tab',
                sourceLabel: t('sourceLabelAllTabs')
            });
        });

        const promotedByKey = new Map();
        for (const item of activeItems) {
            const key = getQueueItemStableKey(item);
            const matchKey = normalizeExistingTabMatchKey(item?.url || '');
            const metadata = metadataByUrl.get(matchKey);
            if (!key || !metadata) return activeItems;
            promotedByKey.set(key, mergeExistingTabMetadata(item, metadata));
        }

        const nextQueue = cloneQueueItems(getExecutionQueueItems()).map((item) => {
            const key = getQueueItemStableKey(item);
            return promotedByKey.get(key) || item;
        });
        setLockedQueueItems(nextQueue);
        return getActiveQueueItems(getCurrentQueueBatchItems(nextQueue));
    }

    async function syncReviewWindowQueue({ silentStatus = true, fromEvent = false, removeBatchOnMissing = false, pruneMissingItems = removeBatchOnMissing } = {}) {
        const reviewWindowId = getReviewWindowId();
        if (reviewWindowId == null) return false;
        if (state.reviewSyncInFlight) return false;

        state.reviewSyncInFlight = true;
        try {
            const response = await sendRuntimeMessage({
                action: 'dev1GetReviewWindowTabsSource',
                windowId: reviewWindowId,
                lang: getLangKey()
            }, 20000);

            if (!response || response.success !== true || !Array.isArray(response.items)) {
                throw new Error(response?.error || t('reviewSyncFailed'));
            }

            const previousQueue = cloneQueueItems(state.lockedQueueItems);
            const previousQueueByTabId = new Map();
            const previousQueueByUrl = new Map();
            previousQueue.forEach((item) => {
                const tabId = getQueueItemTabId(item);
                if (tabId != null) {
                    previousQueueByTabId.set(tabId, item);
                }
                const key = normalizeWhitelistKey(item?.url || '');
                if (!key) return;
                previousQueueByUrl.set(key, item);
            });

            const currentSignature = buildQueueSignature(previousQueue);
            const currentReviewStateSignature = buildQueueReviewStateSignature(previousQueue);
            const batchKeySet = getCurrentReviewBatchKeySet(previousQueue);
            let nextBatchQueue = cloneQueueItems(response.items).map((item) => {
                const tabId = getQueueItemTabId(item);
                const key = normalizeWhitelistKey(item?.url || '');
                const previous = (tabId != null ? previousQueueByTabId.get(tabId) : null)
                    || (key ? previousQueueByUrl.get(key) : null);
                const sameReviewedUrl = previous
                    && normalizeWhitelistKey(previous?.url || '') === key;
                const mergedItem = previous ? {
                    ...previous,
                    title: item?.title || previous?.title || '',
                    url: item?.url || previous?.url || '',
                    domain: item?.domain || previous?.domain || '',
                    host: item?.host || previous?.host || '',
                    subdomain: item?.subdomain || previous?.subdomain || '',
                    subdomainLabel: item?.subdomainLabel || previous?.subdomainLabel || '',
                    reviewWindowId: item?.reviewWindowId || previous?.reviewWindowId || null,
                    existingTabId: item?.existingTabId,
                    useExistingTab: item?.useExistingTab === true,
                    reviewWindowActive: item?.reviewWindowActive === true,
                    reviewLastAccessed: item?.reviewLastAccessed || 0
                } : item;
                return {
                    ...mergedItem,
                    reviewed: sameReviewedUrl && previous?.reviewed === true,
                    reviewedAt: sameReviewedUrl ? String(previous?.reviewedAt || '').trim() : ''
                };
            });
            nextBatchQueue = applyAutoReviewTracking(nextBatchQueue);

            if (nextBatchQueue.length <= 0) {
                if (removeBatchOnMissing) {
                    const remainingQueue = removeCurrentReviewBatchFromQueue(previousQueue, { useInitialBatchKeys: true, reviewWindowId });
                    clearReviewSession();
                    if (!silentStatus) {
                        setStatus(remainingQueue.length <= 0 ? t('queueCleared') : t('reviewWindowClosedBatchRemoved'), 'success');
                    }
                    rerenderAllDataPanels();
                } else {
                    renderReviewWorkflowPanel();
                }
                return false;
            }

            const batchItems = previousQueue.filter(item => batchKeySet.has(getQueueItemStableKey(item)));
            const sourceBatchItems = batchItems.length > 0 ? batchItems : getCurrentQueueBatchItems(previousQueue);
            const nextSessionBatchItems = mergeReviewItemsForBatch(sourceBatchItems, nextBatchQueue, { pruneMissingItems });
            const nextQueue = mergeReviewBatchIntoLockedQueue(
                sourceBatchItems,
                nextBatchQueue,
                { pruneMissingItems }
            );
            const nextSignature = buildQueueSignature(nextQueue);
            const nextReviewStateSignature = buildQueueReviewStateSignature(nextQueue);
            const queueChanged = currentSignature !== nextSignature;
            const reviewStateChanged = currentReviewStateSignature !== nextReviewStateSignature;
            const wasAcknowledged = state.reviewSession?.acknowledged === true;

            const wasSubmitted = isReviewSubmitted();
            const nextSession = {
                windowId: reviewWindowId,
                lastSyncedAt: new Date().toISOString(),
                queueSignature: nextSignature,
                batchKeys: buildReviewBatchKeys(nextSessionBatchItems)
            };
            if (queueChanged && wasAcknowledged) {
                nextSession.acknowledged = false;
            }
            if (queueChanged && wasSubmitted) {
                nextSession.submitted = false;
                nextSession.submittedAt = '';
                markWorkflowStep('submitDone', false);
            }
            setReviewSession(nextSession);

            if (queueChanged && wasSubmitted) {
                setStatus(t('reviewQueueChanged'), 'warning');
            } else if (queueChanged && wasAcknowledged) {
                setStatus(t('reviewQueueChanged'), 'warning');
            } else if (!silentStatus && !fromEvent) {
                setStatus(`${t('reviewSyncNow')} (${nextBatchQueue.length})`, 'success');
            }

            if (queueChanged || reviewStateChanged || !fromEvent) {
                rerenderAllDataPanels();
            } else {
                renderReviewWorkflowPanel();
            }
            return true;
        } catch (error) {
            const message = normalizeRuntimeErrorMessage(error, t('reviewSyncFailed'));
            const shouldClear = /window|tab|invalid|not found|no window|closed/i.test(String(message).toLowerCase());
            if (shouldClear) {
                const remainingQueue = removeBatchOnMissing
                    ? removeCurrentReviewBatchFromQueue(state.lockedQueueItems, { useInitialBatchKeys: true, reviewWindowId })
                    : null;
                clearReviewSession();
                rerenderAllDataPanels();
                if (!silentStatus) {
                    if (removeBatchOnMissing) {
                        setStatus((remainingQueue && remainingQueue.length <= 0) ? t('queueCleared') : t('reviewWindowClosedBatchRemoved'), 'success');
                    } else {
                        setStatus(t('reviewWindowMissing'), 'warning');
                    }
                }
                return false;
            }
            if (!silentStatus) {
                setStatus(`${t('reviewSyncFailed')}: ${message}`, 'error');
            }
            return false;
        } finally {
            state.reviewSyncInFlight = false;
        }
    }

    async function prepareReviewWindowForQueue(queueItems) {
        if (!Array.isArray(queueItems) || queueItems.length === 0) {
            throw new Error(t('runBlockedNoQueue'));
        }

        setStatus(t('reviewPreparing'));
        const batchItems = cloneQueueItems(queueItems).slice(0, getQueueBatchSize());
        const items = batchItems.map((item, index) => ({
            index: getQueueItemDisplayIndex(item, index),
            title: item.title,
            url: item.url,
            folderPath: item.folderPath,
            domain: item.domain,
            subdomain: item.subdomain,
            actionText: item.actionText,
            existingTabId: item.existingTabId,
            useExistingTab: item.useExistingTab === true,
            queueBatchIndex: item.queueBatchIndex,
            queueBatchPosition: item.queueBatchPosition,
            queueDisplayIndex: item.queueDisplayIndex
        }));

        const response = await sendRuntimeMessage({
            action: 'dev1OpenReviewWindowForItems',
            lang: getLangKey(),
            items,
            maxTabs: getQueueBatchSize()
        }, 120000);

        if (!response || response.success !== true || !Array.isArray(response.items) || response.items.length === 0) {
            throw new Error(response?.error || t('reviewFailed'));
        }

        clearReviewSession();
        mergeReviewBatchIntoLockedQueue(batchItems, response.items);
        setReviewSession({
            windowId: Number.isFinite(Number(response.windowId)) ? Math.floor(Number(response.windowId)) : null,
            acknowledged: false,
            submitted: false,
            submittedAt: '',
            lastSyncedAt: new Date().toISOString(),
            queueSignature: buildQueueSignature(response.items),
            batchKeys: buildReviewBatchKeys(response.items),
            initialBatchKeys: buildReviewBatchKeys(batchItems)
        });
        markWorkflowStep('openDone', true);
        markWorkflowStep('submitDone', false);
        markWorkflowStep('runDone', false);
        ensureReviewEventSyncState();
        rerenderAllDataPanels();
        queueReviewWindowEventSync(response.windowId, { reason: 'review-opened' });
        setStatus(`${t('reviewReady')} (${response.total || response.items.length})`, 'success');
        return response.items;
    }

    function markCurrentReviewBatchReviewed(queueItems) {
        const activeItems = getActiveQueueItems(queueItems);
        const batchKeySet = getCurrentReviewBatchKeySet();
        const submittedBatchKeySet = new Set([
            ...Array.from(batchKeySet),
            ...buildReviewBatchKeys(activeItems)
        ]);
        const submittedBatchSlotSet = new Set(
            activeItems
                .map(item => getQueueItemSlotKey(item))
                .filter(Boolean)
        );

        const reviewedAt = new Date().toISOString();
        const reviewedQueue = cloneQueueItems(getExecutionQueueItems()).map((item) => {
            const slotKey = getQueueItemSlotKey(item);
            const inSubmittedBatch = submittedBatchSlotSet.size > 0
                ? (slotKey && submittedBatchSlotSet.has(slotKey))
                : submittedBatchKeySet.has(getQueueItemStableKey(item));
            if (!inSubmittedBatch) return item;
            return {
                ...item,
                reviewed: true,
                reviewedAt
            };
        });
        setLockedQueueItems(reviewedQueue);

        return {
            reviewedQueue,
            queueItems: getActiveQueueItems(getCurrentQueueBatchItems(reviewedQueue)),
            submittedBatchKeySet
        };
    }

    async function submitReviewWorkflow() {
        let queueItems = getActiveQueueItems(getCurrentQueueBatchItems());
        if (!Array.isArray(queueItems) || queueItems.length === 0) {
            throw new Error(t('runBlockedNoQueue'));
        }

        if (!isExistingTabReviewMode(queueItems) && getReviewWindowId() == null) {
            queueItems = await promoteCurrentBatchToExistingTabs(queueItems);
            if (isExistingTabReviewMode(queueItems)) {
                rerenderAllDataPanels();
            }
        }

        if (isExistingTabReviewMode(queueItems)) {
            const tabsReady = await hasLiveExistingTabsForQueue(queueItems, {
                wakeDiscarded: false,
                waitForComplete: true
            });
            if (!tabsReady) {
                throw new Error(t('reviewExistingTabUnavailable'));
            }

            const reviewedResult = markCurrentReviewBatchReviewed(queueItems);
            queueItems = reviewedResult.queueItems;
            setReviewSession({
                windowId: null,
                acknowledged: true,
                submitted: true,
                submittedAt: new Date().toISOString(),
                queueSignature: buildQueueSignature(queueItems),
                batchKeys: Array.from(reviewedResult.submittedBatchKeySet)
            });
            cancelReviewSyncTimers();
            clearReviewTrackingState();
            markWorkflowStep('submitDone', true);
            markWorkflowStep('runDone', false);
            rerenderAllDataPanels();
            setStatus(t('reviewSubmittedReady'), 'success');
            return;
        }

        const reviewWindowId = getReviewWindowId();
        if (reviewWindowId == null) {
            throw new Error(t('reviewExistingTabPromoteFailed'));
        }

        const synced = await syncReviewWindowQueue({
            silentStatus: true,
            pruneMissingItems: true
        });
        if (!synced) {
            throw new Error(t('reviewExistingTabPromoteFailed'));
        }

        queueItems = getActiveQueueItems(getCurrentQueueBatchItems());
        if (!Array.isArray(queueItems) || queueItems.length === 0) {
            throw new Error(t('runBlockedNoQueue'));
        }

        const reviewedResult = markCurrentReviewBatchReviewed(queueItems);
        queueItems = reviewedResult.queueItems;

        setReviewSession({
            acknowledged: true,
            submitted: true,
            submittedAt: new Date().toISOString(),
            queueSignature: buildQueueSignature(queueItems),
            batchKeys: Array.from(reviewedResult.submittedBatchKeySet)
        });
        cancelReviewSyncTimers();
        clearReviewTrackingState();
        markWorkflowStep('submitDone', true);
        markWorkflowStep('runDone', false);
        rerenderAllDataPanels();
        setStatus(t('reviewSubmittedReady'), 'success');
    }

    async function closeReviewTabForQueueItem(item) {
        const reviewWindowId = getReviewWindowId();
        if (reviewWindowId == null) return true;

        const response = await sendRuntimeMessage({
            action: 'dev1CloseReviewQueueTab',
            windowId: reviewWindowId,
            tabId: item?.existingTabId,
            url: item?.url
        }, 20000);

        return !!(response && response.success === true);
    }

    function getRuntimeLastErrorMessage() {
        return String(runtimeApi?.runtime?.lastError?.message || '').trim();
    }

    function queryTabsDirect(queryInfo = {}) {
        return new Promise((resolve, reject) => {
            if (!runtimeApi?.tabs || typeof runtimeApi.tabs.query !== 'function') {
                reject(new Error(t('queueFocusTabFailed')));
                return;
            }
            try {
                runtimeApi.tabs.query(queryInfo, (tabs) => {
                    const errorText = getRuntimeLastErrorMessage();
                    if (errorText) {
                        reject(new Error(errorText));
                        return;
                    }
                    resolve(Array.isArray(tabs) ? tabs : []);
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    function getTabDirect(tabId) {
        return new Promise((resolve, reject) => {
            const normalizedTabId = Number(tabId);
            if (!Number.isFinite(normalizedTabId) || !runtimeApi?.tabs || typeof runtimeApi.tabs.get !== 'function') {
                reject(new Error(t('queueFocusTabFailed')));
                return;
            }
            try {
                runtimeApi.tabs.get(Math.floor(normalizedTabId), (tab) => {
                    const errorText = getRuntimeLastErrorMessage();
                    if (errorText) {
                        reject(new Error(errorText));
                        return;
                    }
                    resolve(tab || null);
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    function focusWindowDirect(windowId) {
        return new Promise((resolve) => {
            const normalizedWindowId = Number(windowId);
            if (!Number.isFinite(normalizedWindowId) || !runtimeApi?.windows || typeof runtimeApi.windows.update !== 'function') {
                resolve(null);
                return;
            }
            try {
                runtimeApi.windows.update(Math.floor(normalizedWindowId), { focused: true }, (windowInfo) => {
                    resolve(windowInfo || null);
                });
            } catch (_) {
                resolve(null);
            }
        });
    }

    function activateTabDirect(tabId) {
        return new Promise((resolve, reject) => {
            const normalizedTabId = Number(tabId);
            if (!Number.isFinite(normalizedTabId) || !runtimeApi?.tabs || typeof runtimeApi.tabs.update !== 'function') {
                reject(new Error(t('queueFocusTabFailed')));
                return;
            }
            try {
                runtimeApi.tabs.update(Math.floor(normalizedTabId), { active: true }, (tab) => {
                    const errorText = getRuntimeLastErrorMessage();
                    if (errorText) {
                        reject(new Error(errorText));
                        return;
                    }
                    resolve(tab || null);
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    async function focusQueueTabDirect(tabId, rawUrl = '') {
        const normalizedTabId = Number(tabId);
        const url = String(rawUrl || '').trim();
        if (!Number.isFinite(normalizedTabId) && !url) {
            throw new Error(t('queueFocusTabFailed'));
        }
        let targetTabId = Number.isFinite(normalizedTabId) ? Math.floor(normalizedTabId) : null;
        if (targetTabId == null && url) {
            const targetKey = normalizeExistingTabMatchKey(url);
            const tabs = await queryTabsDirect({});
            const matchedTab = tabs.find((tab) => normalizeExistingTabMatchKey(tab?.url || tab?.pendingUrl || '') === targetKey);
            targetTabId = Number.isFinite(Number(matchedTab?.id)) ? Math.floor(Number(matchedTab.id)) : null;
        }
        if (targetTabId == null) {
            throw new Error(t('queueFocusTabFailed'));
        }
        const tab = await getTabDirect(targetTabId);
        if (!tab || !Number.isFinite(Number(tab.id))) {
            throw new Error(t('queueFocusTabFailed'));
        }
        const windowId = Number(tab.windowId);
        if (Number.isFinite(windowId)) {
            await focusWindowDirect(windowId);
        }
        await activateTabDirect(targetTabId);
        return {
            success: true,
            tabId: targetTabId,
            windowId: Number.isFinite(windowId) ? Math.floor(windowId) : null
        };
    }

    async function focusQueueTab(tabId, rawUrl = '') {
        if (runtimeApi?.tabs && typeof runtimeApi.tabs.update === 'function') {
            return focusQueueTabDirect(tabId, rawUrl);
        }
        const normalizedTabId = Number(tabId);
        const url = String(rawUrl || '').trim();
        if (!Number.isFinite(normalizedTabId) && !url) {
            throw new Error(t('queueFocusTabFailed'));
        }
        const response = await sendRuntimeMessage({
            action: 'dev1FocusQueueTab',
            tabId: Number.isFinite(normalizedTabId) ? Math.floor(normalizedTabId) : null,
            url
        }, 20000);
        if (!response || response.success !== true) {
            throw new Error(response?.error || t('queueFocusTabFailed'));
        }
        return response;
    }

    async function handleQueueDeleteAction(rawUrl) {
        const key = normalizeWhitelistKey(rawUrl);
        if (!key) return;

        const currentQueue = cloneQueueItems(getExecutionQueueItems());
        const targetIndex = findQueueItemIndexByUrl(currentQueue, key);
        if (targetIndex < 0) return;

        const targetItem = currentQueue[targetIndex];
        const nextQueue = currentQueue.filter((_, idx) => idx !== targetIndex);

        try {
            await closeReviewTabForQueueItem(targetItem);
        } catch (error) {
            const message = normalizeRuntimeErrorMessage(error, t('reviewSyncFailed'));
            setStatus(`${t('reviewSyncFailed')}: ${message}`, 'warning');
            return;
        }

        updateLockedQueueAfterManualEdit(nextQueue, { clearReviewWhenEmpty: true });
        rerenderAllDataPanels();
        setStatus(t('queueRowDeleted'), 'success');
    }

    function handleQueueWhitelistToggleAction(rawUrl) {
        const key = normalizeWhitelistKey(rawUrl);
        if (!key) return;
        const wasWhitelisted = state.whitelistKeys instanceof Set && state.whitelistKeys.has(key);
        setQueueItemWhitelist(key, !wasWhitelisted);
        rerenderAllDataPanels();
        setStatus(!wasWhitelisted ? t('queueRowWhitelistOn') : t('queueRowWhitelistOff'), 'success');
    }

    function updateQueueBatchSizeControlState() {
        const runIsActive = state.running || String(state.captureRunState?.status || '').toLowerCase() === 'running';
        const mhtmlHintRow = document.getElementById('dev1MhtmlHintRow');
        const sizeEl = document.getElementById('dev1QueueBatchSizeInput');
        if (mhtmlHintRow) {
            mhtmlHintRow.hidden = false;
        }
        if (sizeEl instanceof HTMLInputElement) {
            if (document.activeElement !== sizeEl) {
                sizeEl.value = String(getQueueBatchSize());
            }
            sizeEl.disabled = runIsActive;
        }
    }

    function setRunControlsDisabled(disabled) {
        const runBtn = document.getElementById('dev1RunBtn');
        const cancelBtn = document.getElementById('dev1CancelBtn');
        const clearBtn = document.getElementById('dev1ClearFiltersBtn');
        const scopeBtn = document.getElementById('dev1ScopeBtn');
        const openReviewBtn = document.getElementById('dev1OpenReviewBtn');
        const resumeBtn = document.getElementById('dev1ResumeBtn');
        const refreshRunStateBtn = document.getElementById('dev1RefreshRunStateBtn');
        const reviewSyncBtn = document.getElementById('dev1ReviewSyncBtn');
        const reviewSubmitBtn = document.getElementById('dev1ReviewSubmitBtn');
        const batchPrevBtn = document.getElementById('dev1QueueBatchPrevBtn');
        const batchNextBtn = document.getElementById('dev1QueueBatchNextBtn');
        const queueItems = getCurrentQueueBatchItems();
        const batches = getQueueBatches();
        const currentBatchIndex = clampQueueBatchIndex();
        const activeQueueItems = getActiveQueueItems(queueItems);
        const queueCount = Array.isArray(activeQueueItems) ? activeQueueItems.length : 0;
        const existingTabReviewMode = isExistingTabReviewMode(activeQueueItems);
        const openStepSatisfied = isReviewOpenStepSatisfied(activeQueueItems);
        const submitStepSatisfied = isReviewSubmitStepSatisfied(activeQueueItems);
        const runIsActive = state.running || String(state.captureRunState?.status || '').toLowerCase() === 'running';
        if (runBtn) runBtn.disabled = !!disabled && !runIsActive;
        updateRunPrimaryButton(runIsActive);
        if (cancelBtn) cancelBtn.disabled = !runIsActive;
        if (clearBtn) clearBtn.disabled = !!disabled;
        if (scopeBtn) scopeBtn.disabled = !!disabled;
        if (openReviewBtn) {
            openReviewBtn.hidden = existingTabReviewMode;
            openReviewBtn.classList.toggle('dev1-step-done', openStepSatisfied || isWorkflowStepDone('openDone'));
            openReviewBtn.disabled = existingTabReviewMode || !!disabled || queueCount <= 0;
        }
        if (resumeBtn) resumeBtn.disabled = !!disabled || !(state.captureRunState && state.captureRunState.resumable);
        if (refreshRunStateBtn) refreshRunStateBtn.disabled = !!disabled;
        if (reviewSyncBtn) reviewSyncBtn.disabled = !!disabled || getReviewWindowId() == null;
        if (batchPrevBtn instanceof HTMLButtonElement) {
            batchPrevBtn.disabled = !!disabled || batches.length <= 1 || currentBatchIndex <= 0;
        }
        if (batchNextBtn instanceof HTMLButtonElement) {
            batchNextBtn.disabled = !!disabled || batches.length <= 1 || currentBatchIndex >= batches.length - 1;
        }
        if (reviewSubmitBtn) {
            reviewSubmitBtn.hidden = false;
            reviewSubmitBtn.classList.toggle('dev1-step-done', submitStepSatisfied);
            reviewSubmitBtn.disabled = !!disabled
                || (!existingTabReviewMode && getReviewWindowId() == null)
                || queueCount <= 0;
        }
        updateQueueBatchSizeControlState();
    }

    function isUserPausedCaptureState(runState) {
        if (!runState || typeof runState !== 'object') return false;
        const status = String(runState.status || '').trim().toLowerCase();
        const reason = String(runState.interruptedReason || '').trim().toLowerCase();
        return status === 'interrupted' && reason === 'paused_by_user' && runState.resumable === true;
    }

    function applyRunResponseStatus(response, doneTextKey) {
        const status = String(response?.status || '').trim().toLowerCase();
        const reason = String(response?.interruptedReason || '').trim().toLowerCase();
        if (status === 'interrupted' && reason === 'paused_by_user') {
            setStatus(t('runPaused'), 'warning');
            return;
        }
        if (status === 'interrupted' && reason === 'cancelled_by_user') {
            setStatus(t('runCancelled'), 'warning');
            return;
        }
        setStatus(`${t(doneTextKey)} (${t('statusOk')}: ${response?.summary?.successCount || 0}, ${t('statusPartial')}: ${response?.summary?.partialCount || 0}, ${t('statusFail')}: ${response?.summary?.failureCount || 0})`, 'success');
    }

    function hasRunDownloadEvidence(response) {
        const status = String(response?.status || '').trim().toLowerCase();
        if (status === 'completed') return true;
        const summary = response?.summary || {};
        if ((Number(summary.successCount) || 0) > 0 || (Number(summary.partialCount) || 0) > 0) return true;
        const artifacts = Array.isArray(response?.artifacts) ? response.artifacts : [];
        return artifacts.some((artifact) => String(artifact?.filePath || '').trim());
    }

    function clearReviewWorkflowAfterRunIfDone(response) {
        if (!hasRunDownloadEvidence(response)) return;
        clearReviewSession();
        resetWorkflowSteps();
    }

    async function startCaptureTask() {
        if (state.running) return;
        if (isUserPausedCaptureState(state.captureRunState)) {
            await resumeCaptureTask();
            return;
        }
        await runCaptureTask();
    }

    async function pauseCaptureTask() {
        const isActive = state.running || String(state.captureRunState?.status || '').toLowerCase() === 'running';
        if (!isActive) {
            setStatus(t('runControlNoActive'), 'warning');
            return;
        }
        setStatus(t('runPausing'), 'warning');
        try {
            const response = await sendRuntimeMessage({ action: 'dev1PauseCaptureRun' }, 20000);
            if (!response || response.success !== true) {
                throw new Error(response?.error || t('runPauseFailed'));
            }
            await refreshCaptureRunState({ silent: true });
            rerenderAllDataPanels();
            setStatus(t('runPaused'), 'warning');
        } catch (error) {
            setStatus(`${t('runPauseFailed')}: ${error?.message || ''}`, 'error');
        }
    }

    async function cancelCaptureTask() {
        const isActive = state.running || String(state.captureRunState?.status || '').toLowerCase() === 'running';
        if (!isActive) {
            setStatus(t('runControlNoActive'), 'warning');
            return;
        }
        setStatus(t('runCanceling'), 'warning');
        try {
            const response = await sendRuntimeMessage({ action: 'dev1CancelCaptureRun' }, 20000);
            if (!response || response.success !== true) {
                throw new Error(response?.error || t('runCancelFailed'));
            }
            await refreshCaptureRunState({ silent: true });
            rerenderAllDataPanels();
            setStatus(t('runCancelled'), 'warning');
        } catch (error) {
            setStatus(`${t('runCancelFailed')}: ${error?.message || ''}`, 'error');
        }
    }

    async function runCaptureTask() {
        if (state.running) return;

        const formats = getSelectedFormats();
        if (!formats.mhtml) {
            setStatus(t('runBlockedNoFormat'), 'error');
            return;
        }

        let queueItems = getActiveQueueItems(getCurrentQueueBatchItems());
        if (!Array.isArray(queueItems) || queueItems.length === 0) {
            setStatus(t('runBlockedNoQueue'), 'error');
            return;
        }

        let existingTabReviewMode = isExistingTabReviewMode(queueItems);
        if (!existingTabReviewMode && getReviewWindowId() == null) {
            queueItems = await promoteCurrentBatchToExistingTabs(queueItems);
            existingTabReviewMode = isExistingTabReviewMode(queueItems);
        }

        // Ordinary queues capture through a review window; pure opened-tab queues reuse their existing tab ids.
        if (getReviewWindowId() == null && !existingTabReviewMode) {
            try {
                await prepareReviewWindowForQueue(queueItems);
            } catch (error) {
                setStatus(`${t('reviewFailed')}: ${error?.message || ''}`, 'error');
            }
            return;
        }

        if (!isReviewSatisfiedForQueue(queueItems)) {
            if (existingTabReviewMode) {
                setStatus(t('reviewNeedSubmit'), 'warning');
                renderReviewWorkflowPanel();
                return;
            }
            const synced = await syncReviewWindowQueue({
                silentStatus: true,
                pruneMissingItems: true
            });
            if (!synced) {
                setStatus(t('reviewSyncFailed'), 'warning');
                return;
            }
            queueItems = getActiveQueueItems(getCurrentQueueBatchItems());
        }
        if (!Array.isArray(queueItems) || queueItems.length === 0) {
            setStatus(t('runBlockedNoQueue'), 'error');
            return;
        }

        let queueReady = isQueuePreparedWithExistingTabs(queueItems);
        if (queueReady) {
            try {
                queueReady = await hasLiveExistingTabsForQueue(queueItems);
            } catch (_) {
                queueReady = false;
            }
        }

        if (!queueReady) {
            if (existingTabReviewMode) {
                setStatus(t('reviewExistingTabUnavailable'), 'warning');
                renderReviewWorkflowPanel();
                return;
            }
            try {
                await prepareReviewWindowForQueue(queueItems);
            } catch (error) {
                setStatus(`${t('reviewFailed')}: ${error?.message || ''}`, 'error');
            }
            return;
        }

        if (!shouldBypassReviewForQueue(queueItems) && !isReviewSatisfiedForQueue(queueItems)) {
            setStatus(t('reviewNeedSubmit'), 'warning');
            renderReviewWorkflowPanel();
            return;
        }

        const captureMode = getSelectedCaptureMode();
        const exportMode = getSelectedExportMode();
        const batchSize = getQueueBatchSize();
        markWorkflowStep('runDone', true);
        cancelReviewSyncTimers();
        clearReviewTrackingState();
        state.running = true;
        setRunControlsDisabled(true);
        setStatus(t('runStart'), 'info');

        try {
            const items = queueItems.map((item, index) => ({
                index: getQueueItemDisplayIndex(item, index),
                title: item.title,
                url: item.url,
                folderPath: item.folderPath,
                domain: item.domain,
                subdomain: item.subdomain,
                actionText: item.actionText,
                existingTabId: item.existingTabId,
                useExistingTab: item.useExistingTab === true,
                queueBatchIndex: item.queueBatchIndex,
                queueBatchPosition: item.queueBatchPosition,
                queueDisplayIndex: item.queueDisplayIndex
            }));

            const response = await sendRuntimeMessage({
                action: 'dev1CaptureAndExportUrls',
                lang: getLangKey(),
                items,
                formats,
                options: {
                    closeTabAfterCapture: true,
                    renderWaitMs: 1300,
                    captureMode,
                    exportMode,
                    batchSize
                }
            }, Math.max(180000, items.length * 30000));

            if (!response || response.success !== true) {
                throw new Error(response?.error || t('runFailed'));
            }

            await refreshCaptureRunState({ silent: true });
            clearReviewWorkflowAfterRunIfDone(response);
            rerenderAllDataPanels();
            applyRunResponseStatus(response, 'runDone');
        } catch (error) {
            setStatus(`${t('runFailed')}: ${error?.message || ''}`, 'error');
            await refreshCaptureRunState({ silent: true });
        } finally {
            state.running = false;
            cancelReviewSyncTimers();
            clearReviewTrackingState();
            resetWorkflowSteps();
            setRunControlsDisabled(false);
            renderReviewWorkflowPanel();
        }
    }

    async function resumeCaptureTask() {
        if (state.running) return;

        const formats = getSelectedFormats();
        const captureMode = getSelectedCaptureMode();
        const exportMode = getSelectedExportMode();
        const batchSize = getQueueBatchSize();
        markWorkflowStep('runDone', true);
        cancelReviewSyncTimers();
        clearReviewTrackingState();
        state.running = true;
        setRunControlsDisabled(true);
        setStatus(t('recoveryResumeStart'), 'info');

        try {
            const response = await sendRuntimeMessage({
                action: 'dev1ResumeCaptureRun',
                lang: getLangKey(),
                formats,
                options: {
                    closeTabAfterCapture: true,
                    renderWaitMs: 1300,
                    maxRetries: 1,
                    captureMode,
                    exportMode,
                    batchSize
                }
            }, Math.max(180000, getExecutionQueueItems().length * 30000));

            if (!response || response.success !== true) {
                throw new Error(response?.error || t('recoveryResumeFailed'));
            }

            await refreshCaptureRunState({ silent: true });
            clearReviewWorkflowAfterRunIfDone(response);
            rerenderAllDataPanels();
            applyRunResponseStatus(response, 'recoveryResumeDone');
        } catch (error) {
            setStatus(`${t('recoveryResumeFailed')}: ${error?.message || ''}`, 'error');
            await refreshCaptureRunState({ silent: true });
        } finally {
            state.running = false;
            cancelReviewSyncTimers();
            clearReviewTrackingState();
            resetWorkflowSteps();
            setRunControlsDisabled(false);
            renderReviewWorkflowPanel();
        }
    }

    async function refreshCurrentChangesSource({ silentStatus = false, forceRefresh = true } = {}) {
        if (state.running) return;

        if (!silentStatus) {
            setStatus(t('scopeRefreshingCurrentChanges'));
        }
        if (!state.initialized) {
            loadSavedReviewAutoReviewMs();
            loadSavedQueueBatchSize();
            loadSavedQueueSnapshot();
            loadSavedReviewSession();
            loadSavedWhitelist();
            state.initialized = true;
        }

        const changeSourceState = getSourceState(SOURCE_CHANGES);
        try {
            const changesResult = await fetchCurrentChangesPayload({ forceRefresh });
            const changesPayload = buildSourceItemsFromChangesPayload(changesResult?.payload);
            changeSourceState.loadError = '';
            changeSourceState.items = Array.isArray(changesPayload?.items) ? changesPayload.items : [];
            changeSourceState.folderBadgeByPath = changesPayload?.folderBadgeByPath instanceof Map
                ? changesPayload.folderBadgeByPath
                : new Map();
            changeSourceState.scopeTreeNodes = Array.isArray(changesPayload?.scopeTreeNodes)
                ? changesPayload.scopeTreeNodes
                : [];
        } catch (error) {
            changeSourceState.loadError = `${t('sourceLabelCurrentChanges')}: ${normalizeRuntimeErrorMessage(error, t('sourceError'))}`;
            changeSourceState.items = [];
            changeSourceState.folderBadgeByPath = new Map();
            changeSourceState.scopeTreeNodes = [];
        }

        changeSourceState.filterOptions = buildFilterOptions(changeSourceState.items);
        pruneFiltersAgainstOptions(SOURCE_CHANGES);
        applyAllFilters();
        rerenderAllDataPanels();

        if (changeSourceState.loadError) {
            throw new Error(changeSourceState.loadError);
        }

        if (!silentStatus) {
            if (changeSourceState.items.length === 0) {
                setStatus(t('scopeNoChangeData'));
            } else {
                setStatus('');
            }
        }
    }

    async function refreshAllTabsSource({ silentStatus = false } = {}) {
        if (state.running) return;

        if (!silentStatus) {
            setStatus(t('scopeRefreshingAllTabs'));
        }
        if (!state.initialized) {
            loadSavedReviewAutoReviewMs();
            loadSavedQueueBatchSize();
            loadSavedQueueSnapshot();
            loadSavedReviewSession();
            loadSavedWhitelist();
            state.initialized = true;
        }

        const allTabsSourceState = getSourceState(SOURCE_ALL_TABS);
        try {
            const allTabsResult = await fetchAllWindowTabsSourcePayload();
            allTabsSourceState.loadError = '';
            allTabsSourceState.items = buildSourceItemsFromAllTabsPayload(allTabsResult);
            allTabsSourceState.folderBadgeByPath = new Map();
            allTabsSourceState.scopeTreeNodes = [];
        } catch (error) {
            allTabsSourceState.loadError = `${t('sourceLabelAllTabs')}: ${normalizeRuntimeErrorMessage(error, t('sourceError'))}`;
            allTabsSourceState.items = [];
            allTabsSourceState.folderBadgeByPath = new Map();
            allTabsSourceState.scopeTreeNodes = [];
        }

        allTabsSourceState.filterOptions = buildFilterOptions(allTabsSourceState.items);
        pruneFiltersAgainstOptions(SOURCE_ALL_TABS);
        applyAllFilters();
        rerenderAllDataPanels();

        if (allTabsSourceState.loadError) {
            throw new Error(allTabsSourceState.loadError);
        }

        if (!silentStatus) {
            if (allTabsSourceState.items.length === 0) {
                setStatus(t('scopeNoTabData'));
            } else {
                setStatus('');
            }
        }
    }

    async function refreshSource({ force = false } = {}) {
        if (state.running) return;

        setStatus(t('loading'));
        if (!state.initialized) {
            loadSavedReviewAutoReviewMs();
            loadSavedQueueBatchSize();
            loadSavedQueueSnapshot();
            loadSavedReviewSession();
            loadSavedWhitelist();
            state.initialized = true;
        }

        const [bookmarkResult, changesResult, allTabsResult] = await Promise.allSettled([
            fetchBookmarkSourcePayload(),
            fetchCurrentChangesPayload({ forceRefresh: force === true }),
            fetchAllWindowTabsSourcePayload()
        ]);

        const bookmarkSourceState = getSourceState(SOURCE_BOOKMARKS);
        const changeSourceState = getSourceState(SOURCE_CHANGES);
        const allTabsSourceState = getSourceState(SOURCE_ALL_TABS);
        let hasAnySuccess = false;
        const errorTexts = [];

        if (bookmarkResult.status === 'fulfilled') {
            bookmarkSourceState.loadError = '';
            bookmarkSourceState.items = buildSourceItemsFromBookmarkPayload(bookmarkResult.value);
            bookmarkSourceState.folderBadgeByPath = new Map();
            bookmarkSourceState.scopeTreeNodes = [];
            hasAnySuccess = true;
        } else {
            bookmarkSourceState.loadError = `${t('sourceLabelBookmarkApi')}: ${normalizeRuntimeErrorMessage(bookmarkResult.reason, t('sourceError'))}`;
            bookmarkSourceState.items = [];
            bookmarkSourceState.folderBadgeByPath = new Map();
            bookmarkSourceState.scopeTreeNodes = [];
            errorTexts.push(bookmarkSourceState.loadError);
        }

        if (changesResult.status === 'fulfilled') {
            changeSourceState.loadError = '';
            const changesPayload = buildSourceItemsFromChangesPayload(changesResult.value?.payload);
            changeSourceState.items = Array.isArray(changesPayload?.items) ? changesPayload.items : [];
            changeSourceState.folderBadgeByPath = changesPayload?.folderBadgeByPath instanceof Map
                ? changesPayload.folderBadgeByPath
                : new Map();
            changeSourceState.scopeTreeNodes = Array.isArray(changesPayload?.scopeTreeNodes)
                ? changesPayload.scopeTreeNodes
                : [];
            hasAnySuccess = true;
        } else {
            changeSourceState.loadError = `${t('sourceLabelCurrentChanges')}: ${normalizeRuntimeErrorMessage(changesResult.reason, t('sourceError'))}`;
            changeSourceState.items = [];
            changeSourceState.folderBadgeByPath = new Map();
            changeSourceState.scopeTreeNodes = [];
            errorTexts.push(changeSourceState.loadError);
        }

        if (allTabsResult.status === 'fulfilled') {
            allTabsSourceState.loadError = '';
            allTabsSourceState.items = buildSourceItemsFromAllTabsPayload(allTabsResult.value);
            allTabsSourceState.folderBadgeByPath = new Map();
            allTabsSourceState.scopeTreeNodes = [];
            hasAnySuccess = true;
        } else {
            allTabsSourceState.loadError = `${t('sourceLabelAllTabs')}: ${normalizeRuntimeErrorMessage(allTabsResult.reason, t('sourceError'))}`;
            allTabsSourceState.items = [];
            allTabsSourceState.folderBadgeByPath = new Map();
            allTabsSourceState.scopeTreeNodes = [];
            errorTexts.push(allTabsSourceState.loadError);
        }

        SOURCE_KEYS.forEach((sourceKey) => {
            const sourceState = getSourceState(sourceKey);
            sourceState.filterOptions = buildFilterOptions(sourceState.items);
            pruneFiltersAgainstOptions(sourceKey);
        });

        applyAllFilters();
        rerenderAllDataPanels();

        if (!hasAnySuccess) {
            throw new Error(errorTexts.join(' | ') || t('sourceError'));
        }

        if (state.sourceItems.length === 0) {
            setStatus(t('noChanges'));
        } else if (errorTexts.length > 0) {
            setStatus(`${t('sourcePartialError')}: ${errorTexts.join(' | ')}`, 'warning');
        } else {
            setStatus('');
        }
    }

    function renderLayout(root) {
        if (!root) return;

        root.innerHTML = `
            <div class="dev1-root">
                <section class="dev1-card">
                    <div class="dev1-queue-head">
                        <h3 class="dev1-card-title">
                            ${escapeHtml(t('queueTitle'))}
                            <button id="dev1ReviewSettingsBtn" type="button" class="dev1-title-icon-btn" title="${escapeHtml(t('reviewSettingsOpen'))}" aria-label="${escapeHtml(t('reviewSettingsOpen'))}" aria-expanded="false">
                                <i class="fas fa-cog"></i>
                            </button>
                        </h3>
                        <div class="dev1-run-controls">
                            <button id="dev1OpenReviewBtn" class="action-btn compact" title="${escapeHtml(t('tipReviewOpenWindow'))}">
                                <span>${escapeHtml(t('reviewOpenWindow'))}</span>
                            </button>
                            <button id="dev1ReviewSubmitBtn" class="action-btn compact primary" title="${escapeHtml(t('tipReviewSubmit'))}">
                                <span>${escapeHtml(t('reviewSubmit'))}</span>
                            </button>
                            <button id="dev1RunBtn" class="action-btn compact primary" title="${escapeHtml(t('tipRunStart'))}">
                                <span>${escapeHtml(t('runStartBtn'))}</span>
                            </button>
                        </div>
                    </div>
                    <div class="dev1-review-workflow">
                        <div class="dev1-review-workflow-summary">
                            <div id="dev1ReviewSelectedSummary" class="dev1-review-workflow-status">-</div>
                            <div id="dev1ReviewWorkflowStatus" class="dev1-review-workflow-status">-</div>
                        </div>
                        <div class="dev1-review-workflow-actions">
                            <button id="dev1ScopeBtn" class="action-btn compact" title="${escapeHtml(t('tipPickScope'))}">
                                <i class="fas fa-sliders-h"></i>
                                <span style="margin-left: 6px;">${escapeHtml(t('pickScope'))}</span>
                            </button>
                            <button id="dev1ReviewSyncBtn" class="action-btn compact" title="${escapeHtml(t('tipReviewSyncNow'))}">
                                <i class="fas fa-arrows-rotate"></i>
                                <span style="margin-left: 6px;">${escapeHtml(t('reviewSyncNow'))}</span>
                            </button>
                            <button id="dev1ClearFiltersBtn" class="action-btn compact" title="${escapeHtml(t('tipQueueClear'))}">
                                <i class="fas fa-trash-alt"></i>
                                <span style="margin-left: 6px;">${escapeHtml(t('queueClear'))}</span>
                            </button>
                            <button id="dev1CancelBtn" class="action-btn compact" title="${escapeHtml(t('tipRunCancel'))}" disabled>
                                <i class="fas fa-ban"></i>
                                <span style="margin-left: 6px;">${escapeHtml(t('runCancelBtn'))}</span>
                            </button>
                            <div class="dev1-queue-batch-pager" aria-label="${escapeHtml(t('queueBatchTitle'))}">
                                <button id="dev1QueueBatchPrevBtn" type="button" class="dev1-queue-batch-page-btn" title="${escapeHtml(t('queueBatchPrevious'))}" aria-label="${escapeHtml(t('queueBatchPrevious'))}">
                                    <i class="fas fa-chevron-left"></i>
                                </button>
                                <span id="dev1QueueBatchPageLabel" class="dev1-queue-batch-page-label">${escapeHtml(t('queueBatchTitle'))} 1 / 1</span>
                                <button id="dev1QueueBatchNextBtn" type="button" class="dev1-queue-batch-page-btn" title="${escapeHtml(t('queueBatchNext'))}" aria-label="${escapeHtml(t('queueBatchNext'))}">
                                    <i class="fas fa-chevron-right"></i>
                                </button>
                            </div>
                            <label class="dev1-queue-batch-size-control" title="${escapeHtml(t('queueBatchSizeTip'))}">
                                <span>${escapeHtml(t('queueBatchSizeLabel'))}</span>
                                <input id="dev1QueueBatchSizeInput" type="text" inputmode="numeric" pattern="[0-9]*" value="${escapeHtml(String(getQueueBatchSize()))}">
                            </label>
                        </div>
                    </div>
                    <div id="dev1QueueWrap" class="dev1-table-wrap"></div>
                </section>

                <section class="dev1-card dev1-export-card">
                    <h3 class="dev1-card-title">
                        ${escapeHtml(t('exportFormats'))}
                        <span class="dev1-help-dot" tabindex="0" data-tip="${escapeHtml(t('exportHelp'))}">?</span>
                    </h3>
                    <div class="dev1-format-row dev1-field-row">
                        <label>${escapeHtml(t('exportTypesLabel'))}</label>
                        <div class="dev1-field-control">
                            <div class="dev1-format-fixed">
                                <span class="dev1-format-pill">${escapeHtml(t('fmtMhtml'))}</span>
                                <span class="dev1-format-fixed-note">${escapeHtml(t('fmtMhtmlOfficial'))}</span>
                            </div>
                        </div>
                    </div>
                    <div id="dev1MhtmlHintRow" class="dev1-format-row dev1-export-note-row">
                        <div class="dev1-export-note">
                            <i class="fas fa-circle-info"></i>
                            <span>${escapeHtml(t('mhtmlLoadedHint'))}</span>
                        </div>
                    </div>
                </section>

                <div id="dev1ScopeModal" class="modal dev1-scope-overlay" aria-hidden="true">
                    <div class="modal-content manual-selector-dialog dev1-scope-modal">
                        <div class="manual-selector-header dev1-scope-header">
                            <h3>${escapeHtml(t('scopeTitle'))}</h3>
                            <div class="manual-selector-header-right">
                                <button id="dev1ScopeModalClose" class="manual-selector-close modal-close" aria-label="${escapeHtml(getLangKey() === 'en' ? 'Close' : '关闭')}">
                                    <i class="fas fa-times"></i>
                                </button>
                            </div>
                        </div>
                        <div class="manual-selector-body dev1-scope-modal-body">
                            <div class="dev1-scope-kind-tabs" role="tablist" aria-label="${escapeHtml(t('scopeTitle'))}">
                                <button type="button" class="dev1-scope-kind-tab active" data-kind="changes-folder">
                                    <i class="fas fa-history"></i>
                                    <span>${escapeHtml(t('dimCurrentChanges'))}</span>
                                </button>
                                <button type="button" class="dev1-scope-kind-tab" data-kind="folder">
                                    <i class="fas fa-folder"></i>
                                    <span>${escapeHtml(t('dimFolder'))}</span>
                                </button>
                                <button type="button" class="dev1-scope-kind-tab" data-kind="domain">
                                    <i class="fas fa-globe"></i>
                                    <span>${escapeHtml(t('dimDomain'))}</span>
                                </button>
                                <button type="button" class="dev1-scope-kind-tab" data-kind="subdomain">
                                    <i class="fas fa-sitemap"></i>
                                    <span>${escapeHtml(t('dimSubdomain'))}</span>
                                </button>
                                <button type="button" class="dev1-scope-kind-tab" data-kind="all-tabs">
                                    <i class="fas fa-window-maximize"></i>
                                    <span>${escapeHtml(t('dimAllTabs'))}</span>
                                </button>
                                <button type="button" class="dev1-scope-kind-tab" data-kind="whitelist">
                                    <i class="fas fa-shield-alt"></i>
                                    <span>${escapeHtml(t('dimWhitelist'))}</span>
                                </button>
                            </div>
                            <div id="dev1ScopeCurrentChangesInfo" class="dev1-scope-current-changes-row">
                                <span id="dev1ScopeCurrentChangesMode" class="dev1-scope-current-changes-mode">${escapeHtml(t('scopeCurrentChangesModePrefix'))}: ${escapeHtml(t('changesModeCollection'))}</span>
                                <button id="dev1ScopeRefreshChangesBtn" type="button" class="dev1-scope-refresh-btn">
                                    <i class="fas fa-sync-alt"></i>
                                    <span>${escapeHtml(t('scopeRefreshCurrentChanges'))}</span>
                                </button>
                            </div>
                            <div class="dev1-scope-search-wrap">
                                <i class="fas fa-search dev1-scope-search-icon"></i>
                                <input id="dev1ScopeSearchInput" class="dev1-scope-search-input" type="text" placeholder="${escapeHtml(t('scopeSearchPlaceholder'))}">
                            </div>
                            <div id="dev1ScopeOptionList" class="dev1-scope-option-list">
                                <div class="add-results-empty">${escapeHtml(t('loading'))}</div>
                            </div>
                        </div>
                        <div class="manual-selector-footer dev1-scope-footer">
                            <div class="dev1-scope-footer-left">
                                <span class="manual-selector-count dev1-scope-footer-summary" id="dev1ScopeSelectedSummaryHeader">${escapeHtml(t('reviewSelectedSummary'))} ${escapeHtml(t('reviewCountBookmarks'))} 0 · ${escapeHtml(t('reviewCountFolders'))} 0</span>
                                <span class="dev1-scope-footer-existing" id="dev1ScopeExistingSummary" hidden></span>
                            </div>
                            <div class="dev1-scope-footer-actions">
                                <button id="dev1ScopeClearKindBtn" class="manual-selector-btn manual-selector-btn-clear" type="button">${escapeHtml(t('scopeClearCurrentKind'))}</button>
                                <button id="dev1ScopeDoneBtn" class="manual-selector-btn manual-selector-btn-confirm" type="button">${escapeHtml(t('scopeDone'))}</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div id="dev1ReviewSettingsModal" class="modal dev1-review-settings-overlay" aria-hidden="true">
                    <div class="modal-content dev1-secondary-modal dev1-review-settings-modal">
                        <div class="modal-header compact dev1-secondary-modal-header">
                            <h3>${escapeHtml(t('reviewSettingsTitle'))}</h3>
                            <button id="dev1ReviewSettingsModalClose" class="modal-close" aria-label="${escapeHtml(getLangKey() === 'en' ? 'Close' : '关闭')}">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                        <div class="modal-body dev1-review-settings-body">
                            <div class="dev1-review-settings-note">
                                <div>${escapeHtml(t('reviewSettingsIntro'))}</div>
                                <div class="dev1-review-settings-step-list">
                                    <div>1. ${escapeHtml(t('reviewOpenWindow'))}</div>
                                    <div>2. ${escapeHtml(t('reviewSubmit'))}</div>
                                    <div>3. ${escapeHtml(t('runStartBtn'))}</div>
                                </div>
                            </div>
                            <label class="dev1-review-setting-row" for="dev1ReviewAutoReviewMsInput">
                                <span class="dev1-review-setting-label">
                                    <i class="fas fa-stopwatch"></i>
                                    <span>${escapeHtml(t('reviewAutoReviewMsLabel'))}</span>
                                </span>
                                <span class="dev1-review-setting-input-wrap">
                                    <input id="dev1ReviewAutoReviewMsInput" type="text" inputmode="numeric" pattern="[0-9]*" value="${escapeHtml(String(getReviewAutoReviewMs()))}">
                                    <span>ms</span>
                                </span>
                            </label>
                            <div class="dev1-review-settings-hint">${escapeHtml(t('reviewAutoReviewMsHint'))}</div>
                            <ul class="dev1-review-settings-warning-list">
                                <li id="dev1ReviewAutoReviewHelpText">${escapeHtml(getReviewAutoReviewHelpText())}</li>
                                <li>${escapeHtml(t('queueHelpSubmitWarning'))}</li>
                                <li>${escapeHtml(t('queueHelpWarning'))}</li>
                            </ul>
                        </div>
                        <div class="modal-footer dev1-secondary-modal-footer">
                            <button id="dev1ReviewSettingsCancelBtn" type="button" class="modal-btn">${escapeHtml(t('reviewSettingsCancel'))}</button>
                            <button id="dev1ReviewSettingsSaveBtn" type="button" class="modal-btn primary">${escapeHtml(t('reviewSettingsSave'))}</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    async function renderDev1View(options = {}) {
        const root = getActiveRoot();
        if (!root) return;

        if (!state.initialized) {
            loadSavedReviewAutoReviewMs();
        }
        renderLayout(root);
        bindRootEvents(root);
        renderScopePanelVisibility();
        renderReviewSettingsVisibility();
        updateQueueBatchSizeControlState();
        await refreshCaptureRunState({ silent: true });

        const shouldForceRefresh = options && options.forceRefresh === true;
        if (shouldForceRefresh || state.sourceItems.length === 0) {
            try {
                await refreshSource({ force: shouldForceRefresh });
            } catch (error) {
                setStatus(`${t('sourceError')}: ${error?.message || ''}`, 'error');
                rerenderAllDataPanels();
            }
        } else {
            rerenderAllDataPanels();
        }

        if (getReviewWindowId() != null) {
            ensureReviewEventSyncState();
            const synced = await syncReviewWindowQueue({
                silentStatus: true,
                pruneMissingItems: true
            });
            if (synced) {
                scheduleReviewAutoReviewCheck(getReviewWindowId());
            }
        } else {
            cancelReviewSyncTimers();
        }
        renderReviewWorkflowPanel();
    }

    window.Dev1PageBridge = {
        render: (options = {}) => renderDev1View(options),
        refresh: () => refreshSource({ force: true })
    };

    if (runtimeApi?.runtime?.onMessage && typeof runtimeApi.runtime.onMessage.addListener === 'function') {
        runtimeApi.runtime.onMessage.addListener((message) => {
            handleReviewWindowChangedEvent(message);
        });
    }

    if (runtimeApi?.storage?.onChanged && typeof runtimeApi.storage.onChanged.addListener === 'function') {
        runtimeApi.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local') return;
            const nextEvent = changes?.[DEV1_REVIEW_WINDOW_EVENT_KEY]?.newValue;
            handleReviewWindowChangedEvent(nextEvent);
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (getCurrentViewSafe() === DEV1_VIEW_KEY) {
            renderDev1View().catch(() => { });
        }
    });
})();
