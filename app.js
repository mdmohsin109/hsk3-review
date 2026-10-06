/* HSK 3 · Word Review — reader logic
 * Data comes from data.js: VOCAB (surface -> [{pinyin, meaning}]) and
 * STORIES ({beginner:[...], intermediate:[...]}), where each story holds
 * paragraphs of [surface, clickable, pinyin] tokens. */
(function () {
  'use strict';

  var LEVELS = ['beginner', 'intermediate'];
  var LEVEL_LABEL = { beginner: 'Beginner', intermediate: 'Intermediate' };
  var HOVER = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ------------------------------------------------------------- state */

  var state = {
    index: 0,
    pinyin: false,
    english: false,
    mark: true,
    size: 20,
    theme: 'light'
  };

  var PREFS = 'hsk3.prefs.v1';
  try {
    var saved = JSON.parse(localStorage.getItem(PREFS) || '{}');
    for (var k in saved) { if (k in state) state[k] = saved[k]; }
  } catch (e) { /* ignore corrupt prefs */ }

  function savePrefs() {
    try { localStorage.setItem(PREFS, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  /* Flat story list, in display order. */
  var FLAT = [];
  LEVELS.forEach(function (level) {
    (STORIES[level] || []).forEach(function (s) { FLAT.push(s); });
  });

  var el = {
    nav:      document.getElementById('nav'),
    story:    document.getElementById('story'),
    text:     null,
    tip:      document.getElementById('tip'),
    tipHanzi: document.getElementById('tip-hanzi'),
    tipPy:    document.getElementById('tip-py'),
    tipSenses:document.getElementById('tip-senses'),
    tipClose: document.getElementById('tip-close'),
    mark:     document.getElementById('t-mark'),
    pinyin:   document.getElementById('t-pinyin'),
    english:  document.getElementById('t-english'),
    theme:    document.getElementById('t-theme'),
    fsDec:    document.getElementById('fs-dec'),
    fsInc:    document.getElementById('fs-inc'),
    topbar:   document.querySelector('.topbar')
  };

  /* ------------------------------------------------------------- helpers */

  function h(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* A word (or plain run) with optional pinyin above it via <ruby>. */
  function tokenNode(tok) {
    var surface = tok[0], clickable = tok[1], py = tok[2];
    var node;
    if (py && state.pinyin) {
      node = h('ruby', clickable ? 'w' : 'plain');
      node.appendChild(document.createTextNode(surface));
      node.appendChild(h('rt', null, py));
    } else {
      node = h('span', clickable ? 'w' : 'plain', surface);
    }
    if (clickable) {
      node.dataset.word = surface;
      node.dataset.py = py || '';
      node.setAttribute('tabindex', '-1');
    }
    return node;
  }

  /* --------------------------------------------------------------- nav */

  function renderNav() {
    el.nav.textContent = '';
    var i = 0;
    LEVELS.forEach(function (level) {
      var group = h('div', 'navgroup');
      group.appendChild(h('h3', 'navgroup-title', LEVEL_LABEL[level]));
      (STORIES[level] || []).forEach(function (s) {
        (function (idx) {
          var btn = h('button', 'navitem');
          btn.type = 'button';
          btn.dataset.level = level;
          btn.dataset.i = String(idx);
          var top = h('div', 'navitem-top');
          top.appendChild(h('span', 'navitem-dot'));
          top.appendChild(h('span', 'navitem-title', s.title));
          btn.appendChild(top);
          var chars = countChars(s);
          btn.appendChild(h('span', 'navitem-sub', LEVEL_LABEL[level] + ' · ' + chars + ' characters'));
          btn.addEventListener('click', function () { go(idx); });
          group.appendChild(btn);
        })(i++);
      });
      el.nav.appendChild(group);
    });
    markActive();
  }

  function countChars(story) {
    var n = 0;
    story.paragraphs.forEach(function (p) {
      p.tokens.forEach(function (t) { n += /[\u4e00-\u9fff]/.test(t[0]) ? t[0].length : 0; });
    });
    return n;
  }

  function markActive() {
    var items = el.nav.querySelectorAll('.navitem');
    for (var i = 0; i < items.length; i++) {
      var on = Number(items[i].dataset.i) === state.index;
      items[i].classList.toggle('is-active', on);
      if (on) items[i].setAttribute('aria-current', 'true');
      else items[i].removeAttribute('aria-current');
    }
  }

  /* ------------------------------------------------------------- story */

  function render() {
    var s = FLAT[state.index];
    el.story.textContent = '';

    var head = h('header', 'story-head');
    head.appendChild(h('span', 'chip', LEVEL_LABEL[s.level]));
    head.querySelector('.chip').dataset.level = s.level;
    head.appendChild(h('h2', null, s.title));
    head.appendChild(h('p', 'story-meta',
      countChars(s) + ' characters · ' + countWords(s) + ' HSK 3 words'));

    var text = h('div', 'text');
    if (state.mark) text.classList.add('is-marked');
    if (state.english) text.classList.add('is-en');
    s.paragraphs.forEach(function (para) {
      var block = h('div', 'para');
      var zh = h('p', 'zh');
      para.tokens.forEach(function (tok) { zh.appendChild(tokenNode(tok)); });
      block.appendChild(zh);
      block.appendChild(h('p', 'en', para.english));
      text.appendChild(block);
    });

    var hint = h('p', 'hint', HOVER
      ? 'Hover a highlighted word for a quick look, click to keep it open.'
      : 'Tap any highlighted word to see its pinyin and English meaning.');

    el.story.appendChild(head);
    el.story.appendChild(text);
    el.story.appendChild(hint);
    el.text = text;

    markActive();
    hideTip();
  }

  function countWords(story) {
    var n = 0;
    story.paragraphs.forEach(function (p) {
      p.tokens.forEach(function (t) { if (t[1]) n++; });
    });
    return n;
  }

  function go(i) {
    state.index = i;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ------------------------------------------------------------ tooltip */

  var active = null;   // word element currently described
  var pinned = false;
  var hideTimer = null;

  function sensesFor(word) {
    var list = VOCAB[word] || [];
    return list.map(function (e) {
      return { pinyin: e.pinyin, meaning: e.meaning };
    });
  }

  function showTip(wordEl) {
    var word = wordEl.dataset.word;
    var senses = sensesFor(word);
    var ctx = (wordEl.dataset.py || '').trim();

    if (active && active !== wordEl) active.classList.remove('is-open');
    active = wordEl;
    clearTimeout(hideTimer);

    el.tipHanzi.textContent = word;
    el.tipPy.textContent = ctx || (senses[0] && senses[0].pinyin) || '';

    el.tipSenses.textContent = '';
    if (!senses.length) {
      var li = h('li', null, 'Not part of the HSK 3 word list.');
      el.tipSenses.appendChild(li);
    } else if (senses.length === 1) {
      el.tipSenses.appendChild(h('li', null, senses[0].meaning));
    } else {
      senses.forEach(function (s) {
        var li = h('li');
        li.appendChild(h('span', 'alt-py', s.pinyin));
        li.appendChild(document.createTextNode(s.meaning));
        el.tipSenses.appendChild(li);
      });
    }

    el.tip.hidden = false;
    wordEl.classList.add('is-open');
    place();
    requestAnimationFrame(function () { el.tip.classList.add('is-on'); });
  }

  function place() {
    if (!active) return;
    var r = active.getBoundingClientRect();
    var tw = el.tip.offsetWidth;
    var th = el.tip.offsetHeight;
    var pad = 10;
    var vw = document.documentElement.clientWidth;

    // horizontal: centred on the word, clamped to the viewport
    var left = r.left + r.width / 2 - tw / 2;
    left = Math.max(pad, Math.min(left, vw - tw - pad));

    // vertical: above by default, below when there is no room
    var below = r.top < th + 16;
    var top = below ? r.bottom + 10 : r.top - th - 10;

    el.tip.dataset.side = below ? 'bottom' : 'top';
    el.tip.style.left = Math.round(left) + 'px';
    el.tip.style.top = Math.round(top) + 'px';

    var arrow = r.left + r.width / 2 - left;
    arrow = Math.max(14, Math.min(arrow, tw - 14));
    el.tip.style.setProperty('--arrow-x', Math.round(arrow) + 'px');
  }

  function hideTip() {
    if (!active) return;
    active.classList.remove('is-open');
    active = null;
    pinned = false;
    clearTimeout(hideTimer);
    el.tip.classList.remove('is-on', 'is-pinned');
    hideTimer = setTimeout(function () { el.tip.hidden = true; }, 150);
  }

  function scheduleHide() {
    if (pinned) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideTip, 220);
  }

  /* pointer + keyboard wiring on the story text (delegated) */
  el.story.addEventListener('pointerover', function (ev) {
    var w = ev.target.closest ? ev.target.closest('.w') : null;
    if (!w || !HOVER || pinned) return;
    showTip(w);
  });

  el.story.addEventListener('pointerout', function (ev) {
    var w = ev.target.closest ? ev.target.closest('.w') : null;
    if (!w || !HOVER) return;
    if (pinned) return;
    scheduleHide();
  });

  el.story.addEventListener('click', function (ev) {
    var w = ev.target.closest ? ev.target.closest('.w') : null;
    if (!w) return;
    ev.stopPropagation();
    if (active === w && pinned) { hideTip(); return; }
    showTip(w);
    pinned = true;
    el.tip.classList.add('is-pinned');
  });

  el.tip.addEventListener('pointerenter', function () { clearTimeout(hideTimer); });
  el.tip.addEventListener('pointerleave', function () { if (!pinned) scheduleHide(); });
  el.tipClose.addEventListener('click', hideTip);

  document.addEventListener('click', function (ev) {
    if (!active) return;
    if (ev.target === el.tip || el.tip.contains(ev.target)) return;
    if (ev.target.closest && ev.target.closest('.w')) return;
    hideTip();
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && active) hideTip();
  });

  window.addEventListener('scroll', function () { if (active) place(); }, { passive: true });
  window.addEventListener('resize', function () {
    setTopbarHeight();
    if (active) place();
  });

  /* ------------------------------------------------------------ controls */

  function sync() {
    el.mark.setAttribute('aria-pressed', String(state.mark));
    el.pinyin.setAttribute('aria-pressed', String(state.pinyin));
    el.english.setAttribute('aria-pressed', String(state.english));
    document.documentElement.dataset.theme = state.theme;
    el.theme.textContent = state.theme === 'dark' ? '◑' : '◐';
    document.documentElement.style.setProperty('--fs', state.size + 'px');
    if (el.text) {
      el.text.classList.toggle('is-marked', state.mark);
      el.text.classList.toggle('is-en', state.english);
    }
    savePrefs();
  }

  el.mark.addEventListener('click', function () { state.mark = !state.mark; sync(); });
  el.pinyin.addEventListener('click', function () {
    state.pinyin = !state.pinyin;
    sync();
    render();
  });
  el.english.addEventListener('click', function () { state.english = !state.english; sync(); });
  el.theme.addEventListener('click', function () {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    sync();
  });
  el.fsDec.addEventListener('click', function () {
    state.size = Math.max(16, state.size - 1); sync();
  });
  el.fsInc.addEventListener('click', function () {
    state.size = Math.min(30, state.size + 1); sync();
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.target.tagName === 'BUTTON') return;
    if (ev.key === 'ArrowLeft' && ev.altKey) go(Math.max(0, state.index - 1));
    if (ev.key === 'ArrowRight' && ev.altKey) go(Math.min(FLAT.length - 1, state.index + 1));
  });

  /* --------------------------------------------------------------- boot */

  function setTopbarHeight() {
    if (!el.topbar) return;
    document.documentElement.style.setProperty('--topbar-h', el.topbar.offsetHeight + 'px');
  }

  if (!localStorage.getItem(PREFS)) {
    state.theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  document.getElementById('stat-stories').textContent = FLAT.length;

  setTopbarHeight();
  renderNav();
  sync();
  render();
})();
