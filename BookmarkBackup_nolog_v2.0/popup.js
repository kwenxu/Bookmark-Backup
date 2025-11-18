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
let localConfigPanelOpen = false;

let isBackgroundConnected = false;
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 3;

// 国际化文本对象（全局定义，在 applyLocalizedContent 中初始化）
let webdavConfigMissingStrings, webdavConfigSavedStrings, webdavBackupEnabledStrings, webdavBackupDisabledStrings;
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
    chrome.storage.local.get(['preferredLang'], function(result) {
        const currentLang = result.preferredLang || 'zh_CN';

        // 消息映射表 - 将中文消息映射到消息键
        const messageMap = {
            // WebDAV配置相关
            '请填写完整的WebDAV配置信息': 'webdavConfigMissing',
            'WebDAV配置已保存，备份已启用': 'webdavConfigSaved',

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
            '导出历史记录失败:': 'historyExportError'
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
                    for (const {pattern, getKey} of patternMap) {
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
        backgroundPort = chrome.runtime.connect({name: "popupConnect"});
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

// 设置初始状态
    configContent.style.display = 'none';

    // 绑定点击事件
    configHeader.addEventListener('click', function(event) {
        // 检查点击是否在开关元素上，如果是则不切换面板
        if (event.target.id === 'webDAVToggle' || event.target.closest('.switch')) {
return;
        }

toggleConfigPanel(configContent, configHeader);
    });

    // 添加保存WebDAV配置的处理
    const saveButton = document.getElementById('saveKey');
    if (saveButton) {
        saveButton.addEventListener('click', function() {
            const serverAddress = document.getElementById('serverAddress').value.trim();
            const username = document.getElementById('username').value.trim();
            const password = document.getElementById('password').value;

            if (!serverAddress || !username || !password) {
                showStatus('请填写完整的WebDAV配置信息', 'error');
                return;
            }

            // 保存配置并自动打开开关
            chrome.storage.local.set({
                serverAddress: serverAddress,
                username: username,
                password: password,
                webDAVEnabled: true  // 自动打开开关
            }, function() {
                // 保存成功后切换开关为打开状态
                const webDAVToggle = document.getElementById('webDAVToggle');
                if (webDAVToggle) {
                    webDAVToggle.checked = true;
                }

                showStatus('WebDAV配置已保存，备份已启用', 'success');

                // 更新状态指示器
                const configStatus = document.getElementById('configStatus');
                if (configStatus) {
                    configStatus.classList.remove('not-configured');
                    configStatus.classList.add('configured');
                }

                // 自动折叠面板
                setTimeout(() => {
                    const configContent = document.getElementById('configContent');
                    const configHeader = document.getElementById('configHeader');
                    if (configContent && configHeader) {
                        // 如果当前是展开状态才折叠
                        if (configContent.style.display === 'block') {
                            toggleConfigPanel(configContent, configHeader);
                        }
                    }
                }, 500); // 延迟500ms，让用户可以看到保存成功的提示
            });
        });
    }
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
        localConfigHeader.addEventListener('click', function() {
            if (localConfigContent.style.display === 'none' || localConfigContent.style.display === '') {
                localConfigContent.style.display = 'block';
                setTimeout(() => {
                    window.scrollBy({
                        top: 160,
                        behavior: 'smooth'
                    });
                }, 100);
            } else {
                localConfigContent.style.display = 'none';
            }
        });
    }

    // 初始化，加载默认下载路径状态
    chrome.storage.local.get(['defaultDownloadEnabled', 'hideDownloadShelf', 'customDownloadPath'], function(result) {
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
        defaultDownloadToggle.addEventListener('change', function() {
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
            }, function() {
                showStatus(`本地备份已${enabled ? '启用' : '禁用'}`, 'success');
                updateLocalStatusDot();
            });
        });
    }

    // 处理隐藏下载栏开关
    if (hideDownloadShelfToggle) {
        hideDownloadShelfToggle.addEventListener('change', function() {
            const enabled = this.checked;

            // 保存配置
            chrome.storage.local.set({ hideDownloadShelf: enabled }, function() {
                showStatus(`备份时${enabled ? '将' : '不再'}隐藏下载栏`, 'info');
            });
        });
    }

    // 处理校准按钮点击事件
    if (calibratePathBtn) {
        // 更改按钮样式
        calibratePathBtn.style.backgroundColor = "#007AFF"; // 修改为蓝色
        // 保持原有事件处理
        calibratePathBtn.addEventListener('click', function() {
            calibrateDownloadPath();
        });
    }

    // 打开Chrome下载设置
    if (openDownloadSettings) {
        openDownloadSettings.addEventListener('click', function(e) {
            e.preventDefault();

            // 方法1：直接使用runtime.openOptionsPage 打开浏览器内部页面
            chrome.runtime.sendMessage({ action: "openDownloadSettings" }, function(response) {
                if (response && response.success) {
} else {
// 方法2：提供备用方案，让用户手动访问
                    const msg = '请手动复制并在新标签页打开: chrome://settings/downloads';
                    showStatus(msg, 'info', 5000);

                    // 尝试复制到剪贴板
                    try {
                        navigator.clipboard.writeText('chrome://settings/downloads').then(() => {
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
        webDAVToggle.addEventListener('change', function() {
            const enabled = webDAVToggle.checked;
            chrome.storage.local.set({ webDAVEnabled: enabled }, function() { // 使用 chrome.storage
                showStatus(`WebDAV备份已${enabled ? '启用' : '禁用'}`, 'success');
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

        newGeneralScrollBtn.addEventListener('click', function() {
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
        scrollToTopFloating.addEventListener('click', function() {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            this.style.transform = 'translateX(-50%) scale(0.95)';
            setTimeout(() => { 
                this.style.transform = 'translateX(-50%) scale(1)'; 
            }, 200);
        });

        // 鼠标悬停效果
        scrollToTopFloating.addEventListener('mouseenter', function() {
            this.style.transform = 'translateX(-50%) scale(1.05)';
            this.style.background = 'rgba(0, 0, 0, 0.25)';
            this.style.borderColor = 'rgba(255, 255, 255, 0.3)';
            this.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
        });
        
        scrollToTopFloating.addEventListener('mouseleave', function() {
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
        
        // 使用getBoundingClientRect检测备份检查记录区域的位置
        const rect = syncHistoryElement.getBoundingClientRect();
        const windowHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        
        // 仅当「备份检查记录」区域的最下边缘进入视野时才显示按钮
        // rect.bottom > 0 && rect.bottom <= windowHeight 表示下边缘在视口内
        const shouldShow = rect.bottom > 0 && rect.bottom <= windowHeight;
        
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
            chrome.storage.local.get(['serverAddress', 'username', 'password', 'webDAVEnabled'], (result) => {
                if (chrome.runtime.lastError) {
                    return reject(chrome.runtime.lastError);
                }
                resolve(result);
            });
        });

if (data.serverAddress) {
            serverAddressInput.value = data.serverAddress;
        }
        if (data.username) {
            usernameInput.value = data.username;
        }
        if (data.password) {
            passwordInput.value = data.password;
        }

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
 * 更新下载路径显示。
 */
function updateDownloadPathDisplay() {
    const downloadPathDisplay = document.getElementById('downloadPathDisplay');
    if (!downloadPathDisplay) return;


    // 显示加载状态
    downloadPathDisplay.textContent = "正在获取下载路径...";
    downloadPathDisplay.style.color = "#666";

    // 获取浏览器默认下载路径
    chrome.runtime.sendMessage({ action: "getDownloadPath" }, function(response) {
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
    ], function(result) {
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
                if (response && response.success) resolve(response.syncHistory || []);
                else { console.error('获取备份历史记录失败 in Promise'); resolve([]); }
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

        // 为详情按钮添加全局事件委托
        historyList.addEventListener('click', (e) => {
            if (e.target.closest('.details-btn')) {
                const btn = e.target.closest('.details-btn');
                const recordTime = btn.getAttribute('data-record-time');
                console.log('[详情按钮委托] 点击，recordTime:', recordTime);
                if (recordTime) {
                    const historyPageUrl = chrome.runtime.getURL('history_html/history.html') + `?view=history&record=${recordTime}`;
                    console.log('[详情按钮委托] 打开URL:', historyPageUrl);
                    window.open(historyPageUrl, '_blank');
                }
            }
        });

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
                'zh_CN': "备份历史 (最多100条记录--静默清理与导出txt)",
                'en': "Backup History (Up to 100 records--silent clear & export txt)"
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
                <div class="header-item" style="flex: 1; text-align: center;">Time & Notes</div>
                <div class="header-item" style="flex: 1; text-align: center;">Quantity & Structure</div>
            `;
        } else {
            headerHTML = `
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

            // 添加一个变量来跟踪上一条记录的日期和上一个元素
            let previousDate = null;
            let lastHistoryItem = null;

            reversedHistory.forEach((record, index) => {
                const historyItem = document.createElement('div');
                historyItem.className = 'history-item';
                
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
                    } else if (record.direction === 'upload' || record.direction === 'webdav') {
                        locationText = `<span style="color: #007AFF; font-weight: bold;">${dynamicTextStrings.cloudText[currentLang] || '云端'}</span>`;
                    } else if (record.direction === 'download' || record.direction === 'local') {
                        locationText = `<span style="color: #9370DB; font-weight: bold;">${dynamicTextStrings.localText[currentLang] || '本地'}</span>`;
                    } else if (record.direction === 'both') {
                        locationText = `<span style="color: #007AFF; font-weight: bold;">${dynamicTextStrings.cloudText[currentLang] || '云端'}</span>${currentLang === 'en' ? ' &' : '与'}<span style="color: #9370DB; font-weight: bold;">${dynamicTextStrings.localText[currentLang] || '本地'}</span>`;
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

                    if (record.bookmarkStats.bookmarkDiff !== undefined) {
                        explicitBookmarkDiffInRecord = record.bookmarkStats.bookmarkDiff;
                        recordHasAnyExplicitDiff = true;
                    } else if (record.bookmarkStats.added !== undefined && record.bookmarkStats.removed !== undefined) {
                        explicitBookmarkDiffInRecord = record.bookmarkStats.added - record.bookmarkStats.removed;
                        recordHasAnyExplicitDiff = true;
                    }

                    if (record.bookmarkStats.folderDiff !== undefined) {
                        explicitFolderDiffInRecord = record.bookmarkStats.folderDiff;
                        recordHasAnyExplicitDiff = true;
                    } else if (record.bookmarkStats.foldersAdded !== undefined && record.bookmarkStats.foldersRemoved !== undefined) {
                        explicitFolderDiffInRecord = record.bookmarkStats.foldersAdded - record.bookmarkStats.foldersRemoved;
                        recordHasAnyExplicitDiff = true;
                    }

                    // 场景1: 如果是清空后的第一条新记录，并且 cachedRecord 存在，则使用它来计算差异
                    // (index === 0 是因为 reversedHistory 将最新记录放在了最前面)
                    if (cachedRecord && syncHistory.length === 1 && record.time > cachedRecord.time && index === 0) {
                        const prevBookmarkCountFromCache = cachedRecord.bookmarkStats?.currentBookmarks ?? cachedRecord.bookmarkStats?.currentBookmarkCount ?? 0;
                        const prevFolderCountFromCache = cachedRecord.bookmarkStats?.currentFolders ?? cachedRecord.bookmarkStats?.currentFolderCount ?? 0;

                        bookmarkDiff = currentBookmarkCount - prevBookmarkCountFromCache;
                        folderDiff = currentFolderCount - prevFolderCountFromCache;

                        cacheWasUsedForListDisplay = true; // 标记缓存被用于列表显示
}
                    // 场景 2: 记录本身包含显式差异 (且未被缓存场景覆盖)
                    else if (recordHasAnyExplicitDiff) {
                        bookmarkDiff = explicitBookmarkDiffInRecord !== undefined ? explicitBookmarkDiffInRecord : 0;
                        folderDiff = explicitFolderDiffInRecord !== undefined ? explicitFolderDiffInRecord : 0;
}
                    // 场景 3: 无缓存覆盖、无记录内显式差异，则尝试与列表中的上一条(时间上更早的)记录比较
                    else if ((index + 1) < reversedHistory.length) { // index + 1 起向后寻找最近一条带统计的记录
                        let prevRecordInList = null;
                        for (let j = index + 1; j < reversedHistory.length; j++) {
                            const candidate = reversedHistory[j];
                            if (candidate && candidate.bookmarkStats &&
                                (candidate.bookmarkStats.currentBookmarks !== undefined || candidate.bookmarkStats.currentBookmarkCount !== undefined) &&
                                (candidate.bookmarkStats.currentFolders !== undefined || candidate.bookmarkStats.currentFolderCount !== undefined)) {
                                prevRecordInList = candidate;
                                break;
                            }
                        }
                        if (prevRecordInList) {
                            const prevBCount = prevRecordInList.bookmarkStats.currentBookmarks ?? prevRecordInList.bookmarkStats.currentBookmarkCount ?? 0;
                            const prevFCount = prevRecordInList.bookmarkStats.currentFolders ?? prevRecordInList.bookmarkStats.currentFolderCount ?? 0;
                            bookmarkDiff = currentBookmarkCount - prevBCount;
                            folderDiff = currentFolderCount - prevFCount;
                        }
                    }
                    // 其他情况 (如列表中的第一条记录，但无缓存或不满足缓存条件，且自身无显式差异): diff 保持为 0
                    else {
}

                    // ... (原有的根据 bookmarkDiff, folderDiff, 结构变化等格式化 bookmarkStatsHTML 的逻辑)
                    const bookmarkMoved = record.bookmarkStats.bookmarkMoved || false;
                    const folderMoved = record.bookmarkStats.folderMoved || false;
                    const bookmarkModified = record.bookmarkStats.bookmarkModified || false;
                    const folderModified = record.bookmarkStats.folderModified || false;
                    const hasAnyNumberColor = bookmarkDiff !== 0 || folderDiff !== 0;
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
                        // 中文：数字和单位之间没有空格
                        formattedBookmarkCount = `${currentBookmarkCount}${bookmarkText}`;
                        formattedFolderCount = `${currentFolderCount}${folderText}`;
                    }

                    if (currentLang === 'zh_CN') {
                        bookmarkStatsHTML = `<div style="font-weight: bold; display: flex; justify-content: center; align-items: baseline;">
                                                <span style="padding-right: 2px;">${formattedBookmarkCount}</span>
                                                <span>,</span>
                                                <span style="padding-left: 2px;">${formattedFolderCount}</span>
                                           </div>`;
                    } else {
                        bookmarkStatsHTML = `<div style="font-weight: bold; text-align: center;">${formattedBookmarkCount}<span style="display:inline-block; width:6px;"></span>,<span style="display:inline-block; width:6px;"></span>${formattedFolderCount}</div>`;
                    }

                    if (hasAnyChange) {
                        let numericalDiffHTML = "";
                        let structuralDiffHTML = ""; // structuralDiffHTML 保持不变，因为它现在用 "、"

                        if (hasAnyNumberColor) {
                            let partB_diff = "";
                            if (bookmarkDiff !== 0) {
                                const bookmarkSign = bookmarkDiff > 0 ? "+" : "";
                                const bookmarkColor = bookmarkDiff > 0 ? "#4CAF50" : (bookmarkDiff < 0 ? "#F44336" : "#777777");
                                if (currentLang === 'en') {
                                    partB_diff += `<span style="color: ${bookmarkColor}; font-weight: bold;">${bookmarkSign}${bookmarkDiff}</span> ${dynamicTextStrings.bookmarksText[currentLang] || 'bookmarks'}`;
                                } else {
                                    partB_diff += `<span style="color: ${bookmarkColor}; font-weight: bold;">${bookmarkSign}${bookmarkDiff}</span>${dynamicTextStrings.bookmarksText[currentLang] || '书签'}`;
                                }
                            }

                            let partF_diff = "";
                            if (folderDiff !== 0) {
                                const folderSign = folderDiff > 0 ? "+" : "";
                                const folderColor = folderDiff > 0 ? "#4CAF50" : (folderDiff < 0 ? "#F44336" : "#777777");
                                if (currentLang === 'en') {
                                    partF_diff += `<span style="color: ${folderColor}; font-weight: bold;">${folderSign}${folderDiff}</span> ${dynamicTextStrings.foldersText[currentLang] || 'folders'}`;
                                } else {
                                    partF_diff += `<span style="color: ${folderColor}; font-weight: bold;">${folderSign}${folderDiff}</span>${dynamicTextStrings.foldersText[currentLang] || '文件夹'}`;
                                }
                            }

                            if (currentLang === 'zh_CN' && bookmarkDiff !== 0 && folderDiff !== 0) {
                                numericalDiffHTML = `<div style="margin-top: 4px; display: flex; justify-content: center; align-items: baseline; white-space: nowrap; font-size: inherit;">
                                                        <span>(</span>
                                                        <span style="padding-right: 2px;">${partB_diff}</span>
                                                        <span>,</span>
                                                        <span style="padding-left: 2px;">${partF_diff}</span>
                                                        <span>)</span>
                                                   </div>`;
                            } else {
                                let numDiffCombined = "";
                                if (partB_diff) numDiffCombined += partB_diff;
                                if (partB_diff && partF_diff) {
                                    numDiffCombined += `<span style="display:inline-block; width:6px;"></span>,<span style="display:inline-block; width:6px;"></span>`;
                                }
                                if (partF_diff) numDiffCombined += partF_diff;
                                if (numDiffCombined) numericalDiffHTML = `<div style="margin-top: 4px; text-align: center; white-space: nowrap; font-size: inherit;">(${numDiffCombined})</div>`;
                            }
                        }

                        // 结构变动部分 (structuralDiffHTML) - 显示具体变化类型而非通用标签
                        if (hasStructuralChange) {
                            const structDiffParts = [];
                            
                            // 根据具体的结构变化类型构建标签
                            if (bookmarkMoved || folderMoved) {
                                structDiffParts.push(`<span style="color: #FF9800; font-weight: bold;">${currentLang === 'en' ? 'Moved' : '移动'}</span>`);
                            }
                            if (bookmarkModified || folderModified) {
                                structDiffParts.push(`<span style="color: #2196F3; font-weight: bold;">${currentLang === 'en' ? 'Modified' : '修改'}</span>`);
                            }
                            
                            const separator = currentLang === 'en' ? '<span style="display:inline-block; width:4px;"></span>|<span style="display:inline-block; width:4px;"></span>' : '、';
                            const structDiffPart = structDiffParts.join(separator);

                            const marginTop = numericalDiffHTML ? 'margin-top: 2px;' : 'margin-top: 4px;';
                            const widthStyle = currentLang === 'en' ? 'width: auto; overflow: visible;' : '';
                            if (structDiffPart) structuralDiffHTML = `<div style="${marginTop} text-align: center; white-space: nowrap; font-size: inherit; ${widthStyle}">(${structDiffPart})</div>`;
                        }

                        bookmarkStatsHTML += numericalDiffHTML + structuralDiffHTML;
                    } else {
                        const isFirstBackup = record.isFirstBackup === true || (!record.time || syncHistory.length <= 1);
                        if (isFirstBackup && !(cachedRecord && syncHistory.length === 1 && record.time > cachedRecord.time)) { // 只有在未使用缓存作为差异基础时才显示"第一次备份"
                            // 修改样式，使用与正常记录一致的样式
                            bookmarkStatsHTML += `<div style="margin-top: 4px; text-align: center; font-size: inherit;"><span style="color: #4CAF50;">${dynamicTextStrings.firstBackupText[currentLang] || '第一次备份'}</span></div>`;
                        } else if (!hasAnyChange) { // 如果确实无任何变化（包括未使用缓存计算出变化的情况）
                            bookmarkStatsHTML += `<div style="margin-top: 4px; text-align: center;"><span style="color: #777777;">${dynamicTextStrings.noChangesText[currentLang] || '无变化'}</span></div>`;
                        }
                    }
                    // ... (结束 bookmarkStatsHTML 格式化逻辑)
                } else {
                    bookmarkStatsHTML = `<div style="text-align: center; color: #999;">${dynamicTextStrings.statsNotAvailableText[currentLang] || '统计不可用'}</div>`;
                }

                const formattedTime = `<span style="font-weight: bold; color: #007AFF; text-align: center;">${formatTime(time)}</span>`;

                // 备注部分：无备注时按类型给出默认备注（中英文）
                let noteHtml = '';
                const fallbackNote = (() => {
                    if (record.type === 'switch') return currentLang === 'en' ? 'Switch Backup' : '切换备份';
                    if (record.type === 'manual') return currentLang === 'en' ? 'Manual Backup' : '手动备份';
                    return currentLang === 'en' ? 'Auto Backup' : '自动备份';
                })();
                const displayNote = (record.note && record.note.trim()) ? record.note : fallbackNote;
                if (displayNote) {
                    noteHtml = `<div style="margin-top: 4px; text-align: center; font-size: 12px; color: var(--theme-text-primary); max-width: 100%; overflow-wrap: break-word; word-wrap: break-word; word-break: break-all;">${displayNote}</div>`;
                }
                
                // 添加备注按钮
                const addNoteButton = `
                    <div class="add-note-btn" data-record-time="${record.time}" style="margin-top: 4px; text-align: center; cursor: pointer;">
                        <span style="color: #777; font-size: 12px; padding: 2px 6px; border: 1px dashed #aaa; border-radius: 3px;">${currentLang === 'en' ? 'Edit' : '编辑'}</span>
                    </div>
                `;

                // 只保留两栏的样式
                let timeColStyle = "flex: 1; text-align: center;";
                let qtyColStyle = "flex: 1; text-align: center; padding-right: 20px;";

                const detailsBtn = `
                    <button class="details-btn" data-record-time="${record.time}" title="${currentLang === 'en' ? 'View Details' : '查看详情'}" style="position: absolute; right: 3.2px; top: 50%; transform: translateY(-50%); padding: 0; margin: 0; cursor: pointer; background: none; border: none; color: #999; transition: color 0.2s; width: auto; height: auto; display: flex; align-items: center; justify-content: center;">
                        <i class="fas fa-info-circle" style="font-size: 18px;"></i>
                    </button>
                `;

                historyItem.innerHTML = `
                    <div class="history-item-time" style="${timeColStyle}">
                        ${formattedTime}
                        ${noteHtml}
                        ${addNoteButton}
                    </div>
                    <div class="history-item-count" style="${qtyColStyle}; display: flex; align-items: center; justify-content: center; position: relative;">
                        <div style="flex: 1; text-align: center;">${bookmarkStatsHTML}</div>
                        ${detailsBtn}
                    </div>
                `;
                historyList.appendChild(historyItem);
            });

            // 如果缓存被用于列表显示，或者历史记录已不止一条（缓存的过渡作用已结束），则清除缓存
            if (cachedRecord && (cacheWasUsedForListDisplay || syncHistory.length > 1)) {
                chrome.storage.local.remove('cachedRecordAfterClear', () => {
});
            }

            // 为添加备注按钮绑定事件
            document.querySelectorAll('.add-note-btn').forEach(btn => {
                btn.addEventListener('click', function(e) {
                    const recordTime = this.getAttribute('data-record-time');
                    showAddNoteDialog(recordTime);
                });
            });

        } else {
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
                if (data.lastSyncDirection === 'both') {
                    locationText = '<span style="color: #007AFF; font-weight: bold;">云端</span>与<span style="color: #9370DB; font-weight: bold;">本地</span>';
                } else if (data.lastSyncDirection === 'webdav' || data.lastSyncDirection === 'upload') {
                    locationText = '<span style="color: #007AFF; font-weight: bold;">云端</span>';
                } else if (data.lastSyncDirection === 'local' || data.lastSyncDirection === 'download') {
                    locationText = '<span style="color: #9370DB; font-weight: bold;">本地</span>';
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
                                                <span style="padding-right: 2px;">${currentBookmarkCount}${i18nBookmarksLabel}</span>
                                                <span>,</span>
                                                <span style="padding-left: 2px;">${currentFolderCount}${i18nFoldersLabel}</span>
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
                                })
                            ]).then(([syncHistory, cachedRecordFromStorage]) => {
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
                                const hasStructuralChanges = bookmarkMoved || folderMoved || bookmarkModified || folderModified;

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
                                        (cachedStats.currentFolderCount !== undefined || cachedStats.currentFolders !== undefined))
                                    {
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

                                const hasNumericalChange = canCalculateDiff && (bookmarkDiff !== 0 || folderDiff !== 0);
                                
                                const i18nBookmarkChangedLabel = window.i18nLabels?.bookmarkChangedLabel || (currentLang === 'en' ? "BKM changed" : "书签变动");
                                const i18nFolderChangedLabel = window.i18nLabels?.folderChangedLabel || (currentLang === 'en' ? "FLD changed" : "文件夹变动");
                                const i18nBookmarkAndFolderChangedLabel = window.i18nLabels?.bookmarkAndFolderChangedLabel || (currentLang === 'en' ? "BKM & FLD changed" : "书签和文件夹变动");

                                let quantityChangesHTML = "";
                                let structuralChangesHTML = "";

                                // 数量变化部分（带红绿色）
                                if (hasNumericalChange) {
                                    let bPartHTML = "";
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
                                    let fPartHTML = "";
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
                                    if (currentLang === 'zh_CN' && bookmarkDiff !== 0 && folderDiff !== 0) {
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
                                        structuralParts.push(`<span style="color: #FF9800; font-weight: bold;">${currentLang === 'en' ? 'Moved' : '移动'}</span>`);
                                    }
                                    if (bookmarkModified || folderModified) {
                                        structuralParts.push(`<span style="color: #2196F3; font-weight: bold;">${currentLang === 'en' ? 'Modified' : '修改'}</span>`);
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
                    })
                ]).then(([backupResponse, syncHistory, cachedRecordFromStorage]) => {
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
                                            <span style="padding-right: 2px;">${currentBookmarkCount}${i18nBookmarksLabel}</span>
                                            <span>,</span>
                                            <span style="padding-left: 2px;">${currentFolderCount}${i18nFoldersLabel}</span>
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
                    const hasStructuralChanges = bookmarkMoved || folderMoved || bookmarkModified || folderModified;

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
                            else console.warn("历史记录中没有可用统计，且 backupResponse 未提供 diff。" );
                        }
                    } else if (cachedRecordFromStorage) {
                        const cachedStats = cachedRecordFromStorage.bookmarkStats;
                        if (cachedStats &&
                            (cachedStats.currentBookmarkCount !== undefined || cachedStats.currentBookmarks !== undefined) &&
                            (cachedStats.currentFolderCount !== undefined || cachedStats.currentFolders !== undefined))
                        {
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

                    const hasNumericalChange = canCalculateDiff && (bookmarkDiffManual !== 0 || folderDiffManual !== 0);
                    const i18nBookmarkChangedLabel = window.i18nLabels?.bookmarkChangedLabel || (currentLang === 'en' ? "BKM changed" : "书签变动");
                    const i18nFolderChangedLabel = window.i18nLabels?.folderChangedLabel || (currentLang === 'en' ? "FLD changed" : "文件夹变动");
                    const i18nBookmarkAndFolderChangedLabel = window.i18nLabels?.bookmarkAndFolderChangedLabel || (currentLang === 'en' ? "BKM & FLD changed" : "书签和文件夹变动");

                    let quantityChangesHTML = "";
                    let structuralChangesHTML = "";

                    if (hasNumericalChange) {
                        let bPartHTML = "";
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
                        let fPartHTML = "";
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
                        if (currentLang === 'zh_CN' && bookmarkDiffManual !== 0 && folderDiffManual !== 0) {
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
                            structuralParts.push(`<span style="color: #FF9800; font-weight: bold;">${currentLang === 'en' ? 'Moved' : '移动'}</span>`);
                        }
                        if (bookmarkModified || folderModified) {
                            structuralParts.push(`<span style="color: #2196F3; font-weight: bold;">${currentLang === 'en' ? 'Modified' : '修改'}</span>`);
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
    chrome.storage.local.get(['preferredLang'], function(result) {
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
        saveBtn.addEventListener('click', function() {
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
            chrome.storage.local.set({ customDownloadPath: formattedPath }, function() {
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
        openSettingsBtn.addEventListener('click', function() {
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
        cancelBtn.addEventListener('click', function() {
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
            uploadToCloudManual.classList.add('breathe-animation');
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
                    setTimeout(() => { try { updateBookmarkCountDisplay(); } catch (e) {} }, 120);
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
                        setTimeout(() => { try { updateBookmarkCountDisplay(); } catch (e) {} }, 120);
                        // 切换备份成功后再正式切到自动模式，避免并发触发自动备份
                        chrome.runtime.sendMessage({ action: 'toggleAutoSync', enabled: true }, () => {
                            setTimeout(() => { try { updateBookmarkCountDisplay(); } catch (e) {} }, 120);
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
                    setTimeout(() => { try { updateBookmarkCountDisplay(); } catch (e) {} }, 120);
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
                    uploadToCloudManual.classList.add('breathe-animation');
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
                    uploadToCloudManual.classList.add('breathe-animation');
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
 */
function handleInitUpload() {
    showStatus('开始初始化上传...', 'info');

    // 获取上传按钮并禁用
    const uploadToCloud = document.getElementById('uploadToCloud');
    if (uploadToCloud) uploadToCloud.disabled = true;

    // 发送初始化请求
    chrome.runtime.sendMessage({
        action: "initSync", // <-- 修改 action
        direction: "upload"
    }, (response) => {
        // 恢复按钮状态
        if (uploadToCloud) uploadToCloud.disabled = false;

        if (response && response.success) {
            // 显示详细的成功信息
            let successMessage = '初始化上传成功！';
            if (response.webDAVSuccess && response.localSuccess) {
                successMessage = '成功初始化到云端和本地！';
            } else if (response.webDAVSuccess) {
                successMessage = '成功初始化到云端！';
            } else if (response.localSuccess) {
                successMessage = '成功初始化到本地！';
            }
            showStatus(successMessage, 'success');

            // 保存初始备份文件名（如果有）
            if (response.localFileName) {
                const initialBackupRecord = {
                    fileName: response.localFileName,
                    time: new Date().toISOString(),
                    backupType: response.localSuccess ? '本地' : (response.webDAVSuccess ? '云端' : '未知')
                };
                chrome.storage.local.set({ initialBackupRecord: initialBackupRecord });
}

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

            // 更新备份历史记录 - 确保应用当前语言
            chrome.storage.local.get(['preferredLang'], function(result) {
                const currentLang = result.preferredLang || 'zh_CN';
updateSyncHistory();
            });

            // 显示手动备份选项，但根据自动备份状态决定
            const manualSyncOptions = document.getElementById('manualSyncOptions');
            if (manualSyncOptions) {
                chrome.storage.local.get(['autoSync'], function(autoSyncData) {
                    const autoSyncEnabled = autoSyncData.autoSync !== false;
                    manualSyncOptions.style.display = autoSyncEnabled ? 'none' : 'block';
                });
            }

            // 优化定位1：点击“初始化：上传书签到云端/本地”后，平滑下滑至「定位A」
            setTimeout(() => {
                scrollToPositionA('smooth');
            }, 50);

            // 设置初始化标记
            chrome.storage.local.set({ initialized: true });

            // 主动请求更新角标，确保角标显示语言与当前设置一致
            chrome.runtime.sendMessage({
                action: "setBadge"
            }, (badgeResponse) => {
                if (chrome.runtime.lastError) {
} else if (badgeResponse && badgeResponse.success) {
}
            });
        } else {
            const errorMessage = response?.error || '未知错误';
            showStatus('初始化上传失败: ' + errorMessage, 'error');
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
            let successMessage = '手动上传成功！';
            if (response.webDAVSuccess && response.localSuccess) {
                successMessage = '成功备份到云端和本地！';
            } else if (response.webDAVSuccess) {
                successMessage = '成功备份到云端！';
            } else if (response.localSuccess) {
                successMessage = '成功备份到本地！';
            }
            showStatus(successMessage, 'success');
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
            chrome.storage.local.get(['preferredLang'], function(result) {
                const currentLang = result.preferredLang || 'zh_CN';
updateSyncHistory();
            });

            const manualSyncOptions = document.getElementById('manualSyncOptions');
            if (manualSyncOptions) {
                chrome.storage.local.get(['autoSync'], function(autoSyncData) {
                    const autoSyncEnabled = autoSyncData.autoSync !== false;
                    manualSyncOptions.style.display = autoSyncEnabled ? 'none' : 'block';
                });
            }
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
            }, 50);
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
        // WebDAV配置
        'serverAddress', 'username', 'password', 'webDAVEnabled',
        // 本地配置
        'defaultDownloadEnabled', 'customFolderEnabled', 'customFolderPath',
        'localBackupPath', 'localBackupEnabled'
    ], async (data) => {
        const syncHistory = data.syncHistory || [];
        const lang = data.preferredLang || 'zh_CN';

        // 检查WebDAV配置
        const webDAVConfigured = data.serverAddress && data.username && data.password;
        const webDAVEnabled = data.webDAVEnabled !== false;

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
            bookmarkCount: { 'zh_CN': "书签数", 'en': "Bookmarks" },
            folderCount: { 'zh_CN': "文件夹数", 'en': "Folders" },
            bookmarkChange: { 'zh_CN': "书签变化", 'en': "Bookmark Change" },
            folderChange: { 'zh_CN': "文件夹变化", 'en': "Folder Change" },
            structureChange: { 'zh_CN': "结构变动", 'en': "Structural Changes" },
            location: { 'zh_CN': "位置", 'en': "Location" },
            type: { 'zh_CN': "类型", 'en': "Type" },
            status: { 'zh_CN': "状态/错误", 'en': "Status/Error" }
        };

        // Value mappings for the table
        const structureChangeValues = {
            yes: { 'zh_CN': "是", 'en': "Yes" },
            no: { 'zh_CN': "否", 'en': "No" }
        };
        const locationValues = {
            cloud: { 'zh_CN': "云端", 'en': "Cloud" },
            webdav: { 'zh_CN': "云端", 'en': "Cloud" },
            local: { 'zh_CN': "本地", 'en': "Local" },
            both: { 'zh_CN': "云端与本地", 'en': "Cloud & Local" },
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
        txtContent += `| ${tableHeaders.timestamp[lang]} | ${tableHeaders.notes[lang]} | ${tableHeaders.bookmarkCount[lang]} | ${tableHeaders.folderCount[lang]} | ${tableHeaders.bookmarkChange[lang]} | ${tableHeaders.folderChange[lang]} | ${tableHeaders.structureChange[lang]} | ${tableHeaders.location[lang]} | ${tableHeaders.type[lang]} | ${tableHeaders.status[lang]} |\n`;
        txtContent += "|---|---|---|---|---|---|---|---|---|---|\n";

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

            const currentBookmarks = record.bookmarkStats?.currentBookmarks ?? record.bookmarkStats?.currentBookmarkCount ?? 'N/A';
            const currentFolders = record.bookmarkStats?.currentFolders ?? record.bookmarkStats?.currentFolderCount ?? 'N/A';

            let bookmarkDiff = '0';
            let folderDiff = '0';

            if (record.bookmarkStats) {
                if (record.bookmarkStats.bookmarkDiff !== undefined) {
                    bookmarkDiff = record.bookmarkStats.bookmarkDiff;
                } else if (record.bookmarkStats.added !== undefined && record.bookmarkStats.removed !== undefined) {
                    bookmarkDiff = record.bookmarkStats.added - record.bookmarkStats.removed;
                }

                if (record.bookmarkStats.folderDiff !== undefined) {
                    folderDiff = record.bookmarkStats.folderDiff;
                } else if (record.bookmarkStats.foldersAdded !== undefined && record.bookmarkStats.foldersRemoved !== undefined) {
                    folderDiff = record.bookmarkStats.foldersAdded - record.bookmarkStats.foldersRemoved;
                }
            }

            const formatDiff = (diff) => {
                if (diff === 'N/A' || diff === undefined) return '0';
                const val = Number(diff);
                return val > 0 ? `+${val}` : `${val}`;
            };

            const bookmarkDiffFormatted = formatDiff(bookmarkDiff);
            const folderDiffFormatted = formatDiff(folderDiff);

            const structuralChanges = (record.bookmarkStats?.bookmarkMoved || record.bookmarkStats?.folderMoved || record.bookmarkStats?.bookmarkModified || record.bookmarkStats?.folderModified) ? structureChangeValues.yes[lang] : structureChangeValues.no[lang];

            let locationText = 'N/A';
            if (record.direction === 'upload' || record.direction === 'webdav') {
                locationText = locationValues.cloud[lang];
            } else if (record.direction === 'download' || record.direction === 'local') {
                locationText = locationValues.local[lang];
            } else if (record.direction === 'both') {
                locationText = locationValues.both[lang];
            } else if (record.direction === 'none') {
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

            txtContent += `| ${time} | ${record.note || ''} | ${currentBookmarks} | ${currentFolders} | ${bookmarkDiffFormatted} | ${folderDiffFormatted} | ${structuralChanges} | ${locationText} | ${typeText} | ${statusText} |\n`;
        });
        
        // 添加最后一个日期的分界线
        if (previousDateStr) {
            const formattedPreviousDate = lang === 'en' ? 
                `${previousDateStr.split('-')[0]}-${previousDateStr.split('-')[1].padStart(2, '0')}-${previousDateStr.split('-')[2].padStart(2, '0')}` :
                `${previousDateStr.split('-')[0]}年${previousDateStr.split('-')[1]}月${previousDateStr.split('-')[2]}日`;
            
            // 添加简洁的分界线，并入表格中
            txtContent += `| ${formattedPreviousDate} |  |  |  |  |  |  |  |  |  |\n`;
        }

        // 根据配置决定导出方式
        let exportResults = [];
        let webDAVSuccess = false;
        let localSuccess = false;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `${filenameBase[lang]}_${timestamp}.txt`;

        // WebDAV导出
        if (webDAVConfigured && webDAVEnabled) {
            try {
                showStatus(window.i18nLabels?.exportingToWebDAV || '正在导出到云端...', 'info');

                // 使用background.js中已有的WebDAV导出功能
                const result = await callBackgroundFunction('exportHistoryToWebDAV', {
                    content: txtContent,
                    fileName: fileName,
                    lang: lang
                });

                if (result && result.success) {
                    webDAVSuccess = true;
                    exportResults.push(window.i18nLabels?.exportedToWebDAV || '历史记录已成功导出到云端');
                } else {
                    exportResults.push(window.i18nLabels?.exportToWebDAVFailed || '导出到云端失败: ' + (result?.error || '未知错误'));
                }
            } catch (error) {
exportResults.push(window.i18nLabels?.exportToWebDAVFailed || `导出到云端失败: ${error.message || '未知错误'}`);
            }
        }

        // 本地导出
        if (localBackupConfigured || (!webDAVConfigured && !webDAVEnabled)) {
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
        if (webDAVSuccess && localSuccess) {
            showStatus(window.i18nLabels?.exportedToBoth || '历史记录已成功导出到云端与本地', 'success', 3000);
        } else if (webDAVSuccess || localSuccess) {
            showStatus(exportResults.join('，'), 'success', 3000);
        } else {
            showStatus(exportResults.join('，'), 'error', 3000);
        }
    });
}

/**
 * 清空备份历史记录。
 */
function clearSyncHistory() {
// 1. 获取当前历史记录以缓存最后一条记录
    chrome.runtime.sendMessage({ action: "getSyncHistory" }, (historyResponse) => {
        if (historyResponse && historyResponse.success && historyResponse.syncHistory && historyResponse.syncHistory.length > 0) {
            const latestRecord = historyResponse.syncHistory[historyResponse.syncHistory.length - 1];
            chrome.storage.local.set({ cachedRecordAfterClear: latestRecord }, () => {
// 2. 继续清除实际的历史记录
                proceedToClearActualHistory();
            });
        } else {
            // 没有历史记录可缓存，或者获取失败，则确保清除任何可能存在的旧缓存
chrome.storage.local.remove('cachedRecordAfterClear', () => {
                proceedToClearActualHistory();
            });
        }
    });

    function proceedToClearActualHistory() {
        chrome.runtime.sendMessage({ action: "clearSyncHistory" }, (clearResponse) => {
            if (clearResponse && clearResponse.success) {
                // updateSyncHistory 会被调用，它会进而调用 updateBookmarkCountDisplay
                // updateBookmarkCountDisplay 将有机会使用上面设置的 cachedRecordAfterClear
                updateSyncHistory();
                showStatus('历史记录已清空', 'success');
            } else {
                showStatus('清空历史记录失败', 'error');
}
        });
    }
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
        firstReminderMinutes: 30,
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
        'zh_CN': "正在导出到云端...",
        'en': "Exporting to cloud..."
    };

    const exportingToLocalStrings = {
        'zh_CN': "正在导出到本地...",
        'en': "Exporting to local..."
    };

    const exportedToWebDAVStrings = {
        'zh_CN': "历史记录已成功导出到云端",
        'en': "History successfully exported to cloud"
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
        'zh_CN': "导出到云端失败",
        'en': "Failed to export to cloud"
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
        'zh_CN': "备份检查记录",
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

    // WebDAV配置部分
    const webdavConfigTitleStrings = {
        'zh_CN': "WebDAV配置（坚果云、NAS服务等）",
        'en': "WebDAV Config (Nutstore, NAS, etc.)"
    };

    const serverAddressLabelStrings = {
        'zh_CN': "服务器地址:",
        'en': "Server Address:"
    };

    const serverAddressPlaceholderStrings = {
        'zh_CN': "WebDAV服务器地址",
        'en': "WebDAV Server Address"
    };

    const usernameLabelStrings = {
        'zh_CN': "账户:",
        'en': "Username:"
    };

    const usernamePlaceholderStrings = {
        'zh_CN': "WebDAV账户",
        'en': "WebDAV Username"
    };

    const passwordLabelStrings = {
        'zh_CN': "密码:",
        'en': "Password:"
    };

    const passwordPlaceholderStrings = {
        'zh_CN': "WebDAV应用密码",
        'en': "WebDAV App Password"
    };

    const saveConfigButtonStrings = {
        'zh_CN': "保存配置",
        'en': "Save Config"
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
        'zh_CN': "防干扰：只在本地备份时隐藏下载栏",
        'en': "Non-interference: Hide Download Bar Only During Backup"
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
        'zh_CN': "初始化与重置按钮",
        'en': "Initialize & Reset Buttons"
    };

    const resetButtonStrings = {
        'zh_CN': "恢复到初始状态",
        'en': "Restore to Default"
    };

    const initUploadButtonStrings = {
        'zh_CN': "初始化：上传书签到云端/本地",
        'en': "Initialize: Upload to Cloud/Local"
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
        'zh_CN': "确定要清空所有备份历史记录吗？",
        'en': "Are you sure you want to clear all backup history records?"
    };

    const clearHistoryWarningStrings = {
        'zh_CN': "此操作不可撤销，清空后无法恢复这些记录。",
        'en': "This action cannot be undone.<br>Records will be permanently deleted."
    };

    const clearHistoryInfoStrings = {
        'zh_CN': "备份记录保留至100条记录，<br>超出后将静默清空并自动导出txt文件。",
        'en': "Backup records are kept up to 100 entries,<br>excess records will be automatically cleared and exported to txt file."
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
        chrome.storage.local.get(['initialBackupRecord', 'preferredLang'], function(data) {
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
        resetAllButton.textContent = resetButtonText;
    }

    const uploadToCloudButton = document.getElementById('uploadToCloud');
    if (uploadToCloudButton) {
        uploadToCloudButton.textContent = initUploadButtonText;
    }

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
        exportingToLocal: exportingToLocalStrings[lang] || exportingToLocalStrings['zh_CN'],
        exportedToWebDAV: exportedToWebDAVStrings[lang] || exportedToWebDAVStrings['zh_CN'],
        exportedToLocal: exportedToLocalStrings[lang] || exportedToLocalStrings['zh_CN'],
        exportedToBoth: exportedToBothStrings[lang] || exportedToBothStrings['zh_CN'],
        exportToWebDAVFailed: exportToWebDAVFailedStrings[lang] || exportToWebDAVFailedStrings['zh_CN'],
        exportToLocalFailed: exportToLocalFailedStrings[lang] || exportToLocalFailedStrings['zh_CN'],
        historyExportedSuccess: exportedToBothStrings[lang] || exportedToBothStrings['zh_CN']
    };

    // 更新弹窗提示的国际化文本
    if(typeof webdavConfigMissingStrings !== 'undefined') {
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
// DOMContentLoaded 事件监听器 (Main Entry Point)
// =============================================================================

document.addEventListener('DOMContentLoaded', function() {
// 添加全局未处理 Promise 错误监听器，捕获并忽略特定的连接错误
    window.addEventListener('unhandledrejection', function(event) {
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
    initializeLocalConfigSection();
    initializeWebDAVToggle();
    initializeOpenSourceInfo(); // 初始化开源信息功能

    // 在确定按钮存在后调用初始化函数
    // 确保在DOM完全加载后执行
    if (document.readyState === 'loading') { // 还在加载
        document.addEventListener('DOMContentLoaded', initScrollToTopButton);
    } else { // 'interactive' 或 'complete'
        initScrollToTopButton(); // 直接调用
    }

    // 加载自动备份状态并设置界面
    chrome.storage.local.get(['autoSync', 'initialized'], function(result) { // 使用 chrome.storage
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
                uploadToCloudManual.classList.add('breathe-animation');
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
                chrome.storage.local.get(['initialBackupRecord', 'preferredLang'], function(data) {
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
        initHeader.addEventListener('click', function() {
            // 切换内容区域显示状态
            toggleConfigPanel(initContent, initHeader);
        });
        initHeader.setAttribute('data-listener-attached', 'true');
    }

    // ... (其他初始化代码，包括加载状态和绑定其他事件)

    // ... (例如，在加载initialized状态后也调用，确保按钮可用时监听器附加)
    chrome.storage.local.get(['initialized'], function(result) { // 使用 chrome.storage
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

    if (exportHistoryBtn) {
        // 添加导出功能
        exportHistoryBtn.addEventListener('click', exportSyncHistory);

        // 添加悬停提示
        exportHistoryBtn.addEventListener('mouseenter', function() {
            const tooltip = this.querySelector('.tooltip');
            if (tooltip) {
                tooltip.style.visibility = 'visible';
                tooltip.style.opacity = '1';
            }
        });

        exportHistoryBtn.addEventListener('mouseleave', function() {
            const tooltip = this.querySelector('.tooltip');
            if (tooltip) {
                tooltip.style.visibility = 'hidden';
                tooltip.style.opacity = '0';
            }
        });
    }

    if (clearHistoryBtn) {
        // 修改清空功能，先显示确认对话框
        clearHistoryBtn.addEventListener('click', function() {
            // 显示确认对话框
            const clearHistoryConfirmDialog = document.getElementById('clearHistoryConfirmDialog');
            if (clearHistoryConfirmDialog) {
                clearHistoryConfirmDialog.style.display = 'block';
            }
        });

        // 添加悬停提示
        clearHistoryBtn.addEventListener('mouseenter', function() {
            const tooltip = this.querySelector('.tooltip');
            if (tooltip) {
                tooltip.style.visibility = 'visible';
                tooltip.style.opacity = '1';
            }
        });

        clearHistoryBtn.addEventListener('mouseleave', function() {
            const tooltip = this.querySelector('.tooltip');
            if (tooltip) {
                tooltip.style.visibility = 'hidden';
                tooltip.style.opacity = '0';
            }
        });
    }

    // 添加「历史查看器」按钮事件监听
    const openHistoryViewerBtn = document.getElementById('openHistoryViewerBtn');
    if (openHistoryViewerBtn) {
        // 设置 tooltip 文本（根据语言）
        chrome.storage.local.get(['preferredLang'], function(result) {
            const currentLang = result.preferredLang || 'zh_CN';
            const tooltip = document.getElementById('historyViewerTooltip');
            if (tooltip) {
                tooltip.textContent = currentLang === 'zh_CN' ? '打开历史查看器' : 'Open History Viewer';
            }
        });

        openHistoryViewerBtn.addEventListener('click', function() {
            // 打开历史查看器页面
            chrome.tabs.create({ url: chrome.runtime.getURL('history_html/history.html') });
        });

        // 添加悬停提示
        openHistoryViewerBtn.addEventListener('mouseenter', function() {
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

        openHistoryViewerBtn.addEventListener('mouseleave', function() {
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
        statusCard.addEventListener('click', function() {
            // 打开历史查看器的当前变化视图
            const url = chrome.runtime.getURL('history_html/history.html?view=current-changes');
            chrome.tabs.create({ url: url });
        });

        // 添加 hover 效果
        statusCard.addEventListener('mouseenter', function() {
            this.style.transform = 'scale(1.02)';
            this.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
        });

        statusCard.addEventListener('mouseleave', function() {
            this.style.transform = 'scale(1)';
            this.style.boxShadow = '';
        });
    }

    // 添加清空历史记录确认对话框的按钮事件监听
    const confirmClearHistory = document.getElementById('confirmClearHistory');
    const cancelClearHistory = document.getElementById('cancelClearHistory');
    const clearHistoryConfirmDialog = document.getElementById('clearHistoryConfirmDialog');

    if (confirmClearHistory && clearHistoryConfirmDialog) {
        confirmClearHistory.addEventListener('click', function() {
            // 隐藏对话框
            clearHistoryConfirmDialog.style.display = 'none';
            // 执行清空操作
            clearSyncHistory();
        });
    }

    if (cancelClearHistory && clearHistoryConfirmDialog) {
        cancelClearHistory.addEventListener('click', function() {
            // 隐藏对话框
            clearHistoryConfirmDialog.style.display = 'none';
        });
    }

    // 初始化备份模式切换：上半区=自动，下半区=手动；不再整块点击切换
    const backupModeSwitch = document.getElementById('backupModeSwitch');
    const autoOptionEl = document.querySelector('.backup-mode-option.auto-option');
    const manualOptionEl = document.querySelector('.backup-mode-option.manual-option');

    const shouldIgnoreClick = (evt) => {
        // 点击操作按钮区域不切换模式
        const target = evt.target;
        return !!(target.closest && target.closest('.option-actions'));
    };

    if (autoOptionEl && !autoOptionEl.hasAttribute('data-mode-listener')) {
        autoOptionEl.addEventListener('click', function(evt) {
            if (shouldIgnoreClick(evt)) return;
            const autoSyncToggle2 = document.getElementById('autoSyncToggle2');
            if (autoSyncToggle2 && !autoSyncToggle2.checked) {
                autoSyncToggle2.checked = true;
                autoSyncToggle2.dispatchEvent(new Event('change'));
            }
        });
        autoOptionEl.setAttribute('data-mode-listener', 'true');
    }

    if (manualOptionEl && !manualOptionEl.hasAttribute('data-mode-listener')) {
        manualOptionEl.addEventListener('click', function(evt) {
            if (shouldIgnoreClick(evt)) return;
            const autoSyncToggle2 = document.getElementById('autoSyncToggle2');
            if (autoSyncToggle2 && autoSyncToggle2.checked) {
                autoSyncToggle2.checked = false;
                autoSyncToggle2.dispatchEvent(new Event('change'));
            }
        });
        manualOptionEl.setAttribute('data-mode-listener', 'true');
    }

    // 初始化备份状态
    chrome.storage.local.get(['autoSync'], function(result) {
        const autoSyncEnabled = result.autoSync !== undefined ? result.autoSync : true;

        // 更新开关UI状态
        if (backupModeSwitch) {
            if (autoSyncEnabled) {
                backupModeSwitch.classList.add('auto');
                backupModeSwitch.classList.remove('manual');
            } else {
                backupModeSwitch.classList.add('manual');
                backupModeSwitch.classList.remove('auto');
            }
        }

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
    });

    // 监听来自后台的书签变化消息和获取变化描述请求
    chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
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
        reminderToggle.addEventListener('click', function() {
            const currentState = getToggleState(this);
            updateToggleState(this, !currentState);
        });
    }

    if (fixedTimeToggle1) {
        fixedTimeToggle1.addEventListener('click', function() {
            const currentState = getToggleState(this);
            updateToggleState(this, !currentState);
        });
    }

    if (fixedTimeToggle2) {
        fixedTimeToggle2.addEventListener('click', function() {
            const currentState = getToggleState(this);
            updateToggleState(this, !currentState);
        });
    }

    // 绑定设置面板打开按钮点击事件
    if (reminderSettingsBtn) {
        reminderSettingsBtn.addEventListener('click', async function() {
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
        closeReminderSettings.addEventListener('click', async function() {
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
        saveReminderSettings.addEventListener('click', async function() {
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
        reminderSettingsDialog.addEventListener('click', function(event) {
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
        autoBackupSettingsBtnEl.addEventListener('click', async function() {
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
                        container.innerHTML = `<div style="color: red; padding: 20px;">初始化失败: ${error.message}<br><pre>${error.stack}</pre></div>`;
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
        closeAutoBackupSettingsBtn.addEventListener('click', function() {
            autoBackupSettingsDialog.style.display = 'none';
            
            // 恢复"Back to Top"按钮
            restoreScrollToTopButtons();
        });
    }

    if (autoBackupSettingsDialog) {
        autoBackupSettingsDialog.addEventListener('click', function(event) {
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
        realtimeBackupToggle.addEventListener('click', async function() {
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
        restoreAutoBackupDefaultsBtn.addEventListener('click', async function() {
            // 默认：开启实时备份；其它（循环、定时）暂不实现保存逻辑
            updateToggleState(realtimeBackupToggle, true);
            try {
                await new Promise(resolve => chrome.storage.local.set({ realtimeBackupEnabled: true }, resolve));
            } catch (e) {}
            showAutoBackupSettingsSavedIndicator();
        });
    }

    if (saveAutoBackupSettingsBtn && autoBackupSettingsDialog) {
        saveAutoBackupSettingsBtn.addEventListener('click', function() {
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
// Bookmark Toolbox：画布缩略图 + 最近添加
// =============================================================================

function initializeBookmarkToolbox() {
    const canvasContainer = document.getElementById('bookmarkCanvas');
    const canvasThumbnailContainer = document.getElementById('canvasThumbnail');
    const recentListContainer = document.getElementById('recentBookmarks');

    if (!canvasContainer || !canvasThumbnailContainer || !recentListContainer) {
        return;
    }

    // 点击画布缩略图，直接打开 Bookmark Canvas 视图
    canvasContainer.addEventListener('click', () => {
        try {
            const url = chrome.runtime.getURL('history_html/history.html?view=canvas');
            chrome.tabs.create({ url });
        } catch (e) {
            console.warn('[Bookmark Toolbox] 打开 Canvas 视图失败:', e);
        }
    });

    // 直接同步读取最新缩略图，保证主 UI 打开时立即显示
    chrome.storage.local.get(['bookmarkCanvasThumbnail'], (data) => {
        try {
            const thumbnail = data.bookmarkCanvasThumbnail;
            if (!thumbnail || typeof thumbnail !== 'string') {
                // 没有缩略图时，显示占位样式
                canvasThumbnailContainer.innerHTML = '';
                canvasThumbnailContainer.style.background =
                    'repeating-linear-gradient(45deg, #f6f8fa, #f6f8fa 10px, #eaeef2 10px, #eaeef2 20px)';
                return;
            }

            canvasThumbnailContainer.innerHTML = '';
            canvasThumbnailContainer.style.background = 'none';
            const img = document.createElement('img');
            img.src = thumbnail;
            img.alt = 'Bookmark Canvas Thumbnail';
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            img.style.borderRadius = '4px';
            canvasThumbnailContainer.appendChild(img);
        } catch (e) {
            console.warn('[Bookmark Toolbox] 显示 Canvas 缩略图失败:', e);
        }
    });

    // 加载最近添加的书签（数据来源与历史页面的“书签添加记录”一致）
    loadRecentBookmarkAdditions(recentListContainer);
}

function flattenBookmarkTreeForRecent(node, parentPath = '') {
    const bookmarks = [];
    const currentPath = parentPath ? `${parentPath}/${node.title}` : node.title;

    if (node.url) {
        bookmarks.push({
            id: node.id,
            title: node.title,
            url: node.url,
            dateAdded: node.dateAdded,
            path: currentPath,
            parentId: node.parentId
        });
    }

    if (node.children) {
        node.children.forEach(child => {
            bookmarks.push(...flattenBookmarkTreeForRecent(child, currentPath));
        });
    }

    return bookmarks;
}

function isBookmarkBackedUpForRecent(bookmark, lastBackupTime) {
    if (!lastBackupTime) return false;
    if (typeof bookmark.dateAdded !== 'number') return false;
    return bookmark.dateAdded <= lastBackupTime;
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

function renderRecentBookmarkItems(container, bookmarks, currentLang) {
    container.innerHTML = '';

    if (!bookmarks || bookmarks.length === 0) {
        const empty = document.createElement('div');
        empty.style.textAlign = 'center';
        empty.style.padding = '10px';
        empty.style.color = 'var(--theme-text-secondary)';
        empty.style.fontSize = '11px';

        const icon = document.createElement('i');
        icon.className = 'fas fa-bookmark';
        icon.style.fontSize = '18px';
        icon.style.opacity = '0.3';
        icon.style.marginBottom = '4px';
        icon.style.display = 'block';

        const text = document.createElement('div');
        text.textContent = currentLang === 'en' ? 'No new bookmarks' : '暂无新增书签';

        empty.appendChild(icon);
        empty.appendChild(text);
        container.appendChild(empty);
        return;
    }

    bookmarks.forEach(bookmark => {
        const item = document.createElement('div');
        item.className = 'bookmark-item';

        const iconImg = document.createElement('img');
        iconImg.alt = '';
        loadFaviconForRecent(iconImg, bookmark.url);

        const titleDiv = document.createElement('div');
        titleDiv.className = 'bookmark-item-title';
        titleDiv.textContent = bookmark.title || bookmark.url || (currentLang === 'en' ? '(No title)' : '（无标题）');

        item.appendChild(iconImg);
        item.appendChild(titleDiv);

        item.addEventListener('click', () => {
            try {
                if (bookmark.url) {
                    chrome.tabs.create({ url: bookmark.url });
                }
            } catch (e) {
                console.warn('[Bookmark Toolbox] 打开书签失败:', e);
            }
        });

        container.appendChild(item);
    });
}

function loadRecentBookmarkAdditions(container) {
    chrome.storage.local.get(['lastSyncTime', 'preferredLang'], (storageData) => {
        const currentLang = storageData.preferredLang || 'zh_CN';
        let lastBackupTime = null;
        if (storageData.lastSyncTime) {
            try {
                lastBackupTime = new Date(storageData.lastSyncTime).getTime();
            } catch (_) {
                lastBackupTime = null;
            }
        }

        try {
            chrome.bookmarks.getTree((tree) => {
                try {
                    if (!tree || !tree.length) {
                        renderRecentBookmarkItems(container, [], currentLang);
                        return;
                    }

                    const root = tree[0];
                    const allBookmarks = flattenBookmarkTreeForRecent(root);

                    let candidates = allBookmarks.filter(b => b.url);

                    // 与“书签添加记录”视图保持一致：优先展示未备份的新增书签
                    const additions = candidates.filter(b => !isBookmarkBackedUpForRecent(b, lastBackupTime));
                    if (additions.length > 0) {
                        candidates = additions;
                    }

                    candidates.sort((a, b) => {
                        const aTime = typeof a.dateAdded === 'number' ? a.dateAdded : 0;
                        const bTime = typeof b.dateAdded === 'number' ? b.dateAdded : 0;
                        return bTime - aTime;
                    });

                    const recent = candidates.slice(0, 3);
                    renderRecentBookmarkItems(container, recent, currentLang);
                } catch (e) {
                    console.warn('[Bookmark Toolbox] 处理书签数据失败:', e);
                    renderRecentBookmarkItems(container, [], currentLang);
                }
            });
        } catch (e) {
            console.warn('[Bookmark Toolbox] 获取书签树失败:', e);
            renderRecentBookmarkItems(container, [], currentLang);
        }
    });
}
