(() => {
  'use strict';

  const app = document.getElementById('app');
  const state = { cfg: null, topics: [], tools: [], topicMap: new Map() };

  /* ---------- עזרים ---------- */

  const h = (tag, props, ...kids) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      node.append(kid.nodeType ? kid : document.createTextNode(kid));
    }
    return node;
  };

  const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
  const norm = (s) => (s || '')
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '')
    .replace(/["'״׳`]/g, '')
    .replace(/[-–־—]/g, ' ')
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .replace(/\s+/g, ' ')
    .trim();

  const safeUrl = (u) => (/^(https?:|mailto:)/i.test((u || '').trim()) ? u.trim() : '#');

  const formatDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('he-IL', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  const toolsWord = (n) => (n === 1 ? 'כלי אחד' : `${n} כלים`);

  /* ---------- שאילתות על הנתונים ---------- */

  const topicVisible = (t) => {
    let cur = t;
    for (let i = 0; cur && i < 50; i++) {
      if (cur.hidden) return false;
      cur = cur.parentId ? state.topicMap.get(cur.parentId) : null;
    }
    return true;
  };

  const childrenOf = (id) => state.topics.filter((t) => (t.parentId || null) === id && topicVisible(t));

  const toolsOf = (topicId) => {
    const order = state.topicMap.get(topicId)?.toolOrder || [];
    const rank = (t) => { const i = order.indexOf(t.id); return i === -1 ? 1e6 : i; };
    return state.tools
      .filter((t) => !t.hidden && (t.topicIds || []).includes(topicId))
      .sort((a, b) => rank(a) - rank(b));
  };

  const subtreeToolIds = (id, set = new Set(), depth = 0) => {
    if (depth > 50) return set;
    toolsOf(id).forEach((t) => set.add(t.id));
    childrenOf(id).forEach((c) => subtreeToolIds(c.id, set, depth + 1));
    return set;
  };

  const pathOf = (id) => {
    const out = [];
    let cur = state.topicMap.get(id);
    for (let i = 0; cur && i < 50; i++) {
      out.unshift(cur);
      cur = cur.parentId ? state.topicMap.get(cur.parentId) : null;
    }
    return out;
  };

  const primaryVisibleTopic = (tool) => {
    for (const id of tool.topicIds || []) {
      const t = state.topicMap.get(id);
      if (t && topicVisible(t)) return t;
    }
    return null;
  };

  /* ---------- רכיבי תצוגה ---------- */

  function tile(topic) {
    const count = subtreeToolIds(topic.id).size;
    const icon = h('span', { class: 'tile-icon', 'aria-hidden': 'true', text: topic.icon || '📘' });
    let media = icon;
    if (topic.image) {
      media = h('img', { src: topic.image, alt: '', loading: 'lazy' });
      media.addEventListener('error', () => media.replaceWith(icon));
    }
    return h('a', { class: 'tile' + (count ? '' : ' is-empty'), href: `#/topic/${encodeURIComponent(topic.id)}` },
      h('div', { class: 'tile-media' }, media),
      h('div', { class: 'tile-body' },
        h('p', { class: 'tile-title', text: topic.title }),
        h('div', { class: 'tile-meta', text: count ? toolsWord(count) : 'בקרוב' })));
  }

  function crumbs(topicId) {
    const items = [h('li', {}, h('a', { href: '#/', text: 'בית' }))];
    const path = pathOf(topicId);
    path.forEach((t, i) => {
      const last = i === path.length - 1;
      items.push(h('li', {}, last
        ? h('span', { 'aria-current': 'page', text: t.title })
        : h('a', { href: `#/topic/${encodeURIComponent(t.id)}`, text: t.title })));
    });
    return h('nav', { class: 'crumbs', 'aria-label': 'פירורי לחם' }, h('ol', {}, items));
  }

  function toolCard(tool, topicId, open) {
    const links = tool.links || [];
    const docs = (tool.documents || []).filter((d) => d.url);
    const others = (tool.topicIds || [])
      .filter((id) => id !== topicId)
      .map((id) => state.topicMap.get(id))
      .filter((t) => t && topicVisible(t));

    return h('details', { class: 'tool', id: `tool-${tool.id}`, open },
      h('summary', {}, h('span', { text: tool.title })),
      h('div', { class: 'tool-body' },
        h('p', { text: tool.description }),
        links.length ? h('div', { class: 'tool-actions' }, links.map((l, i) =>
          h('a', {
            class: 'btn ' + (i === 0 ? 'btn-primary' : 'btn-secondary'),
            href: safeUrl(l.url), target: '_blank', rel: 'noopener noreferrer',
            text: l.label || 'פתיחת הכלי',
          }))) : null,
        docs.length ? h('ul', { class: 'docs' }, docs.map((d) =>
          h('li', {},
            h('a', { href: safeUrl(d.url), target: '_blank', rel: 'noopener noreferrer', text: d.label || 'מסמך' }),
            d.note ? h('span', { class: 'note', text: ` ‏– ${d.note}` }) : null))) : null,
        h('div', { class: 'tool-meta' },
          tool.updated ? h('span', { text: `עודכן: ${formatDate(tool.updated)}` }) : null,
          others.length ? h('span', {}, 'מופיע גם ב: ', others.map((t, i) => [
            i ? ', ' : '',
            h('a', { href: `#/topic/${encodeURIComponent(t.id)}`, text: t.title }),
          ])) : null)));
  }

  function emptyState(message) {
    return h('div', { class: 'empty-state' },
      h('p', { text: message }),
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: openContact, text: 'צור קשר' }));
  }

  function searchForm(value) {
    const input = h('input', {
      class: 'search-input', type: 'search', name: 'q', value: value || '',
      placeholder: 'חיפוש כלי לפי שם או תיאור', 'aria-label': 'חיפוש כלי', autocomplete: 'off',
    });
    const form = h('form', { class: 'search', role: 'search' },
      h('span', { class: 'search-icon', 'aria-hidden': 'true', text: '🔎' }), input);
    wireSearch(form, input);
    return form;
  }

  let searchTimer;
  function wireSearch(form, input) {
    const go = () => {
      const q = input.value.trim();
      location.hash = q ? `#/search/${encodeURIComponent(q)}` : '#/';
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(searchTimer); go(); });
    input.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(go, 250); });
  }

  /* ---------- עמודים ---------- */

  function renderHome() {
    const roots = childrenOf(null);
    app.replaceChildren(
      h('section', { class: 'hero' }, h('div', { class: 'container' },
        h('h1', { text: state.cfg.siteTitle }),
        h('p', { text: state.cfg.tagline }),
        searchForm(''))),
      h('section', { class: 'container page' },
        h('h2', { class: 'section-title', text: 'נושאים' }),
        roots.length ? h('div', { class: 'tiles' }, roots.map(tile)) : emptyState('הספרייה עדיין ריקה.')));
    document.title = state.cfg.siteTitle;
  }

  function renderTopic(id, toolId) {
    const topic = state.topicMap.get(id);
    if (!topic || !topicVisible(topic)) return renderNotFound();
    const subs = childrenOf(id);
    const tools = toolsOf(id);

    const sections = [];
    if (subs.length) {
      sections.push(h('section', { class: 'block' },
        h('h2', { class: 'section-title', text: 'תתי־נושאים' }),
        h('div', { class: 'tiles' }, subs.map(tile))));
    }
    if (tools.length) {
      sections.push(h('section', { class: 'block' },
        h('h2', { class: 'section-title', text: 'כלים' }),
        tools.map((t) => toolCard(t, id, t.id === toolId))));
    }
    if (!subs.length && !tools.length) {
      sections.push(h('section', { class: 'block' },
        emptyState('התחום הזה עדיין מתפתח וכלים יתווספו אליו בקרוב. יש לכם כלי להצעה?')));
    }

    app.replaceChildren(h('div', { class: 'container page' },
      crumbs(id),
      h('h1', { class: 'page-title', text: topic.title }),
      topic.description ? h('p', { class: 'page-desc', text: topic.description }) : null,
      sections));
    document.title = `${topic.title} | ${state.cfg.siteTitle}`;

    if (toolId) {
      const node = document.getElementById(`tool-${toolId}`);
      if (node) { node.scrollIntoView({ block: 'center' }); return; }
    }
    window.scrollTo(0, 0);
  }

  function renderSearch(q) {
    const terms = norm(q).split(' ').filter(Boolean);
    const score = (t) => {
      const title = norm(t.title);
      const hay = `${title} ${norm(t.description)}`;
      if (!terms.every((w) => hay.includes(w))) return -1;
      return terms.filter((w) => title.includes(w)).length + 1;
    };
    const results = state.tools
      .filter((t) => !t.hidden && primaryVisibleTopic(t))
      .map((t) => ({ t, s: score(t) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((r) => r.t);

    const cards = results.map((t) => {
      const topic = primaryVisibleTopic(t);
      const main = (t.links || [])[0];
      return h('article', { class: 'result' },
        h('h3', {}, h('a', { href: `#/topic/${encodeURIComponent(topic.id)}/${encodeURIComponent(t.id)}`, text: t.title })),
        h('div', { class: 'path', text: pathOf(topic.id).map((p) => p.title).join(' ← ') }),
        h('p', { text: t.description }),
        main ? h('a', {
          class: 'btn btn-primary', href: safeUrl(main.url), target: '_blank', rel: 'noopener noreferrer',
          text: main.label || 'פתיחת הכלי',
        }) : null);
    });

    app.replaceChildren(h('div', { class: 'container page' },
      crumbs_search(),
      h('h1', { class: 'page-title', text: `תוצאות חיפוש: ${q}` }),
      h('p', { class: 'page-desc', text: results.length === 1 ? 'נמצא כלי אחד' : results.length ? `נמצאו ${results.length} כלים` : '' }),
      results.length ? cards : emptyState('לא נמצאו כלים שמתאימים לחיפוש. נסו מילה אחרת, או פנו אלינו ונשמח לעזור.')));
    document.title = `חיפוש: ${q} | ${state.cfg.siteTitle}`;
    window.scrollTo(0, 0);
  }

  function crumbs_search() {
    return h('nav', { class: 'crumbs', 'aria-label': 'פירורי לחם' },
      h('ol', {}, h('li', {}, h('a', { href: '#/', text: 'בית' })), h('li', {}, h('span', { 'aria-current': 'page', text: 'חיפוש' }))));
  }

  function renderNotFound() {
    app.replaceChildren(h('div', { class: 'container page' },
      emptyState('העמוד שחיפשתם לא נמצא.'),
      h('p', {}, h('a', { href: '#/', text: 'חזרה לעמוד הראשי' }))));
    document.title = state.cfg.siteTitle;
  }

  /* ---------- ניווט ---------- */

  const headerInput = document.querySelector('#header-search input');

  function route() {
    const wasTyping = document.activeElement && document.activeElement.matches('input[type=search]');
    let parts;
    try {
      parts = (location.hash || '#/').slice(2).split('/').map(decodeURIComponent);
    } catch { parts = ['']; }
    const page = parts[0] || 'home';
    document.body.classList.toggle('is-home', page === 'home');

    if (page === 'topic' && parts[1]) renderTopic(parts[1], parts[2] || null);
    else if (page === 'search') {
      const q = parts.slice(1).join('/');
      headerInput.value = q;
      renderSearch(q);
      if (wasTyping) {
        headerInput.focus();
        headerInput.setSelectionRange(q.length, q.length);
      }
    } else if (page === 'home') { headerInput.value = ''; renderHome(); }
    else renderNotFound();
  }

  /* ---------- יצירת קשר ---------- */

  const dialog = document.getElementById('contact-dialog');

  function waNumber(raw) {
    const d = (raw || '').replace(/\D/g, '');
    return d.startsWith('972') ? d : d.replace(/^0/, '972');
  }

  function buildContact() {
    const { contactEmail, contactWhatsapp } = state.cfg;
    const list = document.getElementById('contact-list');
    list.replaceChildren();
    if (contactEmail) {
      list.append(h('a', { class: 'btn btn-secondary', href: `mailto:${contactEmail}` },
        '✉️ ', h('span', { class: 'ltr', text: contactEmail })));
    }
    if (contactWhatsapp) {
      list.append(h('a', {
        class: 'btn btn-secondary', href: `https://wa.me/${waNumber(contactWhatsapp)}`,
        target: '_blank', rel: 'noopener noreferrer',
      }, '💬 וואטסאפ: ', h('span', { class: 'ltr', text: contactWhatsapp })));
    }
  }

  function openContact() {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  document.getElementById('contact-btn').addEventListener('click', openContact);
  document.getElementById('contact-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  /* ---------- אתחול ---------- */

  async function init() {
    wireSearch(document.getElementById('header-search'), headerInput);
    try {
      const [cfg, lib] = await Promise.all([
        fetch('config.json', { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error('config'); return r.json(); }),
        fetch('data/library.json', { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error('library'); return r.json(); }),
      ]);
      state.cfg = cfg;
      state.topics = lib.topics || [];
      state.tools = lib.tools || [];
      state.topicMap = new Map(state.topics.map((t) => [t.id, t]));
    } catch {
      app.replaceChildren(h('div', { class: 'container page' },
        emptyState('לא ניתן לטעון את הספרייה כרגע. נסו לרענן את העמוד.')));
      return;
    }
    document.getElementById('brand-title').textContent = state.cfg.siteTitle;
    buildContact();
    window.addEventListener('hashchange', route);
    route();
  }

  init();
})();
