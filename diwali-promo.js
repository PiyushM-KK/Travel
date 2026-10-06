/* Diwali offers promo: a small floating card. While Diwali in Bali (departs Tue 3 Nov 2026, IST) and the Lakshadweep
   Escape (travel 5-20 Nov 2026) are both live it names both and opens /offers; once Bali has left it shows only
   Lakshadweep and opens its page; after 20 Nov it is gone. It never advertises a trip that has left, and can be dismissed.
   Sits centred above the AI-assistant and WhatsApp buttons, under the cookie banner.
   To remove early, delete the <script src="diwali-promo.js"> tag from the page.
   Speaks the visitor's language (the site's skyline_lang key: en / hi / gu) and follows it when they switch. */
(function () {
  if (window.__skyDiwaliPromo) return;   // one card even if a page loads this script twice
  window.__skyDiwaliPromo = true;
  var BALI_END = new Date('2026-11-03T00:00:00+05:30'), LAKS_END = new Date('2026-11-21T00:00:00+05:30');
  var now = new Date(), both = now < BALI_END;
  if (now >= LAKS_END) return;
  try { if (sessionStorage.getItem('sky_diwali_promo') === 'closed') return; } catch (e) {}
  if (/(^|\/)(diwali-bali|diwali-lakshadweep|offers)(\.html)?\/?$/.test(location.pathname)) return;

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

  var TXT = both ? {
    en: { t: 'Diwali offers', s: 'Bali 7N/8D · Lakshadweep 3N/4D', go: 'See offers →', aria: 'Diwali offers: Bali, 7 nights, and Lakshadweep, 3 nights. See the offers.', x: 'Hide Diwali offers' },
    hi: { t: 'दिवाली ऑफ़र', s: 'बाली 7 रातें · लक्षद्वीप 3 रातें', go: 'ऑफ़र देखें →', aria: 'दिवाली ऑफ़र: बाली, 7 रातें, और लक्षद्वीप, 3 रातें। ऑफ़र देखें।', x: 'दिवाली ऑफ़र छिपाएं' },
    gu: { t: 'દિવાળી ઓફર', s: 'બાલી 7 રાત · લક્ષદ્વીપ 3 રાત', go: 'ઓફર જુઓ →', aria: 'દિવાળી ઓફર: બાલી, 7 રાત, અને લક્ષદ્વીપ, 3 રાત. ઓફર જુઓ.', x: 'દિવાળી ઓફર છુપાવો' }
  } : {
    en: { t: 'Lakshadweep Escape', s: 'Diwali Special · travel 5–20\u00a0Nov', go: 'View trip →', aria: 'Lakshadweep Escape, Diwali Special: travel 5 to 20 November. View the trip.', x: 'Hide Diwali offer' },
    hi: { t: 'लक्षद्वीप की सैर', s: 'दिवाली स्पेशल · यात्रा 5–20\u00a0नवंबर', go: 'यात्रा देखें →', aria: 'लक्षद्वीप की सैर, दिवाली स्पेशल: यात्रा 5 से 20 नवंबर। यात्रा देखें।', x: 'दिवाली ऑफ़र छिपाएं' },
    gu: { t: 'લક્ષદ્વીપની સફર', s: 'દિવાળી સ્પેશિયલ · પ્રવાસ 5–20\u00a0નવેમ્બર', go: 'યાત્રા જુઓ →', aria: 'લક્ષદ્વીપની સફર, દિવાળી સ્પેશિયલ: પ્રવાસ 5 થી 20 નવેમ્બર. યાત્રા જુઓ.', x: 'દિવાળી ઓફર છુપાવો' }
  };
  function lang() { try { var v = localStorage.getItem('skyline_lang'); return TXT[v] ? v : 'en'; } catch (e) { return 'en'; } }

  var a = document.createElement('a');
  a.className = 'skd';
  a.href = both ? 'offers.html?festival=diwali' : 'diwali-lakshadweep.html';
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
    try { sessionStorage.setItem('sky_diwali_promo', 'closed'); } catch (err) {}
    setTimeout(function () { a.remove(); }, 500);
  });

  function show() { document.body.appendChild(a); setTimeout(function () { a.classList.add('on'); }, 900); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show();
})();
