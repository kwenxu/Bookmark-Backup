// =============================================================================
// 模块导入 (Module Imports)
// =============================================================================

console.log('🔵 [popup.js] 开始加载...');

import {
    createAutoBackupTimerUI,
    initializeUIEvents as initializeAutoBackupTimerUIEvents,
    loadAutoBackupSettings,
    applyLanguageToUI as applyAutoBackupTimerLanguage
} from './auto_backup_timer/index.js';

console.log('🟢 [popup.js] 模块导入成功!', { createAutoBackupTimerUI, initializeAutoBackupTimerUIEvents, loadAutoBackupSettings });

// =============================================================================
// 全局状态变量和常量 (Global State Variables and Constants)
// =============================================================================

let webDAVConfigPanelOpen = false;
let githubRepoConfigPanelOpen = false;
let localConfigPanelOpen = false;

let isBackgroundConnected = false;
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 3;

// 国际化文本对象（全局定义，在 applyLocalizedContent 中初始化）
let webdavConfigMissingStrings, webdavConfigSavedStrings, webdavBackupEnabledStrings, webdavBackupDisabledStrings;
let testingWebdavConnectionStrings, webdavConnectionTestSuccessStrings, webdavConnectionTestFailedStrings;
let webdavPasswordTrimmedStrings;
let githubRepoConfigMissingStrings, githubRepoConfigSavedStrings, githubRepoBackupEnabledStrings, githubRepoBackupDisabledStrings;
let testingGithubRepoConnectionStrings, githubRepoConnectionTestSuccessStrings, githubRepoConnectionTestFailedStrings;
let githubRepoTokenTrimmedStrings;
let localBackupEnabledStrings, localBackupDisabledStrings, hideDownloadBarEnabledStrings, hideDownloadBarDisabledStrings;
let downloadPathCalibratedStrings, downloadSettingsAddressCopiedStrings;
let autoBackupEnabledStrings, autoBackupDisabledStrings, detectedChangesBackingUpStrings;
let backupSwitchSuccessStrings, backupSwitchFailedStrings, autoBackupToggleFailedStrings;
let startInitUploadStrings, initUploadSuccessStrings, successToCloudAndLocalStrings;
let successToCloudStrings, successToLocalStrings, initUploadFailedStrings;
let startManualUploadStrings, manualUploadSuccessStrings, backupToCloudAndLocalStrings;
let backupToCloudStrings, backupToLocalStrings, manualUploadFailedStrings;
let restoringToDefaultStrings, restoredToDefaultStrings, restoreFailedStrings;
let getSyncHistoryFailedStrings, noHistoryToExportStrings, historyExportedStrings;
let exportHistoryFailedStrings, historyExportErrorStrings, historyClearedStrings;
let clearHistoryFailedStrings, unknownErrorStrings;

let webdavDraftSaveTimer = null;
const WEBDAV_DRAFT_KEYS = {
    serverAddress: 'webdavDraftServerAddress',
    username: 'webdavDraftUsername',
    password: 'webdavDraftPassword'
};

const WEBDAV_UI_STATE_KEYS = {
    panelOpen: 'webdavConfigPanelOpen'
};

let githubRepoDraftSaveTimer = null;
const GITHUB_REPO_DRAFT_KEYS = {
    owner: 'githubRepoDraftOwner',
    name: 'githubRepoDraftName',
    branch: 'githubRepoDraftBranch',
    basePath: 'githubRepoDraftBasePath',
    token: 'githubRepoDraftToken'
};

const GITHUB_REPO_UI_STATE_KEYS = {
    panelOpen: 'githubRepoConfigPanelOpen'
};

let openSourceInfoTitleStrings, openSourceAuthorInfoStrings, openSourceDescriptionStrings;
let openSourceGithubLabelStrings, openSourceIssueLabelStrings, openSourceIssueTextStrings, openSourceCloseBtnStrings;

let initialBackupFileStrings, backupTypeStrings, timeStrings, localBackupTypeStrings, cloudBackupTypeStrings;

// 连接到后台脚本
let backgroundPort = null;
let popupHistoryRefreshTimer = null;
let initLayoutResizeObserver = null;
let initLayoutResizeRafId = 0;


// =============================================================================
// 辅助函数 (Helper Functions)
// =============================================================================

/**
 * 格式化时间显示的辅助函数。
 * @param {Date} date - 要格式化的日期对象。
 * @returns {string} 格式化后的时间字符串。
 */
function formatTime(date) {
    try {
        // 更美观的日期格式: YYYY/MM/DD HH:MM:SS
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');

        return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
    } catch (error) {
        return '未知时间';
    }
}

/**
 * 状态显示函数，用于在UI上显示临时消息。
 * @param {string} message - 要显示的消息。
 * @param {string} [type='info'] - 消息类型 ('info', 'success', 'error')。
 * @param {number} [duration=3000] - 消息显示时长（毫秒）。
 */
function showStatus(message, type = 'info', duration = 3000) {
    const statusDiv = document.getElementById('status');
    if (!statusDiv) {
        return;
    }

    // 获取当前语言
    chrome.storage.local.get(['preferredLang'], function (result) {
        const currentLang = result.preferredLang || 'zh_CN';

        // 消息映射表 - 将中文消息映射到消息键
        const messageMap = {
            // WebDAV配置相关
            '请填写完整的WebDAV配置信息': 'webdavConfigMissing',
            'WebDAV配置已保存，备份已启用': 'webdavConfigSaved',
            '正在测试WebDAV连接...': 'testingWebdavConnection',
            'WebDAV连接测试成功': 'webdavConnectionTestSuccess',
            '已自动去除密码首尾空格/换行': 'webdavPasswordTrimmed',

            // GitHub Repository 配置相关
            '请填写完整的GitHub仓库配置信息': 'githubRepoConfigMissing',
            'GitHub仓库配置已保存，备份已启用': 'githubRepoConfigSaved',
            '正在测试GitHub仓库连接...': 'testingGithubRepoConnection',
            'GitHub仓库连接测试成功': 'githubRepoConnectionTestSuccess',
            '已自动去除Token首尾空格/换行': 'githubRepoTokenTrimmed',

            // 本地配置相关
            '下载路径已校准': 'downloadPathCalibrated',
            '设置地址已复制到剪贴板': 'downloadSettingsAddressCopied',

            // 备份状态相关
            '检测到修改，正在为您备份...': 'detectedChangesBackingUp',
            '切换备份成功！': 'backupSwitchSuccess',

            // 自动备份相关
            '已启用自动备份': 'autoBackupEnabled',
            '已禁用自动备份': 'autoBackupDisabled',

            // 初始化和上传相关
            '开始初始化上传...': 'startInitUpload',
            '初始化上传成功！': 'initUploadSuccess',
            '成功初始化到云端和本地！': 'successToCloudAndLocal',
            '成功初始化到云端！': 'successToCloud',
            '成功初始化到本地！': 'successToLocal',
            '开始手动上传...': 'startManualUpload',
            '手动上传成功！': 'manualUploadSuccess',
            '成功备份到云端和本地！': 'backupToCloudAndLocal',
            '成功备份到云端！': 'successToCloud', // 这里应是 backupToCloudStrings
            '成功备份到本地！': 'backupToLocal', // 这里应是 backupToLocalStrings

            // 重置相关
            '正在恢复初始状态...': 'restoringToDefault',
            '已恢复到初始状态': 'restoredToDefault',

            // 历史记录相关
            '获取备份历史记录失败': 'getSyncHistoryFailed',
            '没有历史记录可导出': 'noHistoryToExport',
            '历史记录已导出': 'historyExported',
            '导出历史记录失败': 'exportHistoryFailed',
            '历史记录已清空': 'historyCleared',
            '清空历史记录失败': 'clearHistoryFailed',

            // 其他
            '未知错误': 'unknownError'
        };

        // 前缀映射表 - 用于处理动态消息
        const prefixMap = {
            '切换备份失败:': 'backupSwitchFailed',
            '切换自动备份失败': 'autoBackupToggleFailed',
            '初始化上传失败:': 'initUploadFailed',
            '手动上传失败:': 'manualUploadFailed',
            '恢复失败:': 'restoreFailed',
            '导出历史记录失败:': 'historyExportError',
            'WebDAV连接测试失败:': 'webdavConnectionTestFailed',
            'GitHub仓库连接测试失败:': 'githubRepoConnectionTestFailed'
        };

        // 特殊模式匹配 - 用于根据模式决定使用哪个消息键
        const patternMap = [
            {
                pattern: /本地备份已(启用|禁用)/,
                getKey: (m) => m.includes('启用') ? 'localBackupEnabled' : 'localBackupDisabled'
            },
            {
                pattern: /备份时(将|不再)隐藏下载栏/,
                getKey: (m) => m.includes('将') ? 'hideDownloadBarEnabled' : 'hideDownloadBarDisabled'
            },
            {
                pattern: /WebDAV备份已(启用|禁用)/,
                getKey: (m) => m.includes('启用') ? 'webdavBackupEnabled' : 'webdavBackupDisabled'
            },
            {
                pattern: /GitHub仓库备份已(启用|禁用)/,
                getKey: (m) => m.includes('启用') ? 'githubRepoBackupEnabled' : 'githubRepoBackupDisabled'
            },
            {
                pattern: /自动备份已(启用|禁用)/,
                getKey: (m) => m.includes('启用') ? 'autoBackupEnabled' : 'autoBackupDisabled'
            }
        ];

        // 将字符串映射对象定义移到更高作用域
        const stringMap = {
            'webdavConfigMissing': webdavConfigMissingStrings,
            'webdavConfigSaved': webdavConfigSavedStrings,
            'webdavBackupEnabled': webdavBackupEnabledStrings,
            'webdavBackupDisabled': webdavBackupDisabledStrings,
            'testingWebdavConnection': testingWebdavConnectionStrings,
            'webdavConnectionTestSuccess': webdavConnectionTestSuccessStrings,
            'webdavConnectionTestFailed': webdavConnectionTestFailedStrings,
            'webdavPasswordTrimmed': webdavPasswordTrimmedStrings,
            'githubRepoConfigMissing': githubRepoConfigMissingStrings,
            'githubRepoConfigSaved': githubRepoConfigSavedStrings,
            'githubRepoBackupEnabled': githubRepoBackupEnabledStrings,
            'githubRepoBackupDisabled': githubRepoBackupDisabledStrings,
            'testingGithubRepoConnection': testingGithubRepoConnectionStrings,
            'githubRepoConnectionTestSuccess': githubRepoConnectionTestSuccessStrings,
            'githubRepoConnectionTestFailed': githubRepoConnectionTestFailedStrings,
            'githubRepoTokenTrimmed': githubRepoTokenTrimmedStrings,
            'localBackupEnabled': localBackupEnabledStrings,
            'localBackupDisabled': localBackupDisabledStrings,
            'hideDownloadBarEnabled': hideDownloadBarEnabledStrings,
            'hideDownloadBarDisabled': hideDownloadBarDisabledStrings,
            'downloadPathCalibrated': downloadPathCalibratedStrings,
            'downloadSettingsAddressCopied': downloadSettingsAddressCopiedStrings,
            'autoBackupEnabled': autoBackupEnabledStrings,
            'autoBackupDisabled': autoBackupDisabledStrings,
            'detectedChangesBackingUp': detectedChangesBackingUpStrings,
            'backupSwitchSuccess': backupSwitchSuccessStrings,
            'backupSwitchFailed': backupSwitchFailedStrings,
            'autoBackupToggleFailed': autoBackupToggleFailedStrings,
            'startInitUpload': startInitUploadStrings,
            'initUploadSuccess': initUploadSuccessStrings,
            'successToCloudAndLocal': successToCloudAndLocalStrings,
            'successToCloud': successToCloudStrings,
            'successToLocal': successToLocalStrings,
            'initUploadFailed': initUploadFailedStrings,
            'startManualUpload': startManualUploadStrings,
            'manualUploadSuccess': manualUploadSuccessStrings,
            'backupToCloudAndLocal': backupToCloudAndLocalStrings,
            'backupToCloud': backupToCloudStrings, // Corrected reference
            'backupToLocal': backupToLocalStrings, // Corrected reference
            'manualUploadFailed': manualUploadFailedStrings,
            'restoringToDefault': restoringToDefaultStrings,
            'restoredToDefault': restoredToDefaultStrings,
            'restoreFailed': restoreFailedStrings,
            'getSyncHistoryFailed': getSyncHistoryFailedStrings,
            'noHistoryToExport': noHistoryToExportStrings,
            'historyExported': historyExportedStrings,
            'exportHistoryFailed': exportHistoryFailedStrings,
            'historyExportError': historyExportErrorStrings,
            'historyCleared': historyClearedStrings,
            'clearHistoryFailed': clearHistoryFailedStrings,
            'unknownError': unknownErrorStrings
        };

        // 确定本地化消息
        let localizedMessage = message;

        if (typeof message === 'string') {
            // 1. 首先检查完全匹配
            if (messageMap[message]) {
                // 使用内存中的字符串映射
                const key = messageMap[message];
                // 回退到内存中的字符串映射
                const stringObj = stringMap[key];
                if (stringObj) {
                    localizedMessage = stringObj[currentLang] || stringObj['zh_CN'];
                }
            }
            // 2. 检查前缀匹配
            else {
                let matched = false;
                for (const [prefix, key] of Object.entries(prefixMap)) {
                    if (message.startsWith(prefix)) {
                        const errorPart = message.substring(prefix.length);
                        // 回退到内存中的字符串映射
                        const stringObj = stringMap[key];
                        let translatedPrefix = prefix;
                        if (stringObj) {
                            translatedPrefix = stringObj[currentLang] || stringObj['zh_CN'];
                        }
                        localizedMessage = translatedPrefix + errorPart;
                        matched = true;
                        break;
                    }
                }

                // 3. 检查模式匹配
                if (!matched) {
                    for (const { pattern, getKey } of patternMap) {
                        if (pattern.test(message)) {
                            const key = getKey(message);
                            // 回退到内存中的字符串映射
                            const stringObj = stringMap[key];
                            if (stringObj) {
                                let localizedText = stringObj[currentLang] || stringObj['zh_CN'];
                                if (localizedText) {
                                    localizedMessage = localizedText;
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }

        statusDiv.textContent = localizedMessage;
        statusDiv.className = 'status ' + type + ' show';

        setTimeout(() => {
            statusDiv.classList.remove('show');
        }, duration);
    });
}

/**
 * 书签计数函数。
 * @param {string} text - 包含书签和文件夹计数的文本。
 * @returns {{bookmarks: number, folders: number}} 包含书签和文件夹数量的对象。
 */
function countBookmarks(text) {
    try {
        const bookmarksMatch = text.match(/书签\s+(\d+)\s+个/);
        const foldersMatch = text.match(/文件夹\s+(\d+)\s+个/);

        return {
            bookmarks: bookmarksMatch ? parseInt(bookmarksMatch[1]) : 0,
            folders: foldersMatch ? parseInt(foldersMatch[1]) : 0
        };
    } catch (error) {
        return { bookmarks: 0, folders: 0 };
    }
}

/**
 * 添加切换配置面板的通用函数。
 * @param {HTMLElement} contentElement - 配置内容区域的DOM元素。
 * @param {HTMLElement} headerElement - 配置头部区域的DOM元素。
 */
function toggleConfigPanel(contentElement, headerElement) {
    if (!contentElement || !headerElement) {
        return;
    }

    // 切换内容显示状态
    const isHidden = contentElement.style.display === 'none' || contentElement.style.display === '';
    contentElement.style.display = isHidden ? 'block' : 'none';

    // 更新配置头部样式
    headerElement.classList.toggle('collapsed', !isHidden);

    scheduleInitLayoutSync();

    setTimeout(() => {
        scheduleInitLayoutSync();
    }, 220);
}

function scheduleInitLayoutSync() {
    if (initLayoutResizeRafId) return;

    initLayoutResizeRafId = requestAnimationFrame(() => {
        initLayoutResizeRafId = 0;
        syncInitRightColumnHeights();
    });
}

function syncInitRightColumnHeights() {
    const leftPanel = document.querySelector('.stacked-settings');
    const restoreColumn = document.querySelector('.restore-panel-column');
    const restorePanel = document.querySelector('.restore-panel-column > .glass-panel');
    const initActionsStack = document.querySelector('.restore-panel-column > .init-actions-stack');

    if (!leftPanel || !restoreColumn || !restorePanel || !initActionsStack) {
        return;
    }

    const bookmarkSection = leftPanel.querySelector('.settings-section');
    const historySection = leftPanel.querySelector('#currentChangesArchiveSection');

    const bookmarkHeight = bookmarkSection ? bookmarkSection.getBoundingClientRect().height : 0;
    const historyHeight = historySection ? historySection.getBoundingClientRect().height : 0;
    const sectionsTotalHeight = bookmarkHeight + historyHeight;
    const leftPanelOuterHeight = leftPanel.getBoundingClientRect().height;
    const leftPanelFrameHeight = Math.max(0, leftPanelOuterHeight - sectionsTotalHeight);
    const leftHeight = sectionsTotalHeight > 0
        ? (sectionsTotalHeight + leftPanelFrameHeight)
        : leftPanelOuterHeight;

    if (!(leftHeight > 0)) {
        return;
    }

    const restoreColumnStyles = window.getComputedStyle(restoreColumn);
    const rightGap = Number.parseFloat(restoreColumnStyles.rowGap || restoreColumnStyles.gap || '0') || 0;

    const initButtonHeight = initActionsStack.getBoundingClientRect().height;
    const safeInitHeight = Math.max(0, initButtonHeight);
    const maxRestoreHeight = Math.max(0, leftHeight - safeInitHeight - rightGap);

    const leftHeightPx = `${Math.round(leftHeight)}px`;
    const restorePanelHeightPx = `${Math.round(maxRestoreHeight)}px`;

    if (restoreColumn.style.height !== leftHeightPx) {
        restoreColumn.style.height = leftHeightPx;
    }
    if (restorePanel.style.height !== restorePanelHeightPx) {
        restorePanel.style.height = restorePanelHeightPx;
    }
    if (initActionsStack.style.marginTop !== '0px') {
        initActionsStack.style.marginTop = '0';
    }

    restoreColumn.style.minHeight = '0';
    restorePanel.style.minHeight = '0';

    restoreColumn.style.setProperty('--bookmark-section-height', `${bookmarkHeight}px`);
    restoreColumn.style.setProperty('--history-section-height', `${historyHeight}px`);
    restoreColumn.style.setProperty('--left-panel-frame-height', `${leftPanelFrameHeight}px`);
    restoreColumn.style.setProperty('--left-panel-outer-height', `${leftPanelOuterHeight}px`);
    restoreColumn.style.setProperty('--left-sections-total-height', `${leftHeight}px`);
    restoreColumn.style.setProperty('--right-gap-size', `${rightGap}px`);
    restoreColumn.style.setProperty('--init-actions-height', `${safeInitHeight}px`);
    restoreColumn.style.setProperty('--restore-panel-height', `${maxRestoreHeight}px`);
}

/**
 * 更新开关按钮的视觉状态。
 * @param {HTMLElement} toggleButton - 开关按钮的DOM元素。
 * @param {boolean} isEnabled - 是否启用。
 */
function updateToggleState(toggleButton, isEnabled) {
    if (!toggleButton) return;

    if (isEnabled) {
        toggleButton.setAttribute('data-state', 'on');
        toggleButton.style.backgroundColor = '#4CAF50';
        toggleButton.querySelector('.toggle-circle').style.left = 'auto';
        toggleButton.querySelector('.toggle-circle').style.right = '3px';
    } else {
        toggleButton.setAttribute('data-state', 'off');
        toggleButton.style.backgroundColor = '#ccc';
        toggleButton.querySelector('.toggle-circle').style.right = 'auto';
        toggleButton.querySelector('.toggle-circle').style.left = '3px';
    }
}

/**
 * 获取开关按钮的当前状态。
 * @param {HTMLElement} toggleButton - 开关按钮的DOM元素。
 * @returns {boolean} 开关是否启用。
 */
function getToggleState(toggleButton) {
    if (!toggleButton) return false;
    return toggleButton.getAttribute('data-state') === 'on';
}

/**
 * 显示设置已保存指示器。
 */
function showSettingsSavedIndicator() {
    const settingsSavedIndicator = document.getElementById('settingsSavedIndicator');
    if (!settingsSavedIndicator) return;

    settingsSavedIndicator.style.display = 'block';
    settingsSavedIndicator.style.opacity = '0';

    // 使用setTimeout确保CSS过渡效果生效
    setTimeout(() => {
        settingsSavedIndicator.style.opacity = '1';

        // 1.5秒后淡出
        setTimeout(() => {
            settingsSavedIndicator.style.opacity = '0';

            // 等待淡出动画完成后立即隐藏元素，不保留空白区域
            setTimeout(() => {
                settingsSavedIndicator.style.display = 'none';
            }, 300);
        }, 1500);
    }, 10);
}

/**
 * 辅助函数：调用background.js中的函数。
 * @param {string} action - 要调用的后台函数动作。
 * @param {object} [data={}] - 传递给后台函数的数据。
 * @returns {Promise<object>} 后台函数的响应。
 */
async function callBackgroundFunction(action, data = {}) {
    return new Promise((resolve, reject) => {
        try {
            chrome.runtime.sendMessage({
                action: action,
                ...data
            }, response => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(response);
                }
            });
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * 用于更新路径验证指示器的函数。
 * @param {HTMLElement} inputElement - 路径输入框的DOM元素。
 * @param {'success'|'error'|'none'} status - 验证状态。
 */
function updatePathValidationIndicator(inputElement, status) {
    // 获取指示器元素
    const container = inputElement.closest('.path-input-container');
    if (!container) return;

    const indicator = container.querySelector('.path-validation-indicator');
    if (!indicator) return;

    // 重置所有状态
    indicator.classList.remove('success', 'error');

    // 根据状态显示指示器
    if (status === 'success') {
        indicator.classList.add('success');
        indicator.style.display = 'block';
    } else if (status === 'error') {
        indicator.classList.add('error');
        indicator.style.display = 'block';
    } else {
        indicator.style.display = 'none';
    }
}

/**
 * 计算并滚动到“定位A”。
 * 定义：视口顶部定位在「大边框（#syncStatus）上边缘」与
 * 「第一栏目（包含自动/手动备份开关的 .sync-controls）上边缘」之间空白的中点。
 * @param {('auto'|'smooth')} behavior 滚动行为，'auto' 为直接定位，'smooth' 为平滑下滑。
 */
function scrollToPositionA(behavior = 'auto') {
    try {
        const syncStatus = document.getElementById('syncStatus');
        if (!syncStatus) return;

        // 确保区域已显示，便于正确计算几何信息
        const prevDisplay = syncStatus.style.display;
        if (getComputedStyle(syncStatus).display === 'none') {
            syncStatus.style.display = 'block';
        }

        const syncControls = syncStatus.querySelector('.sync-controls');
        const pageYOffset = window.pageYOffset || document.documentElement.scrollTop || 0;

        const bigTop = syncStatus.getBoundingClientRect().top + pageYOffset;
        let targetTop = bigTop + 5; // 默认略微下移，保持现有视觉

        if (syncControls) {
            const firstTop = syncControls.getBoundingClientRect().top + pageYOffset;
            // 「定位A」= 两个上边缘的中点
            targetTop = (bigTop + firstTop) / 2;
        }

        // 恢复原始 display（如果我们暂时更改过）
        syncStatus.style.display = prevDisplay;

        // 执行滚动
        if (behavior === 'smooth') {
            window.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
        } else {
            window.scrollTo(0, Math.max(0, targetTop));
        }
    } catch (e) {
        // 出现异常时回退到顶部，避免无响应
        window.scrollTo(0, 0);
    }
}

/**
 * 调整本地配置中标签的左边距，以达到视觉对齐。
 */
function adjustLocalConfigLabels() {
    const localBackupPathLabel = document.getElementById('localBackupPathLabel');
    const hideDownloadBarLabel = document.getElementById('hideDownloadBarLabel');
    const instructionsLabel = document.getElementById('instructionsLabel');

    // 这是一个估算值，目标是让这些标签的左侧与 "手动校准路径 / ..." 按钮的左侧对齐。
    // 你可能需要根据实际效果微调这个值。
    const targetMarginLeft = '-8px';

    if (localBackupPathLabel) {
        localBackupPathLabel.style.marginLeft = targetMarginLeft;
        localBackupPathLabel.style.textAlign = 'left'; // 确保文本本身左对齐
    }
    if (hideDownloadBarLabel) {
        hideDownloadBarLabel.style.marginLeft = targetMarginLeft;
        hideDownloadBarLabel.style.textAlign = 'left'; // 确保文本本身左对齐
    }
    if (instructionsLabel) {
        instructionsLabel.style.marginLeft = targetMarginLeft;
        instructionsLabel.style.textAlign = 'left'; // 确保文本本身左对齐
    }
}

// =============================================================================
// 核心通信函数 (Core Communication Functions)
// =============================================================================

/**
 * 创建与后台脚本的连接函数。
 */
function connectToBackground() {
    try {
        backgroundPort = chrome.runtime.connect({ name: "popupConnect" });
        isBackgroundConnected = true;
        connectionAttempts = 0;

        backgroundPort.onDisconnect.addListener(() => {
            isBackgroundConnected = false;

            // 只在控制台记录信息，不显示警告，避免用户担心
            // 检查是否需要重新连接（只有在页面还处于活动状态且尝试次数未超过上限时）
            if (document.visibilityState === 'visible' && connectionAttempts < MAX_CONNECTION_ATTEMPTS) {
                connectionAttempts++;

                // 延迟重连，避免过于频繁
                setTimeout(connectToBackground, 1000);
            }
        });

        // (可选) 监听来自后台的消息
        backgroundPort.onMessage.addListener((msg) => {
            // 收到消息表示连接正常
            isBackgroundConnected = true;
        });
    } catch (error) {
        isBackgroundConnected = false;

        // 自动重试连接，但限制尝试次数
        if (connectionAttempts < MAX_CONNECTION_ATTEMPTS) {
            connectionAttempts++;
            setTimeout(connectToBackground, 1000);
        }
    }
}

/**
 * 安全地向后台发送消息的函数。
 * @param {object} message - 要发送的消息对象。
 * @param {function} [callback] - 发送后的回调函数 (success, error)。
 */
function sendMessageToBackground(message, callback) {
    // 检查连接状态
    if (!isBackgroundConnected || !backgroundPort) {
        // 重新连接
        connectToBackground();

        // 延迟发送消息，等待连接建立
        setTimeout(() => {
            if (isBackgroundConnected && backgroundPort) {
                try {
                    backgroundPort.postMessage(message);
                    if (callback) callback(true);
                } catch (error) {
                    if (callback) callback(false, error);
                }
            } else {
                // 使用chrome.runtime.sendMessage作为备选方案
                try {
                    chrome.runtime.sendMessage(message, (response) => {
                        if (chrome.runtime.lastError) {
                            if (callback) callback(false, chrome.runtime.lastError);
                        } else {
                            if (callback) callback(true, response);
                        }
                    });
                } catch (fallbackError) {
                    if (callback) callback(false, fallbackError);
                }
            }
        }, 300);
    } else {
        // 连接正常，直接发送
        try {
            backgroundPort.postMessage(message);
            if (callback) callback(true);
        } catch (error) {
            // 连接可能已断开但状态未更新，尝试重新连接
            isBackgroundConnected = false;
            connectToBackground();

            // 使用备选方法发送
            try {
                chrome.runtime.sendMessage(message, (response) => {
                    if (chrome.runtime.lastError) {
                        if (callback) callback(false, chrome.runtime.lastError);
                    } else {
                        if (callback) callback(true, response);
                    }
                });
            } catch (fallbackError) {
                if (callback) callback(false, fallbackError);
            }
        }
    }
}

// =============================================================================
// UI 初始化函数 (UI Initialization Functions)
// =============================================================================

function getWebdavInputElements() {
    const serverAddressInput = document.getElementById('serverAddress');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    return { serverAddressInput, usernameInput, passwordInput };
}

function readWebdavInputs({ trimPassword = true } = {}) {
    const { serverAddressInput, usernameInput, passwordInput } = getWebdavInputElements();
    const serverAddress = serverAddressInput ? serverAddressInput.value.trim() : '';
    const username = usernameInput ? usernameInput.value.trim() : '';
    const rawPassword = passwordInput ? passwordInput.value : '';
    const password = trimPassword ? rawPassword.trim() : rawPassword;
    return { serverAddress, username, password, rawPassword };
}

function saveWebdavDraftNow() {
    const { serverAddress, username, password, rawPassword } = readWebdavInputs({ trimPassword: true });
    if (!serverAddress && !username && !password && !rawPassword) {
        return;
    }
    try {
        chrome.storage.local.set({
            [WEBDAV_DRAFT_KEYS.serverAddress]: serverAddress,
            [WEBDAV_DRAFT_KEYS.username]: username,
            [WEBDAV_DRAFT_KEYS.password]: password
        });
    } catch (e) {
    }
}

function scheduleSaveWebdavDraft() {
    if (webdavDraftSaveTimer) {
        clearTimeout(webdavDraftSaveTimer);
        webdavDraftSaveTimer = null;
    }
    webdavDraftSaveTimer = setTimeout(() => {
        webdavDraftSaveTimer = null;
        saveWebdavDraftNow();
    }, 250);
}

function initializeWebdavDraftPersistence() {
    const { serverAddressInput, usernameInput, passwordInput } = getWebdavInputElements();
    if (!serverAddressInput || !usernameInput || !passwordInput) {
        return;
    }

    const onInput = () => scheduleSaveWebdavDraft();
    serverAddressInput.addEventListener('input', onInput);
    usernameInput.addEventListener('input', onInput);
    passwordInput.addEventListener('input', onInput);

    serverAddressInput.addEventListener('blur', saveWebdavDraftNow);
    usernameInput.addEventListener('blur', saveWebdavDraftNow);
    passwordInput.addEventListener('blur', () => {
        const trimmed = passwordInput.value.trim();
        if (trimmed !== passwordInput.value) {
            passwordInput.value = trimmed;
            showStatus('已自动去除密码首尾空格/换行', 'info', 2200);
        }
        saveWebdavDraftNow();
    });

    window.addEventListener('beforeunload', saveWebdavDraftNow);
}

function initializePasswordVisibilityButton() {
    const { passwordInput } = getWebdavInputElements();
    const button = document.getElementById('passwordVisibilityBtn');
    if (!passwordInput || !button) {
        return;
    }

    let currentLang = 'zh_CN';
    try {
        chrome.storage.local.get(['preferredLang'], (result) => {
            const lang = result && result.preferredLang;
            if (lang === 'en' || lang === 'zh_CN') {
                currentLang = lang;
            }
            update();
        });
    } catch (e) {
    }

    const tooltipMap = {
        show: { zh_CN: '显示密码', en: 'Show password' },
        hide: { zh_CN: '隐藏密码', en: 'Hide password' }
    };

    const update = () => {
        const showing = passwordInput.type === 'text';

        // Use icons for better alignment
        // If showing (text visible), button should toggle to hide -> use "eye-slash"
        // If hidden (dots visible), button should toggle to show -> use "eye"
        button.innerHTML = showing ? '<i class="fas fa-eye-slash"></i>' : '<i class="fas fa-eye"></i>';

        const tooltip = showing ? tooltipMap.hide[currentLang] : tooltipMap.show[currentLang];
        button.setAttribute('aria-label', tooltip);
        button.setAttribute('title', tooltip);
    };

    // Default hidden
    passwordInput.type = 'password';
    update();

    button.addEventListener('mousedown', (e) => {
        // Prevent button from stealing focus which might hide it if logic depends on focus-within
        e.preventDefault();
    });
    button.addEventListener('click', (e) => {
        e.preventDefault();
        passwordInput.type = passwordInput.type === 'password' ? 'text' : 'password';
        update();
        passwordInput.focus();
    });
}

function setWebdavConfigPanelOpen(open, { persist = true } = {}) {
    const configHeader = document.getElementById('configHeader');
    const configContent = document.getElementById('configContent');
    if (!configHeader || !configContent) {
        return;
    }

    configContent.style.display = open ? 'block' : 'none';
    configHeader.classList.toggle('collapsed', !open);
    webDAVConfigPanelOpen = !!open;

    if (persist) {
        try {
            chrome.storage.local.set({ [WEBDAV_UI_STATE_KEYS.panelOpen]: !!open });
        } catch (e) {
        }
    }
}

async function testWebdavConnection({ serverAddress, username, password }) {
    return await callBackgroundFunction('testWebDAVConnection', {
        serverAddress,
        username,
        password
    });
}

function getGitHubRepoInputElements() {
    const ownerInput = document.getElementById('githubRepoOwner');
    const nameInput = document.getElementById('githubRepoName');
    const branchInput = document.getElementById('githubRepoBranch');
    const basePathInput = document.getElementById('githubRepoBasePath');
    const tokenInput = document.getElementById('githubRepoToken');
    const githubRepoInfoDisplay = document.getElementById('githubRepoInfoDisplay');
    return { ownerInput, nameInput, branchInput, basePathInput, tokenInput, githubRepoInfoDisplay };
}

function readGitHubRepoInputs({ trimToken = true } = {}) {
    const { ownerInput, nameInput, branchInput, basePathInput, tokenInput } = getGitHubRepoInputElements();
    const rawToken = tokenInput ? tokenInput.value : '';
    const token = trimToken ? rawToken.trim() : rawToken;
    return {
        owner: ownerInput ? ownerInput.value.trim() : '',
        repo: nameInput ? nameInput.value.trim() : '',
        branch: branchInput ? branchInput.value.trim() : '',
        basePath: basePathInput ? basePathInput.value.trim() : '',
        token,
        rawToken
    };
}

function saveGitHubRepoDraftNow() {
    const { owner, repo, branch, basePath, token, rawToken } = readGitHubRepoInputs({ trimToken: true });
    if (!owner && !repo && !branch && !basePath && !token && !rawToken) {
        return;
    }
    try {
        chrome.storage.local.set({
            [GITHUB_REPO_DRAFT_KEYS.owner]: owner,
            [GITHUB_REPO_DRAFT_KEYS.name]: repo,
            [GITHUB_REPO_DRAFT_KEYS.branch]: branch,
            [GITHUB_REPO_DRAFT_KEYS.basePath]: basePath,
            [GITHUB_REPO_DRAFT_KEYS.token]: token
        });
    } catch (e) {
    }
}

function scheduleSaveGitHubRepoDraft() {
    if (githubRepoDraftSaveTimer) {
        clearTimeout(githubRepoDraftSaveTimer);
        githubRepoDraftSaveTimer = null;
    }
    githubRepoDraftSaveTimer = setTimeout(() => {
        githubRepoDraftSaveTimer = null;
        saveGitHubRepoDraftNow();
    }, 250);
}

function initializeGitHubRepoDraftPersistence() {
    const { ownerInput, nameInput, branchInput, basePathInput, tokenInput } = getGitHubRepoInputElements();
    if (!tokenInput) {
        return;
    }

    const onInput = () => scheduleSaveGitHubRepoDraft();
    [ownerInput, nameInput, branchInput, basePathInput, tokenInput].filter(Boolean).forEach((el) => {
        el.addEventListener('input', onInput);
    });

    const trimField = (el) => {
        if (!el) return;
        const trimmed = el.value.trim();
        if (trimmed !== el.value) {
            el.value = trimmed;
        }
    };

    [ownerInput, nameInput, branchInput, basePathInput].filter(Boolean).forEach((el) => {
        el.addEventListener('blur', () => {
            trimField(el);
            saveGitHubRepoDraftNow();
        });
    });

    tokenInput.addEventListener('blur', () => {
        const trimmed = tokenInput.value.trim();
        if (trimmed !== tokenInput.value) {
            tokenInput.value = trimmed;
            showStatus('已自动去除Token首尾空格/换行', 'info', 2200);
        }
        saveGitHubRepoDraftNow();
    });

    window.addEventListener('beforeunload', saveGitHubRepoDraftNow);
}

function initializeGitHubRepoTokenVisibilityButton() {
    const { tokenInput } = getGitHubRepoInputElements();
    const button = document.getElementById('githubRepoTokenVisibilityBtn');
    if (!tokenInput || !button) {
        return;
    }

    let currentLang = 'zh_CN';
    try {
        chrome.storage.local.get(['preferredLang'], (result) => {
            const lang = result && result.preferredLang;
            if (lang === 'en' || lang === 'zh_CN') {
                currentLang = lang;
            }
            update();
        });
    } catch (e) {
    }

    const tooltipMap = {
        show: { zh_CN: '显示Token', en: 'Show token' },
        hide: { zh_CN: '隐藏Token', en: 'Hide token' }
    };

    const update = () => {
        const showing = tokenInput.type === 'text';
        button.innerHTML = showing ? '<i class="fas fa-eye-slash"></i>' : '<i class="fas fa-eye"></i>';
        const tooltip = showing ? tooltipMap.hide[currentLang] : tooltipMap.show[currentLang];
        button.setAttribute('aria-label', tooltip);
        button.setAttribute('title', tooltip);
    };

    tokenInput.type = 'password';
    update();

    button.addEventListener('mousedown', (e) => {
        e.preventDefault();
    });
    button.addEventListener('click', (e) => {
        e.preventDefault();
        tokenInput.type = tokenInput.type === 'password' ? 'text' : 'password';
        update();
        tokenInput.focus();
    });
}

function setGitHubRepoConfigPanelOpen(open, { persist = true } = {}) {
    const configHeader = document.getElementById('githubRepoConfigHeader');
    const configContent = document.getElementById('githubRepoConfigContent');
    if (!configHeader || !configContent) {
        return;
    }

    configContent.style.display = open ? 'block' : 'none';
    configHeader.classList.toggle('collapsed', !open);
    githubRepoConfigPanelOpen = !!open;

    if (persist) {
        try {
            chrome.storage.local.set({ [GITHUB_REPO_UI_STATE_KEYS.panelOpen]: !!open });
        } catch (e) {
        }
    }
}

async function testGitHubRepoConnection({ token, owner, repo, branch, basePath }) {
    return await callBackgroundFunction('testGitHubRepoConnection', {
        token,
        owner,
        repo,
        branch,
        basePath
    });
}

async function ensureGitHubRepoInitialized() {
    return await callBackgroundFunction('ensureGitHubRepoInitialized', {});
}

/**
 * 初始化WebDAV配置部分。
 * @async
 */
async function initializeWebDAVConfigSection() {
    // 在函数开始时加载并显示已保存的配置
    await loadAndDisplayWebDAVConfig(); // 新增调用

    const configHeader = document.getElementById('configHeader');
    const configContent = document.getElementById('configContent');
    const webDAVToggle = document.getElementById('webDAVToggle');

    if (!configHeader || !configContent) {
        return;
    }

    // 设置初始状态：从存储恢复“是否展开”
    try {
        const uiState = await chrome.storage.local.get([WEBDAV_UI_STATE_KEYS.panelOpen]);
        setWebdavConfigPanelOpen(uiState[WEBDAV_UI_STATE_KEYS.panelOpen] === true, { persist: false });
    } catch (e) {
        setWebdavConfigPanelOpen(false, { persist: false });
    }

    // 绑定点击事件
    configHeader.addEventListener('click', function (event) {
        // 检查点击是否在开关元素上，如果是则不切换面板
        if (event.target.id === 'webDAVToggle' || event.target.closest('.switch')) {
            return;
        }

        toggleConfigPanel(configContent, configHeader);
        const open = configContent.style.display === 'block';
        setWebdavConfigPanelOpen(open, { persist: true });
    });

    // 添加保存WebDAV配置的处理
    const saveButton = document.getElementById('saveKey');
    if (saveButton) {
        saveButton.addEventListener('click', async function () {
            const { serverAddress, username, password, rawPassword } = readWebdavInputs({ trimPassword: true });
            const { passwordInput } = getWebdavInputElements();

            // 先保存草稿，避免关闭弹窗丢失输入
            saveWebdavDraftNow();

            if (!serverAddress || !username || !password) {
                showStatus('请填写完整的WebDAV配置信息', 'error');
                return;
            }

            if (rawPassword !== rawPassword.trim()) {
                if (passwordInput) passwordInput.value = password;
                showStatus('已自动去除密码首尾空格/换行', 'info', 2200);
            }

            showStatus('正在测试WebDAV连接...', 'info', 3500);
            let testResult;
            try {
                testResult = await testWebdavConnection({ serverAddress, username, password });
            } catch (error) {
                showStatus(`WebDAV连接测试失败: ${error.message || '未知错误'}`, 'error', 4500);
                return;
            }

            if (!testResult || testResult.success !== true) {
                showStatus(`WebDAV连接测试失败: ${testResult?.error || '未知错误'}`, 'error', 4500);
                return;
            }

            // 测试通过后保存配置并自动打开开关
            chrome.storage.local.set({
                serverAddress,
                username,
                password,
                webDAVEnabled: true,
                [WEBDAV_DRAFT_KEYS.serverAddress]: serverAddress,
                [WEBDAV_DRAFT_KEYS.username]: username,
                [WEBDAV_DRAFT_KEYS.password]: password
            }, function () {
                const webDAVToggle = document.getElementById('webDAVToggle');
                if (webDAVToggle) {
                    webDAVToggle.checked = true;
                }

                showStatus('WebDAV配置已保存，备份已启用', 'success');

                const configStatus = document.getElementById('configStatus');
                if (configStatus) {
                    configStatus.classList.remove('not-configured');
                    configStatus.classList.add('configured');
                }

                // 保存后自动折叠
                setTimeout(() => {
                    setWebdavConfigPanelOpen(false, { persist: true });
                }, 150);
            });
        });
    }

    // 添加WebDAV连接测试按钮（不保存）
    const testBtn = document.getElementById('testWebdavBtn');
    if (testBtn) {
        testBtn.addEventListener('click', async function () {
            const { serverAddress, username, password, rawPassword } = readWebdavInputs({ trimPassword: true });
            const { passwordInput } = getWebdavInputElements();
            saveWebdavDraftNow();

            if (!serverAddress || !username || !password) {
                showStatus('请填写完整的WebDAV配置信息', 'error');
                return;
            }

            if (rawPassword !== rawPassword.trim()) {
                if (passwordInput) passwordInput.value = password;
                showStatus('已自动去除密码首尾空格/换行', 'info', 2200);
            }

            showStatus('正在测试WebDAV连接...', 'info', 3500);
            try {
                const result = await testWebdavConnection({ serverAddress, username, password });
                if (result && result.success === true) {
                    showStatus('WebDAV连接测试成功', 'success', 2400);
                } else {
                    showStatus(`WebDAV连接测试失败: ${result?.error || '未知错误'}`, 'error', 4500);
                }
            } catch (error) {
                showStatus(`WebDAV连接测试失败: ${error.message || '未知错误'}`, 'error', 4500);
            }
        });
    }

    initializeWebdavDraftPersistence();
    initializePasswordVisibilityButton();
}

/**
 * 初始化 GitHub Repository 配置部分（云端2）。
 * @async
 */
async function initializeGitHubRepoConfigSection() {
    // 在函数开始时加载并显示已保存的配置
    await loadAndDisplayGitHubRepoConfig();

    const configHeader = document.getElementById('githubRepoConfigHeader');
    const configContent = document.getElementById('githubRepoConfigContent');

    if (!configHeader || !configContent) {
        return;
    }

    // 设置初始状态：从存储恢复“是否展开”
    try {
        const uiState = await chrome.storage.local.get([GITHUB_REPO_UI_STATE_KEYS.panelOpen]);
        setGitHubRepoConfigPanelOpen(uiState[GITHUB_REPO_UI_STATE_KEYS.panelOpen] === true, { persist: false });
    } catch (e) {
        setGitHubRepoConfigPanelOpen(false, { persist: false });
    }

    // 绑定点击事件
    configHeader.addEventListener('click', function (event) {
        if (event.target.id === 'githubRepoToggle' || event.target.closest('.switch')) {
            return;
        }

        toggleConfigPanel(configContent, configHeader);
        const open = configContent.style.display === 'block';
        setGitHubRepoConfigPanelOpen(open, { persist: true });
    });

    // 保存配置（保存前先测试）
    const saveButton = document.getElementById('saveGithubRepoConfigBtn');
    if (saveButton) {
        saveButton.addEventListener('click', async function () {
            const { owner, repo, branch, basePath, token, rawToken } = readGitHubRepoInputs({ trimToken: true });
            const { tokenInput } = getGitHubRepoInputElements();

            saveGitHubRepoDraftNow();

            if (!owner || !repo || !token) {
                showStatus('请填写完整的GitHub仓库配置信息', 'error');
                return;
            }

            if (rawToken !== rawToken.trim()) {
                if (tokenInput) tokenInput.value = token;
                showStatus('已自动去除Token首尾空格/换行', 'info', 2200);
            }

            showStatus('正在测试GitHub仓库连接...', 'info', 3500);
            let testResult;
            try {
                testResult = await testGitHubRepoConnection({ token, owner, repo, branch, basePath });
            } catch (error) {
                showStatus(`GitHub仓库连接测试失败: ${error.message || '未知错误'}`, 'error', 4500);
                return;
            }

            if (!testResult || testResult.success !== true) {
                showStatus(`GitHub仓库连接测试失败: ${testResult?.error || '未知错误'}`, 'error', 4500);
                return;
            }

            const resolvedBranch = branch || testResult.resolvedBranch || '';

            const updates = {
                githubRepoToken: token,
                githubRepoOwner: owner,
                githubRepoName: repo,
                githubRepoBranch: resolvedBranch,
                githubRepoBasePath: basePath || '',
                githubRepoEnabled: true,
                [GITHUB_REPO_DRAFT_KEYS.owner]: owner,
                [GITHUB_REPO_DRAFT_KEYS.name]: repo,
                [GITHUB_REPO_DRAFT_KEYS.branch]: resolvedBranch,
                [GITHUB_REPO_DRAFT_KEYS.basePath]: basePath || '',
                [GITHUB_REPO_DRAFT_KEYS.token]: token
            };

            chrome.storage.local.set(updates, async function () {
                const toggle = document.getElementById('githubRepoToggle');
                if (toggle) {
                    toggle.checked = true;
                }

                showStatus('GitHub仓库配置已保存，备份已启用', 'success');

                const statusDot = document.getElementById('githubRepoConfigStatus');
                if (statusDot) {
                    statusDot.classList.remove('not-configured');
                    statusDot.classList.add('configured');
                }

                try {
                    const initResult = await ensureGitHubRepoInitialized();
                    if (!initResult || initResult.success !== true) {
                        showStatus(`仓库信息获取失败: ${initResult?.error || '未知错误'}`, 'error', 4500);
                    }
                } catch (error) {
                    showStatus(`仓库信息获取失败: ${error?.message || '未知错误'}`, 'error', 4500);
                }

                loadAndDisplayGitHubRepoConfig();

                setTimeout(() => {
                    setGitHubRepoConfigPanelOpen(false, { persist: true });
                }, 150);
            });
        });
    }

    // 测试连接（不保存）
    const testBtn = document.getElementById('testGithubRepoBtn');
    if (testBtn) {
        testBtn.addEventListener('click', async function () {
            const { owner, repo, branch, basePath, token, rawToken } = readGitHubRepoInputs({ trimToken: true });
            const { tokenInput } = getGitHubRepoInputElements();
            saveGitHubRepoDraftNow();

            if (!owner || !repo || !token) {
                showStatus('请填写完整的GitHub仓库配置信息', 'error');
                return;
            }

            if (rawToken !== rawToken.trim()) {
                if (tokenInput) tokenInput.value = token;
                showStatus('已自动去除Token首尾空格/换行', 'info', 2200);
            }

            showStatus('正在测试GitHub仓库连接...', 'info', 3500);
            try {
                const result = await testGitHubRepoConnection({ token, owner, repo, branch, basePath });
                if (result && result.success === true) {
                    showStatus('GitHub仓库连接测试成功', 'success', 2400);

                    // 在信息框中展示更直观的 Base Path 含义与写入预览（不保存）
                    try {
                        const { githubRepoInfoDisplay } = getGitHubRepoInputElements();
                        if (githubRepoInfoDisplay) {
                            const { preferredLang } = await new Promise(resolve => chrome.storage.local.get(['preferredLang'], resolve));
                            const isEn = preferredLang === 'en';
                            const repoText = result?.repo?.fullName || `${owner}/${repo}`;
                            const resolvedBranch = branch || result?.resolvedBranch || '';
                            const branchText = resolvedBranch || (isEn ? 'Default branch' : '默认分支');

                            const basePathTrimmed = String(basePath || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
                            const basePathText = basePathTrimmed || (isEn ? 'Repository root' : '仓库根目录');
                            const exportRootFolder = isEn ? 'Bookmark Backup' : '书签备份';
                            const previewPath = `${basePathTrimmed ? `${basePathTrimmed}/` : ''}${exportRootFolder}/...`;

                            const lines = isEn
                                ? [
                                    `Repository: ${repoText}`,
                                    `Branch: ${branchText}`,
                                    `Base Path: ${basePathText}`,
                                    `Write to: ${previewPath}`,
                                    basePathTrimmed
                                        ? (result.basePathExists === true
                                            ? 'Base Path status: exists'
                                            : (result.basePathExists === false
                                                ? 'Base Path status: not found (will be created on first backup)'
                                                : ''))
                                        : 'Note: Leave Base Path empty to use repo root.',
                                    `Note: Folders are created automatically; structure matches WebDAV/Local exports.`
                                ].filter(Boolean)
                                : [
                                    `仓库：${repoText}`,
                                    `分支：${branchText}`,
                                    `Base Path：${basePathText}`,
                                    `写入预览：${previewPath}`,
                                    basePathTrimmed
                                        ? (result.basePathExists === true
                                            ? 'Base Path 状态：已存在'
                                            : (result.basePathExists === false
                                                ? 'Base Path 状态：不存在（首次备份会自动创建）'
                                                : ''))
                                        : '提示：Base Path 留空即可写入仓库根目录。',
                                    `说明：目录结构与 WebDAV/本地导出一致（目录不存在会自动创建）。`
                                ].filter(Boolean);

                            githubRepoInfoDisplay.textContent = lines.join('\n');
                            githubRepoInfoDisplay.style.color = 'var(--theme-text-secondary)';
                        }
                    } catch (_) {
                    }
                } else {
                    showStatus(`GitHub仓库连接测试失败: ${result?.error || '未知错误'}`, 'error', 4500);
                }
            } catch (error) {
                showStatus(`GitHub仓库连接测试失败: ${error.message || '未知错误'}`, 'error', 4500);
            }
        });
    }

    // Token 配置说明按钮
    const guideBtn = document.getElementById('openGithubTokenGuideBtn');
    if (guideBtn && !guideBtn.dataset.bound) {
        guideBtn.dataset.bound = 'true';
        guideBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                let langParam = 'zh';
                try {
                    // 优先尝试获取用户设置的首选语言
                    const { preferredLang } = await new Promise(resolve => chrome.storage.local.get(['preferredLang'], resolve));
                    if (preferredLang) {
                        langParam = preferredLang === 'en' ? 'en' : 'zh';
                    } else {
                        // 如果没有设置首选语言，则检测浏览器 UI 语言
                        const uiLang = chrome.i18n.getUILanguage();
                        langParam = uiLang.startsWith('en') ? 'en' : 'zh';
                    }
                } catch (_) {
                    // 发生错误时的后备方案
                    const uiLang = chrome.i18n.getUILanguage();
                    langParam = uiLang.startsWith('en') ? 'en' : 'zh';
                }

                // 检测当前主题 (优先使用 localStorage 中的设置，否则跟随系统)
                let themeParam = 'light';
                try {
                    const savedTheme = localStorage.getItem('themeMode') || localStorage.getItem('historyViewerCustomTheme');
                    if (savedTheme === 'dark' || savedTheme === 'light') {
                        themeParam = savedTheme;
                    } else {
                        themeParam = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
                    }
                } catch (_) {
                    themeParam = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
                }

                const url = chrome.runtime.getURL(`github-token-guide.html?lang=${langParam}&theme=${themeParam}`);
                if (chrome.tabs && chrome.tabs.create) {
                    chrome.tabs.create({ url });
                } else {
                    window.open(url, '_blank');
                }
            } catch (err) {
                showStatus(`打开说明失败: ${err?.message || '未知错误'}`, 'error', 4500);
            }
        });
    }

    initializeGitHubRepoDraftPersistence();
    initializeGitHubRepoTokenVisibilityButton();
}

/**
 * 初始化本地配置部分。
 */
function initializeLocalConfigSection() {
    const localConfigHeader = document.getElementById('localConfigHeader');
    const localConfigContent = document.getElementById('localConfigContent');
    const defaultDownloadToggle = document.getElementById('defaultDownloadToggle');
    const hideDownloadShelfToggle = document.getElementById('hideDownloadShelfToggle');
    const downloadPathDisplay = document.getElementById('downloadPathDisplay');
    const calibratePathBtn = document.getElementById('calibratePathBtn');
    const localConfigStatusDot = document.getElementById('localConfigStatus');
    const openDownloadSettings = document.getElementById('openDownloadSettings');

    // 设置点击事件，展开/折叠配置面板
    if (localConfigHeader) {
        localConfigHeader.addEventListener('click', function (event) {
            // 检查点击是否在开关元素上，如果是则不切换面板
            if (event.target.id === 'defaultDownloadToggle' || event.target.closest('.switch')) {
                return;
            }

            if (localConfigContent.style.display === 'none' || localConfigContent.style.display === '') {
                localConfigContent.style.display = 'block';
                localConfigHeader.classList.remove('collapsed');
                setTimeout(() => {
                    window.scrollBy({
                        top: 160,
                        behavior: 'smooth'
                    });
                }, 100);
            } else {
                localConfigContent.style.display = 'none';
                localConfigHeader.classList.add('collapsed');
            }
        });
    }

    // 初始化，加载默认下载路径状态
    chrome.storage.local.get(['defaultDownloadEnabled', 'hideDownloadShelf', 'customDownloadPath'], function (result) {
        // 默认值设置
        let defaultDownloadEnabled = result.defaultDownloadEnabled === true;
        let hideDownloadShelf = result.hideDownloadShelf !== false; // 默认启用

        // 更新UI状态
        if (defaultDownloadToggle) defaultDownloadToggle.checked = defaultDownloadEnabled;
        if (hideDownloadShelfToggle) hideDownloadShelfToggle.checked = hideDownloadShelf;

        // 如果存在自定义路径，直接使用它
        if (result.customDownloadPath) {
            if (downloadPathDisplay) {
                downloadPathDisplay.textContent = result.customDownloadPath;
                downloadPathDisplay.style.color = "var(--theme-text-secondary)";
            }
        } else {
            // 否则更新下载路径显示
            updateDownloadPathDisplay();
        }

        // 更新状态指示器
        updateLocalStatusDot();
    });

    // 处理默认下载位置开关
    if (defaultDownloadToggle) {
        defaultDownloadToggle.addEventListener('change', function () {
            const enabled = this.checked;

            // 如果开启了开关且面板是展开状态，先立即折叠面板
            if (enabled && localConfigContent && localConfigContent.style.display === 'block') {
                // 立即折叠，不使用动画过渡
                localConfigContent.style.transition = 'none';
                localConfigContent.style.display = 'none';
                if (localConfigHeader) {
                    localConfigHeader.classList.add('collapsed');
                }
            }

            // 保存配置
            chrome.storage.local.set({
                defaultDownloadEnabled: enabled
            }, function () {
                showStatus(`本地备份已${enabled ? '启用' : '禁用'}`, 'success');
                updateLocalStatusDot();
            });
        });
    }

    // 处理隐藏下载栏开关
    if (hideDownloadShelfToggle) {
        hideDownloadShelfToggle.addEventListener('change', function () {
            const enabled = this.checked;

            // 保存配置
            chrome.storage.local.set({ hideDownloadShelf: enabled }, function () {
                showStatus(`备份时${enabled ? '将' : '不再'}隐藏下载栏`, 'info');
            });
        });
    }

    // 处理校准按钮点击事件
    if (calibratePathBtn) {
        // 更改按钮样式
        calibratePathBtn.style.backgroundColor = "#007AFF"; // 修改为蓝色
        // 保持原有事件处理
        calibratePathBtn.addEventListener('click', function () {
            calibrateDownloadPath();
        });
    }

    // 打开Chrome下载设置
    if (openDownloadSettings) {
        openDownloadSettings.addEventListener('click', function (e) {
            e.preventDefault();

            // 方法1：直接使用runtime.openOptionsPage 打开浏览器内部页面
            chrome.runtime.sendMessage({ action: "openDownloadSettings" }, function (response) {
                if (response && response.success) {
                } else {
                    // 方法2：提供备用方案，让用户手动访问
                    const ua = navigator.userAgent || '';
                    const isEdge = ua.includes('Edg/');
                    const settingsUrl = isEdge ? 'edge://settings/downloads' : 'chrome://settings/downloads';
                    const msg = `请手动复制并在新标签页打开: ${settingsUrl}`;
                    showStatus(msg, 'info', 5000);

                    // 尝试复制到剪贴板
                    try {
                        navigator.clipboard.writeText(settingsUrl).then(() => {
                            showStatus('设置地址已复制到剪贴板', 'success');
                        });
                    } catch (clipboardError) {
                    }
                }
            });
        });
    }
}

/**
 * 处理WebDAV配置开关。
 */
function initializeWebDAVToggle() {
    const webDAVToggle = document.getElementById('webDAVToggle');
    if (webDAVToggle) {
        webDAVToggle.addEventListener('change', function () {
            const enabled = webDAVToggle.checked;
            chrome.storage.local.set({ webDAVEnabled: enabled }, function () { // 使用 chrome.storage
                showStatus(`WebDAV备份已${enabled ? '启用' : '禁用'}`, 'success');
            });
        });
    }
}

/**
 * 处理 GitHub Repository 配置开关（云端2）。
 */
function initializeGitHubRepoToggle() {
    const toggle = document.getElementById('githubRepoToggle');
    if (toggle) {
        toggle.addEventListener('change', function () {
            const enabled = toggle.checked;
            chrome.storage.local.set({ githubRepoEnabled: enabled }, function () {
                showStatus(`GitHub仓库备份已${enabled ? '启用' : '禁用'}`, 'success');
            });
        });
    }
}

// 全局变量：跟踪是否有对话框打开
let isDialogOpen = false;

/**
 * 初始化"回到顶部"按钮。
 */
function initScrollToTopButton() {
    const 일반scrollToTopBtn = document.getElementById('scrollToTopBtn'); // 通用回到顶部按钮
    const scrollToTopFloating = document.getElementById('scrollToTopFloating'); // 新的悬浮向上箭头按钮

    // 统一的按钮显示控制变量
    let generalScrollBtn = null;
    let hasUserScrolled = false;

    // 监听用户第一次滚动操作
    const markUserHasScrolled = () => {
        hasUserScrolled = true;
        window.removeEventListener('scroll', markUserHasScrolled);
    };

    window.addEventListener('scroll', markUserHasScrolled, { passive: true, once: true });

    // 处理通用回到顶部按钮
    if (일반scrollToTopBtn) {
        // 移除可能存在的旧监听器，以防万一
        const newGeneralScrollBtn = 일반scrollToTopBtn.cloneNode(true);
        일반scrollToTopBtn.parentNode.replaceChild(newGeneralScrollBtn, 일반scrollToTopBtn);
        generalScrollBtn = newGeneralScrollBtn;

        newGeneralScrollBtn.addEventListener('click', function () {
            window.scrollTo(0, 0);
            this.style.transform = 'scale(0.9)';
            setTimeout(() => {
                this.style.transform = 'scale(1)';
            }, 150);
        });

        // 初始隐藏
        generalScrollBtn.style.display = 'none';
    }

    // 新的右下角悬浮向上箭头按钮
    if (scrollToTopFloating) {
        // 点击返回页面顶部
        scrollToTopFloating.addEventListener('click', function () {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            this.style.transform = 'translateX(-50%) scale(0.95)';
            setTimeout(() => {
                this.style.transform = 'translateX(-50%) scale(1)';
            }, 200);
        });

        // 鼠标悬停效果
        scrollToTopFloating.addEventListener('mouseenter', function () {
            this.style.transform = 'translateX(-50%) scale(1.05)';
            this.style.background = 'rgba(0, 0, 0, 0.25)';
            this.style.borderColor = 'rgba(255, 255, 255, 0.3)';
            this.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
        });

        scrollToTopFloating.addEventListener('mouseleave', function () {
            this.style.transform = 'translateX(-50%) scale(1)';
            this.style.background = 'rgba(0, 0, 0, 0.15)';
            this.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            this.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
        });

        // 初始隐藏
        scrollToTopFloating.style.display = 'none';
    }

    // 统一的显示控制逻辑 - 基于「备份检查记录」区域的下边缘
    const updateButtonsVisibility = () => {
        // 如果有对话框打开，不显示按钮
        if (isDialogOpen) {
            if (scrollToTopFloating) scrollToTopFloating.style.display = 'none';
            if (generalScrollBtn) generalScrollBtn.style.display = 'none';
            return;
        }

        // 如果用户还未进行过滚动操作，不显示按钮
        if (!hasUserScrolled) {
            if (scrollToTopFloating) scrollToTopFloating.style.display = 'none';
            if (generalScrollBtn) generalScrollBtn.style.display = 'none';
            return;
        }

        // 查找备份检查记录区域
        const syncHistoryElement = document.querySelector('.sync-history');
        if (!syncHistoryElement) {
            // 找不到目标区域，隐藏所有按钮
            if (scrollToTopFloating) scrollToTopFloating.style.display = 'none';
            if (generalScrollBtn) generalScrollBtn.style.display = 'none';
            return;
        }

        // 统一控制两个按钮的显示/隐藏
        // 新逻辑：只要备份检查记录区域（syncHistoryElement）的顶端已经进入视口或者滚动超过了它，
        // 并且页面发生了一定程度的滚动，就显示按钮。
        // 不再要求底部边缘进入视口。

        // 简单的阈值：滚动超过 300px 就显示，或者如果能检测到 syncHistoryElement，当它靠近视口顶部时显示
        const scrollY = window.scrollY || window.pageYOffset;
        const rect = syncHistoryElement.getBoundingClientRect();

        // 只要滚动超过一定距离 (例如 200px) 或者 历史记录区域出现，就显示
        // 结合用户体验：当内容足够长需要滚动回来时显示
        const shouldShow = scrollY > 200;

        // 统一控制两个按钮的显示/隐藏
        if (scrollToTopFloating) {
            scrollToTopFloating.style.display = shouldShow ? 'flex' : 'none';
        }
        if (generalScrollBtn) {
            generalScrollBtn.style.display = shouldShow ? 'block' : 'none';
        }
    };

    // 绑定事件监听器
    window.addEventListener('scroll', updateButtonsVisibility, { passive: true });
    window.addEventListener('resize', updateButtonsVisibility);
    // 初始计算
    updateButtonsVisibility();
}

/**
 * 初始化开源信息按钮和对话框。
 */
function initializeOpenSourceInfo() {
    const openSourceInfoBtn = document.getElementById('openSourceInfoBtn');
    const openSourceInfoDialog = document.getElementById('openSourceInfoDialog');
    const closeOpenSourceDialog = document.getElementById('closeOpenSourceDialog');
    const openSourceTooltip = document.getElementById('openSourceTooltip');

    if (!openSourceInfoBtn || !openSourceInfoDialog || !closeOpenSourceDialog) {
        return;
    }

    // 点击开源信息按钮显示对话框
    openSourceInfoBtn.addEventListener('click', () => {
        openSourceInfoDialog.style.display = 'block';
    });

    // 点击关闭按钮隐藏对话框
    closeOpenSourceDialog.addEventListener('click', () => {
        openSourceInfoDialog.style.display = 'none';
    });

    // 点击对话框外部区域关闭对话框
    openSourceInfoDialog.addEventListener('click', (event) => {
        if (event.target === openSourceInfoDialog) {
            openSourceInfoDialog.style.display = 'none';
        }
    });

    // 鼠标悬停显示工具提示
    if (openSourceTooltip) {
        openSourceInfoBtn.addEventListener('mouseenter', () => {
            openSourceTooltip.style.visibility = 'visible';
            openSourceTooltip.style.opacity = '1';
        });

        openSourceInfoBtn.addEventListener('mouseleave', () => {
            openSourceTooltip.style.visibility = 'hidden';
            openSourceTooltip.style.opacity = '0';
        });
    }
}

// =============================================================================
// 数据加载与显示函数 (Data Loading and Display Functions)
// =============================================================================

/**
 * 新增函数：加载并显示WebDAV配置。
 * @async
 */
async function loadAndDisplayWebDAVConfig() {
    const serverAddressInput = document.getElementById('serverAddress');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const webDAVToggle = document.getElementById('webDAVToggle');
    const configStatus = document.getElementById('configStatus');

    if (!serverAddressInput || !usernameInput || !passwordInput || !webDAVToggle || !configStatus) {
        return;
    }

    try {
        const data = await new Promise((resolve, reject) => {
            chrome.storage.local.get([
                'serverAddress', 'username', 'password', 'webDAVEnabled',
                WEBDAV_DRAFT_KEYS.serverAddress, WEBDAV_DRAFT_KEYS.username, WEBDAV_DRAFT_KEYS.password
            ], (result) => {
                if (chrome.runtime.lastError) {
                    return reject(chrome.runtime.lastError);
                }
                resolve(result);
            });
        });

        const draftServerAddress = data[WEBDAV_DRAFT_KEYS.serverAddress];
        const draftUsername = data[WEBDAV_DRAFT_KEYS.username];
        const draftPassword = data[WEBDAV_DRAFT_KEYS.password];

        const displayServerAddress = (typeof draftServerAddress === 'string' && draftServerAddress.length > 0)
            ? draftServerAddress
            : (data.serverAddress || '');
        const displayUsername = (typeof draftUsername === 'string' && draftUsername.length > 0)
            ? draftUsername
            : (data.username || '');
        const displayPassword = (typeof draftPassword === 'string' && draftPassword.length > 0)
            ? draftPassword
            : (data.password || '');

        serverAddressInput.value = displayServerAddress;
        usernameInput.value = displayUsername;
        passwordInput.value = displayPassword;

        const isConfigured = data.serverAddress && data.username && data.password;
        const isEnabled = data.webDAVEnabled === true; // 明确检查true

        webDAVToggle.checked = isEnabled;

        if (isConfigured && isEnabled) {
            configStatus.classList.remove('not-configured');
            configStatus.classList.add('configured');
        } else if (isConfigured && !isEnabled) {
            // 配置了但未启用，可以显示特定状态，例如黄色，或保持红色
            configStatus.classList.remove('configured');
            configStatus.classList.add('not-configured'); // 或者一个 'disabled-configured' 状态
        } else {
            configStatus.classList.remove('configured');
            configStatus.classList.add('not-configured');
        }

    } catch (error) {
        // 确保UI处于未配置状态
        serverAddressInput.value = '';
        usernameInput.value = '';
        passwordInput.value = '';
        webDAVToggle.checked = false;
        configStatus.classList.remove('configured');
        configStatus.classList.add('not-configured');
    }
}

/**
 * 加载WebDAV开关状态。
 * @async
 */
async function loadWebDAVToggleStatus() {
    try {
        const config = await new Promise(resolve => {
            chrome.storage.local.get(['webDAVEnabled'], resolve); // 使用 chrome.storage
        });

        const webDAVToggle = document.getElementById('webDAVToggle');
        if (webDAVToggle) {
            // 修改默认状态为关闭
            webDAVToggle.checked = config.webDAVEnabled === true;
        }
    } catch (error) {
    }
}

/**
 * 加载并显示 GitHub Repository 配置（云端2）。
 * @async
 */
async function loadAndDisplayGitHubRepoConfig() {
    const { ownerInput, nameInput, branchInput, basePathInput, tokenInput, githubRepoInfoDisplay } = getGitHubRepoInputElements();
    const toggle = document.getElementById('githubRepoToggle');
    const configStatus = document.getElementById('githubRepoConfigStatus');

    if (!ownerInput || !nameInput || !branchInput || !basePathInput || !tokenInput || !githubRepoInfoDisplay || !toggle || !configStatus) {
        return;
    }

    try {
        const data = await new Promise((resolve, reject) => {
            chrome.storage.local.get([
                'preferredLang',
                'githubRepoToken',
                'githubRepoOwner',
                'githubRepoName',
                'githubRepoBranch',
                'githubRepoBasePath',
                'githubRepoEnabled',
                GITHUB_REPO_DRAFT_KEYS.owner,
                GITHUB_REPO_DRAFT_KEYS.name,
                GITHUB_REPO_DRAFT_KEYS.branch,
                GITHUB_REPO_DRAFT_KEYS.basePath,
                GITHUB_REPO_DRAFT_KEYS.token
            ], (result) => {
                if (chrome.runtime.lastError) {
                    return reject(chrome.runtime.lastError);
                }
                resolve(result);
            });
        });

        const lang = data.preferredLang === 'en' ? 'en' : 'zh_CN';
        const isEn = lang === 'en';

        const draftOwner = data[GITHUB_REPO_DRAFT_KEYS.owner];
        const draftName = data[GITHUB_REPO_DRAFT_KEYS.name];
        const draftBranch = data[GITHUB_REPO_DRAFT_KEYS.branch];
        const draftBasePath = data[GITHUB_REPO_DRAFT_KEYS.basePath];
        const draftToken = data[GITHUB_REPO_DRAFT_KEYS.token];

        const displayOwner = (typeof draftOwner === 'string' && draftOwner.length > 0) ? draftOwner : (data.githubRepoOwner || '');
        const displayName = (typeof draftName === 'string' && draftName.length > 0) ? draftName : (data.githubRepoName || '');
        const displayBranch = (typeof draftBranch === 'string' && draftBranch.length > 0) ? draftBranch : (data.githubRepoBranch || '');
        const displayBasePath = (typeof draftBasePath === 'string' && draftBasePath.length > 0) ? draftBasePath : (data.githubRepoBasePath || '');
        const displayToken = (typeof draftToken === 'string' && draftToken.length > 0) ? draftToken : (data.githubRepoToken || '');

        ownerInput.value = displayOwner;
        nameInput.value = displayName;
        branchInput.value = displayBranch;
        basePathInput.value = displayBasePath;
        tokenInput.value = displayToken;

        const repoText = displayOwner && displayName
            ? `${displayOwner}/${displayName}`
            : (isEn ? '(not configured)' : '（未配置）');
        const branchText = displayBranch
            ? displayBranch
            : (isEn ? 'Default branch' : '默认分支');
        const basePathText = displayBasePath
            ? displayBasePath
            : (isEn ? 'Repository root' : '仓库根目录');

        const exportRootFolder = isEn ? 'Bookmark Backup' : '书签备份';
        const basePathTrimmed = String(displayBasePath || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
        const previewPath = `${basePathTrimmed ? `${basePathTrimmed}/` : ''}${exportRootFolder}/...`;

        const lines = isEn
            ? [
                `Repository: ${repoText}`,
                `Branch: ${branchText}`,
                `Base Path: ${basePathText}`,
                `Write to: ${previewPath}`,
                `Note: Folders are created automatically; structure matches WebDAV/Local exports.`
            ]
            : [
                `仓库：${repoText}`,
                `分支：${branchText}`,
                `Base Path：${basePathText}`,
                `写入预览：${previewPath}`,
                `说明：目录结构与 WebDAV/本地导出一致（目录不存在会自动创建）。`
            ];

        githubRepoInfoDisplay.textContent = lines.join('\n');
        githubRepoInfoDisplay.style.color = 'var(--theme-text-secondary)';

        const isConfigured = !!(data.githubRepoToken && data.githubRepoOwner && data.githubRepoName);
        const isEnabled = data.githubRepoEnabled === true;

        toggle.checked = isEnabled;

        if (isConfigured && isEnabled) {
            configStatus.classList.remove('not-configured');
            configStatus.classList.add('configured');
        } else {
            configStatus.classList.remove('configured');
            configStatus.classList.add('not-configured');
        }
    } catch (error) {
        ownerInput.value = '';
        nameInput.value = '';
        branchInput.value = '';
        basePathInput.value = '';
        tokenInput.value = '';
        githubRepoInfoDisplay.textContent = '—';
        toggle.checked = false;
        configStatus.classList.remove('configured');
        configStatus.classList.add('not-configured');
    }
}

/**
 * 加载 GitHub Repository 开关状态。
 * @async
 */
async function loadGitHubRepoToggleStatus() {
    try {
        const config = await new Promise(resolve => {
            chrome.storage.local.get(['githubRepoEnabled'], resolve);
        });

        const toggle = document.getElementById('githubRepoToggle');
        if (toggle) {
            toggle.checked = config.githubRepoEnabled === true;
        }
    } catch (error) {
    }
}

/**
 * 更新下载路径显示。
 */
function updateDownloadPathDisplay() {
    const downloadPathDisplay = document.getElementById('downloadPathDisplay');
    if (!downloadPathDisplay) return;


    // 显示加载状态
    downloadPathDisplay.textContent = "正在获取下载路径...";
    downloadPathDisplay.style.color = "#666";

    // 获取浏览器默认下载路径
    chrome.runtime.sendMessage({ action: "getDownloadPath" }, function (response) {
        if (response && response.path) {
            // 显示估计的路径
            downloadPathDisplay.textContent = response.path;
            downloadPathDisplay.style.color = "var(--theme-text-secondary)";
        } else {
            downloadPathDisplay.textContent = "无法获取下载路径，请参考下方示例";
            downloadPathDisplay.style.color = "var(--theme-text-secondary)";
        }
    });
}

/**
 * Helper function to update the local config status dot.
 */
function updateLocalStatusDot() {
    const localConfigStatusDot = document.getElementById('localConfigStatus');
    if (!localConfigStatusDot) return;

    // 从storage中获取状态和路径
    chrome.storage.local.get([ // 使用 chrome.storage
        'defaultDownloadEnabled'
    ], function (result) {
        const defaultDownloadEnabled = result.defaultDownloadEnabled === true;

        // 只有当defaultDownloadEnabled为true时才显示绿点，否则显示红点
        if (defaultDownloadEnabled) {
            localConfigStatusDot.classList.remove('not-configured');
            localConfigStatusDot.classList.add('configured');
        } else {
            localConfigStatusDot.classList.remove('configured');
            localConfigStatusDot.classList.add('not-configured');
        }
    });
}

/**
 * 更新备份历史记录。
 * @param {string} [passedLang] - 可选参数，用于指定语言。
 */
function updateSyncHistory(passedLang) { // Added passedLang parameter
    const PAGE_SIZE = 10;
    const getLangPromise = passedLang
        ? Promise.resolve(passedLang)
        : new Promise(resolve => chrome.storage.local.get(['preferredLang'], result => resolve(result.preferredLang || 'zh_CN')));

    Promise.all([
        getLangPromise, // Add promise to get language
        new Promise(resolve => {
            const requestedPage = (typeof window.__syncHistoryCurrentPage === 'number' && window.__syncHistoryCurrentPage > 0)
                ? window.__syncHistoryCurrentPage
                : 1;

            chrome.runtime.sendMessage({
                action: "getSyncHistory",
                paged: true,
                page: requestedPage,
                pageSize: PAGE_SIZE
            }, response => {
                if (chrome.runtime.lastError) {
                    console.error('获取备份历史记录失败:', chrome.runtime.lastError.message);
                    resolve({
                        syncHistory: [],
                        totalRecords: 0,
                        totalPages: 1,
                        currentPage: 1,
                        pageSize: PAGE_SIZE
                    });
                    return;
                }
                if (response && response.success) {
                    resolve({
                        syncHistory: Array.isArray(response.syncHistory) ? response.syncHistory : [],
                        totalRecords: Number.isFinite(Number(response.totalRecords)) ? Number(response.totalRecords) : 0,
                        totalPages: Number.isFinite(Number(response.totalPages)) ? Number(response.totalPages) : 1,
                        currentPage: Number.isFinite(Number(response.currentPage)) ? Number(response.currentPage) : requestedPage,
                        pageSize: Number.isFinite(Number(response.pageSize)) ? Number(response.pageSize) : PAGE_SIZE
                    });
                }
                else {
                    console.error('获取备份历史记录失败 in Promise:', response);
                    resolve({
                        syncHistory: [],
                        totalRecords: 0,
                        totalPages: 1,
                        currentPage: 1,
                        pageSize: PAGE_SIZE
                    });
                }
            });
        }),
        new Promise(resolve => {
            chrome.storage.local.get('cachedRecordAfterClear', result => {
                resolve(result.cachedRecordAfterClear);
            });
        })
    ]).then(([currentLang, historyPageData, cachedRecord]) => { // currentLang is now from getLangPromise
        const syncHistory = Array.isArray(historyPageData?.syncHistory) ? historyPageData.syncHistory : [];
        const totalRecords = Number.isFinite(Number(historyPageData?.totalRecords))
            ? Number(historyPageData.totalRecords)
            : syncHistory.length;
        const totalPages = Math.max(1, Number.isFinite(Number(historyPageData?.totalPages))
            ? Number(historyPageData.totalPages)
            : 1);
        const currentPage = Math.min(
            totalPages,
            Math.max(1, Number.isFinite(Number(historyPageData?.currentPage)) ? Number(historyPageData.currentPage) : 1)
        );
        const responsePageSize = Number.isFinite(Number(historyPageData?.pageSize))
            ? Number(historyPageData.pageSize)
            : PAGE_SIZE;

        const historyList = document.getElementById('syncHistoryList');
        if (!historyList) return;

        // 强制隐藏横向滚动条
        historyList.style.overflowX = 'hidden';

        // 为详情按钮/条目点击添加全局事件委托（只绑定一次，避免分页刷新重复绑定）
        if (!historyList.hasAttribute('data-details-delegated')) {
            historyList.addEventListener('click', (e) => {
                // 备注编辑：不触发跳转
                if (e.target.closest('.editable-note')) return;

                // 明确的跳转按钮：恢复
                if (e.target.closest('.history-jump-restore-btn')) {
                    const btn = e.target.closest('.history-jump-restore-btn');
                    const recordTime = btn.getAttribute('data-record-time');
                    if (recordTime) {
                        const historyPageUrl = chrome.runtime.getURL('history_html/history.html') + `?view=history&record=${recordTime}&action=restore`;
                        window.open(historyPageUrl, '_blank');
                    }
                    return;
                }

                // 明确的跳转按钮：搜索
                if (e.target.closest('.history-jump-search-btn')) {
                    const btn = e.target.closest('.history-jump-search-btn');
                    const recordTime = btn.getAttribute('data-record-time');
                    if (recordTime) {
                        const historyPageUrl = chrome.runtime.getURL('history_html/history.html') + `?view=history&record=${recordTime}&action=detail-search`;
                        window.open(historyPageUrl, '_blank');
                    }
                    return;
                }

                // 明确的跳转按钮：详情
                if (e.target.closest('.details-btn')) {
                    const btn = e.target.closest('.details-btn');
                    const recordTime = btn.getAttribute('data-record-time');
                    if (recordTime) {
                        const historyPageUrl = chrome.runtime.getURL('history_html/history.html') + `?view=history&record=${recordTime}&action=detail`;
                        window.open(historyPageUrl, '_blank');
                    }
                    return;
                }

                // 点击整条记录任意区域也跳转（不要覆盖备注编辑）
                const item = e.target.closest('.history-item');
                if (item) {
                    const recordTime = item.getAttribute('data-record-time');
                    if (recordTime) {
                        const historyPageUrl = chrome.runtime.getURL('history_html/history.html') + `?view=history&record=${recordTime}`;
                        window.open(historyPageUrl, '_blank');
                    }
                }
            });
            historyList.setAttribute('data-details-delegated', 'true');
        }

        // 添加动态内容的翻译
        const dynamicTextStrings = {
            'bookmarksText': {
                'zh_CN': "个书签",
                'en': "BKM"
            },
            'foldersText': {
                'zh_CN': "个文件夹",
                'en': "FLD"
            },
            'cloudText': {
                'zh_CN': "云端",
                'en': "Cloud"
            },
            'cloud1Text': {
                'zh_CN': "云端1(WebDAV)",
                'en': "Cloud 1 (WebDAV)"
            },
            'cloud2Text': {
                'zh_CN': "云端2(GitHub仓库)",
                'en': "Cloud 2 (GitHub Repo)"
            },
            'localText': {
                'zh_CN': "本地",
                'en': "Local"
            },
            'cloudAndLocalText': {
                'zh_CN': "云端与本地",
                'en': "Cloud & Local"
            },
            'backupUpdatedText': {
                'zh_CN': "备份已更新",
                'en': "Backup updated"
            },
            'noBackupNeededText': {
                'zh_CN': "无需备份",
                'en': "No backup needed"
            },
            'checkCompletedText': {
                'zh_CN': "检查完成",
                'en': "Check completed"
            },
            'manualText': {
                'zh_CN': "（手动）",
                'en': "(Manual)"
            },
            'autoText': {
                'zh_CN': "（自动）",
                'en': "(Auto)"
            },
            'switchText': {
                'zh_CN': "（切换）",
                'en': "(Switch)"
            },
            'noChangesText': {
                'zh_CN': "无变化",
                'en': "No changes"
            },
            'firstBackupText': {
                'zh_CN': "第一次备份",
                'en': "First backup"
            },
            'statsNotAvailableText': {
                'zh_CN': "统计不可用",
                'en': "Stats unavailable"
            },
            'emptyStateText': {
                'zh_CN': "暂无备份记录",
                'en': "No backup records"
            },
            'errorText': {
                'zh_CN': "检查失败",
                'en': "Check failed"
            },
            'fileLockText': {
                'zh_CN': "云端文件被占用",
                'en': "Cloud file locked"
            },
            'bookmarkChangedText': {
                'zh_CN': "书签变动",
                'en': "BKM changed" // Changed from "bookmarks changed"
            },
            'folderChangedText': {
                'zh_CN': "文件夹变动",
                'en': "FLD changed" // Changed from "folders changed"
            },
            'backupHistoryTitle': {
                'zh_CN': "备份历史",
                'en': "Backup History"
            },
            'quantityStructureTitle': {
                'zh_CN': "数量/结构",
                'en': "Quantity/Structure"
            },
            'bookmarksAndFoldersChangedText': {
                'zh_CN': "书签和文件夹变动",
                'en': "BKM & FLD changed" // Changed from "bookmarks & folders changed"
            }
        };

        let cacheWasUsedForListDisplay = false; // 标记缓存是否在此次渲染中被使用

        // 清空除了标题行外的所有内容
        const existingHeader = historyList.querySelector('.history-header');
        historyList.innerHTML = ''; // 清空列表

        let headerHTML = '';
        if (currentLang === 'en') {
            headerHTML = `
                <div class="header-item header-action">No.</div>
                <div class="header-item" style="flex: 1; text-align: center;">Time & Notes</div>
                <div class="header-item" style="flex: 1; text-align: center;">Quantity & Structure</div>
                <div class="header-item header-ops">Ops</div>
            `;
        } else {
            headerHTML = `
                <div class="header-item header-action">序号</div>
                <div class="header-item" style="flex: 1; text-align: center;">时间与备注</div>
                <div class="header-item" style="flex: 1; text-align: center;">数量与结构</div>
                <div class="header-item header-ops">操作</div>
            `;
        }

        const newHeader = document.createElement('div');
        newHeader.className = 'history-header';
        newHeader.innerHTML = headerHTML;
        historyList.appendChild(newHeader);

        if (syncHistory.length > 0) {
            if (typeof window.__syncHistoryCurrentPage !== 'number') window.__syncHistoryCurrentPage = 1;
            window.__syncHistoryTotalPages = totalPages;
            window.__syncHistoryCurrentPage = currentPage;

            const startIndex = (currentPage - 1) * responsePageSize;
            const pageRecords = syncHistory;

            // 添加一个变量来跟踪上一条记录的日期和上一个元素
            let previousDate = null;
            let lastHistoryItem = null;

            pageRecords.forEach((record, index) => {
                const globalIndex = startIndex + index;
                const historyItem = document.createElement('div');
                historyItem.className = 'history-item';
                historyItem.setAttribute('data-record-time', record.time);
                // 优先使用记录中的永久序号，兼容旧记录（回退到计算的序号）
                const seqNumber = record.seqNumber || Math.max(1, totalRecords - globalIndex);

                const time = new Date(record.time);

                // 检查日期是否变化（年月日）
                const currentDateStr = `${time.getFullYear()}-${time.getMonth() + 1}-${time.getDate()}`;
                const previousDateObj = previousDate ? new Date(previousDate) : null;
                const previousDateStr = previousDateObj ? `${previousDateObj.getFullYear()}-${previousDateObj.getMonth() + 1}-${previousDateObj.getDate()}` : null;

                // 如果日期变化且不是第一条记录，在两条记录之间插入日期分割线
                if (previousDateStr && currentDateStr !== previousDateStr && lastHistoryItem) {
                    const dividerColor = '#007AFF';
                    const textColor = '#007AFF';

                    // 移除上一条记录自身的默认底部分割线，避免双线
                    lastHistoryItem.style.borderBottom = 'none';

                    // 格式化日期显示（显示上一条记录所属日期）
                    const formattedDate = currentLang === 'en'
                        ? `${previousDateObj.getFullYear()}-${(previousDateObj.getMonth() + 1).toString().padStart(2, '0')}-${previousDateObj.getDate().toString().padStart(2, '0')}`
                        : `${previousDateObj.getFullYear()}年${previousDateObj.getMonth() + 1}月${previousDateObj.getDate()}日`;

                    const divider = document.createElement('div');
                    divider.className = 'history-date-divider';
                    divider.style.cssText = `
                        display: flex;
                        align-items: center;
                        gap: 10px;
                        margin: 10px 0;
                        padding: 0 8px;
                    `;

                    const lineStyle = `
                        flex: 1;
                        height: 0;
                        border-top: 1px solid ${dividerColor};
                        opacity: 0.85;
                    `;

                    const leftLine = document.createElement('span');
                    leftLine.style.cssText = lineStyle;

                    const text = document.createElement('span');
                    text.textContent = formattedDate;
                    text.style.cssText = `
                        white-space: nowrap;
                        font-size: 12px;
                        font-weight: 600;
                        line-height: 1;
                        color: ${textColor};
                    `;

                    const rightLine = document.createElement('span');
                    rightLine.style.cssText = lineStyle;

                    divider.appendChild(leftLine);
                    divider.appendChild(text);
                    divider.appendChild(rightLine);

                    historyList.appendChild(divider);
                }

                // 更新前一条记录的时间和元素引用，用于下次比较
                previousDate = record.time;
                lastHistoryItem = historyItem;

                let statusHTML = '';
                let statusClass = '';

                if (record.status === 'error') {
                    statusHTML = `<div>${record.errorMessage || dynamicTextStrings.errorText[currentLang] || '检查失败'}</div>`;
                    statusClass = 'error';
                } else if (record.status === 'locked') {
                    statusHTML = `<div>${dynamicTextStrings.fileLockText[currentLang] || '云端文件被占用'}</div>`;
                    statusClass = 'locked';
                } else {
                    let locationText = '';
                    if (record.direction === 'none') {
                        locationText = dynamicTextStrings.noBackupNeededText[currentLang] || '无需备份';
                    } else {
                        const cloudStyle = "color: #007AFF; font-weight: bold;";
                        const localStyle = "color: #9370DB; font-weight: bold;";
                        const cloud1Text = dynamicTextStrings.cloud1Text?.[currentLang] || dynamicTextStrings.cloud1Text?.zh_CN || '云端1(WebDAV)';
                        const cloud2Text = dynamicTextStrings.cloud2Text?.[currentLang] || dynamicTextStrings.cloud2Text?.zh_CN || '云端2(GitHub仓库)';
                        const cloudText = dynamicTextStrings.cloudText?.[currentLang] || dynamicTextStrings.cloudText?.zh_CN || '云端';
                        const localText = dynamicTextStrings.localText?.[currentLang] || dynamicTextStrings.localText?.zh_CN || '本地';
                        const joinText = currentLang === 'en' ? ' & ' : '与';

                        if (record.direction === 'cloud_local') {
                            locationText = `<span style="${cloudStyle}">${cloud1Text}</span>${joinText}<span style="${cloudStyle}">${cloud2Text}</span>${joinText}<span style="${localStyle}">${localText}</span>`;
                        } else if (record.direction === 'webdav_local' || record.direction === 'both') {
                            locationText = `<span style="${cloudStyle}">${cloud1Text}</span>${joinText}<span style="${localStyle}">${localText}</span>`;
                        } else if (record.direction === 'github_repo_local' || record.direction === 'gist_local') {
                            locationText = `<span style="${cloudStyle}">${cloud2Text}</span>${joinText}<span style="${localStyle}">${localText}</span>`;
                        } else if (record.direction === 'cloud') {
                            locationText = `<span style="${cloudStyle}">${cloud1Text}</span>${joinText}<span style="${cloudStyle}">${cloud2Text}</span>`;
                        } else if (record.direction === 'webdav') {
                            locationText = `<span style="${cloudStyle}">${cloud1Text}</span>`;
                        } else if (record.direction === 'github_repo' || record.direction === 'gist') {
                            locationText = `<span style="${cloudStyle}">${cloud2Text}</span>`;
                        } else if (record.direction === 'local' || record.direction === 'download') {
                            locationText = `<span style="${localStyle}">${localText}</span>`;
                        } else if (record.direction === 'upload') {
                            locationText = `<span style="${cloudStyle}">${cloudText}</span>`;
                        }
                    }
                    let actionText = (record.direction === 'none') ?
                        (dynamicTextStrings.checkCompletedText[currentLang] || '检查完成') :
                        (dynamicTextStrings.backupUpdatedText[currentLang] || '备份已更新');
                    let typeText = '';
                    // 使用 background.js 中存储的实际 type 值进行比较
                    if (record.type === 'manual') {
                        typeText = `<span style="color: #007AFF; font-weight: bold;">${dynamicTextStrings.manualText[currentLang] || '（手动）'}</span>`;
                    } else if (record.type === 'switch' || record.type === 'auto_switch') { // 兼容 'auto_switch' 以防万一
                        typeText = `<span style="color: #FF9800; font-weight: bold;">${dynamicTextStrings.switchText[currentLang] || '（切换）'}</span>`;
                    } else { // 默认为 'auto' 或其他未明确处理的类型
                        typeText = `<span style="color: #4CAF50; font-weight: bold;">${dynamicTextStrings.autoText[currentLang] || '（自动）'}</span>`; // 修改此处的颜色为绿色
                    }
                    statusHTML = `<div>${locationText}</div><div>${actionText}</div><div>${typeText}</div>`;
                    statusClass = 'success';
                }

                let bookmarkStatsHTML = '';
                if (record.bookmarkStats) {
                    const currentBookmarkCount = record.bookmarkStats.currentBookmarks ?? record.bookmarkStats.currentBookmarkCount ?? 0;
                    const currentFolderCount = record.bookmarkStats.currentFolders ?? record.bookmarkStats.currentFolderCount ?? 0;

                    let bookmarkDiff = 0;
                    let folderDiff = 0;

                    // 尝试从记录本身的字段获取显式差异 (通常由background.js计算)
                    let explicitBookmarkDiffInRecord, explicitFolderDiffInRecord;
                    let recordHasAnyExplicitDiff = false;

                    // 这里的旧逻辑主要是为了那些没有详细 added/deleted 字段的老旧记录
                    // 但由于UI已经不再显示单纯的 diff 总数，这些变量主要用于内部逻辑完整性
                    if (record.bookmarkStats.bookmarkDiff !== undefined) {
                        explicitBookmarkDiffInRecord = record.bookmarkStats.bookmarkDiff;
                        recordHasAnyExplicitDiff = true;
                    }

                    if (record.bookmarkStats.folderDiff !== undefined) {
                        explicitFolderDiffInRecord = record.bookmarkStats.folderDiff;
                        recordHasAnyExplicitDiff = true;
                    }

                    // 即使没有详细统计，我们也不再通过对比历史记录来“猜测”差异
                    // 直接信任记录中保存的 diff 值（如果有的话），或者为 0
                    bookmarkDiff = explicitBookmarkDiffInRecord !== undefined ? explicitBookmarkDiffInRecord : 0;
                    folderDiff = explicitFolderDiffInRecord !== undefined ? explicitFolderDiffInRecord : 0;

                    // ... (原有的根据 bookmarkDiff, folderDiff, 结构变化等格式化 bookmarkStatsHTML 的逻辑)
                    const bookmarkMoved = record.bookmarkStats.bookmarkMoved || false;
                    const folderMoved = record.bookmarkStats.folderMoved || false;
                    const bookmarkModified = record.bookmarkStats.bookmarkModified || false;
                    const folderModified = record.bookmarkStats.folderModified || false;
                    const recordBookmarkAdded = typeof record.bookmarkStats.bookmarkAdded === 'number' ? record.bookmarkStats.bookmarkAdded : 0;
                    const recordBookmarkDeleted = typeof record.bookmarkStats.bookmarkDeleted === 'number' ? record.bookmarkStats.bookmarkDeleted : 0;
                    const recordFolderAdded = typeof record.bookmarkStats.folderAdded === 'number' ? record.bookmarkStats.folderAdded : 0;
                    const recordFolderDeleted = typeof record.bookmarkStats.folderDeleted === 'number' ? record.bookmarkStats.folderDeleted : 0;
                    const hasAnyNumberColor = bookmarkDiff !== 0 || folderDiff !== 0 ||
                        recordBookmarkAdded > 0 || recordBookmarkDeleted > 0 ||
                        recordFolderAdded > 0 || recordFolderDeleted > 0;
                    const hasStructuralChange = bookmarkMoved || folderMoved || bookmarkModified || folderModified;
                    const hasAnyChange = hasAnyNumberColor || hasStructuralChange;

                    // 使用国际化文本
                    const bookmarkText = dynamicTextStrings.bookmarksText[currentLang] || '个书签';
                    const folderText = dynamicTextStrings.foldersText[currentLang] || '个文件夹';

                    // 根据语言格式化数量显示
                    let formattedBookmarkCount, formattedFolderCount;
                    if (currentLang === 'en') {
                        // 英文：数字和单位之间有空格
                        formattedBookmarkCount = `${currentBookmarkCount} ${bookmarkText}`;
                        formattedFolderCount = `${currentFolderCount} ${folderText}`;
                    } else {
                        // 中文：数字和单位之间加空格
                        formattedBookmarkCount = `${currentBookmarkCount} ${bookmarkText}`;
                        formattedFolderCount = `${currentFolderCount} ${folderText}`;
                    }

                    const buildStatBadge = () => {
                        // 按用户期望固定换行：
                        // 1) 增加（书签/文件夹）
                        // 2) 减少（书签/文件夹）
                        // 3) 结构变化（移动/修改）
                        const lines = [];
                        const bookmarkLabel = currentLang === 'en' ? 'BKM' : '书签';
                        const folderLabel = currentLang === 'en' ? 'FLD' : '文件夹';

                        const bookmarkAddedCount = (typeof record.bookmarkStats.bookmarkAdded === 'number')
                            ? record.bookmarkStats.bookmarkAdded
                            : (bookmarkDiff > 0 ? bookmarkDiff : 0);
                        const bookmarkDeletedCount = (typeof record.bookmarkStats.bookmarkDeleted === 'number')
                            ? record.bookmarkStats.bookmarkDeleted
                            : (bookmarkDiff < 0 ? Math.abs(bookmarkDiff) : 0);
                        const folderAddedCount = (typeof record.bookmarkStats.folderAdded === 'number')
                            ? record.bookmarkStats.folderAdded
                            : (folderDiff > 0 ? folderDiff : 0);
                        const folderDeletedCount = (typeof record.bookmarkStats.folderDeleted === 'number')
                            ? record.bookmarkStats.folderDeleted
                            : (folderDiff < 0 ? Math.abs(folderDiff) : 0);

                        const addedParts = [];
                        if (bookmarkAddedCount > 0) {
                            addedParts.push(`<span class="history-stat-label">${bookmarkLabel}</span> <span class="history-stat-color added">+${bookmarkAddedCount}</span>`);
                        }
                        if (folderAddedCount > 0) {
                            addedParts.push(`<span class="history-stat-label">${folderLabel}</span> <span class="history-stat-color added">+${folderAddedCount}</span>`);
                        }
                        if (addedParts.length > 0) {
                            lines.push(addedParts.join(' '));
                        }

                        const deletedParts = [];
                        if (bookmarkDeletedCount > 0) {
                            deletedParts.push(`<span class="history-stat-label">${bookmarkLabel}</span> <span class="history-stat-color deleted">-${bookmarkDeletedCount}</span>`);
                        }
                        if (folderDeletedCount > 0) {
                            deletedParts.push(`<span class="history-stat-label">${folderLabel}</span> <span class="history-stat-color deleted">-${folderDeletedCount}</span>`);
                        }
                        if (deletedParts.length > 0) {
                            lines.push(deletedParts.join(' '));
                        }

                        // 优先使用保存的 movedCount（与当前变化视图一致的计算方式）
                        let movedTotal = 0;
                        if (typeof record.bookmarkStats.movedCount === 'number' && record.bookmarkStats.movedCount > 0) {
                            movedTotal = record.bookmarkStats.movedCount;
                        } else {
                            // 兼容旧数据：从 bookmarkMoved 和 folderMoved 计算
                            const bookmarkMovedCount = typeof record.bookmarkStats.bookmarkMoved === 'number'
                                ? record.bookmarkStats.bookmarkMoved
                                : (record.bookmarkStats.bookmarkMoved ? 1 : 0);
                            const folderMovedCount = typeof record.bookmarkStats.folderMoved === 'number'
                                ? record.bookmarkStats.folderMoved
                                : (record.bookmarkStats.folderMoved ? 1 : 0);
                            movedTotal = bookmarkMovedCount + folderMovedCount;
                        }

                        // 优先使用保存的 modifiedCount（与当前变化视图一致的计算方式）
                        let modifiedTotal = 0;
                        if (typeof record.bookmarkStats.modifiedCount === 'number' && record.bookmarkStats.modifiedCount > 0) {
                            modifiedTotal = record.bookmarkStats.modifiedCount;
                        } else {
                            // 兼容旧数据：从 bookmarkModified 和 folderModified 计算
                            const bookmarkModifiedCount = typeof record.bookmarkStats.bookmarkModified === 'number'
                                ? record.bookmarkStats.bookmarkModified
                                : (record.bookmarkStats.bookmarkModified ? 1 : 0);
                            const folderModifiedCount = typeof record.bookmarkStats.folderModified === 'number'
                                ? record.bookmarkStats.folderModified
                                : (record.bookmarkStats.folderModified ? 1 : 0);
                            modifiedTotal = bookmarkModifiedCount + folderModifiedCount;
                        }

                        const structuralParts = [];
                        if (movedTotal > 0) {
                            const movedLabel = currentLang === 'en' ? 'Moved' : '移动';
                            structuralParts.push(`<span class="history-stat-label">${movedLabel}</span> <span class="history-stat-color moved">${movedTotal}</span>`);
                        }
                        if (modifiedTotal > 0) {
                            const modifiedLabel = currentLang === 'en' ? 'Modified' : '修改';
                            structuralParts.push(`<span class="history-stat-label">${modifiedLabel}</span> <span class="history-stat-color modified">${modifiedTotal}</span>`);
                        }
                        if (structuralParts.length > 0) {
                            lines.push(structuralParts.join(' '));
                        }

                        if (lines.length === 0) {
                            // 仅当明确标记为首次备份时展示“第一次备份”；
                            // 兼容旧数据：若没有 isFirstBackup 字段，再退回到“只有一条记录”的判断
                            const isFirstBackup = record.isFirstBackup === true ||
                                (typeof record.isFirstBackup !== 'boolean' && (!record.time || totalRecords <= 1));
                            if (isFirstBackup && !(cachedRecord && totalRecords === 1 && record.time > cachedRecord.time)) {
                                return `<span class="history-stat-badge first">${dynamicTextStrings.firstBackupText[currentLang] || '第一次备份'}</span>`;
                            }
                            return `<span class="history-stat-badge no-change">${dynamicTextStrings.noChangesText[currentLang] || '无变化'}</span>`;
                        }

                        if (lines.length === 1) {
                            return `<span class="history-stat-badge">${lines[0]}</span>`;
                        }

                        return `<span class="history-stat-badge multi-line">${lines.map(line => `<span class="history-stat-line">${line}</span>`).join('')}</span>`;
                    };

                    if (hasAnyChange) {
                        bookmarkStatsHTML += `<div class="history-stat-row">${buildStatBadge()}</div>`;
                    } else {
                        bookmarkStatsHTML += `<div class="history-stat-row">${buildStatBadge()}</div>`;
                    }
                    // ... (结束 bookmarkStatsHTML 格式化逻辑)
                } else {
                    bookmarkStatsHTML = `<div style="text-align: center; color: #999;">${dynamicTextStrings.statsNotAvailableText[currentLang] || '统计不可用'}</div>`;
                }

                const formattedTime = `<span style="font-weight: bold; color: #007AFF; text-align: center;">${formatTime(time)}</span>`;

                // 备注部分：可点击编辑，悬浮时出现虚线框
                let noteHtml = '';

                const rawNote = (record.note && typeof record.note === 'string') ? record.note.trim() : '';
                const isEn = currentLang === 'en';

                const manualLabel = isEn ? 'Manual Backup' : '手动备份';
                const switchLabel = isEn ? 'Switch Backup' : '切换备份';
                const autoPrefix = isEn ? 'Auto Backup' : '自动备份';
                const autoRealtimeLabel = isEn ? `${autoPrefix}--Realtime` : `${autoPrefix}--实时`;
                const autoRegularLabel = isEn ? `${autoPrefix}--Regular` : `${autoPrefix}--常规`;
                const autoSpecificLabel = isEn ? `${autoPrefix}--Specific` : `${autoPrefix}--特定`;

                const recordType = record.type || (() => {
                    if (rawNote === '手动备份' || rawNote === 'Manual Backup') return 'manual';
                    if (rawNote === '切换备份' || rawNote === 'Switch Backup') return 'switch';
                    return 'auto';
                })();

                const lowerNote = rawNote.toLowerCase();
                const looksLikeSpecificReason = rawNote.includes('特定') ||
                    lowerNote.includes('specific') ||
                    /\d{4}-\d{2}-\d{2}[ tT]\d{2}:\d{2}/.test(rawNote);
                const looksLikeRegularReason = rawNote.includes('每') ||
                    rawNote.includes('周') ||
                    lowerNote.includes('every');
                // 兼容旧记录：可能只保存了原因（如：周一/每1小时/特定：...），没有“自动备份 - ”前缀
                const looksLikeLegacyReasonOnly = (recordType === 'auto') && (looksLikeSpecificReason || looksLikeRegularReason);

                const isSystemManualNote = !rawNote || rawNote === '手动备份' || rawNote === 'Manual Backup';
                const isSystemSwitchNote = !rawNote || rawNote === '切换备份' || rawNote === 'Switch Backup';
                const isSystemAutoNote = !rawNote ||
                    rawNote === '自动备份' ||
                    rawNote === 'Auto Backup' ||
                    rawNote.startsWith('自动备份 - ') ||
                    rawNote.startsWith('Auto Backup - ') ||
                    rawNote.startsWith('自动备份--') ||
                    rawNote.startsWith('Auto Backup--') ||
                    looksLikeLegacyReasonOnly;

                const displayNote = (() => {
                    if (recordType === 'switch' || recordType === 'auto_switch') {
                        return isSystemSwitchNote ? switchLabel : rawNote;
                    }

                    if (recordType === 'manual') {
                        return isSystemManualNote ? manualLabel : rawNote;
                    }

                    // 自动备份：按「实时 / 常规 / 特定」归类显示
                    if (isSystemAutoNote) {
                        if (looksLikeSpecificReason) return autoSpecificLabel;
                        if (rawNote.includes('常规') || lowerNote.includes('regular')) return autoRegularLabel;
                        if (rawNote.includes(' - ') || looksLikeRegularReason) return autoRegularLabel;
                        return autoRealtimeLabel;
                    }

                    // 用户自定义备注：原样显示
                    return rawNote;
                })();
                if (displayNote) {
                    // 备注文本可点击，悬浮时出现虚线框
                    noteHtml = `<div class="editable-note" data-record-time="${record.time}" style="margin-top: 4px; text-align: center; font-size: 12px; color: var(--theme-text-primary); max-width: 100%; overflow-wrap: break-word; word-wrap: break-word; word-break: break-all; cursor: pointer; padding: 2px 6px; border: 1px dashed transparent; border-radius: 3px; transition: border-color 0.2s;">${displayNote}</div>`;
                }

                // 只保留两栏的样式
                let timeColStyle = "flex: 1; text-align: center;";
                let qtyColStyle = "flex: 1; text-align: center;";

                // 详情按钮：序号按钮 + 跳转图标
                const detailsBtn = `
                    <button class="details-btn" data-record-time="${record.time}" title="${currentLang === 'zh_CN' ? '打开HTML条目' : 'Open HTML entry'}">
                        <span class="details-seq">${seqNumber}</span>
                        <svg class="details-jump-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                            <path d="M6 3.5a.75.75 0 0 1 .75-.75h5.5a.75.75 0 0 1 .75.75v5.5a.75.75 0 0 1-1.5 0V5.31L4.28 12.53a.75.75 0 0 1-1.06-1.06L10.44 4.25H6.75A.75.75 0 0 1 6 3.5z" />
                        </svg>
                    </button>
                `;

                const opsBtns = `
                    <div class="history-ops-row">
                        <button class="history-jump-action-btn history-jump-search-btn" data-record-time="${record.time}" title="${currentLang === 'zh_CN' ? '搜索' : 'Search'}">
                            <i class="fas fa-search"></i>
                        </button>
                        <button class="history-jump-action-btn history-jump-restore-btn" data-record-time="${record.time}" title="${currentLang === 'zh_CN' ? '恢复' : 'Restore'}">
                            <i class="fas fa-undo"></i>
                        </button>
                    </div>
                `;

                historyItem.innerHTML = `
                    <div class="history-item-action">
                        ${detailsBtn}
                    </div>
                    <div class="history-item-time" style="${timeColStyle}">
                        ${formattedTime}
                        ${noteHtml}
                    </div>
                    <div class="history-item-count" style="${qtyColStyle}; display: flex; align-items: center; justify-content: center;">
                        <div style="flex: 1; text-align: center;">${bookmarkStatsHTML}</div>
                    </div>
                    <div class="history-item-ops">
                        ${opsBtns}
                    </div>
                `;
                historyList.appendChild(historyItem);
            });

            // 分页控件（只绑定一次）
            const pager = document.getElementById('syncHistoryPager');
            const prevBtn = document.getElementById('syncHistoryPrevPage');
            const nextBtn = document.getElementById('syncHistoryNextPage');
            const pageInput = document.getElementById('syncHistoryPageInput');
            const totalPagesEl = document.getElementById('syncHistoryTotalPages');

            if (pager && prevBtn && nextBtn && pageInput && totalPagesEl) {
                pager.style.display = totalPages > 1 ? 'inline-flex' : 'none';
                totalPagesEl.textContent = String(totalPages);
                pageInput.value = String(window.__syncHistoryCurrentPage);
                prevBtn.disabled = window.__syncHistoryCurrentPage <= 1;
                nextBtn.disabled = window.__syncHistoryCurrentPage >= totalPages;

                if (!pager.hasAttribute('data-inited')) {
                    prevBtn.addEventListener('click', () => {
                        if (window.__syncHistoryCurrentPage > 1) {
                            window.__syncHistoryCurrentPage -= 1;
                            updateSyncHistory(currentLang);
                        }
                    });
                    nextBtn.addEventListener('click', () => {
                        if (window.__syncHistoryCurrentPage < (window.__syncHistoryTotalPages || 1)) {
                            window.__syncHistoryCurrentPage += 1;
                            updateSyncHistory(currentLang);
                        }
                    });
                    const applyPageFromInput = () => {
                        const target = parseInt(pageInput.value, 10);
                        if (Number.isNaN(target)) {
                            pageInput.value = String(window.__syncHistoryCurrentPage);
                            return;
                        }
                        const clamped = Math.min(Math.max(target, 1), window.__syncHistoryTotalPages || 1);
                        window.__syncHistoryCurrentPage = clamped;
                        updateSyncHistory(currentLang);
                    };
                    pageInput.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') applyPageFromInput();
                    });
                    pageInput.addEventListener('blur', applyPageFromInput);
                    pager.setAttribute('data-inited', 'true');
                }
            }

            // 如果缓存被用于列表显示，或者历史记录已不止一条（缓存的过渡作用已结束），则清除缓存
            if (cachedRecord && (cacheWasUsedForListDisplay || totalRecords > 1)) {
                chrome.storage.local.remove('cachedRecordAfterClear', () => {
                });
            }

            // 为可编辑备注绑定事件（点击编辑）
            document.querySelectorAll('.editable-note').forEach(note => {
                note.addEventListener('click', function (e) {
                    e.stopPropagation();
                    e.preventDefault();
                    const recordTime = this.getAttribute('data-record-time');
                    showAddNoteDialog(recordTime);
                });
            });

        } else {
            const pager = document.getElementById('syncHistoryPager');
            if (pager) pager.style.display = 'none';
            const emptyItem = document.createElement('div');
            emptyItem.className = 'history-item empty-state';

            emptyItem.innerHTML = `
                <div class="history-column" style="flex: 1; text-align: center; color: #999;">/</div>
                <div class="history-column" style="flex: 1; text-align: center; color: #999;">${dynamicTextStrings.emptyStateText[currentLang] || '暂无备份记录'}</div>
                <div class="history-column" style="flex: 0 0 62px; min-width: 62px;"></div>
            `;
            historyList.appendChild(emptyItem);
        }

        updateLastSyncInfo(currentLang); // Pass currentLang when calling updateLastSyncInfo
    }).catch(error => {
        const historyList = document.getElementById('syncHistoryList');
        if (historyList) {
            const headerRow = historyList.querySelector('.history-header');
            historyList.innerHTML = '';
            if (headerRow) historyList.appendChild(headerRow);
            const errorItem = document.createElement('div');
            errorItem.className = 'history-item empty-state';
            errorItem.innerHTML = `<div style="text-align:center; color:red; grid-column: 1 / -1;">无法加载历史记录</div>`; // 横跨所有列
            historyList.appendChild(errorItem);
        }
    });
}

function schedulePopupHistoryRefresh(delayMs = 180) {
    if (popupHistoryRefreshTimer) {
        clearTimeout(popupHistoryRefreshTimer);
        popupHistoryRefreshTimer = null;
    }

    popupHistoryRefreshTimer = setTimeout(() => {
        popupHistoryRefreshTimer = null;
        updateSyncHistory();
        updateLastSyncInfo();
    }, Math.max(0, Number(delayMs) || 0));
}

/**
 * 更新最后备份信息。
 * @param {string} [passedLang] - 可选参数，用于指定语言。
 */
function updateLastSyncInfo(passedLang) { // Added passedLang parameter
    chrome.storage.local.get(['lastSyncTime', 'lastSyncDirection', 'lastBookmarkUpdate', 'lastSyncType'], (data) => { // 使用 chrome.storage
        // 更新最后备份时间
        const lastSyncTimeSpan = document.getElementById('lastSyncTime');
        if (lastSyncTimeSpan && data.lastSyncTime) {
            lastSyncTimeSpan.textContent = formatTime(new Date(data.lastSyncTime));
            // 添加样式使日期显示更突出
            lastSyncTimeSpan.style.fontWeight = 'bold';
            lastSyncTimeSpan.style.color = '#007AFF';
        }

        // 更新最后备份时间
        const lastBackupTimeSpan = document.getElementById('lastBackupTime');
        if (lastBackupTimeSpan && data.lastBookmarkUpdate) {
            lastBackupTimeSpan.textContent = formatTime(new Date(data.lastBookmarkUpdate));
            // 添加样式使日期显示更突出
            lastBackupTimeSpan.style.fontWeight = 'bold';
            lastBackupTimeSpan.style.color = '#007AFF';
        }

        // 更新书签数量统计
        updateBookmarkCountDisplay(passedLang); // Pass passedLang along

        // 更新备份方向
        const syncDirectionSpan = document.getElementById('syncDirection');
        if (syncDirectionSpan && data.lastSyncDirection) {
            let directionHTML = '';
            let statusClass = '';

            if (data.lastSyncDirection === 'error' || data.lastSyncDirection === 'locked') {
                directionHTML = '<div>备份失败</div>';
                statusClass = 'error';
            } else {
                // 第一行：备份位置
                let locationText = '';
                const cloud1Html = '<span style="color: #007AFF; font-weight: bold;">云端1(WebDAV)</span>';
                const cloud2Html = '<span style="color: #007AFF; font-weight: bold;">云端2(GitHub仓库)</span>';
                const localHtml = '<span style="color: #9370DB; font-weight: bold;">本地</span>';

                if (data.lastSyncDirection === 'cloud_local') {
                    locationText = `${cloud1Html}与${cloud2Html}与${localHtml}`;
                } else if (data.lastSyncDirection === 'webdav_local' || data.lastSyncDirection === 'both') {
                    locationText = `${cloud1Html}与${localHtml}`;
                } else if (data.lastSyncDirection === 'github_repo_local' || data.lastSyncDirection === 'gist_local') {
                    locationText = `${cloud2Html}与${localHtml}`;
                } else if (data.lastSyncDirection === 'cloud') {
                    locationText = `${cloud1Html}与${cloud2Html}`;
                } else if (data.lastSyncDirection === 'webdav' || data.lastSyncDirection === 'upload') {
                    locationText = cloud1Html;
                } else if (data.lastSyncDirection === 'github_repo' || data.lastSyncDirection === 'gist') {
                    locationText = cloud2Html;
                } else if (data.lastSyncDirection === 'local' || data.lastSyncDirection === 'download') {
                    locationText = localHtml;
                }

                // 获取备份类型
                const syncType = data.lastSyncType === 'manual' ? '手动' : '自动';

                directionHTML = `
                    <div>${locationText}</div>
                    <div>备份已更新</div>
                    <div><span style="color: ${syncType === '手动' ? '#007AFF' : '#555'}; font-weight: bold;">(${syncType})</span></div>
                `;
                statusClass = 'success';
            }

            syncDirectionSpan.innerHTML = directionHTML;
            syncDirectionSpan.className = `direction ${statusClass}`;
            // 添加样式使备份方向显示更突出
            syncDirectionSpan.style.fontWeight = 'bold';
        }
    });
}

/**
 * 更新书签数量统计显示。
 * @param {string} [passedLang] - 可选参数，用于指定语言。
 */
function updateBookmarkCountDisplay(passedLang) {
    const getLangPromise = passedLang
        ? Promise.resolve(passedLang)
        : new Promise(resolve => chrome.storage.local.get(['preferredLang'], result => resolve(result.preferredLang || 'zh_CN')));

    const getAutoSyncStatePromise = new Promise(resolve => {
        chrome.storage.local.get(['autoSync'], (result) => {
            resolve(result.autoSync !== undefined ? result.autoSync : true);
        });
    });

    // 统一的外部容器样式 (移到顶层作用域，确保在所有分支中可用)
    const containerStyle = "display: block; width: 100%; margin: 2px 0; padding: 0; background-color: transparent; border-radius: 6px; font-size: 12.5px; text-align: center;";
    const mainItemStyle = "word-break: break-all; color: var(--theme-text-primary); text-align: center;";
    const secondaryItemStyle = "margin-top: 5px; font-size: 12px; color: var(--theme-text-secondary); text-align: center;";

    Promise.all([getLangPromise, getAutoSyncStatePromise])
        .then(([currentLang, isAutoSyncEnabled]) => {
            const bookmarkCountSpan = document.getElementById('bookmarkCount');
            const statusCard = document.getElementById('change-description-row');
            const changeDescriptionContainer = document.getElementById('statusCardText') || statusCard;
            const statusCardChevron = document.getElementById('statusCardChevron');

            if (!statusCard || !changeDescriptionContainer) {
                return;
            }

            const applyStatusCardDisplay = ({ html, hasChanges, showChevron }) => {
                changeDescriptionContainer.innerHTML = html;
                statusCard.classList.toggle('has-changes', Boolean(hasChanges));

                if (statusCardChevron) {
                    const shouldShowChevron = (typeof showChevron === 'boolean')
                        ? showChevron
                        : Boolean(hasChanges);
                    statusCardChevron.style.display = shouldShowChevron ? '' : 'none';
                }
            };

            const buildStatusCardChangeSummaryHTML = ({
                bookmarkAddedCount,
                folderAddedCount,
                bookmarkDeletedCount,
                folderDeletedCount,
                movedTotal,
                modifiedTotal
            }) => {
                const isEn = currentLang === 'en';
                const bookmarkLabel = isEn ? 'BKM' : '书签';
                const folderLabel = isEn ? 'FLD' : '文件夹';
                const movedLabel = isEn ? 'Moved' : '移动';
                const modifiedLabel = isEn ? 'Modified' : '修改';

                const lines = [];

                const addedItems = [];
                if (bookmarkAddedCount > 0) {
                    addedItems.push(
                        `<span class="status-card-change-item"><span>${bookmarkLabel}</span><span class="history-stat-color added">+${bookmarkAddedCount}</span></span>`
                    );
                }
                if (folderAddedCount > 0) {
                    addedItems.push(
                        `<span class="status-card-change-item"><span>${folderLabel}</span><span class="history-stat-color added">+${folderAddedCount}</span></span>`
                    );
                }
                if (addedItems.length > 0) {
                    lines.push(`<div class="status-card-change-line">${addedItems.join('')}</div>`);
                }

                const deletedItems = [];
                if (bookmarkDeletedCount > 0) {
                    deletedItems.push(
                        `<span class="status-card-change-item"><span>${bookmarkLabel}</span><span class="history-stat-color deleted">-${bookmarkDeletedCount}</span></span>`
                    );
                }
                if (folderDeletedCount > 0) {
                    deletedItems.push(
                        `<span class="status-card-change-item"><span>${folderLabel}</span><span class="history-stat-color deleted">-${folderDeletedCount}</span></span>`
                    );
                }
                if (deletedItems.length > 0) {
                    lines.push(`<div class="status-card-change-line">${deletedItems.join('')}</div>`);
                }

                const structuralItems = [];
                if (movedTotal > 0) {
                    structuralItems.push(
                        `<span class="status-card-change-item"><span>${movedLabel}</span><span class="history-stat-color moved">${movedTotal}</span></span>`
                    );
                }
                if (modifiedTotal > 0) {
                    structuralItems.push(
                        `<span class="status-card-change-item"><span>${modifiedLabel}</span><span class="history-stat-color modified">${modifiedTotal}</span></span>`
                    );
                }
                if (structuralItems.length > 0) {
                    lines.push(`<div class="status-card-change-line">${structuralItems.join('')}</div>`);
                }

                if (lines.length === 0) return '';
                return `<div class="status-card-change-summary">${lines.join('')}</div>`;
            };

            const buildStatusCardMessageHTML = (text, extraStyle = '') => {
                const safeText = (typeof text === 'string') ? text : '';
                const styleAttr = extraStyle ? ` style="${extraStyle}"` : '';
                return `<div class="status-card-change-summary"><div${styleAttr}>${safeText}</div></div>`;
            };

            // 获取国际化标签 (确保 window.i18nLabels 已由 applyLocalizedContent 设置)
            const i18nBookmarksLabel = window.i18nLabels?.bookmarksLabel || (currentLang === 'en' ? "bookmarks" : "个书签");
            const i18nFoldersLabel = window.i18nLabels?.foldersLabel || (currentLang === 'en' ? "folders" : "个文件夹");

            if (isAutoSyncEnabled) {
                // 设置右侧状态卡片为自动模式样式
                statusCard.classList.add('auto-mode');
                statusCard.classList.remove('manual-mode');
                // --- 自动同步模式 ---
                // 1. 更新 "当前数量/结构:" (Details)
                chrome.runtime.sendMessage({ action: "getBackupStats" }, backupResponse => {
                    if (backupResponse && backupResponse.success && backupResponse.stats) {
                        const currentBookmarkCount = backupResponse.stats.bookmarkCount || 0;
                        const currentFolderCount = backupResponse.stats.folderCount || 0;
                        let quantityText = '';
                        if (currentLang === 'en') {
                            const bmDisplayTerm = "BKM";
                            const fldDisplayTerm = "FLD";
                            quantityText = `<span style="font-weight: bold; color: var(--theme-text-primary);">${currentBookmarkCount} ${bmDisplayTerm}<span style="display:inline-block; width:6px;"></span>,<span style="display:inline-block; width:6px;"></span>${currentFolderCount} ${fldDisplayTerm}</span>`;
                        } else {
                            quantityText = `<span style="font-weight: bold; color: var(--theme-text-primary); display: flex; justify-content: center; align-items: baseline;">
                                                <span style="padding-right: 2px;">${currentBookmarkCount}&nbsp;${i18nBookmarksLabel}</span>
                                                <span>,</span>
                                                <span style="padding-left: 2px;">${currentFolderCount}&nbsp;${i18nFoldersLabel}</span>
                                            </span>`;
                        }
                        if (bookmarkCountSpan) {
                            bookmarkCountSpan.innerHTML = quantityText;
                        }
                    } else {
                        if (bookmarkCountSpan) {
                            bookmarkCountSpan.innerHTML = `<span style="color: orange;">${currentLang === 'en' ? 'Counts unavailable' : '数量暂无法获取'}</span>`;
                        }
                    }
                });

                // 2. 更新 "上次变动" 区域 - 根据备份模式和变化状态显示不同内容
                chrome.storage.local.get(['autoBackupTimerSettings'], (result) => {
                    const backupMode = result.autoBackupTimerSettings?.backupMode || 'regular';

                    chrome.runtime.sendMessage({ action: "getBackupStats" }, backupResponse => {
                        let statusText = '';

                        if (backupMode === 'realtime') {
                            // 实时备份：显示"监测中"
                            statusText = currentLang === 'en'
                                ? '「Realtime」Auto Backup: Monitoring'
                                : '「实时」自动备份：监测中';
                            applyStatusCardDisplay({ html: buildStatusCardMessageHTML(statusText), hasChanges: false });
                            return;
                        } else if (backupMode === 'regular' || backupMode === 'specific' || backupMode === 'both') {
                            // 常规时间/特定时间：使用和手动备份完全一致的差异计算逻辑
                            Promise.all([
                                new Promise((resolve, reject) => {
                                    chrome.runtime.sendMessage({ action: "getSyncHistory" }, response => {
                                        if (response && response.success) resolve(response.syncHistory || []);
                                        else reject(new Error(response?.error || '获取备份历史失败'));
                                    });
                                }),
                                new Promise((resolve) => {
                                    chrome.storage.local.get('cachedRecordAfterClear', result => {
                                        resolve(result.cachedRecordAfterClear);
                                    });
                                }),
                                // 获取 recentMovedIds 和 recentModifiedIds（与当前变化视图一致）
                                new Promise((resolve) => {
                                    chrome.storage.local.get(['recentMovedIds', 'recentModifiedIds'], result => {
                                        resolve({
                                            recentMovedIds: Array.isArray(result.recentMovedIds) ? result.recentMovedIds : [],
                                            recentModifiedIds: Array.isArray(result.recentModifiedIds) ? result.recentModifiedIds : []
                                        });
                                    });
                                })
                            ]).then(([syncHistory, cachedRecordFromStorage, recentIds]) => {
                                if (!backupResponse || !backupResponse.success || !backupResponse.stats) {
                                    const noChangeText = currentLang === 'en' ? 'No changes' : '无变化';
                                    applyStatusCardDisplay({ html: buildStatusCardMessageHTML(noChangeText), hasChanges: false });
                                    return;
                                }

                                const currentBookmarkCount = backupResponse.stats.bookmarkCount || 0;
                                const currentFolderCount = backupResponse.stats.folderCount || 0;

                                // 使用和备份检查记录完全相同的判断逻辑
                                const bookmarkMoved = backupResponse.stats.bookmarkMoved || false;
                                const folderMoved = backupResponse.stats.folderMoved || false;
                                const bookmarkModified = backupResponse.stats.bookmarkModified || false;
                                const folderModified = backupResponse.stats.folderModified || false;

                                // 优先使用 background 的净变化计数；否则回退到 recentXxxIds
                                const movedTotal = (typeof backupResponse.stats.movedCount === 'number')
                                    ? backupResponse.stats.movedCount
                                    : (recentIds.recentMovedIds.length > 0
                                        ? recentIds.recentMovedIds.length
                                        : ((typeof bookmarkMoved === 'number' ? bookmarkMoved : (bookmarkMoved ? 1 : 0)) +
                                            (typeof folderMoved === 'number' ? folderMoved : (folderMoved ? 1 : 0))));
                                const modifiedTotal = (typeof backupResponse.stats.modifiedCount === 'number')
                                    ? backupResponse.stats.modifiedCount
                                    : (recentIds.recentModifiedIds.length > 0
                                        ? recentIds.recentModifiedIds.length
                                        : ((typeof bookmarkModified === 'number' ? bookmarkModified : (bookmarkModified ? 1 : 0)) +
                                            (typeof folderModified === 'number' ? folderModified : (folderModified ? 1 : 0))));
                                const hasStructuralChanges = bookmarkMoved || folderMoved || bookmarkModified || folderModified || movedTotal > 0 || modifiedTotal > 0;

                                // 完全复制手动备份的差异计算逻辑
                                let bookmarkDiff = 0;
                                let folderDiff = 0;
                                let canCalculateDiff = false;

                                if (syncHistory && syncHistory.length > 0) {
                                    // 从末尾向前寻找最近一条包含有效统计的记录
                                    let prevRecordWithStats = null;
                                    for (let i = syncHistory.length - 1; i >= 0; i--) {
                                        const rec = syncHistory[i];
                                        const stats = rec && rec.bookmarkStats;
                                        if (stats && (stats.currentBookmarkCount !== undefined || stats.currentBookmarks !== undefined)
                                            && (stats.currentFolderCount !== undefined || stats.currentFolders !== undefined)) {
                                            prevRecordWithStats = stats;
                                            break;
                                        }
                                    }

                                    if (prevRecordWithStats) {
                                        const prevBookmarkCount = prevRecordWithStats.currentBookmarkCount ?? prevRecordWithStats.currentBookmarks ?? 0;
                                        const prevFolderCount = prevRecordWithStats.currentFolderCount ?? prevRecordWithStats.currentFolders ?? 0;
                                        bookmarkDiff = currentBookmarkCount - prevBookmarkCount;
                                        folderDiff = currentFolderCount - prevFolderCount;
                                        canCalculateDiff = true;
                                    } else {
                                        // 回退：使用 background 返回的上次计算差异
                                        if (backupResponse.stats.bookmarkDiff !== undefined) bookmarkDiff = backupResponse.stats.bookmarkDiff;
                                        if (backupResponse.stats.folderDiff !== undefined) folderDiff = backupResponse.stats.folderDiff;
                                        if (backupResponse.stats.bookmarkDiff !== undefined || backupResponse.stats.folderDiff !== undefined) canCalculateDiff = true;
                                    }
                                } else if (cachedRecordFromStorage) {
                                    const cachedStats = cachedRecordFromStorage.bookmarkStats;
                                    if (cachedStats &&
                                        (cachedStats.currentBookmarkCount !== undefined || cachedStats.currentBookmarks !== undefined) &&
                                        (cachedStats.currentFolderCount !== undefined || cachedStats.currentFolders !== undefined)) {
                                        const prevBookmarkCountFromCache = cachedStats.currentBookmarkCount ?? cachedStats.currentBookmarks ?? 0;
                                        const prevFolderCountFromCache = cachedStats.currentFolderCount ?? cachedStats.currentFolders ?? 0;
                                        bookmarkDiff = currentBookmarkCount - prevBookmarkCountFromCache;
                                        folderDiff = currentFolderCount - prevFolderCountFromCache;
                                        canCalculateDiff = true;
                                    } else {
                                        if (backupResponse.stats.bookmarkDiff !== undefined) bookmarkDiff = backupResponse.stats.bookmarkDiff;
                                        if (backupResponse.stats.folderDiff !== undefined) folderDiff = backupResponse.stats.folderDiff;
                                        if (backupResponse.stats.bookmarkDiff !== undefined || backupResponse.stats.folderDiff !== undefined) canCalculateDiff = true;
                                    }
                                } else {
                                    if (backupResponse.stats.bookmarkDiff !== undefined) bookmarkDiff = backupResponse.stats.bookmarkDiff;
                                    if (backupResponse.stats.folderDiff !== undefined) folderDiff = backupResponse.stats.folderDiff;
                                    if (backupResponse.stats.bookmarkDiff !== undefined || backupResponse.stats.folderDiff !== undefined) canCalculateDiff = true;
                                }

                                const bmAdded = typeof backupResponse.stats.bookmarkAdded === 'number' ? backupResponse.stats.bookmarkAdded : null;
                                const bmDeleted = typeof backupResponse.stats.bookmarkDeleted === 'number' ? backupResponse.stats.bookmarkDeleted : null;
                                const fdAdded = typeof backupResponse.stats.folderAdded === 'number' ? backupResponse.stats.folderAdded : null;
                                const fdDeleted = typeof backupResponse.stats.folderDeleted === 'number' ? backupResponse.stats.folderDeleted : null;
                                const hasDetailedQuantity = (bmAdded !== null) || (bmDeleted !== null) || (fdAdded !== null) || (fdDeleted !== null);
                                const hasNumericalChange = hasDetailedQuantity
                                    ? ((bmAdded || 0) > 0 || (bmDeleted || 0) > 0 || (fdAdded || 0) > 0 || (fdDeleted || 0) > 0)
                                    : (canCalculateDiff && (bookmarkDiff !== 0 || folderDiff !== 0));

                                const i18nBookmarkChangedLabel = window.i18nLabels?.bookmarkChangedLabel || (currentLang === 'en' ? "BKM changed" : "书签变动");
                                const i18nFolderChangedLabel = window.i18nLabels?.folderChangedLabel || (currentLang === 'en' ? "FLD changed" : "文件夹变动");
                                const i18nBookmarkAndFolderChangedLabel = window.i18nLabels?.bookmarkAndFolderChangedLabel || (currentLang === 'en' ? "BKM & FLD changed" : "书签和文件夹变动");

                                let quantityChangesHTML = "";
                                let structuralChangesHTML = "";

                                // 数量变化部分（带红绿色）
                                if (hasNumericalChange) {
                                    let bPartHTML = "";
                                    let fPartHTML = "";

                                    if (hasDetailedQuantity) {
                                        const joinDelta = (posParts) => {
                                            const sep = '<span style="display:inline-block; width:3px;"></span>/<span style="display:inline-block; width:3px;"></span>';
                                            return posParts.join(sep);
                                        };

                                        const buildDual = (added, deleted, zhLabel, enLabel) => {
                                            const parts = [];
                                            if (added > 0) parts.push(`<span style="color: #4CAF50; font-weight: bold;">+${added}</span>`);
                                            if (deleted > 0) parts.push(`<span style="color: #F44336; font-weight: bold;">-${deleted}</span>`);
                                            if (parts.length === 0) return "";

                                            const numbersHTML = joinDelta(parts);
                                            return currentLang === 'en'
                                                ? `${numbersHTML} ${enLabel}`
                                                : `${numbersHTML}${zhLabel}`;
                                        };

                                        bPartHTML = buildDual(bmAdded || 0, bmDeleted || 0, i18nBookmarksLabel, 'BKM');
                                        fPartHTML = buildDual(fdAdded || 0, fdDeleted || 0, i18nFoldersLabel, 'FLD');
                                    } else {
                                        if (bookmarkDiff !== 0) {
                                            const bookmarkSign = bookmarkDiff > 0 ? "+" : "";
                                            const bookmarkColor = bookmarkDiff > 0 ? "#4CAF50" : (bookmarkDiff < 0 ? "#F44336" : "#777777");
                                            if (currentLang === 'en') {
                                                const bmDiffTerm = "BKM";
                                                bPartHTML = `<span style="color: ${bookmarkColor}; font-weight: bold;">${bookmarkSign}${bookmarkDiff}</span> ${bmDiffTerm}`;
                                            } else {
                                                bPartHTML = `<span style="color: ${bookmarkColor}; font-weight: bold;">${bookmarkSign}${bookmarkDiff}</span>${i18nBookmarksLabel}`;
                                            }
                                        }
                                        if (folderDiff !== 0) {
                                            const folderSign = folderDiff > 0 ? "+" : "";
                                            const folderColor = folderDiff > 0 ? "#4CAF50" : (folderDiff < 0 ? "#F44336" : "#777777");
                                            if (currentLang === 'en') {
                                                const fldDiffTerm = "FLD";
                                                fPartHTML = `<span style="color: ${folderColor}; font-weight: bold;">${folderSign}${folderDiff}</span> ${fldDiffTerm}`;
                                            } else {
                                                fPartHTML = `<span style="color: ${folderColor}; font-weight: bold;">${folderSign}${folderDiff}</span>${i18nFoldersLabel}`;
                                            }
                                        }
                                    }

                                    if (currentLang === 'zh_CN' && bPartHTML && fPartHTML) {
                                        quantityChangesHTML = `${bPartHTML}<span style="display:inline;">,</span>${fPartHTML}`;
                                    } else {
                                        let temp = "";
                                        if (bPartHTML) temp += bPartHTML;
                                        if (bPartHTML && fPartHTML) {
                                            temp += `<span style="display:inline-block; width:6px;"></span>,<span style="display:inline-block; width:6px;"></span>`;
                                        }
                                        if (fPartHTML) temp += fPartHTML;
                                        quantityChangesHTML = temp;
                                    }
                                }

                                // 结构变化部分 - 显示具体变化类型而非通用标签（使用本地变量）
                                if (hasStructuralChanges) {
                                    const structuralParts = [];

                                    if (bookmarkMoved || folderMoved) {
                                        const movedLabel = currentLang === 'en' ? 'Moved' : '移动';
                                        const movedText = movedTotal > 0
                                            ? (currentLang === 'en'
                                                ? `<span style="color: #2196F3; font-weight: bold;">${movedTotal}</span> ${movedLabel}`
                                                : `<span style="color: #2196F3; font-weight: bold;">${movedTotal}</span><span style="color: var(--theme-status-card-auto-text); font-weight: 600;"> 个${movedLabel}</span>`)
                                            : movedLabel;
                                        structuralParts.push(`<span>${movedText}</span>`);
                                    }
                                    if (bookmarkModified || folderModified) {
                                        const modifiedLabel = currentLang === 'en' ? 'Modified' : '修改';
                                        const modifiedText = modifiedTotal > 0
                                            ? (currentLang === 'en'
                                                ? `<span style="color: #FF9800; font-weight: bold;">${modifiedTotal}</span> ${modifiedLabel}`
                                                : `<span style="color: #FF9800; font-weight: bold;">${modifiedTotal}</span><span style="color: var(--theme-status-card-auto-text); font-weight: 600;"> 个${modifiedLabel}</span>`)
                                            : modifiedLabel;
                                        structuralParts.push(`<span>${modifiedText}</span>`);
                                    }

                                    const separator = currentLang === 'en' ? '<span style="display:inline-block; width:4px;"></span>|<span style="display:inline-block; width:4px;"></span>' : '、';
                                    structuralChangesHTML = structuralParts.join(separator);
                                }

                                const bookmarkAddedCount = (typeof bmAdded === 'number')
                                    ? bmAdded
                                    : (canCalculateDiff && bookmarkDiff > 0 ? bookmarkDiff : 0);
                                const bookmarkDeletedCount = (typeof bmDeleted === 'number')
                                    ? bmDeleted
                                    : (canCalculateDiff && bookmarkDiff < 0 ? Math.abs(bookmarkDiff) : 0);
                                const folderAddedCount = (typeof fdAdded === 'number')
                                    ? fdAdded
                                    : (canCalculateDiff && folderDiff > 0 ? folderDiff : 0);
                                const folderDeletedCount = (typeof fdDeleted === 'number')
                                    ? fdDeleted
                                    : (canCalculateDiff && folderDiff < 0 ? Math.abs(folderDiff) : 0);

                                const hasAnyChange = bookmarkAddedCount > 0 ||
                                    bookmarkDeletedCount > 0 ||
                                    folderAddedCount > 0 ||
                                    folderDeletedCount > 0 ||
                                    movedTotal > 0 ||
                                    modifiedTotal > 0;

                                if (hasAnyChange) {
                                    const summaryHTML = buildStatusCardChangeSummaryHTML({
                                        bookmarkAddedCount,
                                        folderAddedCount,
                                        bookmarkDeletedCount,
                                        folderDeletedCount,
                                        movedTotal,
                                        modifiedTotal
                                    });
                                    applyStatusCardDisplay({ html: summaryHTML, hasChanges: true });
                                } else {
                                    const noChangeText = currentLang === 'en' ? 'No changes' : '无变化';
                                    applyStatusCardDisplay({ html: buildStatusCardMessageHTML(noChangeText), hasChanges: false });
                                }
                            });
                        } else {
                            // 其他情况（如 'none' 或未设置）：显示无变化
                            const noChangeText = currentLang === 'en' ? 'No changes' : '无变化';
                            applyStatusCardDisplay({ html: buildStatusCardMessageHTML(noChangeText), hasChanges: false });
                        }
                    });
                });

            } else {
                // 设置右侧状态卡片为手动模式样式
                statusCard.classList.add('manual-mode');
                statusCard.classList.remove('auto-mode');
                // --- 手动备份模式 ---
                Promise.all([
                    new Promise((resolve, reject) => {
                        chrome.runtime.sendMessage({ action: "getBackupStats" }, response => {
                            if (response && response.success) resolve(response);
                            else reject(new Error(response?.error || '获取备份统计失败'));
                        });
                    }),
                    new Promise((resolve, reject) => {
                        chrome.runtime.sendMessage({ action: "getSyncHistory" }, response => {
                            if (response && response.success) resolve(response.syncHistory || []);
                            else reject(new Error(response?.error || '获取备份历史失败'));
                        });
                    }),
                    new Promise((resolve) => {
                        chrome.storage.local.get('cachedRecordAfterClear', result => {
                            resolve(result.cachedRecordAfterClear);
                        });
                    }),
                    // 获取 recentMovedIds 和 recentModifiedIds（与当前变化视图一致）
                    new Promise((resolve) => {
                        chrome.storage.local.get(['recentMovedIds', 'recentModifiedIds'], result => {
                            resolve({
                                recentMovedIds: Array.isArray(result.recentMovedIds) ? result.recentMovedIds : [],
                                recentModifiedIds: Array.isArray(result.recentModifiedIds) ? result.recentModifiedIds : []
                            });
                        });
                    })
                ]).then(([backupResponse, syncHistory, cachedRecordFromStorage, recentIds]) => {
                    // 更新 "当前数量/结构:" (Details)
                    const currentBookmarkCount = backupResponse.stats.bookmarkCount || 0;
                    const currentFolderCount = backupResponse.stats.folderCount || 0;
                    let quantityText = '';
                    if (currentLang === 'en') {
                        const bmDisplayTerm = "BKM";
                        const fldDisplayTerm = "FLD";
                        quantityText = `<span style="font-weight: bold; color: var(--theme-text-primary);">${currentBookmarkCount} ${bmDisplayTerm}<span style="display:inline-block; width:6px;"></span>,<span style="display:inline-block; width:6px;"></span>${currentFolderCount} ${fldDisplayTerm}</span>`;
                    } else {
                        quantityText = `<span style="font-weight: bold; color: var(--theme-text-primary); display: flex; justify-content: center; align-items: baseline;">
                                            <span style="padding-right: 2px;">${currentBookmarkCount}&nbsp;${i18nBookmarksLabel}</span>
                                            <span>,</span>
                                            <span style="padding-left: 2px;">${currentFolderCount}&nbsp;${i18nFoldersLabel}</span>
                                        </span>`;
                    }
                    if (bookmarkCountSpan) {
                        bookmarkCountSpan.innerHTML = quantityText;
                    }

                    // 使用和备份检查记录完全相同的判断逻辑
                    const bookmarkMoved = backupResponse.stats.bookmarkMoved || false;
                    const folderMoved = backupResponse.stats.folderMoved || false;
                    const bookmarkModified = backupResponse.stats.bookmarkModified || false;
                    const folderModified = backupResponse.stats.folderModified || false;

                    // 优先使用 background 的净变化计数；否则回退到 recentXxxIds
                    const movedTotal = (typeof backupResponse.stats.movedCount === 'number')
                        ? backupResponse.stats.movedCount
                        : (recentIds.recentMovedIds.length > 0
                            ? recentIds.recentMovedIds.length
                            : ((typeof bookmarkMoved === 'number' ? bookmarkMoved : (bookmarkMoved ? 1 : 0)) +
                                (typeof folderMoved === 'number' ? folderMoved : (folderMoved ? 1 : 0))));
                    const modifiedTotal = (typeof backupResponse.stats.modifiedCount === 'number')
                        ? backupResponse.stats.modifiedCount
                        : (recentIds.recentModifiedIds.length > 0
                            ? recentIds.recentModifiedIds.length
                            : ((typeof bookmarkModified === 'number' ? bookmarkModified : (bookmarkModified ? 1 : 0)) +
                                (typeof folderModified === 'number' ? folderModified : (folderModified ? 1 : 0))));
                    const hasStructuralChanges = bookmarkMoved || folderMoved || bookmarkModified || folderModified || movedTotal > 0 || modifiedTotal > 0;


                    let bookmarkDiffManual = 0; // Renamed to avoid conflict
                    let folderDiffManual = 0;   // Renamed to avoid conflict
                    let canCalculateDiff = false;

                    if (syncHistory && syncHistory.length > 0) {
                        // 从末尾向前寻找最近一条包含有效统计的记录
                        let prevRecordWithStats = null;
                        for (let i = syncHistory.length - 1; i >= 0; i--) {
                            const rec = syncHistory[i];
                            const stats = rec && rec.bookmarkStats;
                            if (stats && (stats.currentBookmarkCount !== undefined || stats.currentBookmarks !== undefined)
                                && (stats.currentFolderCount !== undefined || stats.currentFolders !== undefined)) {
                                prevRecordWithStats = stats;
                                break;
                            }
                        }

                        if (prevRecordWithStats) {
                            const prevBookmarkCount = prevRecordWithStats.currentBookmarkCount ?? prevRecordWithStats.currentBookmarks ?? 0;
                            const prevFolderCount = prevRecordWithStats.currentFolderCount ?? prevRecordWithStats.currentFolders ?? 0;
                            bookmarkDiffManual = currentBookmarkCount - prevBookmarkCount;
                            folderDiffManual = currentFolderCount - prevFolderCount;
                            canCalculateDiff = true;
                        } else {
                            // 回退：使用 background 返回的上次计算差异
                            if (backupResponse.stats.bookmarkDiff !== undefined) bookmarkDiffManual = backupResponse.stats.bookmarkDiff;
                            if (backupResponse.stats.folderDiff !== undefined) folderDiffManual = backupResponse.stats.folderDiff;
                            if (backupResponse.stats.bookmarkDiff !== undefined || backupResponse.stats.folderDiff !== undefined) canCalculateDiff = true;
                            else console.warn("历史记录中没有可用统计，且 backupResponse 未提供 diff。");
                        }
                    } else if (cachedRecordFromStorage) {
                        const cachedStats = cachedRecordFromStorage.bookmarkStats;
                        if (cachedStats &&
                            (cachedStats.currentBookmarkCount !== undefined || cachedStats.currentBookmarks !== undefined) &&
                            (cachedStats.currentFolderCount !== undefined || cachedStats.currentFolders !== undefined)) {
                            const prevBookmarkCountFromCache = cachedStats.currentBookmarkCount ?? cachedStats.currentBookmarks ?? 0;
                            const prevFolderCountFromCache = cachedStats.currentFolderCount ?? cachedStats.currentFolders ?? 0;
                            bookmarkDiffManual = currentBookmarkCount - prevBookmarkCountFromCache;
                            folderDiffManual = currentFolderCount - prevFolderCountFromCache;
                            canCalculateDiff = true;
                        } else {
                            // Try to get diff from backupResponse if cache is incomplete
                            if (backupResponse.stats.bookmarkDiff !== undefined) bookmarkDiffManual = backupResponse.stats.bookmarkDiff;
                            if (backupResponse.stats.folderDiff !== undefined) folderDiffManual = backupResponse.stats.folderDiff;
                            if (backupResponse.stats.bookmarkDiff !== undefined || backupResponse.stats.folderDiff !== undefined) canCalculateDiff = true;
                            else console.warn("缓存的记录缺少必要的统计信息，无法精确计算数量差异，也无法从backupResponse获取。");
                        }
                    } else { // No history, no cache, rely on backupResponse for diff
                        if (backupResponse.stats.bookmarkDiff !== undefined) bookmarkDiffManual = backupResponse.stats.bookmarkDiff;
                        if (backupResponse.stats.folderDiff !== undefined) folderDiffManual = backupResponse.stats.folderDiff;
                        if (backupResponse.stats.bookmarkDiff !== undefined || backupResponse.stats.folderDiff !== undefined) canCalculateDiff = true;
                        else console.log("手动模式下无历史、无缓存、backupResponse无diff，不显示数量差异。");
                    }

                    const bmAdded = typeof backupResponse.stats.bookmarkAdded === 'number' ? backupResponse.stats.bookmarkAdded : null;
                    const bmDeleted = typeof backupResponse.stats.bookmarkDeleted === 'number' ? backupResponse.stats.bookmarkDeleted : null;
                    const fdAdded = typeof backupResponse.stats.folderAdded === 'number' ? backupResponse.stats.folderAdded : null;
                    const fdDeleted = typeof backupResponse.stats.folderDeleted === 'number' ? backupResponse.stats.folderDeleted : null;
                    const hasDetailedQuantity = (bmAdded !== null) || (bmDeleted !== null) || (fdAdded !== null) || (fdDeleted !== null);
                    const hasNumericalChange = hasDetailedQuantity
                        ? ((bmAdded || 0) > 0 || (bmDeleted || 0) > 0 || (fdAdded || 0) > 0 || (fdDeleted || 0) > 0)
                        : (canCalculateDiff && (bookmarkDiffManual !== 0 || folderDiffManual !== 0));
                    const i18nBookmarkChangedLabel = window.i18nLabels?.bookmarkChangedLabel || (currentLang === 'en' ? "BKM changed" : "书签变动");
                    const i18nFolderChangedLabel = window.i18nLabels?.folderChangedLabel || (currentLang === 'en' ? "FLD changed" : "文件夹变动");
                    const i18nBookmarkAndFolderChangedLabel = window.i18nLabels?.bookmarkAndFolderChangedLabel || (currentLang === 'en' ? "BKM & FLD changed" : "书签和文件夹变动");

                    let quantityChangesHTML = "";
                    let structuralChangesHTML = "";

                    if (hasNumericalChange) {
                        let bPartHTML = "";
                        let fPartHTML = "";

                        if (hasDetailedQuantity) {
                            const joinDelta = (posParts) => {
                                const sep = '<span style="display:inline-block; width:3px;"></span>/<span style="display:inline-block; width:3px;"></span>';
                                return posParts.join(sep);
                            };

                            const buildDual = (added, deleted, zhLabel, enLabel) => {
                                const parts = [];
                                if (added > 0) parts.push(`<span style="color: #4CAF50; font-weight: bold;">+${added}</span>`);
                                if (deleted > 0) parts.push(`<span style="color: #F44336; font-weight: bold;">-${deleted}</span>`);
                                if (parts.length === 0) return "";

                                const numbersHTML = joinDelta(parts);
                                return currentLang === 'en'
                                    ? `${numbersHTML} ${enLabel}`
                                    : `${numbersHTML}${zhLabel}`;
                            };

                            bPartHTML = buildDual(bmAdded || 0, bmDeleted || 0, i18nBookmarksLabel, 'BKM');
                            fPartHTML = buildDual(fdAdded || 0, fdDeleted || 0, i18nFoldersLabel, 'FLD');
                        } else {
                            if (bookmarkDiffManual !== 0) {
                                const bookmarkSign = bookmarkDiffManual > 0 ? "+" : "";
                                const bookmarkColor = bookmarkDiffManual > 0 ? "#4CAF50" : (bookmarkDiffManual < 0 ? "#F44336" : "#777777");
                                if (currentLang === 'en') {
                                    const bmDiffTerm = "BKM";
                                    bPartHTML = `<span style="color: ${bookmarkColor}; font-weight: bold;">${bookmarkSign}${bookmarkDiffManual}</span> ${bmDiffTerm}`;
                                } else {
                                    bPartHTML = `<span style="color: ${bookmarkColor}; font-weight: bold;">${bookmarkSign}${bookmarkDiffManual}</span>${i18nBookmarksLabel}`; // Chinese label remains plural form
                                }
                            }
                            if (folderDiffManual !== 0) {
                                const folderSign = folderDiffManual > 0 ? "+" : "";
                                const folderColor = folderDiffManual > 0 ? "#4CAF50" : (folderDiffManual < 0 ? "#F44336" : "#777777");
                                if (currentLang === 'en') {
                                    const fldDiffTerm = "FLD";
                                    fPartHTML = `<span style="color: ${folderColor}; font-weight: bold;">${folderSign}${folderDiffManual}</span> ${fldDiffTerm}`;
                                } else {
                                    fPartHTML = `<span style="color: ${folderColor}; font-weight: bold;">${folderSign}${folderDiffManual}</span>${i18nFoldersLabel}`; // Chinese label remains plural form
                                }
                            }
                        }

                        if (currentLang === 'zh_CN' && bPartHTML && fPartHTML) {
                            quantityChangesHTML = `${bPartHTML}<span style="display:inline;">,</span>${fPartHTML}`;
                        } else {
                            let temp = "";
                            if (bPartHTML) temp += bPartHTML;
                            if (bPartHTML && fPartHTML) {
                                temp += `<span style="display:inline-block; width:6px;"></span>,<span style="display:inline-block; width:6px;"></span>`;
                            }
                            if (fPartHTML) temp += fPartHTML;
                            quantityChangesHTML = temp;
                        }
                    }

                    // 结构变化部分 - 显示具体变化类型而非通用标签（使用本地变量）
                    if (hasStructuralChanges) {
                        const structuralParts = [];

                        if (bookmarkMoved || folderMoved) {
                            const movedLabel = currentLang === 'en' ? 'Moved' : '移动';
                            const movedText = movedTotal > 0
                                ? (currentLang === 'en'
                                    ? `<span style="color: #2196F3; font-weight: bold;">${movedTotal}</span> ${movedLabel}`
                                    : `<span style="color: #2196F3; font-weight: bold;">${movedTotal}</span><span style="color: var(--theme-status-card-manual-text); font-weight: 600;"> 个${movedLabel}</span>`)
                                : movedLabel;
                            structuralParts.push(`<span>${movedText}</span>`);
                        }
                        if (bookmarkModified || folderModified) {
                            const modifiedLabel = currentLang === 'en' ? 'Modified' : '修改';
                            const modifiedText = modifiedTotal > 0
                                ? (currentLang === 'en'
                                    ? `<span style="color: #FF9800; font-weight: bold;">${modifiedTotal}</span> ${modifiedLabel}`
                                    : `<span style="color: #FF9800; font-weight: bold;">${modifiedTotal}</span><span style="color: var(--theme-status-card-manual-text); font-weight: 600;"> 个${modifiedLabel}</span>`)
                                : modifiedLabel;
                            structuralParts.push(`<span>${modifiedText}</span>`);
                        }

                        const separator = currentLang === 'en' ? '<span style="display:inline-block; width:4px;"></span>|<span style="display:inline-block; width:4px;"></span>' : '、';
                        structuralChangesHTML = structuralParts.join(separator);
                    }

                    const bookmarkAddedCount = (typeof bmAdded === 'number')
                        ? bmAdded
                        : (canCalculateDiff && bookmarkDiffManual > 0 ? bookmarkDiffManual : 0);
                    const bookmarkDeletedCount = (typeof bmDeleted === 'number')
                        ? bmDeleted
                        : (canCalculateDiff && bookmarkDiffManual < 0 ? Math.abs(bookmarkDiffManual) : 0);
                    const folderAddedCount = (typeof fdAdded === 'number')
                        ? fdAdded
                        : (canCalculateDiff && folderDiffManual > 0 ? folderDiffManual : 0);
                    const folderDeletedCount = (typeof fdDeleted === 'number')
                        ? fdDeleted
                        : (canCalculateDiff && folderDiffManual < 0 ? Math.abs(folderDiffManual) : 0);

                    const hasAnyChange = bookmarkAddedCount > 0 ||
                        bookmarkDeletedCount > 0 ||
                        folderAddedCount > 0 ||
                        folderDeletedCount > 0 ||
                        movedTotal > 0 ||
                        modifiedTotal > 0;

                    if (hasAnyChange) {
                        const summaryHTML = buildStatusCardChangeSummaryHTML({
                            bookmarkAddedCount,
                            folderAddedCount,
                            bookmarkDeletedCount,
                            folderDeletedCount,
                            movedTotal,
                            modifiedTotal
                        });
                        applyStatusCardDisplay({ html: summaryHTML, hasChanges: true });
                    } else {
                        const noChangeText = currentLang === 'en' ? 'No changes' : '无变化';
                        applyStatusCardDisplay({ html: buildStatusCardMessageHTML(noChangeText), hasChanges: false });
                    }
                    // --- 结束原有的手动模式差异计算和显示逻辑 ---
                }).catch(manualError => {
                    if (bookmarkCountSpan) {
                        bookmarkCountSpan.innerHTML = `<span style="color: red;">${currentLang === 'en' ? 'Details load failed' : '详情加载失败'}</span>`;
                    }
                    if (changeDescriptionContainer) {
                        const errorText = currentLang === 'en' ? 'Change details unavailable' : '变动详情无法加载';
                        applyStatusCardDisplay({ html: buildStatusCardMessageHTML(errorText, 'color: red;'), hasChanges: false });
                    }
                });
            }
        })
        .catch(initialError => {
            const bookmarkCountSpan = document.getElementById('bookmarkCount');
            const statusCard = document.getElementById('change-description-row');
            const changeDescriptionContainer = document.getElementById('statusCardText') || statusCard;
            const statusCardChevron = document.getElementById('statusCardChevron');

            if (bookmarkCountSpan) {
                bookmarkCountSpan.innerHTML = `<span style="color: red;">${'加载失败'}</span>`;
            }
            if (changeDescriptionContainer) {
                changeDescriptionContainer.innerHTML = '';
            }
            if (statusCard) {
                statusCard.classList.remove('has-changes');
            }
            if (statusCardChevron) {
                statusCardChevron.style.display = 'none';
            }
        });
}


// =============================================================================
// 动作处理函数 (Action Handlers)
// =============================================================================

/**
 * 校准下载路径的函数。
 */
function calibrateDownloadPath() {
    // 1. 创建遮罩层和对话框
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    overlay.style.zIndex = '1000';
    overlay.style.display = 'flex';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';

    // 2. 创建对话框
    const dialog = document.createElement('div');
    dialog.style.backgroundColor = 'var(--theme-bg-primary)';
    dialog.style.borderRadius = '8px';
    dialog.style.padding = '20px';
    dialog.style.width = '650px';  // 从500px增大到650px
    dialog.style.maxWidth = '90%';
    dialog.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';

    // 创建2x2网格布局
    const gridContainer = document.createElement('div');
    gridContainer.style.display = 'grid';
    gridContainer.style.gridTemplateColumns = '1fr 1fr';
    gridContainer.style.gridTemplateRows = 'auto auto';
    gridContainer.style.gap = '25px';  // 增大网格间距
    gridContainer.style.width = '100%';

    // 获取当前语言
    chrome.storage.local.get(['preferredLang'], function (result) {
        const currentLang = result.preferredLang || 'zh_CN';

        // 第一行第一列：原有内容（不包括按钮）
        const mainContentCell = document.createElement('div');
        mainContentCell.style.gridColumn = '1';
        mainContentCell.style.gridRow = '1';
        mainContentCell.style.display = 'flex';
        mainContentCell.style.flexDirection = 'column';
        mainContentCell.style.justifyContent = 'center';
        mainContentCell.style.alignItems = 'center';

        // 添加标题到第一行第一列
        const title = document.createElement('h4');
        title.style.margin = '0 0 12px 0';
        title.style.color = 'var(--theme-text-primary)';
        title.style.fontSize = '16px';
        title.style.textAlign = 'center';
        title.style.width = '100%';

        // 国际化文本
        const calibratePathDialogTitleStrings = {
            'zh_CN': "手动校准路径",
            'en': "Manual Path Calibration"
        };
        title.textContent = calibratePathDialogTitleStrings[currentLang] || calibratePathDialogTitleStrings['zh_CN'];

        mainContentCell.appendChild(title);

        // 原有指南内容
        const instruction = document.createElement('p');
        instruction.style.margin = '0 0 10px 0';  // 减少底部间距
        instruction.style.fontSize = '14px';
        instruction.style.lineHeight = '1.4';  // 减少行间距
        instruction.style.textAlign = 'center';
        instruction.style.width = '90%';  // 限制宽度与其他区块一致

        // 国际化文本
        const calibratePathInstruction1Strings = {
            'zh_CN': "点击右下角的\"打开下载设置\"按钮",
            'en': "Click the \"Open Download Settings\" button in the bottom right corner"
        };
        const calibratePathInstruction2Strings = {
            'zh_CN': "将显示的下载路径复制下来",
            'en': "Copy the displayed download path"
        };
        const calibratePathInstruction3Strings = {
            'zh_CN': "粘贴到下方输入框中",
            'en': "Paste it into the input box below"
        };

        const instruction1Text = calibratePathInstruction1Strings[currentLang] || calibratePathInstruction1Strings['zh_CN'];
        const instruction2Text = calibratePathInstruction2Strings[currentLang] || calibratePathInstruction2Strings['zh_CN'];
        const instruction3Text = calibratePathInstruction3Strings[currentLang] || calibratePathInstruction3Strings['zh_CN'];

        instruction.innerHTML = `
            <ol style="padding-left: 20px; margin: 5px 0; text-align: left;">
                    <li>${instruction1Text}</li>
                    <li>${instruction2Text}</li>
                    <li>${instruction3Text}</li>
            </ol>
        `;

        // 输入框
        const inputContainer = document.createElement('div');
        inputContainer.style.margin = '10px 0';  // 减少上下间距
        inputContainer.style.textAlign = 'center';
        inputContainer.style.width = '90%';

        const inputLabel = document.createElement('label');

        // 国际化文本
        const pastePathLabelStrings = {
            'zh_CN': "粘贴下载路径:",
            'en': "Paste Download Path:"
        };
        inputLabel.textContent = pastePathLabelStrings[currentLang] || pastePathLabelStrings['zh_CN'];

        inputLabel.style.display = 'block';
        inputLabel.style.marginBottom = '6px';
        inputLabel.style.fontSize = '14px';
        inputLabel.style.textAlign = 'center';

        const input = document.createElement('input');
        input.type = 'text';

        // 国际化文本
        const pastePathPlaceholderStrings = {
            'zh_CN': "#下载内容--位置",
            'en': "#Download Content--Location"
        };
        input.placeholder = pastePathPlaceholderStrings[currentLang] || pastePathPlaceholderStrings['zh_CN'];

        input.style.width = '100%';
        input.style.padding = '8px 10px';  // 减少内边距
        input.style.border = '1px solid var(--theme-border-primary)';
        input.style.borderRadius = '4px';
        input.style.fontSize = '14px';
        input.style.boxSizing = 'border-box';
        input.style.marginBottom = '12px';  // 减少底部边距

        // 保存按钮 - 移动到输入框下方
        const saveBtn = document.createElement('button');

        // 国际化文本
        const saveButtonStrings = {
            'zh_CN': "保存",
            'en': "Save"
        };
        saveBtn.textContent = saveButtonStrings[currentLang] || saveButtonStrings['zh_CN'];

        saveBtn.style.backgroundColor = '#4CAF50';
        saveBtn.style.color = 'white';
        saveBtn.style.border = 'none';
        saveBtn.style.borderRadius = '4px';
        saveBtn.style.padding = '8px 12px';  // 减少内边距
        saveBtn.style.marginBottom = '0';  // 移除底部边距
        saveBtn.style.width = '100%';
        saveBtn.style.cursor = 'pointer';
        saveBtn.style.fontSize = '14px';
        saveBtn.addEventListener('click', function () {
            const path = input.value.trim();
            if (!path) {
                // IMPORTANT: Do not use alert(). Replace with a custom modal UI.
                // For now, keeping it as is since it's a direct copy and the instruction is "not change the functionality".
                alert('请输入有效的下载路径');
                return;
            }

            // 确保路径以分隔符结尾
            let formattedPath = path;
            if (!formattedPath.endsWith('/') && !formattedPath.endsWith('\\')) {
                formattedPath += path.includes('\\') ? '\\' : '/';
            }

            // 添加Bookmarks子目录
            formattedPath += 'Bookmarks/';

            // 保存自定义路径
            chrome.storage.local.set({ customDownloadPath: formattedPath }, function () {
                // 更新显示
                const downloadPathDisplay = document.getElementById('downloadPathDisplay');
                if (downloadPathDisplay) {
                    downloadPathDisplay.textContent = formattedPath;
                    downloadPathDisplay.style.color = "var(--theme-text-secondary)";
                }

                // 关闭对话框
                document.body.removeChild(overlay);

                // 显示成功消息
                showStatus('下载路径已校准', 'success');

                // 更新状态指示器
                updateLocalStatusDot();
            });
        });

        // 组装主内容
        inputContainer.appendChild(inputLabel);
        inputContainer.appendChild(input);
        inputContainer.appendChild(saveBtn);
        mainContentCell.appendChild(instruction);
        mainContentCell.appendChild(inputContainer);

        // 第一行第二列：曲线云端备份指南
        const cloudBackupCell = document.createElement('div');
        cloudBackupCell.style.gridColumn = '2';
        cloudBackupCell.style.gridRow = '1';
        cloudBackupCell.style.display = 'flex';
        cloudBackupCell.style.flexDirection = 'column';
        cloudBackupCell.style.justifyContent = 'center';
        cloudBackupCell.style.alignItems = 'center';
        cloudBackupCell.style.borderLeft = '1px solid var(--theme-border-primary)';
        cloudBackupCell.style.paddingLeft = '25px';

        const cloudBackupTitle = document.createElement('h4');
        cloudBackupTitle.style.margin = '0 0 12px 0';
        cloudBackupTitle.style.fontSize = '16px';
        cloudBackupTitle.style.color = 'var(--theme-text-primary)';
        cloudBackupTitle.style.textAlign = 'center';
        cloudBackupTitle.style.width = '100%';

        // 国际化文本
        const cloudBackupGuideTitleStrings = {
            'zh_CN': "曲线云端备份指南",
            'en': "Cloud Backup Guide"
        };
        cloudBackupTitle.textContent = cloudBackupGuideTitleStrings[currentLang] || cloudBackupGuideTitleStrings['zh_CN'];

        const cloudBackupGuide = document.createElement('ul');
        cloudBackupGuide.style.margin = '0';
        cloudBackupGuide.style.paddingLeft = '20px';
        cloudBackupGuide.style.fontSize = '14px';
        cloudBackupGuide.style.lineHeight = '1.6';
        cloudBackupGuide.style.color = 'var(--theme-text-secondary)';
        cloudBackupGuide.style.textAlign = 'left';
        cloudBackupGuide.style.width = '90%';

        // 国际化文本
        const cloudBackupGuide1Strings = {
            'zh_CN': "修改浏览器默认下载路径至云盘处（频繁备份）",
            'en': "Change browser default download path to cloud storage (for frequent backups)"
        };
        const cloudBackupGuide2Strings = {
            'zh_CN': "在默认下载路径，手动进行文件夹Bookmarks关联，挂载至其他网盘",
            'en': "In the default download path, manually associate the Bookmarks folder to other cloud drives"
        };
        // 国际化文本
        const cloudBackupGuide3Strings = {
            'zh_CN': "macOS设置：将\"桌面\"和\"文稿\"文件添加到 iCloud 云盘",
            'en': "macOS setup: Add 'Desktop' and 'Documents' folders to iCloud Drive"
        };

        const guide1Text = cloudBackupGuide1Strings[currentLang] || cloudBackupGuide1Strings['zh_CN'];
        const guide2Text = cloudBackupGuide2Strings[currentLang] || cloudBackupGuide2Strings['zh_CN'];
        const guide3Text = cloudBackupGuide3Strings[currentLang] || cloudBackupGuide3Strings['zh_CN'];

        cloudBackupGuide.innerHTML = `
                <li>${guide1Text}</li>
                <li>${guide2Text}</li>
                <li>${guide3Text}</li>
        `;

        cloudBackupCell.appendChild(cloudBackupTitle);
        cloudBackupCell.appendChild(cloudBackupGuide);

        // 第二行第一列：全局隐藏下载栏
        const hideDownloadBarCell = document.createElement('div');
        hideDownloadBarCell.style.gridColumn = '1';
        hideDownloadBarCell.style.gridRow = '2';
        hideDownloadBarCell.style.display = 'flex';
        hideDownloadBarCell.style.flexDirection = 'column';
        hideDownloadBarCell.style.justifyContent = 'center';
        hideDownloadBarCell.style.alignItems = 'center';
        hideDownloadBarCell.style.borderTop = '1px solid var(--theme-border-primary)';
        hideDownloadBarCell.style.paddingTop = '15px';

        const hideDownloadBarTitle = document.createElement('h4');
        hideDownloadBarTitle.style.margin = '0 0 12px 0';
        hideDownloadBarTitle.style.fontSize = '16px';
        hideDownloadBarTitle.style.color = 'var(--theme-text-primary)';
        hideDownloadBarTitle.style.textAlign = 'center';
        hideDownloadBarTitle.style.width = '100%';

        // 国际化文本
        const hideDownloadBarTitleStrings = {
            'zh_CN': "全局隐藏下载栏",
            'en': "Global Download Bar Hiding"
        };
        hideDownloadBarTitle.textContent = hideDownloadBarTitleStrings[currentLang] || hideDownloadBarTitleStrings['zh_CN'];

        const hideDownloadBarGuide = document.createElement('ol');
        hideDownloadBarGuide.style.margin = '0';
        hideDownloadBarGuide.style.paddingLeft = '20px';
        hideDownloadBarGuide.style.fontSize = '14px';
        hideDownloadBarGuide.style.lineHeight = '1.6';
        hideDownloadBarGuide.style.color = 'var(--theme-text-secondary)';
        hideDownloadBarGuide.style.textAlign = 'left';
        hideDownloadBarGuide.style.width = '80%';

        // 国际化文本
        const hideDownloadBarGuide1Strings = {
            'zh_CN': "点击右下角的\"打开下载设置\"按钮",
            'en': "Click the \"Open Download Settings\" button in the bottom right corner"
        };
        const hideDownloadBarGuide2Strings = {
            'zh_CN': "关闭「下载完成后显示下载内容」",
            'en': "Turn off \"Show downloads when completed\""
        };

        const hideGuide1Text = hideDownloadBarGuide1Strings[currentLang] || hideDownloadBarGuide1Strings['zh_CN'];
        const hideGuide2Text = hideDownloadBarGuide2Strings[currentLang] || hideDownloadBarGuide2Strings['zh_CN'];

        hideDownloadBarGuide.innerHTML = `
                <li>${hideGuide1Text}</li>
                <li>${hideGuide2Text}</li>
        `;

        hideDownloadBarCell.appendChild(hideDownloadBarTitle);
        hideDownloadBarCell.appendChild(hideDownloadBarGuide);

        // 第二行第二列：按钮
        const buttonsCell = document.createElement('div');
        buttonsCell.style.gridColumn = '2';
        buttonsCell.style.gridRow = '2';
        buttonsCell.style.display = 'flex';
        buttonsCell.style.flexDirection = 'column';
        buttonsCell.style.justifyContent = 'center';
        buttonsCell.style.alignItems = 'center';
        buttonsCell.style.borderTop = '1px solid var(--theme-border-primary)';
        buttonsCell.style.borderLeft = '1px solid var(--theme-border-primary)';
        buttonsCell.style.paddingTop = '15px';
        buttonsCell.style.paddingLeft = '25px';

        // 打开下载设置按钮
        const openSettingsBtn = document.createElement('button');

        // 国际化文本
        const openDownloadSettingsButtonStrings = {
            'zh_CN': "打开下载设置",
            'en': "Open Download Settings"
        };
        openSettingsBtn.textContent = openDownloadSettingsButtonStrings[currentLang] || openDownloadSettingsButtonStrings['zh_CN'];

        openSettingsBtn.style.backgroundColor = '#4CAF50';
        openSettingsBtn.style.color = 'white';
        openSettingsBtn.style.border = 'none';
        openSettingsBtn.style.borderRadius = '4px';
        openSettingsBtn.style.padding = '10px 15px';
        openSettingsBtn.style.marginBottom = '15px';
        openSettingsBtn.style.width = '90%';
        openSettingsBtn.style.cursor = 'pointer';
        openSettingsBtn.style.fontSize = '14px';
        openSettingsBtn.addEventListener('click', function () {
            chrome.runtime.sendMessage({ action: "openDownloadSettings" });
        });

        // 取消按钮
        const cancelBtn = document.createElement('button');

        // 国际化文本
        const cancelButtonStrings = {
            'zh_CN': "取消",
            'en': "Cancel"
        };
        cancelBtn.textContent = cancelButtonStrings[currentLang] || cancelButtonStrings['zh_CN'];

        cancelBtn.style.backgroundColor = 'var(--theme-bg-tertiary)';
        cancelBtn.style.color = 'var(--theme-text-primary)';
        cancelBtn.style.border = '1px solid var(--theme-border-primary)';
        cancelBtn.style.borderRadius = '4px';
        cancelBtn.style.padding = '10px 15px';
        cancelBtn.style.width = '90%';
        cancelBtn.style.cursor = 'pointer';
        cancelBtn.style.fontSize = '14px';
        cancelBtn.addEventListener('click', function () {
            document.body.removeChild(overlay);
        });

        // 添加按钮到按钮区域
        buttonsCell.appendChild(openSettingsBtn);
        buttonsCell.appendChild(cancelBtn);

        // 组装网格
        gridContainer.appendChild(mainContentCell);
        gridContainer.appendChild(cloudBackupCell);
        gridContainer.appendChild(hideDownloadBarCell);
        gridContainer.appendChild(buttonsCell);

        // 组装对话框
        dialog.appendChild(gridContainer);

        overlay.appendChild(dialog);

        // 添加到页面
        document.body.appendChild(overlay);

        // 设置初始焦点
        setTimeout(() => {
            input.focus();
        }, 100);
    });
}

/**
 * 处理自动备份。
 */
function handleAutoSync() {
    // 获取自动备份开关的当前状态
    // 注意：这里修复了两个问题：
    // 1. 使用正确的元素ID（应该是autoSyncToggle而不是autoSyncEnabled）
    // 2. 使用正确的存储键名（autoSync而不是autoSyncEnabled）
    const autoSyncToggle = document.getElementById('autoSyncToggle');
    if (!autoSyncToggle) return;

    const isAutoSyncEnabled = autoSyncToggle.checked;
    chrome.storage.local.set({ autoSync: isAutoSyncEnabled }, () => { // 使用 chrome.storage
        showStatus(isAutoSyncEnabled ? '已启用自动备份' : '已禁用自动备份', 'success');

        // 如果开启了自动备份，并且有书签变化，则立即执行备份
        if (isAutoSyncEnabled) {
            const hasBookmarkMoved = localStorage.getItem('hasBookmarkMoved') === 'true';
            const hasBookmarkModified = localStorage.getItem('hasBookmarkModified') === 'true';

            if (hasBookmarkMoved || hasBookmarkModified) {
                // This function is not defined in the provided code snippet,
                // assuming it's meant to trigger a syncBookmarks action.
                // For now, keeping it as is to avoid changing functionality.
                // syncBookmarks();
            }
        }
    });
}

/**
 * 处理自动备份开关切换事件。
 * @param {Event} event - change事件对象。
 */
function handleAutoSyncToggle(event) {
    const isChecked = event.target.checked;
    const wasChecked = !isChecked; // 开关切换前的状态

    // 备份所有自动备份开关状态
    const autoSyncToggle = document.getElementById('autoSyncToggle');
    const autoSyncToggle2 = document.getElementById('autoSyncToggle2');

    if (autoSyncToggle) autoSyncToggle.checked = isChecked;
    if (autoSyncToggle2) autoSyncToggle2.checked = isChecked;

    // 同步设置区块里的 Auto/Manual 复选框
    const backupModeAuto = document.getElementById('backupModeAuto');
    const backupModeManual = document.getElementById('backupModeManual');
    if (backupModeAuto) backupModeAuto.checked = isChecked;
    if (backupModeManual) backupModeManual.checked = !isChecked;

    // 同步设置区块里的按钮显示
    const autoBackupSettingsBtnNew = document.getElementById('autoBackupSettingsBtnNew');
    const reminderSettingsBtnNew = document.getElementById('reminderSettingsBtnNew');

    if (isChecked) {
        if (autoBackupSettingsBtnNew) autoBackupSettingsBtnNew.style.display = 'flex';
        if (reminderSettingsBtnNew) reminderSettingsBtnNew.style.display = 'none';

        const manualBackupBtnOverlay = document.getElementById('manualBackupBtnOverlay');
        if (manualBackupBtnOverlay) manualBackupBtnOverlay.style.display = 'none';
    } else {
        if (autoBackupSettingsBtnNew) autoBackupSettingsBtnNew.style.display = 'none';
        if (reminderSettingsBtnNew) reminderSettingsBtnNew.style.display = 'flex';

        const manualBackupBtnOverlay = document.getElementById('manualBackupBtnOverlay');
        if (manualBackupBtnOverlay) manualBackupBtnOverlay.style.display = 'flex';
    }

    // 更新界面元素状态
    const backupModeSwitch = document.getElementById('backupModeSwitch');
    if (backupModeSwitch) {
        if (isChecked) {
            backupModeSwitch.classList.add('auto');
            backupModeSwitch.classList.remove('manual');
        } else {
            backupModeSwitch.classList.add('manual');
            backupModeSwitch.classList.remove('auto');
        }
    }

    // 同步右侧状态卡片的配色
    const changeDescriptionContainerForToggle = document.getElementById('change-description-row');
    if (changeDescriptionContainerForToggle) {
        if (isChecked) {
            changeDescriptionContainerForToggle.classList.add('auto-mode');
            changeDescriptionContainerForToggle.classList.remove('manual-mode');
        } else {
            changeDescriptionContainerForToggle.classList.add('manual-mode');
            changeDescriptionContainerForToggle.classList.remove('auto-mode');
        }
    }

    // 控制提示文本的显示与隐藏
    const autoTip = document.querySelector('.mode-tip.auto-tip');
    const manualTip = document.querySelector('.mode-tip.manual-tip');

    if (autoTip && manualTip) {
        if (isChecked) {
            autoTip.style.display = 'inline-block';
            manualTip.style.display = 'none';
        } else {
            autoTip.style.display = 'none';
            manualTip.style.display = 'inline-block';
        }
    }

    // 获取手动备份按钮元素
    const manualSyncOptions = document.getElementById('manualSyncOptions');
    const manualButtonsContainer = document.getElementById('manualButtonsContainer'); // This variable is declared but not used.
    const reminderSettingsBtn = document.getElementById('reminderSettingsBtn');
    const uploadToCloudManual = document.getElementById('uploadToCloudManual');

    // 隐藏旧的容器（为了兼容性保留）
    if (manualSyncOptions) {
        manualSyncOptions.style.display = isChecked ? 'none' : 'block';
    }

    // 处理按钮的禁用状态和视觉效果
    if (reminderSettingsBtn && uploadToCloudManual) {
        if (isChecked) {
            // 自动备份开启时，禁用按钮并应用玻璃效果/暗化
            reminderSettingsBtn.disabled = true;
            uploadToCloudManual.disabled = true;
            reminderSettingsBtn.classList.add('disabled');
            uploadToCloudManual.classList.add('disabled');
            // 移除可能存在的动画效果
            uploadToCloudManual.classList.remove('breathe-animation');
        } else {
            // 自动备份关闭时，启用按钮并恢复正常外观
            reminderSettingsBtn.disabled = false;
            uploadToCloudManual.disabled = false;
            reminderSettingsBtn.classList.remove('disabled');
            uploadToCloudManual.classList.remove('disabled');
            // 添加呼吸动画效果
            // uploadToCloudManual.classList.add('breathe-animation'); // Removed yellow glow effect
        }
    }

    // 同步自动备份设置按钮禁用状态（手动模式下置灰）
    const autoBackupSettingsBtn2 = document.getElementById('autoBackupSettingsBtn');
    if (autoBackupSettingsBtn2) {
        if (isChecked) {
            autoBackupSettingsBtn2.disabled = false;
            autoBackupSettingsBtn2.classList.remove('disabled');
        } else {
            autoBackupSettingsBtn2.disabled = true;
            autoBackupSettingsBtn2.classList.add('disabled');
        }
    }

    // --- 新实现：用后台统计判断是否需要“切换备份” ---
    const maybeRunSwitchBackup = (!wasChecked && isChecked);
    if (maybeRunSwitchBackup) {
        // 手动→自动：先判断是否需要“切换备份”；根据结果再决定是否发送最终的 toggleAutoSync
        chrome.runtime.sendMessage({ action: 'getBackupStats' }, (backupResponse) => {
            if (!backupResponse || !backupResponse.success || !backupResponse.stats) {
                // 无法获取统计：直接切换到自动
                chrome.runtime.sendMessage({ action: 'toggleAutoSync', enabled: isChecked }, () => {
                    // 即使失败，仍尝试更新UI显示
                    setTimeout(() => { try { updateBookmarkCountDisplay(); } catch (e) { } }, 120);
                });
                return; // 阻断默认流程
            }
            const s = backupResponse.stats;
            const hasChanges = (
                s.bookmarkDiff !== 0 ||
                s.folderDiff !== 0 ||
                s.bookmarkMoved || s.folderMoved ||
                s.bookmarkModified || s.folderModified
            );
            if (hasChanges) {
                showStatus('检测到修改，正在为您备份...', 'info', 5000);
                chrome.runtime.sendMessage({
                    action: 'syncBookmarks',
                    isSwitchToAutoBackup: true
                }, (syncResponse) => {
                    if (syncResponse && syncResponse.success) {
                        showStatus('切换备份成功！', 'success');
                        // 刷新备份历史
                        updateSyncHistory();
                        // 稍候刷新右侧状态卡片/“需要更新的”
                        setTimeout(() => { try { updateBookmarkCountDisplay(); } catch (e) { } }, 120);
                        // 切换备份成功后再正式切到自动模式，避免并发触发自动备份
                        chrome.runtime.sendMessage({ action: 'toggleAutoSync', enabled: true }, () => {
                            setTimeout(() => { try { updateBookmarkCountDisplay(); } catch (e) { } }, 120);
                        });
                    } else {
                        showStatus('切换备份失败: ' + (syncResponse?.error || '未知错误'), 'error');
                        // 回退UI开关到切换前状态
                        const autoSyncToggle = document.getElementById('autoSyncToggle');
                        const autoSyncToggle2 = document.getElementById('autoSyncToggle2');
                        if (autoSyncToggle) autoSyncToggle.checked = wasChecked;
                        if (autoSyncToggle2) autoSyncToggle2.checked = wasChecked;
                        const backupModeAuto = document.getElementById('backupModeAuto');
                        const backupModeManual = document.getElementById('backupModeManual');
                        if (backupModeAuto) backupModeAuto.checked = wasChecked;
                        if (backupModeManual) backupModeManual.checked = !wasChecked;
                        const autoBackupSettingsBtnNew = document.getElementById('autoBackupSettingsBtnNew');
                        const reminderSettingsBtnNew = document.getElementById('reminderSettingsBtnNew');
                        if (autoBackupSettingsBtnNew) autoBackupSettingsBtnNew.style.display = wasChecked ? 'flex' : 'none';
                        if (reminderSettingsBtnNew) reminderSettingsBtnNew.style.display = wasChecked ? 'none' : 'flex';
                    }
                });
            } else {
                // 没有变化：直接切到自动模式
                chrome.runtime.sendMessage({ action: 'toggleAutoSync', enabled: true }, () => {
                    setTimeout(() => { try { updateBookmarkCountDisplay(); } catch (e) { } }, 120);
                });
            }
        });
        // 这里直接 return，避免继续走默认的 toggle 逻辑
        return;
    }
    // --- 结束新增 ---

    // 通知 background.js 状态变化（默认路径；手动→自动已在上方 return 掉）
    chrome.runtime.sendMessage({ action: 'toggleAutoSync', enabled: isChecked }, (response) => {
        if (response && response.success) {
            const currentAutoSyncState = response.autoSync;
            // 确保UI开关与后台确认的状态一致
            if (autoSyncToggle) autoSyncToggle.checked = currentAutoSyncState;
            if (autoSyncToggle2) autoSyncToggle2.checked = currentAutoSyncState;

            const backupModeAuto = document.getElementById('backupModeAuto');
            const backupModeManual = document.getElementById('backupModeManual');
            if (backupModeAuto) backupModeAuto.checked = currentAutoSyncState;
            if (backupModeManual) backupModeManual.checked = !currentAutoSyncState;

            const autoBackupSettingsBtnNew = document.getElementById('autoBackupSettingsBtnNew');
            const reminderSettingsBtnNew = document.getElementById('reminderSettingsBtnNew');
            if (autoBackupSettingsBtnNew) autoBackupSettingsBtnNew.style.display = currentAutoSyncState ? 'flex' : 'none';
            if (reminderSettingsBtnNew) reminderSettingsBtnNew.style.display = currentAutoSyncState ? 'none' : 'flex';

            // 获取按钮元素
            const reminderSettingsBtn = document.getElementById('reminderSettingsBtn');
            const uploadToCloudManual = document.getElementById('uploadToCloudManual');

            // 隐藏旧的容器（为了兼容性保留）
            if (manualSyncOptions) {
                manualSyncOptions.style.display = currentAutoSyncState ? 'none' : 'block';
            }

            // 更新按钮状态
            if (reminderSettingsBtn && uploadToCloudManual) {
                if (currentAutoSyncState) {
                    // 自动备份开启时，禁用按钮并应用玻璃效果/暗化
                    reminderSettingsBtn.disabled = true;
                    uploadToCloudManual.disabled = true;
                    reminderSettingsBtn.classList.add('disabled');
                    uploadToCloudManual.classList.add('disabled');
                    // 移除可能存在的动画效果
                    uploadToCloudManual.classList.remove('breathe-animation');

                    // 当切换到自动备份时，滚动到"当前数量/结构:"区域
                    setTimeout(() => {
                        const statsLabels = document.querySelectorAll('.stats-label');
                        if (statsLabels.length > 1) {
                            const currentQuantityElement = statsLabels[1];
                            const syncStatusSection = document.getElementById('syncStatus');
                            if (syncStatusSection) {
                                syncStatusSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                // 稍微调整位置，确保良好的可视效果
                                window.scrollTo({
                                    top: syncStatusSection.offsetTop + 5,
                                    behavior: 'smooth'
                                });
                            }
                        } else {
                            // 回退方案：如果找不到"当前数量/结构:"元素，则滚动到页面顶部
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                        }
                    }, 100);
                } else {
                    // 自动备份关闭时，启用按钮并恢复正常外观
                    reminderSettingsBtn.disabled = false;
                    uploadToCloudManual.disabled = false;
                    reminderSettingsBtn.classList.remove('disabled');
                    uploadToCloudManual.classList.remove('disabled');
                    // 添加呼吸动画效果
                    // uploadToCloudManual.classList.add('breathe-animation'); // Removed yellow glow effect
                }
            }

            // 同步自动备份设置按钮禁用状态（手动模式下置灰）
            const autoBackupSettingsBtn = document.getElementById('autoBackupSettingsBtn');
            if (autoBackupSettingsBtn) {
                if (currentAutoSyncState) {
                    autoBackupSettingsBtn.disabled = false;
                    autoBackupSettingsBtn.classList.remove('disabled');
                } else {
                    autoBackupSettingsBtn.disabled = true;
                    autoBackupSettingsBtn.classList.add('disabled');
                }
            }

            showStatus(`自动备份已${currentAutoSyncState ? '启用' : '禁用'}`, 'success');
            showBookmarkBackupSavedFeedback();

            // 延迟更新状态卡片，确保所有状态更新完成后再刷新显示
            setTimeout(() => {
                updateBookmarkCountDisplay();
            }, 100);

            if (wasChecked && !currentAutoSyncState) {
            }

        } else {
            showStatus('切换自动备份失败' + (response?.error ? `: ${response.error}` : ''), 'error');
            // 恢复开关状态到切换前
            if (autoSyncToggle) autoSyncToggle.checked = !isChecked;
            if (autoSyncToggle2) autoSyncToggle2.checked = !isChecked;
            const backupModeAuto = document.getElementById('backupModeAuto');
            const backupModeManual = document.getElementById('backupModeManual');
            if (backupModeAuto) backupModeAuto.checked = !isChecked;
            if (backupModeManual) backupModeManual.checked = isChecked;
            const autoBackupSettingsBtnNew = document.getElementById('autoBackupSettingsBtnNew');
            const reminderSettingsBtnNew = document.getElementById('reminderSettingsBtnNew');
            if (autoBackupSettingsBtnNew) autoBackupSettingsBtnNew.style.display = !isChecked ? 'flex' : 'none';
            if (reminderSettingsBtnNew) reminderSettingsBtnNew.style.display = !isChecked ? 'none' : 'flex';

            // 获取按钮元素
            const reminderSettingsBtn = document.getElementById('reminderSettingsBtn');
            const uploadToCloudManual = document.getElementById('uploadToCloudManual');

            // 隐藏旧的容器（为了兼容性保留）
            if (manualSyncOptions) {
                manualSyncOptions.style.display = !isChecked ? 'block' : 'none';
            }

            // 更新按钮状态回之前的状态
            if (reminderSettingsBtn && uploadToCloudManual) {
                if (!isChecked) {
                    // 如果之前是自动模式，恢复为禁用状态
                    reminderSettingsBtn.disabled = true;
                    uploadToCloudManual.disabled = true;
                    reminderSettingsBtn.classList.add('disabled');
                    uploadToCloudManual.classList.add('disabled');
                    // 移除可能存在的动画效果
                    uploadToCloudManual.classList.remove('breathe-animation');
                } else {
                    // 如果之前是手动模式，恢复为启用状态
                    reminderSettingsBtn.disabled = false;
                    uploadToCloudManual.disabled = false;
                    reminderSettingsBtn.classList.remove('disabled');
                    uploadToCloudManual.classList.remove('disabled');
                    // 添加呼吸动画效果
                    // uploadToCloudManual.classList.add('breathe-animation'); // Removed yellow glow effect
                }
            }

            // 同步自动备份设置按钮禁用状态（回退到切换前状态）
            const autoBackupSettingsBtn3 = document.getElementById('autoBackupSettingsBtn');
            if (autoBackupSettingsBtn3) {
                if (!isChecked) { // 切换失败且目标是手动 => 仍保持自动模式
                    autoBackupSettingsBtn3.disabled = false;
                    autoBackupSettingsBtn3.classList.remove('disabled');
                } else { // 切换失败且目标是自动 => 仍保持手动模式
                    autoBackupSettingsBtn3.disabled = true;
                    autoBackupSettingsBtn3.classList.add('disabled');
                }
            }

            // 即使切换失败，也尝试更新显示以反映当前的实际状态
            updateBookmarkCountDisplay();
        }
    });
}

/**
 * 处理初始化上传函数。
 * 优化：立即执行UI跳转，上传操作在后台异步执行，完成后通过系统通知告知结果。
 */
function handleInitUpload() {
    // 获取当前语言设置
    chrome.storage.local.get(['preferredLang'], function (langResult) {
        const lang = langResult.preferredLang || 'zh_CN';
        const statusText = lang === 'en' ? 'Initializing backup in background...' : '正在后台初始化备份...';
        showStatus(statusText, 'info');
    });

    // 获取上传按钮并禁用（防止重复点击）
    const uploadToCloud = document.getElementById('uploadToCloud');
    if (uploadToCloud) uploadToCloud.disabled = true;

    // ========== 立即执行UI更新（不等待上传完成） ==========

    // 折叠初始化区块
    const initHeader = document.getElementById('initHeader');
    const initContent = document.getElementById('initContent');
    if (initHeader && initContent) {
        initContent.style.display = 'none';
        initHeader.classList.add('collapsed');
    }

    // 显示备份状态区域
    const syncStatusDiv = document.getElementById('syncStatus');
    if (syncStatusDiv) {
        syncStatusDiv.style.display = 'block';
    }

    // 显示手动备份选项，但根据自动备份状态决定
    const manualSyncOptions = document.getElementById('manualSyncOptions');
    if (manualSyncOptions) {
        chrome.storage.local.get(['autoSync'], function (autoSyncData) {
            const autoSyncEnabled = autoSyncData.autoSync !== false;
            manualSyncOptions.style.display = autoSyncEnabled ? 'none' : 'block';
        });
    }

    // 立即跳转到目标位置
    setTimeout(() => {
        scrollToPositionA('smooth');
    }, 50);

    // 设置初始化标记（乐观更新，假设会成功）
    chrome.storage.local.set({ initialized: true });

    // ========== 异步发送初始化请求到后台（Fire and Forget） ==========
    // 后台会在完成后发送系统通知，即使popup关闭也能继续执行
    chrome.runtime.sendMessage({
        action: "initSync",
        direction: "upload",
        showNotification: true  // 告诉后台需要发送通知
    }, (response) => {
        // 如果popup还开着，更新UI状态
        if (chrome.runtime.lastError) {
            // popup可能已关闭，忽略错误
            return;
        }

        // 恢复按钮状态
        if (uploadToCloud) uploadToCloud.disabled = false;

        if (response && response.success) {
            // 更新备份历史记录
            updateSyncHistory();

            // 主动请求更新角标
            chrome.runtime.sendMessage({ action: "setBadge" });

            // 如果popup还开着，显示成功消息
            chrome.storage.local.get(['preferredLang'], function (langResult) {
                const lang = langResult.preferredLang || 'zh_CN';
                const targets = [];
                if (response.webDAVSuccess) targets.push(lang === 'en' ? 'Cloud 1 (WebDAV)' : '云端1(WebDAV)');
                if (response.githubRepoSuccess) targets.push(lang === 'en' ? 'Cloud 2 (GitHub Repo)' : '云端2(GitHub仓库)');
                if (response.localSuccess) targets.push(lang === 'en' ? 'Local' : '本地');

                let targetsText = targets.join(lang === 'en' ? ' & ' : '和');
                if (!targetsText) {
                    targetsText = lang === 'en' ? 'Unknown target' : '未知位置';
                }

                const successMessage = lang === 'en'
                    ? `Initialized to ${targetsText}!`
                    : `成功初始化到${targetsText}！`;

                showStatus(successMessage, 'success');
            });

            // 保存初始备份文件名（如果有）
            if (response.localFileName) {
                const initialBackupRecord = {
                    fileName: response.localFileName,
                    time: new Date().toISOString(),
                    backupType: response.localSuccess ? '本地' : (response.webDAVSuccess ? '云端' : '未知')
                };
                chrome.storage.local.set({ initialBackupRecord: initialBackupRecord });
            }
        } else if (response && !response.success) {
            // 如果失败，回滚初始化标记
            chrome.storage.local.set({ initialized: false });

            const errorMessage = response?.error || '未知错误';
            chrome.storage.local.get(['preferredLang'], function (langResult) {
                const lang = langResult.preferredLang || 'zh_CN';
                showStatus((lang === 'en' ? 'Initialization failed: ' : '初始化上传失败: ') + errorMessage, 'error');
            });
        }
    });
}

/**
 * 处理手动上传函数。
 */
function handleManualUpload() {
    showStatus('开始手动上传...', 'info');

    const overlayButton = document.getElementById('manualBackupBtnOverlay');
    const legacyButton = document.getElementById('uploadToCloudManual');

    const isButtonVisible = (btn) => {
        if (!btn) return false;
        try {
            return window.getComputedStyle(btn).display !== 'none';
        } catch (_) {
            return true;
        }
    };

    // 优先使用“状态卡片右下角”的按钮作为主按钮（可见、可动画）
    const primaryButton = isButtonVisible(overlayButton) ? overlayButton : legacyButton;

    // 禁用所有相关按钮，避免重复触发
    const buttonsToLock = [overlayButton, legacyButton].filter(Boolean);
    const disabledSnapshot = new Map();
    buttonsToLock.forEach(btn => {
        disabledSnapshot.set(btn, btn.disabled);
        btn.disabled = true;
    });

    // 发送上传请求
    chrome.runtime.sendMessage({
        action: "syncBookmarks",
        direction: "upload"
    }, (response) => {
        // 恢复按钮状态
        buttonsToLock.forEach(btn => {
            const prevDisabled = disabledSnapshot.get(btn);
            btn.disabled = prevDisabled === true;
        });

        if (response && response.success) {
            // ... (保持原有的成功处理逻辑，包括发送 manualBackupCompleted)
            chrome.storage.local.get(['preferredLang'], function (langResult) {
                const lang = langResult.preferredLang || 'zh_CN';
                const targets = [];
                if (response.webDAVSuccess) targets.push(lang === 'en' ? 'Cloud 1 (WebDAV)' : '云端1(WebDAV)');
                if (response.githubRepoSuccess) targets.push(lang === 'en' ? 'Cloud 2 (GitHub Repo)' : '云端2(GitHub仓库)');
                if (response.localSuccess) targets.push(lang === 'en' ? 'Local' : '本地');

                let targetsText = targets.join(lang === 'en' ? ' & ' : '和');
                if (!targetsText) {
                    targetsText = lang === 'en' ? 'Unknown target' : '未知位置';
                }

                const successMessage = lang === 'en'
                    ? `Backed up to ${targetsText}!`
                    : `成功备份到${targetsText}！`;

                showStatus(successMessage, 'success');
            });
            chrome.runtime.sendMessage({ action: "manualBackupCompleted" });
            const initHeader = document.getElementById('initHeader');
            const initContent = document.getElementById('initContent');
            if (initHeader && initContent) {
                initContent.style.display = 'none';
                initHeader.classList.add('collapsed');
            }
            const syncStatusDiv = document.getElementById('syncStatus');
            if (syncStatusDiv) {
                syncStatusDiv.style.display = 'block';
            }

            // 更新备份历史记录 - 确保应用当前语言
            chrome.storage.local.get(['preferredLang'], function (result) {
                const currentLang = result.preferredLang || 'zh_CN';
                updateSyncHistory();
            });

            const manualSyncOptions = document.getElementById('manualSyncOptions');
            if (manualSyncOptions) {
                chrome.storage.local.get(['autoSync'], function (autoSyncData) {
                    const autoSyncEnabled = autoSyncData.autoSync !== false;
                    manualSyncOptions.style.display = autoSyncEnabled ? 'none' : 'block';
                });
            }
            if (primaryButton) {
                // 1. Lock dimensions strictly
                primaryButton.classList.add('success-animating');

                const rect = primaryButton.getBoundingClientRect();
                const originalHTML = primaryButton.innerHTML;

                // 保存 inline 样式，避免动画结束后把按钮隐藏掉（overlay 的 display 由 JS 控制）
                const originalStyles = {
                    flex: primaryButton.style.flex,
                    width: primaryButton.style.width,
                    height: primaryButton.style.height,
                    padding: primaryButton.style.padding,
                    display: primaryButton.style.display,
                    alignItems: primaryButton.style.alignItems,
                    justifyContent: primaryButton.style.justifyContent
                };

                primaryButton.style.flex = `0 0 ${rect.width}px`;
                primaryButton.style.width = `${rect.width}px`;
                primaryButton.style.height = `${rect.height}px`;

                primaryButton.style.padding = '0';
                primaryButton.style.display = 'flex';
                primaryButton.style.alignItems = 'center';
                primaryButton.style.justifyContent = 'center';

                // 2. Wrap existing content for animation
                primaryButton.innerHTML = `<span class="anim-content">${originalHTML}</span>`;

                // Force reflow
                void primaryButton.offsetWidth;

                const fadeNode = primaryButton.querySelector('.anim-content');
                if (fadeNode) fadeNode.classList.add('anim-out');

                setTimeout(() => {
                    // 3. Swap to Checkmark (Start Hidden/Scaled down)
                    primaryButton.innerHTML = `<i class="fas fa-check anim-content anim-out" style="font-size: 14px; color: white;"></i>`;

                    // Force reflow
                    void primaryButton.offsetWidth;

                    const checkNode = primaryButton.querySelector('.anim-content');
                    if (checkNode) checkNode.classList.remove('anim-out');

                    // 4. Wait, then reverse
                    setTimeout(() => {
                        const checkNode2 = primaryButton.querySelector('.anim-content');
                        if (checkNode2) checkNode2.classList.add('anim-out');

                        setTimeout(() => {
                            // 5. Swap back to original content (Start Hidden)
                            primaryButton.innerHTML = `<span class="anim-content anim-out">${originalHTML}</span>`;

                            // Force reflow
                            void primaryButton.offsetWidth;

                            const textNode = primaryButton.querySelector('.anim-content');
                            if (textNode) textNode.classList.remove('anim-out');

                            setTimeout(() => {
                                // 6. Cleanup / Restore Original State
                                primaryButton.innerHTML = originalHTML;
                                primaryButton.classList.remove('success-animating');

                                primaryButton.style.flex = originalStyles.flex;
                                primaryButton.style.width = originalStyles.width;
                                primaryButton.style.height = originalStyles.height;
                                primaryButton.style.padding = originalStyles.padding;
                                primaryButton.style.display = originalStyles.display;
                                primaryButton.style.alignItems = originalStyles.alignItems;
                                primaryButton.style.justifyContent = originalStyles.justifyContent;
                            }, 300);
                        }, 300);
                    }, 1200);
                }, 300);
            }
            chrome.storage.local.set({ initialized: true });
        } else {
            const errorMessage = response?.error || '未知错误';
            showStatus('手动上传失败: ' + errorMessage, 'error');
        }
    });
}

/**
 * 导出备份历史记录为txt文件。
 */
function exportSyncHistory() {
    showStatus(window.i18nLabels?.exportingHistory || '正在导出历史记录...', 'info');

    chrome.storage.local.get([
        'syncHistory', 'preferredLang',
        // 云端1：WebDAV配置
        'serverAddress', 'username', 'password', 'webDAVEnabled',
        // 云端2：GitHub Repository 配置
        'githubRepoToken', 'githubRepoOwner', 'githubRepoName', 'githubRepoBranch', 'githubRepoBasePath', 'githubRepoEnabled',
        // 本地配置
        'defaultDownloadEnabled'
    ], async (data) => {
        const syncHistory = data.syncHistory || [];
        const lang = data.preferredLang || 'zh_CN';

        // 检查云端1：WebDAV配置
        const webDAVConfigured = data.serverAddress && data.username && data.password;
        const webDAVEnabled = data.webDAVEnabled !== false;

        // 检查云端2：GitHub Repository 配置
        const githubRepoConfigured = !!(data.githubRepoToken && data.githubRepoOwner && data.githubRepoName);
        const githubRepoEnabled = data.githubRepoEnabled !== false;

        // 检查本地备份配置
        const defaultDownloadEnabled = data.defaultDownloadEnabled === true;
        const localBackupConfigured = defaultDownloadEnabled;

        let txtContent = "";

        // Internationalized strings
        const exportTitle = {
            'zh_CN': "# 书签备份历史记录",
            'en': "# Bookmark Backup History"
        };
        const exportNote = {
            'zh_CN': "注意：此文件 (.txt) 包含 Markdown 表格格式的内容。\n" +
                "您可以：\n" +
                "1. 将此文件内容复制粘贴到支持 Markdown 的编辑器（如 Typora, Obsidian 等）中查看表格。\n" +
                "2. 或者，将此文件的扩展名从 .txt 修改为 .md 后，使用 Markdown 查看器打开。",
            'en': "Note: This file (.txt) contains content in Markdown table format.\n" +
                "You can either:\n" +
                "1. Copy and paste the content of this file into a Markdown-supporting editor (e.g., Typora, Obsidian) to view the table.\n" +
                "2. Or, change the file extension from (.txt) to (.md) and open it with a Markdown viewer."
        };
        const tableHeaders = {
            timestamp: { 'zh_CN': "时间戳", 'en': "Timestamp" },
            notes: { 'zh_CN': "备注", 'en': "Notes" },
            bookmarkChange: { 'zh_CN': "书签变化", 'en': "BKM Change" },
            folderChange: { 'zh_CN': "文件夹变化", 'en': "FLD Change" },
            movedCount: { 'zh_CN': "移动", 'en': "Moved" },
            modifiedCount: { 'zh_CN': "修改", 'en': "Modified" },
            location: { 'zh_CN': "位置", 'en': "Location" },
            type: { 'zh_CN': "类型", 'en': "Type" },
            status: { 'zh_CN': "状态/错误", 'en': "Status/Error" }
        };
        const locationValues = {
            upload: { 'zh_CN': "云端", 'en': "Cloud" }, // 兼容旧记录
            cloud: { 'zh_CN': "云端1, 云端2", 'en': "Cloud 1, Cloud 2" },
            webdav: { 'zh_CN': "云端1(WebDAV)", 'en': "Cloud 1 (WebDAV)" },
            github_repo: { 'zh_CN': "云端2(GitHub仓库)", 'en': "Cloud 2 (GitHub Repo)" },
            gist: { 'zh_CN': "云端2(GitHub仓库)", 'en': "Cloud 2 (GitHub Repo)" }, // legacy
            cloud_local: { 'zh_CN': "云端1, 云端2, 本地", 'en': "Cloud 1, Cloud 2, Local" },
            webdav_local: { 'zh_CN': "云端1(WebDAV), 本地", 'en': "Cloud 1 (WebDAV), Local" },
            github_repo_local: { 'zh_CN': "云端2(GitHub仓库), 本地", 'en': "Cloud 2 (GitHub Repo), Local" },
            gist_local: { 'zh_CN': "云端2(GitHub仓库), 本地", 'en': "Cloud 2 (GitHub Repo), Local" }, // legacy
            local: { 'zh_CN': "本地", 'en': "Local" },
            both: { 'zh_CN': "云端1(WebDAV), 本地", 'en': "Cloud 1 (WebDAV), Local" }, // 兼容旧记录
            none: { 'zh_CN': "无", 'en': "None" }
        };
        const typeValues = {
            auto: { 'zh_CN': "自动", 'en': "Auto" },
            manual: { 'zh_CN': "手动", 'en': "Manual" },
            switch: { 'zh_CN': "切换", 'en': "Switch" },
            migration: { 'zh_CN': "迁移", 'en': "Migration" },
            check: { 'zh_CN': "检查", 'en': "Check" }
        };
        const statusValues = {
            success: { 'zh_CN': "成功", 'en': "Success" },
            error: { 'zh_CN': "错误", 'en': "Error" },
            locked: { 'zh_CN': "文件锁定", 'en': "File Locked" },
            noBackupNeeded: { 'zh_CN': "无需备份", 'en': "No backup needed" },
            checkCompleted: { 'zh_CN': "检查完成", 'en': "Check completed" }
        };

        const filenameBase = { 'zh_CN': "书签备份历史记录", 'en': "Bookmark_Backup_History" };

        // Format timestamp for display
        const formatTimeForExport = (date) => {
            return `${date.getFullYear()}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
        };

        // Header section
        txtContent += exportTitle[lang] + "\n\n";
        txtContent += exportNote[lang] + "\n\n";

        // Table Headers
        txtContent += `| ${tableHeaders.timestamp[lang]} | ${tableHeaders.notes[lang]} | ${tableHeaders.bookmarkChange[lang]} | ${tableHeaders.folderChange[lang]} | ${tableHeaders.movedCount[lang]} | ${tableHeaders.modifiedCount[lang]} | ${tableHeaders.location[lang]} | ${tableHeaders.type[lang]} | ${tableHeaders.status[lang]} |\n`;
        txtContent += "|---|---|---|---|---|---|---|---|---|\n";

        // Table Rows
        // 添加日期分界线的处理
        let previousDateStr = null;

        // 对记录按时间排序，新的在前
        const sortedHistory = [...syncHistory].sort((a, b) => new Date(b.time) - new Date(a.time));

        sortedHistory.forEach(record => {
            const recordDate = new Date(record.time);
            const time = formatTimeForExport(recordDate);

            // 检查日期是否变化（年月日）
            const currentDateStr = `${recordDate.getFullYear()}-${recordDate.getMonth() + 1}-${recordDate.getDate()}`;

            // 如果日期变化，添加分界线
            if (previousDateStr && previousDateStr !== currentDateStr) {
                // 使用Markdown格式添加日期分界线
                const formattedPreviousDate = lang === 'en' ?
                    `${previousDateStr.split('-')[0]}-${previousDateStr.split('-')[1].padStart(2, '0')}-${previousDateStr.split('-')[2].padStart(2, '0')}` :
                    `${previousDateStr.split('-')[0]}年${previousDateStr.split('-')[1]}月${previousDateStr.split('-')[2]}日`;

                // 添加简洁的分界线，并入表格中
                txtContent += `| ${formattedPreviousDate} |  |  |  |  |  |  |  |  |  |\n`;
            }

            // 更新前一个日期
            previousDateStr = currentDateStr;

            // 直接使用记录中保存的绝对值（与主UI保持一致）
            const bookmarkAdded = typeof record.bookmarkStats?.bookmarkAdded === 'number' ? record.bookmarkStats.bookmarkAdded : 0;
            const bookmarkDeleted = typeof record.bookmarkStats?.bookmarkDeleted === 'number' ? record.bookmarkStats.bookmarkDeleted : 0;
            const folderAdded = typeof record.bookmarkStats?.folderAdded === 'number' ? record.bookmarkStats.folderAdded : 0;
            const folderDeleted = typeof record.bookmarkStats?.folderDeleted === 'number' ? record.bookmarkStats.folderDeleted : 0;

            // 格式化书签变化（+x/-y 或者 0）
            let bookmarkChangeText = '';
            if (bookmarkAdded > 0 && bookmarkDeleted > 0) {
                bookmarkChangeText = `+${bookmarkAdded}/-${bookmarkDeleted}`;
            } else if (bookmarkAdded > 0) {
                bookmarkChangeText = `+${bookmarkAdded}`;
            } else if (bookmarkDeleted > 0) {
                bookmarkChangeText = `-${bookmarkDeleted}`;
            } else {
                // 兼容旧数据：使用 bookmarkDiff
                const diff = record.bookmarkStats?.bookmarkDiff ?? 0;
                bookmarkChangeText = diff > 0 ? `+${diff}` : (diff < 0 ? `${diff}` : '0');
            }

            // 格式化文件夹变化（+x/-y 或者 0）
            let folderChangeText = '';
            if (folderAdded > 0 && folderDeleted > 0) {
                folderChangeText = `+${folderAdded}/-${folderDeleted}`;
            } else if (folderAdded > 0) {
                folderChangeText = `+${folderAdded}`;
            } else if (folderDeleted > 0) {
                folderChangeText = `-${folderDeleted}`;
            } else {
                // 兼容旧数据：使用 folderDiff
                const diff = record.bookmarkStats?.folderDiff ?? 0;
                folderChangeText = diff > 0 ? `+${diff}` : (diff < 0 ? `${diff}` : '0');
            }

            // 直接使用保存的移动数量（与主UI保持一致）
            let movedTotal = 0;
            if (typeof record.bookmarkStats?.movedCount === 'number' && record.bookmarkStats.movedCount > 0) {
                movedTotal = record.bookmarkStats.movedCount;
            } else {
                // 兼容旧数据
                const bookmarkMovedCount = typeof record.bookmarkStats?.bookmarkMoved === 'number'
                    ? record.bookmarkStats.bookmarkMoved
                    : (record.bookmarkStats?.bookmarkMoved ? 1 : 0);
                const folderMovedCount = typeof record.bookmarkStats?.folderMoved === 'number'
                    ? record.bookmarkStats.folderMoved
                    : (record.bookmarkStats?.folderMoved ? 1 : 0);
                movedTotal = bookmarkMovedCount + folderMovedCount;
            }
            const movedText = movedTotal > 0 ? String(movedTotal) : '-';

            // 直接使用保存的修改数量（与主UI保持一致）
            let modifiedTotal = 0;
            if (typeof record.bookmarkStats?.modifiedCount === 'number' && record.bookmarkStats.modifiedCount > 0) {
                modifiedTotal = record.bookmarkStats.modifiedCount;
            } else {
                // 兼容旧数据
                const bookmarkModifiedCount = typeof record.bookmarkStats?.bookmarkModified === 'number'
                    ? record.bookmarkStats.bookmarkModified
                    : (record.bookmarkStats?.bookmarkModified ? 1 : 0);
                const folderModifiedCount = typeof record.bookmarkStats?.folderModified === 'number'
                    ? record.bookmarkStats.folderModified
                    : (record.bookmarkStats?.folderModified ? 1 : 0);
                modifiedTotal = bookmarkModifiedCount + folderModifiedCount;
            }
            const modifiedText = modifiedTotal > 0 ? String(modifiedTotal) : '-';


            let locationText = 'N/A';
            const recordDirection = (record.direction ?? 'none').toString();
            if (locationValues[recordDirection]) {
                locationText = locationValues[recordDirection][lang];
            } else if (recordDirection === 'download') {
                // 兼容旧记录
                locationText = locationValues.local[lang];
            } else if (recordDirection === 'none') {
                locationText = locationValues.none[lang];
            }

            let typeText = 'N/A';
            if (record.type === '（自动）') {
                typeText = typeValues.auto[lang];
            } else if (record.type === '（手动）') {
                typeText = typeValues.manual[lang];
            } else if (record.type === '（切换）') {
                typeText = typeValues.switch[lang];
            }

            let statusText = 'N/A';
            if (record.status === 'success') {
                if (record.direction === 'none') {
                    // If direction is 'none', it implies a check was done, not a backup.
                    // Prefer 'Check completed' or 'No backup needed' based on context if available.
                    statusText = statusValues.checkCompleted[lang] || statusValues.noBackupNeeded[lang];
                } else {
                    statusText = statusValues.success[lang];
                }
            } else if (record.status === 'error') {
                statusText = record.errorMessage ? `${statusValues.error[lang]}: ${record.errorMessage}` : statusValues.error[lang];
            } else if (record.status === 'locked') {
                statusText = statusValues.locked[lang];
            }

            txtContent += `| ${time} | ${record.note || ''} | ${bookmarkChangeText} | ${folderChangeText} | ${movedText} | ${modifiedText} | ${locationText} | ${typeText} | ${statusText} |\n`;
        });

        // 添加最后一个日期的分界线
        if (previousDateStr) {
            const formattedPreviousDate = lang === 'en' ?
                `${previousDateStr.split('-')[0]}-${previousDateStr.split('-')[1].padStart(2, '0')}-${previousDateStr.split('-')[2].padStart(2, '0')}` :
                `${previousDateStr.split('-')[0]}年${previousDateStr.split('-')[1]}月${previousDateStr.split('-')[2]}日`;

            // 添加简洁的分界线，并入表格中
            txtContent += `| ${formattedPreviousDate} |  |  |  |  |  |  |  |  |\n`;
        }

        // 根据配置决定导出方式
        let exportResults = [];
        let webDAVSuccess = false;
        let githubRepoSuccess = false;
        let localSuccess = false;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `${filenameBase[lang]}_${timestamp}.txt`;

        // 云端1：WebDAV 导出
        if (webDAVConfigured && webDAVEnabled) {
            try {
                showStatus(window.i18nLabels?.exportingToWebDAV || '正在导出到云端1...', 'info');

                // 使用background.js中已有的WebDAV导出功能
                const result = await callBackgroundFunction('exportHistoryToWebDAV', {
                    content: txtContent,
                    fileName: fileName,
                    lang: lang
                });

                if (result && result.success) {
                    webDAVSuccess = true;
                    exportResults.push(window.i18nLabels?.exportedToWebDAV || '历史记录已成功导出到云端1');
                } else {
                    exportResults.push(window.i18nLabels?.exportToWebDAVFailed || '导出到云端1失败: ' + (result?.error || '未知错误'));
                }
            } catch (error) {
                exportResults.push(window.i18nLabels?.exportToWebDAVFailed || `导出到云端1失败: ${error.message || '未知错误'}`);
            }
        }

        // 云端2：GitHub Repository 导出
        if (githubRepoConfigured && githubRepoEnabled) {
            try {
                showStatus(window.i18nLabels?.exportingToGithubRepo || '正在导出到云端2...', 'info');

                const result = await callBackgroundFunction('exportHistoryToGitHubRepo', {
                    content: txtContent,
                    fileName: fileName,
                    lang: lang
                });

                if (result && result.success) {
                    githubRepoSuccess = true;
                    exportResults.push(window.i18nLabels?.exportedToGithubRepo || '历史记录已成功导出到云端2');
                } else {
                    exportResults.push(window.i18nLabels?.exportToGithubRepoFailed || '导出到云端2失败: ' + (result?.error || '未知错误'));
                }
            } catch (error) {
                exportResults.push(window.i18nLabels?.exportToGithubRepoFailed || `导出到云端2失败: ${error.message || '未知错误'}`);
            }
        }

        // 本地导出
        const cloudExportEnabled = (webDAVConfigured && webDAVEnabled) || (githubRepoConfigured && githubRepoEnabled);
        if (localBackupConfigured || !cloudExportEnabled) {
            try {
                showStatus(window.i18nLabels?.exportingToLocal || '正在导出到本地...', 'info');

                // 使用background.js中的下载功能，确保能创建子文件夹
                const result = await callBackgroundFunction('exportHistoryToLocal', {
                    content: txtContent,
                    fileName: fileName,
                    lang: lang
                });

                if (result && result.success) {
                    localSuccess = true;
                    exportResults.push(window.i18nLabels?.exportedToLocal || '历史记录已成功导出到本地');
                } else {
                    exportResults.push(window.i18nLabels?.exportToLocalFailed || `导出到本地失败: ${result?.error || '未知错误'}`);
                }
            } catch (error) {
                exportResults.push(window.i18nLabels?.exportToLocalFailed || `导出到本地失败: ${error.message || '未知错误'}`);
            }
        }

        // 显示最终结果
        const anySuccess = webDAVSuccess || githubRepoSuccess || localSuccess;
        const resultText = exportResults.length > 0 ? exportResults.join('，') : (window.i18nLabels?.exportHistoryFailed || '导出历史记录失败');
        showStatus(resultText, anySuccess ? 'success' : 'error', 3000);
    });
}

/**
 * 清空备份历史记录。
 */
function clearSyncHistory() {
    chrome.runtime.sendMessage({ action: "clearSyncHistory" }, (clearResponse) => {
        if (clearResponse && clearResponse.success) {
            // 注意：cachedRecordAfterClear 现在由 background.js 在清空时保存
            // 用于清空后第一条记录的详细变化对比显示

            // 清理 History Viewer（history.html）里按记录持久化的详情状态（模式/展开），避免残留旧记录痕迹
            try {
                for (let i = localStorage.length - 1; i >= 0; i--) {
                    const key = localStorage.key(i);
                    if (!key) continue;
                    if (key.startsWith('historyDetailMode:') || key.startsWith('historyDetailExpanded:')) {
                        localStorage.removeItem(key);
                    }
                }
            } catch (_) { }

            updateSyncHistory();
            showStatus('历史记录已清空', 'success');
        } else {
            showStatus('清空历史记录失败', 'error');
        }
    });
}



// =============================================================================
// 提醒设置相关函数 (Reminder Settings Functions)
// =============================================================================

/**
 * 加载提醒设置。
 * @async
 */
async function loadReminderSettings() {
    // 默认值
    const defaultSettings = {
        reminderEnabled: true,
        firstReminderMinutes: 60,
        fixedTimeEnabled1: true,
        fixedTime1: "09:30",
        fixedTimeEnabled2: false,
        fixedTime2: "16:00"
    };

    const reminderToggle = document.getElementById('reminderToggle');
    const firstReminderMinutes = document.getElementById('firstReminderMinutes');
    const fixedTimeToggle1 = document.getElementById('fixedTimeToggle1');
    const fixedTime1 = document.getElementById('fixedTime1');
    const fixedTimeToggle2 = document.getElementById('fixedTimeToggle2');
    const fixedTime2 = document.getElementById('fixedTime2');

    try {
        const result = await chrome.storage.local.get('reminderSettings'); // 使用 chrome.storage
        const settings = result.reminderSettings || defaultSettings;

        // 应用设置到UI
        updateToggleState(reminderToggle, settings.reminderEnabled !== false);
        firstReminderMinutes.value = settings.firstReminderMinutes !== undefined ?
            settings.firstReminderMinutes : defaultSettings.firstReminderMinutes;

        // 应用准点定时设置
        updateToggleState(fixedTimeToggle1, settings.fixedTimeEnabled1 === true);
        fixedTime1.value = settings.fixedTime1 || defaultSettings.fixedTime1;

        updateToggleState(fixedTimeToggle2, settings.fixedTimeEnabled2 === true);
        fixedTime2.value = settings.fixedTime2 || defaultSettings.fixedTime2;

    } catch (error) {
        // 失败时应用默认设置
        updateToggleState(reminderToggle, defaultSettings.reminderEnabled);
        firstReminderMinutes.value = defaultSettings.firstReminderMinutes;
        updateToggleState(fixedTimeToggle1, defaultSettings.fixedTimeEnabled1);
        fixedTime1.value = defaultSettings.fixedTime1;
        updateToggleState(fixedTimeToggle2, defaultSettings.fixedTimeEnabled2);
        fixedTime2.value = defaultSettings.fixedTime2;
    }
}

/**
 * 保存提醒设置。
 * @async
 * @returns {Promise<boolean>} 是否保存成功。
 */
async function saveReminderSettingsFunc() {
    const reminderToggle = document.getElementById('reminderToggle');
    const firstReminderMinutes = document.getElementById('firstReminderMinutes');
    const fixedTimeToggle1 = document.getElementById('fixedTimeToggle1');
    const fixedTime1 = document.getElementById('fixedTime1');
    const fixedTimeToggle2 = document.getElementById('fixedTimeToggle2');
    const fixedTime2 = document.getElementById('fixedTime2');

    try {
        const settings = {
            reminderEnabled: getToggleState(reminderToggle),
            firstReminderMinutes: parseInt(firstReminderMinutes.value) || 0,
            fixedTimeEnabled1: getToggleState(fixedTimeToggle1),
            fixedTime1: fixedTime1.value,
            fixedTimeEnabled2: getToggleState(fixedTimeToggle2),
            fixedTime2: fixedTime2.value
        };

        await chrome.storage.local.set({ reminderSettings: settings }); // 使用 chrome.storage
        // 向后台发送设置更新消息，并添加重置标志
        // 首先发送停止当前计时器的消息
        await chrome.runtime.sendMessage({ action: "stopReminderTimer" }); // 使用 chrome.runtime

        // 然后发送更新设置并重新开始计时的消息
        await chrome.runtime.sendMessage({ // 使用 chrome.runtime
            action: "updateReminderSettings",
            settings: settings,
            resetTimer: true,
            restartTimer: true
        }).then(response => {
        }).catch(error => {
        });

        // 显示保存成功提示
        showSettingsSavedIndicator();

        return true;
    } catch (error) {
        return false;
    }
}

/**
 * 暂停备份提醒计时器。
 * @async
 */
async function pauseTimerForSettings() {
    // 功能已移除
}

/**
 * 恢复备份提醒计时器。
 * @async
 */
async function resumeTimerForSettings() {
    // 功能已移除
}

/**
 * 检查URL参数，如果有openReminderDialog=true则自动打开手动备份动态提醒设置。
 */
function checkUrlParams() {
    // 检查URL参数，如果包含 openReminderSettings=true，则自动打开提醒设置对话框
    const urlParams = new URLSearchParams(window.location.search);
    const openDialog = urlParams.get('openReminderSettings');

    if (openDialog === 'true') {
        // 确保页面完全加载后再自动点击按钮
        setTimeout(() => {
            const reminderSettingsBtn = document.getElementById('reminderSettingsBtn');
            if (reminderSettingsBtn) {
                reminderSettingsBtn.click();
            } else {
            }
        }, 500);
    }
}


// =============================================================================
// 国际化 (Internationalization)
// =============================================================================

/**
 * Function to initialize and handle language switching.
 * @async
 */
async function initializeLanguageSwitcher() {
    const langToggleButton = document.getElementById('lang-toggle-btn');
    let currentLang = 'zh_CN'; // 默认值

    const detectDefaultLang = () => {
        try {
            const ui = (chrome?.i18n?.getUILanguage?.() || '').toLowerCase();
            return ui.startsWith('zh') ? 'zh_CN' : 'en';
        } catch (e) {
            return 'zh_CN';
        }
    };

    try {
        // 直接从存储中获取已设置的语言偏好
        const result = await new Promise(resolve => chrome.storage.local.get('preferredLang', resolve));

        if (result.preferredLang) {
            currentLang = result.preferredLang;
        } else {
            currentLang = detectDefaultLang();
            try {
                await chrome.storage.local.set({ preferredLang: currentLang });
            } catch (e) {
            }
        }

        document.documentElement.setAttribute('lang', currentLang === 'en' ? 'en' : 'zh');
        await applyLocalizedContent(currentLang);
    } catch (e) {
        document.documentElement.setAttribute('lang', 'zh'); // Fallback
        await applyLocalizedContent('zh_CN'); // Fallback
    }

    if (langToggleButton) {
        langToggleButton.addEventListener('click', async () => {
            currentLang = (currentLang === 'zh_CN') ? 'en' : 'zh_CN';
            try {
                await chrome.storage.local.set({ preferredLang: currentLang });
                document.documentElement.setAttribute('lang', currentLang === 'en' ? 'en' : 'zh');

                const result = await chrome.storage.local.get(['initialized']);
                if (result.initialized === true) {
                    chrome.runtime.sendMessage({
                        action: "setBadge"
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                        } else if (response && response.success) {
                        }
                    });
                }
            } catch (e) {
            }

            await applyLocalizedContent(currentLang);
            updateSyncHistory(currentLang); // Pass currentLang
            // updateBookmarkCountDisplay is called by applyLocalizedContent via updateLastSyncInfo

        });
    }
}

/**
 * Applies localized content to the DOM elements based on the selected language.
 * @param {string} lang - The target language ('zh_CN' or 'en').
 * @async
 */
const applyLocalizedContent = async (lang) => { // Added lang parameter
    // 定义所有需要国际化的文本
    const pageTitleStrings = {
        'zh_CN': "书签备份",
        'en': "Bookmark Backup"
    };

    // 添加导出历史记录相关的国际化字符串
    const exportingHistoryStrings = {
        'zh_CN': "正在导出历史记录...",
        'en': "Exporting history..."
    };

    const exportingToWebDAVStrings = {
        'zh_CN': "正在导出到云端1...",
        'en': "Exporting to Cloud 1..."
    };

    const exportingToGithubRepoStrings = {
        'zh_CN': "正在导出到云端2...",
        'en': "Exporting to Cloud 2..."
    };

    const exportingToLocalStrings = {
        'zh_CN': "正在导出到本地...",
        'en': "Exporting to local..."
    };

    const exportedToWebDAVStrings = {
        'zh_CN': "历史记录已成功导出到云端1",
        'en': "History successfully exported to Cloud 1"
    };

    const exportedToGithubRepoStrings = {
        'zh_CN': "历史记录已成功导出到云端2",
        'en': "History successfully exported to Cloud 2"
    };

    const exportedToLocalStrings = {
        'zh_CN': "历史记录已成功导出到本地",
        'en': "History successfully exported to local"
    };

    const exportedToBothStrings = {
        'zh_CN': "历史记录已成功导出到云端与本地",
        'en': "History successfully exported to cloud and local"
    };

    const exportToWebDAVFailedStrings = {
        'zh_CN': "导出到云端1失败",
        'en': "Failed to export to Cloud 1"
    };

    const exportToGithubRepoFailedStrings = {
        'zh_CN': "导出到云端2失败",
        'en': "Failed to export to Cloud 2"
    };

    const exportToLocalFailedStrings = {
        'zh_CN': "导出到本地失败",
        'en': "Failed to export to local"
    };

    // 添加初始备份文件相关的国际化字符串
    initialBackupFileStrings = {
        'zh_CN': "您的初始备份文件：",
        'en': "Your Initial Backup File:"
    };

    backupTypeStrings = {
        'zh_CN': "备份类型:",
        'en': "Backup Type:"
    };

    timeStrings = {
        'zh_CN': "时间:",
        'en': "Time:"
    };

    localBackupTypeStrings = {
        'zh_CN': "本地",
        'en': "Local"
    };

    cloudBackupTypeStrings = {
        'zh_CN': "云端",
        'en': "Cloud"
    };

    const lastChangeLabel = {
        'zh_CN': "上次变动:",
        'en': "Last Change:"
    };

    const currentQuantityLabel = {
        'zh_CN': "当前数量/结构:",
        'en': "Details:" // 修改为更简洁的英文翻译
    };


    const bookmarksLabel = {
        'zh_CN': "个书签",
        'en': "BKM"
    };

    const foldersLabel = {
        'zh_CN': "个文件夹",
        'en': "FLD"
    };

    const bookmarkChangedLabel = {
        'zh_CN': "书签变动",
        'en': "BKM changed"
    };

    const folderChangedLabel = {
        'zh_CN': "文件夹变动",
        'en': "FLD changed"
    };

    const bookmarkAndFolderChangedLabel = { // New label
        'zh_CN': "书签和文件夹变动",
        'en': "BKM & FLD changed"
    };

    // 新增UI文字的国际化
    const autoSyncDescriptionStrings = {
        'zh_CN': "自动备份",
        'en': "Auto Backup Mode"
    };

    const manualModeDescriptionStrings = {
        'zh_CN': "手动备份",
        'en': "Manual Backup"
    };

    // 新增：自动备份设置按钮 文案
    const autoBackupSettingsStrings = {
        'zh_CN': "自动备份设置",
        'en': "Auto Backup Settings"
    };

    const autoSyncTipStrings = {
        'zh_CN': "（<span style=\"color: #FFA500;\">大规模修改</span>时建议切换至手动模式）",
        'en': "(Recommended to switch to manual mode during <span style=\"color: #FFA500;\">bulk changes</span>)"
    };

    // 手动备份模式提示字符串
    const manualModeTipStrings = {
        'zh_CN': "（<span style=\"color: var(--theme-success-color);\">手动备份模式</span>需点击右方按钮备份）",
        'en': "(<span style=\"color: var(--theme-success-color);\">Manual mode</span> requires clicking the right button to backup)"
    };

    const historyRecordsDescriptionStrings = {
        'zh_CN': "备份历史",
        'en': "Backup History"
    };

    const openHistoryViewerStrings = {
        'zh_CN': "详细查看器",
        'en': "Detail Viewer"
    };

    const clearHistoryStrings = {
        'zh_CN': "清空记录",
        'en': "Clear History"
    };

    const exportHistoryStrings = {
        'zh_CN': "导出记录",
        'en': "Export History"
    };

    const timeColumnStrings = {
        'zh_CN': "时间与备注",
        'en': "Time & Notes"
    };

    const quantityColumnStrings = {
        'zh_CN': "数量与结构",
        'en': "Quantity & Structure"
    };

    const statusColumnStrings = {
        'zh_CN': "状态",
        'en': "Status"
    };

    const reminderSettingsStrings = {
        'zh_CN': "动态提醒设置",
        'en': "Reminder Settings"
    };

    const cyclicReminderStrings = {
        'zh_CN': "循环提醒",
        'en': "Cyclic Reminder"
    };

    const minutesUnitStrings = {
        'zh_CN': "分钟",
        'en': "minutes"
    };

    const fixedTime1Strings = {
        'zh_CN': "准点定时1",
        'en': "Fixed Time 1"
    };

    const fixedTime2Strings = {
        'zh_CN': "准点定时2",
        'en': "Fixed Time 2"
    };

    const scrollToTopStrings = {
        'zh_CN': "返回顶部",
        'en': "Back to Top"
    };

    const manualBackupReminderDescStrings = {
        'zh_CN': `循环提醒的计时：浏览器的<span class="highlight-text">实际使用时间</span>，即（多）窗口焦点时间。<br>手动备份下，进行操作（数量/结构变化）才会提醒，`,
        'en': `Cyclic Reminder timing: Browser's <span class='highlight-text'>actual usage time</span>.<br>Reminders only trigger after changes (quantity/structure),`
    };

    const reminderExampleStrings = {
        'zh_CN': "示例：(<span style=\"color: #4CAF50;\">+12</span> 书签，<span style=\"color: #4CAF50;\">+1</span> 文件夹，<span style=\"color: orange;\">书签、文件夹变动</span>)。",
        'en': "example: (<span style=\"color: #4CAF50;\">+12</span> BKM, <span style=\"color: #4CAF50;\">+1</span> FLD, <span style=\"color: orange;\">BKM & FLD changed</span>)." // Only text content changed, escaping matches original structure
    };

    const restoreDefaultStrings = {
        'zh_CN': "恢复默认",
        'en': "Restore Default"
    };

    const saveSettingsStrings = {
        'zh_CN': "保存设置",
        'en': "Save Settings"
    };

    const settingsSavedStrings = {
        'zh_CN': "设置已保存",
        'en': "Settings saved"
    };

    const manualBackupButtonStrings = {
        'zh_CN': "手动备份",
        'en': "Manual Backup"
    };

    // 云端1：WebDAV 配置部分
    const webdavConfigTitleStrings = {
        'zh_CN': "云端1：WebDAV配置（坚果云、NAS服务等）",
        'en': "Cloud 1: WebDAV Config (Nutstore, NAS, etc.)"
    };

    const serverAddressLabelStrings = {
        'zh_CN': "服务器地址",
        'en': "Server Address"
    };

    const serverAddressPlaceholderStrings = {
        'zh_CN': "WebDAV服务器地址",
        'en': "WebDAV Server Address"
    };

    const usernameLabelStrings = {
        'zh_CN': "账户",
        'en': "Username"
    };

    const usernamePlaceholderStrings = {
        'zh_CN': "WebDAV账户",
        'en': "WebDAV Username"
    };

    const passwordLabelStrings = {
        'zh_CN': "密码",
        'en': "Password"
    };

    const passwordPlaceholderStrings = {
        'zh_CN': "WebDAV应用密码",
        'en': "WebDAV App Password"
    };

    const saveConfigButtonStrings = {
        'zh_CN': "保存配置",
        'en': "Save Config"
    };

    const testWebdavButtonStrings = {
        'zh_CN': "测试连接",
        'en': "Test Connection"
    };

    // 云端2：GitHub Repository 配置部分
    const githubRepoConfigTitleStrings = {
        'zh_CN': "云端2：GitHub仓库配置",
        'en': "Cloud 2: GitHub Repo Config"
    };

    const githubRepoNoticeStrings = {
        'zh_CN': "",
        'en': ""
    };

    const githubRepoInfoLabelStrings = {
        'zh_CN': "仓库信息（显示）",
        'en': "Repo Info (display)"
    };

    const githubRepoOwnerLabelStrings = {
        'zh_CN': "Owner（用户名/组织）*",
        'en': "Owner (user/org) *"
    };

    const githubRepoOwnerPlaceholderStrings = {
        'zh_CN': "例如：kwenxu",
        'en': "e.g. kwenxu"
    };

    const githubRepoNameLabelStrings = {
        'zh_CN': "Repo（仓库名）*",
        'en': "Repository name *"
    };

    const githubRepoNamePlaceholderStrings = {
        'zh_CN': "例如：Bookmark-Backup",
        'en': "e.g. Bookmark-Backup"
    };

    const githubRepoBranchLabelStrings = {
        'zh_CN': "Branch（可选）",
        'en': "Branch (optional)"
    };

    const githubRepoBranchPlaceholderStrings = {
        'zh_CN': "留空=默认分支（推荐）",
        'en': "Empty = default branch (recommended)"
    };

    const githubRepoBasePathLabelStrings = {
        'zh_CN': "Base Path（可选，前缀目录）",
        'en': "Base Path (optional, prefix folder)"
    };

    const githubRepoBasePathPlaceholderStrings = {
        'zh_CN': "例如：kk/bookmark（选填，留空则存入仓库根目录）",
        'en': "e.g. kk/bookmark (Optional, empty = repo root)"
    };

    const githubRepoTokenLabelStrings = {
        'zh_CN': "GitHub Token（PAT）*",
        'en': "GitHub Token (PAT) *"
    };

    const githubRepoTokenPlaceholderStrings = {
        'zh_CN': "建议使用 Fine-grained Token；权限需 Contents: Read and write、Metadata: Read",
        'en': "Fine-grained Token recommended; Requires Contents: Read and write, Metadata: Read"
    };

    const saveGithubRepoConfigButtonStrings = {
        'zh_CN': "保存配置",
        'en': "Save Config"
    };

    const testGithubRepoButtonStrings = {
        'zh_CN': "测试连接",
        'en': "Test Connection"
    };

    // 本地配置部分
    const localConfigTitleStrings = {
        'zh_CN': "本地配置（本地私密、曲线onedrive/icould等）",
        'en': "Local Config (Private, OneDrive/iCloud, etc.)"
    };

    const localBackupPathLabelStrings = {
        'zh_CN': "本地备份路径（依赖浏览器默认下载路径）",
        'en': "Local Backup Path (Browser Default Download Path)"
    };

    const calibrateButtonStrings = {
        'zh_CN': "校准",
        'en': "Calibrate"
    };

    const calibratePathFullTextStrings = {
        'zh_CN': "手动校准路径 / 曲线云端备份（onedrive/icould等） / 全局隐藏下载栏",
        'en': "Manual Path Calibration / Cloud Backup Via Alternative Path (OneDrive/iCloud, etc.) / <br>Global Download Bar Hiding"
    };

    const hideDownloadBarLabelStrings = {
        'zh_CN': "防干扰：只在本地备份时隐藏下载栏（Edge 119+ 暂不适用）",
        'en': "Non-interference: Hide Download Bar Only During Backup (Edge 119+ not supported)"
    };

    const instructionsLabelStrings = {
        'zh_CN': "说明与规则",
        'en': "Instructions & Rules"
    };

    const defaultPathExamplesStrings = {
        'zh_CN': "默认路径示例：",
        'en': "Default Path Examples:"
    };

    const rulesNoCalibrationStrings = {
        'zh_CN': "不进行校准也可正常使用，主要是方便曲线云端或特定位置备份查看",
        'en': "Calibration optional, useful for cloud backup viewing"
    };

    const rulesNonInterferenceStrings = {
        'zh_CN': "防干扰功能不会应用全局，只在本地备份的时候临时启动，Chrome下载设置优先级更高",
        'en': "Non-interference works only during backup, Chrome settings take priority"
    };

    const rulesChromeRestrictionStrings = {
        'zh_CN': "由于Chrome扩展的安全限制，扩展无法直接写入系统中的绝对路径",
        'en': "Due to Chrome security, extensions cannot write to absolute paths"
    };

    const rulesDownloadAPIStrings = {
        'zh_CN': "下载API只能在浏览器的默认下载路径内保存书签与文件夹",
        'en': "Download API can only save to browser's default path"
    };

    const initButtonsTitleStrings = {
        'zh_CN': "设置与初始化",
        'en': "Settings & Initialization"
    };

    const resetButtonStrings = {
        'zh_CN': "恢复到初始状态",
        'en': "Reset to Initial State"
    };

    const initUploadButtonStrings = {
        'zh_CN': "初始化：上传书签到云端1/云端2/本地",
        'en': "Initialize: Upload to Cloud 1/Cloud 2/Local"
    };

    // 备份设置相关国际化字符串
    const backupSettingsTitleStrings = {
        'zh_CN': "备份设置",
        'en': "Backup Settings"
    };

    const bookmarkBackupTitleStrings = {
        'zh_CN': "书签备份",
        'en': "Bookmark Backup"
    };

    const bookmarkModeLabelStrings = {
        'zh_CN': "模式",
        'en': "Mode"
    };

    const backupModeAutoLabelStrings = { 'zh_CN': "自动", 'en': "Auto" };
    const backupModeManualLabelStrings = { 'zh_CN': "手动", 'en': "Manual" };

    const backupTimeLabelStrings = {
        'zh_CN': "时间频率",
        'en': "Time Frequency"
    };

    const bookmarkOverwriteLabelStrings = {
        'zh_CN': "策略",
        'en': "Strategy"
    };

    const backupModeLabelStrings = {
        'zh_CN': "备份模式:",
        'en': "Backup Mode:"
    };

    const backupModeFullStrings = {
        'zh_CN': "全量",
        'en': "Full"
    };

    const backupModeIncrementalStrings = {
        'zh_CN': "增量",
        'en': "Incremental"
    };

    const incrementalSimpleStrings = {
        'zh_CN': "简略",
        'en': "Simple"
    };

    const incrementalDetailedStrings = {
        'zh_CN': "详情",
        'en': "Detailed"
    };

    const overwritePolicyLabelStrings = {
        'zh_CN': "覆盖策略:",
        'en': "Overwrite Policy:"
    };

    const overwriteVersionedStrings = {
        'zh_CN': "版本化",
        'en': "Versioned"
    };

    const overwriteVersionedDescStrings = {
        'zh_CN': "(多文件)",
        'en': "(multi-file)"
    };

    const overwriteOverwriteStrings = {
        'zh_CN': "覆盖",
        'en': "Overwrite"
    };

    const overwriteOverwriteDescStrings = {
        'zh_CN': "(单文件)",
        'en': "(single file)"
    };

    // 当前变化自动归档设置相关国际化字符串
    const currentChangesArchiveTitleStrings = { 'zh_CN': "当前变化", 'en': "Current Changes" };
    const currentChangesArchiveFormatLabelStrings = { 'zh_CN': "格式", 'en': "Format" };
    const currentChangesArchiveModeLabelStrings = { 'zh_CN': "视图", 'en': "View" };
    const currentChangesArchiveModeSimpleLabelStrings = { 'zh_CN': "简略", 'en': "Simple" };
    const currentChangesArchiveModeDetailedLabelStrings = { 'zh_CN': "详细", 'en': "Detailed" };
    const currentChangesArchiveModeCollectionLabelStrings = { 'zh_CN': "集合", 'en': "Collection" };
    const currentChangesArchiveModeHelpAriaStrings = { 'zh_CN': "视图模式说明", 'en': "View mode help" };
    const currentChangesArchiveModeHelpTitleStrings = { 'zh_CN': "视图模式说明", 'en': "View mode help" };

    // 恢复相关国际化字符串
    const syncRestoreTitleStrings = {
        'zh_CN': "恢复",
        'en': "Restore"
    };

    const syncRestoreComingSoonStrings = {
        'zh_CN': "待选择",
        'en': "Pending Selection"
    };

    const restoreFromCloudStrings = {
        'zh_CN': "从云端恢复",
        'en': "Restore from Cloud"
    };

    const conflictResolutionStrings = {
        'zh_CN': "冲突处理",
        'en': "Conflict Resolution"
    };

    // 初始化操作相关国际化字符串
    const initActionsTitleStrings = {
        'zh_CN': "初始化操作",
        'en': "Initialization Actions"
    };

    // 校准路径对话框部分
    const calibratePathDialogTitleStrings = {
        'zh_CN': "手动校准路径",
        'en': "Manual Path Calibration"
    };

    const calibratePathInstruction1Strings = {
        'zh_CN': "点击右下角的\"打开下载设置\"按钮",
        'en': "Click the \"Open Download Settings\" button in the bottom right corner"
    };

    const calibratePathInstruction2Strings = {
        'zh_CN': "将显示的下载路径复制下来",
        'en': "Copy the displayed download path"
    };

    const calibratePathInstruction3Strings = {
        'zh_CN': "粘贴到下方输入框中",
        'en': "Paste it into the input box below"
    };

    const pastePathLabelStrings = {
        'zh_CN': "粘贴下载路径:",
        'en': "Paste Download Path:"
    };

    const pastePathPlaceholderStrings = {
        'zh_CN': "#下载内容--位置",
        'en': "#Download Content--Location"
    };

    const saveButtonStrings = {
        'zh_CN': "保存",
        'en': "Save"
    };

    const cloudBackupGuideTitleStrings = {
        'zh_CN': "曲线云端备份指南",
        'en': "Cloud Backup Guide"
    };

    const cloudBackupGuide1Strings = {
        'zh_CN': "修改浏览器默认下载路径至云盘处（频繁备份）",
        'en': "Change browser default download path to cloud storage (for frequent backups)"
    };

    const cloudBackupGuide2Strings = {
        'zh_CN': "在默认下载路径，手动进行文件夹Bookmarks关联，挂载至其他网盘",
        'en': "In the default download path, manually associate the Bookmarks folder to other cloud drives"
    };

    const cloudBackupGuide3Strings = {
        'zh_CN': "macOS设置：将\"桌面\"和\"文稿\"文件添加到 iCloud 云盘",
        'en': "macOS setup: Add 'Desktop' and 'Documents' folders to iCloud Drive"
    };

    const hideDownloadBarTitleStrings = {
        'zh_CN': "全局隐藏下载栏",
        'en': "Global Download Bar Hiding"
    };

    const hideDownloadBarGuide1Strings = {
        'zh_CN': "点击右下角的\"打开下载设置\"按钮",
        'en': "Click the \"Open Download Settings\" button in the bottom right corner"
    };

    const hideDownloadBarGuide2Strings = {
        'zh_CN': "关闭「下载完成后显示下载内容」",
        'en': "Turn off \"Show downloads when completed\""
    };

    const openDownloadSettingsButtonStrings = {
        'zh_CN': "打开下载设置",
        'en': "Open Download Settings"
    };

    const cancelButtonStrings = {
        'zh_CN': "取消",
        'en': "Cancel"
    };

    // 重置对话框部分
    const resetDialogTitleStrings = {
        'zh_CN': "恢复初始状态",
        'en': "Restore to Default State"
    };

    const resetDialogDescriptionStrings = {
        'zh_CN': "说明：",
        'en': "Instructions:"
    };

    const resetDialogInfo1Strings = {
        'zh_CN': "恢复插件到首次安装时的状态",
        'en': "Restore extension to its initial installation state"
    };

    const resetDialogInfo2Strings = {
        'zh_CN': "清除所有配置和备份记录",
        'en': "Clear all configurations and backup records"
    };

    const resetDialogInfo3Strings = {
        'zh_CN': "当前与本地的书签不受影响",
        'en': "Current and local bookmarks will not be affected"
    };

    const resetDialogInfo4Strings = {
        'zh_CN': "适用于：清除缓存、解决配置异常等情况",
        'en': "For: clearing cache, resolving configuration issues, etc."
    };

    const confirmButtonStrings = {
        'zh_CN': "确认",
        'en': "Confirm"
    };

    // 更新全局提示信息变量
    webdavConfigMissingStrings = {
        'zh_CN': "请填写完整的WebDAV配置信息",
        'en': "Please fill in all WebDAV configuration information"
    };

    webdavConfigSavedStrings = {
        'zh_CN': "WebDAV配置已保存，备份已启用",
        'en': "WebDAV configuration saved, backup enabled"
    };

    webdavBackupEnabledStrings = {
        'zh_CN': "WebDAV备份已启用",
        'en': "WebDAV backup enabled"
    };

    webdavBackupDisabledStrings = {
        'zh_CN': "WebDAV备份已禁用",
        'en': "WebDAV backup disabled"
    };

    testingWebdavConnectionStrings = {
        'zh_CN': "正在测试WebDAV连接...",
        'en': "Testing WebDAV connection..."
    };

    webdavConnectionTestSuccessStrings = {
        'zh_CN': "WebDAV连接测试成功",
        'en': "WebDAV connection test succeeded"
    };

    webdavConnectionTestFailedStrings = {
        'zh_CN': "WebDAV连接测试失败:",
        'en': "WebDAV connection test failed:"
    };

    webdavPasswordTrimmedStrings = {
        'zh_CN': "已自动去除密码首尾空格/换行",
        'en': "Trimmed leading/trailing spaces/newlines in password"
    };

    githubRepoConfigMissingStrings = {
        'zh_CN': "请填写完整的GitHub仓库配置信息",
        'en': "Please fill in all GitHub repo configuration information"
    };

    githubRepoConfigSavedStrings = {
        'zh_CN': "GitHub仓库配置已保存，备份已启用",
        'en': "GitHub repo configuration saved, backup enabled"
    };

    githubRepoBackupEnabledStrings = {
        'zh_CN': "GitHub仓库备份已启用",
        'en': "GitHub repo backup enabled"
    };

    githubRepoBackupDisabledStrings = {
        'zh_CN': "GitHub仓库备份已禁用",
        'en': "GitHub repo backup disabled"
    };

    testingGithubRepoConnectionStrings = {
        'zh_CN': "正在测试GitHub仓库连接...",
        'en': "Testing GitHub repo connection..."
    };

    githubRepoConnectionTestSuccessStrings = {
        'zh_CN': "GitHub仓库连接测试成功",
        'en': "GitHub repo connection test succeeded"
    };

    githubRepoConnectionTestFailedStrings = {
        'zh_CN': "GitHub仓库连接测试失败:",
        'en': "GitHub repo connection test failed:"
    };

    githubRepoTokenTrimmedStrings = {
        'zh_CN': "已自动去除Token首尾空格/换行",
        'en': "Trimmed leading/trailing spaces/newlines in token"
    };

    // 本地配置相关提示
    localBackupEnabledStrings = {
        'zh_CN': "本地备份已启用",
        'en': "Local backup enabled"
    };

    localBackupDisabledStrings = {
        'zh_CN': "本地备份已禁用",
        'en': "Local backup disabled"
    };

    hideDownloadBarEnabledStrings = {
        'zh_CN': "备份时将隐藏下载栏",
        'en': "Download bar will be hidden during backup"
    };

    hideDownloadBarDisabledStrings = {
        'zh_CN': "备份时不再隐藏下载栏",
        'en': "Download bar will not be hidden during backup"
    };

    downloadPathCalibratedStrings = {
        'zh_CN': "下载路径已校准",
        'en': "Download path calibrated"
    };

    downloadSettingsAddressCopiedStrings = {
        'zh_CN': "设置地址已复制到剪贴板",
        'en': "Settings address copied to clipboard"
    };

    // 自动备份相关提示
    autoBackupEnabledStrings = {
        'zh_CN': "已启用自动备份",
        'en': "Auto backup enabled"
    };

    autoBackupDisabledStrings = {
        'zh_CN': "已禁用自动备份",
        'en': "Auto backup disabled"
    };

    detectedChangesBackingUpStrings = {
        'zh_CN': "检测到修改，正在为您备份...",
        'en': "Changes detected, backing up..."
    };

    backupSwitchSuccessStrings = {
        'zh_CN': "切换备份成功！",
        'en': "Backup switch successful!"
    };

    backupSwitchFailedStrings = {
        'zh_CN': "切换备份失败: ",
        'en': "Backup switch failed: "
    };

    autoBackupToggleFailedStrings = {
        'zh_CN': "切换自动备份失败",
        'en': "Failed to toggle auto backup"
    };

    // 初始化和上传相关提示
    startInitUploadStrings = {
        'zh_CN': "开始初始化上传...",
        'en': "Starting initialization upload..."
    };

    initUploadSuccessStrings = {
        'zh_CN': "初始化上传成功！",
        'en': "Initialization upload successful!"
    };

    successToCloudAndLocalStrings = {
        'zh_CN': "成功初始化到云端和本地！",
        'en': "Successfully initialized to cloud and local!"
    };

    successToCloudStrings = {
        'zh_CN': "成功初始化到云端！",
        'en': "Successfully initialized to cloud!"
    };

    successToLocalStrings = {
        'zh_CN': "成功初始化到本地！",
        'en': "Successfully initialized to local!"
    };

    initUploadFailedStrings = {
        'zh_CN': "初始化上传失败: ",
        'en': "Initialization upload failed: "
    };

    startManualUploadStrings = {
        'zh_CN': "开始手动上传...",
        'en': "Starting manual upload..."
    };

    manualUploadSuccessStrings = {
        'zh_CN': "手动上传成功！",
        'en': "Manual upload successful!"
    };

    backupToCloudAndLocalStrings = {
        'zh_CN': "成功备份到云端和本地！",
        'en': "Successfully backed up to cloud and local!"
    };

    backupToCloudStrings = {
        'zh_CN': "成功备份到云端！",
        'en': "Successfully backed up to cloud!"
    };

    backupToLocalStrings = {
        'zh_CN': "成功备份到本地！",
        'en': "Successfully backed up to local!"
    };

    manualUploadFailedStrings = {
        'zh_CN': "手动上传失败: ",
        'en': "Manual upload failed: "
    };

    // 重置相关提示
    restoringToDefaultStrings = {
        'zh_CN': "正在恢复初始状态...",
        'en': "Restoring to default state..."
    };

    restoredToDefaultStrings = {
        'zh_CN': "已恢复到初始状态",
        'en': "Restored to default state"
    };

    restoreFailedStrings = {
        'zh_CN': "恢复失败: ",
        'en': "Restore failed: "
    };

    // 历史记录相关提示
    getSyncHistoryFailedStrings = {
        'zh_CN': "获取备份历史记录失败",
        'en': "Failed to get backup history"
    };

    noHistoryToExportStrings = {
        'zh_CN': "没有历史记录可导出",
        'en': "No history to export"
    };

    historyExportedStrings = {
        'zh_CN': "历史记录已导出",
        'en': "History exported"
    };

    exportHistoryFailedStrings = {
        'zh_CN': "导出历史记录失败",
        'en': "Failed to export history"
    };

    historyExportErrorStrings = {
        'zh_CN': "导出历史记录失败: ",
        'en': "Failed to export history: "
    };

    historyClearedStrings = {
        'zh_CN': "历史记录已清空",
        'en': "History cleared"
    };

    // 添加清空历史记录确认对话框的国际化字符串
    const clearHistoryDialogTitleStrings = {
        'zh_CN': "确认清空记录",
        'en': "Confirm Clear History"
    };

    const clearHistoryDialogDescriptionStrings = {
        'zh_CN': "确定要清空所有备份历史记录吗？（主界面 + 历史查看器都会清空）",
        'en': "Are you sure you want to clear all backup history records? (Both the main UI and History Viewer will be cleared.)"
    };

    const clearHistoryWarningStrings = {
        'zh_CN': "此操作不可撤销，清空后无法恢复这些记录。<br>不会删除你的书签本身，也不会删除已导出的备份文件。",
        'en': "This action cannot be undone.<br>Records will be permanently deleted.<br>This will NOT delete your actual bookmarks or any exported backup files."
    };

    const clearHistoryInfoStrings = {
        'zh_CN': "提示：历史记录不会自动归档/清理。<br>你可以在「备份历史」里按需导出或删除。",
        'en': "Tip: history records are not auto-archived/cleared.<br>You can export or delete them in “Backup History”."
    };

    const confirmClearButtonStrings = {
        'zh_CN': "确认清空",
        'en': "Confirm Clear"
    };

    clearHistoryFailedStrings = {
        'zh_CN': "清空历史记录失败",
        'en': "Failed to clear history"
    };

    unknownErrorStrings = {
        'zh_CN': "未知错误",
        'en': "Unknown error"
    };

    // 获取当前语言对应的文本
    const pageTitleText = pageTitleStrings[lang] || pageTitleStrings['zh_CN'];
    const webdavConfigTitleText = webdavConfigTitleStrings[lang] || webdavConfigTitleStrings['zh_CN'];
    const serverAddressLabelText = serverAddressLabelStrings[lang] || serverAddressLabelStrings['zh_CN'];
    const serverAddressPlaceholderText = serverAddressPlaceholderStrings[lang] || serverAddressPlaceholderStrings['zh_CN'];
    const usernameLabelText = usernameLabelStrings[lang] || usernameLabelStrings['zh_CN'];
    const usernamePlaceholderText = usernamePlaceholderStrings[lang] || usernamePlaceholderStrings['zh_CN'];
    const passwordLabelText = passwordLabelStrings[lang] || passwordLabelStrings['zh_CN'];
    const passwordPlaceholderText = passwordPlaceholderStrings[lang] || passwordPlaceholderStrings['zh_CN'];
    const saveConfigButtonText = saveConfigButtonStrings[lang] || saveConfigButtonStrings['zh_CN'];
    const githubRepoConfigTitleText = githubRepoConfigTitleStrings[lang] || githubRepoConfigTitleStrings['zh_CN'];
    const githubRepoNoticeText = githubRepoNoticeStrings[lang] || githubRepoNoticeStrings['zh_CN'];
    const githubRepoInfoLabelText = githubRepoInfoLabelStrings[lang] || githubRepoInfoLabelStrings['zh_CN'];
    const githubRepoOwnerLabelText = githubRepoOwnerLabelStrings[lang] || githubRepoOwnerLabelStrings['zh_CN'];
    const githubRepoOwnerPlaceholderText = githubRepoOwnerPlaceholderStrings[lang] || githubRepoOwnerPlaceholderStrings['zh_CN'];
    const githubRepoNameLabelText = githubRepoNameLabelStrings[lang] || githubRepoNameLabelStrings['zh_CN'];
    const githubRepoNamePlaceholderText = githubRepoNamePlaceholderStrings[lang] || githubRepoNamePlaceholderStrings['zh_CN'];
    const githubRepoBranchLabelText = githubRepoBranchLabelStrings[lang] || githubRepoBranchLabelStrings['zh_CN'];
    const githubRepoBranchPlaceholderText = githubRepoBranchPlaceholderStrings[lang] || githubRepoBranchPlaceholderStrings['zh_CN'];
    const githubRepoBasePathLabelText = githubRepoBasePathLabelStrings[lang] || githubRepoBasePathLabelStrings['zh_CN'];
    const githubRepoBasePathPlaceholderText = githubRepoBasePathPlaceholderStrings[lang] || githubRepoBasePathPlaceholderStrings['zh_CN'];
    const githubRepoTokenLabelText = githubRepoTokenLabelStrings[lang] || githubRepoTokenLabelStrings['zh_CN'];
    const githubRepoTokenPlaceholderText = githubRepoTokenPlaceholderStrings[lang] || githubRepoTokenPlaceholderStrings['zh_CN'];
    const saveGithubRepoConfigButtonText = saveGithubRepoConfigButtonStrings[lang] || saveGithubRepoConfigButtonStrings['zh_CN'];
    const testGithubRepoButtonText = testGithubRepoButtonStrings[lang] || testGithubRepoButtonStrings['zh_CN'];
    const openGithubTokenGuideButtonText = lang === 'en' ? 'Open Token Guide' : '打开 Token 配置说明';
    const localConfigTitleText = localConfigTitleStrings[lang] || localConfigTitleStrings['zh_CN'];
    const localBackupPathLabelText = localBackupPathLabelStrings[lang] || localBackupPathLabelStrings['zh_CN'];
    const calibrateButtonText = calibrateButtonStrings[lang] || calibrateButtonStrings['zh_CN'];
    const calibratePathFullText = calibratePathFullTextStrings[lang] || calibratePathFullTextStrings['zh_CN'];
    const hideDownloadBarLabelText = hideDownloadBarLabelStrings[lang] || hideDownloadBarLabelStrings['zh_CN'];
    const instructionsLabelText = instructionsLabelStrings[lang] || instructionsLabelStrings['zh_CN'];
    const defaultPathExamplesText = defaultPathExamplesStrings[lang] || defaultPathExamplesStrings['zh_CN'];
    const rulesNoCalibrationText = rulesNoCalibrationStrings[lang] || rulesNoCalibrationStrings['zh_CN'];
    const rulesNonInterferenceText = rulesNonInterferenceStrings[lang] || rulesNonInterferenceStrings['zh_CN'];
    const rulesChromeRestrictionText = rulesChromeRestrictionStrings[lang] || rulesChromeRestrictionStrings['zh_CN'];
    const rulesDownloadAPIText = rulesDownloadAPIStrings[lang] || rulesDownloadAPIStrings['zh_CN'];
    const initButtonsTitleText = initButtonsTitleStrings[lang] || initButtonsTitleStrings['zh_CN'];
    const resetButtonText = resetButtonStrings[lang] || resetButtonStrings['zh_CN'];
    const initUploadButtonText = initUploadButtonStrings[lang] || initUploadButtonStrings['zh_CN'];

    // 备份设置相关文本
    const backupSettingsTitleText = backupSettingsTitleStrings[lang] || backupSettingsTitleStrings['zh_CN'];
    const bookmarkBackupTitleText = bookmarkBackupTitleStrings[lang] || bookmarkBackupTitleStrings['zh_CN'];
    const bookmarkModeLabelText = bookmarkModeLabelStrings[lang] || bookmarkModeLabelStrings['zh_CN'];
    const backupModeAutoLabelText = backupModeAutoLabelStrings[lang] || backupModeAutoLabelStrings['zh_CN'];
    const backupModeManualLabelText = backupModeManualLabelStrings[lang] || backupModeManualLabelStrings['zh_CN'];
    const backupTimeLabelText = backupTimeLabelStrings[lang] || backupTimeLabelStrings['zh_CN'];
    const bookmarkOverwriteLabelText = bookmarkOverwriteLabelStrings[lang] || bookmarkOverwriteLabelStrings['zh_CN'];
    const backupModeLabelText = backupModeLabelStrings[lang] || backupModeLabelStrings['zh_CN'];
    const backupModeFullText = backupModeFullStrings[lang] || backupModeFullStrings['zh_CN'];
    const backupModeIncrementalText = backupModeIncrementalStrings[lang] || backupModeIncrementalStrings['zh_CN'];
    const incrementalSimpleText = incrementalSimpleStrings[lang] || incrementalSimpleStrings['zh_CN'];
    const incrementalDetailedText = incrementalDetailedStrings[lang] || incrementalDetailedStrings['zh_CN'];
    const overwritePolicyLabelText = overwritePolicyLabelStrings[lang] || overwritePolicyLabelStrings['zh_CN'];
    const overwriteVersionedText = overwriteVersionedStrings[lang] || overwriteVersionedStrings['zh_CN'];
    const overwriteVersionedDescText = overwriteVersionedDescStrings[lang] || overwriteVersionedDescStrings['zh_CN'];
    const overwriteOverwriteText = overwriteOverwriteStrings[lang] || overwriteOverwriteStrings['zh_CN'];
    const overwriteOverwriteDescText = overwriteOverwriteDescStrings[lang] || overwriteOverwriteDescStrings['zh_CN'];
    const currentChangesArchiveTitleText = currentChangesArchiveTitleStrings[lang] || currentChangesArchiveTitleStrings['zh_CN'];
    const currentChangesArchiveFormatLabelText = currentChangesArchiveFormatLabelStrings[lang] || currentChangesArchiveFormatLabelStrings['zh_CN'];
    const currentChangesArchiveModeLabelText = currentChangesArchiveModeLabelStrings[lang] || currentChangesArchiveModeLabelStrings['zh_CN'];
    const currentChangesArchiveModeSimpleLabelText = currentChangesArchiveModeSimpleLabelStrings[lang] || currentChangesArchiveModeSimpleLabelStrings['zh_CN'];
    const currentChangesArchiveModeDetailedLabelText = currentChangesArchiveModeDetailedLabelStrings[lang] || currentChangesArchiveModeDetailedLabelStrings['zh_CN'];
    const currentChangesArchiveModeCollectionLabelText = currentChangesArchiveModeCollectionLabelStrings[lang] || currentChangesArchiveModeCollectionLabelStrings['zh_CN'];
    const currentChangesArchiveModeHelpAriaText = currentChangesArchiveModeHelpAriaStrings[lang] || currentChangesArchiveModeHelpAriaStrings['zh_CN'];
    const currentChangesArchiveModeHelpTitleText = currentChangesArchiveModeHelpTitleStrings[lang] || currentChangesArchiveModeHelpTitleStrings['zh_CN'];
    const syncRestoreTitleText = syncRestoreTitleStrings[lang] || syncRestoreTitleStrings['zh_CN'];
    const syncRestoreComingSoonText = syncRestoreComingSoonStrings[lang] || syncRestoreComingSoonStrings['zh_CN'];
    const restoreFromCloudText = restoreFromCloudStrings[lang] || restoreFromCloudStrings['zh_CN'];
    const conflictResolutionText = conflictResolutionStrings[lang] || conflictResolutionStrings['zh_CN'];
    const initActionsTitleText = initActionsTitleStrings[lang] || initActionsTitleStrings['zh_CN'];

    // 校准路径对话框部分
    const calibratePathDialogTitleText = calibratePathDialogTitleStrings[lang] || calibratePathDialogTitleStrings['zh_CN'];
    const calibratePathInstruction1Text = calibratePathInstruction1Strings[lang] || calibratePathInstruction1Strings['zh_CN'];
    const calibratePathInstruction2Text = calibratePathInstruction2Strings[lang] || calibratePathInstruction2Strings['zh_CN'];
    const calibratePathInstruction3Text = calibratePathInstruction3Strings[lang] || calibratePathInstruction3Strings['zh_CN'];
    const pastePathLabelText = pastePathLabelStrings[lang] || pastePathLabelStrings['zh_CN'];
    const pastePathPlaceholderText = pastePathPlaceholderStrings[lang] || pastePathPlaceholderStrings['zh_CN'];
    const saveButtonText = saveButtonStrings[lang] || saveButtonStrings['zh_CN'];
    const cloudBackupGuideTitleText = cloudBackupGuideTitleStrings[lang] || cloudBackupGuideTitleStrings['zh_CN'];
    const cloudBackupGuide1Text = cloudBackupGuide1Strings[lang] || cloudBackupGuide1Strings['zh_CN'];
    const cloudBackupGuide2Text = cloudBackupGuide2Strings[lang] || cloudBackupGuide2Strings['zh_CN'];
    const cloudBackupGuide3Text = cloudBackupGuide3Strings[lang] || cloudBackupGuide3Strings['zh_CN'];
    const hideDownloadBarTitleText = hideDownloadBarTitleStrings[lang] || hideDownloadBarTitleStrings['zh_CN'];
    const hideDownloadBarGuide1Text = hideDownloadBarGuide1Strings[lang] || hideDownloadBarGuide1Strings['zh_CN'];
    const hideDownloadBarGuide2Text = hideDownloadBarGuide2Strings[lang] || hideDownloadBarGuide2Strings['zh_CN'];
    const openDownloadSettingsButtonText = openDownloadSettingsButtonStrings[lang] || openDownloadSettingsButtonStrings['zh_CN'];
    const cancelButtonText = cancelButtonStrings[lang] || cancelButtonStrings['zh_CN'];

    // 重置对话框部分
    const resetDialogTitleText = resetDialogTitleStrings[lang] || resetDialogTitleStrings['zh_CN'];
    const resetDialogDescriptionText = resetDialogDescriptionStrings[lang] || resetDialogDescriptionStrings['zh_CN'];
    const resetDialogInfo1Text = resetDialogInfo1Strings[lang] || resetDialogInfo1Strings['zh_CN'];
    const resetDialogInfo2Text = resetDialogInfo2Strings[lang] || resetDialogInfo2Strings['zh_CN'];
    const resetDialogInfo3Text = resetDialogInfo3Strings[lang] || resetDialogInfo3Strings['zh_CN'];
    const resetDialogInfo4Text = resetDialogInfo4Strings[lang] || resetDialogInfo4Strings['zh_CN'];
    const confirmButtonText = confirmButtonStrings[lang] || confirmButtonStrings['zh_CN'];

    // 更新页面标题
    document.title = pageTitleText;
    const h1Element = document.querySelector('.header-container > h1');
    if (h1Element) {
        h1Element.textContent = pageTitleText;
    }

    // 应用备份模式切换的文本
    const autoSyncStatusText = document.getElementById('autoSyncStatusText');
    if (autoSyncStatusText) {
        // autoSyncEnabledText is not defined here, assuming it should be autoSyncDescriptionStrings[lang]
        autoSyncStatusText.textContent = autoSyncDescriptionStrings[lang] || autoSyncDescriptionStrings['zh_CN'];
    }

    // 应用手动备份模式提示文本
    const manualModeTip = document.getElementById('manualModeTip');
    if (manualModeTip) {
        manualModeTip.innerHTML = manualModeTipStrings[lang] || manualModeTipStrings['zh_CN'];
    }

    // 更新主标题元素
    const pageTitleElement = document.getElementById('pageTitleElement');
    if (pageTitleElement) {
        pageTitleElement.textContent = pageTitleText;
    }

    // 更新初始备份文件标题
    const initialBackupInfoTitle = document.querySelector('#initialBackupInfo > p');
    if (initialBackupInfoTitle) {
        initialBackupInfoTitle.textContent = initialBackupFileStrings[lang] || initialBackupFileStrings['zh_CN'];
    }

    // 检查重置确认对话框是否打开，如果打开则更新其中的初始备份文件信息
    const resetConfirmDialog = document.getElementById('resetConfirmDialog');
    if (resetConfirmDialog && resetConfirmDialog.style.display === 'block') {
        // 获取初始备份记录
        chrome.storage.local.get(['initialBackupRecord', 'preferredLang'], function (data) {
            const currentLang = data.preferredLang || 'zh_CN';

            // 确保国际化字符串已经初始化
            if (!initialBackupFileStrings || !backupTypeStrings || !timeStrings ||
                !localBackupTypeStrings || !cloudBackupTypeStrings) {
                // 如果变量尚未初始化，进行初始化
                initialBackupFileStrings = {
                    'zh_CN': "您的初始备份文件：",
                    'en': "Your Initial Backup File:"
                };
                backupTypeStrings = {
                    'zh_CN': "备份类型:",
                    'en': "Backup Type:"
                };
                timeStrings = {
                    'zh_CN': "时间:",
                    'en': "Time:"
                };
                localBackupTypeStrings = {
                    'zh_CN': "本地",
                    'en': "Local"
                };
                cloudBackupTypeStrings = {
                    'zh_CN': "云端",
                    'en': "Cloud"
                };
            }

            const initialBackupInfo = document.getElementById('initialBackupInfo');
            const initialBackupFileName = document.getElementById('initialBackupFileName');

            if (initialBackupInfo && initialBackupFileName) {
                // 清除之前可能存在的内容
                initialBackupFileName.textContent = '';
                const oldTypeInfo = initialBackupFileName.nextElementSibling;
                if (oldTypeInfo) {
                    oldTypeInfo.remove();
                }

                if (data.initialBackupRecord) {
                    // 设置文件名
                    initialBackupFileName.textContent = data.initialBackupRecord.fileName || '未知文件名';

                    // 获取备份类型
                    const backupType = data.initialBackupRecord.backupType || '未知';
                    // 格式化时间
                    let timeStr = '未知时间';
                    if (data.initialBackupRecord.time) {
                        try {
                            const date = new Date(data.initialBackupRecord.time);
                            timeStr = formatTime(date);
                        } catch (e) {
                        }
                    }

                    // 添加备份类型和时间信息
                    const backupTypeInfo = document.createElement('div');
                    backupTypeInfo.style.marginTop = '5px';
                    backupTypeInfo.style.fontSize = '12px';
                    backupTypeInfo.style.color = '#666';

                    // 获取对应语言的文本
                    const backupTypeText = backupTypeStrings[currentLang] || backupTypeStrings['zh_CN'];
                    const timeText = timeStrings[currentLang] || timeStrings['zh_CN'];

                    // 将本地/云端转换为当前语言
                    let localizedBackupType = backupType;
                    if (backupType === '本地') {
                        localizedBackupType = localBackupTypeStrings[currentLang] || localBackupTypeStrings['zh_CN'];
                    } else if (backupType === '云端') {
                        localizedBackupType = cloudBackupTypeStrings[currentLang] || cloudBackupTypeStrings['zh_CN'];
                    }

                    backupTypeInfo.textContent = `${backupTypeText} ${localizedBackupType}, ${timeText} ${timeStr}`;
                    initialBackupFileName.after(backupTypeInfo);

                    // 显示备份信息区域
                    initialBackupInfo.style.display = 'block';
                } else {
                    // 没有备份记录时，隐藏信息区域
                    initialBackupInfo.style.display = 'none';
                }
            }

            // 显示重置对话框
            resetConfirmDialog.style.display = 'block';
        });
    }

    // 更新 WebDAV 配置部分
    const webdavConfigTitleElement = document.getElementById('webdavConfigTitle');
    if (webdavConfigTitleElement) {
        webdavConfigTitleElement.textContent = webdavConfigTitleText;
    }

    const serverAddressLabelElement = document.getElementById('serverAddressLabel');
    if (serverAddressLabelElement) {
        serverAddressLabelElement.textContent = serverAddressLabelText;
    }

    const serverAddressInput = document.getElementById('serverAddress');
    if (serverAddressInput) {
        serverAddressInput.placeholder = serverAddressPlaceholderText;
    }

    const usernameLabelElement = document.getElementById('usernameLabel');
    if (usernameLabelElement) {
        usernameLabelElement.textContent = usernameLabelText;
    }

    const usernameInput = document.getElementById('username');
    if (usernameInput) {
        usernameInput.placeholder = usernamePlaceholderText;
    }

    const passwordLabelElement = document.getElementById('passwordLabel');
    if (passwordLabelElement) {
        passwordLabelElement.textContent = passwordLabelText;
    }

    const passwordInput = document.getElementById('password');
    if (passwordInput) {
        passwordInput.placeholder = passwordPlaceholderText;
    }

    const saveKeyButton = document.getElementById('saveKey');
    if (saveKeyButton) {
        saveKeyButton.textContent = saveConfigButtonText;
    }

    const testWebdavBtn = document.getElementById('testWebdavBtn');
    if (testWebdavBtn) {
        testWebdavBtn.textContent = testWebdavButtonStrings[lang] || testWebdavButtonStrings['zh_CN'];
    }

    // 更新 GitHub Repository 配置部分
    const githubRepoConfigTitleElement = document.getElementById('githubRepoConfigTitle');
    if (githubRepoConfigTitleElement) {
        githubRepoConfigTitleElement.textContent = githubRepoConfigTitleText;
    }

    const githubRepoNoticeElement = document.getElementById('githubRepoNotice');
    if (githubRepoNoticeElement) {
        githubRepoNoticeElement.innerHTML = githubRepoNoticeText;
    }

    const githubRepoOwnerLabelElement = document.getElementById('githubRepoOwnerLabel');
    if (githubRepoOwnerLabelElement) {
        githubRepoOwnerLabelElement.textContent = githubRepoOwnerLabelText;
    }

    const githubRepoOwnerInput = document.getElementById('githubRepoOwner');
    if (githubRepoOwnerInput) {
        githubRepoOwnerInput.placeholder = githubRepoOwnerPlaceholderText;
    }

    const githubRepoNameLabelElement = document.getElementById('githubRepoNameLabel');
    if (githubRepoNameLabelElement) {
        githubRepoNameLabelElement.textContent = githubRepoNameLabelText;
    }

    const githubRepoNameInput = document.getElementById('githubRepoName');
    if (githubRepoNameInput) {
        githubRepoNameInput.placeholder = githubRepoNamePlaceholderText;
    }

    const githubRepoBranchLabelElement = document.getElementById('githubRepoBranchLabel');
    if (githubRepoBranchLabelElement) {
        githubRepoBranchLabelElement.textContent = githubRepoBranchLabelText;
    }

    const githubRepoBranchInput = document.getElementById('githubRepoBranch');
    if (githubRepoBranchInput) {
        githubRepoBranchInput.placeholder = githubRepoBranchPlaceholderText;
    }

    const githubRepoBasePathLabelElement = document.getElementById('githubRepoBasePathLabel');
    if (githubRepoBasePathLabelElement) {
        githubRepoBasePathLabelElement.textContent = githubRepoBasePathLabelText;
    }

    const githubRepoBasePathInput = document.getElementById('githubRepoBasePath');
    if (githubRepoBasePathInput) {
        githubRepoBasePathInput.placeholder = githubRepoBasePathPlaceholderText;
    }

    const githubRepoTokenLabelElement = document.getElementById('githubRepoTokenLabel');
    if (githubRepoTokenLabelElement) {
        githubRepoTokenLabelElement.textContent = githubRepoTokenLabelText;
    }

    const githubRepoTokenInput = document.getElementById('githubRepoToken');
    if (githubRepoTokenInput) {
        githubRepoTokenInput.placeholder = githubRepoTokenPlaceholderText;
    }

    const githubRepoInfoLabelElement = document.getElementById('githubRepoInfoLabel');
    if (githubRepoInfoLabelElement) {
        githubRepoInfoLabelElement.textContent = githubRepoInfoLabelText;
    }

    loadAndDisplayGitHubRepoConfig();

    const saveGithubRepoConfigBtn = document.getElementById('saveGithubRepoConfigBtn');
    if (saveGithubRepoConfigBtn) {
        saveGithubRepoConfigBtn.textContent = saveGithubRepoConfigButtonText;
    }

    const testGithubRepoBtn = document.getElementById('testGithubRepoBtn');
    if (testGithubRepoBtn) {
        testGithubRepoBtn.textContent = testGithubRepoButtonText;
    }

    const openGithubTokenGuideBtn = document.getElementById('openGithubTokenGuideBtn');
    if (openGithubTokenGuideBtn) {
        openGithubTokenGuideBtn.textContent = openGithubTokenGuideButtonText;
    }

    // 更新本地配置部分
    const localConfigTitleElement = document.getElementById('localConfigTitle');
    if (localConfigTitleElement) {
        localConfigTitleElement.textContent = localConfigTitleText;
    }

    const localBackupPathLabelElement = document.getElementById('localBackupPathLabel');
    if (localBackupPathLabelElement) {
        localBackupPathLabelElement.textContent = localBackupPathLabelText;
    }

    const calibrateButtonTextElement = document.getElementById('calibrateButtonText');
    if (calibrateButtonTextElement) {
        calibrateButtonTextElement.textContent = calibrateButtonText;
    }

    // 更新校准路径按钮的完整文本
    const calibratePathBtn = document.getElementById('calibratePathBtn');
    if (calibratePathBtn) {
        calibratePathBtn.innerHTML = calibratePathFullText; // 使用 innerHTML 来解析 <br>
    }

    const hideDownloadBarLabelElement = document.getElementById('hideDownloadBarLabel');
    if (hideDownloadBarLabelElement) {
        hideDownloadBarLabelElement.textContent = hideDownloadBarLabelText;
    }

    // 更新说明与规则部分
    const instructionsLabelElement = document.getElementById('instructionsLabel');
    if (instructionsLabelElement) {
        instructionsLabelElement.textContent = instructionsLabelText;
    }

    const defaultPathExamplesElement = document.getElementById('defaultPathExamples');
    if (defaultPathExamplesElement) {
        defaultPathExamplesElement.textContent = defaultPathExamplesText;
    }

    const exportRootFolder = lang === 'zh_CN' ? '书签备份' : 'Bookmark Backup';
    const exportBackupFolder = lang === 'zh_CN' ? '书签备份' : 'Bookmark Backup';

    const defaultPathMacElement = document.getElementById('defaultPathMac');
    if (defaultPathMacElement) {
        defaultPathMacElement.textContent = `/Users/<username>/Downloads/${exportRootFolder}/${exportBackupFolder}/`;
    }

    const defaultPathWindowsElement = document.getElementById('defaultPathWindows');
    if (defaultPathWindowsElement) {
        defaultPathWindowsElement.textContent = `C:\\Users\\<username>\\Downloads\\${exportRootFolder}\\${exportBackupFolder}\\`;
    }

    const defaultPathLinuxElement = document.getElementById('defaultPathLinux');
    if (defaultPathLinuxElement) {
        defaultPathLinuxElement.textContent = `/home/<username>/Downloads/${exportRootFolder}/${exportBackupFolder}/`;
    }

    const rulesNoCalibrationElement = document.getElementById('rulesNoCalibration');
    if (rulesNoCalibrationElement) {
        rulesNoCalibrationElement.textContent = rulesNoCalibrationText;
    }

    const rulesNonInterferenceElement = document.getElementById('rulesNonInterference');
    if (rulesNonInterferenceElement) {
        rulesNonInterferenceElement.textContent = rulesNonInterferenceText;
    }

    const rulesChromeRestrictionElement = document.getElementById('rulesChromeRestriction');
    if (rulesChromeRestrictionElement) {
        rulesChromeRestrictionElement.textContent = rulesChromeRestrictionText;
    }

    const rulesDownloadAPIElement = document.getElementById('rulesDownloadAPI');
    if (rulesDownloadAPIElement) {
        rulesDownloadAPIElement.textContent = rulesDownloadAPIText;
    }

    // 更新初始化按钮部分
    const initButtonsTitleElement = document.getElementById('initButtonsTitle');
    if (initButtonsTitleElement) {
        initButtonsTitleElement.textContent = initButtonsTitleText;
    }

    const resetAllButton = document.getElementById('resetAll');
    if (resetAllButton) {
        const resetAllTextSpan = document.getElementById('resetAllText');
        if (resetAllTextSpan) {
            resetAllTextSpan.textContent = resetButtonText;
        } else {
            resetAllButton.textContent = resetButtonText;
        }
    }

    const uploadToCloudButton = document.getElementById('uploadToCloud');
    if (uploadToCloudButton) {
        const uploadToCloudTextSpan = document.getElementById('uploadToCloudText');
        if (uploadToCloudTextSpan) {
            uploadToCloudTextSpan.textContent = initUploadButtonText;
        } else {
            uploadToCloudButton.textContent = initUploadButtonText;
        }
    }

    // 更新备份设置区域文本
    const backupSettingsTitleEl = document.getElementById('backupSettingsTitle');
    if (backupSettingsTitleEl) backupSettingsTitleEl.textContent = backupSettingsTitleText;

    const bookmarkBackupTitleElement = document.getElementById('bookmarkBackupTitle');
    if (bookmarkBackupTitleElement) bookmarkBackupTitleElement.textContent = bookmarkBackupTitleText;

    const bookmarkModeLabelEl = document.getElementById('bookmarkModeLabel');
    if (bookmarkModeLabelEl) bookmarkModeLabelEl.textContent = bookmarkModeLabelText;

    const backupModeAutoLabelEl = document.getElementById('backupModeAutoLabel');
    if (backupModeAutoLabelEl) backupModeAutoLabelEl.textContent = backupModeAutoLabelText;

    const backupModeManualLabelEl = document.getElementById('backupModeManualLabel');
    if (backupModeManualLabelEl) backupModeManualLabelEl.textContent = backupModeManualLabelText;

    const backupTimeLabelEl = document.getElementById('backupTimeLabel');
    if (backupTimeLabelEl) backupTimeLabelEl.textContent = backupTimeLabelText;

    const bookmarkOverwriteLabelEl = document.getElementById('bookmarkOverwriteLabel');
    if (bookmarkOverwriteLabelEl) bookmarkOverwriteLabelEl.textContent = bookmarkOverwriteLabelText;

    const overwriteVersionedLabelEl = document.getElementById('overwriteVersionedLabel');
    if (overwriteVersionedLabelEl) overwriteVersionedLabelEl.textContent = overwriteVersionedText;

    const overwriteOverwriteLabelEl = document.getElementById('overwriteOverwriteLabel');
    if (overwriteOverwriteLabelEl) overwriteOverwriteLabelEl.textContent = overwriteOverwriteText;

    // 更新当前变化自动归档设置区域文本
    const currentChangesArchiveTitleEl = document.getElementById('currentChangesArchiveTitle');
    if (currentChangesArchiveTitleEl) currentChangesArchiveTitleEl.textContent = currentChangesArchiveTitleText;

    const currentChangesArchiveFormatLabelEl = document.getElementById('currentChangesArchiveFormatLabel');
    if (currentChangesArchiveFormatLabelEl) currentChangesArchiveFormatLabelEl.textContent = currentChangesArchiveFormatLabelText;

    const currentChangesArchiveModeLabelEl = document.getElementById('currentChangesArchiveModeLabel');
    if (currentChangesArchiveModeLabelEl) currentChangesArchiveModeLabelEl.textContent = currentChangesArchiveModeLabelText;

    const currentChangesArchiveModeSimpleLabelEl = document.getElementById('currentChangesArchiveModeSimpleLabel');
    if (currentChangesArchiveModeSimpleLabelEl) currentChangesArchiveModeSimpleLabelEl.textContent = currentChangesArchiveModeSimpleLabelText;

    const currentChangesArchiveModeDetailedLabelEl = document.getElementById('currentChangesArchiveModeDetailedLabel');
    if (currentChangesArchiveModeDetailedLabelEl) currentChangesArchiveModeDetailedLabelEl.textContent = currentChangesArchiveModeDetailedLabelText;

    const currentChangesArchiveModeCollectionLabelEl = document.getElementById('currentChangesArchiveModeCollectionLabel');
    if (currentChangesArchiveModeCollectionLabelEl) currentChangesArchiveModeCollectionLabelEl.textContent = currentChangesArchiveModeCollectionLabelText;

    const currentChangesArchiveModeHelpBtn = document.getElementById('currentChangesArchiveModeHelpBtn');
    if (currentChangesArchiveModeHelpBtn) {
        currentChangesArchiveModeHelpBtn.setAttribute('aria-label', currentChangesArchiveModeHelpAriaText);
        currentChangesArchiveModeHelpBtn.setAttribute('title', currentChangesArchiveModeHelpTitleText);
    }

    const currentChangesArchiveSavedTextEl = document.getElementById('currentChangesArchiveSavedText');
    if (currentChangesArchiveSavedTextEl) currentChangesArchiveSavedTextEl.textContent = settingsSavedStrings[lang] || settingsSavedStrings['zh_CN'];

    const backupSettingsSavedTextEl = document.getElementById('backupSettingsSavedText');
    if (backupSettingsSavedTextEl) backupSettingsSavedTextEl.textContent = settingsSavedStrings[lang] || settingsSavedStrings['zh_CN'];

    // 更新同步与恢复区域文本
    const syncRestoreTitleEl = document.getElementById('syncRestoreTitle');
    if (syncRestoreTitleEl) syncRestoreTitleEl.textContent = syncRestoreTitleText;

    const syncRestoreComingSoonEl = document.getElementById('syncRestoreComingSoon');
    if (syncRestoreComingSoonEl) syncRestoreComingSoonEl.textContent = syncRestoreComingSoonText;

    // Local restore hint: tell user which folder to pick
    const restoreLocalFolderHintEl = document.getElementById('restoreLocalFolderHint');
    if (restoreLocalFolderHintEl) {
        restoreLocalFolderHintEl.textContent = (lang === 'en')
            ? '(Select parent folder: Bookmark Backup)'
            : '（请选择父文件夹：书签备份）';
    }

    const restoreFromCloudLabelEl = document.getElementById('restoreFromCloudLabel');
    if (restoreFromCloudLabelEl) restoreFromCloudLabelEl.textContent = restoreFromCloudText;

    const conflictResolutionLabelEl = document.getElementById('conflictResolutionLabel');
    if (conflictResolutionLabelEl) conflictResolutionLabelEl.textContent = conflictResolutionText;

    // 更新初始化操作区域文本
    const initActionsTitleEl = document.getElementById('initActionsTitle');
    if (initActionsTitleEl) initActionsTitleEl.textContent = initActionsTitleText;

    // 更新重置对话框文本
    const resetDialogTitleElement = document.getElementById('resetDialogTitle');
    if (resetDialogTitleElement) {
        resetDialogTitleElement.textContent = resetDialogTitleText;
    }

    const resetDialogDescriptionElement = document.getElementById('resetDialogDescription');
    if (resetDialogDescriptionElement) {
        resetDialogDescriptionElement.textContent = resetDialogDescriptionText;
    }

    const resetDialogInfo1Element = document.getElementById('resetDialogInfo1');
    if (resetDialogInfo1Element) {
        resetDialogInfo1Element.textContent = resetDialogInfo1Text;
    }

    const resetDialogInfo2Element = document.getElementById('resetDialogInfo2');
    if (resetDialogInfo2Element) {
        resetDialogInfo2Element.textContent = resetDialogInfo2Text;
    }

    const resetDialogInfo3Element = document.getElementById('resetDialogInfo3');
    if (resetDialogInfo3Element) {
        resetDialogInfo3Element.textContent = resetDialogInfo3Text;
    }

    const resetDialogInfo4Element = document.getElementById('resetDialogInfo4');
    if (resetDialogInfo4Element) {
        resetDialogInfo4Element.textContent = resetDialogInfo4Text;
    }

    const confirmResetButton = document.getElementById('confirmReset');
    if (confirmResetButton) {
        confirmResetButton.textContent = confirmButtonText;
    }

    const cancelResetButton = document.getElementById('cancelReset');
    if (cancelResetButton) {
        cancelResetButton.textContent = cancelButtonText;
    }

    // 更新清空历史记录确认对话框文本
    const clearHistoryDialogTitleText = clearHistoryDialogTitleStrings[lang] || clearHistoryDialogTitleStrings['zh_CN'];
    const clearHistoryDialogDescriptionText = clearHistoryDialogDescriptionStrings[lang] || clearHistoryDialogDescriptionStrings['zh_CN'];
    const clearHistoryWarningText = clearHistoryWarningStrings[lang] || clearHistoryWarningStrings['zh_CN'];
    const clearHistoryInfoText = clearHistoryInfoStrings[lang] || clearHistoryInfoStrings['zh_CN'];
    const confirmClearButtonText = confirmClearButtonStrings[lang] || confirmClearButtonStrings['zh_CN'];

    const clearHistoryDialogTitleElement = document.getElementById('clearHistoryDialogTitle');
    if (clearHistoryDialogTitleElement) {
        clearHistoryDialogTitleElement.textContent = clearHistoryDialogTitleText;
    }

    const clearHistoryDialogDescriptionElement = document.getElementById('clearHistoryDialogDescription');
    if (clearHistoryDialogDescriptionElement) {
        clearHistoryDialogDescriptionElement.textContent = clearHistoryDialogDescriptionText;
    }

    const clearHistoryWarningElement = document.getElementById('clearHistoryWarning');
    if (clearHistoryWarningElement) {
        clearHistoryWarningElement.innerHTML = clearHistoryWarningText;
    }

    const confirmClearHistoryButton = document.getElementById('confirmClearHistory');
    if (confirmClearHistoryButton) {
        confirmClearHistoryButton.textContent = confirmClearButtonText;
    }

    const cancelClearHistoryButton = document.getElementById('cancelClearHistory');
    if (cancelClearHistoryButton) {
        cancelClearHistoryButton.textContent = cancelButtonText;
    }

    // 更新蓝色信息区块文本
    const clearHistoryInfoTextElement = document.getElementById('clearHistoryInfoText');
    if (clearHistoryInfoTextElement) {
        clearHistoryInfoTextElement.innerHTML = clearHistoryInfoText;
    }

    // 应用UI文本到DOM元素
    // 备份状态部分
    const allStatsLabels = document.querySelectorAll('.stats-label');

    if (allStatsLabels.length > 0) {
        const lastChangeElement = allStatsLabels[0];
        lastChangeElement.textContent = lastChangeLabel[lang] || lastChangeLabel['zh_CN'];
    }

    if (allStatsLabels.length > 1) {
        const currentQuantityElement = allStatsLabels[1];
        currentQuantityElement.textContent = currentQuantityLabel[lang] || currentQuantityLabel['zh_CN'];
    }

    // 应用新增UI文字的翻译
    const autoSyncLabel = document.querySelector('.auto-sync-control .setting-label > span:first-child');
    if (autoSyncLabel) {
        autoSyncLabel.textContent = autoSyncDescriptionStrings[lang] || autoSyncDescriptionStrings['zh_CN'];
    }

    // 应用自动备份提示文本
    const autoSyncTip = document.querySelector('.mode-tip.auto-tip');
    if (autoSyncTip) {
        autoSyncTip.innerHTML = autoSyncTipStrings[lang] || autoSyncTipStrings['zh_CN'];
    }

    // 应用手动备份按钮文本
    const manualBackupButtonText = manualBackupButtonStrings[lang] || manualBackupButtonStrings['zh_CN'];

    const uploadToCloudManual = document.getElementById('uploadToCloudManual');
    if (uploadToCloudManual) {
        uploadToCloudManual.textContent = manualBackupButtonText;
    }

    const manualBackupBtnText = document.getElementById('manualBackupBtnText');
    if (manualBackupBtnText) {
        manualBackupBtnText.textContent = manualBackupButtonText;
    }

    const manualBackupBtnOverlay = document.getElementById('manualBackupBtnOverlay');
    if (manualBackupBtnOverlay) {
        manualBackupBtnOverlay.setAttribute('title', manualBackupButtonText);
        manualBackupBtnOverlay.setAttribute('aria-label', manualBackupButtonText);
    }

    // 应用动态提醒设置按钮文本
    // 设置提醒设置按钮的 tooltip 文本
    const reminderSettingsTooltip = document.getElementById('reminderSettingsTooltip');
    if (reminderSettingsTooltip) {
        reminderSettingsTooltip.textContent = reminderSettingsStrings[lang] || reminderSettingsStrings['zh_CN'];
    }
    const reminderSettingsBtnRef = document.getElementById('reminderSettingsBtn');
    if (reminderSettingsBtnRef) {
        const tipTextRem = reminderSettingsStrings[lang] || reminderSettingsStrings['zh_CN'];
        reminderSettingsBtnRef.setAttribute('title', tipTextRem);
        reminderSettingsBtnRef.setAttribute('aria-label', tipTextRem);
        const showRemTip = () => { if (reminderSettingsTooltip) { reminderSettingsTooltip.style.visibility = 'visible'; reminderSettingsTooltip.style.opacity = '1'; } };
        const hideRemTip = () => { if (reminderSettingsTooltip) { reminderSettingsTooltip.style.visibility = 'hidden'; reminderSettingsTooltip.style.opacity = '0'; } };
        reminderSettingsBtnRef.addEventListener('mouseenter', showRemTip);
        reminderSettingsBtnRef.addEventListener('mouseleave', hideRemTip);
        // 不在容器级别触发，避免在手动备份按钮上悬停时显示 tooltip
    }

    // 调整提醒设置对话框内的“保存”按钮为文本（中/英）
    const saveReminderSettingsBtnInMain = document.getElementById('saveReminderSettings');
    if (saveReminderSettingsBtnInMain) {
        saveReminderSettingsBtnInMain.textContent = (typeof saveButtonStrings !== 'undefined')
            ? (saveButtonStrings[lang] || saveButtonStrings['zh_CN'])
            : (lang === 'en' ? 'Save' : '保存');
        saveReminderSettingsBtnInMain.setAttribute('aria-label', saveReminderSettingsBtnInMain.textContent);
        saveReminderSettingsBtnInMain.setAttribute('title', saveReminderSettingsBtnInMain.textContent);
    }

    const historyTitle = document.querySelector('.sync-history h3');
    if (historyTitle) {
        historyTitle.textContent = historyRecordsDescriptionStrings[lang] || historyRecordsDescriptionStrings['zh_CN'];
    }

    const clearHistoryTooltip = document.querySelector('#clearHistoryBtn .tooltip');
    if (clearHistoryTooltip) {
        clearHistoryTooltip.textContent = clearHistoryStrings[lang] || clearHistoryStrings['zh_CN'];
    }

    const exportHistoryTooltip = document.querySelector('#exportHistoryBtn .tooltip');
    if (exportHistoryTooltip) {
        exportHistoryTooltip.textContent = exportHistoryStrings[lang] || exportHistoryStrings['zh_CN'];
    }

    const historyHeaders = document.querySelectorAll('.history-header .header-item');
    if (historyHeaders.length >= 3) {
        historyHeaders[0].textContent = timeColumnStrings[lang] || timeColumnStrings['zh_CN'];
        historyHeaders[1].textContent = quantityColumnStrings[lang] || quantityColumnStrings['zh_CN'];
        historyHeaders[2].textContent = statusColumnStrings[lang] || statusColumnStrings['zh_CN'];
    }

    // 添加新的国际化字符串
    const settingsRestoredStrings = {
        'zh_CN': "已恢复默认设置",
        'en': "Default settings restored"
    };

    const saveFailedStrings = {
        'zh_CN': "保存设置失败",
        'en': "Failed to save settings"
    };

    // 更新返回顶部按钮文本
    const scrollToTopText = document.getElementById('scrollToTopText');
    if (scrollToTopText) {
        scrollToTopText.textContent = scrollToTopStrings[lang] || scrollToTopStrings['zh_CN'];
    }

    // 更新历史查看器按钮文本
    const openHistoryViewerText = document.getElementById('openHistoryViewerText');
    if (openHistoryViewerText) {
        openHistoryViewerText.textContent = openHistoryViewerStrings[lang] || openHistoryViewerStrings['zh_CN'];
    }

    // 保存国际化标签到全局变量，供其他函数使用
    window.i18nLabels = {
        bookmarksLabel: bookmarksLabel[lang] || bookmarksLabel['zh_CN'],
        foldersLabel: foldersLabel[lang] || foldersLabel['zh_CN'],
        bookmarkChangedLabel: bookmarkChangedLabel[lang] || bookmarkChangedLabel['zh_CN'], // Will pick up "Bookmark changed" for en
        folderChangedLabel: folderChangedLabel[lang] || folderChangedLabel['zh_CN'],   // Will pick up "Folder changed" for en
        bookmarkAndFolderChangedLabel: bookmarkAndFolderChangedLabel[lang] || bookmarkAndFolderChangedLabel['zh_CN'], // Add new label
        currentQuantityLabel: currentQuantityLabel[lang] || currentQuantityLabel['zh_CN'],
        lastChangeLabel: lastChangeLabel[lang] || lastChangeLabel['zh_CN'],
        settingsSavedStrings: settingsSavedStrings[lang] || settingsSavedStrings['zh_CN'],
        settingsRestoredStrings: settingsRestoredStrings[lang] || settingsRestoredStrings['zh_CN'],
        saveFailedStrings: saveFailedStrings[lang] || saveFailedStrings['zh_CN'],
        // 添加导出历史记录相关的国际化标签
        exportingHistory: exportingHistoryStrings[lang] || exportingHistoryStrings['zh_CN'],
        exportingToWebDAV: exportingToWebDAVStrings[lang] || exportingToWebDAVStrings['zh_CN'],
        exportingToGithubRepo: exportingToGithubRepoStrings[lang] || exportingToGithubRepoStrings['zh_CN'],
        exportingToLocal: exportingToLocalStrings[lang] || exportingToLocalStrings['zh_CN'],
        exportedToWebDAV: exportedToWebDAVStrings[lang] || exportedToWebDAVStrings['zh_CN'],
        exportedToGithubRepo: exportedToGithubRepoStrings[lang] || exportedToGithubRepoStrings['zh_CN'],
        exportedToLocal: exportedToLocalStrings[lang] || exportedToLocalStrings['zh_CN'],
        exportedToBoth: exportedToBothStrings[lang] || exportedToBothStrings['zh_CN'],
        exportToWebDAVFailed: exportToWebDAVFailedStrings[lang] || exportToWebDAVFailedStrings['zh_CN'],
        exportToGithubRepoFailed: exportToGithubRepoFailedStrings[lang] || exportToGithubRepoFailedStrings['zh_CN'],
        exportToLocalFailed: exportToLocalFailedStrings[lang] || exportToLocalFailedStrings['zh_CN'],
        historyExportedSuccess: exportedToBothStrings[lang] || exportedToBothStrings['zh_CN']
    };

    // 更新弹窗提示的国际化文本
    if (typeof webdavConfigMissingStrings !== 'undefined') {
        webdavConfigMissingStrings = {
            'zh_CN': "请填写完整的WebDAV配置信息",
            'en': "Please fill in all WebDAV configuration information"
        };
    }

    // 定义开源信息对话框相关的国际化字符串
    openSourceInfoTitleStrings = {
        'zh_CN': "开源信息",
        'en': "Open Source Info"
    };

    openSourceAuthorInfoStrings = {
        'zh_CN': "作者: kwenxu",
        'en': "Author: kwenxu"
    };

    openSourceDescriptionStrings = {
        'zh_CN': "",
        'en': ""
    };

    openSourceGithubLabelStrings = {
        'zh_CN': "GitHub 仓库:",
        'en': "GitHub Repository:"
    };

    openSourceIssueLabelStrings = {
        'zh_CN': "问题反馈:",
        'en': "Issue Feedback:"
    };

    openSourceIssueTextStrings = {
        'zh_CN': "提交问题",
        'en': "Submit Issue"
    };

    openSourceCloseBtnStrings = {
        'zh_CN': "关闭",
        'en': "Close"
    };

    // 更新开源信息对话框中的文本
    const openSourceInfoTitle = document.getElementById('openSourceInfoTitle');
    if (openSourceInfoTitle) {
        openSourceInfoTitle.textContent = openSourceInfoTitleStrings[lang] || openSourceInfoTitleStrings['zh_CN'];
    }

    const openSourceAuthorInfo = document.getElementById('openSourceAuthorInfo');
    if (openSourceAuthorInfo) {
        openSourceAuthorInfo.textContent = openSourceAuthorInfoStrings[lang] || openSourceAuthorInfoStrings['zh_CN'];
    }

    const openSourceDescription = document.getElementById('openSourceDescription');
    if (openSourceDescription) {
        openSourceDescription.textContent = openSourceDescriptionStrings[lang] || openSourceDescriptionStrings['zh_CN'];
    }

    const openSourceGithubLabel = document.getElementById('openSourceGithubLabel');
    if (openSourceGithubLabel) {
        openSourceGithubLabel.textContent = openSourceGithubLabelStrings[lang] || openSourceGithubLabelStrings['zh_CN'];
    }

    const openSourceIssueLabel = document.getElementById('openSourceIssueLabel');
    if (openSourceIssueLabel) {
        openSourceIssueLabel.textContent = openSourceIssueLabelStrings[lang] || openSourceIssueLabelStrings['zh_CN'];
    }

    const openSourceIssueText = document.getElementById('openSourceIssueText');
    if (openSourceIssueText) {
        openSourceIssueText.textContent = openSourceIssueTextStrings[lang] || openSourceIssueTextStrings['zh_CN'];
    }

    const openSourceCloseBtn = document.getElementById('openSourceCloseBtn');
    if (openSourceCloseBtn) {
        openSourceCloseBtn.textContent = openSourceCloseBtnStrings[lang] || openSourceCloseBtnStrings['zh_CN'];
    }

    const openSourceTooltip = document.getElementById('openSourceTooltip');
    if (openSourceTooltip) {
        openSourceTooltip.textContent = openSourceInfoTitleStrings[lang] || openSourceInfoTitleStrings['zh_CN'];
    }

    // 在所有静态文本应用完毕后，调用此函数来刷新依赖国际化标签的动态内容
    updateLastSyncInfo(lang); // Pass lang here

    // 应用备份模式开关文本（仅更新标签，不替换整个容器，避免删除按钮）
    const autoOptionLabelEl = document.getElementById('autoOptionLabel');
    if (autoOptionLabelEl) {
        autoOptionLabelEl.textContent = autoSyncDescriptionStrings[lang] || autoSyncDescriptionStrings['zh_CN'];
    }

    const manualOptionLabelEl = document.getElementById('manualOptionLabel');
    if (manualOptionLabelEl) {
        manualOptionLabelEl.textContent = manualModeDescriptionStrings[lang] || manualModeDescriptionStrings['zh_CN'];
    }

    // 应用自动备份设置按钮文本
    // 设置自动备份设置按钮的 tooltip 文本
    const autoBackupTooltipEl = document.getElementById('autoBackupTooltip');
    if (autoBackupTooltipEl) {
        autoBackupTooltipEl.textContent = autoBackupSettingsStrings[lang] || autoBackupSettingsStrings['zh_CN'];
    }
    const autoBackupSettingsBtn = document.getElementById('autoBackupSettingsBtn');
    if (autoBackupSettingsBtn) {
        const tipText = autoBackupSettingsStrings[lang] || autoBackupSettingsStrings['zh_CN'];
        autoBackupSettingsBtn.setAttribute('title', tipText);
        autoBackupSettingsBtn.setAttribute('aria-label', tipText);
        const showAutoTip = () => { if (autoBackupTooltipEl) { autoBackupTooltipEl.style.visibility = 'visible'; autoBackupTooltipEl.style.opacity = '1'; } };
        const hideAutoTip = () => { if (autoBackupTooltipEl) { autoBackupTooltipEl.style.visibility = 'hidden'; autoBackupTooltipEl.style.opacity = '0'; } };
        autoBackupSettingsBtn.addEventListener('mouseenter', showAutoTip);
        autoBackupSettingsBtn.addEventListener('mouseleave', hideAutoTip);
        // 不再在容器级别触发，避免非齿轮按钮也显示tooltip
    }

    const autoBackupSettingsBtnNew = document.getElementById('autoBackupSettingsBtnNew');
    if (autoBackupSettingsBtnNew) {
        const tipText = autoBackupSettingsStrings[lang] || autoBackupSettingsStrings['zh_CN'];
        autoBackupSettingsBtnNew.setAttribute('title', tipText);
        autoBackupSettingsBtnNew.setAttribute('aria-label', tipText);
    }

    const reminderSettingsBtnNew = document.getElementById('reminderSettingsBtnNew');
    if (reminderSettingsBtnNew) {
        const tipText = reminderSettingsStrings[lang] || reminderSettingsStrings['zh_CN'];
        reminderSettingsBtnNew.setAttribute('title', tipText);
        reminderSettingsBtnNew.setAttribute('aria-label', tipText);
    }

    // 初始化右侧状态文本（如果存在静态占位符）
    const statusCardTextEl = document.getElementById('statusCardText');
    if (statusCardTextEl) {
        statusCardTextEl.textContent = autoSyncDescriptionStrings[lang] || autoSyncDescriptionStrings['zh_CN'];
    }

    // 国际化提醒设置对话框文本
    // 获取提醒设置对话框中的各元素
    const reminderSettingsDialogTitle = document.querySelector('#reminderSettingsDialog h3');
    if (reminderSettingsDialogTitle) {
        reminderSettingsDialogTitle.textContent = reminderSettingsStrings[lang] || reminderSettingsStrings['zh_CN'];
    }

    const cyclicReminderText = document.querySelector('.cyclic-reminder-text');
    if (cyclicReminderText) {
        cyclicReminderText.textContent = cyclicReminderStrings[lang] || cyclicReminderStrings['zh_CN'];
    }

    const minutesUnit = document.querySelector('#reminderSettingsDialog .unit');
    if (minutesUnit) {
        minutesUnit.textContent = minutesUnitStrings[lang] || minutesUnitStrings['zh_CN'];
    }

    // 修复准点定时标签文本
    const fixedTimeLabels = document.querySelectorAll('#reminderSettingsDialog .setting-label-text');
    if (fixedTimeLabels.length > 1) {
        const fixedTime1Text = fixedTimeLabels[1].querySelector('span');
        if (fixedTime1Text) {
            fixedTime1Text.textContent = fixedTime1Strings[lang] || fixedTime1Strings['zh_CN'];
        }

        // 修复冒号显示
        const fixedTime1Label = fixedTimeLabels[1];
        if (fixedTime1Label && fixedTime1Label.textContent.includes('：')) {
            fixedTime1Label.textContent = fixedTime1Label.textContent.replace('：', lang === 'en' ? ': ' : '：');
        }
    }

    if (fixedTimeLabels.length > 2) {
        const fixedTime2Text = fixedTimeLabels[2].querySelector('span');
        if (fixedTime2Text) {
            fixedTime2Text.textContent = fixedTime2Strings[lang] || fixedTime2Strings['zh_CN'];
        }

        // 修复冒号显示
        const fixedTime2Label = fixedTimeLabels[2];
        if (fixedTime2Label && fixedTime2Label.textContent.includes('：')) {
            fixedTime2Label.textContent = fixedTime2Label.textContent.replace('：', lang === 'en' ? ': ' : '：');
        }
    }

    // 修复提醒说明文本
    const manualBackupReminderDescElement = document.getElementById('manualBackupReminderDesc');
    if (manualBackupReminderDescElement) {
        manualBackupReminderDescElement.innerHTML = manualBackupReminderDescStrings[lang] || manualBackupReminderDescStrings['zh_CN'];
    }

    // 直接使用innerHTML设置示例文本
    const reminderExampleElement = document.getElementById('reminderExample');
    if (reminderExampleElement) {
        reminderExampleElement.innerHTML = reminderExampleStrings[lang] || reminderExampleStrings['zh_CN'];
    }

    // 备用方法：如果找不到ID元素
    if (!manualBackupReminderDescElement || !reminderExampleElement) {
        const reminderDescriptionElements = document.querySelectorAll('#reminderSettingsDialog .setting-block:last-of-type div');
        if (reminderDescriptionElements.length > 0 && !manualBackupReminderDescElement) {
            reminderDescriptionElements[0].innerHTML = manualBackupReminderDescStrings[lang] || manualBackupReminderDescStrings['zh_CN'];
        }
        if (reminderDescriptionElements.length > 1 && !reminderExampleElement) {
            reminderDescriptionElements[1].innerHTML = reminderExampleStrings[lang] || reminderExampleStrings['zh_CN'];
        }
    }

    // 底部按钮
    const restoreDefaultBtn = document.getElementById('restoreDefaultSettings');
    if (restoreDefaultBtn) {
        restoreDefaultBtn.textContent = restoreDefaultStrings[lang] || restoreDefaultStrings['zh_CN'];
    }

    const saveReminderSettingsBtn = document.getElementById('saveReminderSettings');
    if (saveReminderSettingsBtn) {
        saveReminderSettingsBtn.textContent = (typeof saveButtonStrings !== 'undefined')
            ? (saveButtonStrings[lang] || saveButtonStrings['zh_CN'])
            : (lang === 'en' ? 'Save' : '保存');
        saveReminderSettingsBtn.setAttribute('aria-label', saveReminderSettingsBtn.textContent);
        saveReminderSettingsBtn.setAttribute('title', saveReminderSettingsBtn.textContent);
    }

    // 保存提示文本
    const settingsSavedIndicator = document.getElementById('settingsSavedIndicator');
    if (settingsSavedIndicator) {
        settingsSavedIndicator.textContent = settingsSavedStrings[lang] || settingsSavedStrings['zh_CN'];
    }

    // ... 准点定时标签的处理 ...
    // 确保把所有的 .setting-label-text 都选择出来
    const allSettingLabelTexts = document.querySelectorAll('#reminderSettingsDialog .setting-label-text');

    // 遍历所有设置标签文本，特别处理第2个和第3个（准点定时1和准点定时2）
    for (let i = 0; i < allSettingLabelTexts.length; i++) {
        // 第1个是"循环提醒"，已在其他地方处理
        // 第2个是"准点定时1"
        if (i === 1) {
            // 直接替换整个文本内容
            const labelText = fixedTime1Strings[lang] || fixedTime1Strings['zh_CN'];
            const separator = lang === 'en' ? ': ' : '：';
            allSettingLabelTexts[i].innerHTML = `<span>${labelText}</span>${separator}`;
        }
        // 第3个是"准点定时2"
        else if (i === 2) {
            // 直接替换整个文本内容
            const labelText = fixedTime2Strings[lang] || fixedTime2Strings['zh_CN'];
            const separator = lang === 'en' ? ': ' : '：';
            allSettingLabelTexts[i].innerHTML = `<span>${labelText}</span>${separator}`;
        }
    }

    // 获取提醒说明文本的容器，直接替换内容
    const reminderDescContainer = document.querySelector('#reminderSettingsDialog .setting-block:last-of-type');
    if (reminderDescContainer) {
        const descDivs = reminderDescContainer.querySelectorAll('div');
        if (descDivs.length > 0 && !manualBackupReminderDescElement) {
            // 第一行说明文本
            descDivs[0].textContent = manualBackupReminderDescStrings[lang] || manualBackupReminderDescStrings['zh_CN'];
        }
        if (descDivs.length > 1 && !reminderExampleElement) {
            // 第二行示例文本
            descDivs[1].textContent = reminderExampleStrings[lang] || reminderExampleStrings['zh_CN'];
        }
    }

    // New strings for reminder setting labels with colons
    const cyclicReminderLabelStrings = {
        'zh_CN': "循环提醒：",
        'en': "Cyclic Reminder:"
    };
    const fixedTime1LabelStrings = {
        'zh_CN': "准点定时1：",
        'en': "Fixed Time 1:"
    };
    const fixedTime2LabelStrings = {
        'zh_CN': "准点定时2：",
        'en': "Fixed Time 2:"
    };

    // Update reminder settings dialog labels
    const cyclicReminderLabelEl = document.getElementById('cyclicReminderLabel');
    if (cyclicReminderLabelEl) {
        const settingLabelDiv = cyclicReminderLabelEl.parentElement;
        if (lang === 'zh_CN') {
            // Separate text and colon to move only the text part
            cyclicReminderLabelEl.innerHTML = `<span class="reminder-text-part" style="position: relative; left: -4.5px;">循环提醒</span><span class="reminder-colon-part">：</span>`;

            cyclicReminderLabelEl.style.textAlign = 'right';
            cyclicReminderLabelEl.style.width = '140px';
            cyclicReminderLabelEl.style.marginRight = '35px'; // Increased from 15px to 35px
            if (settingLabelDiv) {
                settingLabelDiv.style.justifyContent = 'flex-start';
                settingLabelDiv.style.marginLeft = '-50px'; // This is the overall left shift for the block
            }
        } else { // English or other languages
            cyclicReminderLabelEl.textContent = cyclicReminderLabelStrings[lang]; // Set text content normally
            cyclicReminderLabelEl.style.textAlign = 'right';
            cyclicReminderLabelEl.style.width = '140px';
            cyclicReminderLabelEl.style.marginRight = '35px'; // Increased from 15px to 35px
            if (settingLabelDiv) {
                settingLabelDiv.style.justifyContent = 'flex-start';
                settingLabelDiv.style.marginLeft = '0px'; // Reset margin for English
            }
        }
    }

    const fixedTime1LabelEl = document.getElementById('fixedTime1Label');
    if (fixedTime1LabelEl) {
        fixedTime1LabelEl.textContent = fixedTime1LabelStrings[lang];
        const settingLabelDiv = fixedTime1LabelEl.parentElement;
        if (lang === 'zh_CN') {
            fixedTime1LabelEl.style.textAlign = 'right';
            fixedTime1LabelEl.style.width = '140px';
            fixedTime1LabelEl.style.marginRight = '35px'; // Increased from 15px to 35px
            if (settingLabelDiv) {
                settingLabelDiv.style.justifyContent = 'flex-start';
                settingLabelDiv.style.marginLeft = '-50px';
            }
        } else {
            fixedTime1LabelEl.style.textAlign = 'right';
            fixedTime1LabelEl.style.width = '140px';
            fixedTime1LabelEl.style.marginRight = '35px';
            if (settingLabelDiv) {
                settingLabelDiv.style.justifyContent = 'flex-start';
                settingLabelDiv.style.marginLeft = '0px';
            }
        }
    }

    const fixedTime2LabelEl = document.getElementById('fixedTime2Label');
    if (fixedTime2LabelEl) {
        fixedTime2LabelEl.textContent = fixedTime2LabelStrings[lang];
        const settingLabelDiv = fixedTime2LabelEl.parentElement;
        if (lang === 'zh_CN') {
            fixedTime2LabelEl.style.textAlign = 'right';
            fixedTime2LabelEl.style.width = '140px';
            fixedTime2LabelEl.style.marginRight = '35px'; // Increased from 15px to 35px
            if (settingLabelDiv) {
                settingLabelDiv.style.justifyContent = 'flex-start';
                settingLabelDiv.style.marginLeft = '-50px';
            }
        } else {
            fixedTime2LabelEl.style.textAlign = 'right';
            fixedTime2LabelEl.style.width = '140px';
            fixedTime2LabelEl.style.marginRight = '35px';
            if (settingLabelDiv) {
                settingLabelDiv.style.justifyContent = 'flex-start';
                settingLabelDiv.style.marginLeft = '0px';
            }
        }
    }

    // 更新校准路径对话框的内容（如果正在显示）
    const calibratePathOverlay = document.querySelector('div[style*="position: fixed"][style*="z-index: 1000"]');
    if (calibratePathOverlay) {
        // 获取对话框中的所有文本元素
        const dialogTitle = calibratePathOverlay.querySelector('h4');
        const instructionList = calibratePathOverlay.querySelector('ol');
        const inputLabel = calibratePathOverlay.querySelector('label');
        const inputElement = calibratePathOverlay.querySelector('input');
        const saveBtn = calibratePathOverlay.querySelectorAll('button')[0];
        const cloudBackupTitle = calibratePathOverlay.querySelectorAll('h4')[1];
        const cloudBackupGuide = calibratePathOverlay.querySelector('ul');
        const hideDownloadBarTitle = calibratePathOverlay.querySelectorAll('h4')[2];
        const hideDownloadBarGuide = calibratePathOverlay.querySelectorAll('ol')[1];
        const openSettingsBtn = calibratePathOverlay.querySelectorAll('button')[1];
        const cancelBtn = calibratePathOverlay.querySelectorAll('button')[2];

        // 更新标题
        if (dialogTitle) {
            dialogTitle.textContent = calibratePathDialogTitleStrings[lang] || calibratePathDialogTitleStrings['zh_CN'];
        }

        // 更新指导列表
        if (instructionList && instructionList.children.length >= 3) {
            instructionList.children[0].textContent = calibratePathInstruction1Strings[lang] || calibratePathInstruction1Strings['zh_CN'];
            instructionList.children[1].textContent = calibratePathInstruction2Strings[lang] || calibratePathInstruction2Strings['zh_CN'];
            instructionList.children[2].textContent = calibratePathInstruction3Strings[lang] || calibratePathInstruction3Strings['zh_CN'];
        }

        // 更新输入标签和占位符
        if (inputLabel) {
            inputLabel.textContent = pastePathLabelStrings[lang] || pastePathLabelStrings['zh_CN'];
        }

        if (inputElement) {
            inputElement.placeholder = pastePathPlaceholderStrings[lang] || pastePathPlaceholderStrings['zh_CN'];
        }

        // 更新保存按钮
        if (saveBtn) {
            saveBtn.textContent = saveButtonStrings[lang] || saveButtonStrings['zh_CN'];
        }

        // 更新云备份指南标题
        if (cloudBackupTitle) {
            cloudBackupTitle.textContent = cloudBackupGuideTitleStrings[lang] || cloudBackupGuideTitleStrings['zh_CN'];
        }

        // 更新云备份指南内容
        if (cloudBackupGuide && cloudBackupGuide.children.length >= 3) {
            cloudBackupGuide.children[0].textContent = cloudBackupGuide1Strings[lang] || cloudBackupGuide1Strings['zh_CN'];
            cloudBackupGuide.children[1].textContent = cloudBackupGuide2Strings[lang] || cloudBackupGuide2Strings['zh_CN'];
            cloudBackupGuide.children[2].textContent = cloudBackupGuide3Strings[lang] || cloudBackupGuide3Strings['zh_CN'];
        }

        // 更新下载栏标题
        if (hideDownloadBarTitle) {
            hideDownloadBarTitle.textContent = hideDownloadBarTitleStrings[lang] || hideDownloadBarTitleStrings['zh_CN'];
        }

        // 更新下载栏指南
        if (hideDownloadBarGuide && hideDownloadBarGuide.children.length >= 2) {
            hideDownloadBarGuide.children[0].textContent = hideDownloadBarGuide1Strings[lang] || hideDownloadBarGuide1Strings['zh_CN'];
            hideDownloadBarGuide.children[1].textContent = hideDownloadBarGuide2Strings[lang] || hideDownloadBarGuide2Strings['zh_CN'];
        }

        // 更新按钮文本
        if (openSettingsBtn) {
            openSettingsBtn.textContent = openDownloadSettingsButtonStrings[lang] || openDownloadSettingsButtonStrings['zh_CN'];
        }

        if (cancelBtn) {
            cancelBtn.textContent = cancelButtonStrings[lang] || cancelButtonStrings['zh_CN'];
        }
    }
};


let bookmarkBackupSavedIndicatorTimer = null;

function showBookmarkBackupSavedFeedback() {
    const savedIndicator = document.getElementById('backupSettingsSavedIndicator');
    if (!savedIndicator) return;

    savedIndicator.style.opacity = '1';

    if (bookmarkBackupSavedIndicatorTimer) {
        clearTimeout(bookmarkBackupSavedIndicatorTimer);
    }

    bookmarkBackupSavedIndicatorTimer = setTimeout(() => {
        savedIndicator.style.opacity = '0';
        bookmarkBackupSavedIndicatorTimer = null;
    }, 2000);
}

// =============================================================================
// 备份设置初始化 (Backup Settings Initialization)
// =============================================================================

/**
 * 初始化备份设置区域的交互逻辑
 * - 备份模式：全量/增量互斥
 * - 增量详情：简略/详情互斥，仅增量模式时启用
 * - 覆盖策略：版本化/覆盖互斥
 */
function initializeBackupSettings() {
    // 获取备份模式与覆盖策略元素
    const backupModeAuto = document.getElementById('backupModeAuto');
    const backupModeManual = document.getElementById('backupModeManual');
    const overwriteVersioned = document.getElementById('overwriteVersioned');
    const overwriteOverwrite = document.getElementById('overwriteOverwrite');

    if (!overwriteVersioned || !overwriteOverwrite) return;

    // 加载保存的设置
    chrome.storage.local.get(['overwriteMode'], function (result) {
        const overwriteMode = result.overwriteMode || 'versioned';

        // 应用覆盖策略
        if (overwriteMode === 'versioned') {
            overwriteVersioned.checked = true;
            overwriteOverwrite.checked = false;
        } else {
            overwriteVersioned.checked = false;
            overwriteOverwrite.checked = true;
        }
    });

    // 保存设置到存储
    function saveBackupSettings() {
        const settings = {
            overwriteMode: overwriteOverwrite.checked ? 'overwrite' : 'versioned'
        };
        chrome.storage.local.set(settings, function () {
            if (!chrome.runtime.lastError) {
                showBookmarkBackupSavedFeedback();
                showCurrentChangesArchiveSavedFeedback();
            }
        });
    }

    // 覆盖策略：版本化勾选
    if (overwriteVersioned) {
        overwriteVersioned.addEventListener('change', function () {
            if (this.checked) {
                overwriteOverwrite.checked = false;
            } else {
                overwriteOverwrite.checked = true;
            }
            saveBackupSettings();
        });
    }

    // 覆盖策略：覆盖勾选
    if (overwriteOverwrite) {
        overwriteOverwrite.addEventListener('change', function () {
            if (this.checked) {
                overwriteVersioned.checked = false;
            } else {
                overwriteVersioned.checked = true;
            }
            saveBackupSettings();
        });
    }

    // 初始化备份模式切换（Settings 区域的 Auto/Manual）
    const handleModeChange = function (targetMode) {
        const autoSyncToggle2 = document.getElementById('autoSyncToggle2');
        if (!autoSyncToggle2) return;

        const currentMode = autoSyncToggle2.checked ? 'auto' : 'manual';
        if (targetMode === currentMode) return;

        if (targetMode === 'auto') {
            autoSyncToggle2.checked = true;
            autoSyncToggle2.dispatchEvent(new Event('change'));
        } else {
            autoSyncToggle2.checked = false;
            autoSyncToggle2.dispatchEvent(new Event('change'));
        }
    };

    if (backupModeAuto) {
        backupModeAuto.addEventListener('change', function (e) {
            if (e.target.checked) {
                if (backupModeManual) backupModeManual.checked = false;
                handleModeChange('auto');
            } else if (backupModeManual && !backupModeManual.checked) {
                backupModeManual.checked = true;
                handleModeChange('manual');
            }
        });
    }

    if (backupModeManual) {
        backupModeManual.addEventListener('change', function (e) {
            if (e.target.checked) {
                if (backupModeAuto) backupModeAuto.checked = false;
                handleModeChange('manual');
            } else if (backupModeAuto && !backupModeAuto.checked) {
                backupModeAuto.checked = true;
                handleModeChange('auto');
            }
        });
    }

    // 初始化备份模式状态 & 新按钮显示
    chrome.storage.local.get(['autoSync'], function (result) {
        const autoSyncEnabled = result.autoSync !== undefined ? result.autoSync : true;
        if (backupModeAuto) backupModeAuto.checked = autoSyncEnabled;
        if (backupModeManual) backupModeManual.checked = !autoSyncEnabled;

        const autoBackupSettingsBtnNew = document.getElementById('autoBackupSettingsBtnNew');
        const reminderSettingsBtnNew = document.getElementById('reminderSettingsBtnNew');
        if (autoBackupSettingsBtnNew) autoBackupSettingsBtnNew.style.display = autoSyncEnabled ? 'flex' : 'none';
        if (reminderSettingsBtnNew) reminderSettingsBtnNew.style.display = autoSyncEnabled ? 'none' : 'flex';
    });

    // 新按钮事件：复用原有设置按钮逻辑
    const autoBackupSettingsBtnNew = document.getElementById('autoBackupSettingsBtnNew');
    if (autoBackupSettingsBtnNew) {
        autoBackupSettingsBtnNew.addEventListener('click', async function () {
            const autoBtn = document.getElementById('autoBackupSettingsBtn');
            if (autoBtn) autoBtn.click();
        });
    }

    const reminderSettingsBtnNew = document.getElementById('reminderSettingsBtnNew');
    if (reminderSettingsBtnNew) {
        reminderSettingsBtnNew.addEventListener('click', async function () {
            const remBtn = document.getElementById('reminderSettingsBtn');
            if (remBtn) remBtn.click();
        });
    }

    // ===== 当前变化自动归档设置 =====
    const currentChangesArchiveEnabled = document.getElementById('currentChangesArchiveEnabled');
    const currentChangesArchiveContent = document.getElementById('currentChangesArchiveContent');
    const currentChangesArchiveFormatHtml = document.getElementById('currentChangesArchiveFormatHtml');
    const currentChangesArchiveFormatJson = document.getElementById('currentChangesArchiveFormatJson');
    const currentChangesArchiveModeSimple = document.getElementById('currentChangesArchiveModeSimple');
    const currentChangesArchiveModeDetailed = document.getElementById('currentChangesArchiveModeDetailed');
    const currentChangesArchiveModeCollection = document.getElementById('currentChangesArchiveModeCollection');

    const currentChangesArchiveHeader = document.getElementById('currentChangesArchiveHeader');
    const currentChangesArchiveSection = document.getElementById('currentChangesArchiveSection');
    const currentChangesArchiveCollapseIcon = document.getElementById('currentChangesArchiveCollapseIcon');
    const currentChangesArchiveSwitchWrap = currentChangesArchiveHeader
        ? currentChangesArchiveHeader.querySelector('.switch')
        : null;

    if (currentChangesArchiveSwitchWrap) {
        currentChangesArchiveSwitchWrap.addEventListener('click', function (e) {
            e.stopPropagation();
        });
    }
    if (currentChangesArchiveEnabled) {
        currentChangesArchiveEnabled.addEventListener('click', function (e) {
            e.stopPropagation();
        });
    }

    function updateCurrentChangesArchiveContentState() {
        if (!currentChangesArchiveContent) return;
        if (currentChangesArchiveEnabled && currentChangesArchiveEnabled.checked) {
            currentChangesArchiveContent.classList.remove('disabled');
        } else {
            currentChangesArchiveContent.classList.add('disabled');
        }
    }

    function showCurrentChangesArchiveSavedFeedback() {
        const savedIndicator = document.getElementById('currentChangesArchiveSavedIndicator');
        if (!savedIndicator) return;
        savedIndicator.style.opacity = '1';
        setTimeout(() => {
            savedIndicator.style.opacity = '0';
        }, 2000);
    }

    const normalizeExclusivePair = (firstEl, secondEl, preferFirst = true) => {
        if (!firstEl || !secondEl) return;

        if (firstEl.checked) {
            secondEl.checked = false;
            return;
        }

        if (secondEl.checked) {
            firstEl.checked = false;
            return;
        }

        if (preferFirst) {
            firstEl.checked = true;
            secondEl.checked = false;
        } else {
            firstEl.checked = false;
            secondEl.checked = true;
        }
    };

    const handleExclusiveChange = (currentEl, peerEl, preferCurrentWhenEmpty = true) => {
        if (!currentEl || !peerEl) return;

        if (currentEl.checked) {
            peerEl.checked = false;
            return;
        }

        if (!peerEl.checked) {
            if (preferCurrentWhenEmpty) {
                currentEl.checked = true;
                peerEl.checked = false;
            } else {
                currentEl.checked = false;
                peerEl.checked = true;
            }
        }
    };

    const normalizeExclusiveGroup = (group, preferIndex = 0) => {
        const options = Array.isArray(group) ? group.filter(Boolean) : [];
        if (options.length === 0) return;

        const checked = options.filter(el => el.checked);
        if (checked.length === 0) {
            const fallback = options[Math.max(0, Math.min(preferIndex, options.length - 1))] || options[0];
            if (fallback) fallback.checked = true;
            return;
        }

        const keep = checked[0];
        options.forEach(el => {
            if (el !== keep) el.checked = false;
        });
    };

    const handleExclusiveGroupChange = (currentEl, group, preferIndex = 0) => {
        const options = Array.isArray(group) ? group.filter(Boolean) : [];
        if (!currentEl || options.length === 0) return;

        if (currentEl.checked) {
            options.forEach(el => {
                if (el !== currentEl) el.checked = false;
            });
            return;
        }

        const hasChecked = options.some(el => el.checked);
        if (!hasChecked) {
            const fallback = options[Math.max(0, Math.min(preferIndex, options.length - 1))] || currentEl;
            if (fallback) fallback.checked = true;
        }
    };

    const currentChangesArchiveModeOptions = [
        currentChangesArchiveModeSimple,
        currentChangesArchiveModeDetailed,
        currentChangesArchiveModeCollection
    ].filter(Boolean);

    function collectCurrentChangesArchiveFormats() {
        if (currentChangesArchiveFormatJson?.checked) return ['json'];
        return ['html'];
    }

    function collectCurrentChangesArchiveModes() {
        if (currentChangesArchiveModeCollection?.checked) return ['collection'];
        if (currentChangesArchiveModeDetailed?.checked) return ['detailed'];
        return ['simple'];
    }

    function saveCurrentChangesArchiveSettings() {
        const payload = {
            currentChangesArchiveEnabled: !!currentChangesArchiveEnabled?.checked,
            currentChangesArchiveFormats: collectCurrentChangesArchiveFormats(),
            currentChangesArchiveModes: collectCurrentChangesArchiveModes()
        };
        chrome.storage.local.set(payload, function () {
            if (!chrome.runtime.lastError) {
                showCurrentChangesArchiveSavedFeedback();
            }
        });
    }

    chrome.storage.local.get([
        'currentChangesArchiveEnabled',
        'currentChangesArchiveFormats',
        'currentChangesArchiveModes',
        'currentChangesArchiveCollapsed'
    ], function (result) {
        const enabled = result.currentChangesArchiveEnabled !== false;

        const rawFormats = Array.isArray(result.currentChangesArchiveFormats)
            ? result.currentChangesArchiveFormats.map(v => String(v || '').toLowerCase())
            : [];
        const rawModes = Array.isArray(result.currentChangesArchiveModes)
            ? result.currentChangesArchiveModes.map(v => String(v || '').toLowerCase())
            : [];

        const format = rawFormats.find(v => v === 'html' || v === 'json') || 'html';
        const mode = rawModes.find(v => v === 'simple' || v === 'detailed' || v === 'collection') || 'simple';

        if (currentChangesArchiveEnabled) currentChangesArchiveEnabled.checked = enabled;
        if (currentChangesArchiveFormatHtml) currentChangesArchiveFormatHtml.checked = format === 'html';
        if (currentChangesArchiveFormatJson) currentChangesArchiveFormatJson.checked = format === 'json';
        if (currentChangesArchiveModeSimple) currentChangesArchiveModeSimple.checked = mode === 'simple';
        if (currentChangesArchiveModeDetailed) currentChangesArchiveModeDetailed.checked = mode === 'detailed';
        if (currentChangesArchiveModeCollection) currentChangesArchiveModeCollection.checked = mode === 'collection';

        normalizeExclusivePair(currentChangesArchiveFormatHtml, currentChangesArchiveFormatJson, true);
        normalizeExclusiveGroup(currentChangesArchiveModeOptions, 0);

        if (currentChangesArchiveSection) {
            const collapsed = result.currentChangesArchiveCollapsed === true;
            currentChangesArchiveSection.classList.toggle('collapsed', collapsed);
            if (currentChangesArchiveCollapseIcon) {
                currentChangesArchiveCollapseIcon.classList.toggle('fa-plus', collapsed);
                currentChangesArchiveCollapseIcon.classList.toggle('fa-minus', !collapsed);
            }
        }

        updateCurrentChangesArchiveContentState();

        chrome.storage.local.set({
            currentChangesArchiveEnabled: !!currentChangesArchiveEnabled?.checked,
            currentChangesArchiveFormats: collectCurrentChangesArchiveFormats(),
            currentChangesArchiveModes: collectCurrentChangesArchiveModes()
        }, function () { });

        requestAnimationFrame(() => {
            syncInitRightColumnHeights();
        });

        setTimeout(() => {
            syncInitRightColumnHeights();
        }, 220);
    });

    if (currentChangesArchiveEnabled) {
        currentChangesArchiveEnabled.addEventListener('change', function () {
            updateCurrentChangesArchiveContentState();
            saveCurrentChangesArchiveSettings();
        });
    }

    if (currentChangesArchiveFormatHtml) {
        currentChangesArchiveFormatHtml.addEventListener('change', function () {
            handleExclusiveChange(currentChangesArchiveFormatHtml, currentChangesArchiveFormatJson, true);
            saveCurrentChangesArchiveSettings();
        });
    }
    if (currentChangesArchiveFormatJson) {
        currentChangesArchiveFormatJson.addEventListener('change', function () {
            handleExclusiveChange(currentChangesArchiveFormatJson, currentChangesArchiveFormatHtml, true);
            saveCurrentChangesArchiveSettings();
        });
    }
    if (currentChangesArchiveModeSimple) {
        currentChangesArchiveModeSimple.addEventListener('change', function () {
            handleExclusiveGroupChange(currentChangesArchiveModeSimple, currentChangesArchiveModeOptions, 0);
            saveCurrentChangesArchiveSettings();
        });
    }
    if (currentChangesArchiveModeDetailed) {
        currentChangesArchiveModeDetailed.addEventListener('change', function () {
            handleExclusiveGroupChange(currentChangesArchiveModeDetailed, currentChangesArchiveModeOptions, 0);
            saveCurrentChangesArchiveSettings();
        });
    }
    if (currentChangesArchiveModeCollection) {
        currentChangesArchiveModeCollection.addEventListener('change', function () {
            handleExclusiveGroupChange(currentChangesArchiveModeCollection, currentChangesArchiveModeOptions, 0);
            saveCurrentChangesArchiveSettings();
        });
    }

    if (currentChangesArchiveHeader && currentChangesArchiveSection) {
        currentChangesArchiveHeader.addEventListener('click', function () {
            currentChangesArchiveSection.classList.toggle('collapsed');
            const isCollapsed = currentChangesArchiveSection.classList.contains('collapsed');
            chrome.storage.local.set({ currentChangesArchiveCollapsed: isCollapsed });

            if (currentChangesArchiveCollapseIcon) {
                currentChangesArchiveCollapseIcon.classList.toggle('fa-plus', isCollapsed);
                currentChangesArchiveCollapseIcon.classList.toggle('fa-minus', !isCollapsed);
            }

            requestAnimationFrame(() => {
                syncInitRightColumnHeights();
            });

            setTimeout(() => {
                syncInitRightColumnHeights();
            }, 220);
        });
    }
}


const localRestoreFileMap = new Map();

function escapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function setRestoreSourceButtonLoading(source, loading) {
    const btnId = `restoreFrom${source === 'webdav' ? 'WebDAV' : (source === 'github' ? 'GitHub' : 'Local')}Btn`;
    const btn = document.getElementById(btnId);
    if (!btn) return;

    const label = btn.querySelector('.restore-label');
    if (loading) {
        btn.disabled = true;
        btn.setAttribute('data-loading', '1');
        if (label) label.textContent = 'Scanning...';
    } else {
        btn.disabled = false;
        btn.removeAttribute('data-loading');
        // restore original label
        if (label) {
            if (source === 'webdav') label.textContent = 'WebDAV';
            else if (source === 'github') label.textContent = 'GitHub';
            else label.textContent = 'Local';
        }
    }
}

// [New] 处理云端恢复点击：扫描并解析为“版本列表”
async function handleRestoreFromCloud(source) {
    if (source === 'local') {
        const fileInput = document.getElementById('localRestoreInput');
        if (fileInput) {
            fileInput.value = ''; // Reset
            fileInput.click();
        }
        return;
    }

    setRestoreSourceButtonLoading(source, true);

    try {
        const response = await callBackgroundFunction('scanAndParseRestoreSource', { source });
        if (response?.success && Array.isArray(response.versions) && response.versions.length > 0) {
            showRestoreModal(response.versions, source);
        } else if (response?.success) {
            alert('No restore versions found in cloud folders.');
        } else {
            alert(`Scan failed: ${response?.error || 'Unknown error'}`);
        }
    } catch (e) {
        alert(`Error: ${e.message}`);
    } finally {
        setRestoreSourceButtonLoading(source, false);
    }
}

// [New] 本地文件选择监听 (支持文件夹扫描)
// 确保在DOM加载后绑定
document.addEventListener('DOMContentLoaded', () => {
    const localInput = document.getElementById('localRestoreInput');
    if (localInput) {
        localInput.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files);
            if (!files || files.length === 0) return;
            localRestoreFileMap.clear();

            const localCandidates = [];

            const snapshotFolderNameReg = /^\d{8}_\d{6}_[0-9a-f]{6,12}$/i;

            const isLikelyHistoryZip = (name, path) => {
                const rawName = String(name || '');
                const rawPath = String(path || '');
                const nameLower = rawName.toLowerCase();
                const pathLower = rawPath.toLowerCase();

                const inHistoryPath = rawPath.includes('备份历史') ||
                    rawPath.includes('自动备份归档') ||
                    pathLower.includes('backup_history') ||
                    pathLower.includes('auto_archive');

                const nameLooksRight = rawName === '备份历史归档.zip' ||
                    rawName === 'Backup_History_Archive.zip' ||
                    rawName.includes('备份历史') ||
                    rawName.includes('归档') ||
                    nameLower.includes('backup_history') ||
                    nameLower.includes('archive');

                return inHistoryPath || nameLooksRight;
            };

            const isSnapshotHtmlName = (name) => {
                const n = String(name || '');
                const lower = n.toLowerCase();
                if (/^\d{8}_\d{6}_[0-9a-f]{6,12}\.html$/i.test(lower)) return true;
                if (/^(?:backup_)?\d{8}_\d{6}\.html$/i.test(lower)) return true;
                if (lower === 'bookmark_backup.html') return true;
                if (lower.endsWith('.html') && (lower.includes('bookmark_backup') || lower.includes('bookmark backup'))) return true;
                return false;
            };

            const isOverwriteFolderName = (name) => {
                const text = String(name || '').trim().toLowerCase();
                return text === '覆盖' || text === 'overwrite';
            };

            const extractSnapshotFolderFromPath = (pathText) => {
                const parts = String(pathText || '').split('/').filter(Boolean);
                if (parts.length === 0) return '';

                for (let i = parts.length - 1; i >= 0; i--) {
                    const part = String(parts[i] || '').trim();
                    if (!part) continue;
                    if (snapshotFolderNameReg.test(part)) return part;
                    if (part === '覆盖' || String(part).toLowerCase() === 'overwrite') return part;
                }
                return '';
            };

            const isInSnapshotOrOverwriteFolder = (pathText, snapshotFolder = '') => {
                if (snapshotFolderNameReg.test(String(snapshotFolder || ''))) return true;
                if (isOverwriteFolderName(snapshotFolder)) return true;

                const parts = String(pathText || '')
                    .split('/')
                    .map(part => String(part || '').trim())
                    .filter(Boolean);
                return parts.some(part => snapshotFolderNameReg.test(part) || isOverwriteFolderName(part));
            };

            const shouldTreatAsChangesArtifact = ({ name, pathText, snapshotFolder }) => {
                const fileName = String(name || '').trim();
                if (!fileName) return false;
                if (isSnapshotHtmlName(fileName)) return false;
                if (!/\.(json|html)$/i.test(fileName)) return false;

                return isInSnapshotOrOverwriteFolder(pathText, snapshotFolder);
            };

            const zipFiles = [];

            for (const file of files) {
                const name = String(file.name || '');
                const pathText = String(file.webkitRelativePath || name || '');
                const pathLower = pathText.toLowerCase();
                const localFileKey = pathText;
                localRestoreFileMap.set(localFileKey, file);

                try {
                    if (name === 'backup_history.json') {
                        const text = await file.text();
                        localCandidates.push({
                            name,
                            source: 'local',
                            type: 'merged_history',
                            localFileKey,
                            text,
                            lastModified: file.lastModified
                        });
                        continue;
                    }

                    if (name.toLowerCase().endsWith('.zip') && isLikelyHistoryZip(name, pathText)) {
                        zipFiles.push({ file, name, localFileKey, lastModified: file.lastModified });
                        continue;
                    }

                    if (isSnapshotHtmlName(name)) {
                        const snapshotFolder = extractSnapshotFolderFromPath(pathText);
                        const folderPath = pathText.includes('/')
                            ? pathText.slice(0, pathText.lastIndexOf('/'))
                            : '';
                        const inBackupPath = pathText.includes('书签备份') ||
                            pathLower.includes('bookmark backup') ||
                            pathLower.includes('bookmark_backup') ||
                            pathLower.includes('bookmarkbackup');
                        if (snapshotFolder || inBackupPath) {
                            localCandidates.push({
                                name,
                                source: 'local',
                                type: 'html_backup',
                                localFileKey,
                                lastModified: file.lastModified,
                                snapshotFolder,
                                folderPath
                            });
                            continue;
                        }
                    }

                    const snapshotFolder = extractSnapshotFolderFromPath(pathText);
                    if (shouldTreatAsChangesArtifact({ name, pathText, snapshotFolder })) {
                        const text = await file.text();
                        const folderPath = pathText.includes('/')
                            ? pathText.slice(0, pathText.lastIndexOf('/'))
                            : '';
                        localCandidates.push({
                            name,
                            source: 'local',
                            type: 'changes_artifact',
                            localFileKey,
                            text,
                            lastModified: file.lastModified,
                            snapshotFolder,
                            folderPath
                        });
                    }
                } catch (err) {
                    console.warn('[Local Restore] Read file failed:', name, err);
                }
            }

            if (zipFiles.length > 0) {
                zipFiles.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
                const maxZip = Math.min(3, zipFiles.length);
                for (let i = 0; i < maxZip; i++) {
                    const { file, name, localFileKey } = zipFiles[i];
                    try {
                        const arrayBuffer = await file.arrayBuffer();
                        localCandidates.push({
                            name,
                            source: 'local',
                            type: 'zip',
                            localFileKey,
                            arrayBuffer,
                            lastModified: file.lastModified
                        });
                    } catch (err) {
                        console.warn('[Local Restore] Read zip failed:', name, err);
                    }
                }
            }

            if (localCandidates.length === 0) {
                alert('No valid backup files found (Snapshot HTML / Current Changes JSON|HTML / backup_history.json / ZIP).');
                return;
            }

            try {
                const response = await callBackgroundFunction('scanAndParseRestoreSource', {
                    source: 'local',
                    localFiles: localCandidates
                });
                if (response?.success && Array.isArray(response.versions) && response.versions.length > 0) {
                    showRestoreModal(response.versions, 'local');
                } else if (response?.success) {
                    alert('No restore versions found in selected folder.');
                } else {
                    alert(`Scan failed: ${response?.error || 'Unknown error'}`);
                }
            } catch (err) {
                alert(`Scan error: ${err.message}`);
            }
        });
    }
});

// [New] 显示恢复模态框
function showRestoreModal(versions, source) {
    const modal = document.getElementById('restoreModal');
    const tableBody = document.getElementById('restoreVersionTableBody');
    const confirmBtn = document.getElementById('confirmRestoreBtnRef');
    const strategyGroup = document.getElementById('restoreStrategyGroup');
    const strategyOverwriteRadio = document.getElementById('restoreStrategyOverwrite');
    const strategyMergeRadio = document.getElementById('restoreStrategyMerge');
    const strategyOverwriteLabel = document.getElementById('restoreStrategyOverwriteLabel');
    const strategyMergeLabel = document.getElementById('restoreStrategyMergeLabel');
    const strategyOverwriteLabelWrap = document.getElementById('restoreStrategyOverwriteLabelWrap');
    const strategyMergeLabelWrap = document.getElementById('restoreStrategyMergeLabelWrap');

    // Merge view mode (Backup History only)
    const mergeViewModeSegment = document.getElementById('restoreMergeViewModeSegment');
    const mergeViewModeGroup = document.getElementById('restoreMergeViewModeGroup');
    const mergeViewModeSimpleRadio = document.getElementById('restoreMergeViewModeSimple');
    const mergeViewModeDetailedRadio = document.getElementById('restoreMergeViewModeDetailed');
    const mergeViewModeSimpleText = document.getElementById('restoreMergeViewModeSimpleText');
    const mergeViewModeDetailedText = document.getElementById('restoreMergeViewModeDetailedText');
    const mergeViewModeSimpleWrap = document.getElementById('restoreMergeViewModeSimpleWrap');
    const mergeViewModeDetailedWrap = document.getElementById('restoreMergeViewModeDetailedWrap');

    const cancelBtn = document.getElementById('cancelRestoreBtnRef');
    const closeBtn = document.getElementById('closeRestoreModal');
    const title = document.getElementById('restoreModalTitle');
    const thSeq = document.getElementById('restoreThSeq');
    const thNote = document.getElementById('restoreThNote');
    const thHash = document.getElementById('restoreThHash');
    const thTime = document.getElementById('restoreThTime');
    const thStats = document.getElementById('restoreThStats');
    const thStatsCurrent = document.getElementById('restoreThStatsCurrent');

    // Pagination (10 per page)
    const pagination = document.getElementById('restorePagination');
    const pageInput = document.getElementById('restorePageInput');
    const totalPagesEl = document.getElementById('restoreTotalPages');
    const prevPageBtn = document.getElementById('restorePrevPage');
    const nextPageBtn = document.getElementById('restoreNextPage');
    const pageHint = document.getElementById('restorePageHint');

    const thHashCell = thHash ? thHash.closest('th') : null;
    const thStatsCell = thStats ? thStats.closest('th') : null;
    const thStatsCurrentCell = thStatsCurrent ? thStatsCurrent.closest('th') : null;

    const versionTable = document.getElementById('restoreVersionTable');
    const versionTableContainer = versionTable ? versionTable.closest('.global-export-table-container') : null;

    const versionTypeSegment = document.getElementById('restoreVersionTypeSegment');
    const versionTypeHistoryRadio = document.getElementById('restoreVersionTypeHistory');
    const versionTypeSnapshotRadio = document.getElementById('restoreVersionTypeSnapshot');
    const versionTypeHistoryText = document.getElementById('restoreVersionTypeHistoryText');
    const versionTypeSnapshotText = document.getElementById('restoreVersionTypeSnapshotText');
    const versionTypeHistoryLabelWrap = document.getElementById('restoreVersionTypeHistoryLabelWrap');
    const versionTypeSnapshotLabelWrap = document.getElementById('restoreVersionTypeSnapshotLabelWrap');

    if (!modal || !tableBody || !confirmBtn || !strategyGroup || !strategyOverwriteRadio || !strategyMergeRadio || !cancelBtn || !closeBtn) {
        console.warn('[showRestoreModal] Missing modal DOM nodes');
        return;
    }

    // --- Reset button listeners (clone nodes) ---
    const resetBtn = (btn) => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        return newBtn;
    };

    const confirmButton = resetBtn(confirmBtn);
    const cancelButton = resetBtn(cancelBtn);
    const closeButton = resetBtn(closeBtn);

    const allVersions = Array.isArray(versions) ? versions : [];
    const isHtmlVersion = (v) => {
        const st = v?.sourceType || v?.restoreRef?.sourceType || '';
        return st === 'html';
    };
    const historyVersions = allVersions;
    const snapshotVersions = [];

    let currentVersionType = 'history';

    const getVisibleColumnCount = () => 7;

    // Paginated rendering (default: 10 per page)
    const RESTORE_PAGE_SIZE = 10;
    let currentHistoryPage = 1;
    let currentSnapshotPage = 1;
    let pageComputeToken = 0;

    let cachedLang = 'zh_CN';

    const getVersionTypeLabel = (lang, type) => {
        const isEn = lang === 'en';
        return isEn ? 'Restore Versions' : '恢复版本';
    };

    const updateTitleText = (lang, type) => {
        const isEn = lang === 'en';
        const sourceLabel = source === 'webdav' ? 'WebDAV' : (source === 'github' ? 'GitHub' : (isEn ? 'Local' : '本地'));
        const typeLabel = getVersionTypeLabel(lang, type);
        if (title) {
            title.textContent = isEn
                ? `Restore from ${sourceLabel} · ${typeLabel}`
                : `从 ${sourceLabel} 恢复 · ${typeLabel}`;
        }
    };

    let currentStrategy = strategyMergeRadio.checked ? 'merge' : 'overwrite';

    const getPreferredLang = () => new Promise(resolve => {
        try {
            chrome.storage.local.get(['preferredLang', 'currentLang'], (res) => {
                resolve(res?.currentLang || res?.preferredLang || 'zh_CN');
            });
        } catch (_) {
            resolve('zh_CN');
        }
    });

    const setRestoreModalI18n = async () => {
        const lang = await getPreferredLang();
        cachedLang = lang;
        const isEn = lang === 'en';

        updateTitleText(lang, currentVersionType);

        if (thSeq) thSeq.textContent = isEn ? 'Seq' : '序号';
        if (thNote) thNote.textContent = isEn ? 'Note' : '备注';
        if (thHash) thHash.textContent = isEn ? 'Hash' : '哈希值';
        if (thTime) thTime.textContent = isEn ? 'Time' : '时间';
        if (thStats) thStats.textContent = isEn ? 'Record delta' : '记录变化';
        if (thStatsCurrent) thStatsCurrent.textContent = isEn ? 'Impact' : '对当前影响';

        // Header tooltips
        if (thStatsCell) {
            thStatsCell.title = isEn
                ? 'Changes inside this backup history record (compared to the previous record)'
                : '该备份记录自身的变化（相较上一条记录）';
        }
        if (thStatsCurrentCell) {
            thStatsCurrentCell.title = isEn
                ? 'Impact if you restore this version (compared to your current browser bookmarks)'
                : '如果恢复到该版本，相较当前浏览器书签将产生的变化';
        }

        if (versionTypeHistoryText) {
            const label = isEn ? 'Restore Versions' : '恢复版本';
            versionTypeHistoryText.textContent = `${label} (${historyVersions.length})`;
        }
        if (versionTypeSnapshotText) {
            versionTypeSnapshotText.textContent = '';
        }
        if (versionTypeHistoryLabelWrap) {
            versionTypeHistoryLabelWrap.title = isEn
                ? 'Unified restore list (snapshot + history + current changes metadata).'
                : '统一恢复列表（快照 + 历史 + 当前变化元数据）。';
        }
        if (versionTypeSnapshotLabelWrap) {
            versionTypeSnapshotLabelWrap.title = '';
        }

        cancelButton.textContent = isEn ? 'Cancel' : '取消';
        // 主按钮点击后进入二级确认弹窗
        confirmButton.textContent = isEn ? 'Restore' : '恢复';

        if (pageHint) {
            pageHint.textContent = isEn
                ? `${RESTORE_PAGE_SIZE}/page`
                : `${RESTORE_PAGE_SIZE}/页`;
        }

        if (strategyOverwriteLabel) {
            const span = strategyOverwriteLabel.querySelector('span:last-child');
            if (span) span.textContent = isEn ? 'Overwrite' : '覆盖';
        }
        if (strategyMergeLabel) {
            const span = strategyMergeLabel.querySelector('span:last-child');
            if (span) span.textContent = isEn ? 'Import Merge' : '导入合并';
        }

        // Merge view mode toggle texts
        if (mergeViewModeSimpleText) mergeViewModeSimpleText.textContent = isEn ? 'Simple' : '简略';
        if (mergeViewModeDetailedText) mergeViewModeDetailedText.textContent = isEn ? 'Detailed' : '详细';
        if (mergeViewModeSimpleWrap) {
            mergeViewModeSimpleWrap.title = isEn
                ? 'Simple: import only branches that changed.'
                : '简略：只导入有变化的分支。';
        }
        if (mergeViewModeDetailedWrap) {
            mergeViewModeDetailedWrap.title = isEn
                ? 'Detailed: WYSIWYG (imports only expanded folders / changed paths).'
                : '详细：所见即所得（仅导入展开的文件夹内容/有变化的路径）。';
        }

        if (strategyOverwriteLabelWrap) {
            strategyOverwriteLabelWrap.title = isEn
                ? 'Overwrite: delete current bookmarks, then rebuild from the target snapshot. Bookmark IDs will change and may affect features like Records/Recommendations.'
                : '覆盖：先删除当前书签，再按目标快照重建。Bookmark ID 会变化，可能影响书签记录、书签推荐等功能。';
        }
        if (strategyMergeLabelWrap) {
            strategyMergeLabelWrap.title = isEn
                ? 'Import Merge: import into a new folder under bookmark roots (no deletion). For Backup History, it imports the changes view (titles prefixed with [+]/[-]/[~]/[↔]).'
                : '导入合并：导入到书签树的新文件夹（不删除现有书签）。备份历史会导入“差异视图”（标题带 [+]/[-]/[~]/[↔] 前缀）。';
        }
    };

    // i18n update (best-effort)
    setRestoreModalI18n();

    // Populate Table
    let selectedVersion = null;

    // Import Merge target (per version type)
    // - { id, title }
    const importTargetByType = { history: null, snapshot: null };

    // Diff vs current-browser cache (computed on-demand per selected row)
    // - key: version.id
    // - value: { success:boolean, diffSummary?:object, error?:string }
    const diffVsCurrentCache = new Map();
    const diffVsCurrentPending = new Map();

    // Local restore payload cache (avoid re-reading same file repeatedly)
    // - key: `${sourceType}|${localFileKey}`
    const localPayloadCache = new Map();

    const buildStatsHtml = (stats, { zeroAsCheck = false } = {}) => {
        const rawStats = stats || {};
        const s = normalizeOverwriteDiffSummaryForDisplay(rawStats);
        const bmAdded = Number(s.bookmarkAdded || 0);
        const bmDeleted = Number(s.bookmarkDeleted || 0);
        const folderAdded = Number(s.folderAdded || 0);
        const folderDeleted = Number(s.folderDeleted || 0);

        const items = [];
        if (bmAdded) items.push(`<span><span class='pos'>+${bmAdded}</span> B</span>`);
        if (bmDeleted) items.push(`<span><span class='neg'>-${bmDeleted}</span> B</span>`);
        if (folderAdded) items.push(`<span><span class='pos'>+${folderAdded}</span> F</span>`);
        if (folderDeleted) items.push(`<span><span class='neg'>-${folderDeleted}</span> F</span>`);

        if (items.length === 0) {
            return zeroAsCheck
                ? "<span class='pos'>✓</span>"
                : "<span style='opacity: 0.65;'>—</span>";
        }
        return items.join('');
    };

    const buildLocalPayloadIfNeeded = async (restoreRef) => {
        if (!restoreRef || restoreRef.source !== 'local') return null;

        const fileKey = restoreRef.localFileKey;
        const cacheKey = `${restoreRef.sourceType || 'unknown'}|${fileKey || ''}`;
        if (localPayloadCache.has(cacheKey)) {
            return localPayloadCache.get(cacheKey);
        }

        const fileObj = fileKey ? localRestoreFileMap.get(fileKey) : null;
        if (!fileObj) {
            throw new Error('Local file handle expired. Please reselect the folder.');
        }

        let payload = null;
        if (restoreRef.sourceType === 'zip') {
            const arrayBuffer = await fileObj.arrayBuffer();
            payload = { arrayBuffer };
        } else {
            const text = await fileObj.text();
            payload = { text };
        }

        localPayloadCache.set(cacheKey, payload);
        return payload;
    };

    const getDiffSummaryAgainstCurrent = async (version) => {
        const key = String(version?.id || '');
        if (!key) {
            return { success: false, error: 'Missing version id' };
        }

        if (diffVsCurrentCache.has(key)) {
            return diffVsCurrentCache.get(key);
        }

        if (diffVsCurrentPending.has(key)) {
            return await diffVsCurrentPending.get(key);
        }

        const task = (async () => {
            try {
                const restoreRef = version?.restoreRef;
                if (!restoreRef) {
                    return { success: false, error: 'Missing restoreRef' };
                }

                // Local restore: always pass payload on first try to avoid noisy
                // "Missing local HTML data" errors from background preflight calls.
                let localPayload = null;
                if (restoreRef.source === 'local') {
                    localPayload = await buildLocalPayloadIfNeeded(restoreRef);
                }

                const requestPayload = { restoreRef };
                if (localPayload) {
                    requestPayload.localPayload = localPayload;
                }

                const res = await callBackgroundFunction('computeRestoreDiffSummaryAgainstCurrent', requestPayload);

                if (!res || res.success !== true) {
                    return { success: false, error: res?.error || 'Unknown error' };
                }

                const rawDiffSummary = res.diffSummary || null;
                const normalizedDiffSummary = rawDiffSummary
                    ? normalizeOverwriteDiffSummaryForDisplay(rawDiffSummary)
                    : rawDiffSummary;

                return { success: true, diffSummary: normalizedDiffSummary };
            } catch (e) {
                return { success: false, error: e?.message || 'Unknown error' };
            }
        })();

        diffVsCurrentPending.set(key, task);
        const result = await task;
        diffVsCurrentPending.delete(key);
        if (result && result.success === true) {
            diffVsCurrentCache.set(key, result);
        }
        return result;
    };

    const getSelectedMergeViewMode = () => {
        if (mergeViewModeDetailedRadio && mergeViewModeDetailedRadio.checked) return 'detailed';
        return 'simple';
    };

    const updateMergeViewModeUi = () => {
        const restoreSourceType = selectedVersion?.restoreRef?.sourceType || selectedVersion?.sourceType || '';
        const supportMergeViewMode = restoreSourceType === 'json' || restoreSourceType === 'zip';
        const shouldShow = strategyMergeRadio && strategyMergeRadio.checked && supportMergeViewMode;
        if (mergeViewModeSegment) {
            mergeViewModeSegment.style.display = shouldShow ? 'block' : 'none';
        }

        const disabled = !shouldShow || selectedVersion?.canRestore === false;
        if (mergeViewModeSimpleRadio) mergeViewModeSimpleRadio.disabled = disabled;
        if (mergeViewModeDetailedRadio) mergeViewModeDetailedRadio.disabled = disabled;
        if (mergeViewModeGroup) mergeViewModeGroup.classList.toggle('disabled', disabled);
    };

    const updateStatsVsCurrentForRow = async (row, version) => {
        if (!row || !version) return;

        const cell = row.querySelector('.restore-stats-current');
        if (!cell) return;

        const isEn = cachedLang === 'en';
        if (version?.canRestore === false) {
            cell.innerHTML = "<span style='opacity: 0.65;'>—</span>";
            return;
        }

        const key = String(version?.id || '');
        const cached = key ? diffVsCurrentCache.get(key) : null;
        if (cached && cached.success && cached.diffSummary) {
            cell.innerHTML = buildStatsHtml(cached.diffSummary, { zeroAsCheck: true });
            return;
        }
        if (cached && cached.success && !cached.diffSummary) {
            cell.innerHTML = "<span class='pos'>✓</span>";
            return;
        }
        cell.innerHTML = `<span style='opacity: 0.65;'>${isEn ? 'Computing...' : '计算中...'}</span>`;

        const result = await getDiffSummaryAgainstCurrent(version);
        if (!cell.isConnected) return;

        if (result && result.success && result.diffSummary) {
            cell.innerHTML = buildStatsHtml(result.diffSummary, { zeroAsCheck: true });
            return;
        }

        const err = result?.error ? escapeHtml(String(result.error)) : '';
        cell.innerHTML = `<span style='opacity: 0.65;' title="${err}">${isEn ? 'Failed (click retry)' : '失败(点行重试)'}</span>`;
    };

    const applyDefaultStrategyForType = (type) => {
        strategyOverwriteRadio.checked = true;
        strategyMergeRadio.checked = false;
        currentStrategy = 'overwrite';
    };

    const applyColumnVisibilityForType = (type) => {
        if (thHashCell) thHashCell.style.display = '';
        if (thStatsCell) thStatsCell.style.display = '';
        if (thStatsCurrentCell) thStatsCurrentCell.style.display = '';
    };

    const applyTablePresentationForType = (type) => {
        if (versionTable) {
            versionTable.style.width = '100%';
            versionTable.classList.remove('snapshot-mode');
        }
        if (versionTableContainer) {
            versionTableContainer.style.display = '';
            versionTableContainer.style.width = '';
            versionTableContainer.style.maxWidth = '';
            versionTableContainer.style.margin = '';
        }
    };

    // Reset strategy by version type
    applyDefaultStrategyForType(currentVersionType);

    strategyGroup.classList.add('disabled');
    strategyOverwriteRadio.disabled = true;
    strategyMergeRadio.disabled = true;

    // Column visibility / layout by version type
    applyColumnVisibilityForType(currentVersionType);
    applyTablePresentationForType(currentVersionType);

    const setLabelDisabled = (labelWrap, disabled) => {
        if (!labelWrap) return;
        labelWrap.style.opacity = disabled ? '0.55' : '';
        labelWrap.style.cursor = disabled ? 'not-allowed' : 'pointer';
    };

    const getStrategyAvailabilityForType = (type) => {
        if (type === 'snapshot') {
            return { overwrite: true, merge: true };
        }
        return { overwrite: true, merge: true };
    };

    const updateStrategyAvailabilityUi = () => {
        const canRestore = selectedVersion?.canRestore !== false;
        const avail = getStrategyAvailabilityForType(currentVersionType);

        // Visibility
        if (strategyOverwriteLabelWrap) strategyOverwriteLabelWrap.style.display = avail.overwrite ? '' : 'none';
        if (strategyMergeLabelWrap) strategyMergeLabelWrap.style.display = avail.merge ? '' : 'none';

        // Ensure selected strategy is valid
        let desired = currentStrategy;
        if (desired !== 'overwrite' && desired !== 'merge') desired = 'merge';
        if (!avail[desired]) {
            desired = avail.merge ? 'merge' : (avail.overwrite ? 'overwrite' : 'merge');
        }

        if (strategyOverwriteRadio) strategyOverwriteRadio.checked = desired === 'overwrite';
        if (strategyMergeRadio) strategyMergeRadio.checked = desired === 'merge';
        currentStrategy = desired;

        // Disabled state
        if (strategyOverwriteRadio) strategyOverwriteRadio.disabled = !canRestore || !avail.overwrite;
        if (strategyMergeRadio) strategyMergeRadio.disabled = !canRestore || !avail.merge;

        setLabelDisabled(strategyOverwriteLabelWrap, strategyOverwriteRadio?.disabled);
        setLabelDisabled(strategyMergeLabelWrap, strategyMergeRadio?.disabled);
    };

    const setEmptyTableMessage = (message) => {
        tableBody.innerHTML = '';
        const row = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = getVisibleColumnCount();
        td.style.padding = '14px';
        td.style.textAlign = 'center';
        td.style.color = 'var(--theme-text-secondary)';
        td.textContent = message;
        row.appendChild(td);
        tableBody.appendChild(row);
    };

    const updatePaginationUi = (totalRecords) => {
        if (!pagination || !pageInput || !totalPagesEl || !prevPageBtn || !nextPageBtn) return;

        const totalPages = Math.max(1, Math.ceil(Number(totalRecords || 0) / RESTORE_PAGE_SIZE));
        const current = (currentVersionType === 'snapshot') ? currentSnapshotPage : currentHistoryPage;
        const safeCurrent = Math.min(Math.max(1, current), totalPages);

        if (currentVersionType === 'snapshot') currentSnapshotPage = safeCurrent;
        else currentHistoryPage = safeCurrent;

        if (totalPages <= 1) {
            pagination.style.display = 'none';
            return;
        }

        pagination.style.display = 'flex';
        pageInput.value = String(safeCurrent);
        totalPagesEl.textContent = String(totalPages);
        prevPageBtn.disabled = safeCurrent <= 1;
        nextPageBtn.disabled = safeCurrent >= totalPages;
    };

    const getCurrentPage = () => (currentVersionType === 'snapshot' ? currentSnapshotPage : currentHistoryPage);

    const computeVsCurrentForPage = (pairs) => {
        const list = Array.isArray(pairs) ? pairs : [];
        if (list.length === 0) return;

        const token = ++pageComputeToken;
        const concurrency = 2;
        let cursor = 0;

        const worker = async () => {
            while (cursor < list.length) {
                if (token !== pageComputeToken) return;
                const idx = cursor++;
                const item = list[idx];
                if (!item || !item.row || !item.row.isConnected) continue;
                await updateStatsVsCurrentForRow(item.row, item.version);
            }
        };

        Promise.all(Array.from({ length: concurrency }, worker)).catch(() => { });
    };

    const renderVersionTable = (list) => {
        const prevSelectedId = selectedVersion?.id != null ? String(selectedVersion.id) : null;

        tableBody.innerHTML = '';
        selectedVersion = null;

        applyColumnVisibilityForType(currentVersionType);
        applyTablePresentationForType(currentVersionType);
        const isSnapshotMode = currentVersionType === 'snapshot';

        const allItems = Array.isArray(list) ? list : [];
        updatePaginationUi(allItems.length);

        if (allItems.length === 0) {
            setEmptyTableMessage('No versions found / 未找到可恢复版本');
            confirmButton.disabled = true;
            strategyOverwriteRadio.disabled = true;
            strategyMergeRadio.disabled = true;
            strategyGroup.classList.add('disabled');
            return;
        }

        const totalPages = Math.max(1, Math.ceil(allItems.length / RESTORE_PAGE_SIZE));
        const currentPage = Math.min(Math.max(1, getCurrentPage()), totalPages);
        if (currentVersionType === 'snapshot') currentSnapshotPage = currentPage;
        else currentHistoryPage = currentPage;

        const startIndex = (currentPage - 1) * RESTORE_PAGE_SIZE;
        const endIndex = Math.min(startIndex + RESTORE_PAGE_SIZE, allItems.length);
        const pageItems = allItems.slice(startIndex, endIndex);

        const clearSelection = () => {
            Array.from(tableBody.querySelectorAll("tr[data-selected='1']")).forEach((tr) => {
                tr.removeAttribute('data-selected');
            });
        };

        const selectRow = (row, version, radioId) => {
            const canRestore = version?.canRestore !== false;
            const radio = document.getElementById(`rvs_${radioId}`);
            if (radio) radio.checked = true;

            clearSelection();
            row.setAttribute('data-selected', '1');

            const prevId = selectedVersion?.id != null ? String(selectedVersion.id) : null;
            const nextId = version?.id != null ? String(version.id) : null;
            selectedVersion = version;

            confirmButton.disabled = !canRestore;
            strategyGroup.classList.toggle('disabled', !canRestore);
            updateStrategyAvailabilityUi();
            updateMergeViewModeUi();
        };

        const rowPairs = [];
        const rowMap = new Map(); // id -> { row, version, radioId }
        let firstSelectable = null;

        pageItems.forEach((version, pageIndex) => {
            const globalIndex = startIndex + pageIndex;
            const radioId = globalIndex;

            const canRestore = version?.canRestore !== false;
            const note = String(version?.note || '').trim();
            const fingerprint = String(version?.fingerprint || '').slice(0, 7);
            const fingerprintDisplay = fingerprint ? `#${fingerprint}` : '';
            const displayTime = String(version?.displayTime || '');
            const isHtml = isHtmlVersion(version);

            let seq = version?.seqNumber != null ? String(version.seqNumber) : String(globalIndex + 1);
            if (isSnapshotMode && (version?.seqNumber == null)) {
                seq = String(allItems.length - globalIndex);
            }

            const fileName = String(version?.originalFile || version?.restoreRef?.originalFile || '').trim();
            const displayNote = isHtml ? (fileName || note || '') : (note || '');

            const row = document.createElement('tr');
            if (!canRestore) row.style.opacity = '0.7';

            const tdSelect = document.createElement('td');
            tdSelect.className = 'restore-cell-center';
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'restoreVersionSelect';
            radio.id = `rvs_${radioId}`;
            radio.checked = false;
            radio.style.cursor = 'pointer';
            tdSelect.appendChild(radio);

            const tdSeq = document.createElement('td');
            tdSeq.className = 'restore-cell-center restore-cell-mono';
            tdSeq.textContent = `#${seq}`;

            const tdNote = document.createElement('td');
            const noteDiv = document.createElement('div');
            noteDiv.className = 'restore-note';
            noteDiv.textContent = displayNote;
            tdNote.appendChild(noteDiv);

            let tdHash = null;
            if (!isSnapshotMode) {
                tdHash = document.createElement('td');
                tdHash.className = 'restore-cell-mono';
                tdHash.textContent = fingerprintDisplay;
            }

            const tdTime = document.createElement('td');
            tdTime.className = 'restore-cell-mono';
            tdTime.textContent = displayTime;

            let tdStats = null;
            let tdStatsCurrent = null;
            if (!isSnapshotMode) {
                tdStats = document.createElement('td');
                const statsDiv = document.createElement('div');
                statsDiv.className = 'restore-stats';
                statsDiv.innerHTML = buildStatsHtml(version?.stats, { zeroAsCheck: true });
                tdStats.appendChild(statsDiv);

                tdStatsCurrent = document.createElement('td');
                const statsCurrentDiv = document.createElement('div');
                statsCurrentDiv.className = 'restore-stats restore-stats-current';
                statsCurrentDiv.title = cachedLang === 'en'
                    ? 'Computing impact vs current browser bookmarks'
                    : '正在计算对当前浏览器书签的影响';
                statsCurrentDiv.innerHTML = cachedLang === 'en'
                    ? "<span style='opacity: 0.55;'>Queued</span>"
                    : "<span style='opacity: 0.55;'>排队中</span>";
                statsCurrentDiv.style.cursor = 'pointer';
                statsCurrentDiv.addEventListener('click', (e) => {
                    e.stopPropagation();
                    updateStatsVsCurrentForRow(row, version).catch(() => { });
                });
                tdStatsCurrent.appendChild(statsCurrentDiv);
            }

            row.appendChild(tdSelect);
            row.appendChild(tdSeq);
            row.appendChild(tdNote);
            if (tdHash) row.appendChild(tdHash);
            row.appendChild(tdTime);
            if (tdStats) row.appendChild(tdStats);
            if (tdStatsCurrent) row.appendChild(tdStatsCurrent);

            row.addEventListener('click', () => {
                selectRow(row, version, radioId);
            });

            tableBody.appendChild(row);

            const vid = version?.id != null ? String(version.id) : '';
            if (vid) {
                rowMap.set(vid, { row, version, radioId });
            }
            if (!firstSelectable) {
                firstSelectable = { row, version, radioId };
            }
            rowPairs.push({ row, version });
        });

        // Selection (preserve previous if it exists on this page)
        const preferred = prevSelectedId && rowMap.has(prevSelectedId) ? rowMap.get(prevSelectedId) : null;
        const toSelect = preferred || firstSelectable;
        if (toSelect) {
            selectRow(toSelect.row, toSelect.version, toSelect.radioId);
        }

        // Auto compute "impact" column for current page
        computeVsCurrentForPage(rowPairs);
    };

    const hasHistory = historyVersions.length > 0;

    if (versionTypeSegment) {
        versionTypeSegment.style.display = 'none';
    }

    if (versionTypeHistoryRadio) {
        versionTypeHistoryRadio.disabled = true;
        versionTypeHistoryRadio.checked = true;
        versionTypeHistoryRadio.onchange = null;
    }
    if (versionTypeSnapshotRadio) {
        versionTypeSnapshotRadio.disabled = true;
        versionTypeSnapshotRadio.checked = false;
        versionTypeSnapshotRadio.onchange = null;
    }
    setLabelDisabled(versionTypeHistoryLabelWrap, true);
    setLabelDisabled(versionTypeSnapshotLabelWrap, true);

    currentVersionType = 'history';

    const goToPage = (page) => {
        const items = historyVersions;
        const totalPages = Math.max(1, Math.ceil((items?.length || 0) / RESTORE_PAGE_SIZE));
        const next = Math.min(Math.max(1, Number(page) || 1), totalPages);
        currentHistoryPage = next;
        renderVersionTable(items);
    };

    if (prevPageBtn) {
        prevPageBtn.onclick = () => {
            goToPage(getCurrentPage() - 1);
        };
    }
    if (nextPageBtn) {
        nextPageBtn.onclick = () => {
            goToPage(getCurrentPage() + 1);
        };
    }
    if (pageInput) {
        pageInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                goToPage(pageInput.value);
            }
        };
        pageInput.onblur = () => {
            goToPage(pageInput.value);
        };
    }

    renderVersionTable(historyVersions);

    modal.style.display = 'flex';

    const closeModal = () => {
        modal.style.display = 'none';
        // Cancel any in-flight "vs current" computations
        pageComputeToken += 1;
    };

    closeButton.onclick = closeModal;
    cancelButton.onclick = closeModal;

    strategyOverwriteRadio.onchange = () => {
        currentStrategy = 'overwrite';
        updateStrategyAvailabilityUi();
        updateMergeViewModeUi();
    };
    strategyMergeRadio.onchange = () => {
        currentStrategy = 'merge';
        updateStrategyAvailabilityUi();
        updateMergeViewModeUi();
    };

    const showRestoreConfirmModal = async ({ version, strategy, restoreRef, localPayload }) => {
        const confirmModal = document.getElementById('restoreConfirmModal');
        const confirmTitle = document.getElementById('restoreConfirmTitle');
        const confirmSummary = document.getElementById('restoreConfirmSummary');
        const confirmWarning = document.getElementById('restoreConfirmWarning');
        const confirmCancelBtn = document.getElementById('restoreConfirmCancelBtn');
        const confirmConfirmBtn = document.getElementById('restoreConfirmConfirmBtn');
        const confirmCloseBtn = document.getElementById('closeRestoreConfirmModal');

        // Views
        const mainView = document.getElementById('restoreConfirmMainView');
        const actionRow = document.getElementById('restoreConfirmActionRow');
        const previewView = document.getElementById('restorePreviewView');
        const previewContent = document.getElementById('restorePreviewContent');

        // Diff/Preview UI
        const diffBar = document.getElementById('restoreDiffBar');
        const diffSummary = document.getElementById('restoreDiffSummary');
        const previewBtn = document.getElementById('restorePreviewBtn');
        const importTargetBtn = document.getElementById('restoreImportTargetBtn');
        const importTargetHint = document.getElementById('restoreImportTargetHint');

        // Import target modal
        const importTargetModal = document.getElementById('importTargetModal');
        const importTargetList = document.getElementById('importTargetList');
        const importTargetCancelBtn = document.getElementById('importTargetCancelBtn');
        const importTargetAutoBtn = document.getElementById('importTargetAutoBtn');
        const importTargetConfirmBtn = document.getElementById('importTargetConfirmBtn');
        const importTargetCloseBtn = document.getElementById('closeImportTargetModal');
        const importTargetClearBtn = document.getElementById('clearImportTargetSelectionBtn');
        const importTargetTitle = document.getElementById('importTargetTitle');
        const importTargetDesc = document.getElementById('importTargetDesc');

        if (!confirmModal || !confirmTitle || !confirmSummary || !confirmWarning || !confirmCancelBtn || !confirmConfirmBtn || !confirmCloseBtn) {
            const lang = await getPreferredLang();
            const isEn = lang === 'en';
            return confirm(isEn ? 'Continue restore?' : '确定继续恢复吗？');
        }

        const resetBtn = (btn) => {
            if (!btn || !btn.parentNode) return btn;
            const next = btn.cloneNode(true);
            btn.parentNode.replaceChild(next, btn);
            return next;
        };

        // Reset action buttons (avoid duplicated listeners)
        const cancelBtn = resetBtn(confirmCancelBtn);
        const confirmBtn = resetBtn(confirmConfirmBtn);
        const closeBtn = resetBtn(confirmCloseBtn);

        // Reset diff/preview UI buttons (avoid duplicated listeners)
        const previewButton = resetBtn(previewBtn);
        const importTargetButton = resetBtn(importTargetBtn);
        const importTargetCancelButton = resetBtn(importTargetCancelBtn);
        const importTargetAutoButton = resetBtn(importTargetAutoBtn);
        const importTargetConfirmButton = resetBtn(importTargetConfirmBtn);
        const importTargetCloseButton = resetBtn(importTargetCloseBtn);
        const importTargetClearButton = resetBtn(importTargetClearBtn);

        // Re-query inner spans after cloning
        const previewBtnText = document.getElementById('restorePreviewBtnText');
        const importTargetBtnText = document.getElementById('restoreImportTargetBtnText');

        const lang = await getPreferredLang();
        const isEn = lang === 'en';
        const sourceLabel = source === 'webdav' ? 'WebDAV' : (source === 'github' ? 'GitHub' : (isEn ? 'Local' : '本地'));
        const fingerprint = String(version?.fingerprint || '').slice(0, 12);
        const fingerprintDisplay = fingerprint ? `#${fingerprint}` : '';
        const displayTime = String(version?.displayTime || '');
        const rawNote = String(version?.note || '').trim();
        const isHtml = isHtmlVersion(version);
        const fileName = String(version?.originalFile || version?.restoreRef?.originalFile || '').trim();
        const note = isHtml ? (fileName || rawNote || '') : rawNote;
        const versionTypeLabel = getVersionTypeLabel(lang, isHtml ? 'snapshot' : 'history');
        const strategyText = (() => {
            if (strategy === 'overwrite') return isEn ? 'Overwrite (Replace)' : '覆盖（替换）';
            return isEn ? 'Import Merge' : '导入合并';
        })();
        const importTypeKey = isHtml ? 'snapshot' : 'history';

        const titleForMain = () => {
            return isEn ? 'Confirm Restore' : '确认恢复';
        };

        const bindPreviewTreeToggle = (container) => {
            if (!container) return;
            const treeContainers = [];
            if (container.classList && container.classList.contains('history-tree-container')) {
                treeContainers.push(container);
            }
            container.querySelectorAll('.history-tree-container').forEach(el => {
                if (!treeContainers.includes(el)) treeContainers.push(el);
            });
            if (!treeContainers.length) return;

            const leafContainers = treeContainers.filter(el => {
                return !treeContainers.some(other => other !== el && el.contains(other));
            });

            leafContainers.forEach(treeContainer => {
                const existingHandler = treeContainer.__previewToggleHandler;
                if (existingHandler) {
                    treeContainer.removeEventListener('click', existingHandler);
                }

                const handler = (e) => {
                    const treeItem = e.target && e.target.closest ? e.target.closest('.tree-item') : null;
                    if (!treeItem || !treeContainer.contains(treeItem)) return;
                    if (e.target.closest && e.target.closest('a')) return;

                    const treeNode = treeItem.closest('.tree-node');
                    const children = treeNode ? treeNode.querySelector(':scope > .tree-children') : null;
                    const toggle = treeItem.querySelector(':scope > .tree-toggle:not([style*="opacity: 0"])');
                    if (!children || !toggle) return;

                    const isExpanding = !children.classList.contains('expanded');
                    children.classList.toggle('expanded');
                    toggle.classList.toggle('expanded');

                    const icon = treeItem.querySelector('.tree-icon.fa-folder, .tree-icon.fa-folder-open');
                    if (icon) {
                        if (isExpanding) {
                            icon.classList.remove('fa-folder');
                            icon.classList.add('fa-folder-open');
                        } else {
                            icon.classList.remove('fa-folder-open');
                            icon.classList.add('fa-folder');
                        }
                    }

                    if (isExpanding) {
                        try {
                            if (children.dataset && children.dataset.childrenLoaded === 'false') {
                                const lazyKey = treeContainer.dataset ? treeContainer.dataset.lazyKey : '';
                                const ctx = window.__popupHistoryTreeLazyContexts instanceof Map
                                    ? window.__popupHistoryTreeLazyContexts.get(String(lazyKey))
                                    : null;
                                if (ctx && typeof ctx.renderChildren === 'function') {
                                    const html = ctx.renderChildren(
                                        treeItem.dataset.nodeId,
                                        children.dataset.childLevel,
                                        children.dataset.nextForceInclude
                                    );
                                    children.innerHTML = html;
                                    children.dataset.childrenLoaded = 'true';
                                }
                            }
                        } catch (_) { }
                    }
                };

                treeContainer.addEventListener('click', handler);
                treeContainer.__previewToggleHandler = handler;
            });
        };

        const getImportTargetSelection = () => {
            return importTargetByType[importTypeKey] || null;
        };

        const setImportTargetSelection = (next) => {
            importTargetByType[importTypeKey] = next;
            updateImportTargetHint();
        };

        let pendingImportTargetSelection = null;
        const getPendingImportTargetSelection = () => pendingImportTargetSelection || null;

        const importTargetTreeCache = new Map(); // folderId -> { folders, stats }
        const importTargetTreeLoading = new Map(); // folderId -> Promise
        const importTargetPathCache = new Map(); // folderId -> fullPath

        const getFolderDisplayTitle = (node) => {
            const rawTitle = String(node?.title || '').trim();
            return rawTitle || (isEn ? 'Untitled Folder' : '未命名文件夹');
        };

        const fetchBookmarkChildren = (parentId) => {
            return new Promise((resolve) => {
                try {
                    chrome.bookmarks.getChildren(String(parentId), (children) => {
                        if (chrome.runtime.lastError) {
                            resolve([]);
                            return;
                        }
                        resolve(Array.isArray(children) ? children : []);
                    });
                } catch (_) {
                    resolve([]);
                }
            });
        };

        const ensureImportTargetChildrenLoaded = async (folderId) => {
            const key = String(folderId);
            if (importTargetTreeCache.has(key)) {
                return importTargetTreeCache.get(key);
            }

            if (importTargetTreeLoading.has(key)) {
                return await importTargetTreeLoading.get(key);
            }

            const task = (async () => {
                const allChildren = await fetchBookmarkChildren(key);
                const folderChildren = allChildren
                    .filter((node) => node && !node.url && String(node.id || '') !== '0')
                    .map((node, index) => ({
                        id: String(node.id),
                        title: getFolderDisplayTitle(node),
                        index: Number.isFinite(Number(node.index)) ? Number(node.index) : index
                    }));

                folderChildren.sort((a, b) => a.index - b.index);

                const stats = {
                    folderCount: folderChildren.length,
                    bookmarkCount: allChildren.filter((node) => node && !!node.url).length
                };

                const entry = {
                    folders: folderChildren,
                    stats
                };
                importTargetTreeCache.set(key, entry);
                return entry;
            })();

            importTargetTreeLoading.set(key, task);
            try {
                return await task;
            } finally {
                importTargetTreeLoading.delete(key);
            }
        };

        const getFolderStatsText = (folderId) => {
            const cached = importTargetTreeCache.get(String(folderId));
            if (!cached || !cached.stats) {
                return isEn ? 'F- · B-' : '夹- · 签-';
            }

            const folderCount = Number(cached.stats.folderCount || 0);
            const bookmarkCount = Number(cached.stats.bookmarkCount || 0);

            return isEn
                ? `F${folderCount} · B${bookmarkCount}`
                : `夹${folderCount} · 签${bookmarkCount}`;
        };

        const normalizePath = (parentPath, title) => {
            if (!parentPath) return title;
            return `${parentPath} / ${title}`;
        };

        const getNodePath = (nodeId, nodeTitle, parentPath = '') => {
            const key = String(nodeId);
            if (importTargetPathCache.has(key)) {
                return importTargetPathCache.get(key);
            }

            const path = normalizePath(parentPath, nodeTitle);
            importTargetPathCache.set(key, path);
            return path;
        };

        const prefetchImportTargetStats = (nodeId, metaEl) => {
            if (!metaEl || !nodeId) return;
            ensureImportTargetChildrenLoaded(nodeId)
                .then(() => {
                    if (!metaEl.isConnected) return;
                    metaEl.textContent = getFolderStatsText(nodeId);
                })
                .catch(() => {
                    if (!metaEl.isConnected) return;
                    metaEl.textContent = isEn ? 'F- · B-' : '夹- · 签-';
                });
        };

        const createImportTargetTreeNode = (node, level = 0, parentPath = '') => {
            const nodeId = String(node.id || '');
            const nodeTitle = getFolderDisplayTitle(node);
            const nodePath = getNodePath(nodeId, nodeTitle, parentPath);

            const nodeEl = document.createElement('div');
            nodeEl.className = 'import-target-tree-node';
            nodeEl.dataset.id = nodeId;
            nodeEl.dataset.title = nodeTitle;
            nodeEl.dataset.path = nodePath;
            nodeEl.dataset.level = String(level);

            const rowEl = document.createElement('div');
            rowEl.className = 'import-target-tree-row';
            rowEl.style.paddingLeft = `${8 + (level * 16)}px`;

            const selected = getPendingImportTargetSelection();
            if (selected && String(selected.id) === nodeId) {
                rowEl.classList.add('selected');
            }

            const toggleBtn = document.createElement('button');
            toggleBtn.type = 'button';
            toggleBtn.className = 'import-target-tree-toggle';
            toggleBtn.setAttribute('data-action', 'toggle');
            toggleBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';

            const iconEl = document.createElement('span');
            iconEl.className = 'import-target-tree-icon';
            iconEl.innerHTML = '<i class="fas fa-folder"></i>';

            const titleEl = document.createElement('span');
            titleEl.className = 'import-target-tree-title';
            titleEl.textContent = nodeTitle;

            const metaEl = document.createElement('span');
            metaEl.className = 'import-target-tree-meta';
            metaEl.textContent = getFolderStatsText(nodeId);
            prefetchImportTargetStats(nodeId, metaEl);

            const markEl = document.createElement('span');
            markEl.className = 'import-target-tree-selected-mark';
            markEl.innerHTML = selected && String(selected.id) === nodeId
                ? '<i class="fas fa-check"></i>'
                : '';

            rowEl.appendChild(toggleBtn);
            rowEl.appendChild(iconEl);
            rowEl.appendChild(titleEl);
            rowEl.appendChild(metaEl);
            rowEl.appendChild(markEl);

            const childrenEl = document.createElement('div');
            childrenEl.className = 'import-target-tree-children';
            childrenEl.hidden = true;

            nodeEl.appendChild(rowEl);
            nodeEl.appendChild(childrenEl);
            return nodeEl;
        };

        const setImportTargetListMessage = (message, type = 'normal') => {
            if (!importTargetList) return;
            const className = type === 'error'
                ? 'import-target-tree-empty error'
                : 'import-target-tree-empty';
            importTargetList.innerHTML = `<div class="${className}">${message}</div>`;
        };

        const renderRootImportTargetTree = async () => {
            if (!importTargetList) return;

            importTargetList.innerHTML = '';
            const rootEntry = await ensureImportTargetChildrenLoaded('0');
            const roots = Array.isArray(rootEntry?.folders) ? rootEntry.folders : [];

            if (!roots.length) {
                setImportTargetListMessage(
                    isEn ? 'No folders found in bookmarks.' : '未找到可用的书签文件夹。',
                    'error'
                );
                return;
            }

            const fragment = document.createDocumentFragment();
            roots.forEach((node) => {
                fragment.appendChild(createImportTargetTreeNode(node, 0, ''));
            });
            importTargetList.appendChild(fragment);
        };

        const markSelectedImportTargetRows = () => {
            if (!importTargetList) return;
            const selected = getPendingImportTargetSelection();
            const selectedId = selected ? String(selected.id) : '';

            importTargetList.querySelectorAll('.import-target-tree-row').forEach((row) => {
                const nodeEl = row.closest('.import-target-tree-node');
                const nodeId = nodeEl ? String(nodeEl.dataset.id || '') : '';
                const markEl = row.querySelector('.import-target-tree-selected-mark');
                const isSelected = selectedId && nodeId === selectedId;

                row.classList.toggle('selected', !!isSelected);
                if (markEl) {
                    markEl.innerHTML = isSelected ? '<i class="fas fa-check"></i>' : '';
                }
            });
        };

        const expandImportTargetNode = async (nodeEl) => {
            if (!nodeEl) return;
            const childrenEl = nodeEl.querySelector(':scope > .import-target-tree-children');
            const toggleIcon = nodeEl.querySelector(':scope > .import-target-tree-row .import-target-tree-toggle i');
            const rowMeta = nodeEl.querySelector(':scope > .import-target-tree-row .import-target-tree-meta');
            if (!childrenEl) return;

            const shouldExpand = childrenEl.hidden;
            childrenEl.hidden = !shouldExpand;
            if (toggleIcon) {
                toggleIcon.className = shouldExpand ? 'fas fa-chevron-down' : 'fas fa-chevron-right';
            }
            if (!shouldExpand) return;

            if (childrenEl.dataset.loaded === 'true') return;

            childrenEl.innerHTML = `<div class="import-target-tree-loading">${isEn ? 'Loading folders...' : '正在加载子文件夹...'}</div>`;

            const nodeId = String(nodeEl.dataset.id || '');
            const level = Number(nodeEl.dataset.level || 0);
            const nodePath = String(nodeEl.dataset.path || nodeEl.dataset.title || '');

            const entry = await ensureImportTargetChildrenLoaded(nodeId);
            if (rowMeta) {
                rowMeta.textContent = getFolderStatsText(nodeId);
            }

            const folders = Array.isArray(entry?.folders) ? entry.folders : [];
            if (!folders.length) {
                childrenEl.innerHTML = `<div class="import-target-tree-empty">${isEn ? 'No subfolders' : '没有子文件夹'}</div>`;
                childrenEl.dataset.loaded = 'true';
                return;
            }

            const fragment = document.createDocumentFragment();
            folders.forEach((child) => {
                fragment.appendChild(createImportTargetTreeNode(child, level + 1, nodePath));
            });

            childrenEl.innerHTML = '';
            childrenEl.appendChild(fragment);
            childrenEl.dataset.loaded = 'true';
            markSelectedImportTargetRows();
        };

        const updateImportTargetHint = () => {
            if (!importTargetHint) return;
            if (strategy !== 'merge') {
                importTargetHint.style.display = 'none';
                return;
            }
            const sel = getImportTargetSelection();
            const text = sel
                ? (isEn ? `Import to: ${sel.path || sel.title}` : `导入位置：${sel.path || sel.title}`)
                : (isEn ? 'Import to: Auto' : '导入位置：自动');
            importTargetHint.textContent = text;
            importTargetHint.style.display = 'block';
        };

        const openImportTargetModal = async () => {
            if (!importTargetModal || !importTargetList) return;

            importTargetTreeCache.clear();
            importTargetTreeLoading.clear();
            importTargetPathCache.clear();
            const currentImportTargetSelection = getImportTargetSelection();
            pendingImportTargetSelection = currentImportTargetSelection
                ? { ...currentImportTargetSelection }
                : null;
            if (importTargetTitle) importTargetTitle.textContent = isEn ? 'Select Import Location' : '选择导入位置';
            if (importTargetDesc) {
                importTargetDesc.textContent = isEn
                    ? 'Browse any folder. Subfolders load when expanded.'
                    : '可选择任意文件夹作为导入位置，子文件夹按展开加载。';
            }
            if (importTargetAutoButton) {
                importTargetAutoButton.textContent = isEn ? 'Auto' : '自动选择';
            }
            if (importTargetConfirmButton) {
                importTargetConfirmButton.textContent = isEn ? 'Confirm Selection' : '确认选择';
            }
            if (importTargetCancelButton) {
                importTargetCancelButton.textContent = isEn ? 'Cancel' : '取消';
            }
            if (importTargetClearButton) {
                const clearLabel = isEn ? 'Clear selection' : '清除选择';
                importTargetClearButton.title = clearLabel;
                importTargetClearButton.setAttribute('aria-label', clearLabel);
            }

            importTargetModal.style.display = 'flex';
            setImportTargetListMessage(isEn ? 'Loading folders...' : '正在加载文件夹...');

            importTargetList.onclick = async (event) => {
                const toggleBtn = event.target?.closest?.('.import-target-tree-toggle');
                const row = event.target?.closest?.('.import-target-tree-row');
                const nodeEl = event.target?.closest?.('.import-target-tree-node');
                if (!nodeEl || !importTargetList.contains(nodeEl)) return;

                if (toggleBtn) {
                    await expandImportTargetNode(nodeEl);
                    return;
                }

                if (row) {
                    const id = String(nodeEl.dataset.id || '');
                    const title = String(nodeEl.dataset.title || id);
                    const path = String(nodeEl.dataset.path || title);
                    if (id) {
                        pendingImportTargetSelection = { id, title, path };
                        markSelectedImportTargetRows();
                    }
                }
            };

            try {
                await renderRootImportTargetTree();
                markSelectedImportTargetRows();
            } catch (_) {
                setImportTargetListMessage(
                    isEn ? 'Failed to load folders.' : '加载文件夹失败。',
                    'error'
                );
            }
        };

        // Initial view state
        let isInPreview = false;
        if (mainView) mainView.style.display = 'block';
        if (previewView) previewView.style.display = 'none';
        if (previewContent) previewContent.innerHTML = '';
        if (actionRow) actionRow.style.display = '';
        confirmTitle.textContent = titleForMain();
        if (importTargetModal) importTargetModal.style.display = 'none';

        // Compact summary (grid)
        const colon = isEn ? ':' : '：';
        const rows = [
            { key: isEn ? 'Source' : '来源', val: sourceLabel },
            { key: isEn ? 'Type' : '类型', val: versionTypeLabel },
            { key: isEn ? 'Time' : '时间', val: displayTime || '-', mono: true },
            { key: isEn ? 'Note' : '备注', val: note || '-' }
        ];

        if (strategy === 'merge' && !isHtml) {
            const mergeMode = getSelectedMergeViewMode();
            const mergeModeText = mergeMode === 'detailed'
                ? (isEn ? 'Detailed' : '详细')
                : (isEn ? 'Simple' : '简略');
            rows.push({ key: isEn ? 'View' : '视图', val: mergeModeText });
        }

        if (strategy === 'overwrite' && !isHtml) {
            rows.push({ key: isEn ? 'Hash' : '哈希', val: fingerprintDisplay || '-', mono: true });
        }

        rows.push({ key: isEn ? 'Strategy' : '方式', val: strategyText });

        confirmSummary.innerHTML = `<div class="restore-confirm-summary-grid">${rows.map((r) => {
            const key = escapeHtml(r.key);
            const val = escapeHtml(r.val);
            const cls = r.mono ? 'restore-confirm-summary-val mono' : 'restore-confirm-summary-val';
            return `<div class="restore-confirm-summary-key">${key}${colon}</div><div class="${cls}">${val}</div>`;
        }).join('')}</div>`;

        // Warning + main confirm button style (match history.html)
        confirmWarning.classList.remove('danger', 'info', 'warning');
        confirmBtn.classList.remove('danger', 'primary');

        if (strategy === 'overwrite') {
            confirmWarning.classList.add('warning');
            confirmBtn.classList.add('primary');
            confirmWarning.textContent = isEn
                ? 'Overwrite Restore deletes current bookmarks, then rebuilds from the target snapshot. Bookmark IDs will change and may affect features like Records/Recommendations.'
                : '覆盖恢复会先删除当前书签，再按目标快照重建。Bookmark ID 会变化，可能影响书签记录、书签推荐等功能。';
        } else {
            confirmWarning.classList.add('info');
            confirmBtn.classList.add('primary');
            if (!isHtml) {
                confirmWarning.textContent = isEn
                    ? 'Import merge: imports this record’s “changes view” into a new folder under bookmark roots (no deletion; titles prefixed with [+]/[-]/[~]/[↔]).'
                    : '导入合并：导入该记录的「差异视图」到书签树的新文件夹（不删除现有书签；标题带 [+]/[-]/[~]/[↔] 前缀）。';
            } else {
                confirmWarning.textContent = isEn
                    ? 'Import merge: imports the snapshot into a new folder under bookmark roots (no deletion).'
                    : '导入合并：导入该版本快照到书签树的新文件夹（不删除现有书签）。';
            }
        }

        // Texts
        cancelBtn.textContent = isEn ? 'Cancel' : '取消';
        confirmBtn.textContent = isEn ? 'Confirm Restore' : '确认恢复';

        if (previewBtnText) previewBtnText.textContent = isEn ? 'Preview' : '预览';
        if (importTargetBtnText) importTargetBtnText.textContent = isEn ? 'Import Target' : '导入位置';
        const isOverwritePreview = (strategy === 'overwrite');
        const isMergePreview = (strategy === 'merge');
        const isMergeHistorySource = isMergePreview && !isHtml && (restoreRef?.sourceType === 'json' || restoreRef?.sourceType === 'zip');

        let overwritePreviewCache = null; // { diffSummary, currentTree, targetTree, changeEntries }

        const showMainView = () => {
            isInPreview = false;
            if (mainView) mainView.style.display = 'block';
            if (previewView) previewView.style.display = 'none';
            if (previewContent) {
                previewContent.innerHTML = '';
                previewContent.removeAttribute('data-loaded');
            }
            confirmTitle.textContent = titleForMain();
        };

        const showPreviewView = async () => {
            if (!previewView || !mainView || !previewContent) return;

            isInPreview = true;
            mainView.style.display = 'none';
            previewView.style.display = 'flex';
            confirmTitle.textContent = isEn ? 'Preview' : '预览';

            const loadingText = isMergeHistorySource
                ? (isEn ? 'Generating import preview...' : '正在生成导入预览...')
                : (isEn ? 'Generating detailed preview...' : '正在生成详细预览...');

            previewContent.innerHTML = `<div class="loading" style="padding: 40px; color: var(--text-secondary); text-align: center;">
                <i class="fas fa-spinner fa-spin" style="font-size: 24px; margin-bottom: 20px; opacity: 0.5;"></i><br>
                ${loadingText}
            </div>`;

            // Import-merge preview (history sources: json/zip)
            if (isMergeHistorySource) {
                try {
                    const res = await callBackgroundFunction('buildMergeRestorePreview', {
                        restoreRef,
                        localPayload,
                        mergeViewMode: getSelectedMergeViewMode()
                    });

                    if (!res || res.success !== true) {
                        previewContent.innerHTML = `<div style="padding: 20px; color: var(--warning);">${isEn ? 'Preview failed: ' : '预览失败：'}${escapeHtml(res?.error || 'Unknown error')}</div>`;
                        return;
                    }

                    const vm = res.viewMode === 'detailed' ? 'detailed' : 'simple';
                    const customTitle = isEn
                        ? `Import Merge Preview (${vm === 'detailed' ? 'Detailed' : 'Simple'})`
                        : `导入合并预览（${vm === 'detailed' ? '详细' : '简略'}）`;

                    const treeHtml = generateImportMergePreviewTreeHtml(res.tree, {
                        maxDepth: 2,
                        customTitle
                    }, lang);

                    previewContent.innerHTML = treeHtml || `<div style="padding: 20px; color: var(--text-tertiary); text-align: center;">No Data</div>`;
                    previewContent.setAttribute('data-loaded', 'true');
                    bindPreviewTreeToggle(previewContent);
                    return;
                } catch (err) {
                    previewContent.innerHTML = `<div style="padding: 20px; color: var(--warning);">Error: ${escapeHtml(err?.message || 'Unknown error')}</div>`;
                    return;
                }
            }

            // Overwrite (and non-history merge snapshot) preview: render restored tree with change badges
            try {
                let res = overwritePreviewCache;
                if (!res) {
                    res = await callBackgroundFunction('buildOverwriteRestorePreview', {
                        restoreRef,
                        localPayload
                    });
                }

                if (!res || res.success !== true) {
                    previewContent.innerHTML = `<div style="padding: 20px; color: var(--warning);">${isEn ? 'Preview failed: ' : '预览失败：'}${escapeHtml(res?.error || 'Unknown error')}</div>`;
                    return;
                }

                const rawChangeMap = new Map(Array.isArray(res.changeEntries) ? res.changeEntries : []);
                const changeMap = isOverwritePreview
                    ? convertChangeMapToAddDeleteOnly(rawChangeMap)
                    : rawChangeMap;
                let treeToRender = res.targetTree;

                let hasDeleted = false;
                for (const [, change] of changeMap.entries()) {
                    if (change && typeof change.type === 'string' && change.type.includes('deleted')) {
                        hasDeleted = true;
                        break;
                    }
                }

                if (hasDeleted) {
                    try {
                        treeToRender = rebuildTreeWithDeleted(res.currentTree, res.targetTree, changeMap);
                    } catch (_) {
                        treeToRender = res.targetTree;
                    }
                }

                const previewKey = `restore-preview-${Date.now()}`;
                const treeHtml = generateHistoryTreeHtml(treeToRender, changeMap, 'detailed', {
                    maxDepth: 1,
                    lazyDepth: 1,
                    lazyKey: previewKey,
                    customTitle: isEn ? 'Restored Bookmark Tree (Temporary Cache)' : '恢复后的书签树（临时缓存）'
                }, lang);

                const bodyHtml = treeHtml || `<div style="padding: 20px; color: var(--text-tertiary); text-align: center;">No Data</div>`;
                previewContent.innerHTML = bodyHtml;
                previewContent.setAttribute('data-loaded', 'true');
                bindPreviewTreeToggle(previewContent);
            } catch (err) {
                previewContent.innerHTML = `<div style="padding: 20px; color: var(--warning);">Error: ${escapeHtml(err?.message || 'Unknown error')}</div>`;
            }
        };

        const renderCurrentDiffSummaryHtml = (diffSummaryObj) => {
            if (!diffSummary) return;

            const rawDs = diffSummaryObj || {};
            const ds = isOverwritePreview
                ? normalizeOverwriteDiffSummaryForDisplay(rawDs)
                : rawDs;
            const changes = {
                bookmarkAdded: ds.bookmarkAdded || 0,
                bookmarkDeleted: ds.bookmarkDeleted || 0,
                folderAdded: ds.folderAdded || 0,
                folderDeleted: ds.folderDeleted || 0,
                bookmarkMoved: !!ds.bookmarkMoved,
                folderMoved: !!ds.folderMoved,
                bookmarkModified: !!ds.bookmarkModified,
                folderModified: !!ds.folderModified,
                bookmarkMovedCount: ds.movedBookmarkCount || 0,
                folderMovedCount: ds.movedFolderCount || 0,
                bookmarkModifiedCount: ds.modifiedBookmarkCount || 0,
                folderModifiedCount: ds.modifiedFolderCount || 0,
                hasNumericalChange: ((ds.bookmarkAdded || 0) > 0 || (ds.bookmarkDeleted || 0) > 0 || (ds.folderAdded || 0) > 0 || (ds.folderDeleted || 0) > 0),
                hasStructuralChange: (!!ds.bookmarkMoved || !!ds.folderMoved || !!ds.bookmarkModified || !!ds.folderModified),
                hasNoChange: false,
                isRestoreHiddenStats: false,
                isFirst: false
            };
            changes.hasNoChange = !changes.hasNumericalChange && !changes.hasStructuralChange;

            if (changes.hasNoChange) {
                diffSummary.innerHTML = `<span style="color: var(--text-tertiary);"><i class="fas fa-check-circle"></i> ${isEn ? 'Identical quantity & structure' : '数量与结构一致'}</span>`;
                return;
            }

            const prefix = isEn ? 'Different from current: ' : '相较当前: ';
            const html = renderCommitStatsInline(changes, lang);
            diffSummary.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: flex-start; gap: 8px; flex-wrap: wrap;">
                    <span style="font-size: 13px; color: var(--text-secondary);">${prefix}</span>
                    ${html}
                </div>
            `;
        };

        const renderMergeDiffSummaryHtml = () => {
            if (!diffSummary) return;

            const s = (version && version.stats) ? version.stats : {};

            const bookmarkAdded = Number(s.bookmarkAdded || 0);
            const bookmarkDeleted = Number(s.bookmarkDeleted || 0);
            const folderAdded = Number(s.folderAdded || 0);
            const folderDeleted = Number(s.folderDeleted || 0);
            const movedTotal = Number(s.movedCount || 0);
            const modifiedTotal = Number(s.modifiedCount || 0);

            const hasNumericalChange = bookmarkAdded > 0 || bookmarkDeleted > 0 || folderAdded > 0 || folderDeleted > 0;
            const hasStructuralChange = movedTotal > 0 || modifiedTotal > 0;
            const hasNoChange = !hasNumericalChange && !hasStructuralChange;

            if (hasNoChange) {
                diffSummary.innerHTML = `<span style="color: var(--text-tertiary);"><i class="fas fa-check-circle"></i> ${isEn ? 'No changes' : '无变化'}</span>`;
                return;
            }

            const changes = {
                bookmarkAdded,
                bookmarkDeleted,
                folderAdded,
                folderDeleted,
                bookmarkMoved: movedTotal > 0,
                folderMoved: false,
                bookmarkModified: modifiedTotal > 0,
                folderModified: false,
                bookmarkMovedCount: movedTotal,
                folderMovedCount: 0,
                bookmarkModifiedCount: modifiedTotal,
                folderModifiedCount: 0,
                hasNumericalChange,
                hasStructuralChange,
                hasNoChange,
                isFirst: false,
                isRestoreHiddenStats: false
            };

            const prefix = isEn ? 'Different from previous: ' : '相较上一条: ';
            const html = renderCommitStatsInline(changes, lang);

            diffSummary.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: flex-start; gap: 8px; flex-wrap: wrap;">
                    <span style="font-size: 13px; color: var(--text-secondary);">${prefix}</span>
                    ${html}
                </div>
            `;
        };

        const runOverwritePreflight = async () => {
            if (!isOverwritePreview) return;
            if (!diffBar || !diffSummary) return;
            if (!restoreRef) {
                diffBar.style.display = 'flex';
                diffSummary.innerHTML = `<span style="color: var(--warning);">${isEn ? 'Preflight unavailable: missing restore reference.' : '预演不可用：缺少恢复引用信息。'}</span>`;
                return;
            }

            diffBar.style.display = 'flex';
            diffSummary.textContent = isEn ? 'Computing diff...' : '正在计算差异...';

            // overwrite has no ambiguity, keep confirm enabled
            confirmBtn.disabled = false;

            try {
                const res = await callBackgroundFunction('buildOverwriteRestorePreview', {
                    restoreRef,
                    localPayload
                });

                if (!res || res.success !== true) {
                    diffSummary.innerHTML = `<span style="color: var(--warning);">${isEn ? 'Preflight failed: ' : '预演失败：'}${escapeHtml(res?.error || 'Unknown error')}</span>`;
                    return;
                }

                overwritePreviewCache = res;
                renderCurrentDiffSummaryHtml(res.diffSummary);

                if (previewButton) previewButton.style.display = 'inline-flex';
            } catch (e) {
                diffSummary.innerHTML = `<span style="color: var(--warning);">${isEn ? 'Preflight error: ' : '预演错误：'}${escapeHtml(e?.message || 'Unknown error')}</span>`;
            }
        };

        // Init / reset UI
        const shouldShowDiffBar = isOverwritePreview || isMergePreview;
        if (diffBar) diffBar.style.display = shouldShowDiffBar ? 'flex' : 'none';

        if (diffSummary) {
            if (isOverwritePreview) {
                diffSummary.textContent = isEn ? 'Computing diff...' : '正在计算差异...';
            } else if (isMergePreview) {
                // filled below
                diffSummary.textContent = '';
            } else {
                diffSummary.textContent = '';
            }
        }

        if (previewButton) {
            // Patch/overwrite: show after preflight; merge: show immediately.
            previewButton.style.display = isMergePreview ? 'inline-flex' : 'none';
        }

        if (importTargetButton) {
            importTargetButton.style.display = isMergePreview ? 'inline-flex' : 'none';
        }
        updateImportTargetHint();

        if (isMergePreview) {
            renderMergeDiffSummaryHtml();
        }

        if (previewButton) {
            previewButton.addEventListener('click', () => {
                showPreviewView().catch(() => { });
            });
        }
        if (importTargetButton) {
            importTargetButton.addEventListener('click', () => {
                openImportTargetModal().catch(() => { });
            });
        }
        if (importTargetCancelButton) {
            importTargetCancelButton.addEventListener('click', () => {
                if (importTargetModal) importTargetModal.style.display = 'none';
            });
        }
        if (importTargetCloseButton) {
            importTargetCloseButton.addEventListener('click', () => {
                if (importTargetModal) importTargetModal.style.display = 'none';
            });
        }
        if (importTargetClearButton) {
            importTargetClearButton.addEventListener('click', () => {
                pendingImportTargetSelection = null;
                markSelectedImportTargetRows();
            });
        }
        if (importTargetAutoButton) {
            importTargetAutoButton.addEventListener('click', () => {
                pendingImportTargetSelection = null;
                markSelectedImportTargetRows();
            });
        }
        if (importTargetConfirmButton) {
            importTargetConfirmButton.addEventListener('click', () => {
                setImportTargetSelection(pendingImportTargetSelection ? { ...pendingImportTargetSelection } : null);
                if (importTargetModal) importTargetModal.style.display = 'none';
            });
        }

        confirmBtn.disabled = false;

        confirmModal.style.display = 'flex';

        if (isOverwritePreview) {
            runOverwritePreflight().catch(() => { });
        }

        return await new Promise((resolve) => {
            const cleanup = () => {
                confirmModal.style.display = 'none';
                showMainView();
            };

            const onCancel = () => {
                cleanup();
                if (importTargetModal) importTargetModal.style.display = 'none';
                resolve(false);
            };

            const onConfirm = () => {
                cleanup();
                if (importTargetModal) importTargetModal.style.display = 'none';
                resolve(true);
            };

            cancelBtn.addEventListener('click', onCancel);
            confirmBtn.addEventListener('click', onConfirm);
            closeBtn.addEventListener('click', () => {
                if (isInPreview) {
                    showMainView();
                    return;
                }
                onCancel();
            });
        });
    };

    confirmButton.onclick = async () => {
        const strategy = (strategyMergeRadio && strategyMergeRadio.checked) ? 'merge' : 'overwrite';
        let restoringTextTimer = null;

        try {
            if (!selectedVersion || !selectedVersion.restoreRef) {
                throw new Error('No version selected');
            }
            if (selectedVersion.canRestore === false) {
                throw new Error('This version requires manual import (HTML snapshot)');
            }

            const restoreRef = selectedVersion.restoreRef;
            let localPayload = null;
            if (restoreRef?.source === 'local') {
                const fileKey = restoreRef.localFileKey;
                const fileObj = fileKey ? localRestoreFileMap.get(fileKey) : null;
                if (!fileObj) {
                    throw new Error('Local file handle expired. Please reselect the folder.');
                }
                if (restoreRef.sourceType === 'zip') {
                    const arrayBuffer = await fileObj.arrayBuffer();
                    localPayload = { arrayBuffer };
                } else if (restoreRef.sourceType === 'json') {
                    const text = await fileObj.text();
                    localPayload = { text };
                } else if (restoreRef.sourceType === 'html') {
                    const text = await fileObj.text();
                    localPayload = { text };
                }
            }

            // 二级确认：弹窗确认，再执行恢复
            const ok = await showRestoreConfirmModal({
                version: selectedVersion,
                strategy,
                restoreRef,
                localPayload
            });

            if (!ok) {
                return;
            }

            // 执行恢复：锁定按钮
            confirmButton.disabled = true;
            strategyOverwriteRadio.disabled = true;
            strategyMergeRadio.disabled = true;
            strategyGroup.classList.add('disabled');
            closeButton.disabled = true;
            cancelButton.disabled = true;
            const lang = await getPreferredLang();
            const isEn = lang === 'en';
            const restoringBaseText = isEn ? 'Restoring...' : '恢复中...';
            const restoreStartedAt = Date.now();
            const refreshRestoringText = () => {
                const elapsedSeconds = Math.max(1, Math.floor((Date.now() - restoreStartedAt) / 1000));
                confirmButton.textContent = `${restoringBaseText} ${elapsedSeconds}s`;
            };
            refreshRestoringText();
            restoringTextTimer = setInterval(refreshRestoringText, 1000);

            const restorePayload = { restoreRef, strategy, localPayload };
            if (strategy === 'merge') {
                restorePayload.mergeViewMode = getSelectedMergeViewMode();
                const importTypeKey = isHtmlVersion(selectedVersion) ? 'snapshot' : 'history';
                const sel = importTargetByType[importTypeKey];
                if (sel && sel.id) {
                    restorePayload.importParentId = String(sel.id);
                }
            }

            const restoreRes = await callBackgroundFunction('restoreSelectedVersion', restorePayload);

            if (restoreRes?.success) {
                const lang = await getPreferredLang();
                const isEn = lang === 'en';

                const msg = (() => {
                    if (strategy === 'overwrite') {
                        return isEn
                            ? `SUCCESS: Restored (overwrite). Created ${restoreRes.created || 0} nodes.`
                            : `成功：已恢复（覆盖）。创建 ${restoreRes.created || 0} 个节点。`;
                    }

                    return isEn
                        ? `SUCCESS: Import merge completed. Created ${restoreRes.created || 0} nodes under “${restoreRes.importedFolderTitle || 'Imported'}”.`
                        : `成功：导入合并完成。在“${restoreRes.importedFolderTitle || '导入'}”下创建 ${restoreRes.created || 0} 个节点。`;
                })();
                alert(msg);
                closeModal();

                // Restore should be recorded as a backup (create a restore record in history)
                try {
                    const seqNumber = selectedVersion?.seqNumber;
                    const displayTime = selectedVersion?.displayTime || '';
                    const restoreTime = selectedVersion?.recordTime || selectedVersion?.restoreRef?.recordTime || '';
                    const restoreNote = isEn
                        ? `Restored to #${seqNumber || '-'} (${displayTime || '-'})`
                        : `恢复至 #${seqNumber || '-'} (${displayTime || '-'})`;

                    chrome.runtime.sendMessage({
                        action: 'triggerRestoreBackup',
                        note: restoreNote,
                        sourceSeqNumber: seqNumber,
                        sourceTime: restoreTime,
                        sourceNote: selectedVersion?.note || '',
                        sourceFingerprint: selectedVersion?.fingerprint || '',
                        strategy
                    }, (backupResult) => {
                        // 优先在恢复后立刻拉起一次刷新；若后台稍后写入，storage 监听会再补一轮。
                        schedulePopupHistoryRefresh(80);

                        // 若后台同步记录尚未完成，再追加一次兜底刷新，减少用户“手动刷新”需求。
                        if (!backupResult || backupResult.success !== true) {
                            schedulePopupHistoryRefresh(480);
                        }
                    });
                } catch (_) { }

                // Restore is equivalent to “first backup”: enter main UI without extra initialization
                try {
                    await new Promise(resolve => chrome.storage.local.set({ initialized: true }, resolve));
                } catch (_) { }

                try {
                    const initHeader = document.getElementById('initHeader');
                    const initContent = document.getElementById('initContent');
                    if (initHeader && initContent) {
                        initContent.style.display = 'none';
                        initHeader.classList.add('collapsed');
                    }

                    const syncStatusDiv = document.getElementById('syncStatus');
                    if (syncStatusDiv) {
                        syncStatusDiv.style.display = 'block';
                    }

                    const manualSyncOptions = document.getElementById('manualSyncOptions');
                    if (manualSyncOptions) {
                        chrome.storage.local.get(['autoSync'], function (autoSyncData) {
                            const autoSyncEnabled = autoSyncData.autoSync !== false;
                            manualSyncOptions.style.display = autoSyncEnabled ? 'none' : 'block';
                        });
                    }

                    schedulePopupHistoryRefresh(60);

                    setTimeout(() => {
                        try {
                            scrollToPositionA('smooth');
                        } catch (_) { }
                    }, 50);
                } catch (_) { }
            } else {
                alert(`Failed: ${restoreRes?.error || 'Unknown error'}`);
            }
        } catch (e) {
            alert(`Error: ${e.message}`);
        } finally {
            if (restoringTextTimer) {
                clearInterval(restoringTextTimer);
                restoringTextTimer = null;
            }
            confirmButton.disabled = false;
            strategyOverwriteRadio.disabled = selectedVersion?.canRestore === false;
            strategyMergeRadio.disabled = selectedVersion?.canRestore === false;
            strategyGroup.classList.toggle('disabled', selectedVersion?.canRestore === false);
            closeButton.disabled = false;
            cancelButton.disabled = false;
            try {
                const lang = await getPreferredLang();
                const isEn = lang === 'en';
                confirmButton.textContent = isEn ? 'Restore' : '恢复';
            } catch (_) {
                confirmButton.textContent = 'Restore';
            }
        }
    };
}

// =============================================================================
// Restore Patch Preview helpers (ported from history_html/history.js)
// =============================================================================

function renderCommitStatsInline(changes, lang = 'zh_CN') {
    const isZh = lang === 'zh_CN';

    if (!changes || typeof changes !== 'object') return '';

    if (changes.isRestoreHiddenStats) {
        return '';
    }

    if (changes.isFirst) {
        return `<span class="stat-badge first">${isZh ? '首次备份' : 'First Backup'}</span>`;
    }

    if (changes.hasNoChange) {
        return `
            <span class="stat-badge no-change">
                <i class="fas fa-check-circle" style="color: var(--success);"></i>
                ${isZh ? '无变化' : 'No Changes'}
            </span>
        `;
    }

    const statItems = [];

    // Added
    if ((changes.bookmarkAdded || 0) > 0 || (changes.folderAdded || 0) > 0) {
        const parts = [];
        if ((changes.bookmarkAdded || 0) > 0) {
            const label = isZh ? '书签' : 'BKM';
            parts.push(`<span class="stat-label">${label}</span> <span class="stat-color added">+${Number(changes.bookmarkAdded || 0)}</span>`);
        }
        if ((changes.folderAdded || 0) > 0) {
            const label = isZh ? '文件夹' : 'FLD';
            parts.push(`<span class="stat-label">${label}</span> <span class="stat-color added">+${Number(changes.folderAdded || 0)}</span>`);
        }
        if (parts.length) statItems.push(parts.join(' '));
    }

    // Deleted
    if ((changes.bookmarkDeleted || 0) > 0 || (changes.folderDeleted || 0) > 0) {
        const parts = [];
        if ((changes.bookmarkDeleted || 0) > 0) {
            const label = isZh ? '书签' : 'BKM';
            parts.push(`<span class="stat-label">${label}</span> <span class="stat-color deleted">-${Number(changes.bookmarkDeleted || 0)}</span>`);
        }
        if ((changes.folderDeleted || 0) > 0) {
            const label = isZh ? '文件夹' : 'FLD';
            parts.push(`<span class="stat-label">${label}</span> <span class="stat-color deleted">-${Number(changes.folderDeleted || 0)}</span>`);
        }
        if (parts.length) statItems.push(parts.join(' '));
    }

    // Moved
    if (changes.bookmarkMoved || changes.folderMoved) {
        const movedTotal = Number(changes.bookmarkMovedCount || 0) + Number(changes.folderMovedCount || 0);
        const label = isZh ? '移动' : 'Moved';
        statItems.push(movedTotal > 0
            ? `<span class="stat-label">${label}</span> <span class="stat-color moved">${movedTotal}</span>`
            : `<span class="stat-color moved">${label}</span>`);
    }

    // Modified
    if (changes.bookmarkModified || changes.folderModified) {
        const modifiedTotal = Number(changes.bookmarkModifiedCount || 0) + Number(changes.folderModifiedCount || 0);
        const label = isZh ? '修改' : 'Modified';
        statItems.push(modifiedTotal > 0
            ? `<span class="stat-label">${label}</span> <span class="stat-color modified">${modifiedTotal}</span>`
            : `<span class="stat-color modified">${label}</span>`);
    }

    if (!statItems.length) {
        return `<span class="stat-badge no-change">${isZh ? '无变化' : 'No Changes'}</span>`;
    }

    const separator = ' <span style="color:var(--text-tertiary);margin:0 4px;">|</span> ';
    return `<span class="stat-badge quantity">${statItems.join(separator)}</span>`;
}

function normalizeOverwriteDiffSummaryForDisplay(diffSummary) {
    const ds = (diffSummary && typeof diffSummary === 'object') ? diffSummary : {};

    const movedBookmarkCount = Number(ds.movedBookmarkCount || 0);
    const movedFolderCount = Number(ds.movedFolderCount || 0);
    const modifiedBookmarkCount = Number(ds.modifiedBookmarkCount || 0);
    const modifiedFolderCount = Number(ds.modifiedFolderCount || 0);

    const structuralBookmarkDelta = movedBookmarkCount + modifiedBookmarkCount;
    const structuralFolderDelta = movedFolderCount + modifiedFolderCount;

    return {
        ...ds,
        bookmarkAdded: Number(ds.bookmarkAdded || 0) + structuralBookmarkDelta,
        bookmarkDeleted: Number(ds.bookmarkDeleted || 0) + structuralBookmarkDelta,
        folderAdded: Number(ds.folderAdded || 0) + structuralFolderDelta,
        folderDeleted: Number(ds.folderDeleted || 0) + structuralFolderDelta,
        bookmarkMoved: false,
        folderMoved: false,
        bookmarkModified: false,
        folderModified: false,
        movedBookmarkCount: 0,
        movedFolderCount: 0,
        modifiedBookmarkCount: 0,
        modifiedFolderCount: 0
    };
}

function convertChangeMapToAddDeleteOnly(changeMap) {
    if (!(changeMap instanceof Map)) return new Map();

    const normalized = new Map();
    changeMap.forEach((change, id) => {
        if (!change || typeof change.type !== 'string') return;

        const sourceTypes = change.type.split('+').filter(Boolean);
        const isAmbiguous = sourceTypes.includes('ambiguous');
        const hasAdded = sourceTypes.includes('added') || sourceTypes.includes('modified') || sourceTypes.includes('moved');
        const hasDeleted = sourceTypes.includes('deleted') || sourceTypes.includes('modified') || sourceTypes.includes('moved');

        if (!hasAdded && !hasDeleted && !isAmbiguous) return;

        const nextTypes = [];
        if (hasAdded) nextTypes.push('added');
        if (hasDeleted) nextTypes.push('deleted');
        if (isAmbiguous && nextTypes.length === 0) nextTypes.push('ambiguous');

        if (nextTypes.length === 0) return;

        const nextChange = { ...change, type: nextTypes.join('+') };
        delete nextChange.moved;
        delete nextChange.modified;
        normalized.set(id, nextChange);
    });

    return normalized;
}

function breadcrumbToSlashFolders(bc) {
    if (!bc) return '';
    const parts = String(bc).split(' > ').map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) return '';
    if (parts.length > 1) parts.pop();
    else return '/';
    return '/' + parts.join('/');
}

function slashPathToChipsHTML(slashPath) {
    try {
        if (!slashPath || typeof slashPath !== 'string') return '<span class="breadcrumb-item">/</span>';
        const parts = slashPath.split('/').filter(Boolean);
        if (parts.length === 0) return '<span class="breadcrumb-item">/</span>';
        const chips = parts.map((p) => `<span class="breadcrumb-item">${escapeHtml(p)}</span>`);
        const sep = '<span class="breadcrumb-separator">/</span>';
        return chips.join(sep);
    } catch (_) {
        return '<span class="breadcrumb-item">/</span>';
    }
}

// Fallback favicon - star icon (same as history.html)
const fallbackIcon = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22%3E%3Cpath fill=%22%23999%22 d=%22M8 0l2.8 5.5 6.2 0.5-4.5 4 1.5 6-5.5-3.5-5.5 3.5 1.5-6-4.5-4 6.2-0.5z%22/%3E%3C/svg%3E';

// Favicon cache (IndexedDB + negative cache) - ported from history_html/history.js
const FaviconCache = {
    db: null,
    dbName: 'BookmarkFaviconCache',
    dbVersion: 1,
    storeName: 'favicons',
    failureStoreName: 'failures',
    memoryCache: new Map(),
    failureCache: new Set(),
    pendingRequests: new Map(),

    async init() {
        if (this.db) return;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => {
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                if (!db.objectStoreNames.contains(this.storeName)) {
                    const store = db.createObjectStore(this.storeName, { keyPath: 'domain' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }

                if (!db.objectStoreNames.contains(this.failureStoreName)) {
                    const store = db.createObjectStore(this.failureStoreName, { keyPath: 'domain' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });
    },

    isInvalidUrl(url) {
        if (!url || typeof url !== 'string') return true;

        try {
            const urlObj = new URL(url);
            const hostname = urlObj.hostname.toLowerCase();

            if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
                return true;
            }

            if (hostname.match(/^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/)) {
                return true;
            }

            if (hostname.endsWith('.local')) {
                return true;
            }

            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                return true;
            }

            return false;
        } catch (_) {
            return true;
        }
    },

    async get(url) {
        if (this.isInvalidUrl(url)) {
            return null;
        }

        try {
            const domain = new URL(url).hostname;

            if (this.failureCache.has(domain)) {
                return 'failed';
            }

            if (this.memoryCache.has(domain)) {
                return this.memoryCache.get(domain);
            }

            if (!this.db) await this.init();

            return new Promise((resolve) => {
                const tx = this.db.transaction([this.storeName, this.failureStoreName], 'readonly');
                const failureStore = tx.objectStore(this.failureStoreName);
                const failureReq = failureStore.get(domain);

                failureReq.onsuccess = () => {
                    if (failureReq.result) {
                        const age = Date.now() - failureReq.result.timestamp;
                        if (age < 7 * 24 * 60 * 60 * 1000) {
                            this.failureCache.add(domain);
                            resolve('failed');
                            return;
                        }
                    }

                    const store = tx.objectStore(this.storeName);
                    const req = store.get(domain);
                    req.onsuccess = () => {
                        if (req.result) {
                            this.memoryCache.set(domain, req.result.dataUrl);
                            resolve(req.result.dataUrl);
                        } else {
                            resolve(null);
                        }
                    };
                    req.onerror = () => resolve(null);
                };

                failureReq.onerror = () => resolve(null);
            });
        } catch (_) {
            return null;
        }
    },

    async save(url, dataUrl) {
        if (this.isInvalidUrl(url)) return;

        try {
            const domain = new URL(url).hostname;
            this.memoryCache.set(domain, dataUrl);

            if (!this.db) await this.init();
            const tx = this.db.transaction([this.storeName], 'readwrite');
            const store = tx.objectStore(this.storeName);
            store.put({ domain, dataUrl, timestamp: Date.now() });

            this.failureCache.delete(domain);
            this.removeFailure(domain);
        } catch (_) { }
    },

    async saveFailure(url) {
        if (this.isInvalidUrl(url)) return;
        try {
            const domain = new URL(url).hostname;
            this.failureCache.add(domain);

            if (!this.db) await this.init();
            const tx = this.db.transaction([this.failureStoreName], 'readwrite');
            const store = tx.objectStore(this.failureStoreName);
            store.put({ domain, timestamp: Date.now() });
        } catch (_) { }
    },

    async removeFailure(domain) {
        try {
            if (!this.db) await this.init();
            const tx = this.db.transaction([this.failureStoreName], 'readwrite');
            tx.objectStore(this.failureStoreName).delete(domain);
        } catch (_) { }
    },

    async clear(url) {
        if (this.isInvalidUrl(url)) return;
        try {
            const domain = new URL(url).hostname;
            this.memoryCache.delete(domain);
            this.failureCache.delete(domain);

            if (!this.db) await this.init();
            const tx = this.db.transaction([this.storeName, this.failureStoreName], 'readwrite');
            tx.objectStore(this.storeName).delete(domain);
            tx.objectStore(this.failureStoreName).delete(domain);
        } catch (_) { }
    },

    async fetch(url) {
        if (this.isInvalidUrl(url)) {
            return fallbackIcon;
        }

        try {
            const domain = new URL(url).hostname;

            const cached = await this.get(url);
            if (cached === 'failed') return fallbackIcon;
            if (cached) return cached;

            if (this.pendingRequests.has(domain)) {
                return this.pendingRequests.get(domain);
            }

            const requestPromise = this._fetchFavicon(url);
            this.pendingRequests.set(domain, requestPromise);

            try {
                return await requestPromise;
            } finally {
                this.pendingRequests.delete(domain);
            }
        } catch (_) {
            return fallbackIcon;
        }
    },

    async _fetchFavicon(url) {
        return new Promise(async (resolve) => {
            try {
                const domain = new URL(url).hostname;
                const sources = [
                    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
                    `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
                ];

                for (let i = 0; i < sources.length; i++) {
                    const faviconUrl = sources[i];
                    const result = await this._tryLoadFavicon(faviconUrl, url);
                    if (result && result !== fallbackIcon) {
                        resolve(result);
                        return;
                    }
                }

                this.saveFailure(url);
                resolve(fallbackIcon);
            } catch (_) {
                this.saveFailure(url);
                resolve(fallbackIcon);
            }
        });
    },

    async _tryLoadFavicon(faviconUrl, originalUrl) {
        return new Promise((resolve) => {
            const img = new Image();
            const timeout = setTimeout(() => {
                img.src = '';
                resolve(null);
            }, 3000);

            img.onload = () => {
                clearTimeout(timeout);
                if (img.width < 8 || img.height < 8) {
                    resolve(null);
                    return;
                }

                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    const dataUrl = canvas.toDataURL('image/png');
                    this.save(originalUrl, dataUrl);
                    resolve(dataUrl);
                } catch (_) {
                    // CORS: store the remote URL
                    this.save(originalUrl, faviconUrl);
                    resolve(faviconUrl);
                }
            };

            img.onerror = () => {
                clearTimeout(timeout);
                resolve(null);
            };

            img.src = faviconUrl;
        });
    }
};

function updateFaviconImages(url, dataUrl) {
    try {
        const domain = new URL(url).hostname;
        const allImages = document.querySelectorAll('img.tree-icon');

        allImages.forEach(img => {
            const item = img.closest('[data-node-url], [data-bookmark-url]');
            if (!item) return;
            const itemUrl = item.dataset.nodeUrl || item.dataset.bookmarkUrl;
            if (!itemUrl) return;
            try {
                const itemDomain = new URL(itemUrl).hostname;
                if (itemDomain === domain) {
                    img.src = dataUrl;
                }
            } catch (_) { }
        });
    } catch (_) { }
}

function setupGlobalImageErrorHandler() {
    document.addEventListener('error', (e) => {
        if (e.target.tagName === 'IMG' && e.target.classList.contains('tree-icon')) {
            if (e.target.src !== fallbackIcon && !e.target.src.startsWith('data:image/svg+xml')) {
                e.target.src = fallbackIcon;
            }
        }
    }, true);
}

// Init once (best-effort)
try { setupGlobalImageErrorHandler(); } catch (_) { }
try { FaviconCache.init().catch(() => { }); } catch (_) { }

// Receive favicon updates from background.js (share the same cache DB)
try {
    const browserAPI = (typeof chrome !== 'undefined') ? chrome : (typeof browser !== 'undefined' ? browser : null);
    if (browserAPI && browserAPI.runtime && browserAPI.runtime.onMessage) {
        browserAPI.runtime.onMessage.addListener((message) => {
            if (!message || !message.action) return;

            if (message.action === 'clearFaviconCache') {
                if (message.url) {
                    FaviconCache.clear(message.url);
                }
                return;
            }

            if (message.action === 'updateFaviconFromTab') {
                if (message.url && message.favIconUrl) {
                    FaviconCache.save(message.url, message.favIconUrl)
                        .then(() => {
                            updateFaviconImages(message.url, message.favIconUrl);
                        })
                        .catch(() => { });
                }
            }
        });
    }
} catch (_) { }

// Sync version: returns cached favicon or fallback, and triggers async fetch
function getFaviconUrl(url) {
    if (!url) return fallbackIcon;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return fallbackIcon;
    }

    if (FaviconCache.isInvalidUrl(url)) {
        return fallbackIcon;
    }

    try {
        const domain = new URL(url).hostname;

        if (FaviconCache.memoryCache.has(domain)) {
            return FaviconCache.memoryCache.get(domain);
        }

        if (FaviconCache.failureCache.has(domain)) {
            return fallbackIcon;
        }

        FaviconCache.fetch(url).then((dataUrl) => {
            try {
                updateFaviconImages(url, dataUrl);
            } catch (_) { }
        }).catch(() => { });
    } catch (_) {
        return fallbackIcon;
    }

    return fallbackIcon;
}

// Expose to global scope (for other scripts / future search integration)
try {
    window.FaviconCache = FaviconCache;
    window.getFaviconUrl = getFaviconUrl;
    window.getFaviconUrlAsync = async (url) => {
        return await FaviconCache.fetch(url);
    };
} catch (_) { }

function generateHistoryTreeHtml(bookmarkTree, changeMap, mode, options = {}, lang = 'zh_CN') {
    const isZh = lang === 'zh_CN';
    const maxDepth = options.maxDepth !== undefined ? options.maxDepth : 999;
    const lazyKey = options.lazyKey ? String(options.lazyKey) : '';
    const lazyEnabled = !!lazyKey;
    const lazyDepth = Number.isFinite(options.lazyDepth) ? Number(options.lazyDepth) : null;
    const customTitle = typeof options.customTitle === 'string' ? options.customTitle : '';
    const customLabel = typeof options.customLabel === 'string' ? options.customLabel : null;
    const hideLegend = options.hideLegend === true;
    const hideModeLabel = options.hideModeLabel === true;

    let lazyNodeById = null;
    if (lazyEnabled) {
        lazyNodeById = new Map();
        const nodes = Array.isArray(bookmarkTree) ? bookmarkTree : [bookmarkTree];
        const stack = nodes.filter(Boolean).map(n => ({ node: n, level: 0 }));
        while (stack.length) {
            const { node } = stack.pop();
            if (!node || node.id == null) continue;
            lazyNodeById.set(String(node.id), node);
            if (Array.isArray(node.children) && node.children.length) {
                for (let i = node.children.length - 1; i >= 0; i--) {
                    stack.push({ node: node.children[i] });
                }
            }
        }
        if (!window.__popupHistoryTreeLazyContexts) {
            window.__popupHistoryTreeLazyContexts = new Map();
        }
        window.__popupHistoryTreeLazyContexts.set(lazyKey, {
            renderChildren: (parentId, childLevel, nextForceInclude) => {
                const parent = lazyNodeById.get(String(parentId));
                if (!parent || !Array.isArray(parent.children)) return '';
                const lvl = Number.isFinite(Number(childLevel)) ? Number(childLevel) : 0;
                const force = String(nextForceInclude) === 'true';
                return parent.children.map(ch => renderHistoryTreeNode(ch, lvl, force)).join('');
            }
        });
    }

    const hasChangesRecursive = (node) => {
        if (!node) return false;
        if (changeMap && changeMap.has(node.id)) return true;
        if (node.children) return node.children.some(child => hasChangesRecursive(child));
        return false;
    };

    const renderHistoryTreeNode = (node, level = 0, forceInclude = false) => {
        if (!node) return '';

        const shouldInclude = mode === 'detailed' || forceInclude || hasChangesRecursive(node);
        if (!shouldInclude) return '';

        const change = changeMap ? changeMap.get(node.id) : null;
        let changeClass = '';
        let statusIcon = '';

        if (change) {
            const types = change.type ? String(change.type).split('+') : [];
            const isAmbiguous = types.includes('ambiguous');
            const isAdded = types.includes('added');
            const isDeleted = types.includes('deleted');
            const isModified = types.includes('modified');
            const isMoved = types.includes('moved');
            const isAddDelete = isAdded && isDeleted;

            if (isAmbiguous) {
                changeClass = 'tree-change-ambiguous';
                statusIcon = `<span class="change-badge ambiguous">?</span>`;
            } else if (isAddDelete) {
                changeClass = 'tree-change-mixed';
                statusIcon = '<span class="change-badge added">+</span><span class="change-badge deleted">-</span>';
            } else if (isAdded) {
                changeClass = 'tree-change-added';
                statusIcon = '<span class="change-badge added">+</span>';
            } else if (isDeleted) {
                changeClass = 'tree-change-deleted';
                statusIcon = '<span class="change-badge deleted">-</span>';
            } else {
                if (isModified) {
                    changeClass = 'tree-change-modified';
                    statusIcon += '<span class="change-badge modified">~</span>';
                }

                if (isMoved) {
                    changeClass = isModified ? 'tree-change-mixed' : 'tree-change-moved';
                    let slash = '';
                    if (change.moved && change.moved.oldPath) {
                        slash = breadcrumbToSlashFolders(change.moved.oldPath);
                    }
                    statusIcon += `<span class="change-badge moved" data-move-from="${escapeHtml(slash)}" title="${escapeHtml(slash)}"><i class="fas fa-arrows-alt"></i><span class="move-tooltip">${slashPathToChipsHTML(slash)}</span></span>`;
                }
            }
        } else if (hasChangesRecursive(node) && mode === 'detailed') {
            statusIcon = `<span class="change-badge has-changes" title="${isZh ? '此文件夹下有变化' : 'Contains changes'}">•</span>`;
        }

        const title = escapeHtml(node.title || (isZh ? '(无标题)' : '(Untitled)'));
        const isFolder = !node.url && node.children;
        const hasChildren = isFolder && node.children && node.children.length > 0;

        const isSelfChangedFolder = !!(isFolder && change && change.type);
        let shouldExpand = false;
        if (mode === 'detailed') {
            shouldExpand = level < maxDepth;
            if (options.maxDepth === undefined || options.maxDepth === null || options.maxDepth > 100) {
                shouldExpand = (level === 0 || hasChangesRecursive(node));
            }
        } else {
            shouldExpand = ((level === 0 || hasChangesRecursive(node)) && !isSelfChangedFolder);
        }
        if (lazyEnabled && lazyDepth != null && level + 1 > lazyDepth) {
            shouldExpand = false;
        }

        const shouldForceIncludeChildrenInSimple =
            mode !== 'detailed' &&
            !forceInclude &&
            isFolder &&
            change &&
            typeof change.type === 'string';
        const nextForceInclude = forceInclude || shouldForceIncludeChildrenInSimple;

        if (isFolder) {
            let shouldLazyRenderChildren = false;
            if (lazyEnabled && hasChildren) {
                if (!shouldExpand) shouldLazyRenderChildren = true;
                if (lazyDepth != null && level + 1 > lazyDepth) shouldLazyRenderChildren = true;
            }

            const childrenHtml = (!shouldLazyRenderChildren && hasChildren)
                ? node.children.map(child => renderHistoryTreeNode(child, level + 1, nextForceInclude)).join('')
                : '';

            return `
                <div class="tree-node">
                    <div class="tree-item ${changeClass}" data-node-id="${escapeHtml(String(node.id))}" data-node-type="folder" data-node-level="${level}">
                        <span class="tree-toggle ${shouldExpand ? 'expanded' : ''}"><i class="fas fa-chevron-right"></i></span>
                        <i class="tree-icon fas fa-folder${shouldExpand ? '-open' : ''}"></i>
                        <span class="tree-label">${title}</span>
                        <span class="change-badges">${statusIcon}</span>
                    </div>
                    <div class="tree-children ${shouldExpand ? 'expanded' : ''}" data-children-loaded="${shouldLazyRenderChildren ? 'false' : 'true'}" data-parent-id="${escapeHtml(String(node.id))}" data-child-level="${level + 1}" data-next-force-include="${nextForceInclude ? 'true' : 'false'}">
                        ${childrenHtml}
                    </div>
                </div>
            `;
        }

        const favicon = getFaviconUrl(node.url);
        return `
            <div class="tree-node">
                <div class="tree-item ${changeClass}" data-node-id="${escapeHtml(String(node.id))}" data-node-url="${escapeHtml(node.url || '')}" data-node-type="bookmark" data-node-level="${level}">
                    <span class="tree-toggle" style="opacity: 0"></span>
                    ${favicon ? `<img class="tree-icon" src="${escapeHtml(favicon)}" alt="">` : `<i class="tree-icon fas fa-bookmark"></i>`}
                    <a href="${escapeHtml(node.url || '')}" target="_blank" class="tree-label tree-bookmark-link" rel="noopener noreferrer">${title}</a>
                    <span class="change-badges">${statusIcon}</span>
                </div>
            </div>
        `;
    };

    let treeContent = '';
    const nodes = Array.isArray(bookmarkTree) ? bookmarkTree : [bookmarkTree];
    nodes.forEach(node => {
        if (node && node.children) {
            node.children.forEach(child => {
                treeContent += renderHistoryTreeNode(child, 0);
            });
        }
    });

    if (!treeContent) {
        return `
            <div class="detail-section">
                <div class="detail-empty">
                    <i class="fas fa-check-circle"></i>
                    ${isZh ? '无变化' : 'No changes'}
                </div>
            </div>
        `;
    }

    // Build node id -> node map to count F/B for legend
    const nodeMap = new Map();
    const buildNodeMap = (node) => {
        if (!node) return;
        if (node.id) nodeMap.set(String(node.id), node);
        if (node.children) node.children.forEach(buildNodeMap);
    };
    nodes.forEach(buildNodeMap);

    let addedFolders = 0, addedBookmarks = 0;
    let deletedFolders = 0, deletedBookmarks = 0;
    let modifiedFolders = 0, modifiedBookmarks = 0;
    let movedFolders = 0, movedBookmarks = 0;

    if (changeMap && typeof changeMap.forEach === 'function') {
        changeMap.forEach((change, id) => {
            const node = nodeMap.get(String(id));
            const isFolder = node && !node.url && node.children;
            const types = change && change.type ? String(change.type).split('+') : [];

            if (types.includes('added')) {
                if (isFolder) addedFolders++; else addedBookmarks++;
            }
            if (types.includes('deleted')) {
                if (isFolder) deletedFolders++; else deletedBookmarks++;
            }
            if (types.includes('modified')) {
                if (isFolder) modifiedFolders++; else modifiedBookmarks++;
            }
            if (types.includes('moved')) {
                if (isFolder) movedFolders++; else movedBookmarks++;
            }
        });
    }

    const formatCount = (folders, bookmarks) => {
        const parts = [];
        if (folders > 0) parts.push(`${folders}F`);
        if (bookmarks > 0) parts.push(`${bookmarks}B`);
        return parts.join(' ');
    };

    const legendItems = [];
    const addedTotal = addedFolders + addedBookmarks;
    const deletedTotal = deletedFolders + deletedBookmarks;
    const modifiedTotal = modifiedFolders + modifiedBookmarks;
    const movedTotal = movedFolders + movedBookmarks;

    if (addedTotal > 0) legendItems.push(`<span class="legend-item"><span class="legend-dot added"></span><span class="legend-count">:${formatCount(addedFolders, addedBookmarks)}</span></span>`);
    if (deletedTotal > 0) legendItems.push(`<span class="legend-item"><span class="legend-dot deleted"></span><span class="legend-count">:${formatCount(deletedFolders, deletedBookmarks)}</span></span>`);
    if (movedTotal > 0) legendItems.push(`<span class="legend-item"><span class="legend-dot moved"></span><span class="legend-count">:${movedTotal}</span></span>`);
    if (modifiedTotal > 0) legendItems.push(`<span class="legend-item"><span class="legend-dot modified"></span><span class="legend-count">:${formatCount(modifiedFolders, modifiedBookmarks)}</span></span>`);

    const legend = hideLegend ? '' : legendItems.join('');
    const detailLabel = customLabel != null
        ? customLabel
        : (mode === 'detailed' ? (isZh ? '详细' : 'Detailed') : (isZh ? '简略' : 'Simple'));
    const detailTitleRaw = customTitle || (isZh ? '变化预览' : 'Changes Preview');
    const detailTitle = escapeHtml(detailTitleRaw);
    const modeLabelHtml = hideModeLabel || !detailLabel
        ? ''
        : `<span class="detail-mode-label">${escapeHtml(detailLabel)}</span>`;

    const lazyAttr = lazyEnabled ? ` data-lazy-key="${escapeHtml(lazyKey)}"` : '';
    return `
        <div class="detail-section">
            <div class="detail-section-title detail-section-title-with-legend">
                <span class="detail-title-left">${modeLabelHtml}${detailTitle}</span>
                <span class="detail-title-legend">${legend}</span>
            </div>
            <div class="history-tree-container bookmark-tree"${lazyAttr}>
                ${treeContent}
            </div>
        </div>
    `;
}

function buildAmbiguityTreeIndex(bookmarkTree) {
    const nodeById = new Map();
    const parentById = new Map();
    const roots = Array.isArray(bookmarkTree) ? bookmarkTree : [bookmarkTree];
    const stack = roots.filter(Boolean).map(node => ({ node, parentId: '' }));
    while (stack.length) {
        const { node, parentId } = stack.pop();
        if (!node || node.id == null) continue;
        const idStr = String(node.id);
        nodeById.set(idStr, node);
        if (parentId) parentById.set(idStr, String(parentId));
        if (Array.isArray(node.children) && node.children.length) {
            for (let i = node.children.length - 1; i >= 0; i--) {
                stack.push({ node: node.children[i], parentId: idStr });
            }
        }
    }
    return { nodeById, parentById };
}

function collectAmbiguityAncestors(id, parentById, keepSet) {
    if (!id) return;
    let cur = String(id);
    let guard = 0;
    while (cur && guard++ < 512) {
        keepSet.add(cur);
        const pid = parentById.get(cur);
        if (!pid) break;
        cur = String(pid);
    }
}

function filterTreeByKeepSet(bookmarkTree, keepSet) {
    const filterNode = (node) => {
        if (!node || node.id == null) return null;
        const idStr = String(node.id);
        const isFolder = !node.url && node.children;
        const children = [];
        if (Array.isArray(node.children)) {
            for (const child of node.children) {
                const filtered = filterNode(child);
                if (filtered) children.push(filtered);
            }
        }
        const shouldKeep = keepSet.has(idStr) || children.length > 0;
        if (!shouldKeep) return null;
        const clone = { id: node.id, title: node.title || '', url: node.url || '' };
        if (isFolder) clone.children = children;
        return clone;
    };

    const roots = Array.isArray(bookmarkTree) ? bookmarkTree : [bookmarkTree];
    const filteredRoots = roots.map(filterNode).filter(Boolean);
    return Array.isArray(bookmarkTree) ? filteredRoots : (filteredRoots[0] || null);
}

function buildAmbiguityPathString(nodeId, index, isZh) {
    if (!nodeId || !index || !index.nodeById) return '';
    const titles = [];
    let cur = String(nodeId);
    let guard = 0;
    while (cur && guard++ < 256) {
        const node = index.nodeById.get(cur);
        if (!node) break;
        const t = String(node.title || '');
        if (t && t.toLowerCase() !== 'root') titles.push(t);
        const pid = index.parentById.get(cur);
        if (!pid) break;
        cur = String(pid);
    }
    titles.reverse();
    if (!titles.length) return '';
    return titles.join(isZh ? ' / ' : ' / ');
}

function buildAmbiguityPreviewTrees({ matchReport, currentTree, targetTree, userMatches, lang }) {
    const ambiguous = matchReport && Array.isArray(matchReport.ambiguous) ? matchReport.ambiguous : [];
    if (!ambiguous.length || !currentTree || !targetTree) return '';

    const isZh = lang === 'zh_CN';
    const currentIndex = buildAmbiguityTreeIndex(currentTree);
    const targetIndex = buildAmbiguityTreeIndex(targetTree);

    const targetKeep = new Set();
    const currentKeep = new Set();
    const targetHighlight = new Set();
    const currentHighlight = new Set();

    ambiguous.forEach(item => {
        const tid = item && item.targetId != null ? String(item.targetId) : '';
        if (tid) {
            targetHighlight.add(tid);
            collectAmbiguityAncestors(tid, targetIndex.parentById, targetKeep);
        }
        const candidates = Array.isArray(item && item.candidates) ? item.candidates : [];
        for (const c of candidates) {
            const cid = c && c.id != null ? String(c.id) : '';
            if (!cid) continue;
            currentHighlight.add(cid);
            collectAmbiguityAncestors(cid, currentIndex.parentById, currentKeep);
        }
    });

    const targetFiltered = filterTreeByKeepSet(targetTree, targetKeep);
    const currentFiltered = filterTreeByKeepSet(currentTree, currentKeep);
    const hasTargetTree = targetFiltered && (Array.isArray(targetFiltered) ? targetFiltered.length > 0 : true);
    const hasCurrentTree = currentFiltered && (Array.isArray(currentFiltered) ? currentFiltered.length > 0 : true);

    const makeEmptySection = (title, text) => `
        <div class="detail-section">
            <div class="detail-section-title detail-section-title-with-legend">
                <span class="detail-title-left">${escapeHtml(title)}</span>
                <span class="detail-title-legend"></span>
            </div>
            <div class="detail-empty">
                <i class="fas fa-exclamation-circle"></i>
                ${escapeHtml(text)}
            </div>
        </div>
    `;

    const targetMap = new Map(Array.from(targetHighlight).map(id => [String(id), { type: 'ambiguous' }]));
    const currentMap = new Map(Array.from(currentHighlight).map(id => [String(id), { type: 'ambiguous' }]));

    const baseKey = `amb-${Date.now()}`;

    const targetHtml = hasTargetTree
        ? generateHistoryTreeHtml(targetFiltered, targetMap, 'detailed', {
            customTitle: isZh ? '目标书签树（歧义路径）' : 'Target Tree (Ambiguity Paths)',
            hideLegend: true,
            hideModeLabel: true,
            maxDepth: 1,
            lazyDepth: 1,
            lazyKey: `${baseKey}-target`
        }, lang)
        : makeEmptySection(isZh ? '目标书签树（歧义路径）' : 'Target Tree (Ambiguity Paths)', isZh ? '未能定位歧义节点' : 'Unable to locate ambiguous nodes');

    const currentHtml = hasCurrentTree
        ? generateHistoryTreeHtml(currentFiltered, currentMap, 'detailed', {
            customTitle: isZh ? '当前书签树（歧义路径）' : 'Current Tree (Ambiguity Paths)',
            hideLegend: true,
            hideModeLabel: true,
            maxDepth: 1,
            lazyDepth: 1,
            lazyKey: `${baseKey}-current`
        }, lang)
        : makeEmptySection(isZh ? '当前书签树（歧义路径）' : 'Current Tree (Ambiguity Paths)', isZh ? '未能定位歧义候选' : 'Unable to locate ambiguous candidates');

    const buildNodeLabel = (node, fallbackTitle, fallbackUrl, path) => {
        const title = String((node && node.title) || fallbackTitle || '').trim() || (isZh ? '(无标题)' : '(Untitled)');
        const url = String((node && node.url) || fallbackUrl || '').trim();
        const pathText = path ? (isZh ? `（路径：${path}）` : ` (Path: ${path})`) : '';
        return `${title}${url ? ` — ${url}` : ''}${pathText}`;
    };

    const ambRoot = { id: `${baseKey}-amb-root`, title: isZh ? '歧义列表' : 'Ambiguity List', children: [] };
    const ambHighlight = new Set();

    ambiguous.forEach((item, idx) => {
        const phaseText = (() => {
            const p = String(item && item.phase ? item.phase : '');
            if (p === 'structure') return isZh ? '父级上下文' : 'Structure';
            if (p === 'url') return isZh ? 'URL 匹配' : 'URL';
            if (p === 'title') return isZh ? '名称匹配' : 'Title';
            if (p === 'manual') return isZh ? '手动匹配' : 'Manual';
            return p || (isZh ? '未知' : 'Unknown');
        })();

        const typeText = (item && item.type === 'folder')
            ? (isZh ? '文件夹' : 'Folder')
            : (isZh ? '书签' : 'Bookmark');

        const tid = item && item.targetId != null ? String(item.targetId) : '';
        const targetNode = tid ? targetIndex.nodeById.get(tid) : null;
        const targetPath = tid ? buildAmbiguityPathString(tid, targetIndex, isZh) : '';
        const targetLabel = buildNodeLabel(targetNode, item && item.title ? item.title : '', item && item.url ? item.url : '', targetPath);

        const selectedRefId = tid && userMatches && userMatches[tid] ? String(userMatches[tid]) : '';
        const candidates = Array.isArray(item && item.candidates) ? item.candidates : [];

        const targetLeafId = `${baseKey}-amb-${idx}-target`;
        const targetLeaf = targetNode && !targetNode.url
            ? { id: targetLeafId, title: targetLabel, children: [] }
            : { id: targetLeafId, title: targetLabel, url: String((targetNode && targetNode.url) || (item && item.url) || '') };
        ambHighlight.add(targetLeafId);

        const candidateLeafs = [];
        candidates.forEach((c, cIdx) => {
            const cid = c && c.id != null ? String(c.id) : '';
            const cNode = cid ? currentIndex.nodeById.get(cid) : null;
            const cPath = cid ? buildAmbiguityPathString(cid, currentIndex, isZh) : '';
            const baseLabel = buildNodeLabel(cNode, c && c.title ? c.title : '', c && c.url ? c.url : '', cPath);
            const picked = (selectedRefId && cid && cid === selectedRefId);
            const label = picked ? `${isZh ? '已选' : 'Selected'} · ${baseLabel}` : baseLabel;
            const leafId = `${baseKey}-amb-${idx}-cand-${cIdx}`;
            const leaf = cNode && !cNode.url
                ? { id: leafId, title: label, children: [] }
                : { id: leafId, title: label, url: String((cNode && cNode.url) || (c && c.url) || '') };
            ambHighlight.add(leafId);
            candidateLeafs.push(leaf);
        });

        if (!candidateLeafs.length) {
            const leafId = `${baseKey}-amb-${idx}-cand-empty`;
            candidateLeafs.push({ id: leafId, title: isZh ? '无候选' : 'No candidates', children: [] });
            ambHighlight.add(leafId);
        }

        const itemNode = {
            id: `${baseKey}-amb-${idx}`,
            title: `${idx + 1}. ${typeText} · ${phaseText}`,
            children: [
                { id: `${baseKey}-amb-${idx}-target-group`, title: isZh ? '目标节点' : 'Target Node', children: [targetLeaf] },
                { id: `${baseKey}-amb-${idx}-cand-group`, title: isZh ? '候选节点' : 'Candidate Nodes', children: candidateLeafs }
            ]
        };

        ambRoot.children.push(itemNode);
    });

    const ambMap = new Map(Array.from(ambHighlight).map(id => [String(id), { type: 'ambiguous' }]));
    const ambHtml = generateHistoryTreeHtml(ambRoot, ambMap, 'detailed', {
        customTitle: isZh ? '歧义内容树' : 'Ambiguity Tree',
        hideLegend: true,
        hideModeLabel: true,
        maxDepth: 1,
        lazyDepth: 1,
        lazyKey: `${baseKey}-amb`
    }, lang);

    return `${currentHtml}${targetHtml}${ambHtml}`;
}

function generateImportMergePreviewTreeHtml(treeRoot, options = {}, lang = 'zh_CN') {
    const isZh = lang === 'zh_CN';
    const maxDepth = typeof options.maxDepth === 'number' ? options.maxDepth : 3;

    const getChangeMeta = (changeType) => {
        if (!changeType) return { changeClass: '', statusIcon: '' };

        const types = String(changeType).split('+');
        const hasAdded = types.includes('added');
        const hasDeleted = types.includes('deleted');
        const hasModified = types.includes('modified');
        const hasMoved = types.includes('moved');

        let changeClass = '';
        if (hasAdded) changeClass = 'tree-change-added';
        else if (hasDeleted) changeClass = 'tree-change-deleted';
        else if (hasMoved && hasModified) changeClass = 'tree-change-mixed';
        else if (hasMoved) changeClass = 'tree-change-moved';
        else if (hasModified) changeClass = 'tree-change-modified';

        const statusIcon = (() => {
            const badges = [];
            if (hasAdded) badges.push(`<span class="change-badge added">+</span>`);
            if (hasDeleted) badges.push(`<span class="change-badge deleted">-</span>`);
            if (hasModified) badges.push(`<span class="change-badge modified">~</span>`);
            if (hasMoved) badges.push(`<span class="change-badge moved">↔</span>`);
            return badges.join('');
        })();

        return { changeClass, statusIcon };
    };

    let addedFolders = 0;
    let addedBookmarks = 0;
    let deletedFolders = 0;
    let deletedBookmarks = 0;
    let modifiedFolders = 0;
    let modifiedBookmarks = 0;
    let movedFolders = 0;
    let movedBookmarks = 0;

    const countChanges = (node) => {
        if (!node) return;
        const changeType = node.changeType || '';
        const types = String(changeType).split('+').filter(Boolean);
        const isFolder = !node.url && Array.isArray(node.children);

        if (types.includes('added')) {
            if (isFolder) addedFolders++; else addedBookmarks++;
        }
        if (types.includes('deleted')) {
            if (isFolder) deletedFolders++; else deletedBookmarks++;
        }
        if (types.includes('modified')) {
            if (isFolder) modifiedFolders++; else modifiedBookmarks++;
        }
        if (types.includes('moved')) {
            if (isFolder) movedFolders++; else movedBookmarks++;
        }

        if (Array.isArray(node.children)) {
            node.children.forEach(countChanges);
        }
    };

    if (treeRoot && Array.isArray(treeRoot.children)) {
        treeRoot.children.forEach(countChanges);
    }

    const formatCount = (folders, bookmarks) => {
        const parts = [];
        if (folders > 0) parts.push(`${folders}F`);
        if (bookmarks > 0) parts.push(`${bookmarks}B`);
        return parts.join(' ');
    };

    const legendItems = [];
    const addedTotal = addedFolders + addedBookmarks;
    const deletedTotal = deletedFolders + deletedBookmarks;
    const modifiedTotal = modifiedFolders + modifiedBookmarks;
    const movedTotal = movedFolders + movedBookmarks;

    if (addedTotal > 0) legendItems.push(`<span class="legend-item"><span class="legend-dot added"></span><span class="legend-count">:${formatCount(addedFolders, addedBookmarks)}</span></span>`);
    if (deletedTotal > 0) legendItems.push(`<span class="legend-item"><span class="legend-dot deleted"></span><span class="legend-count">:${formatCount(deletedFolders, deletedBookmarks)}</span></span>`);
    if (movedTotal > 0) legendItems.push(`<span class="legend-item"><span class="legend-dot moved"></span><span class="legend-count">:${movedTotal}</span></span>`);
    if (modifiedTotal > 0) legendItems.push(`<span class="legend-item"><span class="legend-dot modified"></span><span class="legend-count">:${modifiedTotal}</span></span>`);

    const legend = legendItems.join('');
    const safeTitle = (t) => escapeHtml(String(t == null ? '' : t));

    const renderNode = (node, level = 0) => {
        if (!node) return '';

        const title = safeTitle(node.title || (isZh ? '(无标题)' : '(Untitled)'));
        const url = node.url ? String(node.url) : '';
        const isFolder = !url && Array.isArray(node.children);
        const hasChildren = isFolder && node.children.length > 0;

        const { changeClass, statusIcon } = getChangeMeta(node.changeType);
        const shouldExpand = level < maxDepth;

        if (isFolder) {
            const childrenHtml = hasChildren
                ? node.children.map(child => renderNode(child, level + 1)).join('')
                : '';

            return `
                <div class="tree-node">
                    <div class="tree-item ${changeClass}" data-node-type="folder" data-node-level="${level}">
                        <span class="tree-toggle ${shouldExpand ? 'expanded' : ''}"><i class="fas fa-chevron-right"></i></span>
                        <i class="tree-icon fas fa-folder${shouldExpand ? '-open' : ''}"></i>
                        <span class="tree-label">${title}</span>
                        <span class="change-badges">${statusIcon}</span>
                    </div>
                    <div class="tree-children ${shouldExpand ? 'expanded' : ''}">
                        ${childrenHtml}
                    </div>
                </div>
            `;
        }

        const favicon = getFaviconUrl(url);
        return `
            <div class="tree-node">
                <div class="tree-item ${changeClass}" data-node-url="${escapeHtml(url)}" data-node-type="bookmark" data-node-level="${level}">
                    <span class="tree-toggle" style="opacity: 0"></span>
                    ${favicon ? `<img class="tree-icon" src="${escapeHtml(favicon)}" alt="">` : `<i class="tree-icon fas fa-bookmark"></i>`}
                    <a href="${escapeHtml(url)}" target="_blank" class="tree-label tree-bookmark-link" rel="noopener noreferrer">${title}</a>
                    <span class="change-badges">${statusIcon}</span>
                </div>
            </div>
        `;
    };

    let treeContent = '';
    if (treeRoot && Array.isArray(treeRoot.children)) {
        treeRoot.children.forEach(child => {
            treeContent += renderNode(child, 0);
        });
    }

    const customTitle = options.customTitle ? String(options.customTitle) : '';

    return `
        <div class="detail-section">
            <div class="detail-section-title detail-section-title-with-legend">
                <span class="detail-title-left">${safeTitle(customTitle || (isZh ? '导入合并预览' : 'Import Merge Preview'))}</span>
                <span class="detail-title-legend">${legend}</span>
            </div>
            <div class="history-tree-container bookmark-tree">
                ${treeContent || `<div class="detail-empty">${isZh ? '无变化' : 'No changes'}</div>`}
            </div>
        </div>
    `;
}

function rebuildTreeWithDeleted(oldTree, newTree, changeMap) {
    if (!oldTree || !oldTree[0] || !newTree || !newTree[0]) {
        return newTree;
    }

    const visitedIds = new Set();
    const MAX_DEPTH = 50;

    const rebuildNode = (oldNode, newNodes, depth = 0) => {
        if (!oldNode || typeof oldNode.id === 'undefined') return null;
        if (depth > MAX_DEPTH) return null;
        if (visitedIds.has(oldNode.id)) return null;
        visitedIds.add(oldNode.id);

        const newNode = newNodes ? newNodes.find(n => n && n.id === oldNode.id) : null;
        const change = changeMap ? changeMap.get(oldNode.id) : null;

        if (change && change.type === 'deleted') {
            const deletedNodeCopy = JSON.parse(JSON.stringify(oldNode));
            if (oldNode.children && oldNode.children.length > 0) {
                deletedNodeCopy.children = oldNode.children
                    .map(child => rebuildNode(child, null, depth + 1))
                    .filter(n => n !== null);
            }
            return deletedNodeCopy;
        }

        if (newNode) {
            const nodeCopy = JSON.parse(JSON.stringify(newNode));

            if (oldNode.children || newNode.children) {
                const childrenMap = new Map();
                if (oldNode.children) {
                    oldNode.children.forEach((child, index) => {
                        if (!child) return;
                        childrenMap.set(child.id, { node: child, index, source: 'old' });
                    });
                }
                if (newNode.children) {
                    newNode.children.forEach((child, index) => {
                        if (!child) return;
                        childrenMap.set(child.id, { node: child, index, source: 'new' });
                    });
                }

                const rebuiltChildren = [];
                if (oldNode.children) {
                    oldNode.children.forEach(oldChild => {
                        if (!oldChild) return;
                        if (childrenMap.has(oldChild.id)) {
                            const rebuiltChild = rebuildNode(oldChild, newNode.children, depth + 1);
                            if (rebuiltChild) rebuiltChildren.push(rebuiltChild);
                        }
                    });
                }

                if (newNode.children) {
                    newNode.children.forEach(newChild => {
                        if (!newChild) return;
                        const existed = oldNode.children && oldNode.children.find(c => c && c.id === newChild.id);
                        if (!existed) {
                            rebuiltChildren.push(newChild);
                        }
                    });
                }

                nodeCopy.children = rebuiltChildren;
            }

            return nodeCopy;
        }

        if (newNodes === null && change && change.type === 'deleted') {
            const deletedNodeCopy = JSON.parse(JSON.stringify(oldNode));
            if (oldNode.children && oldNode.children.length > 0) {
                deletedNodeCopy.children = oldNode.children
                    .map(child => rebuildNode(child, null, depth + 1))
                    .filter(n => n !== null);
            }
            return deletedNodeCopy;
        }

        return null;
    };

    const rebuiltRoot = rebuildNode(oldTree[0], [newTree[0]]);
    return rebuiltRoot ? [rebuiltRoot] : newTree;
}

// 更新上传按钮上的图标状态
function updateUploadButtonIcons(event) {
    // 重新获取元素，确保在函数调用时获取最新状态
    const webDAVToggle = document.getElementById('webDAVToggle');
    const githubRepoToggle = document.getElementById('githubRepoToggle');
    const defaultDownloadToggle = document.getElementById('defaultDownloadToggle');

    const uploadIconWebDAV = document.getElementById('uploadIconWebDAV');
    const uploadIconGitHub = document.getElementById('uploadIconGitHub');
    const uploadIconLocal = document.getElementById('uploadIconLocal');

    const apply = (webdavEnabled, githubEnabled, localEnabled) => {
        if (uploadIconWebDAV) {
            if (webdavEnabled) uploadIconWebDAV.classList.add('active');
            else uploadIconWebDAV.classList.remove('active');
        }
        if (uploadIconGitHub) {
            if (githubEnabled) uploadIconGitHub.classList.add('active');
            else uploadIconGitHub.classList.remove('active');
        }
        if (uploadIconLocal) {
            if (localEnabled) uploadIconLocal.classList.add('active');
            else uploadIconLocal.classList.remove('active');
        }
    };

    // 初始化时：不要依赖 HTML 默认 checked，直接读 storage，避免“重进 popup 全亮”
    if (!(event && typeof event.type === 'string')) {
        chrome.storage.local.get(['webDAVEnabled', 'githubRepoEnabled', 'defaultDownloadEnabled'], (res) => {
            apply(res.webDAVEnabled === true, res.githubRepoEnabled === true, res.defaultDownloadEnabled === true);
        });
    } else {
        apply(
            Boolean(webDAVToggle && webDAVToggle.checked),
            Boolean(githubRepoToggle && githubRepoToggle.checked),
            Boolean(defaultDownloadToggle && defaultDownloadToggle.checked)
        );
    }

    // 同步更新恢复面板
    updateRestorePanelStatus(event);
}

// [New] 更新恢复面板显示状态
function updateRestorePanelStatus(event) {
    const webDAVToggle = document.getElementById('webDAVToggle');
    const githubRepoToggle = document.getElementById('githubRepoToggle');
    const defaultDownloadToggle = document.getElementById('defaultDownloadToggle');

    const restoreComingSoon = document.getElementById('syncRestoreComingSoon');
    const restoreActionsList = document.getElementById('restoreActionsList');

    const restoreWebDAVBtn = document.getElementById('restoreFromWebDAVBtn');
    const restoreGitHubBtn = document.getElementById('restoreFromGitHubBtn');
    const restoreLocalBtn = document.getElementById('restoreFromLocalBtn');
    const restoreWebDAVStatusDot = document.getElementById('restoreFromWebDAVStatusDot');
    const restoreGitHubStatusDot = document.getElementById('restoreFromGitHubStatusDot');
    const restoreLocalStatusDot = document.getElementById('restoreFromLocalStatusDot');

    const setDotState = (dotEl, configured) => {
        if (!dotEl) return;
        if (configured) {
            dotEl.classList.remove('not-configured');
            dotEl.classList.add('configured');
        } else {
            dotEl.classList.remove('configured');
            dotEl.classList.add('not-configured');
        }
    };

    const apply = (webdavEnabled, githubEnabled, localEnabled, webdavConfigured = false, githubConfigured = false, localConfigured = false) => {
        let anyEnabled = false;

        setDotState(restoreWebDAVStatusDot, webdavConfigured);
        setDotState(restoreGitHubStatusDot, githubConfigured);
        setDotState(restoreLocalStatusDot, localConfigured);

        if (webdavEnabled) {
            if (restoreWebDAVBtn) restoreWebDAVBtn.style.display = 'flex';
            anyEnabled = true;
        } else if (restoreWebDAVBtn) {
            restoreWebDAVBtn.style.display = 'none';
        }

        if (githubEnabled) {
            if (restoreGitHubBtn) restoreGitHubBtn.style.display = 'flex';
            anyEnabled = true;
        } else if (restoreGitHubBtn) {
            restoreGitHubBtn.style.display = 'none';
        }

        if (localEnabled) {
            if (restoreLocalBtn) restoreLocalBtn.style.display = 'flex';
            anyEnabled = true;
        } else if (restoreLocalBtn) {
            restoreLocalBtn.style.display = 'none';
        }

        if (anyEnabled) {
            if (restoreComingSoon) restoreComingSoon.style.display = 'none';
            if (restoreActionsList) restoreActionsList.style.display = 'flex';
        } else {
            if (restoreComingSoon) {
                restoreComingSoon.style.display = 'inline-block';
                chrome.storage.local.get(['preferredLang', 'currentLang'], (res) => {
                    const lang = res?.currentLang || res?.preferredLang || 'zh_CN';
                    restoreComingSoon.textContent = lang === 'en' ? 'Pending Selection' : '待选择';
                });
            }
            if (restoreActionsList) restoreActionsList.style.display = 'none';
        }

        requestAnimationFrame(() => {
            syncInitRightColumnHeights();
        });
    };

    // 初始化时：读 storage，避免 HTML 默认 checked 导致“全显示”
    if (!(event && typeof event.type === 'string')) {
        chrome.storage.local.get([
            'webDAVEnabled', 'githubRepoEnabled', 'defaultDownloadEnabled',
            'serverAddress', 'username', 'password',
            'githubRepoToken', 'githubRepoOwner', 'githubRepoName'
        ], (res) => {
            const webdavEnabled = res.webDAVEnabled === true;
            const githubEnabled = res.githubRepoEnabled === true;
            const localEnabled = res.defaultDownloadEnabled === true;

            const webdavConfigured = !!(res.serverAddress && res.username && res.password);
            const githubConfigured = !!(res.githubRepoToken && res.githubRepoOwner && res.githubRepoName);
            const localConfigured = res.defaultDownloadEnabled === true;

            apply(webdavEnabled, githubEnabled, localEnabled, webdavConfigured, githubConfigured, localConfigured);
        });
        return;
    }

    // 用户交互：直接用 DOM 的最新状态（更即时）
    const serverAddressValue = document.getElementById('serverAddress')?.value?.trim() || '';
    const usernameValue = document.getElementById('username')?.value?.trim() || '';
    const passwordValue = document.getElementById('password')?.value || '';
    const webdavConfigured = !!(serverAddressValue && usernameValue && passwordValue);
    const githubConfigured = !!(document.getElementById('githubRepoToken')?.value?.trim() && document.getElementById('githubRepoOwner')?.value?.trim() && document.getElementById('githubRepoName')?.value?.trim());
    const localConfigured =
        Boolean(defaultDownloadToggle && defaultDownloadToggle.checked) ||
        Boolean(document.getElementById('customDownloadPath')?.value?.trim());

    apply(
        Boolean(webDAVToggle && webDAVToggle.checked),
        Boolean(githubRepoToggle && githubRepoToggle.checked),
        Boolean(defaultDownloadToggle && defaultDownloadToggle.checked),
        webdavConfigured,
        githubConfigured,
        localConfigured
    );
}


// =============================================================================
// DOMContentLoaded 事件监听器 (Main Entry Point)
// =============================================================================

document.addEventListener('DOMContentLoaded', function () {
    window.addEventListener('resize', syncInitRightColumnHeights);

    const leftPanel = document.querySelector('.stacked-settings');
    const rightColumn = document.querySelector('.restore-panel-column');
    if (typeof ResizeObserver !== 'undefined') {
        if (initLayoutResizeObserver) {
            initLayoutResizeObserver.disconnect();
        }
        initLayoutResizeObserver = new ResizeObserver(() => {
            scheduleInitLayoutSync();
        });
        // 只观察左侧设置列，避免在回调里修改右列高度后触发 RO 循环告警。
        if (leftPanel) initLayoutResizeObserver.observe(leftPanel);
    }

    scheduleInitLayoutSync();

    setTimeout(() => {
        scheduleInitLayoutSync();
    }, 80);

    // 添加全局未处理 Promise 错误监听器，捕获并忽略特定的连接错误
    window.addEventListener('unhandledrejection', function (event) {
        // 检查错误消息是否是我们想要抑制的连接错误
        if (event.reason &&
            event.reason.message &&
            event.reason.message.includes('Could not establish connection') &&
            event.reason.message.includes('Receiving end does not exist')) {

            // 阻止错误显示在控制台
            event.preventDefault();
            event.stopPropagation();

            // 可选：记录一个更友好的信息，帮助调试，不会影响用户
            return false; // 阻止错误传播
        }
    });

    // 初始化连接
    connectToBackground();

    // 初始化UI部分
    loadWebDAVToggleStatus();
    initializeWebDAVConfigSection();
    loadGitHubRepoToggleStatus();
    initializeGitHubRepoConfigSection();
    initializeLocalConfigSection();
    initializeWebDAVToggle();
    initializeGitHubRepoToggle();
    initializeOpenSourceInfo(); // 初始化开源信息功能
    initializeBackupSettings(); // 初始化备份设置区域

    // 在确定按钮存在后调用初始化函数
    // 确保在DOM完全加载后执行
    if (document.readyState === 'loading') { // 还在加载
        document.addEventListener('DOMContentLoaded', initScrollToTopButton);
    } else { // 'interactive' 或 'complete'
        initScrollToTopButton(); // 直接调用
    }

    // 加载自动备份状态并设置界面
    chrome.storage.local.get(['autoSync', 'initialized'], function (result) { // 使用 chrome.storage
        // 默认值：如果从未设置过，则默认为true (开启)
        const autoSyncEnabled = result.autoSync !== undefined ? result.autoSync : true;
        const initialized = result.initialized === true;

        // 设置开关状态
        const autoSyncToggle = document.getElementById('autoSyncToggle');
        const autoSyncToggle2 = document.getElementById('autoSyncToggle2');

        if (autoSyncToggle) autoSyncToggle.checked = autoSyncEnabled;
        if (autoSyncToggle2) autoSyncToggle2.checked = autoSyncEnabled;

        const backupModeAuto = document.getElementById('backupModeAuto');
        const backupModeManual = document.getElementById('backupModeManual');
        if (backupModeAuto) backupModeAuto.checked = autoSyncEnabled;
        if (backupModeManual) backupModeManual.checked = !autoSyncEnabled;

        const autoBackupSettingsBtnNew = document.getElementById('autoBackupSettingsBtnNew');
        const reminderSettingsBtnNew = document.getElementById('reminderSettingsBtnNew');
        if (autoBackupSettingsBtnNew) autoBackupSettingsBtnNew.style.display = autoSyncEnabled ? 'flex' : 'none';
        if (reminderSettingsBtnNew) reminderSettingsBtnNew.style.display = autoSyncEnabled ? 'none' : 'flex';

        // 获取手动备份按钮元素
        const manualSyncOptions = document.getElementById('manualSyncOptions');
        const manualButtonsContainer = document.getElementById('manualButtonsContainer'); // This variable is declared but not used.
        const reminderSettingsBtn = document.getElementById('reminderSettingsBtn');
        const uploadToCloudManual = document.getElementById('uploadToCloudManual');

        // 隐藏旧的容器（为了兼容性保留）
        if (manualSyncOptions) {
            manualSyncOptions.style.display = (initialized && !autoSyncEnabled) ? 'block' : 'none';
        }

        // 处理按钮的禁用状态和视觉效果（初始化时）
        if (initialized && reminderSettingsBtn && uploadToCloudManual) {
            if (autoSyncEnabled) {
                // 自动备份开启时，禁用按钮并应用玻璃效果/暗化
                reminderSettingsBtn.disabled = true;
                uploadToCloudManual.disabled = true;
                reminderSettingsBtn.classList.add('disabled');
                uploadToCloudManual.classList.add('disabled');
                // 移除可能存在的动画效果
                uploadToCloudManual.classList.remove('breathe-animation');
            } else {
                // 自动备份关闭时，启用按钮并恢复正常外观
                reminderSettingsBtn.disabled = false;
                uploadToCloudManual.disabled = false;
                reminderSettingsBtn.classList.remove('disabled');
                uploadToCloudManual.classList.remove('disabled');
                // 添加呼吸动画效果
                // uploadToCloudManual.classList.add('breathe-animation'); // Removed yellow glow effect
            }
        }

        // 初始化时同步自动备份设置按钮禁用状态
        const autoBackupSettingsBtnInit = document.getElementById('autoBackupSettingsBtn');
        if (autoBackupSettingsBtnInit) {
            if (autoSyncEnabled) {
                autoBackupSettingsBtnInit.disabled = false;
                autoBackupSettingsBtnInit.classList.remove('disabled');
            } else {
                autoBackupSettingsBtnInit.disabled = true;
                autoBackupSettingsBtnInit.classList.add('disabled');
            }
        }

        console.log('手动备份按钮显示状态:', manualButtonsContainer ? manualButtonsContainer.style.display : 'element not found');

        // 更新整体UI状态（例如备份状态区域的显示）
        const syncStatusDiv = document.getElementById('syncStatus');
        const initHeader = document.getElementById('initHeader');
        const initContent = document.getElementById('initContent');

        if (initialized) {
            if (initHeader && initContent) {
                initContent.style.display = 'none';
                initHeader.classList.add('collapsed');
            }
            if (syncStatusDiv) {
                syncStatusDiv.style.display = 'block';
            }
            updateSyncHistory(); // 加载备份历史
            updateLastSyncInfo(); // 新增：加载上次备份信息和书签计数
            initScrollToTopButton(); // 初始化滚动按钮

            // 恢复自动滚动逻辑
            // 使用setTimeout确保DOM更新和渲染完成后再滚动
            setTimeout(() => {
                // 需求：每次点击插件图标后，直接定位至「定位A」（无动画）
                scrollToPositionA('auto');
            }, 0); // 将延迟时间降为0，立即执行

        } else {
            if (initHeader && initContent) {
                initContent.style.display = 'block';
                initHeader.classList.remove('collapsed');
            }
            if (syncStatusDiv) {
                syncStatusDiv.style.display = 'none';
            }
        }

        requestAnimationFrame(() => {
            syncInitRightColumnHeights();
        });
    });

    // 调整本地配置中的标签左边距
    setTimeout(adjustLocalConfigLabels, 100);

    // 绑定自动备份开关事件监听 (确保只绑定一次)
    const autoSyncToggle = document.getElementById('autoSyncToggle');
    const autoSyncToggle2 = document.getElementById('autoSyncToggle2');

    if (autoSyncToggle && !autoSyncToggle.hasAttribute('data-listener-attached')) {
        autoSyncToggle.addEventListener('change', handleAutoSyncToggle);
        autoSyncToggle.setAttribute('data-listener-attached', 'true');
    }

    if (autoSyncToggle2 && !autoSyncToggle2.hasAttribute('data-listener-attached')) {
        autoSyncToggle2.addEventListener('change', handleAutoSyncToggle);
        autoSyncToggle2.setAttribute('data-listener-attached', 'true');
    }

    // 初始化重置按钮 (确保只绑定一次)
    const resetAllButton = document.getElementById('resetAll');
    const resetConfirmDialog = document.getElementById('resetConfirmDialog');
    const confirmResetButton = document.getElementById('confirmReset');
    const cancelResetButton = document.getElementById('cancelReset');

    if (resetAllButton && !resetAllButton.hasAttribute('data-listener-attached')) {
        resetAllButton.addEventListener('click', () => {
            if (resetConfirmDialog) {
                // 打开对话框前，先检查并加载初始备份记录
                chrome.storage.local.get(['initialBackupRecord', 'preferredLang'], function (data) {
                    const currentLang = data.preferredLang || 'zh_CN';

                    // 确保国际化字符串已经初始化
                    if (!initialBackupFileStrings || !backupTypeStrings || !timeStrings ||
                        !localBackupTypeStrings || !cloudBackupTypeStrings) {
                        // 如果变量尚未初始化，进行初始化
                        initialBackupFileStrings = {
                            'zh_CN': "您的初始备份文件：",
                            'en': "Your Initial Backup File:"
                        };
                        backupTypeStrings = {
                            'zh_CN': "备份类型:",
                            'en': "Backup Type:"
                        };
                        timeStrings = {
                            'zh_CN': "时间:",
                            'en': "Time:"
                        };
                        localBackupTypeStrings = {
                            'zh_CN': "本地",
                            'en': "Local"
                        };
                        cloudBackupTypeStrings = {
                            'zh_CN': "云端",
                            'en': "Cloud"
                        };
                    }

                    const initialBackupInfo = document.getElementById('initialBackupInfo');
                    const initialBackupFileName = document.getElementById('initialBackupFileName');

                    if (initialBackupInfo && initialBackupFileName) {
                        // 清除之前可能存在的内容
                        initialBackupFileName.textContent = '';
                        const oldTypeInfo = initialBackupFileName.nextElementSibling;
                        if (oldTypeInfo) {
                            oldTypeInfo.remove();
                        }

                        if (data.initialBackupRecord) {
                            // 设置文件名
                            initialBackupFileName.textContent = data.initialBackupRecord.fileName || '未知文件名';

                            // 获取备份类型
                            const backupType = data.initialBackupRecord.backupType || '未知';
                            // 格式化时间
                            let timeStr = '未知时间';
                            if (data.initialBackupRecord.time) {
                                try {
                                    const date = new Date(data.initialBackupRecord.time);
                                    timeStr = formatTime(date);
                                } catch (e) {
                                }
                            }

                            // 添加备份类型和时间信息
                            const backupTypeInfo = document.createElement('div');
                            backupTypeInfo.style.marginTop = '5px';
                            backupTypeInfo.style.fontSize = '12px';
                            backupTypeInfo.style.color = '#666';

                            // 获取对应语言的文本
                            const backupTypeText = backupTypeStrings[currentLang] || backupTypeStrings['zh_CN'];
                            const timeText = timeStrings[currentLang] || timeStrings['zh_CN'];

                            // 将本地/云端转换为当前语言
                            let localizedBackupType = backupType;
                            if (backupType === '本地') {
                                localizedBackupType = localBackupTypeStrings[currentLang] || localBackupTypeStrings['zh_CN'];
                            } else if (backupType === '云端') {
                                localizedBackupType = cloudBackupTypeStrings[currentLang] || cloudBackupTypeStrings['zh_CN'];
                            }

                            backupTypeInfo.textContent = `${backupTypeText} ${localizedBackupType}, ${timeText} ${timeStr}`;
                            initialBackupFileName.after(backupTypeInfo);

                            // 显示备份信息区域
                            initialBackupInfo.style.display = 'block';
                        } else {
                            // 没有备份记录时，隐藏信息区域
                            initialBackupInfo.style.display = 'none';
                        }
                    }

                    // 显示重置对话框
                    resetConfirmDialog.style.display = 'block';
                });
            }
        });
        resetAllButton.setAttribute('data-listener-attached', 'true');
    }

    if (cancelResetButton && !cancelResetButton.hasAttribute('data-listener-attached')) {
        cancelResetButton.addEventListener('click', () => {
            resetConfirmDialog.style.display = 'none';
        });
        cancelResetButton.setAttribute('data-listener-attached', 'true');
    }

    if (confirmResetButton && !confirmResetButton.hasAttribute('data-listener-attached')) {
        confirmResetButton.addEventListener('click', () => {
            confirmResetButton.disabled = true;
            showStatus('正在恢复初始状态...', 'info');

            // 立即隐藏对话框
            resetConfirmDialog.style.display = 'none';

            // 发送重置请求
            chrome.runtime.sendMessage({ action: 'resetAllData' }, (response) => {
                if (response && response.success) {
                    showStatus('已恢复到初始状态', 'success');

                    // 清除 popup 的 localStorage（与 history.html 共享同一个扩展源）
                    // 这会清除本地偏好设置
                    try {
                        localStorage.clear();
                        console.log('[resetAllData] popup localStorage 已清除');
                    } catch (e) {
                        console.warn('[resetAllData] 清除 localStorage 失败:', e);
                    }

                    // 重置完成后，直接刷新整个页面，确保UI和状态完全重建
                    setTimeout(() => {
                        window.location.reload(true);
                    }, 500);
                } else {
                    showStatus('恢复失败: ' + (response?.error || '未知错误'), 'error');
                    confirmResetButton.disabled = false;
                }
            });
        });
        confirmResetButton.setAttribute('data-listener-attached', 'true');
    }

    // 点击背景关闭重置对话框
    if (resetConfirmDialog && !resetConfirmDialog.hasAttribute('data-listener-attached')) {
        resetConfirmDialog.addEventListener('click', (e) => {
            if (e.target === resetConfirmDialog) {
                resetConfirmDialog.style.display = 'none';
            }
        });
        resetConfirmDialog.setAttribute('data-listener-attached', 'true');
    }

    // 上传按钮事件绑定 (确保只绑定一次)
    const uploadToCloud = document.getElementById('uploadToCloud');
    const uploadToCloudManual = document.getElementById('uploadToCloudManual');

    if (uploadToCloud && !uploadToCloud.hasAttribute('data-listener-attached')) {
        uploadToCloud.addEventListener('click', handleInitUpload); // <-- 修改绑定的函数
        uploadToCloud.setAttribute('data-listener-attached', 'true');
    }

    if (uploadToCloudManual && !uploadToCloudManual.hasAttribute('data-listener-attached')) {
        uploadToCloudManual.addEventListener('click', handleManualUpload); // <-- 保持不变
        uploadToCloudManual.setAttribute('data-listener-attached', 'true');
    }

    // [New] 恢复按钮监听
    const restoreWebDAVBtn = document.getElementById('restoreFromWebDAVBtn');
    const restoreGitHubBtn = document.getElementById('restoreFromGitHubBtn');
    const restoreLocalBtn = document.getElementById('restoreFromLocalBtn');

    if (restoreWebDAVBtn && !restoreWebDAVBtn.hasAttribute('data-listener-attached')) {
        restoreWebDAVBtn.addEventListener('click', () => handleRestoreFromCloud('webdav'));
        restoreWebDAVBtn.setAttribute('data-listener-attached', 'true');
    }
    if (restoreGitHubBtn && !restoreGitHubBtn.hasAttribute('data-listener-attached')) {
        restoreGitHubBtn.addEventListener('click', () => handleRestoreFromCloud('github'));
        restoreGitHubBtn.setAttribute('data-listener-attached', 'true');
    }
    if (restoreLocalBtn && !restoreLocalBtn.hasAttribute('data-listener-attached')) {
        restoreLocalBtn.addEventListener('click', () => handleRestoreFromCloud('local'));
        restoreLocalBtn.setAttribute('data-listener-attached', 'true');
    }

    // 初始化上传按钮图标与恢复面板显示
    updateUploadButtonIcons();

    const webDAVToggleEl = document.getElementById('webDAVToggle');
    const githubRepoToggleEl = document.getElementById('githubRepoToggle');
    const defaultDownloadToggleEl = document.getElementById('defaultDownloadToggle');

    if (webDAVToggleEl) {
        webDAVToggleEl.addEventListener('change', updateUploadButtonIcons);
    }
    if (githubRepoToggleEl) {
        githubRepoToggleEl.addEventListener('change', updateUploadButtonIcons);
    }
    if (defaultDownloadToggleEl) {
        defaultDownloadToggleEl.addEventListener('change', updateUploadButtonIcons);
    }

    // [New] 同步与恢复帮助按钮
    const syncRestoreHelpBtn = document.getElementById('syncRestoreHelpBtn');
    let syncRestoreHelpTooltip = null;

    if (syncRestoreHelpBtn) {
        syncRestoreHelpBtn.addEventListener('mouseenter', () => {
            if (!syncRestoreHelpTooltip) {
                syncRestoreHelpTooltip = document.createElement('div');
                syncRestoreHelpTooltip.style.cssText = `
                    position: fixed;
                    z-index: 99999;
                    background-color: var(--theme-bg-elevated);
                    border: 1px solid var(--theme-border-primary);
                    border-radius: 8px;
                    padding: 12px;
                    box-shadow: 0 8px 24px rgba(0,0,0,0.25);
                    width: 320px;
                    pointer-events: none;
                    opacity: 0;
                    transform: translateY(10px);
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                `;

                // 获取当前语言
                chrome.storage.local.get(['preferredLang', 'currentLang'], (res) => {
                    const lang = res?.currentLang || res?.preferredLang || 'zh_CN';
                    const isEn = lang === 'en';

                    syncRestoreHelpTooltip.innerHTML = `
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                            <div style="font-weight: 700; font-size: 13px; color: var(--theme-text-primary);">
                                ${isEn ? '📂 Restore Guide' : '📂 恢复说明'}
                            </div>
                            <div style="font-size: 11px; color: var(--theme-text-secondary); line-height: 1.55; padding: 6px 8px; background: var(--theme-bg-secondary); border-radius: 6px;">
                                ${isEn
        ? '• Overwrite Restore: deletes current bookmarks, then rebuilds from the target snapshot. Bookmark IDs will change and may affect features like Records/Recommendations<br>• Import Merge: imports into a new folder and keeps existing bookmarks'
        : '• 覆盖恢复：先删除当前书签，再按目标快照重建。Bookmark ID 会变化，可能影响书签记录、书签推荐等功能<br>• 导入合并：导入到新文件夹，保留现有书签'}
                            </div>

                            <div style="font-size: 10px; color: var(--theme-warning-color); padding: 6px 8px; background: rgba(255, 152, 0, 0.08); border-radius: 4px;">
                                ${isEn ? 'Scanned version list is temporary cache.' : '扫描出的版本列表是临时缓存。'}
                            </div>
                        </div>
                    `;
                    document.body.appendChild(syncRestoreHelpTooltip);

                    // 计算位置
                    const rect = syncRestoreHelpBtn.getBoundingClientRect();
                    let top = rect.bottom + 8;
                    let left = rect.left - 100;

                    if (top + syncRestoreHelpTooltip.offsetHeight + 12 > window.innerHeight) {
                        top = rect.top - syncRestoreHelpTooltip.offsetHeight - 8;
                    }
                    if (left + syncRestoreHelpTooltip.offsetWidth + 10 > window.innerWidth) {
                        left = window.innerWidth - syncRestoreHelpTooltip.offsetWidth - 10;
                    }
                    if (left < 10) left = 10;

                    syncRestoreHelpTooltip.style.top = top + 'px';
                    syncRestoreHelpTooltip.style.left = left + 'px';

                    requestAnimationFrame(() => {
                        if (syncRestoreHelpTooltip) {
                            syncRestoreHelpTooltip.style.opacity = '1';
                            syncRestoreHelpTooltip.style.transform = 'translateY(0)';
                        }
                    });
                });
            }
        });

        syncRestoreHelpBtn.addEventListener('mouseleave', () => {
            if (syncRestoreHelpTooltip) {
                syncRestoreHelpTooltip.style.opacity = '0';
                syncRestoreHelpTooltip.style.transform = 'translateY(5px)';

                const tooltipToRemove = syncRestoreHelpTooltip;
                syncRestoreHelpTooltip = null;

                setTimeout(() => {
                    tooltipToRemove.remove();
                }, 200);
            }
        });
    }

    // 当前变化「视图」模式帮助按钮
    const currentChangesArchiveModeHelpBtn = document.getElementById('currentChangesArchiveModeHelpBtn');
    let currentChangesModeHelpTooltip = null;

    const removeCurrentChangesModeHelpTooltip = () => {
        if (!currentChangesModeHelpTooltip) return;
        currentChangesModeHelpTooltip.style.opacity = '0';
        currentChangesModeHelpTooltip.style.transform = 'translateY(5px)';
        const tooltipToRemove = currentChangesModeHelpTooltip;
        currentChangesModeHelpTooltip = null;
        setTimeout(() => {
            tooltipToRemove.remove();
        }, 200);
    };

    const showCurrentChangesModeHelpTooltip = () => {
        if (currentChangesModeHelpTooltip || !currentChangesArchiveModeHelpBtn) return;

        currentChangesModeHelpTooltip = document.createElement('div');
        currentChangesModeHelpTooltip.style.cssText = `
            position: fixed;
            z-index: 99999;
            background-color: var(--theme-bg-elevated);
            border: 1px solid var(--theme-border-primary);
            border-radius: 8px;
            padding: 12px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.25);
            width: 360px;
            pointer-events: none;
            opacity: 0;
            transform: translateY(10px);
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        `;

        chrome.storage.local.get(['preferredLang', 'currentLang'], (res) => {
            const lang = res?.currentLang || res?.preferredLang || 'zh_CN';
            const isEn = lang === 'en';

            if (!currentChangesModeHelpTooltip) return;

            currentChangesModeHelpTooltip.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <div style="font-weight: 700; font-size: 13px; color: var(--theme-text-primary);">
                        ${isEn ? 'View Modes' : '视图模式说明'}
                    </div>
                    <div style="font-size: 11px; color: var(--theme-text-secondary); line-height: 1.55; padding: 6px 8px; background: var(--theme-bg-secondary); border-radius: 6px;">
                        ${isEn
        ? 'Simple: Keep changed branches with native bookmark-tree hierarchy.'
        : '简略：仅保留有变化的分支，并保持原生书签树层级。'}
                    </div>
                    <div style="font-size: 11px; color: var(--theme-text-secondary); line-height: 1.55; padding: 6px 8px; background: var(--theme-bg-secondary); border-radius: 6px;">
                        ${isEn
        ? 'Detailed: Export by the expansion state in the HTML Current Changes page (WYSIWYG).'
        : '详细：按 html 页面「当前变化」的展开状态导出（所见即所得）。'}
                    </div>
                    <div style="font-size: 11px; color: var(--theme-text-secondary); line-height: 1.55; padding: 6px 8px; background: var(--theme-bg-secondary); border-radius: 6px;">
                        ${isEn
        ? 'Collection: Group by added, deleted, moved, and modified operations; exported as folder collections without paths.'
        : '集合：按增加、删除、移动、修改分组，导出为文件夹集合且无路径。'}
                    </div>
                </div>
            `;

            document.body.appendChild(currentChangesModeHelpTooltip);

            const rect = currentChangesArchiveModeHelpBtn.getBoundingClientRect();
            let top = rect.bottom + 8;
            let left = rect.left - 150;

            if (top + currentChangesModeHelpTooltip.offsetHeight + 12 > window.innerHeight) {
                top = rect.top - currentChangesModeHelpTooltip.offsetHeight - 8;
            }
            if (left + currentChangesModeHelpTooltip.offsetWidth + 10 > window.innerWidth) {
                left = window.innerWidth - currentChangesModeHelpTooltip.offsetWidth - 10;
            }
            if (left < 10) left = 10;

            currentChangesModeHelpTooltip.style.top = top + 'px';
            currentChangesModeHelpTooltip.style.left = left + 'px';

            requestAnimationFrame(() => {
                if (currentChangesModeHelpTooltip) {
                    currentChangesModeHelpTooltip.style.opacity = '1';
                    currentChangesModeHelpTooltip.style.transform = 'translateY(0)';
                }
            });
        });
    };

    if (currentChangesArchiveModeHelpBtn) {
        currentChangesArchiveModeHelpBtn.addEventListener('mouseenter', showCurrentChangesModeHelpTooltip);
        currentChangesArchiveModeHelpBtn.addEventListener('mouseleave', removeCurrentChangesModeHelpTooltip);
        currentChangesArchiveModeHelpBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (currentChangesModeHelpTooltip) {
                removeCurrentChangesModeHelpTooltip();
            } else {
                showCurrentChangesModeHelpTooltip();
            }
        });
    }

    // 初始化区块切换事件 (确保只绑定一次)
    const initHeader = document.getElementById('initHeader');
    const initContent = document.getElementById('initContent');
    if (initHeader && !initHeader.hasAttribute('data-listener-attached')) {
        initHeader.addEventListener('click', function () {
            // 切换内容区域显示状态
            toggleConfigPanel(initContent, initHeader);
        });
        initHeader.setAttribute('data-listener-attached', 'true');
    }

    // ... (其他初始化代码，包括加载状态和绑定其他事件)

    // ... (例如，在加载initialized状态后也调用，确保按钮可用时监听器附加)
    chrome.storage.local.get(['initialized'], function (result) { // 使用 chrome.storage
        if (result.initialized) {
            // 确保按钮存在再调用一次，覆盖之前的绑定或在按钮动态添加后绑定
            initScrollToTopButton();
        }
        // ... 其他处理 initialized 状态的逻辑 ...
    });

    // 在document.addEventListener('DOMContentLoaded')事件的结尾添加清空和导出按钮的事件监听
    // 添加导出和清空历史记录的事件监听
    const exportHistoryBtn = document.getElementById('exportHistoryBtn');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');

    // 导出/清空按钮已隐藏，功能已迁移至历史页面的全局导出
    /*
    if (exportHistoryBtn) {
        // 添加导出功能
        exportHistoryBtn.addEventListener('click', exportSyncHistory);

        // 添加悬停提示
        exportHistoryBtn.addEventListener('mouseenter', function () {
            const tooltip = this.querySelector('.tooltip');
            if (tooltip) {
                tooltip.style.visibility = 'visible';
                tooltip.style.opacity = '1';
            }
        });

        exportHistoryBtn.addEventListener('mouseleave', function () {
            const tooltip = this.querySelector('.tooltip');
            if (tooltip) {
                tooltip.style.visibility = 'hidden';
                tooltip.style.opacity = '0';
            }
        });
    }

    if (clearHistoryBtn) {
        // 修改清空功能，先显示确认对话框
        clearHistoryBtn.addEventListener('click', function () {
            // 显示确认对话框
            const clearHistoryConfirmDialog = document.getElementById('clearHistoryConfirmDialog');
            if (clearHistoryConfirmDialog) {
                clearHistoryConfirmDialog.style.display = 'block';
            }
        });

        // 添加悬停提示
        clearHistoryBtn.addEventListener('mouseenter', function () {
            const tooltip = this.querySelector('.tooltip');
            if (tooltip) {
                tooltip.style.visibility = 'visible';
                tooltip.style.opacity = '1';
            }
        });

        clearHistoryBtn.addEventListener('mouseleave', function () {
            const tooltip = this.querySelector('.tooltip');
            if (tooltip) {
                tooltip.style.visibility = 'hidden';
                tooltip.style.opacity = '0';
            }
        });
    }
    */

    // 添加「历史查看器」按钮事件监听
    const openHistoryViewerBtn = document.getElementById('openHistoryViewerBtn');
    if (openHistoryViewerBtn) {
        // 设置 tooltip 文本（根据语言）
        chrome.storage.local.get(['preferredLang'], function (result) {
            const currentLang = result.preferredLang || 'zh_CN';
            const tooltip = document.getElementById('historyViewerTooltip');
            if (tooltip) {
                tooltip.textContent = currentLang === 'zh_CN' ? '跳转至HTML页面' : 'Open HTML page';
            }
        });

        openHistoryViewerBtn.addEventListener('click', async function () {
            // 打开历史查看器页面，明确指定视图为 backup history
            await safeCreateTab({ url: chrome.runtime.getURL('history_html/history.html?view=history') });
        });

        // 添加悬停提示
        openHistoryViewerBtn.addEventListener('mouseenter', function () {
            const tooltip = document.getElementById('historyViewerTooltip');
            if (tooltip) {
                tooltip.style.visibility = 'visible';
                tooltip.style.opacity = '1';
            }
            // hover 效果
            this.style.backgroundColor = '#0050B3';
            this.style.boxShadow = '0 2px 6px rgba(0, 122, 255, 0.3)';
            this.style.transform = 'translateY(-1px)';
        });

        openHistoryViewerBtn.addEventListener('mouseleave', function () {
            const tooltip = document.getElementById('historyViewerTooltip');
            if (tooltip) {
                tooltip.style.visibility = 'hidden';
                tooltip.style.opacity = '0';
            }
            // 恢复样式
            this.style.backgroundColor = '#007AFF';
            this.style.boxShadow = 'none';
            this.style.transform = 'translateY(0)';
        });
    }

    // 添加状态卡片点击事件 - 直接跳转到当前变化视图
    const statusCard = document.getElementById('change-description-row');
    if (statusCard) {
        statusCard.addEventListener('click', async function () {
            // 打开历史查看器的当前变化视图
            const url = chrome.runtime.getURL('history_html/history.html?view=current-changes');
            await safeCreateTab({ url: url });
        });

        // 添加 hover 效果
        statusCard.addEventListener('mouseenter', function () {
            this.style.transform = 'scale(1.02)';
            this.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
        });

        statusCard.addEventListener('mouseleave', function () {
            this.style.transform = 'scale(1)';
            this.style.boxShadow = '';
        });
    }

    // 添加清空历史记录确认对话框的按钮事件监听
    const confirmClearHistory = document.getElementById('confirmClearHistory');
    const cancelClearHistory = document.getElementById('cancelClearHistory');
    const clearHistoryConfirmDialog = document.getElementById('clearHistoryConfirmDialog');

    if (confirmClearHistory && clearHistoryConfirmDialog) {
        confirmClearHistory.addEventListener('click', function () {
            // 隐藏对话框
            clearHistoryConfirmDialog.style.display = 'none';
            // 执行清空操作
            clearSyncHistory();
        });
    }

    if (cancelClearHistory && clearHistoryConfirmDialog) {
        cancelClearHistory.addEventListener('click', function () {
            // 隐藏对话框
            clearHistoryConfirmDialog.style.display = 'none';
        });
    }

    // 初始化备份模式切换 (Settings & Initialization checkboxes)
    const backupModeAuto = document.getElementById('backupModeAuto');
    const backupModeManual = document.getElementById('backupModeManual');

    // 通用切换函数
    const handleModeChange = function (targetMode) {
        const autoSyncToggle2 = document.getElementById('autoSyncToggle2');
        if (!autoSyncToggle2) return;

        const currentMode = autoSyncToggle2.checked ? 'auto' : 'manual';
        if (targetMode === currentMode) return; // No change

        if (targetMode === 'auto') {
            autoSyncToggle2.checked = true;
            autoSyncToggle2.dispatchEvent(new Event('change'));
        } else {
            autoSyncToggle2.checked = false;
            autoSyncToggle2.dispatchEvent(new Event('change'));
        }
    };

    if (backupModeAuto) {
        backupModeAuto.addEventListener('change', function (e) {
            if (e.target.checked) {
                // Uncheck manual
                if (backupModeManual) backupModeManual.checked = false;
                handleModeChange('auto');
            } else {
                // Prevent unchecking if it's the only one
                if (backupModeManual && !backupModeManual.checked) {
                    backupModeManual.checked = true;
                    handleModeChange('manual');
                }
            }
        });
    }

    if (backupModeManual) {
        backupModeManual.addEventListener('change', function (e) {
            if (e.target.checked) {
                // Uncheck auto
                if (backupModeAuto) backupModeAuto.checked = false;
                handleModeChange('manual');
            } else {
                // Prevent unchecking if it's the only one
                if (backupModeAuto && !backupModeAuto.checked) {
                    backupModeAuto.checked = true;
                    handleModeChange('auto');
                }
            }
        });
    }

    // 初始化备份状态
    chrome.storage.local.get(['autoSync'], function (result) {
        const autoSyncEnabled = result.autoSync !== undefined ? result.autoSync : true;

        // Initialize status card and tips
        // backupModeSwitch is removed from HTML, so we skip its class toggling

        // 初始化右侧状态卡片的配色
        const changeDescriptionContainerAtInit = document.getElementById('change-description-row');
        if (changeDescriptionContainerAtInit) {
            if (autoSyncEnabled) {
                changeDescriptionContainerAtInit.classList.add('auto-mode');
                changeDescriptionContainerAtInit.classList.remove('manual-mode');
            } else {
                changeDescriptionContainerAtInit.classList.add('manual-mode');
                changeDescriptionContainerAtInit.classList.remove('auto-mode');
            }
        }

        // 初始化提示文本显示状态
        const autoTip = document.querySelector('.mode-tip.auto-tip');
        const manualTip = document.querySelector('.mode-tip.manual-tip');

        if (autoTip && manualTip) {
            if (autoSyncEnabled) {
                autoTip.style.display = 'inline-block';
                manualTip.style.display = 'none';
            } else {
                autoTip.style.display = 'none';
                manualTip.style.display = 'inline-block';
            }
        }

        // Phase 2.1: Initialize New UI Elements
        const backupModeAuto = document.getElementById('backupModeAuto');
        const backupModeManual = document.getElementById('backupModeManual');
        if (backupModeAuto) backupModeAuto.checked = autoSyncEnabled;
        if (backupModeManual) backupModeManual.checked = !autoSyncEnabled;

        const autoBackupSettingsBtnNew = document.getElementById('autoBackupSettingsBtnNew');
        const reminderSettingsBtnNew = document.getElementById('reminderSettingsBtnNew');
        const manualBackupBtnOverlay = document.getElementById('manualBackupBtnOverlay');

        if (autoSyncEnabled) {
            if (autoBackupSettingsBtnNew) autoBackupSettingsBtnNew.style.display = 'flex';
            if (reminderSettingsBtnNew) reminderSettingsBtnNew.style.display = 'none';
            if (manualBackupBtnOverlay) manualBackupBtnOverlay.style.display = 'none';
        } else {
            if (autoBackupSettingsBtnNew) autoBackupSettingsBtnNew.style.display = 'none';
            if (reminderSettingsBtnNew) reminderSettingsBtnNew.style.display = 'flex';
            if (manualBackupBtnOverlay) manualBackupBtnOverlay.style.display = 'flex';
        }
    });

    // Initialize Manual Backup Overlay Button
    const manualBackupBtnOverlay = document.getElementById('manualBackupBtnOverlay');
    if (manualBackupBtnOverlay) {
        manualBackupBtnOverlay.addEventListener('click', function (e) {
            e.stopPropagation(); // Prevent card click
            handleManualUpload();
        });
    }

    // 监听来自后台的书签变化消息和获取变化描述请求
    chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
        if (message && message.action === "bookmarkChanged") {
            // 更新书签计数和状态显示
            updateBookmarkCountDisplay();
            // 返回成功响应
            sendResponse({ success: true });
            return true;
        } else if (message && message.action === "getChangeDescription") {
            // 获取变化描述内容
            try {
                // 获取显示变化描述的容器元素（优先取内容区，避免包含按钮/图标文字）
                const statusCardText = document.getElementById('statusCardText');
                const changeDescriptionContainer = statusCardText || document.getElementById('change-description-row');
                if (changeDescriptionContainer) {
                    // 返回HTML内容中的纯文本
                    const htmlContent = changeDescriptionContainer.innerHTML || "";
                    // 创建临时div提取纯文本
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = htmlContent;
                    const content = tempDiv.textContent || tempDiv.innerText || "";

                    sendResponse({
                        success: true,
                        content: content
                    });
                } else {
                    sendResponse({
                        success: false,
                        error: "未找到变化描述容器元素",
                        content: "" // 提供空内容
                    });
                }
            } catch (error) {
                sendResponse({
                    success: false,
                    error: error.message,
                    content: "" // 提供空内容
                });
            }
            return true; // 异步响应
        }
    });

    // 绑定手动备份动态提醒设置相关功能
    // 获取元素
    const reminderSettingsBtn = document.getElementById('reminderSettingsBtn');
    const closeReminderSettings = document.getElementById('closeReminderSettings');
    const reminderSettingsDialog = document.getElementById('reminderSettingsDialog');
    const reminderToggle = document.getElementById('reminderToggle');
    const firstReminderMinutes = document.getElementById('firstReminderMinutes');
    const fixedTimeToggle1 = document.getElementById('fixedTimeToggle1');
    const fixedTime1 = document.getElementById('fixedTime1');
    const fixedTimeToggle2 = document.getElementById('fixedTimeToggle2');
    const fixedTime2 = document.getElementById('fixedTime2');
    const restoreDefaultSettings = document.getElementById('restoreDefaultSettings');
    const saveReminderSettings = document.getElementById('saveReminderSettings');
    const settingsSavedIndicator = document.getElementById('settingsSavedIndicator');

    // 设置开关点击事件监听
    if (reminderToggle) {
        reminderToggle.addEventListener('click', function () {
            const currentState = getToggleState(this);
            updateToggleState(this, !currentState);
        });
    }

    if (fixedTimeToggle1) {
        fixedTimeToggle1.addEventListener('click', function () {
            const currentState = getToggleState(this);
            updateToggleState(this, !currentState);
        });
    }

    if (fixedTimeToggle2) {
        fixedTimeToggle2.addEventListener('click', function () {
            const currentState = getToggleState(this);
            updateToggleState(this, !currentState);
        });
    }

    // 绑定设置面板打开按钮点击事件
    if (reminderSettingsBtn) {
        reminderSettingsBtn.addEventListener('click', async function () {
            // 暂停计时器
            await pauseTimerForSettings();

            // 加载最新设置
            await loadReminderSettings();

            // 显示设置对话框
            if (reminderSettingsDialog) {
                reminderSettingsDialog.style.display = 'block';
            }
        });
    }

    // 绑定设置面板关闭按钮点击事件
    if (closeReminderSettings) {
        closeReminderSettings.addEventListener('click', async function () {
            // 隐藏设置对话框
            if (reminderSettingsDialog) {
                reminderSettingsDialog.style.display = 'none';
            }

            // 恢复计时器
            await resumeTimerForSettings();
        });
    }

    // 绑定恢复默认设置按钮点击事件
    if (restoreDefaultSettings) {
        restoreDefaultSettings.addEventListener('click', async () => {
            // 默认值
            const defaultSettings = {
                reminderEnabled: true,
                firstReminderMinutes: 30,
                fixedTimeEnabled1: true,
                fixedTime1: "09:30",
                fixedTimeEnabled2: false,
                fixedTime2: "16:00"
            };
            // 恢复默认设置
            updateToggleState(reminderToggle, defaultSettings.reminderEnabled);
            firstReminderMinutes.value = defaultSettings.firstReminderMinutes;
            updateToggleState(fixedTimeToggle1, defaultSettings.fixedTimeEnabled1);
            fixedTime1.value = defaultSettings.fixedTime1;
            updateToggleState(fixedTimeToggle2, defaultSettings.fixedTimeEnabled2);
            fixedTime2.value = defaultSettings.fixedTime2;

            // 设置提示文本为"已恢复默认设置"，此文本将被 saveReminderSettingsFunc 使用
            settingsSavedIndicator.textContent = window.i18nLabels.settingsRestoredStrings || '已恢复默认设置';
            settingsSavedIndicator.style.color = ''; // 重置文本颜色

            // 尝试保存这些恢复后的默认设置
            // saveReminderSettingsFunc 会在内部调用 showSettingsSavedIndicator
            const saveSuccess = await saveReminderSettingsFunc();

            if (!saveSuccess) {
                // 如果保存失败，显示错误信息
                settingsSavedIndicator.textContent = window.i18nLabels.saveFailedStrings || '保存设置失败';
                settingsSavedIndicator.style.color = '#c62828'; // 使用标准错误颜色
                showSettingsSavedIndicator(); // 显示错误提示
            }
            // 如果 saveSuccess 为 true，则 saveReminderSettingsFunc 已成功显示了"已恢复默认设置"的提示
        });
    }

    // 绑定保存设置按钮点击事件
    if (saveReminderSettings) {
        saveReminderSettings.addEventListener('click', async function () {
            const success = await saveReminderSettingsFunc();

            if (success) {
                // 使用国际化字符串
                settingsSavedIndicator.textContent = window.i18nLabels.settingsSavedStrings || '设置已保存';

                // 显示保存成功提示，然后自动关闭对话框
                showSettingsSavedIndicator();

                // 1秒后自动关闭对话框
                setTimeout(() => {
                    if (reminderSettingsDialog) {
                        reminderSettingsDialog.style.display = 'none';
                    }
                    // 保存设置后，新设置立即生效，不需要额外恢复计时器
                }, 1000);
            } else {
                // 使用国际化字符串
                settingsSavedIndicator.textContent = window.i18nLabels.saveFailedStrings || '保存设置失败';
                settingsSavedIndicator.style.color = '#c62828';
                showSettingsSavedIndicator();
            }
        });
    }

    // 点击对话框外部关闭对话框
    if (reminderSettingsDialog) {
        reminderSettingsDialog.addEventListener('click', function (event) {
            const dialogContent = reminderSettingsDialog.querySelector('.modal-content');

            // 判断点击是否在对话框外部
            const isOutsideDialog = event.target === reminderSettingsDialog ||
                (dialogContent && !dialogContent.contains(event.target));

            if (isOutsideDialog) {
                // 关闭对话框
                reminderSettingsDialog.style.display = 'none';

                // 修改: 添加标记表明是通过UI操作关闭的，避免与连接断开的恢复操作冲突
                window.reminderDialogUserClosed = true;

                // 恢复计时器
                resumeTimerForSettings();
                // 2秒后清除标记，允许后续的连接断开处理
                setTimeout(() => {
                    window.reminderDialogUserClosed = false;
                }, 2000);
            }
        });
    }

    // ================================
    // 自动备份设置对话框（新UI）
    // ================================

    // 辅助函数：隐藏所有"Back to Top"按钮
    function hideAllScrollToTopButtons() {
        // 设置全局标志
        isDialogOpen = true;

        const scrollToTopFloating = document.getElementById('scrollToTopFloating');
        const scrollToTopBtn = document.getElementById('scrollToTopBtn');
        const scrollToTopEmbedded = document.getElementById('scrollToTopEmbedded');

        if (scrollToTopFloating) scrollToTopFloating.style.display = 'none';
        if (scrollToTopBtn) scrollToTopBtn.style.display = 'none';
        if (scrollToTopEmbedded) scrollToTopEmbedded.style.display = 'none';
    }

    // 辅助函数：恢复"Back to Top"按钮的自动显示逻辑
    function restoreScrollToTopButtons() {
        // 清除全局标志
        isDialogOpen = false;

        // 触发一次滚动事件来重新计算按钮的显示状态
        window.dispatchEvent(new Event('scroll'));
    }

    const autoBackupSettingsBtnEl = document.getElementById('autoBackupSettingsBtn');
    const autoBackupSettingsDialog = document.getElementById('autoBackupSettingsDialog');
    const closeAutoBackupSettingsBtn = document.getElementById('closeAutoBackupSettings');
    const autoBackupSettingsTitle = document.getElementById('autoBackupSettingsTitle');
    const realtimeBackupRow = document.getElementById('realtimeBackupRow');
    const realtimeBackupTitle = document.getElementById('realtimeBackupTitle');
    const realtimeBackupDesc1 = document.getElementById('realtimeBackupDesc1');
    const realtimeBackupDesc2 = document.getElementById('realtimeBackupDesc2');
    const realtimeBackupToggle = document.getElementById('realtimeBackupToggle');
    const restoreAutoBackupDefaultsBtn = document.getElementById('restoreAutoBackupDefaults');
    const saveAutoBackupSettingsBtn = document.getElementById('saveAutoBackupSettings');

    function showAutoBackupSettingsSavedIndicator() {
        const el = document.getElementById('autoBackupSettingsSavedIndicator');
        if (!el) return;
        el.style.display = 'block';
        el.style.opacity = '0';
        setTimeout(() => {
            el.style.opacity = '1';
            setTimeout(() => {
                el.style.opacity = '0';
                setTimeout(() => { el.style.display = 'none'; }, 300);
            }, 1200);
        }, 10);
    }

    async function initRealtimeBackupToggle() {
        try {
            const data = await new Promise(resolve => chrome.storage.local.get(['realtimeBackupEnabled'], resolve));
            const enabled = (data && data.realtimeBackupEnabled !== false);
            updateToggleState(realtimeBackupToggle, !!enabled);
        } catch (e) {
            updateToggleState(realtimeBackupToggle, true);
        }
    }

    async function applyAutoBackupSettingsLanguage() {
        try {
            const { preferredLang } = await new Promise(resolve => chrome.storage.local.get(['preferredLang'], resolve));
            const isEN = (preferredLang === 'en');

            if (autoBackupSettingsTitle) {
                autoBackupSettingsTitle.textContent = isEN ? 'Auto Backup Settings' : '自动备份设置';
            }
            if (realtimeBackupTitle) {
                realtimeBackupTitle.textContent = isEN ? 'Realtime Backup' : '实时备份';
            }
            if (realtimeBackupDesc1) {
                realtimeBackupDesc1.textContent = isEN
                    ? 'Backs up immediately on count/structure changes*,'
                    : '当检测到「数量/结构变化」* 时立即执行备份，';
            }
            if (realtimeBackupDesc2) {
                // 添加示例文本（与动态提醒设置的示例一致）
                realtimeBackupDesc2.innerHTML = isEN
                    ? "example: (<span style=\"color: #4CAF50;\">+12</span> BKM, <span style=\"color: #4CAF50;\">+1</span> FLD, <span style=\"color: orange;\">BKM & FLD changed</span>)."
                    : "示例：(<span style=\"color: #4CAF50;\">+12</span> 书签，<span style=\"color: #4CAF50;\">+1</span> 文件夹，<span style=\"color: orange;\">书签、文件夹变动</span>)。";
            }
            if (restoreAutoBackupDefaultsBtn) {
                restoreAutoBackupDefaultsBtn.textContent = isEN ? 'Restore Defaults' : '恢复默认';
            }
            if (saveAutoBackupSettingsBtn) {
                const saveText = isEN ? 'Save' : '保存';
                saveAutoBackupSettingsBtn.textContent = saveText;
                saveAutoBackupSettingsBtn.setAttribute('aria-label', saveText);
                saveAutoBackupSettingsBtn.setAttribute('title', saveText);
            }
            const savedIndicator = document.getElementById('autoBackupSettingsSavedIndicator');
            if (savedIndicator) {
                savedIndicator.textContent = isEN ? 'Saved' : '设置已保存';
            }

        } catch (e) {
            // ignore
        }
    }

    if (autoBackupSettingsBtnEl && autoBackupSettingsDialog) {
        autoBackupSettingsBtnEl.addEventListener('click', async function () {
            // 初始化自动备份定时器UI（首次打开时）
            console.log('[自动备份设置] 开始初始化UI...');
            const container = document.getElementById('autoBackupTimerUIContainer');
            console.log('[自动备份设置] 容器元素:', container);

            if (!container) {
                console.error('[自动备份设置] 找不到容器元素 autoBackupTimerUIContainer');
                alert('错误：找不到UI容器元素');
            } else {
                // 检查是否已经初始化（通过查找我们创建的特定元素）
                const alreadyInitialized = container.querySelector('#autoBackupTimerContainer');

                if (!alreadyInitialized) {
                    console.log('[自动备份设置] 首次初始化，开始创建UI');
                    try {
                        const lang = await new Promise(resolve => {
                            chrome.storage.local.get(['preferredLang'], result => {
                                resolve(result.preferredLang || 'zh_CN');
                            });
                        });
                        console.log('[自动备份设置] 当前语言:', lang);

                        // 清空容器（移除测试内容）
                        container.innerHTML = '';

                        // 创建并插入UI
                        console.log('[自动备份设置] 调用 createAutoBackupTimerUI...');
                        const ui = createAutoBackupTimerUI(lang);
                        console.log('[自动备份设置] UI创建成功:', ui);

                        container.appendChild(ui);
                        console.log('[自动备份设置] UI已插入到容器');

                        // 初始化UI事件
                        console.log('[自动备份设置] 初始化UI事件...');
                        await initializeAutoBackupTimerUIEvents();

                        // 加载设置
                        console.log('[自动备份设置] 加载设置...');
                        await loadAutoBackupSettings();
                        console.log('[自动备份设置] 初始化完成！');
                    } catch (error) {
                        console.error('[自动备份设置] 初始化失败:', error);
                        console.error('[自动备份设置] 错误堆栈:', error.stack);
                        container.innerHTML = '';
                        const wrapper = document.createElement('div');
                        wrapper.style.color = 'red';
                        wrapper.style.padding = '20px';

                        const msg = document.createElement('div');
                        msg.textContent = `初始化失败: ${error && error.message ? error.message : String(error)}`;

                        const pre = document.createElement('pre');
                        pre.textContent = (error && error.stack) ? error.stack : '';

                        wrapper.appendChild(msg);
                        wrapper.appendChild(pre);
                        container.appendChild(wrapper);
                    }
                } else {
                    console.log('[自动备份设置] 已初始化，重新加载设置');
                    // 已初始化，重新加载设置
                    await loadAutoBackupSettings();
                }
            }

            await initRealtimeBackupToggle();
            await applyAutoBackupSettingsLanguage();
            autoBackupSettingsDialog.style.display = 'block';

            // 隐藏"Back to Top"按钮
            hideAllScrollToTopButtons();
        });
    }

    if (closeAutoBackupSettingsBtn && autoBackupSettingsDialog) {
        closeAutoBackupSettingsBtn.addEventListener('click', function () {
            autoBackupSettingsDialog.style.display = 'none';

            // 恢复"Back to Top"按钮
            restoreScrollToTopButtons();
        });
    }

    if (autoBackupSettingsDialog) {
        autoBackupSettingsDialog.addEventListener('click', function (event) {
            const dialogContent = autoBackupSettingsDialog.querySelector('.modal-content');
            const isOutside = event.target === autoBackupSettingsDialog || (dialogContent && !dialogContent.contains(event.target));
            if (isOutside) {
                autoBackupSettingsDialog.style.display = 'none';

                // 恢复"Back to Top"按钮
                restoreScrollToTopButtons();
            }
        });
    }

    if (realtimeBackupToggle) {
        realtimeBackupToggle.addEventListener('click', async function () {
            const current = getToggleState(realtimeBackupToggle);
            const next = !current;
            updateToggleState(realtimeBackupToggle, next);
            try {
                await new Promise(resolve => chrome.storage.local.set({ realtimeBackupEnabled: next }, resolve));
            } catch (e) {
                // ignore
            }
        });
    }

    if (restoreAutoBackupDefaultsBtn) {
        restoreAutoBackupDefaultsBtn.addEventListener('click', async function () {
            // 默认：开启实时备份；其它（循环、定时）暂不实现保存逻辑
            updateToggleState(realtimeBackupToggle, true);
            try {
                await new Promise(resolve => chrome.storage.local.set({ realtimeBackupEnabled: true }, resolve));
            } catch (e) { }
            showAutoBackupSettingsSavedIndicator();
        });
    }

    if (saveAutoBackupSettingsBtn && autoBackupSettingsDialog) {
        saveAutoBackupSettingsBtn.addEventListener('click', function () {
            // 目前仅即时保存实时备份开关，其它设置预留
            showAutoBackupSettingsSavedIndicator();
            setTimeout(() => {
                autoBackupSettingsDialog.style.display = 'none';

                // 恢复"Back to Top"按钮
                restoreScrollToTopButtons();
            }, 600);
        });
    }

    // 跟随语言切换动态更新“自动备份设置”对话框文案
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.preferredLang) {
            if (autoBackupSettingsDialog && autoBackupSettingsDialog.style.display === 'block') {
                applyAutoBackupSettingsLanguage();
                // 同时更新动态创建的定时器UI
                applyAutoBackupTimerLanguage();
            }
        }

        if (area === 'local' && (changes.syncHistory || changes.lastSyncTime || changes.lastBookmarkUpdate)) {
            schedulePopupHistoryRefresh(120);
        }
    });

    // 页面加载完成时检查URL参数
    checkUrlParams();

    // 添加消息监听器处理showReminderSettings消息
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => { // 使用 chrome.runtime
        if (message.action === "showReminderSettings") {
            // 重新获取对话框引用，防止引用丢失
            const reminderSettingsDialog = document.getElementById('reminderSettingsDialog');

            // 如果设置对话框已存在，打开它
            if (reminderSettingsDialog) {
                // 如果需要先加载设置，调用加载函数
                loadReminderSettings();

                // 发送消息暂停计时器
                chrome.runtime.sendMessage({ // 使用 chrome.runtime
                    action: "pauseReminderTimer"
                }).catch(error => {
                });

                // 显示对话框
                reminderSettingsDialog.style.display = 'block';
                sendResponse({ success: true });
            } else {
                sendResponse({ success: false, error: '找不到设置对话框元素' });
            }

            return true;
        }
    });

    // Call initialization when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeLanguageSwitcher);
    } else {
        initializeLanguageSwitcher();
    }

    // 在popup打开时，主动刷新一次状态卡片，确保显示最新的变化状态
    // 延迟执行以确保所有初始化完成
    setTimeout(() => {
        updateBookmarkCountDisplay();
    }, 300);
});

// 添加备注对话框函数
function showAddNoteDialog(recordTime) {
    // 先查找是否已有备注对话框，如果有则移除
    const existingDialog = document.getElementById('noteDialog');
    if (existingDialog) {
        document.body.removeChild(existingDialog);
    }

    // 获取当前的历史记录
    chrome.storage.local.get(['syncHistory', 'preferredLang'], (data) => {
        const syncHistory = data.syncHistory || [];
        const currentLang = data.preferredLang || 'zh_CN';
        const record = syncHistory.find(r => r.time === recordTime);

        if (!record) {
            return;
        }

        // 创建对话框
        const dialogOverlay = document.createElement('div');
        dialogOverlay.id = 'noteDialog';
        dialogOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
        `;

        // 创建对话框内容
        const dialogContent = document.createElement('div');
        dialogContent.style.cssText = `
            background: var(--theme-bg-primary);
            border-radius: 8px;
            padding: 20px;
            width: 300px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            position: relative;
        `;

        // 标题
        const title = document.createElement('h3');
        title.textContent = currentLang === 'en' ? 'Note' : '备注';
        title.style.cssText = 'margin-top: 0; margin-bottom: 15px;';

        // 时间提示
        const timeInfo = document.createElement('div');
        timeInfo.textContent = `${formatTime(new Date(recordTime))}`;
        timeInfo.style.cssText = 'margin-bottom: 15px; color: #007AFF; font-weight: bold;';

        // 文本区域
        const textarea = document.createElement('textarea');
        textarea.value = record.note || '';
        textarea.placeholder = currentLang === 'en' ? 'Enter note (suggested within 20 characters)' : '输入备注（建议20个字符以内）';
        textarea.style.cssText = `
            width: 100%;
            height: 60px;
            padding: 8px;
            border: 1px solid #ccc;
            border-radius: 4px;
            resize: none;
            box-sizing: border-box;
            margin-bottom: 15px;
            font-size: 14px;
        `;

        // 字数提示
        const charCount = document.createElement('div');
        const suggestedChars = 20;
        const updateCharCount = () => {
            const count = textarea.value.length;
            const overLimit = count > suggestedChars;

            if (currentLang === 'en') {
                charCount.textContent = overLimit ?
                    `${count} characters (suggested: ${suggestedChars})` :
                    `${count} / ${suggestedChars} characters`;
            } else {
                charCount.textContent = overLimit ?
                    `${count} 个字符（建议: ${suggestedChars}）` :
                    `${count} / ${suggestedChars} 个字符`;
            }

            // 只改变颜色提示，不强制限制
            charCount.style.color = overLimit ? '#FF9800' : '#666';
        };
        updateCharCount();
        textarea.addEventListener('input', updateCharCount);
        charCount.style.cssText = 'text-align: right; font-size: 12px; margin-bottom: 15px; color: #666;';

        // 按钮容器
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: flex; justify-content: space-between; gap: 10px;';

        // 监听语言切换事件
        const handleLanguageChange = (changes, area) => {
            if (area === 'local' && changes.preferredLang) {
                chrome.storage.local.get(['preferredLang'], (result) => {
                    const newLang = result.preferredLang || 'zh_CN';
                    if (newLang !== currentLang) {
                        // 语言已更改，重新打开对话框
                        try {
                            // 检查对话框是否仍然存在于DOM中
                            if (document.body.contains(dialogOverlay)) {
                                document.body.removeChild(dialogOverlay);
                                showAddNoteDialog(recordTime);
                            }
                        } catch (error) {
                        }
                    }
                });
            }
        };

        // 添加语言切换事件监听
        chrome.storage.onChanged.addListener(handleLanguageChange);

        // 取消按钮
        const cancelButton = document.createElement('button');
        cancelButton.textContent = currentLang === 'en' ? 'Cancel' : '取消';
        cancelButton.style.cssText = `
            padding: 8px 15px;
            border: none;
            border-radius: 4px;
            background-color: var(--theme-bg-tertiary);
            color: var(--theme-text-secondary);
            cursor: pointer;
            flex: 1;
        `;
        cancelButton.onclick = () => {
            // 移除事件监听器，然后移除对话框
            chrome.storage.onChanged.removeListener(handleLanguageChange);
            document.body.removeChild(dialogOverlay);
        };

        // 保存按钮
        const saveButton = document.createElement('button');
        saveButton.textContent = currentLang === 'en' ? 'Save' : '保存';
        saveButton.style.cssText = `
            padding: 8px 15px;
            border: none;
            border-radius: 4px;
            background-color: #4CAF50;
            color: white;
            cursor: pointer;
            flex: 1;
        `;
        saveButton.onclick = () => {
            // 移除事件监听器，然后保存并移除对话框
            chrome.storage.onChanged.removeListener(handleLanguageChange);
            saveNoteForRecord(recordTime, textarea.value);
            document.body.removeChild(dialogOverlay);
        };

        // 添加所有元素
        buttonContainer.appendChild(cancelButton);
        buttonContainer.appendChild(saveButton);
        dialogContent.appendChild(title);
        dialogContent.appendChild(timeInfo);
        dialogContent.appendChild(textarea);
        dialogContent.appendChild(charCount);
        dialogContent.appendChild(buttonContainer);
        dialogOverlay.appendChild(dialogContent);

        document.body.appendChild(dialogOverlay);
        textarea.focus();

        // 确保在对话框被意外关闭时也能清理监听器
        dialogOverlay.addEventListener('remove', () => {
            chrome.storage.onChanged.removeListener(handleLanguageChange);
        });

        // 添加点击空白区域关闭对话框的功能
        dialogOverlay.addEventListener('click', (event) => {
            if (event.target === dialogOverlay) {
                chrome.storage.onChanged.removeListener(handleLanguageChange);
                document.body.removeChild(dialogOverlay);
            }
        });
    });
}

// 保存备注函数
function saveNoteForRecord(recordTime, noteText) {
    chrome.storage.local.get(['syncHistory', 'preferredLang'], (data) => {
        const syncHistory = data.syncHistory || [];
        const currentLang = data.preferredLang || 'zh_CN';
        const updatedHistory = syncHistory.map(record => {
            if (record.time === recordTime) {
                return { ...record, note: noteText };
            }
            return record;
        });

        chrome.storage.local.set({ syncHistory: updatedHistory }, () => {
            updateSyncHistory(); // 更新显示

            // 使用国际化字符串
            const noteSavedText = {
                'zh_CN': '备注已保存',
                'en': 'Note saved'
            };
            showStatus(noteSavedText[currentLang] || noteSavedText['zh_CN'], 'success');
        });
    });
}
