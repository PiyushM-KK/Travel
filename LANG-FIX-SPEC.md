# Skyline site — 3-language (EN / HI / GU) fix spec

The site translates via `data-en` / `data-hi` / `data-gu` attributes swapped by each Duda widget's
`applyLang()`. Bug: most pages have a **2-way EN↔HI** switcher (Gujarati never wired) and the JS-rendered
**package grid** carries English-only data. `Customize.dc.html` / `Privacy.dc.html` are the gold standard
(full 3-way). This spec makes every page match them. **English stays the default (`lang:'en'`).**

Apply this to a page WITHOUT breaking the Duda widget. Only ADD attributes/fields + swap the switcher.

---

## 1. MECHANISM — put this in the page's `class Component extends DCLogic` (replace the 2-way `applyLang`)

```js
  applyLang() {
    if (!this.rootEl) return;
    const L = this.state.lang;
    const font = L === 'hi' ? "'Noto Sans Devanagari','Plus Jakarta Sans',sans-serif"
               : L === 'gu' ? "'Noto Sans Gujarati','Plus Jakarta Sans',sans-serif" : '';
    this.rootEl.style.fontFamily = font;
    this.rootEl.querySelectorAll('[data-en]').forEach((n) => {
      n.textContent = n.getAttribute('data-' + L) || n.getAttribute('data-en');
    });
    this.rootEl.querySelectorAll('[data-en-ph]').forEach((n) => {
      n.setAttribute('placeholder', n.getAttribute('data-' + L + '-ph') || n.getAttribute('data-en-ph'));
    });
  }
  tr(o, key) { return (o && (o[key + '_' + this.state.lang] || o[key])) || ''; }
  LANGS() { return [{ code:'en', name:'English', mark:'EN' }, { code:'hi', name:'हिंदी', mark:'हिं' }, { code:'gu', name:'ગુજરાતી', mark:'ગુ' }]; }
```

In `renderVals()` (whatever it returns), REPLACE any `langLabel`/`toggleLang` with:
```js
      langLabel: (this.LANGS().find((l) => l.code === this.state.lang) || {}).mark || 'EN',
      langOptions: this.LANGS().map((l) => ({
        name: l.name, mark: l.mark,
        pick: () => this.setState({ lang: l.code }),
        style: 'background:' + (l.code === this.state.lang ? '#EAF5FD' : 'transparent') + ';color:' + (l.code === this.state.lang ? '#0A84D6' : '#0B2440'),
      })),
```
Ensure `state = { lang: 'en', ... }` (default English) and `componentDidUpdate() { this.applyLang(); }` exists,
and the root has `setRoot = (el) => { if (el) { this.rootEl = el; this.applyLang(); } }`.

## 2. SWITCHER MARKUP — replace the old 2-way `<button onClick="{{ toggleLang }}">…{{ langLabel }}</button>` with:
```html
        <div style="display:flex;align-items:center;border:1px solid #E4ECF3;border-radius:10px;overflow:hidden;height:38px" role="group" aria-label="Language">
          <sc-for list="{{ langOptions }}" as="lo" hint-placeholder-count="3">
            <button onClick="{{ lo.pick }}" title="{{ lo.name }}" style="{{ lo.style }};cursor:pointer;font-family:inherit;font-weight:700;font-size:13px;border:0;border-left:1px solid #EEF3F7;padding:0 12px;height:100%">{{ lo.mark }}</button>
          </sc-for>
        </div>
```
Also add the Gujarati font to the page's Google-Fonts `<link>` (append to the family list):
`&family=Noto+Sans+Gujarati:wght@500;600;700`

## 3. STATIC TEXT — add `data-gu` to EVERY element that has `data-en` (and add `data-hi` too if missing).
Use the glossary; translate any page-specific string in the same register (warm, plain). Placeholders use
`data-hi-ph` / `data-gu-ph`.

