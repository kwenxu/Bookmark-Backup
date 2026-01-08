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
                            const exportRootFolder = isEn ? 'Bookmark Git & Toolbox' : '书签快照 & 工具箱';
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
                defaultDownloadEnabled: enabled,
                localBackupEnabled: enabled // 兼容旧版本
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

        const exportRootFolder = isEn ? 'Bookmark Git & Toolbox' : '书签快照 & 工具箱';
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
    const getLangPromise = passedLang
        ? Promise.resolve(passedLang)
        : new Promise(resolve => chrome.storage.local.get(['preferredLang'], result => resolve(result.preferredLang || 'zh_CN')));

    Promise.all([
        getLangPromise, // Add promise to get language
        new Promise(resolve => {
            chrome.runtime.sendMessage({ action: "getSyncHistory" }, response => {
                if (chrome.runtime.lastError) {
                    console.error('获取备份历史记录失败:', chrome.runtime.lastError.message);
                    resolve([]);
                    return;
                }
                if (response && response.success) resolve(response.syncHistory || []);
                else { console.error('获取备份历史记录失败 in Promise:', response); resolve([]); }
            });
        }),
        new Promise(resolve => {
            chrome.storage.local.get('cachedRecordAfterClear', result => {
                resolve(result.cachedRecordAfterClear);
            });
        })
    ]).then(([currentLang, syncHistory, cachedRecord]) => { // currentLang is now from getLangPromise
        const historyList = document.getElementById('syncHistoryList');
        if (!historyList) return;

        // 强制隐藏横向滚动条
        historyList.style.overflowX = 'hidden';

        // 为详情按钮/条目点击添加全局事件委托（只绑定一次，避免分页刷新重复绑定）
        if (!historyList.hasAttribute('data-details-delegated')) {
            historyList.addEventListener('click', (e) => {
                // 备注编辑：不触发跳转
                if (e.target.closest('.editable-note')) return;

                // 明确的跳转按钮
                if (e.target.closest('.details-btn')) {
                    const btn = e.target.closest('.details-btn');
                    const recordTime = btn.getAttribute('data-record-time');
                    if (recordTime) {
                        const historyPageUrl = chrome.runtime.getURL('history_html/history.html') + `?view=history&record=${recordTime}`;
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
            `;
        } else {
            headerHTML = `
                <div class="header-item header-action">序号</div>
                <div class="header-item" style="flex: 1; text-align: center;">时间与备注</div>
                <div class="header-item" style="flex: 1; text-align: center;">数量与结构</div>
            `;
        }

        const newHeader = document.createElement('div');
        newHeader.className = 'history-header';
        newHeader.innerHTML = headerHTML;
        historyList.appendChild(newHeader);

        if (syncHistory.length > 0) {
            const reversedHistory = [...syncHistory].reverse(); // 最新记录在前
            const PAGE_SIZE = 10;
            // 全局页码状态（挂在 window，避免全局作用域污染冲突）
            if (typeof window.__syncHistoryCurrentPage !== 'number') window.__syncHistoryCurrentPage = 1;

            const totalPages = Math.max(1, Math.ceil(reversedHistory.length / PAGE_SIZE));
            window.__syncHistoryTotalPages = totalPages;
            if (window.__syncHistoryCurrentPage > totalPages) window.__syncHistoryCurrentPage = totalPages;
            if (window.__syncHistoryCurrentPage < 1) window.__syncHistoryCurrentPage = 1;

            const startIndex = (window.__syncHistoryCurrentPage - 1) * PAGE_SIZE;
            const endIndex = Math.min(startIndex + PAGE_SIZE, reversedHistory.length);
            const pageRecords = reversedHistory.slice(startIndex, endIndex);

            // 添加一个变量来跟踪上一条记录的日期和上一个元素
            let previousDate = null;
            let lastHistoryItem = null;

            pageRecords.forEach((record, index) => {
                const globalIndex = startIndex + index;
                const historyItem = document.createElement('div');
                historyItem.className = 'history-item';
                historyItem.setAttribute('data-record-time', record.time);
                // 优先使用记录中的永久序号，兼容旧记录（回退到计算的序号）
                const seqNumber = record.seqNumber || (reversedHistory.length - globalIndex);

                const time = new Date(record.time);

                // 检查日期是否变化（年月日）
                const currentDateStr = `${time.getFullYear()}-${time.getMonth() + 1}-${time.getDate()}`;
                const previousDateObj = previousDate ? new Date(previousDate) : null;
                const previousDateStr = previousDateObj ? `${previousDateObj.getFullYear()}-${previousDateObj.getMonth() + 1}-${previousDateObj.getDate()}` : null;

                // 如果日期变化且不是第一条记录，为上一个条目添加日期分界线
                if (previousDateStr && currentDateStr !== previousDateStr && lastHistoryItem) {
                    // 使用统一的蓝色
                    const dividerColor = '#007AFF'; // 蓝色
                    const textColor = '#007AFF';    // 蓝色文字

                    // 为上一个条目添加底部边框作为分界线
                    lastHistoryItem.style.borderBottom = `1px solid ${dividerColor}`;
                    lastHistoryItem.style.position = 'relative';
                    lastHistoryItem.style.marginBottom = '15px'; // 添加底部间距

                    // 创建日期标签 - 椭圆形状
                    const dateLabel = document.createElement('div');

                    // 现在只有两栏，日期标签放在两栏之间的中间位置
                    const leftPosition = '50%';

                    dateLabel.style.cssText = `
                        position: absolute;
                        bottom: -12px;
                        left: ${leftPosition};
                        transform: translateX(-50%);
                        background-color: var(--theme-bg-primary, white);
                        padding: 3px 20px;
                        font-size: 12px;
                        color: ${textColor};
                        border: 1px solid ${dividerColor};
                        border-radius: 12px;
                        z-index: 10;
                    `;

                    // 格式化日期显示
                    const formattedDate = currentLang === 'en' ?
                        `${previousDateObj.getFullYear()}-${(previousDateObj.getMonth() + 1).toString().padStart(2, '0')}-${previousDateObj.getDate().toString().padStart(2, '0')}` :
                        `${previousDateObj.getFullYear()}年${previousDateObj.getMonth() + 1}月${previousDateObj.getDate()}日`;
                    dateLabel.textContent = formattedDate;

                    // 添加日期标签到上一个条目
                    lastHistoryItem.appendChild(dateLabel);
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
                        const parts = [];
                        const firstLineParts = [];
                        const secondLineParts = [];
                        const sep = ' <span class="history-stat-sep">|</span> ';
                        const bookmarkLabel = currentLang === 'en' ? 'BKM' : '书签';
                        const folderLabel = currentLang === 'en' ? 'FLD' : '文件夹';

                        let hasAdded = false;
                        let hasDeleted = false;
                        let hasMoved = false;
                        let hasModified = false;

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

                        if (bookmarkAddedCount > 0 || folderAddedCount > 0) {
                            const addedParts = [];
                            if (bookmarkAddedCount > 0) addedParts.push(`<span class="history-stat-label">${bookmarkLabel}</span> <span class="history-stat-color added">+${bookmarkAddedCount}</span>`);
                            if (folderAddedCount > 0) addedParts.push(`<span class="history-stat-label">${folderLabel}</span> <span class="history-stat-color added">+${folderAddedCount}</span>`);
                            if (addedParts.length > 0) {
                                const line = addedParts.join(' ');
                                parts.push(line);
                                firstLineParts.push(line);
                                hasAdded = true;
                            }
                        }

                        if (bookmarkDeletedCount > 0 || folderDeletedCount > 0) {
                            const deletedParts = [];
                            if (bookmarkDeletedCount > 0) deletedParts.push(`<span class="history-stat-label">${bookmarkLabel}</span> <span class="history-stat-color deleted">-${bookmarkDeletedCount}</span>`);
                            if (folderDeletedCount > 0) deletedParts.push(`<span class="history-stat-label">${folderLabel}</span> <span class="history-stat-color deleted">-${folderDeletedCount}</span>`);
                            if (deletedParts.length > 0) {
                                const line = deletedParts.join(' ');
                                parts.push(line);
                                firstLineParts.push(line);
                                hasDeleted = true;
                            }
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
                        if (movedTotal > 0) {
                            const movedLabel = currentLang === 'en' ? 'Moved' : '移动';
                            const line = `<span class="history-stat-label">${movedLabel}</span> <span class="history-stat-color moved">${movedTotal}</span>`;
                            parts.push(line);
                            secondLineParts.push(line);
                            hasMoved = true;
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
                        if (modifiedTotal > 0) {
                            const modifiedLabel = currentLang === 'en' ? 'Modified' : '修改';
                            const line = `<span class="history-stat-label">${modifiedLabel}</span> <span class="history-stat-color modified">${modifiedTotal}</span>`;
                            parts.push(line);
                            secondLineParts.push(line);
                            hasModified = true;
                        }


                        if (parts.length === 0) {
                            // 仅当明确标记为首次备份时展示“第一次备份”；
                            // 兼容旧数据：若没有 isFirstBackup 字段，再退回到“只有一条记录”的判断
                            const isFirstBackup = record.isFirstBackup === true ||
                                (typeof record.isFirstBackup !== 'boolean' && (!record.time || syncHistory.length <= 1));
                            if (isFirstBackup && !(cachedRecord && syncHistory.length === 1 && record.time > cachedRecord.time)) {
                                return `<span class="history-stat-badge first">${dynamicTextStrings.firstBackupText[currentLang] || '第一次备份'}</span>`;
                            }
                            return `<span class="history-stat-badge no-change">${dynamicTextStrings.noChangesText[currentLang] || '无变化'}</span>`;
                        }

                        const totalItems = parts.length;
                        const shouldSplit = totalItems >= 3 && (hasMoved || hasModified);
                        if (shouldSplit) {
                            const firstLine = firstLineParts.length ? firstLineParts.join(sep) : parts.slice(0, Math.ceil(totalItems / 2)).join(sep);
                            const secondLine = secondLineParts.length ? secondLineParts.join(sep) : parts.slice(Math.ceil(totalItems / 2)).join(sep);
                            const singleTopClass = firstLineParts.length === 1 ? ' single-top' : '';
                            return `<span class="history-stat-badge multi-line${singleTopClass}"><span class="history-stat-line">${firstLine}</span><span class="history-stat-line">${secondLine}</span></span>`;
                        }

                        return `<span class="history-stat-badge">${parts.join(sep)}</span>`;
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
                const fallbackNote = (() => {
                    if (record.type === 'switch') return currentLang === 'en' ? 'Switch Backup' : '切换备份';
                    if (record.type === 'manual') return currentLang === 'en' ? 'Manual Backup' : '手动备份';
                    return currentLang === 'en' ? 'Auto Backup' : '自动备份';
                })();
                const displayNote = (record.note && record.note.trim()) ? record.note : fallbackNote;
                if (displayNote) {
                    // 备注文本可点击，悬浮时出现虚线框
                    noteHtml = `<div class="editable-note" data-record-time="${record.time}" style="margin-top: 4px; text-align: center; font-size: 12px; color: var(--theme-text-primary); max-width: 100%; overflow-wrap: break-word; word-wrap: break-word; word-break: break-all; cursor: pointer; padding: 2px 6px; border: 1px dashed transparent; border-radius: 3px; transition: border-color 0.2s;">${displayNote}</div>`;
                }

                // 只保留两栏的样式
                let timeColStyle = "flex: 1; text-align: center;";
                let qtyColStyle = "flex: 1; text-align: center;";

                // 详情按钮：序号按钮 + 跳转图标
                const detailsBtn = `
                    <button class="details-btn" data-record-time="${record.time}" title="${currentLang === 'zh_CN' ? '跳转至HTML页面' : 'Open HTML page'}">
                        <span class="details-seq">${seqNumber}</span>
                        <svg class="details-jump-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                            <path d="M6 3.5a.75.75 0 0 1 .75-.75h5.5a.75.75 0 0 1 .75.75v5.5a.75.75 0 0 1-1.5 0V5.31L4.28 12.53a.75.75 0 0 1-1.06-1.06L10.44 4.25H6.75A.75.75 0 0 1 6 3.5z" />
                        </svg>
                    </button>
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
            if (cachedRecord && (cacheWasUsedForListDisplay || syncHistory.length > 1)) {
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
    const containerStyle = "display: inline-block; margin: 2px 0 2px 0; padding: 6px 8px 6px 10px; background-color: transparent; border-radius: 6px; font-size: 12.5px; text-align: center;";
    const mainItemStyle = "word-break: break-all; color: var(--theme-text-primary); text-align: left;";
    const secondaryItemStyle = "margin-top: 5px; font-size: 12px; color: var(--theme-text-secondary); text-align: left;";

    Promise.all([getLangPromise, getAutoSyncStatePromise])
        .then(([currentLang, isAutoSyncEnabled]) => {
            const bookmarkCountSpan = document.getElementById('bookmarkCount');
            const changeDescriptionContainer = document.getElementById('change-description-row');

            if (!changeDescriptionContainer) {
                return;
            }

            // 获取国际化标签 (确保 window.i18nLabels 已由 applyLocalizedContent 设置)
            const i18nBookmarksLabel = window.i18nLabels?.bookmarksLabel || (currentLang === 'en' ? "bookmarks" : "个书签");
            const i18nFoldersLabel = window.i18nLabels?.foldersLabel || (currentLang === 'en' ? "folders" : "个文件夹");

            if (isAutoSyncEnabled) {
                // 设置右侧状态卡片为自动模式样式
                changeDescriptionContainer.classList.add('auto-mode');
                changeDescriptionContainer.classList.remove('manual-mode');
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
                            statusText = currentLang === 'en' ?
                                '「Realtime」Auto Backup: Monitoring' :
                                '「实时」自动备份：监测中';
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
                                    const containerStyle = "display: inline-block; margin: 2px 0 2px 0; padding: 6px 8px 6px 10px; background-color: transparent; border-radius: 6px; font-size: 12.5px; text-align: center;";
                                    const mainItemStyle = "word-break: break-all; color: var(--theme-status-card-auto-text); text-align: center;";
                                    const noChangeText = currentLang === 'en' ? "No changes" : "无变化";
                                    changeDescriptionContainer.innerHTML = `<div style="${containerStyle}"><div style="${mainItemStyle}">${noChangeText}</div></div>`;
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
                                    : recentIds.recentMovedIds.length;
                                const modifiedTotal = (typeof backupResponse.stats.modifiedCount === 'number')
                                    ? backupResponse.stats.modifiedCount
                                    : recentIds.recentModifiedIds.length;
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

                                // 组合显示内容（和手动备份完全一致）
                                const containerStyle = "display: inline-block; margin: 2px 0 2px 0; padding: 6px 8px 6px 10px; background-color: transparent; border-radius: 6px; font-size: 12.5px; text-align: center;";
                                const mainItemStyle = "word-break: break-all; color: var(--theme-status-card-auto-text); text-align: center;";
                                const secondaryItemStyle = "margin-top: 8px; word-break: break-all; color: var(--theme-status-card-auto-text); text-align: center;";

                                let statusText = "";
                                if (quantityChangesHTML || structuralChangesHTML) {
                                    let mainContent = "";
                                    let secondaryContent = "";
                                    if (quantityChangesHTML && structuralChangesHTML) {
                                        mainContent = quantityChangesHTML;
                                        secondaryContent = structuralChangesHTML;
                                    } else if (quantityChangesHTML) {
                                        mainContent = quantityChangesHTML;
                                    } else if (structuralChangesHTML) {
                                        mainContent = structuralChangesHTML;
                                    }
                                    statusText = `<div style="${containerStyle}">`;
                                    if (mainContent) statusText += `<div style="${mainItemStyle}">${mainContent}</div>`;
                                    if (secondaryContent) statusText += `<div style="${secondaryItemStyle}">${secondaryContent}</div>`;
                                    statusText += `</div>`;
                                } else {
                                    const noChangeText = currentLang === 'en' ? "No changes" : "无变化";
                                    statusText = `<div style="${containerStyle}"><div style="${mainItemStyle}">${noChangeText}</div></div>`;
                                }

                                // 直接设置HTML内容
                                changeDescriptionContainer.innerHTML = statusText;
                            });
                        } else {
                            // 其他情况（如 'none' 或未设置）：显示无变化
                            const containerStyle = "display: inline-block; margin: 2px 0 2px 0; padding: 6px 8px 6px 10px; background-color: transparent; border-radius: 6px; font-size: 12.5px; text-align: center;";
                            const mainItemStyle = "word-break: break-all; color: var(--theme-status-card-auto-text); text-align: center;";
                            const noChangeText = currentLang === 'en' ? 'No changes' : '无变化';
                            const statusText = `<div style="${containerStyle}"><div style="${mainItemStyle}">${noChangeText}</div></div>`;
                            changeDescriptionContainer.innerHTML = statusText;
                        }
                    });
                });

            } else {
                // 设置右侧状态卡片为手动模式样式
                changeDescriptionContainer.classList.add('manual-mode');
                changeDescriptionContainer.classList.remove('auto-mode');
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
                        : recentIds.recentMovedIds.length;
                    const modifiedTotal = (typeof backupResponse.stats.modifiedCount === 'number')
                        ? backupResponse.stats.modifiedCount
                        : recentIds.recentModifiedIds.length;
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

                    let changeDescriptionContent = "";
                    const manualMainItemStyle = "word-break: break-all; color: var(--theme-status-card-manual-text); text-align: center;";
                    const manualSecondaryItemStyle = "margin-top: 8px; word-break: break-all; color: var(--theme-status-card-manual-text); text-align: center;";
                    if (quantityChangesHTML || structuralChangesHTML) {
                        let mainContent = "";
                        let secondaryContent = "";
                        if (quantityChangesHTML && structuralChangesHTML) {
                            mainContent = quantityChangesHTML;
                            secondaryContent = structuralChangesHTML;
                        } else if (quantityChangesHTML) {
                            mainContent = quantityChangesHTML;
                        } else if (structuralChangesHTML) {
                            mainContent = structuralChangesHTML;
                        }
                        changeDescriptionContent = `<div style="${containerStyle}">`;
                        if (mainContent) changeDescriptionContent += `<div style="${manualMainItemStyle}">${mainContent}</div>`;
                        if (secondaryContent) changeDescriptionContent += `<div style="${manualSecondaryItemStyle}">${secondaryContent}</div>`;
                        changeDescriptionContent += `</div>`;
                    } else {
                        const noChangeText = currentLang === 'en' ? "No changes" : "无变化";
                        changeDescriptionContent = `<div style="${containerStyle}"><div style="${manualMainItemStyle}">${noChangeText}</div></div>`;
                    }
                    changeDescriptionContainer.innerHTML = changeDescriptionContent;
                    // --- 结束原有的手动模式差异计算和显示逻辑 ---
                }).catch(manualError => {
                    if (bookmarkCountSpan) {
                        bookmarkCountSpan.innerHTML = `<span style="color: red;">${currentLang === 'en' ? 'Details load failed' : '详情加载失败'}</span>`;
                    }
                    if (changeDescriptionContainer) {
                        changeDescriptionContainer.innerHTML = `<div style="${containerStyle}"><div style="${mainItemStyle} color: red;">${currentLang === 'en' ? 'Change details unavailable' : '变动详情无法加载'}</div></div>`;
                    }
                });
            }
        })
        .catch(initialError => {
            const bookmarkCountSpan = document.getElementById('bookmarkCount');
            const changeDescriptionContainer = document.getElementById('change-description-row');
            if (bookmarkCountSpan) bookmarkCountSpan.innerHTML = `<span style="color: red;">${'加载失败'}</span>`;
            if (changeDescriptionContainer) changeDescriptionContainer.innerHTML = ''; // 清空以避免显示旧内容
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

    // Phase 2.1 Update: Update Settings Panel Checkboxes
    const backupModeAuto = document.getElementById('backupModeAuto');
    const backupModeManual = document.getElementById('backupModeManual');
    if (backupModeAuto) backupModeAuto.checked = isChecked;
    if (backupModeManual) backupModeManual.checked = !isChecked;

    // Phase 2.1 Update: Toggle Settings Buttons visibility
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

    // 获取上传按钮并禁用
    const uploadButton = document.getElementById('uploadToCloudManual');
    if (uploadButton) uploadButton.disabled = true;

    // 发送上传请求
    chrome.runtime.sendMessage({
        action: "syncBookmarks",
        direction: "upload"
    }, (response) => {
        // 恢复按钮状态
        if (uploadButton) uploadButton.disabled = false;

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
            if (uploadButton) {
                // 1. Lock dimensions strictly & Apply Green Background Override
                uploadButton.classList.add('success-animating'); // pointer-events: none set in CSS

                const rect = uploadButton.getBoundingClientRect();
                uploadButton.style.flex = `0 0 ${rect.width}px`;
                uploadButton.style.width = `${rect.width}px`;
                uploadButton.style.height = `${rect.height}px`;

                uploadButton.style.padding = '0';
                uploadButton.style.display = 'flex';
                uploadButton.style.alignItems = 'center';
                uploadButton.style.justifyContent = 'center';

                const originalHTML = uploadButton.innerHTML;

                // 2. Wrap existing text for animation
                uploadButton.innerHTML = `<span class="anim-content">${originalHTML}</span>`;
                // DO NOT set disabled = true, rely on pointer-events: none

                // Force reflow
                void uploadButton.offsetWidth;

                // Start Fade Out Text
                uploadButton.querySelector('.anim-content').classList.add('anim-out');

                setTimeout(() => {
                    // 3. Swap to Checkmark (Start Hidden/Scaled down)
                    uploadButton.innerHTML = `<i class="fas fa-check anim-content anim-out" style="font-size: 14px; color: white;"></i>`;

                    // Force reflow
                    void uploadButton.offsetWidth;

                    // Fade In Checkmark
                    uploadButton.querySelector('.anim-content').classList.remove('anim-out');

                    // 4. Wait, then reverse
                    setTimeout(() => {
                        // Fade Out Checkmark
                        uploadButton.querySelector('.anim-content').classList.add('anim-out');

                        setTimeout(() => {
                            // 5. Swap back to Text (Start Hidden)
                            uploadButton.innerHTML = `<span class="anim-content anim-out">${originalHTML}</span>`;

                            // Force reflow
                            void uploadButton.offsetWidth;

                            // Fade In Text
                            uploadButton.querySelector('.anim-content').classList.remove('anim-out');

                            setTimeout(() => {
                                // 6. Cleanup / Restore Original State
                                uploadButton.innerHTML = originalHTML;

                                uploadButton.classList.remove('success-animating'); // Restore clicks

                                uploadButton.style.flex = '';
                                uploadButton.style.width = '';
                                uploadButton.style.height = '';
                                uploadButton.style.padding = '';
                                uploadButton.style.display = '';
                                uploadButton.style.alignItems = '';
                                uploadButton.style.justifyContent = '';
                            }, 300); // Wait for text fade in (match transition + buffer)
                        }, 300); // Wait for checkmark fade out
                    }, 1200); // Display checkmark duration
                }, 300); // Wait for text fade out (match transition + buffer)
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
        'defaultDownloadEnabled', 'customFolderEnabled', 'customFolderPath',
        'localBackupPath', 'localBackupEnabled'
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
        const customFolderEnabled = data.customFolderEnabled === true && data.customFolderPath;
        const oldConfigEnabled = data.localBackupEnabled === true && data.localBackupPath;
        const localBackupConfigured = defaultDownloadEnabled || customFolderEnabled || oldConfigEnabled;

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

    try {
        // 直接从存储中获取已设置的语言偏好
        const result = await new Promise(resolve => chrome.storage.local.get('preferredLang', resolve));

        if (result.preferredLang) {
            currentLang = result.preferredLang;
        } else {
            // 这是一个备用逻辑，正常情况下 background.js 会处理好
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

    // Bookmark Toolbox（D 区域）相关 tooltip
    const bookmarkCanvasTooltipStrings = {
        'zh_CN': "点击进入书签画布",
        'en': "Open Bookmark Canvas"
    };

    const bookmarkAdditionTooltipStrings = {
        'zh_CN': "查看当前的书签推荐卡片",
        'en': "View the current bookmark recommendations"
    };

    const historyRecordsDescriptionStrings = {
        'zh_CN': "备份历史",
        'en': "Backup History"
    };

    // Bookmark Toolbox（D 区域）标题
    const bookmarkToolboxTitleStrings = {
        'zh_CN': "书签工具箱",
        'en': "Bookmark Toolbox"
    };

    const bookmarkCanvasTitleStrings = {
        'zh_CN': "1. 书签画布",
        'en': "1. Bookmark Canvas"
    };

    const bookmarkAdditionTitleStrings = {
        'zh_CN': "2. 书签推荐",
        'en': "2. Bookmark Recommendations"
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
        'zh_CN': "恢复初始状态",
        'en': "Reset to Initial"
    };

    const initUploadButtonStrings = {
        'zh_CN': "初始化上传",
        'en': "Initialize Upload"
    };

    // 备份设置相关国际化字符串
    const backupSettingsTitleStrings = {
        'zh_CN': "备份设置",
        'en': "Backup Settings"
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

    // 同步与恢复相关国际化字符串
    const syncRestoreTitleStrings = {
        'zh_CN': "同步与恢复",
        'en': "Sync & Restore"
    };

    const syncRestoreComingSoonStrings = {
        'zh_CN': "即将推出",
        'en': "Coming Soon"
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

    // New Descriptions for Settings
    const backupModeDescStrings = {
        'zh_CN': "标准或增量备份",
        'en': "Standard or incremental"
    };

    const incrementalDetailLabelStrings = {
        'zh_CN': "详情",
        'en': "Detail"
    };

    const incrementalDetailDescStrings = {
        'zh_CN': "变更日志的详细程度",
        'en': "Level of detail for logs"
    };

    const overwritePolicyDescStrings = {
        'zh_CN': "存储策略",
        'en': "Storage strategy"
    };

    const syncRestoreDescStrings = {
        'zh_CN': "云端恢复",
        'en': "Cloud recovery"
    };

    const resetDescStrings = {
        'zh_CN': "重置所有设置",
        'en': "Reset all settings"
    };

    const uploadDescStrings = {
        'zh_CN': "初次上传",
        'en': "Initial upload"
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
    const backupModeLabelText = backupModeLabelStrings[lang] || backupModeLabelStrings['zh_CN'];
    const backupModeFullText = backupModeFullStrings[lang] || backupModeFullStrings['zh_CN'];
    const backupModeIncrementalText = backupModeIncrementalStrings[lang] || backupModeIncrementalStrings['zh_CN'];
    const incrementalSimpleText = incrementalSimpleStrings[lang] || incrementalSimpleStrings['zh_CN'];
    const incrementalDetailedText = incrementalDetailedStrings[lang] || incrementalDetailedStrings['zh_CN'];

    // New Description Texts
    const backupModeDescText = backupModeDescStrings[lang] || backupModeDescStrings['zh_CN'];
    const incrementalDetailLabelText = incrementalDetailLabelStrings[lang] || incrementalDetailLabelStrings['zh_CN'];
    const incrementalDetailDescText = incrementalDetailDescStrings[lang] || incrementalDetailDescStrings['zh_CN'];
    const overwritePolicyDescText = overwritePolicyDescStrings[lang] || overwritePolicyDescStrings['zh_CN'];
    const syncRestoreDescText = syncRestoreDescStrings[lang] || syncRestoreDescStrings['zh_CN'];
    const resetDescText = resetDescStrings[lang] || resetDescStrings['zh_CN'];
    const uploadDescText = uploadDescStrings[lang] || uploadDescStrings['zh_CN'];

    const overwritePolicyLabelText = overwritePolicyLabelStrings[lang] || overwritePolicyLabelStrings['zh_CN'];
    const overwriteVersionedText = overwriteVersionedStrings[lang] || overwriteVersionedStrings['zh_CN'];
    const overwriteVersionedDescText = overwriteVersionedDescStrings[lang] || overwriteVersionedDescStrings['zh_CN'];
    const overwriteOverwriteText = overwriteOverwriteStrings[lang] || overwriteOverwriteStrings['zh_CN'];
    const overwriteOverwriteDescText = overwriteOverwriteDescStrings[lang] || overwriteOverwriteDescStrings['zh_CN'];
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

    const exportRootFolder = lang === 'zh_CN' ? '书签快照 & 工具箱' : 'Bookmark Git & Toolbox';
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

    const backupModeLabelEl = document.getElementById('backupModeLabel');
    if (backupModeLabelEl) backupModeLabelEl.textContent = backupModeLabelText;

    const backupModeFullLabelEl = document.getElementById('backupModeFullLabel');
    if (backupModeFullLabelEl) backupModeFullLabelEl.textContent = backupModeFullText;

    const backupModeIncrementalLabelEl = document.getElementById('backupModeIncrementalLabel');
    if (backupModeIncrementalLabelEl) backupModeIncrementalLabelEl.textContent = backupModeIncrementalText;

    // Incremental Detail Labels
    const incrementalDetailLabelEl = document.getElementById('incrementalDetailLabel');
    if (incrementalDetailLabelEl) incrementalDetailLabelEl.textContent = incrementalDetailLabelText;

    const incrementalSimpleLabelEl = document.getElementById('incrementalSimpleLabel');
    if (incrementalSimpleLabelEl) incrementalSimpleLabelEl.textContent = incrementalSimpleText;

    const incrementalDetailedLabelEl = document.getElementById('incrementalDetailedLabel');
    if (incrementalDetailedLabelEl) incrementalDetailedLabelEl.textContent = incrementalDetailedText;

    // Descriptions
    const backupModeDescEl = document.getElementById('backupModeDesc');
    if (backupModeDescEl) backupModeDescEl.textContent = backupModeDescText;

    const incrementalDetailDescEl = document.getElementById('incrementalDetailDesc');
    if (incrementalDetailDescEl) incrementalDetailDescEl.textContent = incrementalDetailDescText;

    const overwritePolicyDescEl = document.getElementById('overwritePolicyDesc');
    if (overwritePolicyDescEl) overwritePolicyDescEl.textContent = overwritePolicyDescText;

    const syncRestoreDescEl = document.getElementById('syncRestoreDesc');
    if (syncRestoreDescEl) syncRestoreDescEl.textContent = syncRestoreDescText;

    const resetDescEl = document.getElementById('resetDesc');
    if (resetDescEl) resetDescEl.textContent = resetDescText;

    const uploadDescEl = document.getElementById('uploadDesc');
    if (uploadDescEl) uploadDescEl.textContent = uploadDescText;

    const overwritePolicyLabelEl = document.getElementById('overwritePolicyLabel');
    if (overwritePolicyLabelEl) overwritePolicyLabelEl.textContent = overwritePolicyLabelText;

    const overwriteVersionedLabelEl = document.getElementById('overwriteVersionedLabel');
    if (overwriteVersionedLabelEl) overwriteVersionedLabelEl.textContent = overwriteVersionedText;

    const overwriteOverwriteLabelEl = document.getElementById('overwriteOverwriteLabel');
    if (overwriteOverwriteLabelEl) overwriteOverwriteLabelEl.textContent = overwriteOverwriteText;

    // 更新备份设置已保存提示文本
    const settingsSavedText = settingsSavedStrings[lang] || settingsSavedStrings['zh_CN'];
    const backupSettingsSavedTextEl = document.getElementById('backupSettingsSavedText');
    if (backupSettingsSavedTextEl) backupSettingsSavedTextEl.textContent = settingsSavedText;

    // 更新同步与恢复区域文本
    const syncRestoreTitleEl = document.getElementById('syncRestoreTitle');
    if (syncRestoreTitleEl) syncRestoreTitleEl.textContent = syncRestoreTitleText;

    const syncRestoreComingSoonEl = document.getElementById('syncRestoreComingSoon');
    if (syncRestoreComingSoonEl) syncRestoreComingSoonEl.textContent = syncRestoreComingSoonText;

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
    const uploadToCloudManual = document.getElementById('uploadToCloudManual');
    if (uploadToCloudManual) {
        uploadToCloudManual.textContent = manualBackupButtonStrings[lang] || manualBackupButtonStrings['zh_CN'];
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

    // Bookmark Toolbox（D）区域标题：总标题 + D1 + D2
    const bookmarkToolboxTitleEl = document.getElementById('bookmarkToolboxTitle');
    if (bookmarkToolboxTitleEl) {
        bookmarkToolboxTitleEl.textContent = bookmarkToolboxTitleStrings[lang] || bookmarkToolboxTitleStrings['zh_CN'];
    }

    const bookmarkCanvasTitleEl = document.getElementById('bookmarkCanvasTitle');
    if (bookmarkCanvasTitleEl) {
        bookmarkCanvasTitleEl.textContent = bookmarkCanvasTitleStrings[lang] || bookmarkCanvasTitleStrings['zh_CN'];
    }

    const bookmarkAdditionTitleEl = document.getElementById('bookmarkAdditionTitle');
    if (bookmarkAdditionTitleEl) {
        bookmarkAdditionTitleEl.textContent = bookmarkAdditionTitleStrings[lang] || bookmarkAdditionTitleStrings['zh_CN'];
    }

    // Bookmark Toolbox（D）区域 tooltip：D1 书签画布 & D2 最近新增的三个书签
    const bookmarkCanvasElement = document.getElementById('bookmarkCanvas');
    if (bookmarkCanvasElement) {
        const canvasTip = bookmarkCanvasTooltipStrings[lang] || bookmarkCanvasTooltipStrings['zh_CN'];
        bookmarkCanvasElement.setAttribute('title', canvasTip);
        bookmarkCanvasElement.setAttribute('aria-label', canvasTip);
    }

    const bookmarkAdditionElement = document.getElementById('bookmarkAddition');
    if (bookmarkAdditionElement) {
        const additionTip = bookmarkAdditionTooltipStrings[lang] || bookmarkAdditionTooltipStrings['zh_CN'];
        bookmarkAdditionElement.setAttribute('title', additionTip);
        bookmarkAdditionElement.setAttribute('aria-label', additionTip);
    }

    updatePopupRecommendLanguage(lang);


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


// =============================================================================
// 备份设置初始化 (Backup Settings Initialization)
// =============================================================================

/**
 * 初始化备份设置区域的交互逻辑
 * - 覆盖策略：版本化/覆盖互斥
 * 
 * 注：增量备份功能已移至备份历史自动同步（Phase 2）
 */
function initializeBackupSettings() {
    // 获取覆盖策略勾选框元素
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

    // 保存设置到存储（带回调确认和视觉反馈）
    function saveBackupSettings() {
        const settings = {
            overwriteMode: overwriteOverwrite.checked ? 'overwrite' : 'versioned'
        };

        // 使用回调确认保存成功
        chrome.storage.local.set(settings, function () {
            if (chrome.runtime.lastError) {
                console.error('[备份设置] 保存失败:', chrome.runtime.lastError);
                return;
            }

            console.log('[备份设置] 已保存覆盖策略:', settings.overwriteMode);

            // 显示保存成功指示器
            const savedIndicator = document.getElementById('backupSettingsSavedIndicator');
            if (savedIndicator) {
                savedIndicator.style.opacity = '1';

                // 2秒后淡出
                setTimeout(() => {
                    savedIndicator.style.opacity = '0';
                }, 2000);
            }
        });
    }

    // 覆盖策略：版本化勾选
    overwriteVersioned.addEventListener('change', function () {
        if (this.checked) {
            overwriteOverwrite.checked = false;
        } else {
            overwriteOverwrite.checked = true;
        }
        saveBackupSettings();
    });

    // 覆盖策略：覆盖勾选
    overwriteOverwrite.addEventListener('change', function () {
        if (this.checked) {
            overwriteVersioned.checked = false;
        } else {
            overwriteVersioned.checked = true;
        }
        saveBackupSettings();
    });

    // ===== 备份历史同步设置 (Phase 2) =====
    const historySyncEnabled = document.getElementById('historySyncEnabled');
    const historySyncContent = document.getElementById('historySyncContent');
    const historySyncHtml = document.getElementById('historySyncHtml');
    const historySyncJson = document.getElementById('historySyncJson');
    const historySyncSimple = document.getElementById('historySyncSimple');
    const historySyncDetailed = document.getElementById('historySyncDetailed');

    // 更新备份历史设置区域的启用/禁用状态
    function updateHistorySyncContentState() {
        if (historySyncContent) {
            if (historySyncEnabled && historySyncEnabled.checked) {
                historySyncContent.classList.remove('disabled');
            } else {
                historySyncContent.classList.add('disabled');
            }
        }
    }

    // 加载备份历史启用状态
    chrome.storage.local.get(['historySyncEnabled'], function (result) {
        const enabled = result.historySyncEnabled !== false; // 默认开启
        if (historySyncEnabled) historySyncEnabled.checked = enabled;
        updateHistorySyncContentState();
    });

    // 备份历史启用开关事件
    if (historySyncEnabled) {
        historySyncEnabled.addEventListener('change', function () {
            chrome.storage.local.set({ historySyncEnabled: this.checked });
            updateHistorySyncContentState();
        });
    }

    // ===== 备份历史区域折叠功能 =====
    const historySyncHeader = document.getElementById('historySyncHeader');
    const historySyncSection = document.getElementById('historySyncSection');

    // 加载折叠状态（默认收起）
    chrome.storage.local.get(['historySyncCollapsed'], function (result) {
        const collapsed = result.historySyncCollapsed !== false; // 默认收起
        if (collapsed && historySyncSection) {
            historySyncSection.classList.add('collapsed');
        }
    });

    // 点击标题切换折叠状态
    if (historySyncHeader && historySyncSection) {
        historySyncHeader.addEventListener('click', function () {
            historySyncSection.classList.toggle('collapsed');
            const isCollapsed = historySyncSection.classList.contains('collapsed');
            chrome.storage.local.set({ historySyncCollapsed: isCollapsed });
        });
    }

    // 加载备份历史同步设置
    chrome.storage.local.get(['historySyncFormat', 'historySyncViewMode'], function (result) {
        // 格式设置
        const format = result.historySyncFormat || 'html';
        if (historySyncHtml) historySyncHtml.checked = (format === 'html' || format === 'both');
        if (historySyncJson) historySyncJson.checked = (format === 'json' || format === 'both');

        // 视图模式设置
        const viewMode = result.historySyncViewMode || 'simple';
        if (historySyncSimple) historySyncSimple.checked = (viewMode === 'simple');
        if (historySyncDetailed) historySyncDetailed.checked = (viewMode === 'detailed');
    });

    // 保存备份历史同步设置（格式）
    function saveHistorySyncFormatSettings() {
        const htmlChecked = historySyncHtml?.checked || false;
        const jsonChecked = historySyncJson?.checked || false;

        let format = 'html'; // 默认
        if (htmlChecked && jsonChecked) {
            format = 'both';
        } else if (jsonChecked) {
            format = 'json';
        } else {
            format = 'html';
        }

        chrome.storage.local.set({ historySyncFormat: format });
    }

    // 保存备份历史同步设置（视图模式）
    function saveHistorySyncViewModeSettings() {
        const viewMode = historySyncDetailed?.checked ? 'detailed' : 'simple';
        chrome.storage.local.set({ historySyncViewMode: viewMode });
    }

    // HTML 格式勾选
    if (historySyncHtml) {
        historySyncHtml.addEventListener('change', function () {
            // 至少选一个格式
            if (!this.checked && !historySyncJson.checked) {
                historySyncJson.checked = true;
            }
            saveHistorySyncFormatSettings();
        });
    }

    // JSON 格式勾选
    if (historySyncJson) {
        historySyncJson.addEventListener('change', function () {
            // 至少选一个格式
            if (!this.checked && !historySyncHtml.checked) {
                historySyncHtml.checked = true;
            }
            saveHistorySyncFormatSettings();
        });
    }

    // 简略视图模式勾选（互斥）
    if (historySyncSimple) {
        historySyncSimple.addEventListener('change', function () {
            if (this.checked) {
                if (historySyncDetailed) historySyncDetailed.checked = false;
            } else {
                // 至少选一个
                if (historySyncDetailed) historySyncDetailed.checked = true;
            }
            saveHistorySyncViewModeSettings();
        });
    }

    // 详情视图模式勾选（互斥）
    if (historySyncDetailed) {
        historySyncDetailed.addEventListener('change', function () {
            if (this.checked) {
                if (historySyncSimple) historySyncSimple.checked = false;
            } else {
                // 至少选一个
                if (historySyncSimple) historySyncSimple.checked = true;
            }
            saveHistorySyncViewModeSettings();
        });
    }

    // ===== 备份历史覆盖策略 =====
    const historySyncVersioned = document.getElementById('historySyncVersioned');
    const historySyncOverwrite = document.getElementById('historySyncOverwrite');

    // 加载备份历史覆盖策略
    chrome.storage.local.get(['historySyncOverwriteMode'], function (result) {
        const mode = result.historySyncOverwriteMode || 'versioned';
        if (historySyncVersioned) historySyncVersioned.checked = (mode === 'versioned');
        if (historySyncOverwrite) historySyncOverwrite.checked = (mode === 'overwrite');
    });

    // 保存备份历史覆盖策略
    function saveHistorySyncOverwriteModeSettings() {
        const mode = historySyncOverwrite?.checked ? 'overwrite' : 'versioned';
        chrome.storage.local.set({ historySyncOverwriteMode: mode });
    }

    // 版本化勾选（互斥）
    if (historySyncVersioned) {
        historySyncVersioned.addEventListener('change', function () {
            if (this.checked) {
                if (historySyncOverwrite) historySyncOverwrite.checked = false;
            } else {
                // 至少选一个
                if (historySyncOverwrite) historySyncOverwrite.checked = true;
            }
            saveHistorySyncOverwriteModeSettings();
        });
    }

    // 覆盖勾选（互斥）
    if (historySyncOverwrite) {
        historySyncOverwrite.addEventListener('change', function () {
            if (this.checked) {
                if (historySyncVersioned) historySyncVersioned.checked = false;
            } else {
                // 至少选一个
                if (historySyncVersioned) historySyncVersioned.checked = true;
            }
            saveHistorySyncOverwriteModeSettings();
        });
    }

    // 更新上传按钮上的图标状态
    function updateUploadButtonIcons() {
        // 重新获取元素，确保在函数调用时获取最新状态
        // 注意：这里使用的是函数作用域内的变量名如果它们被提升，但这里我们使用 getElementById 确保安全
        const webDAVToggle = document.getElementById('webDAVToggle');
        const githubRepoToggle = document.getElementById('githubRepoToggle');
        const defaultDownloadToggle = document.getElementById('defaultDownloadToggle');

        const uploadIconWebDAV = document.getElementById('uploadIconWebDAV');
        const uploadIconGitHub = document.getElementById('uploadIconGitHub');
        const uploadIconLocal = document.getElementById('uploadIconLocal');

        if (uploadIconWebDAV) {
            if (webDAVToggle && webDAVToggle.checked) {
                uploadIconWebDAV.classList.add('active');
            } else {
                uploadIconWebDAV.classList.remove('active');
            }
        }

        if (uploadIconGitHub) {
            if (githubRepoToggle && githubRepoToggle.checked) {
                uploadIconGitHub.classList.add('active');
            } else {
                uploadIconGitHub.classList.remove('active');
            }
        }

        if (uploadIconLocal) {
            if (defaultDownloadToggle && defaultDownloadToggle.checked) {
                uploadIconLocal.classList.add('active');
            } else {
                uploadIconLocal.classList.remove('active');
            }
        }
    }

    // 初始化时调用一次
    updateUploadButtonIcons();

    // 监听相关开关的变化
    const webDAVToggle = document.getElementById('webDAVToggle');
    const githubRepoToggle = document.getElementById('githubRepoToggle');
    const defaultDownloadToggle = document.getElementById('defaultDownloadToggle');

    if (webDAVToggle) {
        webDAVToggle.addEventListener('change', updateUploadButtonIcons);
    }
    if (githubRepoToggle) {
        githubRepoToggle.addEventListener('change', updateUploadButtonIcons);
    }
    if (defaultDownloadToggle) {
        defaultDownloadToggle.addEventListener('change', updateUploadButtonIcons);
    }
}


// =============================================================================
// DOMContentLoaded 事件监听器 (Main Entry Point)
// =============================================================================

document.addEventListener('DOMContentLoaded', function () {
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

    // 初始化 Bookmark Toolbox（画布缩略图 + 最近添加）
    initializeBookmarkToolbox();

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
                    // 这会清除书签画布、时间追踪等所有偏好设置
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
                // Prevent unchecking if it's the only one (enforce radio behavior)
                // e.target.checked = true; // Optional: Force one to be checked
                // But if user unchecks Auto, maybe they mean Manual?
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

        // 更新开关UI状态
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
                // 获取显示变化描述的容器元素
                const changeDescriptionContainer = document.getElementById('change-description-row');
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

    // New Reminder Settings Button (in Settings Panel)
    const reminderSettingsBtnNew = document.getElementById('reminderSettingsBtnNew');
    if (reminderSettingsBtnNew) {
        reminderSettingsBtnNew.addEventListener('click', async function () {
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

    // New Auto Backup Settings Button (in Settings Panel)
    const autoBackupSettingsBtnNew = document.getElementById('autoBackupSettingsBtnNew');
    if (autoBackupSettingsBtnNew) {
        autoBackupSettingsBtnNew.addEventListener('click', async function () {
            // Reuse the existing logic by triggering click on the old button (which handles init)
            // Or copy the init logic. Since init logic is complex and handles "alreadyInitialized", triggering click is safer/easier
            // BUT reusing the code block is cleaner if we extract it.
            // For now, let's just trigger the old button's click handler if it exists, or duplicate the logic.
            // Duplicating logic is better to avoid dependency on hidden DOM elements working perfectly.

            // ... copy of Auto Backup Settings Init Logic ...
            console.log('[自动备份设置(New)] 开始初始化UI...');
            const container = document.getElementById('autoBackupTimerUIContainer');
            if (container) {
                const alreadyInitialized = container.querySelector('#autoBackupTimerContainer');
                if (!alreadyInitialized) {
                    try {
                        const lang = await new Promise(resolve => chrome.storage.local.get(['preferredLang'], r => resolve(r.preferredLang || 'zh_CN')));
                        container.innerHTML = '';
                        container.appendChild(createAutoBackupTimerUI(lang));
                        await initializeAutoBackupTimerUIEvents();
                        await loadAutoBackupSettings();
                    } catch (e) { console.error(e); }
                } else {
                    await loadAutoBackupSettings();
                }
            }
            await initRealtimeBackupToggle();
            await applyAutoBackupSettingsLanguage();
            if (autoBackupSettingsDialog) autoBackupSettingsDialog.style.display = 'block';
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

// =============================================================================
// Bookmark Toolbox：画布缩略图 + 书签推荐卡片
// =============================================================================

const browserAPI = (typeof chrome !== 'undefined') ? chrome : (typeof browser !== 'undefined' ? browser : null);
const POPUP_RECOMMEND_CARD_COUNT = 3;

const popupRecommendOpenStrings = {
    'zh_CN': '打开推荐页面',
    'en': 'Open recommendation page'
};

const popupRecommendRefreshStrings = {
    'zh_CN': '刷新推荐',
    'en': 'Refresh recommendations'
};

const popupRecommendLaterSuccessStrings = {
    'zh_CN': '已加入稍后复习队列',
    'en': 'Added to later queue'
};

const popupRecommendLaterErrorStrings = {
    'zh_CN': '推迟失败，请稍后重试',
    'en': 'Failed to postpone, try again later'
};

const popupRecommendBlockSuccessStrings = {
    'zh_CN': '书签已屏蔽',
    'en': 'Bookmark blocked'
};

const popupRecommendBlockErrorStrings = {
    'zh_CN': '屏蔽失败，请稍后重试',
    'en': 'Failed to block bookmark'
};

const popupRecommendEmptyStrings = {
    'zh_CN': '所有书签都已翻阅！',
    'en': 'All bookmarks reviewed!'
};

const popupRecommendLoadFailedStrings = {
    'zh_CN': '推荐加载失败',
    'en': 'Load failed'
};

const popupRecommendLaterOptionLabels = {
    '3600000': { 'zh_CN': '1小时后', 'en': 'In 1 hour' },
    '86400000': { 'zh_CN': '明天', 'en': 'Tomorrow' },
    '259200000': { 'zh_CN': '3天后', 'en': 'In 3 days' },
    '604800000': { 'zh_CN': '1周后', 'en': 'In 1 week' }
};

let popupRecommendLang = 'zh_CN';
let popupRecommendCards = [];
const popupSkippedBookmarks = new Set();
let popupCurrentLaterBookmark = null;
let popupRecommendControlsInitialized = false;
let popupRecommendOverlayInitialized = false;
let popupRecommendLoading = false;
let popupOpenCountRecorded = false; // 防止重复记录

// 增加打开次数（popup 和 history 共享 storage）
async function incrementPopupOpenCount() {
    if (popupOpenCountRecorded) return false; // 本次 popup 打开只记录一次
    popupOpenCountRecorded = true;

    try {
        const result = await new Promise(resolve => {
            browserAPI.storage.local.get('recommendRefreshSettings', resolve);
        });

        const DEFAULT_SETTINGS = {
            refreshEveryNOpens: 3,
            refreshAfterHours: 0,
            refreshAfterDays: 0,
            lastRefreshTime: 0,
            openCountSinceRefresh: 0
        };

        const settings = { ...DEFAULT_SETTINGS, ...result.recommendRefreshSettings };
        settings.openCountSinceRefresh = (settings.openCountSinceRefresh || 0) + 1;

        // 检查是否需要自动刷新
        let shouldRefresh = false;
        const now = Date.now();

        // 条件1: 每N次打开
        if (settings.refreshEveryNOpens > 0 &&
            settings.openCountSinceRefresh >= settings.refreshEveryNOpens) {
            console.log('[Popup] 达到打开次数阈值，需要刷新');
            shouldRefresh = true;
        }

        // 条件2: 超过X小时
        if (!shouldRefresh && settings.refreshAfterHours > 0 && settings.lastRefreshTime > 0) {
            const hoursSinceRefresh = (now - settings.lastRefreshTime) / 3600000;
            if (hoursSinceRefresh >= settings.refreshAfterHours) {
                console.log('[Popup] 超过时间阈值（小时），需要刷新');
                shouldRefresh = true;
            }
        }

        // 条件3: 超过X天
        if (!shouldRefresh && settings.refreshAfterDays > 0 && settings.lastRefreshTime > 0) {
            const daysSinceRefresh = (now - settings.lastRefreshTime) / 86400000;
            if (daysSinceRefresh >= settings.refreshAfterDays) {
                console.log('[Popup] 超过时间阈值（天），需要刷新');
                shouldRefresh = true;
            }
        }

        // 如果需要刷新，重置计数
        if (shouldRefresh) {
            settings.openCountSinceRefresh = 0;
            settings.lastRefreshTime = now;
        }

        await new Promise(resolve => {
            browserAPI.storage.local.set({ recommendRefreshSettings: settings }, resolve);
        });

        console.log('[Popup] 打开次数已记录:', settings.openCountSinceRefresh, '需要刷新:', shouldRefresh);
        return shouldRefresh;
    } catch (e) {
        console.error('[Popup] 记录打开次数失败:', e);
        return false;
    }
}

// 获取共享的推荐窗口ID
async function getRecommendWindowId() {
    return new Promise((resolve) => {
        browserAPI.storage.local.get(['recommendWindowId'], (result) => {
            resolve(result.recommendWindowId || null);
        });
    });
}

// 保存共享的推荐窗口ID
async function saveRecommendWindowId(windowId) {
    await browserAPI.storage.local.set({ recommendWindowId: windowId });
}

// 监听storage变化，实现popup和history页面的实时同步
// 标志：用于防止 popup 页面自己保存的变化触发重复刷新
let popupLastSaveTime = 0;
browserAPI.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.popupCurrentCards) {
        // 检查是否是 popup 页面自己刚保存的（500ms内忽略）
        const now = Date.now();
        if (now - popupLastSaveTime < 500) {
            console.log('[卡片同步] 忽略本页面保存触发的变化');
            return;
        }

        // 检查是否全部勾选，如果是则刷新获取新卡片（来自history页面的翻牌完成）
        const newValue = changes.popupCurrentCards.newValue;
        if (newValue && newValue.cardIds && newValue.flippedIds) {
            const allFlipped = newValue.cardIds.every(id => newValue.flippedIds.includes(id));
            if (allFlipped && newValue.cardIds.length > 0) {
                console.log('[卡片同步] history完成翻牌，刷新卡片');
                refreshPopupRecommendCards(true);
            }
            // 部分勾选不需要刷新
        }
    }
});

function initializeBookmarkToolbox() {
    const canvasContainer = document.getElementById('bookmarkCanvas');
    const canvasThumbnailContainer = document.getElementById('canvasThumbnail');
    const recommendCardsContainer = document.getElementById('bookmarkRecommendCards');

    if (!canvasContainer || !canvasThumbnailContainer || !recommendCardsContainer) {
        return;
    }

    setupPopupRecommendControls();
    setupPopupRecommendLaterOverlay();

    // 点击画布缩略图，直接打开 Bookmark Canvas 视图
    canvasContainer.addEventListener('click', async () => {
        try {
            const url = chrome.runtime.getURL('history_html/history.html?view=canvas');
            await safeCreateTab({ url });
        } catch (e) {
            console.warn('[Bookmark Toolbox] 打开 Canvas 视图失败:', e);
        }
    });

    // 直接同步读取最新缩略图，保证主 UI 打开时立即显示
    // 如果还没有缩略图（首次安装、从未打开 Canvas），显示文本提示
    chrome.storage.local.get(['bookmarkCanvasThumbnail', 'preferredLang'], (data) => {
        try {
            const thumbnail = data.bookmarkCanvasThumbnail;
            const lang = data.preferredLang || 'zh_CN';
            const isEN = (lang === 'en');
            popupRecommendLang = lang;
            updatePopupRecommendLanguage(lang);

            canvasThumbnailContainer.innerHTML = '';

            if (!thumbnail || typeof thumbnail !== 'string') {
                // 没有缩略图时，显示两行文字提示
                const wrapper = document.createElement('div');
                wrapper.style.textAlign = 'center';
                wrapper.style.color = 'var(--theme-text-secondary)';
                wrapper.style.fontSize = '12px';

                const line1 = document.createElement('div');
                line1.textContent = isEN
                    ? 'Bookmark Canvas: click to enter'
                    : '书签画布：点击进入';

                const line2 = document.createElement('div');
                line2.style.marginTop = '4px';
                // 动态读取当前快捷键（来自浏览器快捷键设置），否则回退到默认描述
                const fallbackShortcut = 'Alt+3';
                if (chrome.commands && chrome.commands.getAll) {
                    try {
                        chrome.commands.getAll((commands) => {
                            let shortcut = fallbackShortcut;
                            if (Array.isArray(commands)) {
                                const cmd = commands.find(c => c.name === 'open_canvas_view');
                                if (cmd && cmd.shortcut) {
                                    shortcut = cmd.shortcut;
                                }
                            }
                            line2.textContent = isEN
                                ? `Shortcut: ${shortcut}`
                                : `快捷键：${shortcut}`;
                        });
                    } catch (_) {
                        line2.textContent = isEN
                            ? `Shortcut: ${fallbackShortcut}`
                            : `快捷键：${fallbackShortcut}`;
                    }
                } else {
                    line2.textContent = isEN
                        ? `Shortcut: ${fallbackShortcut}`
                        : `快捷键：${fallbackShortcut}`;
                }

                wrapper.appendChild(line1);
                wrapper.appendChild(line2);
                canvasThumbnailContainer.appendChild(wrapper);
            } else {
                // 有缩略图时显示截图
                canvasThumbnailContainer.style.background = 'none';
                const img = document.createElement('img');
                img.src = thumbnail;
                img.alt = 'Bookmark Canvas Thumbnail';
                img.style.borderRadius = '4px';

                // 直接用 cover，保持比例裁剪边缘，不拉伸变形
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'cover';

                canvasThumbnailContainer.appendChild(img);
            }
        } catch (e) {
            console.warn('[Bookmark Toolbox] 显示 Canvas 缩略图失败:', e);
        } finally {
            refreshPopupRecommendCards();
        }
    });
}

function getRecentFaviconFallback() {
    return 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22%3E%3Cpath fill=%22%23999%22 d=%22M8 0l2.8 5.5 6.2 0.5-4.5 4 1.5 6-5.5-3.5-5.5 3.5 1.5-6-4.5-4 6.2-0.5z%22/%3E%3C/svg%3E';
}

function loadFaviconForRecent(imgElement, url) {
    try {
        if (!url || !(url.startsWith('http://') || url.startsWith('https://'))) {
            imgElement.src = getRecentFaviconFallback();
            return;
        }

        const urlObj = new URL(url);
        const domain = urlObj.hostname;
        // 三层降级策略：
        // 1. 网站自己的favicon（最清晰）
        // 2. DuckDuckGo（国内可访问）
        // 3. Google S2（备选）
        const faviconSources = [
            `${urlObj.protocol}//${domain}/favicon.ico`,
            `https://icons.duckduckgo.com/ip3/${domain}.ico`,
            `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
        ];

        let index = 0;

        const tryNext = () => {
            if (index >= faviconSources.length) {
                imgElement.src = getRecentFaviconFallback();
                return;
            }

            const testImg = new Image();
            const src = faviconSources[index];
            index += 1;

            let timeoutId = setTimeout(() => {
                testImg.onload = null;
                testImg.onerror = null;
                tryNext();
            }, 3000);

            testImg.onload = () => {
                clearTimeout(timeoutId);
                imgElement.src = src;
            };

            testImg.onerror = () => {
                clearTimeout(timeoutId);
                tryNext();
            };

            testImg.src = src;
        };

        // 先使用本地 fallback，异步尝试真实 favicon
        imgElement.src = getRecentFaviconFallback();
        tryNext();
    } catch (e) {
        imgElement.src = getRecentFaviconFallback();
    }
}

function setupPopupRecommendControls() {
    if (popupRecommendControlsInitialized) return;

    const openBtn = document.getElementById('bookmarkRecommendOpenPage');
    if (openBtn) {
        openBtn.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            try {
                const url = chrome.runtime.getURL('history_html/history.html?view=recommend');
                await safeCreateTab({ url });
            } catch (error) {
                console.warn('[Bookmark Toolbox] 打开推荐页面失败:', error);
            }
        });
    }

    const refreshBtn = document.getElementById('bookmarkRecommendRefresh');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            await refreshPopupRecommendCards(true);
        });
    }

    popupRecommendControlsInitialized = true;
}

function setupPopupRecommendLaterOverlay() {
    if (popupRecommendOverlayInitialized) return;
    const overlay = document.getElementById('popupRecommendLaterOverlay');
    if (!overlay) return;

    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            hidePopupRecommendLaterOverlay();
        }
    });

    const closeBtn = document.getElementById('popupRecommendLaterClose');
    if (closeBtn) {
        closeBtn.addEventListener('click', (event) => {
            event.preventDefault();
            hidePopupRecommendLaterOverlay();
        });
    }

    overlay.querySelectorAll('.popup-later-option').forEach(option => {
        option.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!popupCurrentLaterBookmark) return;
            const delay = parseInt(option.dataset.delay, 10);
            try {
                await postponeRecommendBookmark(popupCurrentLaterBookmark.id, delay);
                showStatus(popupRecommendLaterSuccessStrings[popupRecommendLang] || popupRecommendLaterSuccessStrings['zh_CN'], 'success');
                hidePopupRecommendLaterOverlay();
                await refreshPopupRecommendCards(true);
            } catch (error) {
                console.warn('[Bookmark Toolbox] 推迟书签失败:', error);
                showStatus(popupRecommendLaterErrorStrings[popupRecommendLang] || popupRecommendLaterErrorStrings['zh_CN'], 'error');
            }
        });
    });

    popupRecommendOverlayInitialized = true;
}

function showPopupRecommendLaterOverlay(bookmark) {
    popupCurrentLaterBookmark = bookmark;
    const overlay = document.getElementById('popupRecommendLaterOverlay');
    if (overlay) {
        overlay.classList.add('show');
        overlay.setAttribute('aria-hidden', 'false');
    }
}

function hidePopupRecommendLaterOverlay() {
    popupCurrentLaterBookmark = null;
    const overlay = document.getElementById('popupRecommendLaterOverlay');
    if (overlay) {
        overlay.classList.remove('show');
        overlay.setAttribute('aria-hidden', 'true');
    }
}

function updatePopupRecommendLanguage(lang) {
    popupRecommendLang = lang || 'zh_CN';
    const openBtn = document.getElementById('bookmarkRecommendOpenPage');
    if (openBtn) {
        const text = popupRecommendOpenStrings[popupRecommendLang] || popupRecommendOpenStrings['zh_CN'];
        openBtn.setAttribute('title', text);
        openBtn.setAttribute('aria-label', text);
    }

    const refreshBtn = document.getElementById('bookmarkRecommendRefresh');
    if (refreshBtn) {
        const text = popupRecommendRefreshStrings[popupRecommendLang] || popupRecommendRefreshStrings['zh_CN'];
        refreshBtn.setAttribute('title', text);
        refreshBtn.setAttribute('aria-label', text);
    }

    const closeBtn = document.getElementById('popupRecommendLaterClose');
    if (closeBtn) {
        closeBtn.setAttribute('aria-label', popupRecommendLang === 'en' ? 'Close' : '关闭');
    }

    document.querySelectorAll('.popup-later-label').forEach(label => {
        const key = label.dataset.delayLabel;
        if (!key) return;
        const text = popupRecommendLaterOptionLabels[key]?.[popupRecommendLang] ||
            popupRecommendLaterOptionLabels[key]?.['zh_CN'] ||
            label.textContent;
        label.textContent = text;
    });
}

// 获取当前显示的卡片状态
async function getPopupCurrentCards() {
    return new Promise((resolve) => {
        browserAPI.storage.local.get(['popupCurrentCards'], (result) => {
            resolve(result.popupCurrentCards || null);
        });
    });
}

// 保存当前显示的卡片状态（包含cardData用于同步到HTML页面）
async function savePopupCurrentCards(cardIds, flippedIds, cardData = null) {
    // 标记本次保存时间，防止触发循环刷新
    popupLastSaveTime = Date.now();

    const data = {
        cardIds: cardIds,
        flippedIds: flippedIds,
        timestamp: Date.now()
    };

    // 如果提供了cardData，保存它（用于HTML页面同步）
    if (cardData) {
        data.cardData = cardData;
    }

    await browserAPI.storage.local.set({ popupCurrentCards: data });
}

// 标记卡片为已勾选，并检查是否全部勾选
async function markPopupCardFlipped(bookmarkId) {
    const currentCards = await getPopupCurrentCards();
    if (!currentCards) return false;

    // 添加到已勾选列表
    if (!currentCards.flippedIds.includes(bookmarkId)) {
        currentCards.flippedIds.push(bookmarkId);
        await savePopupCurrentCards(currentCards.cardIds, currentCards.flippedIds);
    }

    // 检查是否全部勾选
    const allFlipped = currentCards.cardIds.every(id => currentCards.flippedIds.includes(id));
    return allFlipped;
}

async function refreshPopupRecommendCards(force = false) {
    if (popupRecommendLoading && !force) return;
    const cardsRoot = document.getElementById('bookmarkRecommendCards');
    if (!cardsRoot) return;
    const cards = cardsRoot.querySelectorAll('.popup-recommend-card');
    if (!cards.length) return;

    // 记录打开次数并检查是否需要自动刷新
    const shouldAutoRefresh = await incrementPopupOpenCount();
    if (shouldAutoRefresh && !force) {
        console.log('[Popup] 满足自动刷新条件，强制刷新卡片');
        force = true;
    }

    popupRecommendLoading = true;

    try {
        // 检查是否有已保存的卡片状态
        const currentCards = await getPopupCurrentCards();
        const bookmarks = await fetchAllBookmarksFlat();
        const bookmarkMap = new Map(bookmarks.map(b => [b.id, b]));

        // 如果有保存的卡片且不是全部勾选，则显示保存的卡片
        if (currentCards && currentCards.cardIds && currentCards.cardIds.length > 0 && !force) {
            const allFlipped = currentCards.cardIds.every(id => currentCards.flippedIds.includes(id));

            if (!allFlipped) {
                // 显示保存的卡片
                const reviewData = await getPopupReviewData();
                const postponedList = await getPopupPostponedBookmarks();

                // 构建缓存的卡片数据映射（包含favicon和priority）
                const cachedCardDataMap = new Map();
                if (currentCards.cardData && Array.isArray(currentCards.cardData)) {
                    currentCards.cardData.forEach(data => {
                        if (data && data.id) {
                            cachedCardDataMap.set(data.id, {
                                faviconUrl: data.faviconUrl || null,
                                priority: data.priority || 0
                            });
                        }
                    });
                }

                // 从S值缓存读取（与history.js共享），确保S值始终一致
                let scoresCache = await getPopupScoresCache();

                // 如果S值缓存为空，请求background.js计算
                if (Object.keys(scoresCache).length === 0 && bookmarks.length > 0) {
                    console.log('[Popup] S值缓存为空（恢复卡片时），请求background计算...');
                    await requestComputeScores();
                    scoresCache = await getPopupScoresCache();
                }

                popupRecommendCards = currentCards.cardIds.map(id => {
                    const bookmark = bookmarkMap.get(id);
                    if (bookmark) {
                        // 优先使用S值缓存（与history.js一致）
                        const cached = scoresCache[id];
                        const cachedData = cachedCardDataMap.get(id);
                        // 优先级：S值缓存 > cardData中保存的priority > 默认值0.5
                        const priority = cached ? cached.S : (cachedData?.priority || 0.5);
                        return { ...bookmark, priority, factors: cached || {} };
                    }
                    return null;
                }).filter(Boolean);

                cards.forEach((card, index) => {
                    const bookmark = popupRecommendCards[index];
                    if (bookmark) {
                        // 使用缓存的favicon URL（如果可用）
                        const cachedData = cachedCardDataMap.get(bookmark.id);
                        populatePopupRecommendCard(card, bookmark, cachedData?.faviconUrl);
                        // 恢复勾选状态
                        if (currentCards.flippedIds.includes(bookmark.id)) {
                            card.classList.add('flipped');
                        }
                    } else {
                        resetPopupRecommendCard(card, '--');
                    }
                });

                popupRecommendLoading = false;
                return;
            }
        }

        // 获取新的推荐卡片
        const [flippedList, blockedData, postponedList] = await Promise.all([
            getPopupFlippedBookmarks(),
            getPopupBlockedBookmarks(),
            getPopupPostponedBookmarks()
        ]);

        const now = Date.now();
        const flippedSet = new Set(flippedList || []);
        const blockedBookmarks = new Set(blockedData.bookmarks || []);
        const blockedFolders = new Set(blockedData.folders || []);
        const blockedDomains = new Set((blockedData.domains || []).map(normalizeDomain));
        const postponedSet = new Set(
            postponedList.filter(item => item.postponeUntil > now).map(item => item.bookmarkId)
        );

        const availableBookmarks = bookmarks.filter(bookmark => {
            if (!bookmark.url) return false;
            if (flippedSet.has(bookmark.id)) return false;
            if (popupSkippedBookmarks.has(bookmark.id)) return false;
            if (blockedBookmarks.has(bookmark.id)) return false;
            if (postponedSet.has(bookmark.id)) return false;

            if (blockedFolders.size && bookmark.ancestorFolderIds) {
                for (const folderId of bookmark.ancestorFolderIds) {
                    if (blockedFolders.has(folderId)) return false;
                }
            }

            if (blockedDomains.size && bookmark.domain) {
                const normalized = normalizeDomain(bookmark.domain);
                if (blockedDomains.has(normalized)) return false;
            }

            return true;
        });

        if (!availableBookmarks.length) {
            popupRecommendCards = [];
            // 清除保存的卡片状态
            await savePopupCurrentCards([], []);
            cards.forEach((card, index) => {
                const message = index === 0
                    ? (popupRecommendEmptyStrings[popupRecommendLang] || popupRecommendEmptyStrings['zh_CN'])
                    : '--';
                resetPopupRecommendCard(card, message);
            });
            popupRecommendLoading = false;
            return;
        }

        const reviewData = await getPopupReviewData();
        // 从S值缓存读取（与history.js共享），保持一致性
        let scoresCache = await getPopupScoresCache();

        // 如果S值缓存为空，请求background.js计算
        if (Object.keys(scoresCache).length === 0 && bookmarks.length > 0) {
            console.log('[Popup] S值缓存为空，请求background计算...');
            await requestComputeScores();
            scoresCache = await getPopupScoresCache();
        }

        const bookmarksWithPriority = availableBookmarks.map(bookmark => {
            const cached = scoresCache[bookmark.id];
            // 使用缓存的S值（与history.js一致），缓存不存在时使用默认值0.5
            const basePriority = cached ? cached.S : 0.5;
            const priority = calculatePopupPriorityWithReview(basePriority, bookmark.id, reviewData, postponedList);
            return { ...bookmark, priority, factors: cached || {} };
        });

        // 按优先级排序，S值相同时添加随机因子（与history.js一致）
        bookmarksWithPriority.sort((a, b) => {
            const diff = b.priority - a.priority;
            if (Math.abs(diff) < 0.01) {
                return Math.random() - 0.5;
            }
            return diff;
        });
        popupRecommendCards = bookmarksWithPriority.slice(0, POPUP_RECOMMEND_CARD_COUNT);

        // 保存新的卡片状态（包含cardData用于HTML页面同步）
        const newCardIds = popupRecommendCards.map(b => b.id);
        const newCardData = popupRecommendCards.map(b => {
            let favicon = '';
            if (b.url) {
                try {
                    const urlObj = new URL(b.url);
                    // 使用网站自己的favicon（最清晰）
                    favicon = `${urlObj.protocol}//${urlObj.hostname}/favicon.ico`;
                } catch (e) {
                    favicon = '';
                }
            }
            return {
                id: b.id,
                title: b.title || '',
                url: b.url || '',
                favicon
            };
        });
        await savePopupCurrentCards(newCardIds, [], newCardData);

        cards.forEach((card, index) => {
            const bookmark = popupRecommendCards[index];
            if (bookmark) {
                populatePopupRecommendCard(card, bookmark);
            } else {
                resetPopupRecommendCard(card, '--');
            }
        });
    } catch (error) {
        console.warn('[Bookmark Toolbox] 加载推荐卡片失败:', error);
        const message = popupRecommendLoadFailedStrings[popupRecommendLang] || popupRecommendLoadFailedStrings['zh_CN'];
        cards.forEach((card, index) => {
            resetPopupRecommendCard(card, index === 0 ? message : '--');
        });
    } finally {
        popupRecommendLoading = false;
    }
}

function resetPopupRecommendCard(card, message) {
    if (!card) return;
    card.classList.add('empty');
    card.classList.remove('flipped');
    card.dataset.bookmarkId = '';

    const titleEl = card.querySelector('.popup-recommend-title');
    if (titleEl) titleEl.textContent = message;

    const priorityEl = card.querySelector('.popup-recommend-priority');
    if (priorityEl) priorityEl.textContent = 'S = --';

    const favicon = card.querySelector('.popup-recommend-favicon');
    if (favicon) favicon.src = getRecentFaviconFallback();

    card.onclick = null;
    card.querySelectorAll('.popup-card-btn').forEach(btn => {
        btn.onclick = null;
    });
}

function populatePopupRecommendCard(card, bookmark, cachedFaviconUrl = null) {
    if (!card) return;
    card.classList.remove('empty');
    card.classList.remove('flipped');
    card.dataset.bookmarkId = bookmark.id;

    const titleEl = card.querySelector('.popup-recommend-title');
    if (titleEl) {
        titleEl.textContent = bookmark.title || bookmark.url || (popupRecommendLang === 'en' ? '(No title)' : '（无标题）');
    }

    const favicon = card.querySelector('.popup-recommend-favicon');
    if (favicon) {
        // 优先使用缓存的favicon URL（来自history.js的预加载）
        if (cachedFaviconUrl) {
            favicon.src = cachedFaviconUrl;
        } else {
            loadFaviconForRecent(favicon, bookmark.url);
        }
    }

    const priorityEl = card.querySelector('.popup-recommend-priority');
    if (priorityEl) {
        priorityEl.textContent = `S = ${bookmark.priority.toFixed(2)}`;
    }

    card.onclick = async (event) => {
        if (event.target.closest('.popup-recommend-actions')) return;
        try {
            await markPopupBookmarkFlipped(bookmark.id);
            await recordPopupReview(bookmark.id);
            await openPopupRecommendTarget(bookmark.url);
            card.classList.add('flipped');

            // 更新本地卡片勾选状态（storage监听器会自动处理刷新）
            await markPopupCardFlipped(bookmark.id);
        } catch (error) {
            console.warn('[Bookmark Toolbox] 打开推荐书签失败:', error);
        }
    };

    const blockBtn = card.querySelector('.popup-card-btn-block');
    if (blockBtn) {
        blockBtn.onclick = async (event) => {
            event.preventDefault();
            event.stopPropagation();
            try {
                const success = await blockPopupBookmark(bookmark.id);
                if (success) {
                    showStatus(popupRecommendBlockSuccessStrings[popupRecommendLang] || popupRecommendBlockSuccessStrings['zh_CN'], 'success');
                } else {
                    showStatus(popupRecommendBlockErrorStrings[popupRecommendLang] || popupRecommendBlockErrorStrings['zh_CN'], 'error');
                }
            } catch (error) {
                console.warn('[Bookmark Toolbox] 屏蔽书签失败:', error);
                showStatus(popupRecommendBlockErrorStrings[popupRecommendLang] || popupRecommendBlockErrorStrings['zh_CN'], 'error');
            }
            await refreshPopupRecommendCards(true);
        };
    }

    const laterBtn = card.querySelector('.popup-card-btn-later');
    if (laterBtn) {
        laterBtn.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            showPopupRecommendLaterOverlay(bookmark);
        };
    }

    const skipBtn = card.querySelector('.popup-card-btn-skip');
    if (skipBtn) {
        skipBtn.onclick = async (event) => {
            event.preventDefault();
            event.stopPropagation();
            popupSkippedBookmarks.add(bookmark.id);
            await refreshPopupRecommendCards(true);
        };
    }
}

function normalizeDomain(domain) {
    if (!domain) return '';
    return domain.toLowerCase().replace(/^www\./, '');
}

async function fetchAllBookmarksFlat() {
    const tree = await new Promise((resolve) => {
        try {
            if (chrome && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
                chrome.runtime.sendMessage({ action: 'getBookmarkSnapshot' }, (resp) => {
                    if (resp && resp.success && Array.isArray(resp.tree)) {
                        resolve(resp.tree);
                    } else {
                        chrome.bookmarks.getTree(resolve);
                    }
                });
                return;
            }
        } catch (_) { }
        chrome.bookmarks.getTree(resolve);
    });

    if (!tree || !tree.length) {
        return [];
    }

    const results = [];
    function traverse(nodes, ancestorFolderIds = []) {
        nodes.forEach(node => {
            if (node.url) {
                results.push({
                    id: node.id,
                    title: node.title,
                    url: node.url,
                    dateAdded: node.dateAdded,
                    domain: normalizeDomain((() => {
                        try {
                            return new URL(node.url).hostname;
                        } catch (_) {
                            return '';
                        }
                    })()),
                    ancestorFolderIds
                });
            }
            if (node.children && node.children.length) {
                const nextAncestors = node.url ? ancestorFolderIds : [...ancestorFolderIds, node.id];
                traverse(node.children, nextAncestors);
            }
        });
    }

    traverse(tree, []);
    return results;
}

async function getPopupBlockedBookmarks() {
    return new Promise((resolve) => {
        browserAPI.storage.local.get(['recommend_blocked'], (result) => {
            if (browserAPI.runtime && browserAPI.runtime.lastError) {
                console.warn('[Bookmark Toolbox] 获取屏蔽数据失败:', browserAPI.runtime.lastError.message);
            }
            resolve(result.recommend_blocked || { bookmarks: [], folders: [], domains: [] });
        });
    });
}

async function blockPopupBookmark(bookmarkId) {
    try {
        const targetList = await new Promise((resolve) => {
            browserAPI.bookmarks.get(bookmarkId, resolve);
        });

        if (!targetList || !targetList.length) {
            return false;
        }

        const targetBookmark = targetList[0];
        const targetTitle = targetBookmark.title;

        const allBookmarks = await fetchAllBookmarksFlat();
        const sameTitleBookmarks = allBookmarks.filter(b => b.title === targetTitle);

        const blocked = await getPopupBlockedBookmarks();
        let updated = false;

        sameTitleBookmarks.forEach(bookmark => {
            if (!blocked.bookmarks.includes(bookmark.id)) {
                blocked.bookmarks.push(bookmark.id);
                updated = true;
            }
        });

        if (updated) {
            await browserAPI.storage.local.set({ recommend_blocked: blocked });
        }

        return true;
    } catch (error) {
        console.warn('[Bookmark Toolbox] 屏蔽书签失败:', error);
        return false;
    }
}

async function getPopupPostponedBookmarks() {
    return new Promise((resolve) => {
        browserAPI.storage.local.get(['recommend_postponed'], (result) => {
            if (browserAPI.runtime && browserAPI.runtime.lastError) {
                console.warn('[Bookmark Toolbox] 获取稍后队列失败:', browserAPI.runtime.lastError.message);
            }
            resolve(result.recommend_postponed || []);
        });
    });
}

async function postponeRecommendBookmark(bookmarkId, delayMs) {
    const postponed = await getPopupPostponedBookmarks();
    const now = Date.now();
    const existing = postponed.find(item => item.bookmarkId === bookmarkId);

    if (existing) {
        existing.postponeUntil = now + delayMs;
        existing.postponeCount = (existing.postponeCount || 0) + 1;
        existing.updatedAt = now;
    } else {
        postponed.push({
            bookmarkId,
            postponeUntil: now + delayMs,
            postponeCount: 1,
            createdAt: now,
            updatedAt: now
        });
    }

    await browserAPI.storage.local.set({ recommend_postponed: postponed });
}

async function getPopupReviewData() {
    return new Promise((resolve) => {
        browserAPI.storage.local.get(['recommend_reviews'], (result) => {
            resolve(result.recommend_reviews || {});
        });
    });
}

async function recordPopupReview(bookmarkId) {
    const reviews = await getPopupReviewData();
    const now = Date.now();
    const existing = reviews[bookmarkId];

    if (existing) {
        const newInterval = Math.min(existing.interval * 2, 30);
        reviews[bookmarkId] = {
            lastReview: now,
            interval: newInterval,
            reviewCount: existing.reviewCount + 1,
            nextReview: now + newInterval * 24 * 60 * 60 * 1000
        };
    } else {
        reviews[bookmarkId] = {
            lastReview: now,
            interval: 1,
            reviewCount: 1,
            nextReview: now + 24 * 60 * 60 * 1000
        };
    }

    await browserAPI.storage.local.set({ recommend_reviews: reviews });
}

function getPopupReviewStatus(bookmarkId, reviewData) {
    const review = reviewData[bookmarkId];
    if (!review) return { priority: 1 };

    const now = Date.now();
    if (now >= review.nextReview) {
        return { priority: 1.2 };
    }

    const daysSinceReview = (now - review.lastReview) / (1000 * 60 * 60 * 24);
    if (daysSinceReview >= review.interval * 0.7) {
        return { priority: 1.1 };
    }

    return { priority: 0.9 };
}

function calculatePopupPriorityWithReview(basePriority, bookmarkId, reviewData, postponedData) {
    let priority = basePriority;
    const reviewStatus = getPopupReviewStatus(bookmarkId, reviewData);
    priority *= reviewStatus.priority || 1;

    const postponeInfo = postponedData.find(item => item.bookmarkId === bookmarkId);
    if (postponeInfo && postponeInfo.postponeCount > 0) {
        priority *= Math.pow(0.9, postponeInfo.postponeCount);
    }

    return Math.min(priority, 1.5);
}

// 从 storage.local 获取S值缓存（与history.js共享）
async function getPopupScoresCache() {
    return new Promise((resolve) => {
        browserAPI.storage.local.get(['recommend_scores_cache'], (result) => {
            resolve(result.recommend_scores_cache || {});
        });
    });
}

// 请求background.js计算S值缓存
async function requestComputeScores() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'computeBookmarkScores' }, (response) => {
            if (chrome.runtime.lastError) {
                console.warn('[Popup] 请求计算S值失败:', chrome.runtime.lastError.message);
                resolve(false);
            } else {
                resolve(response?.success || false);
            }
        });
    });
}

async function getPopupFlippedBookmarks() {
    return new Promise((resolve) => {
        browserAPI.storage.local.get(['flippedBookmarks'], (result) => {
            resolve(result.flippedBookmarks || []);
        });
    });
}

async function markPopupBookmarkFlipped(bookmarkId) {
    const flipped = await getPopupFlippedBookmarks();
    if (!flipped.includes(bookmarkId)) {
        flipped.push(bookmarkId);
        await browserAPI.storage.local.set({ flippedBookmarks: flipped });
    }

    const result = await new Promise((resolve) => {
        browserAPI.storage.local.get(['flipHistory'], resolve);
    });

    const flipHistory = result.flipHistory || [];
    flipHistory.push({
        bookmarkId,
        timestamp: Date.now()
    });
    await browserAPI.storage.local.set({ flipHistory });
}

async function openPopupRecommendTarget(url) {
    if (!url) return;

    if (!browserAPI?.windows || !browserAPI?.tabs) {
        await safeCreateTab({ url });
        return;
    }

    try {
        // 从storage获取共享的窗口ID
        let windowId = await getRecommendWindowId();

        if (windowId) {
            try {
                await browserAPI.windows.get(windowId);
                await browserAPI.tabs.create({
                    windowId: windowId,
                    url,
                    active: true
                });
                await browserAPI.windows.update(windowId, { focused: true });
                return;
            } catch (_) {
                // 窗口不存在，清除保存的ID
                await saveRecommendWindowId(null);
            }
        }

        const screenInfo = (typeof window !== 'undefined' && window.screen) ? window.screen :
            (typeof screen !== 'undefined' ? screen : null);
        const availWidth = screenInfo?.availWidth || 1280;
        const availHeight = screenInfo?.availHeight || 800;
        const width = Math.min(1200, Math.round(availWidth * 0.75));
        const height = Math.min(800, Math.round(availHeight * 0.8));
        const left = Math.round((availWidth - width) / 2);
        const top = Math.round((availHeight - height) / 2);

        const win = await browserAPI.windows.create({
            url,
            type: 'normal',
            width,
            height,
            left,
            top,
            focused: true
        });
        // 保存窗口ID到storage，供popup和history共享
        await saveRecommendWindowId(win.id);
    } catch (error) {
        console.warn('[Bookmark Toolbox] 打开推荐窗口失败，退回普通标签页:', error);
        await safeCreateTab({ url });
    }
}
