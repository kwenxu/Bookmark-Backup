// 通知窗口的主题管理（简化版，无主题切换按钮）
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

    // 从本地存储加载主题设置
    function loadThemePreference() {
        try {
            return localStorage.getItem('themePreference') || ThemeType.SYSTEM;
        } catch (e) {
            console.error('无法加载主题偏好:', e);
            return ThemeType.SYSTEM;
        }
    }

    // 应用主题到文档
    function applyTheme(themeType) {
        // 获取实际要应用的主题
        const actualTheme = themeType === ThemeType.SYSTEM ? 
            getSystemThemePreference() : themeType;
        
        // 移除所有可能的主题类
        document.documentElement.removeAttribute('data-theme');
        
        // 应用深色主题（浅色是默认，不需要特别设置）
        if (actualTheme === ThemeType.DARK) {
            document.documentElement.setAttribute('data-theme', 'dark');
        }
        
        console.log('已应用主题:', actualTheme);
    }

    // 监听系统主题变化
    function watchSystemThemeChanges() {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        
        // 使用较新的 addEventListener API 监听变化
        if (mediaQuery.addEventListener) {
            mediaQuery.addEventListener('change', function() {
                // 只有在设置为"跟随系统"时才需要响应系统变化
                if (loadThemePreference() === ThemeType.SYSTEM) {
                    applyTheme(ThemeType.SYSTEM);
                }
            });
        } else if (mediaQuery.addListener) {
            // 兼容旧版浏览器 (Safari 13, iOS 12.4等)
            mediaQuery.addListener(function() {
                // 只有在设置为"跟随系统"时才需要响应系统变化
                if (loadThemePreference() === ThemeType.SYSTEM) {
                    applyTheme(ThemeType.SYSTEM);
                }
            });
        }
    }

    // 初始化
    function initialize() {
        // 应用保存的主题
        const savedTheme = loadThemePreference();
        applyTheme(savedTheme);
        
        // 监听系统主题变化
        watchSystemThemeChanges();
        
        console.log('通知窗口主题初始化完成');
    }

    // 在文档加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();
