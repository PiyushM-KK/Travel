/* Skyline festive themes - the ONE schedule. The homepage (index.html) and the chat assistant (AssistantWidget.dc.html,
   on index, Domestic, International, Destination and Customize) read it, so they change at the same moment.
   2026 dates, checked against Drik Panchang (New Delhi and Ahmedabad) and other published calendars:
     Sharad Navratri: night 1 Sun 11 Oct ... night 9 Mon 19 Oct (Ashtami and Navami rituals both fall on 19 Oct in 2026),
     Dussehra (Vijayadashami) Tue 20 Oct; Diwali days: Vagh Baras Thu 5 Nov, Dhanteras Fri 6, Kali Chaudas Sat 7,
     Diwali / Lakshmi Puja Sun 8, Govardhan Puja Mon 9 (Gujarat), Gujarati New Year (Bestu Varas) Tue 10, Bhai Dooj Wed 11.
     The nine forms and the popular colour of each night (the colours are a modern custom; four sources agree for 2026).
   Themes run until exact moments in Indian time (+05:30): navratri until 21 Oct 00:00, diwali until 12 Nov 00:00, then
   the normal site. Everything is a greeting or a calendar fact: nothing promises an event, a celebration or an offer.
   It sets <html data-fest="navratri|diwali"> (never data-theme: support.js owns that) and window.SkyFest; it switches by
   itself at the next midnight in India and calls SkyFest.onChange listeners. Keep _hi/_gu in step with the English.
   Preview (never stored): ?fest=navratri|diwali|off and &festat=YYYY-MM-DD (a date in India). */