### Glossary — common UI (EN → HI → GU)
- Domestic Tours → भारत यात्रा → ભારત યાત્રા
- International → विदेश यात्रा → વિદેશ યાત્રા
- Customized → अनुकूलित → કસ્ટમાઇઝ્ડ
- Flights → उड़ानें → ફ્લાઇટ્સ
- Hotels → होटल → હોટેલ
- Trains → ट्रेनें → ટ્રેનો
- Buses → बसें → બસો
- Cabs → कैब → કૅબ
- Home → होम → હોમ
- Customize My Trip → यात्रा बनाएं → યાત્રા બનાવો
- Chat with us → हमसे चैट करें → અમારી સાથે ચેટ કરો
- View → देखें → જુઓ
- From (3★, per person) → शुरू (3★, प्रति व्यक्ति) → થી (3★, વ્યક્તિ દીઠ)
- On request → अनुरोध पर → વિનંતી પર
- Don't see your exact trip? → अपनी यात्रा नहीं मिली? → તમારી ચોક્કસ યાત્રા ન મળી?
- Book on WhatsApp → WhatsApp पर बुक करें → WhatsApp પર બુક કરો
- Back to site → साइट पर वापस → સાઇટ પર પાછા

### Regions (EN → HI → GU)
- North India → उत्तर भारत → ઉત્તર ભારત
- Western India → पश्चिम भारत → પશ્ચિમ ભારત
- East India → पूर्व भारत → પૂર્વ ભારત
- Northeast India → पूर्वोत्तर भारत → ઉત્તરપૂર્વ ભારત
- South India → दक्षिण भारत → દક્ષિણ ભારત
- International → अंतरराष्ट्रीय → આંતરરાષ્ટ્રીય

### Tags (EN → HI → GU)
Heritage → विरासत → વારસો · Family → परिवार → કુટુંબ · Honeymoon → हनीमून → હનીમૂન ·
Off-beat → अनोखा → અનોખું · Wildlife → वन्यजीव → વન્યજીવન · Adventure → रोमांच → સાહસ ·
Couples → जोड़ों के लिए → યુગલો માટે · Spiritual → आध्यात्मिक → આધ્યાત્મિક · Mountains → पर्वत → પર્વતો ·
Scenic → मनोरम → મનોહર · Religious → धार्मिक → ધાર્મિક · Culture → संस्कृति → સંસ્કૃતિ ·
Hill stations → हिल स्टेशन → હિલ સ્ટેશન · Bestseller → बेस्टसेलर → બેસ્ટસેલર · Luxury → लक्ज़री → લક્ઝરી

## 4. GRID — packages carry English `name`/`route`/`tag`. ADD `name_hi/name_gu`, `route_hi/route_gu`,
`tag_hi/tag_gu` to each package object, and in `renderVals` map the collections through `tr()`:
```js
      collections: collections.map((c) => ({ ...c,
        region: this.tr(c,'region'), note: this.tr(c,'note'),
        packages: c.packages.map((p) => ({ ...p, name: this.tr(p,'name'), route: this.tr(p,'route'), tag: this.tr(p,'tag') })) })),
```
(Add `region_hi/region_gu` + `note_hi/note_gu` to each collection too.) Place names in routes are
transliterated (Jaipur → जयपुर → જયપુર). Package name/route/tag translations for every catalogue package:

