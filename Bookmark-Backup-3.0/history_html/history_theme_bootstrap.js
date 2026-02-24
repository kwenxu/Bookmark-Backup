// Apply theme early to avoid flash (no inline script for CSP)
(function () {
  try {
    const hasOverride = localStorage.getItem('historyViewerHasCustomTheme') === 'true';
    let theme = hasOverride ? localStorage.getItem('historyViewerCustomTheme') : null;
    if (!theme) {
      const pref = localStorage.getItem('themePreference');
      if (pref === 'dark' || pref === 'light') {
        theme = pref;
      } else {
        const prefersDark = window.matchMedia
          && window.matchMedia('(prefers-color-scheme: dark)').matches;
        theme = prefersDark ? 'dark' : 'light';
      }
    }
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  } catch (_) {}
})();
