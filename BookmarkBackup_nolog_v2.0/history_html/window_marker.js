// MV3-safe: external script only, no inline code
(function(){
  function redirect() {
    try {
      const usp = new URLSearchParams(location.search);
      const params = new URLSearchParams();
      const t = usp.get('t');
      const type = usp.get('type'); // 'hyperlink' 或 undefined（书签系统）
      
      if (t) params.set('t', t);
      const lt = usp.get('lt');
      const sid = usp.get('sid');
      const nid = usp.get('nid');
      params.set('view', 'canvas');
      if (lt) params.set('lt', lt);
      if (sid) params.set('sid', sid);
      if (nid) params.set('nid', nid);
      
      // 如果是超链接系统的窗口，传递type参数
      if (type === 'hyperlink') {
        params.set('type', 'hyperlink');
      }
      
      // Top-level redirect so tab URL and title come from history.html
      const dest = `history.html?${params.toString()}`;
      location.replace(dest);
    } catch (e) {
      console.warn('[window_marker] redirect failed:', e);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', redirect, { once: true });
  } else {
    redirect();
  }
})();
