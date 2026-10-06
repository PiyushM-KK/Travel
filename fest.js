/* Skyline festive themes - the ONE schedule. The homepage (index.html) and the chat assistant (AssistantWidget.dc.html,
   on index, Domestic, International, Destination and Customize) read it, so they change at the same moment.
   2026, India: Sharad Navratri 11-19 Oct, Dussehra (Vijayadashami) Tue 20 Oct, Diwali (Lakshmi Puja) Sun 8 Nov,
   Bhai Dooj Wed 11 Nov. Every switch is an exact moment in Indian time (+05:30):
     navratri  now -> 21 Oct 00:00 IST    diwali  21 Oct 00:00 -> 12 Nov 00:00 IST    then the normal site
   Inside each theme the greeting follows the calendar (phases). Greetings and calendar facts only: nothing here
   promises an event, a celebration or an offer. Keep the _hi/_gu fields in step with the English.
   It sets <html data-fest="navratri|diwali"> (never data-theme: support.js owns that) and window.SkyFest.
   Preview (never stored): ?fest=navratri|diwali|off and &festat=YYYY-MM-DD (a date in India) to see a phase. */
(function () {
  'use strict';
  var WINDOWS = [
    { id: 'navratri', until: '2026-10-21T00:00:00+05:30', phases: [
      { until: '2026-10-11T00:00:00+05:30',
        main: 'Navratri begins Sun 11 Oct', main_hi: 'नवरात्रि रविवार, 11 अक्टूबर से', main_gu: 'નવરાત્રી રવિવાર, 11 ઓક્ટોબરથી',
        sub: 'Dussehra Tue 20 Oct', sub_hi: 'दशहरा मंगलवार, 20 अक्टूबर', sub_gu: 'દશેરા મંગળવાર, 20 ઓક્ટોબર' },
      { until: '2026-10-20T00:00:00+05:30',
        main: 'Shubh Navratri · 11–19 Oct', main_hi: 'शुभ नवरात्रि · 11–19 अक्टूबर', main_gu: 'શુભ નવરાત્રી · 11–19 ઓક્ટોબર',
        sub: 'Dussehra Tue 20 Oct', sub_hi: 'दशहरा मंगलवार, 20 अक्टूबर', sub_gu: 'દશેરા મંગળવાર, 20 ઓક્ટોબર' },
      { until: '2026-10-21T00:00:00+05:30',
        main: 'Happy Dussehra', main_hi: 'दशहरा की शुभकामनाएँ', main_gu: 'દશેરાની શુભેચ્છાઓ',
        sub: 'Shubh Vijayadashami', sub_hi: 'शुभ विजयादशमी', sub_gu: 'શુભ વિજયાદશમી' } ] },
    { id: 'diwali', from: '2026-10-21T00:00:00+05:30', until: '2026-11-12T00:00:00+05:30', phases: [
      { until: '2026-11-08T00:00:00+05:30',
        main: 'Diwali Sun 8 Nov', main_hi: 'दिवाली रविवार, 8 नवंबर', main_gu: 'દિવાળી રવિવાર, 8 નવેમ્બર',
        sub: 'Bhai Dooj Wed 11 Nov', sub_hi: 'भाई दूज बुधवार, 11 नवंबर', sub_gu: 'ભાઈબીજ બુધવાર, 11 નવેમ્બર' },
      { until: '2026-11-11T00:00:00+05:30',
        main: 'Happy Diwali', main_hi: 'दीपावली की शुभकामनाएँ', main_gu: 'દિવાળીની શુભેચ્છાઓ',
        sub: 'Bhai Dooj Wed 11 Nov', sub_hi: 'भाई दूज बुधवार, 11 नवंबर', sub_gu: 'ભાઈબીજ બુધવાર, 11 નવેમ્બર' },
      { until: '2026-11-12T00:00:00+05:30',
        main: 'Happy Bhai Dooj', main_hi: 'भाई दूज की शुभकामनाएँ', main_gu: 'ભાઈબીજની શુભેચ્છાઓ',
        sub: 'Shubh Deepavali', sub_hi: 'शुभ दीपावली', sub_gu: 'શુભ દીપાવલી' } ] }
  ];
  function d(s) { return s ? new Date(s) : null; }
  function phaseAt(w, now) { for (var i = 0; i < w.phases.length; i++) if (now < d(w.phases[i].until)) return w.phases[i]; return null; }
  // the theme and greeting on at `now`, or null
  function pick(now) {
    for (var i = 0; i < WINDOWS.length; i++) { var w = WINDOWS[i];
      if ((!w.from || now >= d(w.from)) && now < d(w.until)) return { w: w, p: phaseAt(w, now) }; }
    return null;
  }
  function tr(o, k, lang) { return (o && (o[k + '_' + lang] || o[k])) || ''; }

  var q = '', cur = null;
  try { q = location.search; } catch (e) {}
  var force = (q.match(/[?&]fest=(navratri|diwali|off)(?:&|$)/) || [])[1];
  var day = (q.match(/[?&]festat=(\d{4}-\d{2}-\d{2})(?:&|$)/) || [])[1];
  var now = day ? new Date(day + 'T12:00:00+05:30') : new Date();
  if (isNaN(now)) now = new Date();
  if (force !== 'off') {
    cur = pick(now);
    if (force && (!cur || cur.w.id !== force)) {                       // preview a theme outside its dates
      var fw = WINDOWS.filter(function (w) { return w.id === force; })[0];
      cur = { w: fw, p: phaseAt(fw, now) || fw.phases[now < d(fw.from || fw.phases[0].until) ? 0 : fw.phases.length - 1] };
    }
  }
  if (cur) document.documentElement.setAttribute('data-fest', cur.w.id);
  window.SkyFest = {
    id: cur ? cur.w.id : null,
    main: function (lang) { return cur ? tr(cur.p, 'main', lang) : ''; },
    sub: function (lang) { return cur ? tr(cur.p, 'sub', lang) : ''; },
    pick: pick, WINDOWS: WINDOWS
  };
})();
