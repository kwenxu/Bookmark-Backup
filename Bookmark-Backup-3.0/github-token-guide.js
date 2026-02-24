(function () {
    const STORAGE_KEY = 'bookmark-backup.github-token-guide.lang';
    const THEME_STORAGE_KEY = 'bookmark-backup.github-token-guide.theme';

    const urlParams = new URLSearchParams(location.search);
    const paramLang = urlParams.get('lang');
    const paramTheme = urlParams.get('theme');

    // 1. Determine Initial Theme
    // 1. Determine Initial Theme
    // Priority: LocalStorage > URL Param > System Preference
    let initialTheme = 'light';
    try {
        const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
        if (savedTheme === 'dark' || savedTheme === 'light') {
            initialTheme = savedTheme;
        } else if (paramTheme === 'dark' || paramTheme === 'light') {
            initialTheme = paramTheme;
        } else {
            initialTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
    } catch (_) {
        initialTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    // 2. Elements
    const savedLang = localStorage.getItem(STORAGE_KEY);
    const browserLang = (navigator.language || '').toLowerCase().startsWith('en') ? 'en' : 'zh';
    const initialLang = (paramLang || savedLang || browserLang) === 'en' ? 'en' : 'zh';

    const zhBlocks = document.querySelectorAll('[data-lang="zh"]');
    const enBlocks = document.querySelectorAll('[data-lang="en"]');
    const langBtns = Array.from(document.querySelectorAll('[data-set-lang]'));

    const themeBtn = document.getElementById('themeBtn');
    const iconSun = document.getElementById('iconSun');
    const iconMoon = document.getElementById('iconMoon');

    // 3. Theme Functions
    function setTheme(theme) {
        const next = theme === 'dark' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', next);

        try {
            localStorage.setItem(THEME_STORAGE_KEY, next);
        } catch (_) { }

        // Update Icons: 
        // Dark mode -> show Sun (to switch to light)
        // Light mode -> show Moon (to switch to dark)
        if (next === 'dark') {
            if (iconSun) iconSun.hidden = false;
            if (iconMoon) iconMoon.hidden = true;
        } else {
            if (iconSun) iconSun.hidden = true;
            if (iconMoon) iconMoon.hidden = false;
        }
    }

    // 4. Lang Functions
    function setLang(lang) {
        const next = lang === 'en' ? 'en' : 'zh';

        zhBlocks.forEach(el => el.hidden = next !== 'zh');
        enBlocks.forEach(el => el.hidden = next !== 'en');

        document.documentElement.lang = next === 'en' ? 'en' : 'zh-CN';
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch (_) { }
        langBtns.forEach((b) => b.classList.toggle('active', b.dataset.setLang === next));
    }

    // 5. Event Listeners
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme') || 'light';
            setTheme(current === 'light' ? 'dark' : 'light');
        });
    }

    langBtns.forEach((b) => {
        b.addEventListener('click', () => setLang(b.dataset.setLang));
    });

    // 6. Init
    setTheme(initialTheme);
    setLang(initialLang);
})();
