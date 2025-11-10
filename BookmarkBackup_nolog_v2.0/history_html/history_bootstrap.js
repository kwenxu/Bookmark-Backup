// Lightweight bootstrap to set early page title from ?t=, before heavy scripts
(function(){
  try {
    const t = new URLSearchParams(location.search).get('t');
    if (t) document.title = t;
  } catch(_) {}
})();

