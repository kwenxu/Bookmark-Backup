// 主题管理模块
(function() {
    // 主题类型枚举
    const ThemeType = {
        LIGHT: 'light',
        DARK: 'dark',
        SYSTEM: 'system'
    };

    // 获取系统主题偏好
    function getSystemThemePreference() {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 
            ThemeType.DARK : ThemeType.LIGHT;
    }

    // 获取当前语言 (异步)
    async function getCurrentLanguage() {
        try {
            const result = await new Promise(resolve => chrome.storage.local.get(['preferredLang'], resolve));
            if (result.preferredLang) {
                return result.preferredLang;
            }
            // 后备：尝试从 localStorage 获取（如果 chrome.storage 未设置）
            const localLang = localStorage.getItem('preferredLang');
            if (localLang) return localLang;
        } catch (e) {
            console.warn('从 chrome.storage.local 或 localStorage 获取语言设置失败:', e);
        }
        return 'zh_CN'; // 默认语言
    }
    
    // 获取当前主题状态的文本说明 (异步)
    async function getThemeStatusText(themeType) {
        const lang = await getCurrentLanguage();
        const themeTexts = {
            [ThemeType.LIGHT]: { 'zh_CN': '浅色模式', 'en': 'Light Mode' },
            [ThemeType.DARK]: { 'zh_CN': '深色模式', 'en': 'Dark Mode' },
            [ThemeType.SYSTEM]: { 'zh_CN': '跟随系统', 'en': 'System Mode' }
        };

        const textsForCurrentTheme = themeTexts[themeType] || themeTexts[ThemeType.SYSTEM];
        return textsForCurrentTheme[lang] || textsForCurrentTheme['zh_CN']; // 回退到中文
    }
    
    // 保存主题设置到本地存储
    function saveThemePreference(themeType) {
        try {
            localStorage.setItem('themePreference', themeType);
            console.log('主题偏好已保存:', themeType);
        } catch (e) {
            console.error('无法保存主题偏好:', e);
        }
    }

    // 从本地存储加载主题设置
    function loadThemePreference() {
        try {
            const savedTheme = localStorage.getItem('themePreference');
            return savedTheme || ThemeType.SYSTEM;
        } catch (e) {
            console.error('无法加载主题偏好:', e);
            return ThemeType.SYSTEM;
        }
    }

    // 更新主题图标显示
    function updateThemeIcons(themeType) {
        const darkModeIcon = document.getElementById('darkModeIcon');
        const lightModeIcon = document.getElementById('lightModeIcon');
        const systemModeIcon = document.getElementById('systemModeIcon');
        
        if (darkModeIcon && lightModeIcon && systemModeIcon) {
            darkModeIcon.style.display = 'none';
            lightModeIcon.style.display = 'none';
            systemModeIcon.style.display = 'none';
            
            switch (themeType) {
                case ThemeType.DARK:
                    darkModeIcon.style.display = 'inline-block';
                    break;
                case ThemeType.LIGHT:
                    lightModeIcon.style.display = 'inline-block';
                    break;
                case ThemeType.SYSTEM:
                    systemModeIcon.style.display = 'inline-block';
                    break;
            }
        }
    }

    // 应用主题到文档
    function applyTheme(themeType) {
        console.log('应用主题:', themeType);
        
        // 如果是系统主题，则检测系统当前偏好
        const actualTheme = themeType === ThemeType.SYSTEM ? 
            getSystemThemePreference() : themeType;
        
        console.log('实际应用主题:', actualTheme);
        
        // 直接设置 data-theme 属性
        if (actualTheme === ThemeType.DARK) {
            document.documentElement.setAttribute('data-theme', 'dark');
        } else {
            document.documentElement.removeAttribute('data-theme');
        }
        
        // 更新图标显示
        updateThemeIcons(themeType);
    }

    // 监听系统主题变化
    function watchSystemThemeChanges() {
        if (window.matchMedia) {
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            const handleChange = function(e) {
                console.log('系统主题变化:', e.matches ? 'dark' : 'light');
                // 只有在跟随系统模式下才自动切换
                if (loadThemePreference() === ThemeType.SYSTEM) {
                    applyTheme(ThemeType.SYSTEM);
                }
            };
            
            // 现代浏览器使用 addEventListener
            if (mediaQuery.addEventListener) {
                mediaQuery.addEventListener('change', handleChange);
            }
            // 旧版浏览器使用 addListener
            else if (mediaQuery.addListener) {
                mediaQuery.addListener(handleChange);
            }
        }
    }

    // 初始化主题切换功能
    function initializeThemeSwitcher() {
        console.log('开始初始化主题切换器');
        
        const themeSwitcher = document.getElementById('themeSwitcher');
        if (!themeSwitcher) {
            console.log('当前页面未找到主题切换按钮，跳过初始化');
            // 仍然应用主题，但不初始化切换按钮的交互
            applyTheme(loadThemePreference());
            return;
        }
        
        // 获取当前主题
        const savedTheme = loadThemePreference();
        
        const themeSwitcherTooltip = document.getElementById('themeSwitcherTooltip');

        // 更新主题提示文本的函数 - 只显示主题状态 (异步)
        // 定义在此处，以便在下面的 if 块和事件监听器中可用
        async function updateThemeTooltip(tooltipElement, themeType) {
            if (tooltipElement) {
                tooltipElement.textContent = await getThemeStatusText(themeType);
            }
        }
        
        // 设置tooltip文本（仅显示主题状态，不显示"切换主题"文字）
        if (themeSwitcherTooltip) {
            // 设置初始状态为隐藏
            themeSwitcherTooltip.style.visibility = 'hidden';
            themeSwitcherTooltip.style.opacity = '0';
            
            // 设置初始提示文本，基于当前主题
            updateThemeTooltip(themeSwitcherTooltip, savedTheme);
            
            // 添加鼠标悬停事件
            themeSwitcher.addEventListener('mouseenter', async function() {
                // 在鼠标悬停时更新提示文本
                const currentTheme = loadThemePreference();
                await updateThemeTooltip(themeSwitcherTooltip, currentTheme);
                
                themeSwitcherTooltip.style.visibility = 'visible';
                themeSwitcherTooltip.style.opacity = '1';
            });
            
            themeSwitcher.addEventListener('mouseleave', function() {
                themeSwitcherTooltip.style.visibility = 'hidden';
                themeSwitcherTooltip.style.opacity = '0';
            });
        }
        
        console.log('加载的主题偏好:', savedTheme);
        
        // 应用主题
        applyTheme(savedTheme);
        
        // 监听系统主题变化
        watchSystemThemeChanges();
        
        // 点击切换主题
        themeSwitcher.addEventListener('click', function() {
            // 获取当前主题
            const currentTheme = loadThemePreference();
            console.log('当前主题:', currentTheme);
            
            // 循环切换主题: 系统 -> 浅色 -> 深色 -> 系统
            let newTheme;
            switch (currentTheme) {
                case ThemeType.SYSTEM:
                    newTheme = ThemeType.LIGHT;
                    break;
                case ThemeType.LIGHT:
                    newTheme = ThemeType.DARK;
                    break;
                case ThemeType.DARK:
                case "dark": // 兼容可能的字符串值
                    newTheme = ThemeType.SYSTEM;
                    break;
                default:
                    newTheme = ThemeType.SYSTEM;
            }
            
            console.log('切换到新主题:', newTheme);
            
            // 保存并应用新主题
            saveThemePreference(newTheme);
            applyTheme(newTheme);
            
            // 立即更新提示文本
            if (themeSwitcherTooltip) {
                updateThemeTooltip(themeSwitcherTooltip, newTheme);
            }
        });
        
        console.log('主题切换器初始化完成');

        // 监听语言变化以更新工具提示
        if (chrome && chrome.storage && chrome.storage.onChanged) {
            chrome.storage.onChanged.addListener(async (changes, areaName) => {
                if (areaName === 'local' && changes.preferredLang) {
                    console.log('检测到语言变化，更新主题工具提示:', changes.preferredLang.newValue);
                    const currentTheme = loadThemePreference();
                    if (themeSwitcherTooltip) {
                        await updateThemeTooltip(themeSwitcherTooltip, currentTheme);
                    }
                }
            });
        }
    }

    // 在文档加载完成后初始化
    function initialize() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initializeThemeSwitcher);
        } else {
            initializeThemeSwitcher();
        }
    }

    // 初始化
    initialize();
})();
