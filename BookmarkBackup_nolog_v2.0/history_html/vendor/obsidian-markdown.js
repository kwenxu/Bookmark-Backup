/*
 * Obsidian-flavored Markdown helpers layered on top of marked.js
 * Enables callouts, wiki-style links, highlight syntax and safer link handling
 */
(function attachObsidianMarkdown(global) {
  const marked = global.marked;
  if (!marked) {
    console.error('[ObsidianMarkdown] marked.js not loaded');
    return;
  }

  const escapeHtml = (str = '') =>
    String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const allowedProtocols = new Set(['http:', 'https:', 'mailto:', 'tel:', 'obsidian:']);
  const sanitizeHref = (href = '') => {
    if (!href) return null;
    if (href.startsWith('#')) return href;
    try {
      const url = new URL(href, 'https://dummy.local');
      return allowedProtocols.has(url.protocol) ? href : null;
    } catch (_) {
      return null;
    }
  };

  const renderer = new marked.Renderer();
  const baseLink = renderer.link.bind(renderer);
  renderer.link = function safeLink(href, title, text) {
    const safeHref = sanitizeHref(href);
    if (!safeHref) return text;
    const html = baseLink(safeHref, title, text);
    return html.replace('<a ', '<a target="_blank" rel="noopener noreferrer" ');
  };

  const baseImage = renderer.image.bind(renderer);
  renderer.image = function safeImage(href, title, text) {
    const safeHref = sanitizeHref(href);
    if (!safeHref) return text || '';
    return baseImage(safeHref, title, text);
  };

  // 允许安全的HTML标签（Obsidian风格）
  // 注：这里的白名单用于“Markdown 源码中的原生 HTML 片段”。
  // Canvas 空白栏目（md-node）的格式工具会生成/提示一些 HTML 语法（如 <center>、<p align="">），
  // 其它区域（如永久栏目/书签型临时栏目说明）也需要复用同一套语法与渲染规则。
  const allowedTags = new Set([
    'font',
    'span',
    'u',
    'mark',
    'strong',
    'em',
    'b',
    'i',
    'del',
    's',
    'sub',
    'sup',
    'br',
    'center',
    'p'
  ]);
  const allowedAttrs = new Set(['color', 'style', 'class', 'align']);
  
  renderer.html = function safeHtml(html) {
    // 简单的标签白名单过滤
    const tagPattern = /<(\/?)([\w]+)([^>]*)>/g;
    return html.replace(tagPattern, (match, slash, tag, attrs) => {
      const tagLower = tag.toLowerCase();
      if (!allowedTags.has(tagLower)) {
        return escapeHtml(match);
      }
      
      // 过滤属性，只保留安全的属性
      if (attrs && !slash) {
        const safeAttrs = attrs.replace(/(\w+)\s*=\s*["']([^"']*)["']/g, (attrMatch, name, value) => {
          if (allowedAttrs.has(name.toLowerCase())) {
            // 对于style和color属性，进行额外的安全检查
            if (name.toLowerCase() === 'style' || name.toLowerCase() === 'color') {
              // 移除可能的危险内容（如javascript:）
              if (value.toLowerCase().includes('javascript:') || value.toLowerCase().includes('expression(')) {
                return '';
              }
            }
            // 不要双重转义，直接使用原始值
            const safeValue = String(value).replace(/"/g, '&quot;');
            return ` ${name}="${safeValue}"`;
          }
          return '';
        });
        return `<${slash}${tagLower}${safeAttrs}>`;
      }
      
      return `<${slash}${tagLower}>`;
    });
  };

  const CALL_OUT_ICONS = {
    note: '📝',
    info: '💡',
    tip: '✨',
    success: '✅',
    question: '❓',
    warning: '⚠️',
    danger: '⛔',
    bug: '🐞',
    example: '📌',
    quote: '💬'
  };

  const renderCallout = (token, options) => {
    const type = (token.calloutType || 'note').toLowerCase();
    const title = token.calloutTitle ? escapeHtml(token.calloutTitle) : type.toUpperCase();
    const bodyTokens = Array.isArray(token.tokens) ? token.tokens : [];
    const body = marked.parser(bodyTokens, options || marked.defaults);
    const icon = CALL_OUT_ICONS[type] || CALL_OUT_ICONS.note;
    const collapsed = token.calloutState === 'collapsed';
    const expandedAttr = collapsed ? 'false' : 'true';
    return `
      <div class="md-callout md-callout-${type}${collapsed ? ' collapsed' : ''}" data-callout="${type}">
        <div class="md-callout-header">
          <button type="button" class="md-callout-toggle" aria-expanded="${expandedAttr}" aria-label="Toggle callout"></button>
          <span class="md-callout-icon" aria-hidden="true">${icon}</span>
          <span class="md-callout-title">${title}</span>
        </div>
        <div class="md-callout-body">${body}</div>
      </div>
    `;
  };

  marked.setOptions({
    gfm: true,
    breaks: true,
    mangle: false,
    smartLists: true,
    headerIds: false,
    renderer
  });

  const highlightExtension = {
    name: 'highlight',
    level: 'inline',
    start(src) {
      return src.indexOf('==');
    },
    tokenizer(src) {
      const match = /^==(?=\S)([\s\S]*?\S)==/.exec(src);
      if (match) {
        return {
          type: 'highlight',
          raw: match[0],
          text: match[1]
        };
      }
    },
    renderer(token) {
      return `<mark>${marked.parseInline(token.text)}</mark>`;
    }
  };

  const wikiLinkExtension = {
    name: 'wikilink',
    level: 'inline',
    start(src) {
      return src.indexOf('[[');
    },
    tokenizer(src) {
      const match = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(src);
      if (match) {
        return {
          type: 'wikilink',
          raw: match[0],
          target: match[1].trim(),
          alias: (match[2] || match[1]).trim()
        };
      }
    },
    renderer(token) {
      const target = escapeHtml(token.target || '');
      const label = escapeHtml(token.alias || token.target || '');
      return `<span class="md-wikilink" data-wikilink="${target}">${label}</span>`;
    }
  };

  const calloutExtension = {
    name: 'callout',
    level: 'block',
    start(src) {
      const match = src.match(/\s{0,3}>\s*\[!/);
      return match ? match.index : undefined;
    },
    tokenizer(src) {
      const cap = /^ {0,3}>\s*\[!([A-Za-z0-9_-]+)\](\+|\-)?\s*([^\n]*)\s*(?:\n|$)((?: {0,3}>\s?.*(?:\n|$))*)/.exec(src);
      if (!cap) return;
      const [, type, state, titleText, rest] = cap;
      const remaining = (rest || '').replace(/^ {0,3}>\s?/gm, '');
      return {
        type: 'callout',
        raw: cap[0],
        calloutType: type.toLowerCase(),
        calloutState: state === '-' ? 'collapsed' : 'expanded',
        calloutTitle: titleText || '',
        text: remaining,
        tokens: this.lexer.blockTokens(remaining || '')
      };
    },
    renderer(token) {
      return renderCallout(token, this.options);
    }
  };

  const invertedSetextExtension = {
    name: 'invertedSetext',
    level: 'block',
    start(src) {
      return src.match(/^(?![ \t\n]+)((?:.|\n)*?)\n\s*(-{3,}|={3,})\s*(?:\n+|$)/)?.index;
    },
    tokenizer(src) {
      const rule = /^(?![ \t\n]+)((?:.|\n)*?)\n\s*(-{3,}|={3,})\s*(?:\n+|$)/;
      const match = rule.exec(src);
      if (match) {
        const text = match[1];
        const marker = match[2];
        // User wants: '-' (3+) -> H1, '=' (3+) -> H2
        const depth = marker.startsWith('-') ? 1 : 2;
        
        return {
          type: 'heading',
          raw: match[0],
          depth: depth,
          text: text.trim(),
          tokens: this.lexer.inlineTokens(text.trim())
        };
      }
    }
  };

  marked.use({ extensions: [highlightExtension, wikiLinkExtension, calloutExtension, invertedSetextExtension] });

  const handleCalloutToggle = (event) => {
    const toggle = event.target.closest('.md-callout-toggle');
    if (!toggle) return;
    const callout = toggle.closest('.md-callout');
    if (!callout) return;
    callout.classList.toggle('collapsed');
    const expanded = !callout.classList.contains('collapsed');
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  };

  document.addEventListener('click', handleCalloutToggle);

  global.ObsidianMarkdown = { sanitizeHref };
})(typeof window !== 'undefined' ? window : globalThis);