| Package (name) | name_hi / name_gu | route_hi | route_gu |
|---|---|---|---|
| Royal Rajasthan | शाही राजस्थान / શાહી રાજસ્થાન | जयपुर · जोधपुर · उदयपुर · जैसलमेर | જયપુર · જોધપુર · ઉદયપુર · જેસલમેર |
| Himachal Hills | हिमाचल की पहाड़ियाँ / હિમાચલની ટેકરીઓ | शिमला · मनाली · धर्मशाला | શિમલા · મનાલી · ધર્મશાલા |
| Kashmir Valley | कश्मीर घाटी / કાશ્મીર ખીણ | श्रीनगर · गुलमर्ग · पहलगाम · सोनमर्ग | શ્રીનગર · ગુલમર્ગ · પહલગામ · સોનમર્ગ |
| Kausani & Kumaon | कौसानी और कुमाऊँ / કૌસાની અને કુમાઉં | कौसानी · बैजनाथ · अल्मोड़ा · बागेश्वर | કૌસાની · બૈજનાથ · અલ્મોડા · બાગેશ્વર |
| Nainital · Mussoorie · Corbett | नैनीताल · मसूरी · कॉर्बेट / નૈનીતાલ · મસૂરી · કોર્બેટ | मसूरी · नैनीताल · जिम कॉर्बेट | મસૂરી · નૈનીતાલ · જિમ કોર્બેટ |
| Shimla & Manali | शिमला और मनाली / શિમલા અને મનાલી | शिमला · कुफरी · कुल्लू · सोलंग · मनाली | શિમલા · કુફરી · કુલ્લુ · સોલંગ · મનાલી |
| Untouched Spiti Valley | अछूती स्पीति घाटी / અસ્પૃશ્ય સ્પિતિ ખીણ | नारकंडा · सांगला · छितकुल · ताबो · काज़ा · कल्पा | નારકંડા · સાંગલા · છિતકુલ · તાબો · કાઝા · કલ્પા |
| Gujarat Darshan | गुजरात दर्शन / ગુજરાત દર્શન | द्वारका · सोमनाथ · स्टैच्यू ऑफ यूनिटी · कच्छ | દ્વારકા · સોમનાથ · સ્ટેચ્યુ ઓફ યુનિટી · કચ્છ |
| Goa Getaway | गोवा गेटअवे / ગોવા ગેટવે | उत्तर गोवा · दक्षिण गोवा · समुद्र तट | ઉત્તર ગોવા · દક્ષિણ ગોવા · દરિયાકિનારા |
| Braj & Agra Yatra | ब्रज और आगरा यात्रा / બ્રજ અને આગ્રા યાત્રા | मथुरा · वृंदावन · गोकुल · आगरा | મથુરા · વૃંદાવન · ગોકુલ · આગ્રા |
| Sikkim Discovery | सिक्किम खोज / સિક્કિમ શોધ | गंगटोक · पेलिंग · लाचुंग · उत्तर सिक्किम | ગંગટોક · પેલિંગ · લાચુંગ · ઉત્તર સિક્કિમ |
| Sikkim Honeymoon | सिक्किम हनीमून / સિક્કિમ હનીમૂન | गंगटोक · त्सोमगो झील · पेलिंग | ગંગટોક · ત્સોમ્ગો તળાવ · પેલિંગ |
| Gangtok & Darjeeling | गंगटोक और दार्जिलिंग / ગંગટોક અને દાર્જિલિંગ | दार्जिलिंग · गंगटोक · चाय बागान | દાર્જિલિંગ · ગંગટોક · ચાના બગીચા |
| Sikkim & Darjeeling | सिक्किम और दार्जिलिंग / સિક્કિમ અને દાર્જિલિંગ | गंगटोक · त्सोमगो झील · बाबा मंदिर · दार्जिलिंग | ગંગટોક · ત્સોમ્ગો તળાવ · બાબા મંદિર · દાર્જિલિંગ |
| Meghalaya Wonders | मेघालय के अजूबे / મેઘાલયના અજાયબીઓ | शिलांग · चेरापूंजी · डावकी · मावलिननॉन्ग | શિલોંગ · ચેરાપૂંજી · ડાવકી · માવલિનનોંગ |
| Assam & Kaziranga | असम और काज़ीरंगा / આસામ અને કાઝીરંગા | गुवाहाटी · काज़ीरंगा · माजुली · चाय बागान | ગુવાહાટી · કાઝીરંગા · માજુલી · ચાના બગીચા |
| Arunachal Explorer | अरुणाचल एक्सप्लोरर / અરુણાચલ એક્સપ્લોરર | तवांग · बोमडिला · दिरांग · सेला दर्रा | તવાંગ · બોમડિલા · દિરાંગ · સેલા ઘાટ |
| Nagaland Highlands | नागालैंड हाइलैंड्स / નાગાલેન્ડ હાઇલેન્ડ્સ | कोहिमा · दज़ुकोऊ घाटी · खोनोमा | કોહિમા · ડઝુકોઉ ખીણ · ખોનોમા |
| Manipur & Loktak | मणिपुर और लोकतक / મણિપુર અને લોકતક | इंफाल · लोकतक झील · कांगला · मोइरांग | ઇમ્ફાલ · લોકતક તળાવ · કાંગલા · મોઇરાંગ |
| Mizoram Discovery | मिज़ोरम खोज / મિઝોરમ શોધ | आइज़ोल · रेइक · ह्मुइफांग · वंतावंग | આઇઝોલ · રેઇક · હ્મુઇફાંગ · વંતાવંગ |
| Kerala Backwaters | केरल बैकवाटर्स / કેરળ બેકવોટર્સ | कोच्चि · मुन्नार · थेक्कडी · अलाप्पुझा | કોચી · મુન્નાર · થેક્કડી · અલપ્પુઝા |
| Mysuru–Coorg–Ooty | मैसूर–कूर्ग–ऊटी / મૈસૂર–કૂર્ગ–ઊટી | बेंगलुरु · मैसूर · कूर्ग · ऊटी | બેંગલુરુ · મૈસૂર · કૂર્ગ · ઊટી |
| South Temple Trail | दक्षिण मंदिर यात्रा / દક્ષિણ મંદિર માર્ગ | मदुरै · रामेश्वरम · कन्याकुमारी | મદુરાઈ · રામેશ્વરમ · કન્યાકુમારી |
| Ooty · Coorg · Mysore | ऊटी · कूर्ग · मैसूर / ઊટી · કૂર્ગ · મૈસૂર | मैसूर · कूर्ग · ऊटी · कुन्नूर | મૈસૂર · કૂર્ગ · ઊટી · કુન્નૂર |
| Thailand Explorer | थाईलैंड एक्सप्लोरर / થાઇલેન્ડ એક્સપ્લોરર | बैंकॉक · पटाया · फुकेत · क्राबी | બેંગકોક · પટાયા · ફૂકેત · ક્રાબી |
| Bali Honeymoon | बाली हनीमून / બાલી હનીમૂન | कुटा · उबुद · सेमिन्याक · नुसा पेनिडा | કુટા · ઉબુદ · સેમિન્યાક · નુસા પેનિડા |
| Maldives Escape | मालदीव एस्केप / માલદીવ્સ એસ્કેપ | समुद्र तट या वॉटर विला · माले एटोल | દરિયાકિનારો કે વોટર વિલા · માલે એટોલ |