(function () {
  'use strict';
  var IST = 5.5 * 3600e3, DAY = 86400e3;
  function dayNo(t) { return Math.floor((t + IST) / DAY); }                       // the calendar day in India
  function dn(iso) { return dayNo(Date.parse(iso + 'T00:00:00+05:30')); }
  var NAV1 = dn('2026-10-11'), DUSS = dn('2026-10-20'), NAV_END = dn('2026-10-21'),
      VAGH = dn('2026-11-05'), DIWALI = dn('2026-11-08'), FEST_END = dn('2026-11-12');

  var WD = { en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], hi: ['रविवार', 'सोमवार', 'मंगलवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'],
             gu: ['રવિવાર', 'સોમવાર', 'મંગળવાર', 'બુધવાર', 'ગુરુવાર', 'શુક્રવાર', 'શનિવાર'] };
  var MO = { en: { 9: 'Oct', 10: 'Nov' }, hi: { 9: 'अक्टूबर', 10: 'नवंबर' }, gu: { 9: 'ઓક્ટોબર', 10: 'નવેમ્બર' } };
  function L(lang) { return lang === 'hi' || lang === 'gu' ? lang : 'en'; }
  function date(d, lang) {                                                         // "Sun 8 Nov" / "रविवार, 8 नवंबर"
    var t = new Date(d * DAY), l = L(lang), w = WD[l][t.getUTCDay()], m = MO[l][t.getUTCMonth()];
    return l === 'en' ? w + ' ' + t.getUTCDate() + ' ' + m : w + ', ' + t.getUTCDate() + ' ' + m;
  }
  function tr(o, k, lang) { return (o && (o[k + '_' + L(lang)] || o[k])) || ''; }
  function T(en, hi, gu) { return { t: en, t_hi: hi, t_gu: gu }; }
  function t(o, lang) { return tr(o, 't', lang); }

  var NIGHTS = [
    { form: 'Shailputri', form_hi: 'शैलपुत्री', form_gu: 'શૈલપુત્રી', colour: 'Orange', colour_hi: 'नारंगी', colour_gu: 'નારંગી', sw: '#F57C00',
      line: 'Daughter of the mountain, the first of the nine forms.', line_hi: 'पर्वतराज हिमालय की पुत्री, नौ रूपों में पहला।', line_gu: 'પર્વતરાજ હિમાલયની પુત્રી, નવ સ્વરૂપોમાં પ્રથમ.' },
    { form: 'Brahmacharini', form_hi: 'ब्रह्मचारिणी', form_gu: 'બ્રહ્મચારિણી', colour: 'White', colour_hi: 'सफ़ेद', colour_gu: 'સફેદ', sw: '#FFFFFF',
      line: 'The form of devotion, penance and discipline.', line_hi: 'भक्ति, तप और संयम का स्वरूप।', line_gu: 'ભક્તિ, તપ અને સંયમનું સ્વરૂપ.' },
    { form: 'Chandraghanta', form_hi: 'चंद्रघंटा', form_gu: 'ચંદ્રઘંટા', colour: 'Red', colour_hi: 'लाल', colour_gu: 'લાલ', sw: '#D32F2F',
      line: 'Her crescent-moon bell stands for courage.', line_hi: 'घंटे जैसा अर्धचंद्र धारण करने वाली, साहस का प्रतीक।', line_gu: 'ઘંટ જેવો અર્ધચંદ્ર ધારણ કરનારાં, સાહસનું પ્રતીક.' },
    { form: 'Kushmanda', form_hi: 'कूष्मांडा', form_gu: 'કૂષ્માંડા', colour: 'Royal Blue', colour_hi: 'रॉयल ब्लू', colour_gu: 'રોયલ બ્લૂ', sw: '#1F3FA8',
      line: 'In tradition, she created the universe with her smile.', line_hi: 'मान्यता है कि अपनी मुस्कान से इन्होंने सृष्टि रची।', line_gu: 'માન્યતા છે કે તેમણે સ્મિતથી સૃષ્ટિ રચી.' },
    { form: 'Skandamata', form_hi: 'स्कंदमाता', form_gu: 'સ્કંદમાતા', colour: 'Yellow', colour_hi: 'पीला', colour_gu: 'પીળો', sw: '#FBC02D',
      line: 'Mother of Skanda (Kartikeya), the mother form.', line_hi: 'स्कंद (कार्तिकेय) की माता, मातृ स्वरूप।', line_gu: 'સ્કંદ (કાર્તિકેય)નાં માતા, માતૃ સ્વરૂપ.' },
    { form: 'Katyayani', form_hi: 'कात्यायनी', form_gu: 'કાત્યાયની', colour: 'Green', colour_hi: 'हरा', colour_gu: 'લીલો', sw: '#2E7D32',
      line: 'The warrior form, linked to the sage Katyayana.', line_hi: 'योद्धा स्वरूप, जिनका संबंध ऋषि कात्यायन से है।', line_gu: 'યોદ્ધા સ્વરૂપ, જેમનો સંબંધ ઋષિ કાત્યાયન સાથે છે.' },
    { form: 'Kalaratri', form_hi: 'कालरात्रि', form_gu: 'કાલરાત્રિ', colour: 'Grey', colour_hi: 'स्लेटी', colour_gu: 'રાખોડી', sw: '#8E9196',
      line: 'The fierce form that destroys evil and removes fear.', line_hi: 'बुराई का नाश करने और भय हरने वाला उग्र स्वरूप।', line_gu: 'દુષ્ટતાનો નાશ કરનારું અને ભય દૂર કરનારું ઉગ્ર સ્વરૂપ.' },
    { form: 'Mahagauri', form_hi: 'महागौरी', form_gu: 'મહાગૌરી', colour: 'Purple', colour_hi: 'बैंगनी', colour_gu: 'જાંબલી', sw: '#6A1B9A',
      line: 'The radiant form of purity and calm.', line_hi: 'पवित्रता और शांति का उज्ज्वल स्वरूप।', line_gu: 'પવિત્રતા અને શાંતિનું તેજસ્વી સ્વરૂપ.' },
    { form: 'Siddhidatri', form_hi: 'सिद्धिदात्री', form_gu: 'સિદ્ધિદાત્રી', colour: 'Peacock Green', colour_hi: 'मोरपंखी हरा', colour_gu: 'મોરપીંછ લીલો', sw: '#00897B',
      line: 'Giver of siddhis, the last of the nine forms.', line_hi: 'सिद्धियाँ देने वाली, नौ रूपों में अंतिम।', line_gu: 'સિદ્ધિઓ આપનારાં, નવ સ્વરૂપોમાં અંતિમ.' }
  ];
  var DAYS = [
    { name: 'Vagh Baras', name_hi: 'वाघ बारस', name_gu: 'વાઘ બારસ' },
    { name: 'Dhanteras', name_hi: 'धनतेरस', name_gu: 'ધનતેરસ' },
    { name: 'Kali Chaudas · Choti Diwali', name_hi: 'काली चौदस · छोटी दिवाली', name_gu: 'કાળી ચૌદસ', short: 'Kali Chaudas', short_hi: 'काली चौदस' },
    { name: 'Diwali · Lakshmi Puja', name_hi: 'दिवाली · लक्ष्मी पूजा', name_gu: 'દિવાળી · લક્ષ્મી પૂજન', short: 'Diwali', short_hi: 'दिवाली', short_gu: 'દિવાળી' },
    { name: 'Govardhan Puja', name_hi: 'गोवर्धन पूजा', name_gu: 'ગોવર્ધન પૂજા' },
    { name: 'Gujarati New Year · Saal Mubarak', name_hi: 'गुजराती नववर्ष · साल मुबारक', name_gu: 'બેસતું વર્ષ · સાલ મુબારક', short: 'New Year', short_hi: 'नववर्ष', short_gu: 'બેસતું વર્ષ' },
    { name: 'Bhai Dooj', name_hi: 'भाई दूज', name_gu: 'ભાઈબીજ' }
  ];
  var S = {
    navIn: T('Navratri in |n| days', 'नवरात्रि |n| दिन बाद', 'નવરાત્રી |n| દિવસ પછી'),
    navTmr: T('Navratri begins tomorrow', 'नवरात्रि कल से', 'નવરાત્રી આવતીકાલથી'),
    night: T('Night |n| of 9 · Maa {f}', 'नवरात्रि · दिन |n|/9 · माँ {f}', 'નોરતું |n|/9 · મા {f}'),
    duss: T('Happy Dussehra', 'दशहरा की शुभकामनाएँ', 'દશેરાની શુભેચ્છાઓ'),
    dussSub: T('Dussehra {d}', 'दशहरा {d}', 'દશેરા {d}'),
    diwIn: T('Diwali in |n| days', 'दिवाली |n| दिन बाद', 'દિવાળી |n| દિવસ પછી'),
    diwInSub: T('Diwali in {n} days', 'दिवाली {n} दिन बाद', 'દિવાળી {n} દિવસ પછી'),
    diwTmr: T('Diwali tomorrow', 'दिवाली कल', 'દિવાળી આવતીકાલે'),
    diwHappy: T('Happy Diwali', 'दीपावली की शुभकामनाएँ', 'દિવાળીની શુભેચ્છાઓ'),
    saal: T('Saal Mubarak', 'साल मुबारक', 'સાલ મુબારક'),
    bhai: T('Happy Bhai Dooj', 'भाई दूज की शुभकामनाएँ', 'ભાઈબીજની શુભેચ્છાઓ'),
    deep: T('Shubh Deepavali', 'शुभ दीपावली', 'શુભ દીપાવલી'),
    nineNights: T('Nine nights · {a} – {b}', 'नौ रातें · {a} – {b}', 'નવ રાત · {a} – {b}'),
    nightOf: T('Night {n} of 9 · {d}', 'दिन {n}/9 · {d}', 'નોરતું {n}/9 · {d}'),
    maa: T('Maa {f}', 'माँ {f}', 'મા {f}'),
    chip: T('{c} · popular colour of the day', '{c} · इस दिन का लोकप्रिय रंग', '{c} · આ દિવસનો લોકપ્રિય રંગ'),
    note9: T('In 2026, Ashtami and Navami fall on this day.', '2026 में अष्टमी और नवमी दोनों इसी दिन हैं।', '2026માં આઠમ અને નોમ બંને આ જ દિવસે છે.'),
    vijaya: T('Shubh Vijayadashami', 'शुभ विजयादशमी', 'શુભ વિજયાદશમી'),
    tenth: T('The tenth day, after the nine nights.', 'नौ रातों के बाद का दसवाँ दिन।', 'નવ રાત પછીનો દસમો દિવસ.'),
    diwDays: T('The Diwali days · {a} – {b}', 'दिवाली के दिन · {a} – {b}', 'દિવાળીના દિવસો · {a} – {b}'),
    today: T('Today · {d}', 'आज · {d}', 'આજે · {d}'),
    next: T('Next: {x} · {d}', 'आगे: {x} · {d}', 'આગળ: {x} · {d}'),
    last: T('The last of the Diwali days.', 'दिवाली के दिनों में आख़िरी।', 'દિવાળીના દિવસોમાં છેલ્લો.'),
    navTrack: T('The nine nights of Navratri', 'नवरात्रि की नौ रातें', 'નવરાત્રીની નવ રાત'),
    diwTrack: T('The Diwali days', 'दिवाली के दिन', 'દિવાળીના દિવસો'),
    nightN: T('Night {n}', 'दिन {n}', 'નોરતું {n}')
  };
  function fill(s, o) { return s.replace(/\{(\w)\}/g, function (m, k) { return k in o ? o[k] : m; }); }
  // "Navratri in |n| days" -> { pre, n, post } so pages can style the number
  function split(s, n) { var i = s.indexOf('|n|'); return i < 0 ? { pre: s, n: '', post: '' } : { pre: s.slice(0, i), n: String(n), post: s.slice(i + 3) }; }

  // ---------- which theme, and the strip / chat line for a day ----------
  // the Navratri theme starts two weeks ahead (a device with a wrong clock must not show "Navratri in 2,000 days")
  function themeOf(d) { return d < NAV1 - 14 ? null : d < NAV_END ? 'navratri' : d < FEST_END ? 'diwali' : null; }
  function line(d, lang) {
    var l = L(lang), main, sub = '';
    if (d < NAV1 - 1) { main = split(t(S.navIn, l), NAV1 - d); sub = date(NAV1, l); }
    else if (d === NAV1 - 1) { main = split(t(S.navTmr, l)); sub = date(NAV1, l); }
    else if (d < DUSS) { var k = d - NAV1; main = split(fill(t(S.night, l), { f: tr(NIGHTS[k], 'form', l) }), k + 1); sub = fill(t(S.dussSub, l), { d: date(DUSS, l) }); }
    else if (d === DUSS) { main = split(t(S.duss, l)); sub = fill(t(S.diwInSub, l), { n: DIWALI - d }); }
    else if (d < VAGH) { main = split(t(S.diwIn, l), DIWALI - d); sub = date(DIWALI, l); }
    else if (d < DIWALI) { main = split(tr(DAYS[d - VAGH], 'name', l)); sub = DIWALI - d === 1 ? t(S.diwTmr, l) : fill(t(S.diwInSub, l), { n: DIWALI - d }); }
    else if (d === DIWALI) { main = split(t(S.diwHappy, l)); sub = tr(DAYS[4], 'name', l) + ' ' + date(DIWALI + 1, l); }
    else if (d === DIWALI + 1) { main = split(tr(DAYS[4], 'name', l)); sub = t(S.saal, l) + ' ' + date(DIWALI + 2, l); }
    else if (d === DIWALI + 2) { main = split(t(S.saal, l)); sub = tr(DAYS[6], 'name', l) + ' ' + date(DIWALI + 3, l); }
    else { main = split(t(S.bhai, l)); sub = t(S.deep, l); }
    return { pre: main.pre, n: main.n, post: main.post, text: main.pre + main.n + main.post, sub: sub,
             swatch: d >= NAV1 && d < DUSS ? NIGHTS[d - NAV1].sw : '' };
  }

  // ---------- the festival card: the nine nights or the Diwali days; `sel` = the stop the visitor tapped ----------
  function card(d, lang, sel) {
    var l = L(lang), th = themeOf(d), out;
    if (th === 'navratri') {
      var cur = d - NAV1, dussOn = d === DUSS;
      var i = sel != null && sel >= 0 && sel < 9 ? sel : (cur >= 0 && cur < 9 ? cur : 0);
      var stops = NIGHTS.map(function (x, k) {
        var nd = NAV1 + k;
        return { label: String(k + 1), swatch: x.sw, state: nd < d ? 'past' : nd === d ? 'today' : 'future', sel: !dussOn && k === i,
                 aria: fill(t(S.nightN, l), { n: k + 1 }) + ', ' + date(nd, l) + ', ' + fill(t(S.maa, l), { f: tr(x, 'form', l) }) };
      });
      if (dussOn) return { theme: th, eye: date(DUSS, l), title: t(S.vijaya, l), line: t(S.tenth, l), chip: '', swatch: '', note: '', stops: stops, track: t(S.navTrack, l) };
      var n = NIGHTS[i];
      out = { theme: th, eye: cur < 0 && sel == null ? fill(t(S.nineNights, l), { a: date(NAV1, l), b: date(NAV1 + 8, l) }) : fill(t(S.nightOf, l), { n: i + 1, d: date(NAV1 + i, l) }),
              title: fill(t(S.maa, l), { f: tr(n, 'form', l) }), line: tr(n, 'line', l), chip: fill(t(S.chip, l), { c: tr(n, 'colour', l) }), swatch: n.sw,
              note: i === 8 ? t(S.note9, l) : '', stops: stops, track: t(S.navTrack, l) };
      return out;
    }
    if (th === 'diwali') {
      var c = d - VAGH, j = sel != null && sel >= 0 && sel < 7 ? sel : (c >= 0 && c < 7 ? c : 0);
      var dstops = DAYS.map(function (x, k) {
        var dd = VAGH + k;
        return { label: String(new Date(dd * DAY).getUTCDate()), name: tr(x, 'short', l) || tr(x, 'name', l), state: dd < d ? 'past' : dd === d ? 'today' : 'future', sel: k === j,
                 aria: tr(x, 'name', l) + ', ' + date(dd, l) };
      });
      var nx = DAYS[j + 1];
      return { theme: th, eye: c < 0 && sel == null ? fill(t(S.diwDays, l), { a: date(VAGH, l), b: date(VAGH + 6, l) }) : (VAGH + j === d ? fill(t(S.today, l), { d: date(d, l) }) : date(VAGH + j, l)),
               title: tr(DAYS[j], 'name', l), line: nx ? fill(t(S.next, l), { x: tr(nx, 'name', l), d: date(VAGH + j + 1, l) }) : t(S.last, l),
               chip: '', swatch: '', note: '', stops: dstops, track: t(S.diwTrack, l) };
    }
    return null;
  }

  // ---------- now (or the preview day), the attribute, and the midnight switch ----------
  var q = '';
  try { q = location.search; } catch (e) {}
  var force = (q.match(/[?&]fest=(navratri|diwali|off)(?:&|$)/) || [])[1];
  var at = (q.match(/[?&]festat=(\d{4}-\d{2}-\d{2})(?:&|$)/) || [])[1];
  var atDay = at ? dayNo(Date.parse(at + 'T12:00:00+05:30')) : NaN;
  function today() {
    if (!isNaN(atDay)) return atDay;
    var d = dayNo(Date.now());
    if (force === 'diwali' && themeOf(d) !== 'diwali') return d < VAGH ? NAV_END : FEST_END - 1;   // preview Diwali early/late
    if (force === 'navratri' && themeOf(d) !== 'navratri') return NAV1 - 6;                             // preview Navratri out of season
    return d;
  }
  var listeners = [], cur = null, timer = 0;
  function apply() {
    var d = today(), th = force === 'off' ? null : themeOf(d);
    cur = th ? d : null;
    var el = document.documentElement;
    if (th) el.setAttribute('data-fest', th); else el.removeAttribute('data-fest');
    api.id = th;
    return th;
  }
  function schedule() {                                                                              // wake at the next midnight in India
    clearTimeout(timer);
    if (!isNaN(atDay) || force) return;
    var nextMid = (dayNo(Date.now()) + 1) * DAY - IST;
    timer = setTimeout(tick, Math.min(nextMid - Date.now() + 500, 2147483000));
  }
  function tick() { var before = cur + '|' + api.id; apply(); schedule();
    if (before !== cur + '|' + api.id) listeners.forEach(function (f) { try { f(); } catch (e) {} }); }
  var api = {
    id: null,
    line: function (lang) { return cur == null ? { pre: '', n: '', post: '', text: '', sub: '', swatch: '' } : line(cur, lang); },
    main: function (lang) { return this.line(lang).text; },
    sub: function (lang) { return this.line(lang).sub; },
    card: function (lang, sel) { return cur == null ? null : card(cur, lang, sel); },
    onChange: function (f) { if (typeof f !== 'function') return function () {}; listeners.push(f);
      return function () { var i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); }; },          // returns an unsubscribe
    // for tests: everything for a given India day number
    at: function (d, lang, sel) { return { theme: themeOf(d), line: themeOf(d) ? line(d, lang) : null, card: themeOf(d) ? card(d, lang, sel) : null }; },
    dayNo: dayNo, NIGHTS: NIGHTS, DAYS: DAYS
  };
  window.SkyFest = api;
  apply(); schedule();
  try { document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); }); } catch (e) {}
})();
