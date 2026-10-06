/* Festive offers promo: a small floating card. Everything it says comes from offers-data.js (window.SkyOffers), the
   one list /offers and the menu link read too, so adding an offer there is all it takes. While a festival has more than
   one live offer the card names them all and opens /offers on that festival's tab; with one left it names that trip and
   opens its page; with none it is gone. It never advertises a trip that has left, never shows a price, and can be
   dismissed (for the browser session). It stays off /offers and every offer's own page.
   Sits centred above the AI-assistant and WhatsApp buttons, under the cookie banner.
   Needs <script src="offers-data.js"> earlier on the page; without it the card simply doesn't appear.
   To remove early, delete the <script src="diwali-promo.js"> tag from the page.
   Speaks the visitor's language (the site's skyline_lang key: en / hi / gu) and follows it when they switch. */
(function () {
  if (window.__skyDiwaliPromo) return;   // one card even if a page loads this script twice
  window.__skyDiwaliPromo = true;
  var SO = window.SkyOffers;
  if (!SO) return;
  var cur = SO.live(new Date())[0];
  if (!cur) return;
  var KEY = 'sky_offers_promo_' + cur.f.id;
  try { if (sessionStorage.getItem(KEY) === 'closed') return; } catch (e) {}
  if (SO.isOfferPage(location.pathname)) return;

  var css = document.createElement('style');
  css.textContent =
    '.skd{position:fixed;z-index:1500;left:0;right:0;margin-inline:auto;bottom:calc(84px + env(safe-area-inset-bottom,0px));width:max-content;max-width:min(380px,calc(100% - 32px));' +
    'display:flex;align-items:center;gap:12px;padding:12px 14px 12px 12px;border-radius:18px;background:rgba(20,12,8,.88);' +
    '-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border:1px solid rgba(255,166,48,.45);' +
    'box-shadow:0 10px 30px rgba(0,0,0,.35),0 0 24px rgba(255,140,40,.25);color:#FFF3E2;font:500 14px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;' +
    'text-decoration:none;transform:translateY(20px);opacity:0;transition:transform .5s cubic-bezier(.2,.7,.1,1),opacity .5s}' +
    '.skd.on{transform:none;opacity:1}' +
    '.skd svg{flex:0 0 36px;height:36px;filter:drop-shadow(0 0 6px rgba(255,166,48,.8))}' +
    '.skd .fl{transform-box:fill-box;transform-origin:50% 100%;animation:skdf .18s ease-in-out infinite alternate}' +
    '@keyframes skdf{from{transform:scale(1,1)}to{transform:scale(.9,1.1)}}' +
    '.skd b{display:block;color:#FFA630;font-size:15px}' +
    '.skd small{display:block;color:#E9D9C4;font-size:12.5px}' +
    '.skd .go{margin-left:auto;background:#FFA630;color:#1A0B00;font-weight:700;border-radius:999px;padding:7px 12px;white-space:nowrap;font-size:13px}' +
    '.skd .x{position:absolute;top:-8px;right:-8px;width:24px;height:24px;border-radius:50%;border:1px solid rgba(255,166,48,.5);background:#1A0F0A;color:#FFF3E2;font-size:14px;line-height:22px;text-align:center;cursor:pointer;padding:0}' +
    '@media (prefers-reduced-motion:reduce){.skd{transition:none}.skd .fl{animation:none}}';
  document.head.appendChild(css);

  var many = cur.offers.length > 1, one = cur.offers[0], tr = SO.tr;
  var GO = many ? { en: 'See offers →', hi: 'ऑफ़र देखें →', gu: 'ઓફર જુઓ →' } : { en: 'View trip →', hi: 'यात्रा देखें →', gu: 'યાત્રા જુઓ →' };
  var GO_SAY = many ? { en: 'See the offers.', hi: 'ऑफ़र देखें।', gu: 'ઓફર જુઓ.' } : { en: 'View the trip.', hi: 'यात्रा देखें।', gu: 'યાત્રા જુઓ.' };
  var AND = { en: ', and ', hi: ', और ', gu: ', અને ' };
  function hide(label, l) { return l === 'hi' ? label + ' छिपाएं' : l === 'gu' ? label + ' છુપાવો' : 'Hide ' + label; }
  function build(l) {
    var label = tr(cur.f, 'label', l);
    if (!many) return { t: tr(one, 'title', l), s: tr(one, 'solo', l), go: GO[l], aria: tr(one, 'solo_say', l) + ' ' + GO_SAY[l], x: hide(label, l) };
    var says = cur.offers.map(function (o) { return tr(o, 'short_say', l); });
    var said = says.length > 1 ? says.slice(0, -1).join(', ') + AND[l] + says[says.length - 1] : says[0];
    return { t: label, s: cur.offers.map(function (o) { return tr(o, 'short', l); }).join(' · '), go: GO[l],
             aria: label + ': ' + said + (l === 'hi' ? '। ' : '. ') + GO_SAY[l], x: hide(label, l) };
  }
  var TXT = { en: build('en'), hi: build('hi'), gu: build('gu') };
  function lang() { try { var v = localStorage.getItem('skyline_lang'); return TXT[v] ? v : 'en'; } catch (e) { return 'en'; } }

  var a = document.createElement('a');
  a.className = 'skd';
  a.href = many ? 'offers.html?festival=' + encodeURIComponent(cur.f.id) : one.href;
  a.innerHTML =
    '<svg viewBox="0 0 40 40" aria-hidden="true"><path class="fl" d="M20 2 C24 9 25 13 20 18 C15 13 16 9 20 2Z" fill="#FFC24A"/>' +
    '<path d="M4 21 C9 34 31 34 36 21 Z" fill="#9C3E12"/><ellipse cx="20" cy="21" rx="16" ry="3.2" fill="#D96A2B"/></svg>' +
    '<span><b></b><small></small></span><span class="go"></span>' +
    '<button class="x" type="button">×</button>';
  var shown = '';
  function words() {
    var l = lang(); if (l === shown) return; shown = l; var t = TXT[l];
    a.lang = l; a.setAttribute('aria-label', t.aria);
    a.querySelector('b').textContent = t.t; a.querySelector('small').textContent = t.s; a.querySelector('.go').textContent = t.go;
    a.querySelector('.x').setAttribute('aria-label', t.x);
  }
  words();
  document.addEventListener('click', function () { setTimeout(words, 60); }, true);   // the site's language buttons are clicks
  addEventListener('storage', function (e) { if (e.key === 'skyline_lang') words(); });
  a.querySelector('.x').addEventListener('click', function (e) {
    e.preventDefault(); e.stopPropagation();
    a.classList.remove('on');
    try { sessionStorage.setItem(KEY, 'closed'); } catch (err) {}
    setTimeout(function () { a.remove(); }, 500);
  });

  function show() { document.body.appendChild(a); setTimeout(function () { a.classList.add('on'); }, 900); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show();
})();
