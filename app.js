/* Deal Terms Flashcards — spaced repetition, no build step, no server.
 * Progress lives in localStorage on each device; Settings → Export / Import moves it between devices.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Scheduling (pure functions; exposed on window.SRS for tests)
  // ---------------------------------------------------------------------------
  var MODES = ['recognize', 'recall', 'example'];
  var MODE_INFO = {
    recognize: { label: 'Term → definition', prompt: 'What does this mean?' },
    recall: { label: 'Definition → term', prompt: 'Name the term' },
    example: { label: 'Example → term', prompt: 'Which term does this example show?' }
  };
  var BOX_DAYS = [0, 1, 2, 4, 7, 14, 30]; // interval in days for boxes 0–6
  var MAX_BOX = 6;
  var RATINGS = ['again', 'hard', 'good', 'easy'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseISO(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(iso, n) { var d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); }
  function daysBetween(a, b) { return Math.round((parseISO(b) - parseISO(a)) / 86400000); }

  // Cap intervals so every card comes back at least once before the target date.
  function capInterval(days, today, interviewDate) {
    if (!interviewDate) return days;
    var left = daysBetween(today, interviewDate);
    if (left <= 1) return days; // target date is tomorrow or past: normal spacing
    return Math.max(1, Math.min(days, left - 1));
  }

  function rate(state, rating, today, interviewDate) {
    var s = state ? Object.assign({}, state) : { box: 0, reviews: 0, lapses: 0 };
    var box = s.box || 0;
    if (rating === 'again') { box = 1; s.due = today; s.lapses = (s.lapses || 0) + 1; }
    else if (rating === 'hard') { box = Math.max(1, box); s.due = addDays(today, 1); }
    else if (rating === 'good') { box = Math.min(MAX_BOX, box + 1); s.due = addDays(today, capInterval(BOX_DAYS[box], today, interviewDate)); }
    else if (rating === 'easy') { box = Math.min(MAX_BOX, box + 2); s.due = addDays(today, capInterval(BOX_DAYS[box], today, interviewDate)); }
    else throw new Error('bad rating ' + rating);
    s.box = box;
    s.reviews = (s.reviews || 0) + 1;
    s.last = Date.now();
    return s;
  }

  function previewLabel(state, rating, today, interviewDate) {
    if (rating === 'again') return 'now';
    var n = daysBetween(today, rate(state, rating, today, interviewDate).due);
    return n + 'd';
  }

  function itemKey(cardId, mode) { return cardId + '|' + mode; }

  // Items available to study under the current settings, in introduction order.
  function eligibleItems(cards, settings) {
    var out = [];
    cards.forEach(function (c) {
      if (settings.tiers.indexOf(c.tier) < 0) return;
      if (settings.topics.length && settings.topics.indexOf(c.topic) < 0) return;
      MODES.forEach(function (m) {
        if (!settings.modes[m]) return;
        if (m === 'example' && !c.exampleMasked) return;
        out.push({ key: itemKey(c.id, m), card: c, mode: m });
      });
    });
    return out;
  }

  // Harder modes unlock once you've seen the card a couple of times in term → definition.
  function unlocked(item, items, settings) {
    if (item.mode === 'recognize' || !settings.modes.recognize) return true;
    var base = items[itemKey(item.card.id, 'recognize')];
    return !!(base && base.box >= 2);
  }

  function buildQueue(cards, progress, settings, today, extraNew) {
    var all = eligibleItems(cards, settings);
    var due = [], fresh = [];
    all.forEach(function (it) {
      var st = progress.items[it.key];
      if (st) { if (st.due <= today) due.push(it); }
      else if (unlocked(it, progress.items, settings)) fresh.push(it);
    });
    due.sort(function (a, b) { return progress.items[a.key].due < progress.items[b.key].due ? -1 : 1; });
    var used = progress.daily.date === today ? progress.daily.newCount : 0;
    var allowance = Math.max(0, settings.newPerDay + (extraNew || 0) - used);
    fresh = fresh.slice(0, allowance);
    // Interleave: one new item after every 3 reviews.
    var q = [], i = 0, j = 0;
    while (i < due.length || j < fresh.length) {
      for (var k = 0; k < 3 && i < due.length; k++) q.push(due[i++]);
      if (j < fresh.length) q.push(fresh[j++]);
    }
    return { queue: q, dueCount: due.length, newCount: fresh.length };
  }

  // Merge two progress snapshots: for each item keep the most recently reviewed state.
  function mergeProgress(a, b) {
    var out = JSON.parse(JSON.stringify(a));
    Object.keys(b.items || {}).forEach(function (k) {
      var x = out.items[k], y = b.items[k];
      if (!x || (y.last || 0) > (x.last || 0)) out.items[k] = y;
    });
    Object.keys(b.reviewLog || {}).forEach(function (d) {
      out.reviewLog[d] = Math.max(out.reviewLog[d] || 0, b.reviewLog[d]);
    });
    return out;
  }

  window.SRS = { rate: rate, capInterval: capInterval, buildQueue: buildQueue, mergeProgress: mergeProgress,
    eligibleItems: eligibleItems, addDays: addDays, daysBetween: daysBetween, BOX_DAYS: BOX_DAYS };

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------
  var STORE_KEY = 'dealterms.v1';
  var memoryStore = null; // fallback when localStorage is unavailable (e.g. some private modes)

  function defaultData(interviewDate) {
    return {
      settings: { interviewDate: interviewDate || '', newPerDay: 15, modes: { recognize: true, recall: true, example: true },
        tiers: [1, 2, 3], topics: [] },
      progress: { items: {}, daily: { date: '', newCount: 0 }, reviewLog: {} }
    };
  }
  function load(interviewDate) {
    var raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { raw = memoryStore; }
    var d = defaultData(interviewDate);
    if (!raw) return d;
    try {
      var p = JSON.parse(raw);
      d.settings = Object.assign(d.settings, p.settings || {});
      d.settings.modes = Object.assign({ recognize: true, recall: true, example: true }, (p.settings || {}).modes || {});
      d.progress = Object.assign(d.progress, p.progress || {});
      d.progress.reviewLog = d.progress.reviewLog || {};
    } catch (e) { /* corrupted: start fresh */ }
    return d;
  }
  function save() {
    var raw = JSON.stringify(data);
    try { localStorage.setItem(STORE_KEY, raw); } catch (e) { memoryStore = raw; }
  }

  // ---------------------------------------------------------------------------
  // App state
  // ---------------------------------------------------------------------------
  var deck = null, data = null, app = document.getElementById('app');
  var session = null; // { queue, idx, flipped, done, startTotal, history: [] }
  var extraNewToday = 0;
  var openRows = {};
  var browse = { q: '', tier: 0, topic: '' };

  function today() { return toISO(new Date()); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function md(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').replace(/_{3,}/g, '<span class="blank">_____</span>'); }
  var TOPIC_ORDER = ['Fundamentals', 'Bonds', 'Covenants', 'Loans', 'Liability management', 'M&A', 'EDGAR', 'Data platform'];
  function topics() {
    var t = []; deck.cards.forEach(function (c) { if (t.indexOf(c.topic) < 0) t.push(c.topic); });
    return t.sort(function (a, b) { var i = TOPIC_ORDER.indexOf(a), j = TOPIC_ORDER.indexOf(b); return (i < 0 ? 99 : i) - (j < 0 ? 99 : j); });
  }
  function toast(msg) {
    var el = document.createElement('div'); el.className = 'toast'; el.textContent = msg; document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2200);
  }

  // ---------------------------------------------------------------------------
  // Routing
  // ---------------------------------------------------------------------------
  var VIEWS = ['study', 'browse', 'settings'];
  function currentView() { var h = location.hash.slice(1); return VIEWS.indexOf(h) >= 0 ? h : 'study'; }
  function render() {
    var v = currentView();
    document.querySelectorAll('[data-nav]').forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-nav') === v); });
    document.body.classList.toggle('reviewing', v === 'study' && !!session);
    if (v === 'study') { if (session) renderReview(); else renderHome(); }
    else if (v === 'browse') renderBrowse();
    else renderSettings();
  }
  window.addEventListener('hashchange', function () { render(); window.scrollTo(0, 0); });

  // ---------------------------------------------------------------------------
  // Home
  // ---------------------------------------------------------------------------
  function mastery(filterFn) {
    var items = SRS.eligibleItems(deck.cards, Object.assign({}, data.settings, { tiers: [1, 2, 3], topics: [] })).filter(filterFn);
    if (!items.length) return 0;
    var m = items.filter(function (it) { var s = data.progress.items[it.key]; return s && s.box >= 3; }).length;
    return Math.round(100 * m / items.length);
  }
  function streak() {
    var n = 0, d = today(), log = data.progress.reviewLog;
    if (!log[d]) d = addDays(d, -1);
    while (log[d]) { n++; d = addDays(d, -1); }
    return n;
  }

  function renderHome() {
    var t = today(), q = SRS.buildQueue(deck.cards, data.progress, data.settings, t, extraNewToday);
    var iv = data.settings.interviewDate, left = iv ? daysBetween(t, iv) : null;
    var count = left == null ? '' : left > 1 ? left + ' days' : left === 1 ? '1 day' : left === 0 ? 'Today' : 'Done';
    var h = '<section class="panel hero">';
    if (iv) h += '<div class="countdown">' + count + '</div><div class="muted">' + (left > 0 ? 'until your target date (' + esc(parseISO(iv).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) + ')' : 'Target date reached. Good luck!') + '</div>';
    h += '<div class="stats"><div class="stat"><b>' + q.dueCount + '</b><span>due</span></div><div class="stat"><b>' + q.newCount + '</b><span>new today</span></div><div class="stat"><b>' + streak() + '</b><span>day streak</span></div></div>';
    if (q.queue.length) h += '<button class="btn block" data-act="start" style="margin-top:12px">Start review (' + q.queue.length + ')</button>';
    else h += '<p class="muted" style="margin:14px 0 6px">All caught up for today.</p><button class="btn ghost block" data-act="more">Learn 10 more new cards</button>';
    h += '</section>';
    h += '<section class="panel"><h2>Mastery</h2><p class="note" style="margin-top:-4px">Share of card faces you\'ve reached box 3+ on (reviewed well several times).</p>';
    [1, 2, 3].forEach(function (tier) {
      var p = mastery(function (it) { return it.card.tier === tier; });
      h += '<div class="meter"><div class="lbl"><span>Tier ' + tier + (tier === 1 ? ' · must know' : tier === 2 ? ' · should know' : ' · nice to know') + '</span><span>' + p + '%</span></div><div class="bar"><i style="width:' + p + '%"></i></div></div>';
    });
    h += '</section><section class="panel"><h2>By topic</h2>';
    topics().forEach(function (tp) {
      var p = mastery(function (it) { return it.card.topic === tp; });
      h += '<div class="meter"><div class="lbl"><span>' + esc(tp) + '</span><span>' + p + '%</span></div><div class="bar"><i style="width:' + p + '%"></i></div></div>';
    });
    h += '</section>';
    app.innerHTML = h;
  }

  // ---------------------------------------------------------------------------
  // Review
  // ---------------------------------------------------------------------------
  function startSession() {
    var q = SRS.buildQueue(deck.cards, data.progress, data.settings, today(), extraNewToday);
    session = { queue: q.queue.slice(), idx: 0, flipped: false, startTotal: q.queue.length, reviewed: 0, history: [] };
    render();
  }
  function endSession() { session = null; render(); }

  function currentItem() { return session && session.queue[session.idx]; }

  function renderReview() {
    var it = currentItem();
    if (!it) {
      app.innerHTML = '<section class="panel done-box"><div class="big">✓</div><h2>Session complete</h2><p class="muted">' + session.reviewed + ' reviews done.</p><button class="btn block" data-act="finish">Back to dashboard</button></section>';
      return;
    }
    var c = it.card, flipped = session.flipped, st = data.progress.items[it.key];
    var pct = Math.round(100 * session.idx / Math.max(1, session.queue.length));
    var h = '<div class="review"><div class="review-top"><button class="iconbtn" data-act="exit" aria-label="Exit review">✕</button>' +
      '<div class="bar"><i style="width:' + pct + '%"></i></div><span>' + (session.idx + 1) + ' / ' + session.queue.length + '</span>' +
      '<button class="iconbtn" data-act="undo" ' + (session.history.length ? '' : 'disabled') + ' aria-label="Undo last rating">Undo</button></div>';
    h += '<div class="stage"><div class="card" id="card" role="button" tabindex="0" aria-label="' + (flipped ? 'Card answer' : 'Card. Tap to flip') + '">';
    h += '<div class="swipe-label" id="swipeLabel"></div>';
    h += '<div class="tags"><span class="chip">Tier ' + c.tier + '</span><span class="chip">' + esc(c.topic) + '</span><span class="chip">' + (st ? 'Box ' + st.box : 'New') + '</span></div>';
    h += '<div class="prompt">' + esc(MODE_INFO[it.mode].prompt) + '</div><div class="content" id="cardContent"><div class="inner">';
    if (!flipped) {
      if (it.mode === 'recognize') h += '<div class="front-term">' + esc(c.term) + '</div>';
      else if (it.mode === 'recall') h += '<div class="front-text">' + md(c.definitionMasked) + '</div>';
      else h += '<div class="front-text">' + md(c.exampleMasked) + '</div>';
    } else {
      if (it.mode === 'recognize') {
        h += '<div class="answer-term">' + esc(c.term) + '</div>';
      } else {
        h += '<div class="front-text muted" style="font-size:.95em;margin-bottom:6px">' + md(it.mode === 'recall' ? c.definitionMasked : c.exampleMasked) + '</div><div class="divider"></div>';
        h += '<div class="answer-term">' + esc(c.term) + '</div>';
      }
      if (it.mode !== 'recall') h += '<p class="def">' + md(c.definition) + '</p>';
      if (c.example && it.mode !== 'example') h += '<p class="ex">' + md(c.example) + '</p>';
      if (c.why) h += '<p class="why"><b>Why it matters:</b> ' + md(c.why) + '</p>';
    }
    h += '</div></div>';
    if (!flipped) h += '<div class="hint">Tap card or press Space to reveal</div>';
    h += '</div></div>';
    if (!flipped) {
      h += '<button class="btn block flipbtn" data-act="flip">Show answer</button>';
    } else {
      var t = today(), iv = data.settings.interviewDate;
      h += '<div class="ratings">' + RATINGS.map(function (r, i) {
        var arrow = { again: '←', hard: '↓', good: '→', easy: '↑' }[r];
        return '<button class="rate ' + r + '" data-act="rate" data-r="' + r + '">' + arrow + ' ' + r.charAt(0).toUpperCase() + r.slice(1) +
          '<small>' + previewLabel(st, r, t, iv) + '</small></button>';
      }).join('') + '</div>';
      h += '<div class="legend">Swipe the card or use arrow keys: ← Again · ↓ Hard · → Good · ↑ Easy</div>';
    }
    h += '</div>';
    app.innerHTML = h;
    fitCard();
    attachSwipe(document.getElementById('card'));
  }

  // Shrink card text until it fits, so long answers never need scrolling inside the card.
  function fitCard() {
    var card = document.getElementById('card'), content = document.getElementById('cardContent');
    if (!card || !content) return;
    var size = window.innerWidth >= 700 ? 18 : 17;
    card.style.fontSize = size + 'px';
    var guard = 0;
    card.classList.remove('scrolly');
    while (content.scrollHeight > content.clientHeight + 1 && size > 12 && guard++ < 20) {
      size -= 0.5; card.style.fontSize = size + 'px';
    }
    // Last resort on very small screens: let the text scroll (buttons still rate; vertical swipes become scrolling).
    if (content.scrollHeight > content.clientHeight + 1) card.classList.add('scrolly');
  }
  window.addEventListener('resize', function () { if (session) fitCard(); });

  function flip() { if (!session || session.flipped || !currentItem()) return; session.flipped = true; renderReview(); }

  function applyRating(r) {
    var it = currentItem();
    if (!it || !session.flipped) return;
    var t = today(), prev = data.progress.items[it.key];
    session.history.push({ key: it.key, prev: prev ? Object.assign({}, prev) : null, queue: session.queue.slice(), idx: session.idx,
      daily: Object.assign({}, data.progress.daily), log: data.progress.reviewLog[t] || 0, reviewed: session.reviewed });
    if (!prev) { // first time seeing this face counts against today's new allowance
      if (data.progress.daily.date !== t) data.progress.daily = { date: t, newCount: 0 };
      data.progress.daily.newCount++;
    }
    data.progress.items[it.key] = SRS.rate(prev, r, t, data.settings.interviewDate);
    data.progress.reviewLog[t] = (data.progress.reviewLog[t] || 0) + 1;
    session.reviewed++;
    if (r === 'again') { // see it again in a few cards
      var pos = Math.min(session.queue.length, session.idx + 4);
      session.queue.splice(pos, 0, it);
    }
    session.idx++;
    session.flipped = false;
    save();
    renderReview();
  }

  function undo() {
    if (!session || !session.history.length) return;
    var h = session.history.pop();
    if (h.prev) data.progress.items[h.key] = h.prev; else delete data.progress.items[h.key];
    data.progress.daily = h.daily;
    var t = today();
    if (h.log) data.progress.reviewLog[t] = h.log; else delete data.progress.reviewLog[t];
    session.queue = h.queue; session.idx = h.idx; session.reviewed = h.reviewed; session.flipped = true;
    save(); renderReview();
  }

  // Swipe: same four directions as the arrow keys. A short tap flips the card.
  function attachSwipe(card) {
    if (!card) return;
    var sx = 0, sy = 0, dx = 0, dy = 0, active = false, id = null;
    var label = document.getElementById('swipeLabel');
    var COLORS = { again: 'var(--again)', hard: 'var(--hard)', good: 'var(--good)', easy: 'var(--easy)' };
    function dirOf(x, y) {
      if (Math.max(Math.abs(x), Math.abs(y)) < 70) return null;
      if (Math.abs(x) >= Math.abs(y)) return x > 0 ? 'good' : 'again';
      return y < 0 ? 'easy' : 'hard';
    }
    card.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      active = true; id = e.pointerId; sx = e.clientX; sy = e.clientY; dx = dy = 0;
      try { card.setPointerCapture(id); } catch (_) {}
    });
    card.addEventListener('pointermove', function (e) {
      if (!active || e.pointerId !== id) return;
      dx = e.clientX - sx; dy = e.clientY - sy;
      if (!session.flipped) return; // only drag once the answer is showing
      card.classList.add('dragging');
      card.style.transform = 'translate(' + dx + 'px,' + dy + 'px) rotate(' + (dx / 25) + 'deg)';
      var d = dirOf(dx, dy);
      if (label) {
        label.style.opacity = d ? 1 : 0;
        if (d) { label.textContent = d.charAt(0).toUpperCase() + d.slice(1); label.style.background = COLORS[d]; }
      }
    });
    function finish(e) {
      if (!active || e.pointerId !== id) return;
      active = false;
      card.classList.remove('dragging');
      var moved = Math.max(Math.abs(dx), Math.abs(dy));
      if (!session.flipped) { if (moved < 10) flip(); return; }
      var d = dirOf(dx, dy);
      if (d) { applyRating(d); return; }
      card.style.transform = '';
      if (label) label.style.opacity = 0;
    }
    card.addEventListener('pointerup', finish);
    card.addEventListener('pointercancel', function (e) { dx = dy = 0; finish(e); });
  }

  document.addEventListener('keydown', function (e) {
    if (!session || currentView() !== 'study') return;
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (tag === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return; // let focused buttons work normally
    var map = { ArrowLeft: 'again', ArrowDown: 'hard', ArrowRight: 'good', ArrowUp: 'easy', '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' };
    if (!currentItem()) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); endSession(); } return; }
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!session.flipped) flip(); return; }
    if (map[e.key]) { e.preventDefault(); if (session.flipped) applyRating(map[e.key]); return; }
    if (e.key === 'Escape') { e.preventDefault(); endSession(); return; }
    if ((e.key === 'z' || e.key === 'u') && session.history.length) { e.preventDefault(); undo(); }
  });

  // ---------------------------------------------------------------------------
  // Browse
  // ---------------------------------------------------------------------------
  function cardLevel(c) {
    var best = -1;
    MODES.forEach(function (m) { var s = data.progress.items[itemKey(c.id, m)]; if (s && s.box > best) best = s.box; });
    return best < 0 ? 'New' : 'Box ' + best;
  }
  function renderBrowse() {
    var h = '<input class="search" id="q" type="search" placeholder="Search ' + deck.cards.length + ' terms…" value="' + esc(browse.q) + '" autocomplete="off">';
    h += '<div class="filters">' + [0, 1, 2, 3].map(function (t) {
      return '<button class="toggle' + (browse.tier === t ? ' on' : '') + '" data-act="btier" data-t="' + t + '">' + (t ? 'Tier ' + t : 'All tiers') + '</button>';
    }).join('') + '</div><div class="filters">' + [''].concat(topics()).map(function (tp) {
      return '<button class="toggle' + (browse.topic === tp ? ' on' : '') + '" data-act="btopic" data-t="' + esc(tp) + '">' + (tp ? esc(tp) : 'All topics') + '</button>';
    }).join('') + '</div><div class="list" id="list"></div>';
    app.innerHTML = h;
    renderList();
    document.getElementById('q').addEventListener('input', function (e) { browse.q = e.target.value; renderList(); });
  }
  function renderList() {
    var q = browse.q.trim().toLowerCase();
    var rows = deck.cards.filter(function (c) {
      if (browse.tier && c.tier !== browse.tier) return false;
      if (browse.topic && c.topic !== browse.topic) return false;
      return !q || (c.term + ' ' + c.definition).toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) { return a.term.localeCompare(b.term); });
    var el = document.getElementById('list');
    if (!rows.length) { el.innerHTML = '<p class="muted center">No matching terms.</p>'; return; }
    el.innerHTML = rows.map(function (c) {
      var open = openRows[c.id];
      var body = open ? '<div class="body"><p>' + md(c.definition) + '</p>' + (c.example ? '<p class="muted"><i>Example: ' + md(c.example) + '</i></p>' : '') +
        (c.why ? '<p><b>Why it matters:</b> ' + md(c.why) + '</p>' : '') + '<p class="muted" style="font-size:13px">Tier ' + c.tier + ' · ' + esc(c.topic) + ' · Study guide §' + c.section + '</p></div>' : '';
      return '<div class="row"><button data-act="row" data-id="' + esc(c.id) + '" aria-expanded="' + !!open + '"><span class="t">' + esc(c.term) + '</span><span class="lvl">' + cardLevel(c) + ' ' + (open ? '▴' : '▾') + '</span></button>' + body + '</div>';
    }).join('');
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  var confirmReset = false;
  function renderSettings() {
    var s = data.settings;
    var h = '<section class="panel"><h2>Study</h2>';
    h += '<div class="field"><label for="iv">Target date (interview, exam…)</label><input type="date" id="iv" value="' + esc(s.interviewDate) + '"></div>';
    h += '<div class="field"><label for="npd">New cards per day</label><input type="number" id="npd" min="0" max="200" value="' + s.newPerDay + '"></div>';
    h += '<div class="field"><label>Study modes</label>' + MODES.map(function (m) {
      return '<label class="check"><input type="checkbox" data-mode="' + m + '"' + (s.modes[m] ? ' checked' : '') + '> ' + MODE_INFO[m].label + '</label>';
    }).join('') + '<p class="note">Definition → term and example → term unlock for a card after you\'ve rated it Good twice in term → definition.</p></div>';
    h += '<div class="field"><label>Tiers to study</label><div class="filters" style="margin:4px 0 0">' + [1, 2, 3].map(function (t) {
      return '<button class="toggle' + (s.tiers.indexOf(t) >= 0 ? ' on' : '') + '" data-act="stier" data-t="' + t + '">Tier ' + t + '</button>';
    }).join('') + '</div></div>';
    h += '<div class="field"><label>Topics to study (none selected = all)</label><div class="filters" style="margin:4px 0 0">' + topics().map(function (tp) {
      return '<button class="toggle' + (s.topics.indexOf(tp) >= 0 ? ' on' : '') + '" data-act="stopic" data-t="' + esc(tp) + '">' + esc(tp) + '</button>';
    }).join('') + '</div></div></section>';

    h += '<section class="panel"><h2>Move progress between devices</h2><p class="note">Progress is saved in this browser only. To continue on another device, export here and import there. Importing merges: for each card, the most recent review wins.</p>';
    h += '<div class="btn-row"><button class="btn ghost" data-act="export">Show export code</button><button class="btn ghost" data-act="download">Download file</button></div>';
    h += '<div id="exportBox" class="hidden" style="margin-top:10px"><textarea class="io" id="exportText" readonly></textarea><div class="btn-row"><button class="btn ghost" data-act="copy">Copy</button></div></div>';
    h += '<div class="field" style="margin-top:16px"><label for="importText">Import: paste a code or choose a file</label><textarea class="io" id="importText" placeholder="Paste export code here"></textarea>' +
      '<div class="btn-row"><button class="btn ghost" data-act="import">Import pasted code</button><label class="btn ghost" style="cursor:pointer">Choose file<input type="file" id="importFile" accept=".json,application/json,text/plain" class="hidden"></label></div></div></section>';
    h += '<section class="panel"><h2>Reset</h2><p class="note">Clears all review history on this device. Settings are kept.</p><button class="btn ghost" data-act="reset">' + (confirmReset ? 'Tap again to confirm reset' : 'Reset progress') + '</button></section>';
    h += '<p class="note center">' + deck.cards.length + ' cards · Keyboard: Space flip · ← Again · ↓ Hard · → Good · ↑ Easy · Z undo · Esc exit</p>';
    app.innerHTML = h;

    document.getElementById('iv').addEventListener('change', function (e) { s.interviewDate = e.target.value; save(); });
    document.getElementById('npd').addEventListener('change', function (e) {
      var n = parseInt(e.target.value, 10); s.newPerDay = isNaN(n) ? 15 : Math.max(0, Math.min(200, n)); e.target.value = s.newPerDay; save();
    });
    app.querySelectorAll('[data-mode]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        s.modes[cb.getAttribute('data-mode')] = cb.checked;
        if (!s.modes.recognize && !s.modes.recall && !s.modes.example) { s.modes.recognize = true; toast('At least one mode must stay on'); renderSettings(); }
        save();
      });
    });
    document.getElementById('importFile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      var r = new FileReader(); r.onload = function () { doImport(String(r.result)); }; r.readAsText(f);
    });
  }

  function exportPayload() {
    return JSON.stringify({ app: 'deal-terms-flashcards', version: 1, exportedAt: new Date().toISOString(), progress: data.progress, settings: data.settings });
  }
  function doImport(text) {
    var p;
    try { p = JSON.parse(text.trim()); } catch (e) { toast('That doesn\'t look like an export code'); return; }
    if (!p || p.app !== 'deal-terms-flashcards' || !p.progress || !p.progress.items) { toast('That doesn\'t look like an export code'); return; }
    var before = Object.keys(data.progress.items).length;
    data.progress = SRS.mergeProgress(data.progress, Object.assign({ reviewLog: {} }, p.progress));
    save();
    toast('Imported. ' + (Object.keys(data.progress.items).length - before) + ' new card faces, others merged.');
    var ta = document.getElementById('importText'); if (ta) ta.value = '';
  }

  // ---------------------------------------------------------------------------
  // Clicks
  // ---------------------------------------------------------------------------
  // Touch taps fire on finger-up, so a quick tap right after a swipe is never lost to the
  // browser's double-tap detection. Mouse and keyboard use the normal click event.
  var touchDown = null, suppressClickUntil = 0;
  app.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse') { touchDown = null; return; }
    var el = e.target.closest('[data-act]');
    touchDown = el ? { el: el, x: e.clientX, y: e.clientY } : null;
  });
  app.addEventListener('pointerup', function (e) {
    var d = touchDown; touchDown = null;
    if (!d || e.pointerType === 'mouse') return;
    var el = e.target.closest('[data-act]');
    if (el !== d.el || Math.abs(e.clientX - d.x) > 12 || Math.abs(e.clientY - d.y) > 12) return;
    suppressClickUntil = Date.now() + 700;
    handleAct(el);
  });
  app.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]'); if (!el) return;
    if (Date.now() < suppressClickUntil) return;
    handleAct(el);
  });

  function handleAct(el) {
    var a = el.getAttribute('data-act');
    if (a === 'start') startSession();
    else if (a === 'more') { extraNewToday += 10; renderHome(); }
    else if (a === 'flip') flip();
    else if (a === 'rate') applyRating(el.getAttribute('data-r'));
    else if (a === 'undo') undo();
    else if (a === 'exit' || a === 'finish') endSession();
    else if (a === 'btier') { browse.tier = +el.getAttribute('data-t'); renderBrowse(); }
    else if (a === 'btopic') { browse.topic = el.getAttribute('data-t'); renderBrowse(); }
    else if (a === 'row') { var id = el.getAttribute('data-id'); openRows[id] = !openRows[id]; renderList(); }
    else if (a === 'stier') {
      var t = +el.getAttribute('data-t'), ts = data.settings.tiers, i = ts.indexOf(t);
      if (i >= 0) { if (ts.length > 1) ts.splice(i, 1); else toast('At least one tier must stay on'); } else ts.push(t);
      save(); renderSettings();
    }
    else if (a === 'stopic') {
      var tp = el.getAttribute('data-t'), tps = data.settings.topics, j = tps.indexOf(tp);
      if (j >= 0) tps.splice(j, 1); else tps.push(tp);
      save(); renderSettings();
    }
    else if (a === 'export') {
      document.getElementById('exportBox').classList.remove('hidden');
      document.getElementById('exportText').value = exportPayload();
    }
    else if (a === 'copy') {
      var txt = document.getElementById('exportText');
      var done = function () { toast('Copied'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt.value).then(done, function () { txt.select(); toast('Select all and copy'); });
      else { txt.select(); try { document.execCommand('copy'); done(); } catch (_) { toast('Select all and copy'); } }
    }
    else if (a === 'download') {
      var blob = new Blob([exportPayload()], { type: 'application/json' });
      var link = document.createElement('a');
      link.href = URL.createObjectURL(blob); link.download = 'deal-terms-progress-' + today() + '.json';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
    }
    else if (a === 'import') doImport(document.getElementById('importText').value);
    else if (a === 'reset') {
      if (!confirmReset) { confirmReset = true; renderSettings(); setTimeout(function () { confirmReset = false; }, 4000); return; }
      confirmReset = false;
      data.progress = { items: {}, daily: { date: '', newCount: 0 }, reviewLog: {} };
      save(); toast('Progress reset'); renderSettings();
    }
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  fetch('data/cards.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (d) {
      deck = d;
      data = load(d.interviewDate);
      if (!data.settings.interviewDate) data.settings.interviewDate = d.interviewDate || '';
      render();
    })
    .catch(function (err) {
      app.innerHTML = '<section class="panel"><h2>Couldn\'t load the cards</h2><p class="note">' + esc(err.message) +
        '. If you opened index.html directly from your computer, serve the folder instead (see README) or use the GitHub Pages link.</p></section>';
    });
})();
