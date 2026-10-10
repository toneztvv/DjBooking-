// English / Spanish toggle for customer pages. Text is translated in the browser from
// the dictionary in i18n-es.js. Anything inside translate="no" (names, songs, chat, etc.)
// is left alone. The choice is remembered on the phone.
(function () {
  'use strict';
  var DICT = window.DJX_ES || {};
  var PATTERNS = (window.DJX_ES_PATTERNS || []).map(function (p) { return [new RegExp(p[0]), p[1]]; });
  var ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
  var STORE = 'djxpress_lang';
  var lang = 'en';
  var listeners = [];
  var origText = new WeakMap();   // text node -> original English
  var lastSet = new WeakMap();    // text node -> what we last wrote
  var origAttr = new WeakMap();   // element -> {attr: original}
  var lastAttr = new WeakMap();   // element -> {attr: what we wrote}
  var observer = null;
  var busy = false;

  function norm(s) { return s.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim(); }

  var NORM = {};
  Object.keys(DICT).forEach(function (k) { NORM[norm(k)] = DICT[k]; });

  function lookup(text) {
    var n = norm(text);
    if (!n) return null;
    if (NORM[n] !== undefined) return NORM[n];
    for (var i = 0; i < PATTERNS.length; i++) {
      var m = PATTERNS[i][0].exec(n);
      if (m) {
        var rep = PATTERNS[i][1];
        if (rep === 'VOTES') return m[1] + '% · ' + m[2] + (m[2] === '1' ? ' voto' : ' votos');
        return n.replace(PATTERNS[i][0], rep);
      }
    }
    return null;
  }

  function skipped(el) {
    for (; el && el.nodeType === 1; el = el.parentNode) {
      var tag = el.nodeName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || tag === 'NOSCRIPT') return true;
      if (el.getAttribute && el.getAttribute('translate') === 'no') return true;
    }
    return false;
  }

  function doText(node) {
    var cur = node.data;
    if (lastSet.has(node) && lastSet.get(node) === cur) { /* ours */ }
    else { origText.set(node, cur); lastSet.delete(node); }
    var orig = origText.get(node);
    if (lang === 'es') {
      if (skipped(node.parentNode)) return;
      var es = lookup(orig);
      if (es !== null) {
        var lead = orig.match(/^\s*/)[0], trail = orig.match(/\s*$/)[0];
        var out = lead + es + (orig.trim() ? trail : '');
        if (node.data !== out) node.data = out;
        lastSet.set(node, out);
      } else if (node.data !== orig) { node.data = orig; lastSet.delete(node); }
    } else if (lastSet.has(node)) {
      node.data = orig; lastSet.delete(node);
    }
  }

  function doAttrs(el) {
    var oa = origAttr.get(el) || {}, la = lastAttr.get(el) || {};
    var attrs = ATTRS.slice();
    if (el.nodeName === 'INPUT' && /^(submit|button)$/.test(el.type)) attrs.push('value');
    attrs.forEach(function (a) {
      if (!el.hasAttribute(a)) return;
      var cur = el.getAttribute(a);
      if (la[a] === undefined || la[a] !== cur) { oa[a] = cur; delete la[a]; }
      if (lang === 'es' && !skipped(el)) {
        var es = lookup(oa[a]);
        if (es !== null) { if (cur !== es) el.setAttribute(a, es); la[a] = es; }
        else if (cur !== oa[a]) { el.setAttribute(a, oa[a]); delete la[a]; }
      } else if (la[a] !== undefined) { el.setAttribute(a, oa[a]); delete la[a]; }
    });
    origAttr.set(el, oa); lastAttr.set(el, la);
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1) return;
    if (root.nodeName === 'SCRIPT' || root.nodeName === 'STYLE') return;
    doAttrs(root);
    var w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) doText(n); else if (n.nodeName !== 'SCRIPT' && n.nodeName !== 'STYLE') doAttrs(n); }
  }

  var origTitle = null, lastTitle = null;
  function doTitle() {
    if (origTitle === null || document.title !== lastTitle) { origTitle = document.title; lastTitle = null; }
    if (lang === 'es') {
      var es = lookup(origTitle);
      if (es !== null) { if (document.title !== es) document.title = es; lastTitle = es; }
    } else if (lastTitle !== null) { document.title = origTitle; lastTitle = null; }
  }

  function apply() {
    busy = true;
    try { walk(document.body); doTitle(); } finally { busy = false; }
    document.documentElement.lang = lang;
    updateButton();
  }

  function startObserver() {
    if (observer || !window.MutationObserver) return;
    observer = new MutationObserver(function (muts) {
      if (busy) return;
      busy = true;
      try {
        muts.forEach(function (m) {
          if (m.type === 'characterData') doText(m.target);
          else if (m.type === 'childList') m.addedNodes.forEach(walk);
          else if (m.type === 'attributes') doAttrs(m.target);
        });
        doTitle();
      } finally { busy = false; }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat(['value']) });
    observer.observe(document.querySelector('title') || document.head, { subtree: true, childList: true, characterData: true });
  }

  var btn = null;
  function updateButton() {
    if (!btn) return;
    btn.textContent = lang === 'es' ? 'English' : 'Español';
    btn.setAttribute('aria-label', lang === 'es' ? 'Switch to English' : 'Cambiar a español');
    btn.setAttribute('lang', lang === 'es' ? 'en' : 'es');
  }

  function setLang(next, persist) {
    next = next === 'es' ? 'es' : 'en';
    var changed = next !== lang;
    lang = next;
    if (persist) { try { localStorage.setItem(STORE, lang); } catch (e) {} }
    apply();
    if (changed) {
      document.dispatchEvent(new CustomEvent('djx:lang', { detail: { lang: lang } }));
      listeners.forEach(function (fn) { try { fn(lang); } catch (e) {} });
    }
  }

  function initialLang() {
    var q = /[?&]lang=(en|es)\b/.exec(location.search);
    if (q) { try { localStorage.setItem(STORE, q[1]); } catch (e) {} return q[1]; }
    try { var s = localStorage.getItem(STORE); if (s === 'en' || s === 'es') return s; } catch (e) {}
    return (navigator.language || '').toLowerCase().indexOf('es') === 0 ? 'es' : 'en';
  }

  function makeButton() {
    var host = document.querySelector('.nav-inner');
    if (!host) return;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lang-toggle';
    btn.setAttribute('translate', 'no');
    btn.addEventListener('click', function () { setLang(lang === 'es' ? 'en' : 'es', true); });
    host.appendChild(btn);
  }

  window.DJXI18n = {
    lang: function () { return lang; },
    locale: function () { return lang === 'es' ? 'es-US' : 'en-US'; },
    t: function (s) { if (lang !== 'es') return s; var r = lookup(s); return r === null ? s : r; },
    onChange: function (fn) { listeners.push(fn); }
  };

  function init() {
    makeButton();
    lang = initialLang();
    apply();
    startObserver();
    if (lang === 'es') document.dispatchEvent(new CustomEvent('djx:lang', { detail: { lang: lang } }));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
