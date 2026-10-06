/* Skyline festive offers - the ONE list. Everything that shows a festival offer reads it:
     offers.html          the offers page (a tab per festival, a card per offer)
     diwali-promo.js      the small floating card on the homepage, Domestic and International
     the menu link        "<Festival> Offers" in the header of index.html, Domestic, International and Destination
   To add a destination: add an offer to its festival. To add a festival (Holi, summer holidays, Navratri, New Year...):
   add an entry. Nothing else needs editing.
   An offer disappears everywhere by itself at `until` (an exact moment in Indian time, +05:30). A festival with no live
   offer gets no tab and no card; with nothing live the card is gone, the menu link reads plain "Offers" and /offers says
   new offers are on the way. The first festival with a live offer is the one the menu link and the card show.
   No prices in this file: a price lives only on the offer's own page, with its fine print. Keep the _hi/_gu fields in step
   with the English (LANG-FIX-SPEC.md); a missing translation falls back to English. Every href is a page on this site ("name.html"); the checks below leave out anything else. */
(function () {
  'use strict';
  var FESTIVALS = [
    { id: 'diwali', name: 'Diwali', name_hi: 'दिवाली', name_gu: 'દિવાળી',
      when: 'Sun 8 Nov 2026', when_hi: 'रविवार, 8 नवंबर 2026', when_gu: 'રવિવાર, 8 નવેમ્બર 2026',
      label: 'Diwali Offers', label_hi: 'दिवाली ऑफ़र', label_gu: 'દિવાળી ઓફર',   // the menu link and the card's heading
      accent: '#FFA630',
      offers: [
        { title: 'Diwali in Bali', title_hi: 'बाली में दिवाली', title_gu: 'બાલીમાં દિવાળી', href: 'diwali-bali.html',
          img: 'images/diwali-bali/hero-diwali.jpg', illustrative: true,
          tag: '7N/8D', tag_hi: '7 रातें / 8 दिन', tag_gu: '7 રાત / 8 દિવસ',
          meta: 'Departs Tue 3 Nov 2026 · Singapore Airlines from Ahmedabad', meta_hi: 'रवानगी मंगलवार, 3 नवंबर 2026 · अहमदाबाद से Singapore Airlines', meta_gu: 'પ્રસ્થાન: મંગળવાર, 3 નવેમ્બર 2026 · અમદાવાદથી Singapore Airlinesની ફ્લાઇટ',
          blurb: 'Kuta, Ubud and a private pool villa in Jimbaran, with Diwali on day 6.', blurb_hi: 'कुटा और उबुद के बाद जिम्बारन में एक प्राइवेट पूल विला। यात्रा के छठे दिन दिवाली है।', blurb_gu: 'કુટા અને ઉબુદ ઉપરાંત જિમ્બારનમાં એક પ્રાઇવેટ પૂલ વિલા, અને યાત્રાના છઠ્ઠા દિવસે દિવાળી.',
          alt: 'A resort path lined with lanterns and pools on Diwali evening (illustrative)', alt_hi: 'दिवाली की शाम रिज़ॉर्ट का एक रास्ता, जिसके किनारे-किनारे कंदील और पूल हैं (AI से बना चित्र)', alt_gu: 'દિવાળીની સાંજે રિસોર્ટનો રસ્તો, જેની બંને બાજુ ફાનસ અને પૂલ છે (AI ચિત્ર)',
          // illustrative: AI-made picture (chip "Illustrative · AI-generated" / AI से बना चित्र); stock: a stock photo standing in
          // for the place (chip "Illustrative · stock photo" / सांकेतिक चित्र). The floating card: `short` when it lists several offers, `solo` when this is the only one left; *_say is read aloud
          short: 'Bali 7N/8D', short_hi: 'बाली 7 रातें', short_gu: 'બાલી 7 રાત',
          short_say: 'Bali, 7 nights', short_say_hi: 'बाली, 7 रातें', short_say_gu: 'બાલી, 7 રાત',
          solo: 'Diwali Special · departs 3 Nov', solo_hi: 'दिवाली स्पेशल · रवानगी 3 नवंबर', solo_gu: 'દિવાળી સ્પેશિયલ · પ્રસ્થાન 3 નવેમ્બર',
          solo_say: 'Diwali in Bali, Diwali Special: departs 3 November.', solo_say_hi: 'बाली में दिवाली, दिवाली स्पेशल: रवानगी 3 नवंबर।', solo_say_gu: 'બાલીમાં દિવાળી, દિવાળી સ્પેશિયલ: પ્રસ્થાન 3 નવેમ્બર.',
          until: '2026-11-03T00:00:00+05:30' },
        { title: 'Lakshadweep Escape', title_hi: 'लक्षद्वीप की सैर', title_gu: 'લક્ષદ્વીપની સફર', href: 'diwali-lakshadweep.html',
          img: 'images/diwali-lakshadweep/lagoon-card.jpg', illustrative: false, stock: true,
          tag: '3N/4D', tag_hi: '3 रातें / 4 दिन', tag_gu: '3 રાત / 4 દિવસ',
          meta: 'Travel 5 – 20 Nov 2026 · Flight tickets extra', meta_hi: 'यात्रा 5 – 20 नवंबर 2026 · फ़्लाइट टिकट अलग से', meta_gu: 'પ્રવાસ 5 – 20 નવેમ્બર 2026 · ફ્લાઇટ ટિકિટ અલગથી',
          blurb: 'Two nights on Agatti and one on Bangaram: turquoise lagoons, white sand and a Kalpitti Island tour by glass-bottom boat.', blurb_hi: 'अगत्ती पर दो रातें और बंगारम पर एक रात: फ़िरोज़ी लैगून, सफ़ेद रेत और ग्लास-बॉटम बोट से कल्पित्ती द्वीप की सैर।', blurb_gu: 'અગત્તી પર બે રાત અને બંગારમ પર એક રાત: પીરોજી લગૂન, સફેદ રેતી અને ગ્લાસ-બોટમ બોટથી કલ્પિત્તી ટાપુની સફર.',
          alt: 'A small palm-covered island and a wooden boat on a turquoise lagoon (illustrative stock photo)', alt_hi: 'फ़िरोज़ी लैगून में नारियल के पेड़ों वाला एक छोटा द्वीप और लकड़ी की नाव (सांकेतिक चित्र)', alt_gu: 'પીરોજી લગૂનમાં નાળિયેરીનાં વૃક્ષોવાળો નાનો ટાપુ અને લાકડાની હોડી (પ્રતીકાત્મક ચિત્ર)',
          short: 'Lakshadweep 3N/4D', short_hi: 'लक्षद्वीप 3 रातें', short_gu: 'લક્ષદ્વીપ 3 રાત',
          short_say: 'Lakshadweep, 3 nights', short_say_hi: 'लक्षद्वीप, 3 रातें', short_say_gu: 'લક્ષદ્વીપ, 3 રાત',
          solo: 'Diwali Special · travel 5–\u206020\u00a0Nov', solo_hi: 'दिवाली स्पेशल · यात्रा 5–\u206020\u00a0नवंबर', solo_gu: 'દિવાળી સ્પેશિયલ · પ્રવાસ 5–\u206020\u00a0નવેમ્બર',
          solo_say: 'Lakshadweep Escape, Diwali Special: travel 5 to 20 November.', solo_say_hi: 'लक्षद्वीप की सैर, दिवाली स्पेशल: यात्रा 5 से 20 नवंबर।', solo_say_gu: 'લક્ષદ્વીપની સફર, દિવાળી સ્પેશિયલ: પ્રવાસ 5 થી 20 નવેમ્બર.',
          until: '2026-11-21T00:00:00+05:30' }
      ] }
  ];

  // Guard rails for future edits: a festival id is lowercase letters, digits and dashes; an offer must link to a page of
  // this site ("name.html", nothing else) and have a real end date; an accent must be a colour code. Anything else is
  // left out (and reported in the browser console) rather than shown.
  var PAGE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.html$/, HEX = /^#[0-9a-fA-F]{3,8}$/;
  FESTIVALS = FESTIVALS.filter(function (f) { return /^[a-z0-9-]+$/.test(f.id || ''); }).map(function (f) {
    var g = {}; for (var k in f) g[k] = f[k];
    g.accent = HEX.test(f.accent || '') ? f.accent : '#FFA630';
    g.offers = (f.offers || []).filter(function (o) {
      var ok = PAGE.test(o.href || '') && !isNaN(new Date(o.until));
      if (!ok && window.console) console.warn('offers-data.js: offer left out (href must be a page.html, until a date):', o.title);
      return ok;
    });
    return g;
  });

  function tr(o, k, lang) { return (o && (o[k + '_' + lang] || o[k])) || ''; }
  function isLive(o, now) { return new Date(o.until) > now; }
  // [{ f: festival, offers: [its live offers] }], festivals with nothing live left out, in the order above
  function live(now) {
    now = now || new Date();
    return FESTIVALS.map(function (f) { return { f: f, offers: f.offers.filter(function (o) { return isLive(o, now); }) }; })
      .filter(function (x) { return x.offers.length; });
  }
  // The header link keeps its place all year (people learn where it is): "<Festival> Offers" opening that festival's tab
  // while it has a live offer, plain "Offers" (the page then says new offers are on the way) when nothing is live.
  var ANY = { label: 'Offers', label_hi: 'ऑफ़र', label_gu: 'ઓફર' };
  function menu(lang, now) {
    var x = live(now)[0];
    return x ? { href: 'offers.html?festival=' + x.f.id, label: tr(x.f, 'label', lang), festival: x.f.id }
             : { href: 'offers.html', label: tr(ANY, 'label', lang), festival: null };
  }
  // Pages that are themselves offers (or the offers page): the floating card stays off them.
  function isOfferPage(pathname) {
    var p = String(pathname || '').replace(/\/+$/, '').split('/').pop().replace(/\.html$/, '');
    if (p === 'offers') return true;
    return FESTIVALS.some(function (f) { return f.offers.some(function (o) { return o.href.replace(/\.html$/, '') === p; }); });
  }
  window.SkyOffers = { FESTIVALS: FESTIVALS, tr: tr, live: live, menu: menu, isOfferPage: isOfferPage };
})();
