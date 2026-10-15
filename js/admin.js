(() => {
  'use strict';

  const root = document.getElementById('admin');
  const DATA_PATH = 'data/library.json';
  const LS_KEY = 'hsl-admin-conn';

  const S = {
    cfg: null,
    demo: false,
    conn: { owner: '', repo: '', branch: 'main', token: '' },
    data: null,
    sha: null,
    dirty: false,
    selTopic: null,
    selTool: null,
    busy: false,
    notice: null,
  };

  /* ---------- עזרים ---------- */

  const h = (tag, props, ...kids) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'value') node.value = v;
      else if (k === 'checked') node.checked = !!v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      node.append(kid.nodeType ? kid : document.createTextNode(kid));
    }
    return node;
  };

  const store = {
    get() { try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { return null; } },
    set(v) { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch { /* ignore */ } },
    clear() { try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ } },
  };

  const b64enc = (s) => {
    let bin = '';
    new TextEncoder().encode(s).forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin);
  };
  const b64dec = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

  const rid = (p) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
  const today = () => new Date().toISOString().slice(0, 10);
  const isHttp = (u) => /^https?:\/\/\S+$/i.test((u || '').trim());

  /* ---------- GitHub ---------- */

  async function gh(path, opts = {}) {
    const { owner, repo, token } = S.conn;
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/${path}`, {
      ...opts,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.headers || {}),
      },
    });
    if (res.ok) return res.json();
    const map = {
      401: 'הטוקן לא תקין או שפג תוקפו. צרו טוקן חדש והתחברו שוב.',
      403: 'אין לטוקן הרשאה לכתוב ב-repo הזה. ודאו שניתנה לו הרשאת Contents: Read and write.',
      404: 'לא נמצא repo או קובץ נתונים. בדקו את שם המשתמש, שם ה-repo והענף.',
      409: 'מנהל אחר שמר שינויים בינתיים. רעננו את הדף כדי לטעון את הגרסה העדכנית.',
      422: 'השמירה נדחתה: הקובץ השתנה בינתיים. רעננו את הדף ונסו שוב.',
    };
    throw new Error(map[res.status] || `שגיאה מ-GitHub (${res.status}).`);
  }

  async function loadData() {
    let data;
    if (S.demo) {
      data = await fetch(`../${DATA_PATH}`, { cache: 'no-cache' }).then((r) => r.json());
    } else {
      const file = await gh(`contents/${DATA_PATH}?ref=${encodeURIComponent(S.conn.branch)}`);
      S.sha = file.sha;
      data = JSON.parse(b64dec(file.content));
    }
    data.topics = data.topics || [];
    data.tools = data.tools || [];
    S.data = data;
    S.dirty = false;
  }

  function cleanData() {
    const t = (s) => (typeof s === 'string' ? s.trim() : s);
    const topics = S.data.topics.map((x) => ({
      id: x.id, title: t(x.title), icon: t(x.icon) || '', parentId: x.parentId || null,
      hidden: !!x.hidden, image: t(x.image) || '', description: t(x.description) || '',
      toolOrder: (x.toolOrder || []).filter((id) => S.data.tools.some((tl) => tl.id === id)),
    }));
    const tools = S.data.tools.map((x) => ({
      id: x.id, title: t(x.title), description: t(x.description), updated: x.updated || '',
      hidden: !!x.hidden, topicIds: x.topicIds || [],
      links: (x.links || []).filter((l) => (l.url || '').trim()).map((l) => ({ label: t(l.label) || 'פתיחת הכלי', url: t(l.url) })),
      documents: (x.documents || []).filter((d) => (d.url || '').trim())
        .map((d) => ({ label: t(d.label) || 'מסמך', note: t(d.note) || '', url: t(d.url) })),
    }));
    return { topics, tools };
  }

  function validate(data) {
    const errs = [];
    const ids = new Set(data.topics.map((x) => x.id));
    data.topics.forEach((x) => { if (!x.title) errs.push('נושא ללא שם.'); });
    data.tools.forEach((x) => {
      const name = x.title || '(ללא שם)';
      if (!x.title) errs.push('יש כלי ללא שם.');
      if (!x.description) errs.push(`לכלי "${name}" חסר תיאור.`);
      if (!x.topicIds.length || !x.topicIds.every((id) => ids.has(id))) errs.push(`לכלי "${name}" חסר שיוך לנושא.`);
      if (!x.links.length || !isHttp(x.links[0].url)) errs.push(`לכלי "${name}" חסר קישור ראשי תקין (חייב להתחיל ב-https://).`);
      x.links.concat(x.documents).forEach((l) => { if (!isHttp(l.url)) errs.push(`בכלי "${name}" יש קישור לא תקין: ${l.url}`); });
    });
    return errs;
  }

  async function publish() {
    if (S.busy) return;
    const data = cleanData();
    const errs = validate(data);
    if (errs.length) {
      S.notice = { error: true, title: 'לא ניתן לפרסם עדיין. יש לתקן:', items: errs };
      return render();
    }
    if (S.demo) {
      S.data = data;
      S.dirty = false;
      S.notice = { title: 'מצב הדגמה: השינויים נשמרו רק בזיכרון הדף ולא באתר. "ייצוא גיבוי" מוריד אותם לקובץ. ברענון הדף הכל חוזר למצב המקורי.' };
      return render();
    }
    S.busy = true; S.notice = null; render();
    try {
      const body = {
        message: `עדכון הספרייה (${new Date().toLocaleString('he-IL')})`,
        content: b64enc(`${JSON.stringify(data, null, 2)}\n`),
        sha: S.sha,
        branch: S.conn.branch,
      };
      const res = await gh(`contents/${DATA_PATH}`, { method: 'PUT', body: JSON.stringify(body) });
      S.sha = res.content.sha;
      S.data = data;
      S.dirty = false;
      S.notice = { title: 'הפרסום נשלח. השינויים יופיעו באתר בתוך כדקה בערך.' };
    } catch (e) {
      S.notice = { error: true, title: e.message };
    }
    S.busy = false;
    render();
  }

  function exportBackup() {
    const blob = new Blob([`${JSON.stringify(cleanData(), null, 2)}\n`], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `library-backup-${today()}.json` });
    document.body.append(a); a.click(); a.remove();
  }

  /* ---------- מצב ושאילתות ---------- */

  const topicById = (id) => S.data.topics.find((t) => t.id === id);
  const toolById = (id) => S.data.tools.find((t) => t.id === id);
  const siblings = (pid) => S.data.topics.filter((t) => (t.parentId || null) === pid);
  const childrenCount = (id) => siblings(id).length;
  const toolsInTopic = (id) => S.data.tools.filter((t) => (t.topicIds || []).includes(id));

  const descendantIds = (id, acc = new Set()) => {
    siblings(id).forEach((c) => { if (!acc.has(c.id)) { acc.add(c.id); descendantIds(c.id, acc); } });
    return acc;
  };

  const flatTopics = (pid = null, depth = 0, out = []) => {
    siblings(pid).forEach((t) => { out.push({ t, depth }); flatTopics(t.id, depth + 1, out); });
    return out;
  };

  const orderedTools = (topicId) => {
    const topic = topicById(topicId);
    const order = (topic && topic.toolOrder) || [];
    const rank = (t) => { const i = order.indexOf(t.id); return i === -1 ? 1e6 : i; };
    return toolsInTopic(topicId).sort((a, b) => rank(a) - rank(b));
  };

  function markDirty() {
    S.dirty = true;
    const el = document.getElementById('adm-status');
    if (el) { el.textContent = 'יש שינויים שלא פורסמו'; el.className = 'adm-status dirty'; }
  }

  function changed() { markDirty(); render(); }

  /* ---------- גרירה וסידור ---------- */

  let drag = null;
  function sortable(node, group, index, move) {
    node.draggable = true;
    node.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      drag = { group, index };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', '');
      node.classList.add('dragging');
    });
    node.addEventListener('dragend', () => {
      drag = null;
      node.classList.remove('dragging');
      document.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target'));
    });
    node.addEventListener('dragover', (e) => {
      if (drag && drag.group === group) { e.preventDefault(); e.stopPropagation(); node.classList.add('drop-target'); }
    });
    node.addEventListener('dragleave', () => node.classList.remove('drop-target'));
    node.addEventListener('drop', (e) => {
      if (drag && drag.group === group) {
        e.preventDefault(); e.stopPropagation();
        const from = drag.index; drag = null;
        if (from !== index) move(from, index);
      }
    });
  }

  function moveTopic(pid, from, to) {
    const all = S.data.topics;
    const positions = [];
    all.forEach((t, i) => { if ((t.parentId || null) === pid) positions.push(i); });
    const sibs = positions.map((i) => all[i]);
    const [m] = sibs.splice(from, 1);
    sibs.splice(to, 0, m);
    positions.forEach((pos, k) => { all[pos] = sibs[k]; });
    changed();
  }

  function moveTool(topicId, from, to) {
    const ids = orderedTools(topicId).map((t) => t.id);
    const [m] = ids.splice(from, 1);
    ids.splice(to, 0, m);
    topicById(topicId).toolOrder = ids;
    changed();
  }

  /* ---------- טפסים ---------- */

  const field = (label, input, hint) => h('label', { class: 'fld' },
    h('span', { class: 'fld-label', text: label }), input, hint ? h('small', { text: hint }) : null);

  function textInput(obj, key, { type = 'text', ltr = false, placeholder = '', onCommit } = {}) {
    const i = h('input', { type, value: obj[key] || '', placeholder, class: ltr ? 'ltr' : '' });
    i.addEventListener('input', () => { obj[key] = i.value; markDirty(); });
    i.addEventListener('change', () => { if (onCommit) onCommit(); });
    return i;
  }

  function textArea(obj, key) {
    const i = h('textarea', { value: obj[key] || '' });
    i.addEventListener('input', () => { obj[key] = i.value; markDirty(); });
    return i;
  }

  function checkbox(obj, key, label) {
    const i = h('input', { type: 'checkbox', checked: obj[key] });
    i.addEventListener('change', () => { obj[key] = i.checked; changed(); });
    return h('label', { class: 'chk' }, i, h('span', { text: label }));
  }

  /* ---------- עץ הנושאים ---------- */

  function treeList(pid) {
    const sibs = siblings(pid);
    if (!sibs.length) return null;
    return h('ul', {}, sibs.map((t, i) => {
      const li = h('li', {});
      const row = h('div', { class: 'tree-row' + (S.selTopic === t.id && !S.selTool ? ' sel' : '') },
        h('span', { class: 'grip', title: 'גררו לשינוי סדר', 'aria-hidden': 'true', text: '⋮⋮' }),
        h('button', {
          class: 'tree-name', type: 'button',
          onclick: () => { S.selTopic = t.id; S.selTool = null; S.notice = null; render(); },
        }, `${t.icon ? `${t.icon} ` : ''}${t.title || '(ללא שם)'}`, t.hidden ? h('span', { class: 'tag', text: 'מוסתר' }) : null),
        h('button', { class: 'mini', type: 'button', title: 'הזזה למעלה', 'aria-label': 'הזזה למעלה', disabled: i === 0 || null, onclick: () => moveTopic(pid, i, i - 1), text: '▲' }),
        h('button', { class: 'mini', type: 'button', title: 'הזזה למטה', 'aria-label': 'הזזה למטה', disabled: i === sibs.length - 1 || null, onclick: () => moveTopic(pid, i, i + 1), text: '▼' }));
      li.append(row);
      const kids = treeList(t.id);
      if (kids) li.append(kids);
      sortable(li, `topic:${pid}`, i, (from, to) => moveTopic(pid, from, to));
      return li;
    }));
  }

  function addTopic(parentId) {
    const t = { id: rid('t'), title: 'נושא חדש', icon: '', parentId, hidden: false, image: '', description: '', toolOrder: [] };
    S.data.topics.push(t);
    S.selTopic = t.id; S.selTool = null;
    changed();
  }

  function renderTree() {
    const aside = h('aside', { class: 'adm-tree', 'aria-label': 'עץ הנושאים' },
      h('h2', { text: 'נושאים' }),
      treeList(null) || h('p', { text: 'אין נושאים עדיין.' }),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => addTopic(null), text: '+ נושא ראשי' })));
    return aside;
  }

  /* ---------- עריכת נושא ---------- */

  function renderTopicEditor(topic) {
    const banned = descendantIds(topic.id); banned.add(topic.id);
    const parentSel = h('select', {});
    parentSel.append(h('option', { value: '', text: '(נושא ראשי)' }));
    flatTopics().forEach(({ t, depth }) => {
      if (banned.has(t.id)) return;
      parentSel.append(h('option', { value: t.id, selected: t.id === topic.parentId || null, text: `${'— '.repeat(depth)}${t.title}` }));
    });
    parentSel.addEventListener('change', () => { topic.parentId = parentSel.value || null; changed(); });

    const tools = orderedTools(topic.id);
    const toolList = tools.length
      ? tools.map((t, i) => {
        const row = h('div', { class: 'tool-row' },
          h('span', { class: 'grip', 'aria-hidden': 'true', text: '⋮⋮' }),
          h('button', { class: 'tool-name', type: 'button', onclick: () => { S.selTool = t.id; S.notice = null; render(); } },
            t.title || '(ללא שם)', t.hidden ? h('span', { class: 'tag', text: ' · מוסתר' }) : null),
          h('button', { class: 'mini', type: 'button', 'aria-label': 'הזזה למעלה', disabled: i === 0 || null, onclick: () => moveTool(topic.id, i, i - 1), text: '▲' }),
          h('button', { class: 'mini', type: 'button', 'aria-label': 'הזזה למטה', disabled: i === tools.length - 1 || null, onclick: () => moveTool(topic.id, i, i + 1), text: '▼' }));
        sortable(row, `tool:${topic.id}`, i, (from, to) => moveTool(topic.id, from, to));
        return row;
      })
      : [h('p', { text: 'אין כלים בנושא הזה עדיין.' })];

    return h('div', {},
      h('h2', { text: 'עריכת נושא' }),
      field('שם הנושא', textInput(topic, 'title', { onCommit: refreshTree })),
      field('אייקון (אימוג׳י, לתצוגה כשאין תמונה)', textInput(topic, 'icon', { onCommit: refreshTree })),
      field('תיאור קצר (לא חובה)', textArea(topic, 'description')),
      field('נתיב תמונה', textInput(topic, 'image', { ltr: true, placeholder: 'assets/topics/cardiology.jpg' }),
        'שימו את הקובץ בתיקייה assets/topics ורשמו כאן את הנתיב.'),
      field('נושא אב', parentSel),
      checkbox(topic, 'hidden', 'הסתר נושא (הוא וכל מה שבתוכו לא יוצגו באתר)'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => addTopic(topic.id), text: '+ תת־נושא' }),
        h('button', { class: 'btn btn-danger', type: 'button', onclick: () => deleteTopic(topic), text: 'מחיקת נושא' })),
      h('h2', { style: 'margin-top:28px', text: 'כלים בנושא' }),
      toolList,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => addTool(topic.id), text: '+ כלי חדש בנושא הזה' })));
  }

  function deleteTopic(topic) {
    if (childrenCount(topic.id)) {
      S.notice = { error: true, title: 'לא ניתן למחוק נושא שיש בו תתי־נושאים. העבירו או מחקו אותם קודם.' };
      return render();
    }
    const inside = toolsInTopic(topic.id);
    if (inside.length) {
      S.notice = { error: true, title: `בנושא ${inside.length === 1 ? 'יש כלי אחד' : `יש ${inside.length} כלים`}. העבירו ${inside.length === 1 ? 'אותו' : 'אותם'} לנושא אחר (בעריכת הכלי) או מחקו ${inside.length === 1 ? 'אותו' : 'אותם'} לפני מחיקת הנושא.` };
      return render();
    }
    if (!confirm(`למחוק את הנושא "${topic.title}"?`)) return;
    S.data.topics = S.data.topics.filter((t) => t.id !== topic.id);
    S.selTopic = topic.parentId || null; S.selTool = null;
    changed();
  }

  /* ---------- עריכת כלי ---------- */

  function addTool(topicId) {
    const t = {
      id: rid('tool'), title: '', description: '', updated: today(), hidden: false,
      topicIds: [topicId], links: [{ label: 'פתיחת הכלי', url: '' }], documents: [],
    };
    S.data.tools.push(t);
    const topic = topicById(topicId);
    topic.toolOrder = (topic.toolOrder || []).concat(t.id);
    S.selTool = t.id;
    changed();
  }

  function deleteTool(tool) {
    if (!confirm(`למחוק לצמיתות את הכלי "${tool.title || 'ללא שם'}"? אפשר גם רק להסתיר אותו.`)) return;
    S.data.tools = S.data.tools.filter((t) => t.id !== tool.id);
    S.data.topics.forEach((t) => { t.toolOrder = (t.toolOrder || []).filter((id) => id !== tool.id); });
    S.selTool = null;
    changed();
  }

  function linkRows(list, withNote) {
    const wrap = h('div', {});
    const draw = () => {
      wrap.replaceChildren();
      list.forEach((item, i) => {
        const test = h('a', { class: 'btn btn-ghost', href: item.url || '#', target: '_blank', rel: 'noopener noreferrer', text: 'בדיקה' });
        const url = textInput(item, 'url', { type: 'url', ltr: true, placeholder: 'https://' });
        url.addEventListener('input', () => { test.href = url.value || '#'; });
        wrap.append(h('div', { class: 'row-edit' + (withNote ? ' doc' : '') },
          textInput(item, 'label', { placeholder: withNote ? 'שם המסמך, למשל: מדריך למורה' : 'שם הפעולה, למשל: פתיחת הכלי' }),
          withNote ? textInput(item, 'note', { placeholder: 'הערה קצרה (לא חובה)' }) : null,
          url, test,
          h('button', { class: 'mini', type: 'button', 'aria-label': 'הסרה', onclick: () => { list.splice(i, 1); markDirty(); draw(); }, text: '✕' })));
      });
    };
    draw();
    return { wrap, draw };
  }

  function renderToolEditor(tool) {
    const links = linkRows(tool.links);
    const docs = linkRows(tool.documents, true);
    tool.documents = tool.documents || [];

    const picks = flatTopics().map(({ t, depth }) => {
      const on = (tool.topicIds || []).includes(t.id);
      const cb = h('input', { type: 'checkbox', checked: on });
      const prim = h('input', { type: 'radio', name: 'primary', checked: on && tool.topicIds[0] === t.id, disabled: !on || null });
      cb.addEventListener('change', () => {
        if (cb.checked) tool.topicIds.push(t.id);
        else tool.topicIds = tool.topicIds.filter((id) => id !== t.id);
        markDirty(); render();
      });
      prim.addEventListener('change', () => {
        tool.topicIds = [t.id].concat(tool.topicIds.filter((id) => id !== t.id));
        markDirty(); render();
      });
      return h('div', { class: 'topic-pick', style: `padding-inline-start:${depth * 20}px` },
        h('label', { class: 'name' }, cb, ' ', t.title),
        h('label', { class: 'prim' }, prim, ' מיקום ראשי'));
    });

    return h('div', {},
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { S.selTool = null; render(); }, text: '→ חזרה לנושא' }),
      h('h2', { style: 'margin-top:16px', text: 'עריכת כלי' }),
      field('שם הכלי', textInput(tool, 'title')),
      field('תיאור קצר', textArea(tool, 'description'), 'משפט עד שלושה.'),
      field('תאריך עדכון', textInput(tool, 'updated', { type: 'date' })),
      checkbox(tool, 'hidden', 'הסתר את הכלי מהספרייה'),
      h('div', { class: 'fieldset' },
        h('div', { class: 'legend', text: 'קישורים לכלי' }),
        h('p', { class: 'fld-label', text: 'הקישור הראשון הוא הראשי. אפשר להוסיף עוד קישורים לגרסאות או רכיבים.' }),
        links.wrap,
        h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => { tool.links.push({ label: '', url: '' }); links.draw(); }, text: '+ קישור' })),
      h('div', { class: 'fieldset' },
        h('div', { class: 'legend', text: 'מסמכים נלווים' }),
        docs.wrap,
        h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => { tool.documents.push({ label: '', note: '', url: '' }); docs.draw(); }, text: '+ מסמך' })),
      h('div', { class: 'fieldset' },
        h('div', { class: 'legend', text: 'שיוך לנושאים' }),
        picks),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-danger', type: 'button', onclick: () => deleteTool(tool), text: 'מחיקת כלי' })));
  }

  /* ---------- מסכים ---------- */

  function renderLogin(err) {
    const c = S.conn;
    const owner = h('input', { type: 'text', value: c.owner, class: 'ltr-in', autocomplete: 'off' });
    const repo = h('input', { type: 'text', value: c.repo, class: 'ltr-in', autocomplete: 'off' });
    const branch = h('input', { type: 'text', value: c.branch || 'main', class: 'ltr-in', autocomplete: 'off' });
    const token = h('input', { type: 'password', value: c.token, class: 'ltr-in', autocomplete: 'off' });
    const remember = h('input', { type: 'checkbox', checked: true });

    const form = h('form', { class: 'conn' },
      h('h1', { text: 'ניהול הספרייה' }),
      err ? h('div', { class: 'notice error', text: err }) : null,
      h('p', { text: 'כדי לערוך יש להתחבר פעם אחת עם טוקן GitHub אישי. הטוקן נשמר רק בדפדפן הזה ואינו מופיע באתר.' }),
      field('שם משתמש / ארגון ב-GitHub', owner),
      field('שם ה-repo', repo),
      field('ענף (branch)', branch),
      field('טוקן אישי', token, 'Fine-grained token עם הרשאת Contents: Read and write על ה-repo הזה בלבד.'),
      h('label', { class: 'chk' }, remember, h('span', { text: 'זכור אותי בדפדפן הזה' })),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary', type: 'submit', text: 'התחברות' }),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: startDemo, text: 'מצב הדגמה (בלי טוקן)' })),
      h('p', {}, h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener noreferrer', text: 'יצירת טוקן ב-GitHub' })));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      S.conn = { owner: owner.value.trim(), repo: repo.value.trim(), branch: branch.value.trim() || 'main', token: token.value.trim() };
      if (!S.conn.owner || !S.conn.repo || !S.conn.token) return renderLogin('יש למלא שם משתמש, שם repo וטוקן.');
      root.replaceChildren(h('p', { class: 'container page', text: 'מתחבר וטוען…' }));
      try {
        await loadData();
        store.set(remember.checked ? S.conn : { ...S.conn, token: '' });
        S.selTopic = (S.data.topics[0] || {}).id || null;
        render();
      } catch (ex) {
        renderLogin(ex.message);
      }
    });
    root.replaceChildren(form);
  }

  async function startDemo() {
    S.demo = true;
    try {
      await loadData();
      S.selTopic = (S.data.topics[0] || {}).id || null;
      S.notice = { title: 'מצב הדגמה: אפשר לערוך בחופשיות. שום דבר לא נשמר באתר.' };
      render();
    } catch {
      S.demo = false;
      renderLogin('לא ניתן לטעון את נתוני הדוגמה.');
    }
  }

  function render() {
    if (!S.data) return;
    if (S.selTopic && !topicById(S.selTopic)) S.selTopic = null;
    if (S.selTool && !toolById(S.selTool)) S.selTool = null;

    const status = h('span', {
      id: 'adm-status', class: 'adm-status' + (S.dirty ? ' dirty' : ''),
      text: S.busy ? 'מפרסם…' : S.dirty ? 'יש שינויים שלא פורסמו' : 'הכל מפורסם',
    });
    const bar = h('header', { class: 'adm-bar' },
      h('h1', { text: S.demo ? 'ניהול (מצב הדגמה)' : 'ניהול: חומרי לימוד במדעי בריאות' }),
      h('div', { class: 'adm-actions' },
        h('button', { class: 'btn btn-primary', type: 'button', disabled: S.busy || null, onclick: publish, text: 'פרסם שינויים' }),
        h('a', { class: 'btn btn-ghost', href: '../', target: '_blank', rel: 'noopener', text: 'צפייה באתר' }),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: exportBackup, text: 'ייצוא גיבוי' }),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: logout, text: 'התנתקות' })),
      status);

    let main;
    const tool = S.selTool && toolById(S.selTool);
    const topic = S.selTopic && topicById(S.selTopic);
    if (tool) main = renderToolEditor(tool);
    else if (topic) main = renderTopicEditor(topic);
    else main = h('div', {}, h('h2', { text: 'ברוכים הבאים' }), h('p', { text: 'בחרו נושא מהעץ כדי לערוך אותו ואת הכלים שבו, או הוסיפו נושא ראשי.' }));

    const notice = S.notice
      ? h('div', { class: 'notice' + (S.notice.error ? ' error' : '') },
        h('strong', { text: S.notice.title }),
        S.notice.items ? h('ul', {}, S.notice.items.map((x) => h('li', { text: x }))) : null)
      : null;

    const treeNode = renderTree();
    root.replaceChildren(bar, h('div', { class: 'adm-grid' }, treeNode, h('section', { class: 'adm-main', id: 'adm-main' }, notice, main)));
  }

  function refreshTree() {
    const old = root.querySelector('.adm-tree');
    if (old) old.replaceWith(renderTree());
  }

  function logout() {
    if (S.dirty && !confirm('יש שינויים שלא פורסמו. להתנתק בכל זאת?')) return;
    if (!S.demo) store.clear();
    S.data = null; S.dirty = false; S.conn.token = ''; S.demo = false; S.notice = null;
    renderLogin();
  }

  window.addEventListener('beforeunload', (e) => {
    if (S.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ---------- אתחול ---------- */

  async function init() {
    try {
      S.cfg = await fetch('../config.json', { cache: 'no-cache' }).then((r) => r.json());
    } catch { S.cfg = { repo: {} }; }
    if (new URLSearchParams(location.search).get('demo') === '1') return startDemo();
    const saved = store.get() || {};
    const repo = S.cfg.repo || {};
    S.conn = {
      owner: saved.owner || repo.owner || '',
      repo: saved.repo || repo.name || '',
      branch: saved.branch || repo.branch || 'main',
      token: saved.token || '',
    };
    if (S.conn.owner && S.conn.repo && S.conn.token) {
      try {
        await loadData();
        S.selTopic = (S.data.topics[0] || {}).id || null;
        return render();
      } catch (ex) { return renderLogin(ex.message); }
    }
    renderLogin();
  }

  init();
})();