Collection `note` fields (region subtitles) — translate the `·`-joined place lists the same way.

## 5. RULES
- Do NOT change any English text, prices, links, ids, styles or widget logic — only ADD `data-hi`/`data-gu`
  attributes, the mechanism methods, the switcher markup, and the `_hi`/`_gu` grid fields.
- Keep English canonical: `data-en` and the base `name`/`route`/`price` stay English; the price NEVER changes.
- Every `data-en` element must end with matching `data-hi` AND `data-gu`.
- After editing, the widget `<script>` must still be valid JS (no syntax errors).

---

## 6. ADDENDUM (2026-08-08) — JS-rendered CARD ARRAYS + cross-page persistence

Two gaps the first pass missed — fix these on any NEW page too:

**A. JS-rendered card arrays.** Static `data-en/hi/gu` text swaps fine, but cards built from arrays in
`renderVals()` (e.g. `cabTypes`, `partners`, `services`, `busTypes`, home `destinations`/`styles`/`steps`)
render `{{ x.name }}`/`{{ x.desc }}` straight from English data and DON'T translate. Fix: add `_hi`/`_gu`
siblings to the translatable fields, then map the array through `tr()` in the return, e.g.
`services: services.map((s) => ({ ...s, name: this.tr(s,'name'), desc: this.tr(s,'desc') }))`. Keep BRAND
names (Uber/Ola/IRCTC/redBus…), URLs, icons, prices, numbers as-is. `index.html` uses `const lang =
this.state.lang` (not `data-*`); there add `const tr = (o,k) => (o && (o[k+'_'+lang] || o[k])) || '';`.
Audit a page by rendering `renderVals()` under `state.lang='gu'` and checking every card string is Gujarati.

**B. Language persists across pages (localStorage).** Each page's `state.lang` defaulted to `'en'`, so
navigating reset the language. Every page now:
- initialises `lang: (function(){ try { return localStorage.getItem('skyline_lang') || 'en'; } catch(e){ return 'en'; } })()`
- on the switcher `pick`, writes `try { localStorage.setItem('skyline_lang', code); } catch(e){}` before `setState`.
Use the key **`skyline_lang`** on any new page so the choice carries site-wide.
