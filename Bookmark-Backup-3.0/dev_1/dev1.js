(function () {
    'use strict';

    if (window.__dev1ExperimentLoaded) return;
    window.__dev1ExperimentLoaded = true;

    const DEV1_VIEW_KEY = 'dev-1';
    const DEV1_STORAGE_KEY = 'dev1_experiment_filters_v1';

    const runtimeApi = (typeof chrome !== 'undefined' && chrome.runtime)
        ? chrome
        : (typeof browser !== 'undefined' ? browser : null);

    const state = {
        sourceItems: [],
        filteredItems: [],
        filterOptions: {
            bookmark: [],
            folder: [],
            domain: [],
            subdomain: []
        },
        filters: {
            bookmark: new Set(),
            folder: new Set(),
            domain: new Set(),
            subdomain: new Set()
        },
        lastRunResult: null,
        captureRunState: null,
        running: false,
        initialized: false
    };

    const i18n = {
        zh_CN: {
            navTitle: '第一维 / dev_1 实验区',
            navDesc: '来源：当前变化（Collection 导出树）→ 四维筛选 → 静默开页抓取 → HTML/MD/MHTML 导出',
            refreshSource: '刷新变化数据',
            runCapture: '执行抓取并导出',
            clearFilters: '清空筛选',
            loading: '正在加载变化数据...',
            noChanges: '当前没有可抓取的变化书签。',
            sourceError: '读取变化数据失败',
            runStart: '开始执行抓取任务...',
            runDone: '抓取任务完成',
            runFailed: '抓取任务失败',
            totalItems: '变化 URL 总数',
            selectedItems: '筛选后待抓取',
            lastRunSummary: '最近执行摘要',
            dimBookmark: '书签',
            dimFolder: '文件夹',
            dimDomain: '域名',
            dimSubdomain: '子域名',
            exportFormats: '导出格式',
            queueTitle: '待抓取队列',
            queueEmpty: '当前筛选条件下没有待抓取 URL',
            resultTitle: '最近一次执行结果',
            resultEmpty: '暂无执行记录',
            rootFolderLabel: '（根目录）',
            rootSubdomainLabel: '（无子域名）',
            fmtHtml: 'HTML',
            fmtMd: 'MD',
            fmtMhtml: 'MHTML',
            runBlockedNoFormat: '请至少选择一种导出格式。',
            runBlockedNoQueue: '当前没有可执行的 URL。',
            colIndex: '#',
            colTitle: '标题',
            colUrl: 'URL',
            colFolder: '文件夹路径',
            colDomain: '域名',
            colSubdomain: '子域名',
            colAction: '变化类型',
            colStatus: '状态',
            colFiles: '导出文件',
            colMessage: '消息',
            statusOk: '成功',
            statusPartial: '部分成功',
            statusFail: '失败',
            recoveryTitle: '后台稳定性状态',
            recoveryNone: '暂无后台运行记录。',
            recoveryRunId: '任务 ID',
            recoveryState: '任务状态',
            recoveryStartedAt: '开始时间',
            recoveryUpdatedAt: '最近更新时间',
            recoveryTargetFolder: '导出目录',
            recoveryPending: '待处理',
            recoveryResume: '恢复未完成任务',
            recoveryRefresh: '刷新后台状态',
            recoveryStatusRunning: '运行中',
            recoveryStatusInterrupted: '已中断',
            recoveryStatusCompleted: '已完成',
            recoveryStatusFailed: '执行失败',
            recoveryStatusUnknown: '未知状态',
            recoveryHintResumable: '检测到可恢复任务：可继续执行未完成项（失败项/未完成项）。',
            recoveryHintNoResume: '当前没有可恢复的未完成任务。',
            recoveryResumeStart: '正在恢复未完成任务...',
            recoveryResumeDone: '恢复任务完成',
            recoveryResumeFailed: '恢复任务失败',
            pdfProbeTitle: 'PDF 探针结论（阶段 1）',
            pdfProbeBody: '当前阶段仅输出 HTML/MD/MHTML。截图拼接 PDF 不接入主流程，后续单独实验并记录成功率/限制。',
            parseError: '变化数据解析失败',
            invalidRuntime: '扩展运行环境不可用',
            unknown: '未知'
        },
        en: {
            navTitle: 'Dimension-1 / dev_1 Lab',
            navDesc: 'Source: current changes (collection payload) -> 4-dim filters -> silent tab capture -> export HTML/MD/MHTML',
            refreshSource: 'Refresh Change Source',
            runCapture: 'Run Capture & Export',
            clearFilters: 'Clear Filters',
            loading: 'Loading current-change payload...',
            noChanges: 'No changed bookmarks are available for capture.',
            sourceError: 'Failed to read current-change payload',
            runStart: 'Capture task started...',
            runDone: 'Capture task finished',
            runFailed: 'Capture task failed',
            totalItems: 'Total Changed URLs',
            selectedItems: 'Filtered Queue Size',
            lastRunSummary: 'Last Run Summary',
            dimBookmark: 'Bookmark',
            dimFolder: 'Folder',
            dimDomain: 'Domain',
            dimSubdomain: 'Subdomain',
            exportFormats: 'Export Formats',
            queueTitle: 'Capture Queue',
            queueEmpty: 'No URL matches the current filter set',
            resultTitle: 'Last Run Result',
            resultEmpty: 'No run yet',
            rootFolderLabel: '(Root)',
            rootSubdomainLabel: '(No subdomain)',
            fmtHtml: 'HTML',
            fmtMd: 'MD',
            fmtMhtml: 'MHTML',
            runBlockedNoFormat: 'Pick at least one export format.',
            runBlockedNoQueue: 'No URLs available to run.',
            colIndex: '#',
            colTitle: 'Title',
            colUrl: 'URL',
            colFolder: 'Folder Path',
            colDomain: 'Domain',
            colSubdomain: 'Subdomain',
            colAction: 'Change Type',
            colStatus: 'Status',
            colFiles: 'Export Files',
            colMessage: 'Message',
            statusOk: 'Success',
            statusPartial: 'Partial',
            statusFail: 'Failed',
            recoveryTitle: 'Backend Stability State',
            recoveryNone: 'No backend run record yet.',
            recoveryRunId: 'Run ID',
            recoveryState: 'Run State',
            recoveryStartedAt: 'Started At',
            recoveryUpdatedAt: 'Updated At',
            recoveryTargetFolder: 'Export Folder',
            recoveryPending: 'Pending',
            recoveryResume: 'Resume Unfinished Run',
            recoveryRefresh: 'Refresh Backend State',
            recoveryStatusRunning: 'Running',
            recoveryStatusInterrupted: 'Interrupted',
            recoveryStatusCompleted: 'Completed',
            recoveryStatusFailed: 'Failed',
            recoveryStatusUnknown: 'Unknown',
            recoveryHintResumable: 'A resumable run was found. You can continue unfinished/failed items.',
            recoveryHintNoResume: 'No unfinished run is available to resume.',
            recoveryResumeStart: 'Resuming unfinished run...',
            recoveryResumeDone: 'Resume finished',
            recoveryResumeFailed: 'Resume failed',
            pdfProbeTitle: 'PDF Probe Conclusion (Phase 1)',
            pdfProbeBody: 'Phase 1 only exports HTML/MD/MHTML. Screenshot-stitched PDF remains a separate experiment with measured limits/success rate.',
            parseError: 'Failed to parse change payload',
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
        if (!statusEl) return;
        statusEl.textContent = String(text || '');
        statusEl.classList.remove('error', 'success', 'warning');
        if (type === 'error') statusEl.classList.add('error');
        if (type === 'success') statusEl.classList.add('success');
        if (type === 'warning') statusEl.classList.add('warning');
    }

    function loadSavedFilters() {
        try {
            const raw = localStorage.getItem(DEV1_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            ['bookmark', 'folder', 'domain', 'subdomain'].forEach((kind) => {
                const list = Array.isArray(parsed?.[kind]) ? parsed[kind] : [];
                state.filters[kind] = new Set(list.map(v => String(v || '')));
            });
        } catch (_) { }
    }

    function persistFilters() {
        try {
            const payload = {
                bookmark: Array.from(state.filters.bookmark),
                folder: Array.from(state.filters.folder),
                domain: Array.from(state.filters.domain),
                subdomain: Array.from(state.filters.subdomain)
            };
            localStorage.setItem(DEV1_STORAGE_KEY, JSON.stringify(payload));
        } catch (_) { }
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

    function extractDomain(hostname) {
        const host = String(hostname || '').trim().toLowerCase();
        if (!host) return '';
        const parts = host.split('.').filter(Boolean);
        if (parts.length <= 2) return host;
        return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
    }

    function parseActionFromTitle(rawTitle) {
        const title = String(rawTitle || '').trim();
        if (/^\[\+\]/.test(title)) return 'added';
        if (/^\[-\]/.test(title)) return 'deleted';
        if (/^\[~\]/.test(title)) return 'modified';
        if (/^\[>>\]/.test(title)) return 'moved';
        return '';
    }

    function stripActionPrefix(rawTitle) {
        return String(rawTitle || '').replace(/^\[(\+|-|~|>>)]\s*/g, '').trim();
    }

    function detectActionGroupByLabel(label) {
        const v = String(label || '').trim().toLowerCase();
        if (!v) return '';
        if (v === '新增' || v === 'added') return 'added';
        if (v === '删除' || v === 'deleted') return 'deleted';
        if (v === '修改' || v === 'modified') return 'modified';
        if (v === '移动' || v === 'moved') return 'moved';
        return '';
    }

    function actionLabelSetToText(actions) {
        if (!(actions instanceof Set) || actions.size === 0) return '';
        const lang = getLangKey();
        const labels = {
            added: lang === 'zh_CN' ? '新增' : 'Added',
            deleted: lang === 'zh_CN' ? '删除' : 'Deleted',
            moved: lang === 'zh_CN' ? '移动' : 'Moved',
            modified: lang === 'zh_CN' ? '修改' : 'Modified'
        };
        return Array.from(actions).map((action) => labels[action] || action).join(' / ');
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

    function getCaptureRunStatusLabel(status) {
        const value = String(status || '').trim().toLowerCase();
        if (value === 'running') return t('recoveryStatusRunning');
        if (value === 'interrupted') return t('recoveryStatusInterrupted');
        if (value === 'completed') return t('recoveryStatusCompleted');
        if (value === 'failed') return t('recoveryStatusFailed');
        return t('recoveryStatusUnknown');
    }

    function renderCaptureRunStatePanel() {
        const wrap = document.getElementById('dev1RecoveryWrap');
        if (!wrap) return;

        const runState = state.captureRunState;
        if (!runState || typeof runState !== 'object') {
            wrap.innerHTML = `<div class="dev1-empty">${escapeHtml(t('recoveryNone'))}</div>`;
            return;
        }

        const summary = runState.summary && typeof runState.summary === 'object' ? runState.summary : {};
        const total = Number(summary.total) || 0;
        const ok = Number(summary.successCount) || 0;
        const partial = Number(summary.partialCount) || 0;
        const fail = Number(summary.failureCount) || 0;
        const pending = Number(summary.pendingCount) || 0;
        const statusLabel = getCaptureRunStatusLabel(runState.status);
        const hint = runState.resumable ? t('recoveryHintResumable') : t('recoveryHintNoResume');

        wrap.innerHTML = `
            <div class="dev1-health-grid">
                <div class="dev1-health-row"><span>${escapeHtml(t('recoveryRunId'))}</span><strong>${escapeHtml(runState.runId || '-')}</strong></div>
                <div class="dev1-health-row"><span>${escapeHtml(t('recoveryState'))}</span><strong>${escapeHtml(statusLabel)}</strong></div>
                <div class="dev1-health-row"><span>${escapeHtml(t('recoveryStartedAt'))}</span><strong>${escapeHtml(formatTimeText(runState.startedAt))}</strong></div>
                <div class="dev1-health-row"><span>${escapeHtml(t('recoveryUpdatedAt'))}</span><strong>${escapeHtml(formatTimeText(runState.updatedAt))}</strong></div>
                <div class="dev1-health-row"><span>${escapeHtml(t('recoveryTargetFolder'))}</span><strong>${escapeHtml(runState.targetFolder || '-')}</strong></div>
                <div class="dev1-health-row"><span>${escapeHtml(t('recoveryPending'))}</span><strong>${escapeHtml(`${pending} / ${total} (${t('statusOk')} ${ok} | ${t('statusPartial')} ${partial} | ${t('statusFail')} ${fail})`)}</strong></div>
            </div>
            <div class="dev1-note">${escapeHtml(hint)}</div>
        `;

        const resumeBtn = document.getElementById('dev1ResumeBtn');
        if (resumeBtn) {
            resumeBtn.disabled = state.running || !runState.resumable || String(runState.status || '').toLowerCase() === 'running';
        }
    }

    async function refreshCaptureRunState({ includeResults = true, silent = false } = {}) {
        try {
            const response = await sendRuntimeMessage({
                action: 'dev1GetCaptureRunState',
                includeResults: includeResults === true
            }, 20000);

            if (!response || response.success !== true) {
                throw new Error(response?.error || t('runFailed'));
            }

            state.captureRunState = response.state && typeof response.state === 'object'
                ? response.state
                : null;

            if (state.captureRunState && Array.isArray(state.captureRunState.results) && state.captureRunState.results.length > 0) {
                state.lastRunResult = {
                    summary: state.captureRunState.summary || {},
                    results: state.captureRunState.results
                };
            }

            renderCaptureRunStatePanel();
            updateCounters();

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

    async function fetchCurrentChangesPayload() {
        const response = await sendRuntimeMessage({
            action: 'buildCurrentChangesManualExport',
            mode: 'collection',
            format: 'json',
            lang: getLangKey()
        }, 30000);

        if (!response || response.success !== true || typeof response.content !== 'string') {
            throw new Error(response?.error || t('sourceError'));
        }

        try {
            return JSON.parse(response.content);
        } catch (_) {
            throw new Error(t('parseError'));
        }
    }

    function buildSourceItemsFromPayload(payload) {
        const rootNodes = Array.isArray(payload?.children) ? payload.children : [];
        const byUrl = new Map();

        function upsertItem(rawItem) {
            const key = rawItem.url;
            const existing = byUrl.get(key);
            if (!existing) {
                byUrl.set(key, rawItem);
                return;
            }

            if (!existing.title && rawItem.title) existing.title = rawItem.title;
            if (!existing.folderPath && rawItem.folderPath) existing.folderPath = rawItem.folderPath;
            if (!existing.folderFilterKey && rawItem.folderFilterKey) existing.folderFilterKey = rawItem.folderFilterKey;
            if (!existing.folderFilterLabel && rawItem.folderFilterLabel) existing.folderFilterLabel = rawItem.folderFilterLabel;
            if (rawItem.action) existing.actions.add(rawItem.action);
            if (rawItem.actionText) existing.actionTexts.add(rawItem.actionText);
        }

        function walk(nodes, pathSegments, actionHint) {
            if (!Array.isArray(nodes)) return;

            nodes.forEach((node) => {
                if (!node || typeof node !== 'object') return;

                const rawTitle = String(node.title || '').trim();
                const cleanedTitle = stripActionPrefix(rawTitle);
                const actionFromPrefix = parseActionFromTitle(rawTitle);
                const actionGroup = detectActionGroupByLabel(cleanedTitle);
                const nextAction = actionFromPrefix || actionGroup || actionHint || '';
                const hasChildren = Array.isArray(node.children) && node.children.length > 0;
                const rawUrl = String(node.url || '').trim();
                const isMetaUrl = !rawUrl || rawUrl === 'about:blank';

                let nextPathSegments = pathSegments;
                if (hasChildren && !actionGroup && cleanedTitle && !isMetaUrl) {
                    nextPathSegments = pathSegments.concat([cleanedTitle]);
                } else if (hasChildren && !actionGroup && cleanedTitle && isMetaUrl) {
                    const isLegend = /前缀说明|prefix\s+legend|操作统计|operation\s+counts|导出时间|export\s+time/i.test(cleanedTitle);
                    if (!isLegend) {
                        nextPathSegments = pathSegments.concat([cleanedTitle]);
                    }
                }

                if (rawUrl && rawUrl !== 'about:blank') {
                    const parsed = normalizeUrl(rawUrl);
                    if (parsed) {
                        const host = String(parsed.hostname || '').toLowerCase();
                        const domain = extractDomain(host);
                        const subdomainPart = (host && domain && host !== domain)
                            ? host.slice(0, -1 * (domain.length + 1))
                            : '';
                        const subdomainValue = subdomainPart ? host : '__root__';

                        const actionSet = new Set();
                        if (nextAction) actionSet.add(nextAction);

                        const item = {
                            url: parsed.toString(),
                            title: cleanedTitle || parsed.toString(),
                            folderPath: nextPathSegments.join(' / '),
                            folderFilterKey: nextPathSegments.join(' / ') || '__root__',
                            folderFilterLabel: nextPathSegments.join(' / ') || t('rootFolderLabel'),
                            domain: domain || host || '',
                            subdomain: subdomainValue,
                            subdomainLabel: subdomainPart ? host : t('rootSubdomainLabel'),
                            actions: actionSet,
                            actionTexts: new Set(actionSet.size > 0 ? [actionLabelSetToText(actionSet)] : []),
                            host,
                            sourceTitle: rawTitle
                        };

                        upsertItem(item);
                    }
                }

                if (hasChildren) {
                    walk(node.children, nextPathSegments, nextAction);
                }
            });
        }

        walk(rootNodes, [], '');

        const items = Array.from(byUrl.values()).map((item) => {
            const normalizedActionText = actionLabelSetToText(item.actions);
            return {
                url: item.url,
                title: item.title,
                folderPath: item.folderPath,
                folderFilterKey: item.folderFilterKey || '__root__',
                folderFilterLabel: item.folderFilterLabel || t('rootFolderLabel'),
                domain: item.domain,
                subdomain: item.subdomain,
                subdomainLabel: item.subdomainLabel,
                actionText: normalizedActionText,
                host: item.host
            };
        });

        items.sort((a, b) => {
            const ta = String(a.title || '').toLowerCase();
            const tb = String(b.title || '').toLowerCase();
            if (ta < tb) return -1;
            if (ta > tb) return 1;
            return String(a.url || '').localeCompare(String(b.url || ''));
        });

        return items;
    }

    function buildFilterOptions(items) {
        const bookmark = items.map((item) => ({
            key: item.url,
            label: `${item.title} (${item.host || item.domain || item.url})`,
            count: 1
        }));

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

    function pruneFiltersAgainstOptions() {
        ['bookmark', 'folder', 'domain', 'subdomain'].forEach((kind) => {
            const allowed = new Set((state.filterOptions[kind] || []).map(opt => opt.key));
            const next = new Set();
            state.filters[kind].forEach((value) => {
                if (allowed.has(value)) next.add(value);
            });
            state.filters[kind] = next;
        });
    }

    function applyFilters() {
        const hasBookmark = state.filters.bookmark.size > 0;
        const hasFolder = state.filters.folder.size > 0;
        const hasDomain = state.filters.domain.size > 0;
        const hasSubdomain = state.filters.subdomain.size > 0;

        state.filteredItems = state.sourceItems.filter((item) => {
            if (hasBookmark && !state.filters.bookmark.has(item.url)) return false;
            if (hasFolder && !state.filters.folder.has(item.folderFilterKey || '__root__')) return false;
            if (hasDomain && !state.filters.domain.has(item.domain)) return false;
            if (hasSubdomain && !state.filters.subdomain.has(item.subdomain || '__root__')) return false;
            return true;
        });
    }

    function renderFilterList(kind, targetId) {
        const target = document.getElementById(targetId);
        if (!target) return;

        const options = state.filterOptions[kind] || [];
        if (options.length === 0) {
            target.innerHTML = `<div class="dev1-empty">${escapeHtml(t('noChanges'))}</div>`;
            return;
        }

        target.innerHTML = options.map((opt) => {
            const checked = state.filters[kind].has(opt.key) ? 'checked' : '';
            return `
                <label class="dev1-filter-row">
                    <input type="checkbox" class="dev1-filter-checkbox" data-kind="${escapeHtml(kind)}" data-key="${escapeHtml(opt.key)}" ${checked}>
                    <span>${escapeHtml(opt.label)} <span style="color: var(--text-tertiary);">(${opt.count})</span></span>
                </label>
            `;
        }).join('');
    }

    function renderQueueTable() {
        const wrap = document.getElementById('dev1QueueWrap');
        if (!wrap) return;

        if (!Array.isArray(state.filteredItems) || state.filteredItems.length === 0) {
            wrap.innerHTML = `<div class="dev1-empty">${escapeHtml(t('queueEmpty'))}</div>`;
            return;
        }

        const rows = state.filteredItems.map((item, index) => {
            return `
                <tr>
                    <td>${index + 1}</td>
                    <td>${escapeHtml(item.title || t('unknown'))}</td>
                    <td><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.url)}</a></td>
                    <td>${escapeHtml(item.folderPath || '-')}</td>
                    <td>${escapeHtml(item.domain || '-')}</td>
                    <td>${escapeHtml(item.subdomainLabel || '-')}</td>
                    <td>${escapeHtml(item.actionText || '-')}</td>
                </tr>
            `;
        }).join('');

        wrap.innerHTML = `
            <table class="dev1-table">
                <thead>
                    <tr>
                        <th>${escapeHtml(t('colIndex'))}</th>
                        <th>${escapeHtml(t('colTitle'))}</th>
                        <th>${escapeHtml(t('colUrl'))}</th>
                        <th>${escapeHtml(t('colFolder'))}</th>
                        <th>${escapeHtml(t('colDomain'))}</th>
                        <th>${escapeHtml(t('colSubdomain'))}</th>
                        <th>${escapeHtml(t('colAction'))}</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;
    }

    function renderLastRunResult() {
        const wrap = document.getElementById('dev1ResultWrap');
        if (!wrap) return;

        const result = state.lastRunResult;
        if (!result || !Array.isArray(result.results) || result.results.length === 0) {
            wrap.innerHTML = `<div class="dev1-empty">${escapeHtml(t('resultEmpty'))}</div>`;
            return;
        }

        const rows = result.results.map((item, index) => {
            const status = String(item.status || '').toLowerCase();
            const files = Array.isArray(item.files) ? item.files : [];
            const errors = Array.isArray(item.errors) ? item.errors : [];
            const filesText = files.length ? files.join('\n') : '-';
            const message = errors.length ? errors.join(' | ') : '-';
            const pillClass = status === 'success'
                ? 'success'
                : (status === 'partial' ? 'warning' : 'error');
            const pillLabel = status === 'success'
                ? t('statusOk')
                : (status === 'partial' ? t('statusPartial') : t('statusFail'));
            return `
                <tr>
                    <td>${index + 1}</td>
                    <td>${escapeHtml(item.title || item.url || '')}</td>
                    <td>${escapeHtml(item.url || '')}</td>
                    <td><span class="dev1-pill ${pillClass}">${escapeHtml(pillLabel)}</span></td>
                    <td style="white-space: pre-wrap;">${escapeHtml(filesText)}</td>
                    <td>${escapeHtml(message)}</td>
                </tr>
            `;
        }).join('');

        wrap.innerHTML = `
            <table class="dev1-table">
                <thead>
                    <tr>
                        <th>${escapeHtml(t('colIndex'))}</th>
                        <th>${escapeHtml(t('colTitle'))}</th>
                        <th>${escapeHtml(t('colUrl'))}</th>
                        <th>${escapeHtml(t('colStatus'))}</th>
                        <th>${escapeHtml(t('colFiles'))}</th>
                        <th>${escapeHtml(t('colMessage'))}</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;
    }

    function updateCounters() {
        const totalEl = document.getElementById('dev1TotalValue');
        if (totalEl) totalEl.textContent = String(state.sourceItems.length);
        const selectedEl = document.getElementById('dev1SelectedValue');
        if (selectedEl) selectedEl.textContent = String(state.filteredItems.length);

        const summaryEl = document.getElementById('dev1LastRunSummary');
        if (summaryEl) {
            if (!state.lastRunResult) {
                summaryEl.textContent = '-';
            } else {
                const summary = state.lastRunResult.summary || {};
                summaryEl.textContent = `${t('statusOk')}: ${summary.successCount || 0}, ${t('statusPartial')}: ${summary.partialCount || 0}, ${t('statusFail')}: ${summary.failureCount || 0}`;
            }
        }
    }

    function rerenderFilterPanels() {
        renderFilterList('bookmark', 'dev1BookmarkList');
        renderFilterList('folder', 'dev1FolderList');
        renderFilterList('domain', 'dev1DomainList');
        renderFilterList('subdomain', 'dev1SubdomainList');
    }

    function rerenderAllDataPanels() {
        rerenderFilterPanels();
        renderCaptureRunStatePanel();
        renderQueueTable();
        renderLastRunResult();
        updateCounters();
    }

    function bindRootEvents(root) {
        if (!root || root.dataset.bound === 'true') return;
        root.dataset.bound = 'true';

        const refreshBtn = root.querySelector('#dev1RefreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                refreshSource({ force: true }).catch((error) => {
                    setStatus(error?.message || t('sourceError'), 'error');
                });
            });
        }

        const runBtn = root.querySelector('#dev1RunBtn');
        if (runBtn) {
            runBtn.addEventListener('click', () => {
                runCaptureTask().catch((error) => {
                    setStatus(error?.message || t('runFailed'), 'error');
                });
            });
        }

        const clearBtn = root.querySelector('#dev1ClearFiltersBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                ['bookmark', 'folder', 'domain', 'subdomain'].forEach((kind) => {
                    state.filters[kind].clear();
                });
                persistFilters();
                applyFilters();
                rerenderAllDataPanels();
                setStatus('');
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
                refreshCaptureRunState({ includeResults: true }).catch((error) => {
                    setStatus(error?.message || t('runFailed'), 'error');
                });
            });
        }

        root.addEventListener('change', (event) => {
            const target = event.target;
            if (!target || !(target instanceof HTMLInputElement)) return;

            if (target.classList.contains('dev1-filter-checkbox')) {
                const kind = String(target.dataset.kind || '').trim();
                const key = String(target.dataset.key || '');
                if (!state.filters[kind]) return;

                if (target.checked) {
                    state.filters[kind].add(key);
                } else {
                    state.filters[kind].delete(key);
                }

                persistFilters();
                applyFilters();
                renderQueueTable();
                updateCounters();
            }
        });
    }

    function getSelectedFormats() {
        const html = document.getElementById('dev1FmtHtml');
        const md = document.getElementById('dev1FmtMd');
        const mhtml = document.getElementById('dev1FmtMhtml');
        return {
            html: !!(html && html.checked),
            md: !!(md && md.checked),
            mhtml: !!(mhtml && mhtml.checked)
        };
    }

    function setRunControlsDisabled(disabled) {
        const runBtn = document.getElementById('dev1RunBtn');
        const refreshBtn = document.getElementById('dev1RefreshBtn');
        const clearBtn = document.getElementById('dev1ClearFiltersBtn');
        const resumeBtn = document.getElementById('dev1ResumeBtn');
        const refreshRunStateBtn = document.getElementById('dev1RefreshRunStateBtn');
        if (runBtn) runBtn.disabled = !!disabled;
        if (refreshBtn) refreshBtn.disabled = !!disabled;
        if (clearBtn) clearBtn.disabled = !!disabled;
        if (resumeBtn) resumeBtn.disabled = !!disabled || !(state.captureRunState && state.captureRunState.resumable);
        if (refreshRunStateBtn) refreshRunStateBtn.disabled = !!disabled;
    }

    async function runCaptureTask() {
        if (state.running) return;

        const formats = getSelectedFormats();
        if (!formats.html && !formats.md && !formats.mhtml) {
            setStatus(t('runBlockedNoFormat'), 'error');
            return;
        }

        if (!Array.isArray(state.filteredItems) || state.filteredItems.length === 0) {
            setStatus(t('runBlockedNoQueue'), 'error');
            return;
        }

        state.running = true;
        setRunControlsDisabled(true);
        setStatus(t('runStart'));

        try {
            const items = state.filteredItems.map((item, index) => ({
                index,
                title: item.title,
                url: item.url,
                folderPath: item.folderPath,
                domain: item.domain,
                subdomain: item.subdomain,
                actionText: item.actionText
            }));

            const response = await sendRuntimeMessage({
                action: 'dev1CaptureAndExportUrls',
                lang: getLangKey(),
                items,
                formats,
                options: {
                    closeTabAfterCapture: true,
                    renderWaitMs: 1300
                }
            }, Math.max(180000, items.length * 30000));

            if (!response || response.success !== true) {
                throw new Error(response?.error || t('runFailed'));
            }

            state.lastRunResult = {
                summary: response.summary || {},
                results: Array.isArray(response.results) ? response.results : []
            };

            await refreshCaptureRunState({ includeResults: true, silent: true });
            rerenderAllDataPanels();
            setStatus(`${t('runDone')} (${t('statusOk')}: ${response.summary?.successCount || 0}, ${t('statusPartial')}: ${response.summary?.partialCount || 0}, ${t('statusFail')}: ${response.summary?.failureCount || 0})`, 'success');
        } catch (error) {
            setStatus(`${t('runFailed')}: ${error?.message || ''}`, 'error');
            await refreshCaptureRunState({ includeResults: true, silent: true });
        } finally {
            state.running = false;
            setRunControlsDisabled(false);
        }
    }

    async function resumeCaptureTask() {
        if (state.running) return;

        const formats = getSelectedFormats();
        state.running = true;
        setRunControlsDisabled(true);
        setStatus(t('recoveryResumeStart'));

        try {
            const response = await sendRuntimeMessage({
                action: 'dev1ResumeCaptureRun',
                lang: getLangKey(),
                formats,
                options: {
                    closeTabAfterCapture: true,
                    renderWaitMs: 1300,
                    maxRetries: 1
                }
            }, Math.max(180000, state.filteredItems.length * 30000));

            if (!response || response.success !== true) {
                throw new Error(response?.error || t('recoveryResumeFailed'));
            }

            state.lastRunResult = {
                summary: response.summary || {},
                results: Array.isArray(response.results) ? response.results : []
            };

            await refreshCaptureRunState({ includeResults: true, silent: true });
            rerenderAllDataPanels();
            setStatus(`${t('recoveryResumeDone')} (${t('statusOk')}: ${response.summary?.successCount || 0}, ${t('statusPartial')}: ${response.summary?.partialCount || 0}, ${t('statusFail')}: ${response.summary?.failureCount || 0})`, 'success');
        } catch (error) {
            setStatus(`${t('recoveryResumeFailed')}: ${error?.message || ''}`, 'error');
            await refreshCaptureRunState({ includeResults: true, silent: true });
        } finally {
            state.running = false;
            setRunControlsDisabled(false);
        }
    }

    async function refreshSource({ force = false } = {}) {
        if (state.running) return;

        setStatus(t('loading'));
        if (!state.initialized) {
            loadSavedFilters();
            state.initialized = true;
        }

        const payload = await fetchCurrentChangesPayload();
        state.sourceItems = buildSourceItemsFromPayload(payload);
        state.filterOptions = buildFilterOptions(state.sourceItems);
        pruneFiltersAgainstOptions();
        persistFilters();
        applyFilters();
        rerenderAllDataPanels();

        if (state.sourceItems.length === 0) {
            setStatus(t('noChanges'));
        } else {
            setStatus('');
        }
    }

    function renderLayout(root) {
        if (!root) return;

        root.innerHTML = `
            <div class="dev1-root">
                <section class="dev1-card">
                    <h2 class="dev1-card-title">${escapeHtml(t('navTitle'))}</h2>
                    <p class="dev1-card-subtitle">${escapeHtml(t('navDesc'))}</p>
                    <div class="dev1-toolbar" style="margin-top: 12px;">
                        <button id="dev1RefreshBtn" class="action-btn compact">
                            <i class="fas fa-sync-alt"></i>
                            <span style="margin-left: 6px;">${escapeHtml(t('refreshSource'))}</span>
                        </button>
                        <button id="dev1RunBtn" class="action-btn compact primary">
                            <i class="fas fa-play"></i>
                            <span style="margin-left: 6px;">${escapeHtml(t('runCapture'))}</span>
                        </button>
                        <button id="dev1ClearFiltersBtn" class="action-btn compact">
                            <i class="fas fa-filter"></i>
                            <span style="margin-left: 6px;">${escapeHtml(t('clearFilters'))}</span>
                        </button>
                    </div>
                    <div id="dev1Status" class="dev1-status" style="margin-top: 10px;"></div>
                    <div class="dev1-kv" style="margin-top: 10px;">
                        <span><strong id="dev1TotalValue">0</strong> ${escapeHtml(t('totalItems'))}</span>
                        <span><strong id="dev1SelectedValue">0</strong> ${escapeHtml(t('selectedItems'))}</span>
                        <span>${escapeHtml(t('lastRunSummary'))}: <strong id="dev1LastRunSummary">-</strong></span>
                    </div>
                </section>

                <section class="dev1-card">
                    <h3 class="dev1-card-title">${escapeHtml(t('exportFormats'))}</h3>
                    <div class="dev1-format-row">
                        <label><input type="checkbox" id="dev1FmtHtml" checked> ${escapeHtml(t('fmtHtml'))}</label>
                        <label><input type="checkbox" id="dev1FmtMd" checked> ${escapeHtml(t('fmtMd'))}</label>
                        <label><input type="checkbox" id="dev1FmtMhtml" checked> ${escapeHtml(t('fmtMhtml'))}</label>
                    </div>
                    <div class="dev1-note">${escapeHtml(t('pdfProbeBody'))}</div>
                </section>

                <section class="dev1-card">
                    <h3 class="dev1-card-title">${escapeHtml(t('recoveryTitle'))}</h3>
                    <div id="dev1RecoveryWrap"></div>
                    <div class="dev1-toolbar" style="margin-top: 10px;">
                        <button id="dev1ResumeBtn" class="action-btn compact">
                            <i class="fas fa-play-circle"></i>
                            <span style="margin-left: 6px;">${escapeHtml(t('recoveryResume'))}</span>
                        </button>
                        <button id="dev1RefreshRunStateBtn" class="action-btn compact">
                            <i class="fas fa-redo"></i>
                            <span style="margin-left: 6px;">${escapeHtml(t('recoveryRefresh'))}</span>
                        </button>
                    </div>
                </section>

                <section class="dev1-card">
                    <h3 class="dev1-card-title">${escapeHtml(t('dimBookmark'))} / ${escapeHtml(t('dimFolder'))} / ${escapeHtml(t('dimDomain'))} / ${escapeHtml(t('dimSubdomain'))}</h3>
                    <div class="dev1-grid">
                        <div class="dev1-filter-box">
                            <div class="dev1-filter-header">${escapeHtml(t('dimBookmark'))}</div>
                            <div id="dev1BookmarkList" class="dev1-filter-list"></div>
                        </div>
                        <div class="dev1-filter-box">
                            <div class="dev1-filter-header">${escapeHtml(t('dimFolder'))}</div>
                            <div id="dev1FolderList" class="dev1-filter-list"></div>
                        </div>
                        <div class="dev1-filter-box">
                            <div class="dev1-filter-header">${escapeHtml(t('dimDomain'))}</div>
                            <div id="dev1DomainList" class="dev1-filter-list"></div>
                        </div>
                        <div class="dev1-filter-box">
                            <div class="dev1-filter-header">${escapeHtml(t('dimSubdomain'))}</div>
                            <div id="dev1SubdomainList" class="dev1-filter-list"></div>
                        </div>
                    </div>
                </section>

                <section class="dev1-card">
                    <h3 class="dev1-card-title">${escapeHtml(t('queueTitle'))}</h3>
                    <div id="dev1QueueWrap" class="dev1-table-wrap"></div>
                </section>

                <section class="dev1-card">
                    <h3 class="dev1-card-title">${escapeHtml(t('resultTitle'))}</h3>
                    <div id="dev1ResultWrap" class="dev1-table-wrap"></div>
                </section>

                <section class="dev1-card">
                    <h3 class="dev1-card-title">${escapeHtml(t('pdfProbeTitle'))}</h3>
                    <p class="dev1-card-subtitle">${escapeHtml(t('pdfProbeBody'))}</p>
                </section>
            </div>
        `;
    }

    async function renderDev1View(options = {}) {
        const root = getActiveRoot();
        if (!root) return;

        renderLayout(root);
        bindRootEvents(root);
        await refreshCaptureRunState({ includeResults: true, silent: true });

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
    }

    window.Dev1PageBridge = {
        render: (options = {}) => renderDev1View(options),
        refresh: () => refreshSource({ force: true })
    };

    document.addEventListener('DOMContentLoaded', () => {
        if (getCurrentViewSafe() === DEV1_VIEW_KEY) {
            renderDev1View().catch(() => { });
        }
    });
})();
