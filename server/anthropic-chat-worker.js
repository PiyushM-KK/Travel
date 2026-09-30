/*
 * Skyline Travel Planner — website AI chat backend (Anthropic / Claude) as a Cloudflare Worker
 * =============================================================================
 * Lets the website's "Ask Skyline AI" widget talk to Claude WITHOUT exposing
 * your API key. The key lives here as an encrypted Worker secret — never in the
 * website code, never in the public GitHub repo.
 *
 * ── DEPLOY (Cloudflare dashboard, no command line) ───────────────────────────
 *   1. Your Worker → "Edit code" → select all, delete → paste this whole file → Deploy.
 *   2. Add your Anthropic key as a secret:
 *        Worker → "Settings" → "Variables and Secrets" → "Add"
 *        Type: Secret   Name: ANTHROPIC_API_KEY   Value: sk-ant-...(your key)
 *      Get a key at console.anthropic.com → API keys. Usage is paid per request;
 *      add a small spend limit there. The model is Claude Sonnet 5.5 (see MODEL below).
 *   3. Tell me it's redeployed — I'll test it and wire it into the website.
 *
 * Website calls this with:  POST { "messages": [{role, content}, ...] }
 * and gets back:            { "reply": "..." }
 * =============================================================================
 */

// Claude Sonnet 5.5, live since 2026-09-30 (the owner switched the deployed anthropic-4 the same way). Per Anthropic's
// model page it rejects a non-default temperature with a 400 and thinks by default, hence the request body below.
const MODEL = 'claude-sonnet-5-5';
const VERSION = 'anthropic-7'; // reported by the GET health check

// anthropic-6 (2026-09-30, after an accuracy test of the live assistant): the prompt carries the website's own
// published prices, destinations and seasons (PUBLISHED_PRICES / DESTINATIONS / BEST_SEASONS below, copied from
// Domestic.dc.html, International.dc.html, Destination.dc.html and Package.dc.html), who confirms what, and a
// 120-word limit. They are a SNAPSHOT of those files: after any price or package change on the site, update the
// blocks and run `node server/test-chat-worker.mjs`, which compares them with the site files, before pasting.
// Review fixes, same version (2026-09-30): a reply quoting a figure nobody published - in any written form - is
// replaced by an honest line instead of carrying a note; a figure the visitor typed is no longer taken as published;
// visa/"confirmed" misfires, wider promise net, linear-time checks, refusal line, no upstream error to the visitor,
// and prompt caching on the system prompt.
// Round-2 fixes, same version (2026-09-30): a hedge word elsewhere in the sentence no longer excuses a false Diwali
// inclusion; the honest line quotes the tier ("(3-star)") and gives no figure to a star / hotel / night / group
// question; a typed budget tied to a place or "fits" is no longer exempt; money is read before the markdown strip;
// paise are dropped, not rounded up; blank turns are dropped before the role checks.
// anthropic-7 (2026-09-30, after a live re-test of anthropic-6, run 2): a reply that arrives garbled (one Gujarati reply
// came back as its own UTF-8 bytes read as Windows-1257 text) is asked for ONCE more with the same request, and a fixed
// line replaces it if the second one is garbled too; the prompt forbids flight and travel times and any claim about the
// WhatsApp team's languages, asks for "(3-star)" with every domestic package price, says hotels are confirmed at booking
// by the official provider, and aims for 80-100 words; single-asterisk and underscore italics are stripped as well.
// The booking backstops no longer note a sentence that says who or when confirms, in Hindi and Gujarati too.
const SYSTEM_PROMPT = `You are the Skyline AI Travel Assistant for "Skyline Travel Planner", an India-based travel planning website (WhatsApp +91 8866050291, info@skylinetravelplanner.com). Help with: destination selection, trip duration, preliminary itineraries, hotel-category comparison (3/4/5-star), packing lists, transport recommendations, family/honeymoon/religious/group planning, budget planning, travel-season guidance, and FAQs. The destinations we cover are listed under DESTINATIONS WE COVER below. Reply in the same language the customer writes in (English, Hindi or Gujarati). Never say which languages our WhatsApp team speaks; only you, the assistant, answer in English, Hindi and Gujarati. Prices are in Indian Rupees and ALWAYS "starting from" estimates, never guaranteed. Budget is OPTIONAL — never insist on it and never make the traveller feel they must share money or budget details. If the traveller has not mentioned a budget, still give a genuinely helpful answer using the published starting-from prices listed below (never a made-up range); do NOT repeatedly ask about budget or money. Ask about budget at most once, and only if it would clearly improve your recommendation — otherwise proceed happily without it and simply invite them to the "Customize My Trip" form or WhatsApp for an exact quote. Whenever your reply mentions any prices, budget figures or cost estimates, end that reply with a short one-line note on its own line, such as: "Note: Prices are indicative starting-from estimates and can change with season, hotel availability and current rates." Add this note only when you actually mention prices. Keep replies warm, concise and practical (see the LENGTH limit at the end). After understanding the trip, encourage the user to request a customized package (the website "Customize My Trip" form) or chat on WhatsApp (+91 8866050291) for a quote. NEVER claim to confirm tickets, process payments, guarantee hotel availability, guarantee prices, guarantee visa approval, or give official immigration advice — politely defer those to the team or official provider. Never state flight durations, flying times or travel times between places, not even as an estimate (trip lengths in nights and days are fine). NEVER ask for card, bank, Aadhaar or passport details. Do not invent specific hotel bookings. Keep the "no payments on this website" disclosure when relevant. SAMPLE TOUR PACKAGES you can recommend (all fully customizable; prices are indicative "starting from" and shared on request via the "Customize My Trip" form or WhatsApp — never quote a fixed figure for these EXCEPT where a "from" price is stated below): (1) Nainital · Mussoorie · Jim Corbett — 6N/7D, Uttarakhand: Mussoorie sightseeing (Kempty Falls, Gun Hill), Nainital lake tour (Bhimtal, Sattal, Naukuchiatal), Jim Corbett jeep safari. (2) Ooty · Coorg · Mysore — 5N/6D, South India: Mysore Palace & Brindavan Gardens, Coorg (Abbey Falls, Talacauvery), Ooty & Coonoor. (3) Sikkim · Darjeeling — 5N/6D: Gangtok, Tsomgo Lake & New Baba Mandir, Darjeeling Tiger Hill sunrise. (4) Shimla · Manali — 5N/6D, from ₹10,999 per person (indicative starting-from), Himachal: Shimla–Kufri, Kullu valley, Solang Valley, Manali (Hadimba Temple, Vashisht). (5) Untouched Spiti Valley — 8N/9D, Himachal: Narkanda, Sangla–Chitkul, Nako–Tabo, Kaza (Key Monastery, Hikkim highest post office), Kalpa. When a traveller asks about any of these regions, mention the matching package and its nights, then invite them to the Domestic tours page or the "Customize My Trip" form / WhatsApp for a tailored quote.`;

// PUBLISHED PRICES, DESTINATIONS and BEST SEASONS: copied by script (not typed) from the site files on 2026-09-30.
// Packages and "From (3★, per person)" prices: Domestic.dc.html. "From, per person": International.dc.html.
// Destination "From ... per person", trip lengths, places and "Best time": Destination.dc.html (index.html carries
// the same figures). Spiti season: Package.dc.html. Destinations on the custom-trip form: Customize.dc.html.
// Source of the Shimla & Manali upper figure (₹15,000 or more): owner, 2026-09-30 - not a site file. It is the only
// upper figure allowed. Destination-level figures that disagree with the same place's package prices (Kashmir,
// Uttarakhand, Sikkim and the six North-East states) are left out until the owner reconciles the pages.
const PUBLISHED_PRICES = `PUBLISHED STARTING PRICES - per person, in Indian Rupees, exactly as our website shows them. These are the ONLY rupee figures you may quote (plus the festive offer's price, if a festive offer is listed below). Quote a figure exactly as written, per person, with its package name and nights (for a destination-page figure, its trip length). A domestic package figure is a 3-star price: always write "(3-star)" right after it. Never invent any other figure: no ranges, no 4-star or 5-star prices, no per-night hotel rates, no totals for a group, no flight or ticket prices, and no inclusions (what a package includes is confirmed with the quote). For anything not listed here, say our team quotes it on WhatsApp (+91 8866050291) or through the "Customize My Trip" form. When asked whether we have a package for a place, name the matching package with its nights and from-price first, then offer to customize it.
Domestic tour packages (Domestic tours page, shown as "From (3★, per person)"):
North India (Rajasthan · Himachal · Uttarakhand · Kashmir · Uttar Pradesh):
- Royal Rajasthan, 7N / 8D (Jaipur · Jodhpur · Udaipur · Jaisalmer): from ₹24,900 (3★).
- Himachal Hills, 6N / 7D (Shimla · Manali · Dharamshala): from ₹21,500 (3★).
- Kashmir Valley, 5N / 6D (Srinagar · Gulmarg · Pahalgam · Sonamarg): from ₹27,800 (3★).
- Kausani & Kumaon, 5N / 6D (Kausani · Baijnath · Almora · Bageshwar): from ₹19,700 (3★).
- Nainital · Mussoorie · Corbett, 6N / 7D (Mussoorie · Nainital · Jim Corbett): price on request (no published figure).
- Shimla & Manali, 5N / 6D (Shimla · Kufri · Kullu · Solang · Manali): from ₹10,999 per person (3-star); higher hotel tiers or dates can take it to ₹15,000 or more - our team quotes the exact figure.
- Untouched Spiti Valley, 8N / 9D (Narkanda · Sangla · Chitkul · Tabo · Kaza · Kalpa): price on request (no published figure).
Western India (Gujarat · Goa):
- Gujarat Darshan, 6N / 7D (Dwarka · Somnath · Statue of Unity · Kutch): from ₹22,400 (3★).
- Goa Getaway, 4N / 5D (North Goa · South Goa · Beaches): from ₹9,999 (3★).
- Braj & Agra Yatra, 3N / 4D (Mathura · Vrindavan · Gokul · Agra): from ₹12,500 (3★).
East India (Sikkim & the Himalayas):
- Sikkim Discovery, 6N / 7D (Gangtok · Pelling · Lachung · North Sikkim): from ₹25,600 (3★).
- Sikkim Honeymoon, 5N / 6D (Gangtok · Tsomgo Lake · Pelling): from ₹23,200 (3★).
- Gangtok & Darjeeling, 6N / 7D (Darjeeling · Gangtok · Tea gardens): from ₹24,100 (3★).
- Sikkim & Darjeeling, 5N / 6D (Gangtok · Tsomgo Lake · Baba Mandir · Darjeeling): price on request (no published figure).
Northeast India (Meghalaya · Assam · Arunachal · Nagaland · Manipur · Mizoram):
- Meghalaya Wonders, 6N / 7D (Shillong · Cherrapunji · Dawki · Mawlynnong): from ₹28,900 (3★).
- Assam & Kaziranga, 5N / 6D (Guwahati · Kaziranga · Majuli · Tea gardens): from ₹26,400 (3★).
- Arunachal Explorer, 7N / 8D (Tawang · Bomdila · Dirang · Sela Pass): from ₹34,500 (3★).
- Nagaland Highlands, 6N / 7D (Kohima · Dzukou Valley · Khonoma): from ₹29,800 (3★).
- Manipur & Loktak, 5N / 6D (Imphal · Loktak Lake · Kangla · Moirang): from ₹27,600 (3★).
- Mizoram Discovery, 6N / 7D (Aizawl · Reiek · Hmuifang · Vantawng): from ₹30,200 (3★).
South India (Kerala · Karnataka & the Nilgiris · Tamil Nadu):
- Kerala Backwaters, 6N / 7D (Kochi · Munnar · Thekkady · Alappuzha): from ₹23,900 (3★).
- Mysuru–Coorg–Ooty, 6N / 7D (Bengaluru · Mysuru · Coorg · Ooty): from ₹20,800 (3★).
- South Temple Trail, 5N / 6D (Madurai · Rameswaram · Kanyakumari): from ₹19,400 (3★).
- Ooty · Coorg · Mysore, 5N / 6D (Mysore · Coorg · Ooty · Coonoor): price on request (no published figure).
International packages (International page, shown as "From, per person"):
- Thailand Explorer, 6N / 7D (Bangkok · Pattaya · Phuket · Krabi): from ₹42,000.
- Bali Honeymoon, 6N / 7D (Kuta · Ubud · Seminyak · Nusa Penida): from ₹46,000.
- Maldives Escape, 4N / 5D (Beach or overwater villa · Male atolls): from ₹58,000.
Destination pages (a destination's "From ... per person" for the trip length shown):
- Rajasthan (4–7 days): from ₹18,000.
- Himachal Pradesh (5–7 days): from ₹10,999.
- Kerala (4–5 days): from ₹18,000.
- Goa (3–5 days): from ₹9,999.
- Ooty & Nilgiris (3–4 days): from ₹12,000.
- Mysuru & Coorg (3–4 days): from ₹13,000.
- Agra & Taj Mahal (2–3 days): from ₹9,000.
- Thailand (5–7 days): from ₹42,000.
- Bali (5–7 days): from ₹46,000.
- Maldives (4–6 days): from ₹58,000.
- Kashmir, Uttarakhand, Meghalaya, Assam · Kaziranga, Arunachal Pradesh, Nagaland, Manipur · Loktak, Mizoram, Sikkim: no destination-level figure - for these places quote ONLY the named packages above, with their nights.`;

const DESTINATIONS = `DESTINATIONS WE COVER (our website's own list). When asked what we cover, name these; do not add places that are not here.
- North India: Rajasthan · Himachal · Uttarakhand · Kashmir · Uttar Pradesh.
- Western India: Gujarat · Goa.
- East India: Sikkim & the Himalayas (Gangtok and Darjeeling).
- Northeast India: Meghalaya · Assam · Arunachal · Nagaland · Manipur · Mizoram.
- South India: Kerala · Karnataka & the Nilgiris · Tamil Nadu.
- International: Thailand, Bali, Maldives.
- Also on our "Customize My Trip" form, as custom trips with no package or published price: Varanasi, Amritsar, Tirupati, Char Dham, Shirdi.
Places on our destination pages: Rajasthan: Jaipur, Udaipur, Jodhpur, Jaisalmer; Himachal Pradesh: Shimla, Manali, Dharamshala & McLeodganj, Kasol & Parvati Valley; Kashmir: Srinagar, Gulmarg, Pahalgam, Sonamarg; Kerala: Munnar, Alleppey, Thekkady, Kochi; Goa: North Goa, South Goa, Old Goa, Dudhsagar Falls; Ooty & Nilgiris: Ooty, Coonoor, Doddabetta Peak, Tea Estates; Mysuru & Coorg: Mysore Palace, Chamundi Hills, Coorg, Dubare Camp; Agra & Taj Mahal: Taj Mahal, Agra Fort, Fatehpur Sikri, Mathura & Vrindavan; Uttarakhand: Nainital, Kausani, Mukteshwar, Jim Corbett; Thailand: Bangkok, Phuket & Krabi, Pattaya, Chiang Mai; Bali: Ubud, Seminyak & Kuta, Nusa Penida, Uluwatu; Maldives: Male Atolls, Resort Islands, Maafushi, House Reefs; Meghalaya: Shillong, Cherrapunji (Sohra), Dawki, Mawlynnong; Assam · Kaziranga: Kaziranga National Park, Guwahati, Jorhat & Tea Gardens, Majuli; Arunachal Pradesh: Tawang, Nuranang Falls, Sela Pass, Ziro Valley; Nagaland: Kohima, Dzükou Valley, Khonoma, Kisama Heritage Village; Manipur · Loktak: Loktak Lake, Keibul Lamjao, Imphal, Sendra Island; Mizoram: Aizawl, Vantawng Falls, Reiek, Hmuifang; Sikkim: Gangtok, Tsomgo Lake & Nathu La, Pelling, Lachung & Yumthang.
When you suggest places or sketch an itinerary, build it from these places and the package routes above. If a traveller asks for somewhere not named here, do not present it as one of our tours; say our team can check whether it can be added to a custom trip.`;

const BEST_SEASONS = `BEST TIME TO VISIT, as our destination pages publish it: Rajasthan: Oct–Mar; Himachal Pradesh: Mar–Jun · Dec–Feb (snow); Kashmir: Mar–Oct · tulips in Apr · snow Dec–Feb; Kerala: Sep–Mar; Goa: Nov–Feb; Ooty & Nilgiris: Oct–Jun; Mysuru & Coorg: Oct–Mar; Agra & Taj Mahal: Oct–Mar; Uttarakhand: Mar–Jun · Sep–Nov; Thailand: Nov–Mar; Bali: Apr–Oct; Maldives: Nov–Apr; Meghalaya: Oct–Apr; Assam · Kaziranga: Nov–Apr; Arunachal Pradesh: Oct–Apr; Nagaland: Oct–Apr · Hornbill in Dec; Manipur · Loktak: Oct–Mar; Mizoram: Oct–Mar; Sikkim: Mar–May · Oct–Dec.
Untouched Spiti Valley package page: best season May-Oct. For a place with no season listed here, give brief general guidance and suggest confirming timing with our team.`;

// Who confirms what (the International page: "Visas, flights and hotel availability are confirmed by the official
// provider, never on this website"). The live assistant said "Bookings and confirmations are handled by our travel team".
const CONFIRMATIONS = `CONFIRMATIONS: Flights, trains, buses and hotel availability are confirmed by the official provider, never on this website; our team sends the itinerary and quote and confirms the plan with the traveller directly. Never say that you or our team issue tickets or confirm bookings, seats or hotel availability. Hotels and their availability are confirmed at booking by the official provider, never "in your quote".`;

// Last in the prompt on purpose (it replaced the older "under 130 words"; the live replies ran to 153 words). anthropic-7:
// the run-2 replies still ran to 134-160 words against a bare limit of 120, so the rule now also gives a target.
const LENGTH_RULE = `LENGTH: Aim for 80-100 words; hard limit 120 words and at most two questions.`;

// Diwali in Bali (diwali-bali.html). Facts copied from the offer page - never add to them here.
const DIWALI_BALI = `CURRENT FESTIVE OFFER - "Diwali in Bali", 7N/8D, departs Tuesday 3 November 2026, return flights on Singapore Airlines from Ahmedabad (connecting through Singapore), from ₹1,15,000 per person (indicative starting-from). Stays, all "or similar" and confirmed at booking: 4 nights Kuta (Fairfield by Marriott, Nagraa or Legian; Deluxe room), 1 night Ubud (Mara River Safari Lodge; Savala Deluxe room, with a Jungle Hopper pass), 2 nights Jimbaran (Royal Tulip; a one-bedroom villa with its own private pool). Itinerary: Day 1 arrive, garland welcome, private transfer to Kuta. Day 2 water sports (jet ski, banana boat, parasailing), then Uluwatu Temple at sunset. Day 3 full-day Ubud tour with Tanah Lot and Ulun Danu temples. Day 4 free day. Day 5 transfer to Mara River Safari Lodge. Day 6 is Diwali, Sunday 8 November: Bali Swing and Tegenungan Waterfall, then the Jimbaran pool villa. Day 7 free day at the villa. Day 8 transfer for the flight home. Included: return Singapore Airlines flights from Ahmedabad; 7 nights' stay as per the itinerary; daily breakfast; all transfers and sightseeing on a private basis; entrance fees as per the itinerary; garland welcome and daily mineral water. Nothing else is included in this list - if asked about anything not listed (for example visa, travel insurance, lunch or dinner), say it is not listed and the team will confirm on WhatsApp. Mara River Safari Lodge is not a Marriott property. When a traveller asks about Bali, Diwali or festive trips, mention this offer, share https://skylinetravelplanner.com/diwali-bali.html, and invite them to enquire there or on WhatsApp (+91 8866050291) for availability and the exact price.`;
const DIWALI_BALI_DEPARTED = `The "Diwali in Bali" trip that departed on 3 November 2026 has already left. If a traveller asks about it, say so kindly, do not quote its price, and offer to plan a custom Bali trip through the "Customize My Trip" form or WhatsApp.`;
// Offered until departure day; then only "it has left"; from 9 Nov 2026 00:00 IST (when diwali-promo.js hides
// the site card) not mentioned at all. Nothing to remove afterwards - the dates retire it.
const DIWALI_BALI_DEPARTS = Date.parse('2026-11-03T00:00:00+05:30');
const DIWALI_BALI_UNTIL = Date.parse('2026-11-09T00:00:00+05:30');

function offerState(now) {
  if (now < DIWALI_BALI_DEPARTS) return 'diwali-bali';
  if (now < DIWALI_BALI_UNTIL) return 'diwali-bali-departed';
  return 'none';
}

function systemPromptFor(now) {
  const parts = [SYSTEM_PROMPT, PUBLISHED_PRICES, DESTINATIONS, BEST_SEASONS, CONFIRMATIONS];
  const state = offerState(now);
  if (state === 'diwali-bali') parts.push(DIWALI_BALI);
  if (state === 'diwali-bali-departed') parts.push(DIWALI_BALI_DEPARTED);
  parts.push(LENGTH_RULE);
  return parts.join('\n\n');
}

// Code backstops for the offer's checkable facts (a prompt alone can be talked out of them): a rupee figure under
// the from-price is a discount nobody offered, and a meal/visa/insurance "included" is an inclusion nobody listed.
const DIWALI_FROM_INR = 115000;
const DIWALI_INCLUDED_NOTE = '\n\n(To be clear: this package includes return flights, 7 nights\' stay, daily breakfast, private transfers and sightseeing, entrance fees as per the itinerary, and a garland welcome with daily mineral water. Anything else, such as other meals, visa or insurance, is confirmed by our team on WhatsApp at +91 88660 50291.)';
// A reply that quotes an unpublished figure, or a Diwali price under the offer, is REPLACED by this line (review of
// anthropic-6: a note after a wrong figure still shows the wrong figure). A published figure is added only when the
// traveller's question names exactly one priced package (honestPriceReply).
const HONEST_PRICE_LINE = 'I can share only the starting prices published on our website. Our team will send an exact quote on WhatsApp at +91 88660 50291.';

// Replies come in English, Hindi or Gujarati, so every check below knows all three. (\b is ASCII-only in JS, so the
// Devanagari/Gujarati words sit outside the \b groups.)
// A sentence ends at . ! ? or the danda followed by space, or a newline - but "Rs. 92,000" / "रु. 5,000" is not a sentence end.
const SENTENCE_BREAK = /(?<=[.!?।])(?<!\b[Rr][Ss]\.)(?<!(?:रु|रू|રૂ)\.)\s+|\n+/g;
const OFFER_ITEMS = /\b(lunch(es)?|dinners?|meals?|visas?|insurance)\b|लंच|डिनर|खाना|भोजन|वीज़ा|वीजा|बीमा|લંચ|ડિનર|ભોજન|જમવાનું|વિઝા|વીમો/gi;
const VISA_ITEM = /^(?:visas?|वीज़ा|वीजा|વિઝા)$/i;
// An inclusion CLAIM must be assertive: "includes", "including", "comes with", "is/are/comes ... included/covered/free",
// "Included:". A bare "free" (the Q8 misfire: "visa on arrival is free for ...") is no longer enough.
const INCLUDED_CLAIM = /\b(?:includes|including|(?:does|do|will)\s+include|comes?\s+with)\b|(?:\b(?:is|are|comes?)|'s|’s)\s+(?:[a-z]+\s+){0,3}?(?:included|covered|free)\b|\bincluded\s*:|शामिल|सम्मिलित|इनक्लूड|સામેલ|શામેલ|સમાવેશ|ઇન્ક્લુડ/i;
// Visa-on-arrival / visa-free ADVICE is about the country, not the package: its visa mention is never an inclusion.
const VISA_ADVICE = /\barrival\b|\bvisa[-\s]?free\b|अराइवल|आगमन|वीज़ा[-\s]?फ्री|અરાઇવલ|આગમન|વિઝા[-\s]?ફ્રી/i;
const QUESTION_END = /\?["'”’)\]]*\s*$/;
const OFFER_WORDS = /bali|diwali|deepavali|बाली|दिवाली|दीपावली|બાલી|દિવાળી|દીવાળી/gi;
// Every other place the prompt now lists (anthropic-6), so a published price for, say, Meghalaya after a Bali mention
// is judged by Meghalaya. English names must start a word ("pelling" is not in "spelling"); असम must end one (असमर्थ).
const OTHER_PLACES = /\b(?:rajasthan|himachal|kashmir|kerala|goa|sikkim|mysuru|mysore|coorg|ooty|mathura|vrindavan|agra|gujarat|uttar pradesh|uttarakhand|thailand|maldives|nainital|mussoorie|corbett|darjeeling|gangtok|shimla|manali|kullu|spiti|meghalaya|shillong|cherrapunji|assam|kaziranga|guwahati|arunachal|tawang|nagaland|kohima|manipur|loktak|imphal|mizoram|aizawl|kausani|kumaon|almora|dharamshala|srinagar|gulmarg|pahalgam|jaipur|jodhpur|udaipur|jaisalmer|dwarka|somnath|kutch|braj|pelling|kochi|munnar|thekkady|alappuzha|alleppey|madurai|rameswaram|kanyakumari|bengaluru|bangkok|pattaya|phuket|krabi|varanasi|amritsar|tirupati|char dham|shirdi)|शिमला|मनाली|गोवा|केरल|कश्मीर|थाईलैंड|मालदीव|राजस्थान|हिमाचल|उत्तराखंड|सिक्किम|दार्जिलिंग|गंगटोक|मेघालय|असम(?![\u0900-\u097F])|काज़ीरंगा|अरुणाचल|नागालैंड|मणिपुर|मिज़ोरम|मिजोरम|गुजरात|आगरा|मथुरा|वृंदावन|ऊटी|कूर्ग|मैसूर|स्पीति|कौसानी|नैनीताल|जयपुर|उदयपुर|कोच्चि|मुन्नार|શિમલા|મનાલી|ગોવા|કેરળ|કાશ્મીર|થાઈલેન્ડ|થાઇલેન્ડ|માલદીવ|રાજસ્થાન|હિમાચલ|ઉત્તરાખંડ|સિક્કિમ|દાર્જિલિંગ|ગંગટોક|મેઘાલય|આસામ|કાઝીરંગા|અરુણાચલ|નાગાલેન્ડ|મણિપુર|મિઝોરમ|ગુજરાત|આગ્રા|મથુરા|વૃંદાવન|ઊટી|કૂર્ગ|મૈસૂર|સ્પિતિ|કૌસાની|નૈનીતાલ|જયપુર|ઉદયપુર|કોચી|મુન્નાર/gi;
// A hedge excuses an offer item only in the clause that governs it (review round 2: "Yes, please confirm - the package
// includes dinners and visa", "If you like, Diwali in Bali includes dinner" and "...includes lunch, and we confirm it"
// were excused by a hedge elsewhere in the sentence). NEGATORS count anywhere in that clause; FRAMERS ("if", "whether",
// "ask") only before its claim ("Ask whether it includes lunch" - not "includes dinner if you like"); "confirm" never
// does. "At no extra cost" / "free of charge" affirm an inclusion, so they are not negations.
const NEGATORS = /\b(?:not|no|never|excluded|extra|separate(?:ly)?|additional|except|cannot|unless|only\s+if|(?:your|their)\s+own)\b|n't|n’t|नहीं|अलग|अतिरिक्त|નથી|નહીં|અલગ|વધારાન/i;
const FRAMERS = /\b(?:if|whether|ask|asking)\b|अगर|यदि|पूछ|પૂછ/i;
const AFFIRMING = /\b(?:at\s+)?no\s+(?:extra|additional|added)\s+(?:cost|charge|fee|price)s?\b|\bat\s+no\s+(?:cost|charge)\b|\bfree\s+of\s+(?:cost|charge)\b|\bwithout\s+(?:any\s+)?(?:extra|additional)\s+(?:cost|charge|fee)s?\b|बिना\s+(?:किसी\s+)?अतिरिक्त\s+(?:शुल्क|खर्च|चार्ज|लागत)|कोई\s+अतिरिक्त\s+(?:शुल्क|खर्च|चार्ज)\s+नहीं|વધારાના\s+(?:ખર્ચ|ચાર્જ)\s+વિના|કોઈ\s+વધારાનો\s+(?:ખર્ચ|ચાર્જ)\s+નહીં/gi;
// Sentence-wide, for the Hindi/Gujarati booking check only.
const NEGATION = new RegExp(`${NEGATORS.source}|${FRAMERS.source}`, 'i');
// Clauses: segments end at ; : dashes or "but"; inside a segment, commas (not the ones inside a number) end a clause.
const SEGMENT_BREAK = /[;:—–]|\s-\s|\bbut\b|लेकिन|किंतु|परंतु|પરંતુ/gi;
const COMMA = /(?<!\d),|,(?!\d)/g;
// A clause with a verb that does not open with a conjunction can be the predicate of the list before it ("Visa,
// insurance and lunch are not included"); "..., and visa is not needed" or "..., not visa" cannot.
const PREDICATE = /\b(?:is|are|was|were|be|been|comes?|includes?|including|included|covered|costs?|needs?|has|have|do|does|did|will|would|can|could|must|should|may|might|gets?)\b|n't|n’t|है|हैं|था|थे|होगा|होगी|होंगे|છે|હતું|હશે|નથી/i;
const JOINER = /^\s*(?:(?:and|or|so|which|that|then|while|plus|as|because|though|although)\b|(?:और|तथा|जबकि|અને|જ્યારે)\s)/i;
// A claim that takes a list after it: "includes breakfast, lunch and dinner, visa is not included" - the list is its.
const TRANSITIVE = /\b(?:includes|include|including|comes?\s+with)\b|\bincluded\s*:/i;

function sentences(text) {
  const out = []; let start = 0;
  for (const m of text.matchAll(SENTENCE_BREAK)) { out.push({ start, end: m.index }); start = m.index + m[0].length; }
  out.push({ start, end: text.length });
  return out;
}

// ---- money in a reply --------------------------------------------------------------------------------------------
// Every way a figure gets written (review of anthropic-6): a currency before the number (₹, Rs, INR, रु., રૂ., $, USD)
// or a unit after it (rupees, rs, /-, रुपये, रुपए, रु, રૂપિયા, ₹, INR); a k / lakh multiplier on its own ("5k",
// "1.5 lakh", "92k"); and both ends of a range ("₹9,999-14,999", "₹9,999 to 12,500", "12-15k"). Devanagari and
// Gujarati digits are read as ASCII first; each is one UTF-16 unit, so every index still points into the original.
const asciiDigits = (s) => s.replace(/[\u0966-\u096F\u0AE6-\u0AEF]/g, (c) => String(c.charCodeAt(0) - (c < '\u0A00' ? 0x0966 : 0x0AE6)));
const NUMBER = /(\d[\d,]*(?:\.\d+)?)(?:\s*(k|lakhs?|lacs?|लाख|લાખ)(?![a-z\u0900-\u097F\u0A80-\u0AFF]))?/gi;
const CURRENCY_BEFORE = /(?:₹|\$|(?:^|[^a-z])(?:rs\.?|inr|usd)|(?:रु|रू|રૂ)\.?)\s*$/i;
// A unit AFTER a number - unless another number follows it, which makes it that number's prefix ("Day 2 ₹500").
const CURRENCY_AFTER = /^\s*(?:rupees?\b|\/-|रुपये|रुपए|रुपया|रुपयों|રૂપિયા|(?:rs\b|inr\b|usd\b|(?:रु|रू)(?![\u0900-\u097F])|રૂ(?![\u0A80-\u0AFF])|₹)(?!\.?\s*\d))/i;
const RANGE_JOIN = /^\s*(?:-|–|—|to|से|થી)\s*(?:₹|\$|rs\.?|inr|usd|(?:रु|रू|રૂ)\.?)?\s*$/i;
const HEADCOUNT_AFTER = /^\s*(?:people|persons|devotees|visitors|pilgrims|tourists|travell?ers|लोग|श्रद्धालु|લોકો|ભક્તો|યાત્રાળુ)/i;

// [{ at, n, hi? }]: where each money figure starts in the text, its value in whole units, and - on the low end of a
// range - the high end's value.
function moneyFigures(raw) {
  const text = asciiDigits(raw);
  const toks = [];
  for (const m of text.matchAll(NUMBER)) {
    const num = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(num)) continue;
    const unit = (m[2] || '').toLowerCase();
    const mult = unit === 'k' ? 1000 : unit ? 100000 : 1;
    const at = m.index, end = m.index + m[0].length, after = text.slice(end, end + 16);
    const marked = CURRENCY_BEFORE.test(text.slice(Math.max(0, at - 10), at)) || CURRENCY_AFTER.test(after);
    // Paise are dropped, never rounded up ("₹1,15,000.50" is ₹1,15,000, not ₹1,15,001); "1.15 lakh" is rounded only to
    // undo floating-point error (1.15 * 100000 = 114999.99...).
    toks.push({ at, end, num, mult, n: mult === 1 ? Math.floor(num) : Math.round(num * mult), money: marked || (mult > 1 && !HEADCOUNT_AFTER.test(after)) });
  }
  // Both ends of a range are money when either end is. "12-15k" is 12,000-15,000; "Option 1 - ₹9,999" is no range.
  for (let i = 0; i + 1 < toks.length; i++) {
    const a = toks[i], b = toks[i + 1];
    if (!(a.money || b.money) || !RANGE_JOIN.test(text.slice(a.end, b.at))) continue;
    const lo = a.mult === 1 && b.mult > 1 && a.num * b.mult <= b.n ? Math.round(a.num * b.mult) : a.n;
    if (lo <= b.n && lo * 20 >= b.n) { a.n = lo; a.hi = b.n; a.money = b.money = true; }
  }
  return toks.filter((t) => t.money).map(({ at, n, hi }) => (hi === undefined ? { at, n } : { at, n, hi }));
}

// ---- is this spot in the reply about the offer? ------------------------------------------------------------------
// It is about the last place named before it anywhere in the reply ("Diwali in Bali is here! Only Rs 92,000" - Bali;
// "...Bali. Our Kerala houseboat includes lunch" - Kerala); when nothing is named before it, the first place named
// later in its own sentence ("Only Rs 92,000 for Diwali in Bali"). The places are indexed ONCE per reply and looked up
// by binary search (review of anthropic-6: slicing the reply per figure was quadratic).
function placeIndex(text) {
  return { offer: [...text.matchAll(OFFER_WORDS)].map((m) => m.index), other: [...text.matchAll(OTHER_PLACES)].map((m) => m.index) };
}
function lastBefore(arr, at) { // the largest index < at, or -1
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < at) lo = mid + 1; else hi = mid; }
  return lo ? arr[lo - 1] : -1;
}
function firstIn(arr, at, end) { // the smallest index in [at, end), or -1
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < at) lo = mid + 1; else hi = mid; }
  return lo < arr.length && arr[lo] < end ? arr[lo] : -1;
}
function aboutTheOffer(places, at, sentenceEnd) {
  const o = lastBefore(places.offer, at), p = lastBefore(places.other, at);
  if (o >= 0 || p >= 0) return o > p;
  const o2 = firstIn(places.offer, at, sentenceEnd), p2 = firstIn(places.other, at, sentenceEnd);
  return o2 >= 0 && (p2 < 0 || o2 < p2);
}
const INDIC_BOOKING_CLAIM = /(बुकिंग|सीट|टिकट|બુકિંગ|સીટ|ટિકિટ)[^.।!?\n]{0,40}(कन्फर्म|पक्की|पक्का|रिज़र्व|रिजर्व|होल्ड|કન્ફર્મ|પાકી|પાકું|રિઝર્વ|હોલ્ડ)|(कन्फर्म|रिज़र्व|रिजर्व|होल्ड)\s*(कर\s*(दी|दिया|दिए)|हो\s*(गई|गया))|(કન્ફર્મ|રિઝર્વ|હોલ્ડ)\s*(કરી|થઈ)/;

// Bali's own published figures (the Bali Honeymoon package and the Bali destination page), read from the price list.
// Quoted in a sentence that names no Diwali word - or right after "honeymoon" - such a figure is that package, not a
// discount on the offer; "Diwali in Bali from ₹46,000" is still caught.
const BALI_PUBLISHED_INR = new Set(PUBLISHED_PRICES.split('\n').filter((l) => /\bbali\b/i.test(l)).flatMap((l) => moneyFigures(l).map((f) => f.n)));
const DIWALI_WORDS = /diwali|deepavali|festive|दिवाली|दीपावली|દિવાળી|દીવાળી/i;
const HONEYMOON = /honeymoon|हनीमून|હનીમૂન/i;
const isBaliPackageFigure = (n, s, at) => BALI_PUBLISHED_INR.has(n) && (!DIWALI_WORDS.test(s) || HONEYMOON.test(s.slice(Math.max(0, at - 60), at)));

function clausesOf(s) {
  const out = [];
  const add = (start, end, seg) => {
    const text = s.slice(start, end), claim = INCLUDED_CLAIM.exec(text), framer = FRAMERS.exec(text);
    const neg = NEGATORS.test(text.replace(AFFIRMING, ' '));
    out.push({ start, end, seg, neg, claim: claim ? claim.index : -1, framer: framer ? framer.index : -1, decisive: !!claim || neg,
      pred: PREDICATE.test(text), joiner: JOINER.test(text), trans: TRANSITIVE.test(text), colon: /:\s*$/.test(text) });
  };
  const segment = (a, b, seg) => {
    let from = a;
    for (const m of s.slice(a, b).matchAll(COMMA)) { add(from, a + m.index + 1, seg); from = a + m.index + 1; }
    add(from, b, seg);
  };
  let from = 0, seg = 0;
  for (const m of s.matchAll(SEGMENT_BREAK)) { const e = m.index + m[0].length; segment(from, e, seg++); from = e; }
  segment(from, s.length, seg);
  return out;
}
const hedgedClause = (c) => c.neg || (c.framer >= 0 && c.claim >= 0 && c.framer < c.claim);
// The clause that says whether the item at cs[k] is included: its own clause when that one claims or negates;
// otherwise, for a list: the "includes" clause it follows ("includes breakfast, lunch and dinner, visa is not
// included"), else the verb clause after it ("Visa, insurance and lunch are not included"; "..., and lunch, dinner and
// visa are extra"), else the clause before it ("..., not visa"), else the head of a colon list ("Not included: visa").
function governing(cs, k) {
  const c = cs[k];
  if (c.decisive) return c;
  let j = k + 1; while (j < cs.length && cs[j].seg === c.seg && !cs[j].decisive) j++;
  const next = j < cs.length && cs[j].seg === c.seg ? cs[j] : null;
  let i = k - 1; while (i >= 0 && cs[i].seg === c.seg && !cs[i].decisive) i--;
  const prev = i >= 0 && cs[i].seg === c.seg ? cs[i] : null;
  if (prev && prev.trans && !cs[i + 1].joiner) return prev;
  if (next && next.pred && !next.joiner) return next;
  if (prev || next) return prev || next;
  if (i >= 0 && cs[i].colon) for (let h = i; h >= 0 && cs[h].seg === cs[i].seg; h--) if (cs[h].decisive) return cs[h];
  return null;
}

// Index (in s) of an offer item the sentence claims is included, or -1. Not a claim: a question, an item whose
// governing clause is hedged or negated, or visa-on-arrival / visa-free advice (its visa mention; a meal claimed in
// the same sentence still counts).
function claimedExtraAt(s) {
  if (QUESTION_END.test(s) || !INCLUDED_CLAIM.test(s)) return -1;
  const advice = VISA_ADVICE.test(s);
  let cs = null, k = 0;
  for (const m of s.matchAll(OFFER_ITEMS)) {
    if (advice && VISA_ITEM.test(m[0])) continue;
    if (!cs) cs = clausesOf(s);
    while (cs[k].end <= m.index) k++;
    const own = cs[k];
    if (!own.decisive && own.framer >= 0 && own.start + own.framer < m.index) continue; // "Ask whether lunch, ..."
    const gov = governing(cs, k);
    if (gov ? !hedgedClause(gov) : cs.some((c) => c.claim >= 0 && !hedgedClause(c))) return m.index;
  }
  return -1;
}

function diwaliChecks(reply, figures, now) {
  const found = { lowPrice: false, extra: false };
  if (offerState(now) === 'none') return found;
  const places = placeIndex(reply);
  let f = 0;
  for (const { start, end } of sentences(reply)) {
    const s = reply.slice(start, end);
    for (; f < figures.length && figures[f].at < end; f++) {
      const { at, n } = figures[f];
      if (!found.lowPrice && at >= start && n > 0 && n < DIWALI_FROM_INR && !isBaliPackageFigure(n, s, at - start) && aboutTheOffer(places, at, end)) found.lowPrice = true;
    }
    const item = found.extra ? -1 : claimedExtraAt(s);
    if (item >= 0 && aboutTheOffer(places, start + item, end)) found.extra = true;
  }
  return found;
}

// ---- figures nobody published ------------------------------------------------------------------------------------
// A money figure that is not one of the prompt's published figures (the live assistant invented "3-star from
// ₹12,000-15,000", "₹20,000-30,000" and per-night hotel rates). Only the PROMPT's figures are known (review of
// anthropic-6: a figure the traveller typed was being confirmed as a price - "Goa costs Rs 4999 on your site, right?").
// A RANGE is published only when both ends stand on one line of the prompt (today only Shimla & Manali, ₹10,999 and
// ₹15,000): the prompt says "no ranges", and invented ones reuse round published figures ("3-star from ₹12,000-15,000"
// is Ooty's ₹12,000 and Shimla's ₹15,000; "₹9,999 to 12,500 per night" is Goa's and Braj & Agra's).
const publishedCache = new Map();
function publishedFigures(system) {
  let known = publishedCache.get(system);
  if (!known) {
    known = { figures: new Set(), ranges: new Set() };
    for (const line of system.split('\n')) {
      const f = moneyFigures(line);
      for (let i = 0; i < f.length; i++) {
        known.figures.add(f[i].n);
        for (let j = i + 1; j < f.length; j++) known.ranges.add(f[i].n + '-' + f[j].n);
      }
    }
    if (publishedCache.size > 4) publishedCache.clear();
    publishedCache.set(system, known);
  }
  return known;
}
// Amounts the traveller typed: money as above, or a bare 4-7 digit number in a sentence that talks money ("we have
// around 30,000 per person"). Day counts (under 1,000) and phone digits (digit groups side by side) are not amounts.
const MONEY_TALK = /\b(?:budget|per person|per head|pp|spend|afford|total|around|approx(?:imately)?|about|max(?:imum)?|under|below|up\s?to|within|have|rupees?|rs|inr)\b|बजट|खर्च|रुपये|रुपए|બજેટ|ખર્ચ|રૂપિયા/i;
const BARE_AMOUNT = /(?<![\d+.,][\s-]?)(\d[\d,]*)(?!,?\d|\.\d|[\s-]\d)/g;
// A hyphenated pair is a budget range only when it reads like one ("20,000-30,000", "20000-30000"), not like a phone
// number split in two ("98250-12345": high end below the low end, or no comma and no trailing 000).
const BARE_RANGE = /(?<![\d+.,])(\d[\d,]*)\s*[-–—]\s*(\d[\d,]*)(?!\d)/g;
const amountLike = (s) => /,|000$/.test(s);
function typedAmounts(convo) {
  const out = new Set();
  const num = (s) => Number(s.replace(/,/g, ''));
  for (const t of convo) {
    if (t.role !== 'user') continue;
    const text = asciiDigits(t.content);
    for (const f of moneyFigures(text)) out.add(f.n);
    for (const { start, end } of sentences(text)) {
      const s = text.slice(start, end);
      if (!MONEY_TALK.test(s)) continue;
      for (const m of s.matchAll(BARE_AMOUNT)) { const n = num(m[1]); if (n >= 1000 && n < 1e7) out.add(n); }
      for (const m of s.matchAll(BARE_RANGE)) {
        const lo = num(m[1]), hi = num(m[2]);
        if (lo >= 1000 && lo <= hi && hi <= lo * 20 && hi < 1e7 && amountLike(m[1]) && amountLike(m[2])) { out.add(lo); out.add(hi); }
      }
    }
  }
  return out;
}
// A typed figure may be repeated ONLY where the reply is clearly about the traveller's own budget: its clause says
// budget / your / you mentioned / within, and neither that clause nor any figure-less clause of the sentence says
// from / starts / costs / per person / package / price (a price word in a clause quoting its OWN figure - "Within
// your budget of ₹30,000, Kerala Backwaters, from ₹23,900, fits" - is that figure's, and that figure is judged alone).
const BUDGET_WORDS = /\b(?:budget|your|you mentioned|within)\b|बजट|आपके|आपका|आपकी|आपने|भीतर|અંદર|બજેટ|તમારા|તમારું|તમારી|તમે|अंदर/i;
const PRICE_WORDS = /\b(?:from|starts?|starting|costs?|costing|per person|packages?|prices?|priced|pricing|fares?)\b|शुरू|प्रति व्यक्ति|पैकेज|कीमत|શરૂ|વ્યક્તિ દીઠ|પેકેજ|કિંમત/i;
const CLAUSE_BREAK = /(?<!\d),|,(?!\d)|[;:()[\]]/g;
// Review round 2: "Goa trip fits within ₹4,999", "Within your budget of ₹5,000 we include Kerala houseboat" and "Kerala
// houseboat stay is available within your budget ₹20,000" passed as budget talk. The typed figure's own clause may
// not name a place or package or say it fits / is available / includes / covers / gets you; a sentence that does, or a
// reply that names a place or package, needs a separately published figure to carry the price ("Within your budget of
// ₹30,000, Kerala Backwaters, 6N / 7D, from ₹23,900, fits well." still passes).
const FIT_WORDS = /\b(?:fits?|fitting|available|include[sd]?|including|covers?|covered|covering|gets?\s+you|enough|afford(?:s|able)?|doable|possible|manageable)\b|फिट|उपलब्ध|शामिल|कवर|काफ़ी|काफी|पर्याप्त|संभव|ફિટ|ઉપલબ્ધ|સામેલ|શામેલ|કવર|પૂરતું|પૂરતા|શક્ય/i;
const PACKAGE_NAMES = new RegExp(PUBLISHED_PRICES.split('\n').map((l) => /^- (.+?), \d+N \/ \d+D/.exec(l)).filter(Boolean)
  .map((m) => m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
const namesPlace = (t) => keysOf(t).size > 0 || PACKAGE_NAMES.test(t);
function aboutOwnBudget(reply, figures, sents, f, published, replyNamesPlace) {
  const at = f.at;
  const sent = sents.find((x) => at >= x.start && at < x.end);
  if (!sent) return false;
  const bounds = []; let from = sent.start;
  for (const m of reply.slice(sent.start, sent.end).matchAll(CLAUSE_BREAK)) { bounds.push([from, sent.start + m.index]); from = sent.start + m.index + 1; }
  bounds.push([from, sent.end]);
  const own = bounds.find(([a, b]) => at >= a && at < b);
  const ownText = reply.slice(own[0], own[1]);
  if (!BUDGET_WORDS.test(ownText) || PRICE_WORDS.test(ownText) || FIT_WORDS.test(ownText) || namesPlace(ownText)) return false;
  if (!bounds.every(([a, b]) => a === own[0] || !PRICE_WORDS.test(reply.slice(a, b)) || figures.some((g) => g.at >= a && g.at < b))) return false;
  const carried = (a, b) => figures.some((g) => g.at !== at && g.at >= a && g.at < b && published(g));
  const sentText = reply.slice(sent.start, sent.end);
  if ((namesPlace(sentText) || FIT_WORDS.test(sentText)) && !carried(sent.start, sent.end)) return false;
  return !replyNamesPlace || carried(0, reply.length);
}
function quotesUnpublishedFigure(reply, figures, system, convo) {
  const known = publishedFigures(system);
  const unknown = figures.filter((f) => (f.n > 0 && !known.figures.has(f.n)) || (f.hi !== undefined && !known.ranges.has(f.n + '-' + f.hi)));
  if (!unknown.length) return false;
  const typed = typedAmounts(convo);
  const sents = sentences(reply);
  const published = (g) => known.figures.has(g.n) && (g.hi === undefined || known.ranges.has(g.n + '-' + g.hi));
  let replyNamesPlace;
  return unknown.some((f) => {
    if (!(typed.has(f.n) && (f.hi === undefined || typed.has(f.hi)))) return true;
    if (replyNamesPlace === undefined) replyNamesPlace = namesPlace(reply);
    return !aboutOwnBudget(reply, figures, sents, f, published, replyNamesPlace);
  });
}

// The replacement for a wrong figure, plus the ONE published package the traveller's question names, if exactly one
// priced package covers every place word in it ("Goa?" - Goa Getaway; "Sikkim?" - two packages, so none).
const KEY_WORDS = new RegExp(`${OTHER_PLACES.source}|${OFFER_WORDS.source}|${HONEYMOON.source}`, 'gi');
const KEY_ALIAS = { mysore: 'mysuru', alleppey: 'alappuzha', deepavali: 'diwali' };
const keysOf = (s) => new Set([...s.matchAll(KEY_WORDS)]
  .filter((m) => !/^[a-z]/i.test(m[0]) || !/[a-z]/i.test(s[m.index + m[0].length] || '')) // "goal" is not Goa
  .map((m) => { const k = m[0].toLowerCase(); return KEY_ALIAS[k] || k; }));
// Review round 2: the figure keeps its tier - a "(3★)" line is quoted as "(3-star)", and Shimla & Manali keeps the
// owner's own wording (its line already says "per person"); an international package's line carries no tier.
const PRICED_PACKAGES = PUBLISHED_PRICES.split('\n')
  .map((l) => /^- (.+?), (\d+N \/ \d+D) \([^)]*\): from (₹[\d,]+)(.*)$/.exec(l)).filter(Boolean)
  .map(([, name, nights, price, rest]) => ({ name, nights, keys: keysOf(name),
    quote: /per person/.test(rest) ? `from ${price}${rest}` : `from ${price} per person${/\(3★\)|\(3-star\)/.test(rest) ? ' (3-star)' : ''}.` }));
// Read from the offer text (never typed twice); if that wording ever changes, the offer is simply not suggested here.
const DIWALI_OFFER_PRICE = (/from (₹[\d,]+) per person/.exec(DIWALI_BALI) || [])[1];
const DIWALI_PACKAGE = DIWALI_OFFER_PRICE ? { name: 'Diwali in Bali', nights: '7N / 8D', quote: `from ${DIWALI_OFFER_PRICE} per person.`, keys: keysOf('Diwali in Bali') } : null;
// A question about star ratings, luxury, hotels, nights or a group size gets no package figure: a 3-star per-person
// starting price is not its answer ("Goa 5-star price?", "Goa for 6 people?", "per night?").
const NO_FIGURE_QUESTION = /\bstars?\b|★|\bluxur(?:y|ious)\b|\bpremium\b|\bdeluxe\b|\bhotels?\b|\bresorts?\b|\bnights?\b|\bnightly\b|\bgroups?\b|\b(?:\d{1,3}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen)\s+(?:people|persons?|pax|adults?|travell?ers|guests|members|friends|couples|families|kids|children|of\s+us)\b|\bfamily\s+of\s+(?:\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\b|\bwe\s+are\s+(?:\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\b|\bfor\s+(?:\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\b(?!\s*(?:days?|nights?|weeks?|months?|years?)\b)|होटल|स्टार|लक्ज़री|लक्जरी|लग्ज़री|लग्जरी|प्रति\s+रात|रातों|रातें|\d+\s*रात|ग्रुप|समूह|\d+\s*(?:लोग|लोगों|व्यक्ति)|હોટેલ|હોટલ|સ્ટાર|લક્ઝરી|રાત્રિ|રાત\s*દીઠ|પ્રતિ\s+રાત|\d+\s*રાત|ગ્રુપ|જૂથ|\d+\s*(?:લોકો|વ્યક્તિ)/i;
function honestPriceReply(question, now) {
  if (NO_FIGURE_QUESTION.test(asciiDigits(question))) return HONEST_PRICE_LINE;
  const asked = keysOf(question);
  const packages = offerState(now) === 'diwali-bali' && DIWALI_PACKAGE ? [...PRICED_PACKAGES, DIWALI_PACKAGE] : PRICED_PACKAGES;
  const hits = asked.size ? packages.filter((p) => [...asked].every((k) => p.keys.has(k))) : [];
  return hits.length === 1 ? `${HONEST_PRICE_LINE} ${hits[0].name}, ${hits[0].nights}, is ${hits[0].quote}` : HONEST_PRICE_LINE;
}

// Promises nobody can keep: a confirmed booking, a guaranteed/locked/fixed price, a visa outcome, a held seat, a
// booking made or a payment received. "confirmed only/by/after/until ..." describes who confirms, not a confirmation.
// anthropic-7: so do "confirmed at (the time of) booking" and one adverb in between ("confirmed directly by ...").
const PROMISE = /\b(booking\s+(is\s+)?confirmed(?!\s+(?:[a-z]+ly\s+)?(only|by|after|until|at\s+(?:the\s+time\s+of\s+)?booking)\b)|confirmed\s+your\s+booking|guarantee[ds]?\s+(the\s+|your\s+)?price|price\s+(is\s+)?(locked|guaranteed)|locked[-\s]?in\s+price|visa\s+(is\s+)?(approved|guaranteed|confirmed)(?!\s+(only|by|after|until)\b)|guarantee[ds]?\s+(your\s+)?visa|reserved\s+(a\s+|your\s+|the\s+)?(seats?|spots?|places?)|hold(ing)?\s+((you|for\s+you)\s+)?(a\s+|your\s+|the\s+)?(seats?|spots?|places?)|lock(ed|ing)?\s+(it|this|that|them)\s+in|lock(ed|ing)?\s+in\s+(the\s+|your\s+|this\s+|a\s+)?(price|rate|deal|seats?|spots?|fare)|(seats?|spots?|places?|booking)\s+(is|are|has\s+been|have\s+been)\s+(now\s+)?(reserved|held|secured|locked)|(?<!\bnot\s|n't\s|n’t\s)booked\s+(your|the)\s+(seats?|tickets?|hotel)|payment\s+(is\s+|has\s+been\s+)?received|received\s+your\s+payment|(visa|approval)\s+(is\s+)?assured|prices?\s+(is\s+|are\s+)?fixed|prices?\s+(won't|won’t|will\s+not)\s+change)\b/i;

// Hindi/Gujarati "booking confirmed / seat reserved" claims (the English ones are PROMISE above).
// anthropic-7 (after prompt rule (d)): a sentence that says WHO or WHEN confirms - "... आधिकारिक प्रदाता द्वारा कन्फर्म की
// जाती है", "बुकिंग के समय", "टीम के जवाब के बाद ही", "कन्फर्म होने तक", "... દ્વારા", "બુકિંગ સમયે", "... પછી જ",
// "કન્ફર્મ થાય ત્યાં સુધી" - is the twin of the English "confirmed by / only after / until / at booking", not a
// confirmation, UNLESS it also states the confirmation as done ("कन्फर्म है", "कन्फर्म हो गई", "कन्फर्म कर दी गई", "કન્ફર્મ
// છે", "કન્ફર્મ થઈ ગયું"): "प्रदाता द्वारा आपकी बुकिंग कन्फर्म कर दी गई है" is still a claim. Habitual, future and "can"
// forms ("कन्फर्म की जाती है", "કન્ફર્મ થાય છે", "કન્ફર્મ થશે") describe how it works.
const INDIC_WHO_CONFIRMS = /द्वारा|के\s*समय|के\s*वक़्त|के\s*वक्त|करते\s*समय|के\s*बाद|होने\s*तक|जाने\s*तक|जब\s*तक|દ્વારા|સમયે|વખતે|પછી|ત્યાં\s*સુધી|થવા\s*સુધી/;
const INDIC_CONFIRMED_DONE = /(?:कन्फर्म(?:्ड)?|पक्की|पक्का|रिज़र्व|रिजर्व|होल्ड)\s*(?:है|हैं|हो\s*(?:गई|गया|गए|चुकी|चुका|चुके)|कर\s*(?:दी|दिया|दिए|ली|लिया|लिए)|(?:की|किया|किए)\s*(?:गई|गया|गए))|(?:કન્ફર્મ|પાકી|પાકું|રિઝર્વ|હોલ્ડ)\s*(?:છે|થઈ\s*ગ|થઇ\s*ગ|થઈ\s*ચૂક|થયુ|થયો|થયા|થયેલ|કરી\s*દીધ|કરી\s*લીધ|કરવામાં\s*આવ્ય|કરેલ)/;
const claimsIndicBooking = (reply) => sentences(reply).some(({ start, end }) => {
  const s = reply.slice(start, end);
  return INDIC_BOOKING_CLAIM.test(s) && !NEGATION.test(s) && (!INDIC_WHO_CONFIRMS.test(s) || INDIC_CONFIRMED_DONE.test(s));
});

// ---- garbled text (anthropic-7) ----------------------------------------------------------------------------------
// Live re-test, run 2 (2026-09-30): one Gujarati reply arrived as its own UTF-8 bytes read as Windows-1257 text. The
// model produced it that way (the raw JSON carried U+0105 U+0156 pairs), so the code can only notice it and ask again.
// An Indic letter is three UTF-8 bytes: E0, then A4-B7 (Devanagari A4/A5, Gujarati AA/AB, ...), then one more. Read as
// Windows-1252 the E0 shows as U+00E0, read as Windows-1257 as U+0105, and the second byte as a character of the second
// class of INDIC_MOJIBAKE; two such pairs make a run. Any other UTF-8 read either way shows a lead byte (C2-F4) followed
// by a continuation byte (80-BF): MOJIBAKE_PAIR counts those, three or more, using only the continuation characters
// that never follow a letter in real text - not quotes, dashes, the bullet, the ellipsis, NBSP, guillemets, the
// registered / copyright / trade mark signs, superscripts, nor the letters among them - so accented words, real
// Gujarati and Hindi, the rupee sign and the stars never count. Written as escapes on purpose: an editor or tool that
// "repairs" encodings cannot change them.
const INDIC_MOJIBAKE = /[\u00E0\u0105][\u00A4-\u00B7\u00C6\u00D8\u0156\u0157]/g;
// Lead: Windows-1252 C2-F4 (U+00C2-U+00F4) and Windows-1257's own letters there. Continuation: the symbols of 80-BF.
const MOJIBAKE_PAIR = /[\u00C2-\u00F4\u0100\u0101\u0105-\u0107\u010C\u010D\u0112\u0113\u0116-\u0119\u0122\u0123\u012A\u012B\u012F\u0136\u0137\u013B\u013C\u0141\u0143-\u0146\u014C\u014D\u015A\u0160\u0161\u016A\u0172\u0179-\u017B\u017D][\u00A1-\u00A8\u00AA\u00AC\u00AF-\u00B1\u00B4-\u00B6\u00B8\u00BA\u00BC-\u00BF\u02C6\u02C7\u02DB\u02DC\u2020\u2021\u2030\u20AC]/g;
const isGarbled = (text) => (text.match(INDIC_MOJIBAKE) || []).length >= 2 || (text.match(MOJIBAKE_PAIR) || []).length >= 3;
const GARBLED_LINE = 'Sorry, something went wrong with that reply. Please ask again, or message our team on WhatsApp at +91 88660 50291.';

// ---- what the chat window shows ----------------------------------------------------------------------------------
// anthropic-7: single-asterisk and single-underscore italics are removed too (run 2 showed "*Note: ...*" with its
// asterisks). Only a pair that wraps words on one line: the opening mark starts a word and the closing one ends it. A
// lone "*", "2*3" and "5 * 3", the star sign, underscores inside words (snake_case, first_last@...) and anything inside
// a link are left alone.
const ITALIC_STAR = /(?<![*\p{L}\p{M}\p{N}_])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![*\p{L}\p{M}\p{N}_])/gu;
const ITALIC_UNDERSCORE = /(?<![_\p{L}\p{M}\p{N}/=@#.])_(?=[^\s_])([^_\n]*?[^\s_])_(?![_\p{L}\p{M}\p{N}])/gu;
const LINK = /((?:https?:\/\/|www\.)\S+)/i;
const stripItalics = (text) => text.split(LINK)
  .map((part, i) => (i % 2 ? part : part.replace(ITALIC_STAR, '$1').replace(ITALIC_UNDERSCORE, '$1'))).join('');

const REFUSAL_LINE = 'For this one, please message our team on WhatsApp at +91 88660 50291.';
const FALLBACK_LINE = "I'm having trouble right now. For quick help, please message us on WhatsApp at +91 88660 50291. 🙏";

// Only allow the website's own origins to use this endpoint (limits casual abuse
// of your Anthropic credits). Add your custom domain here once it's live.
const ALLOWED_ORIGINS = [
  'https://piyushm-kk.github.io',
  'https://skylinetravelplanner.com',
  'https://www.skylinetravelplanner.com',
];

// Allow localhost / 127.0.0.1 on any port too, so the chat works in local dev
// previews (VS Code, Live Server, the Ruby server, etc.). Production stays locked.
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function isAllowedOrigin(origin) {
  return ALLOWED_ORIGINS.includes(origin) || LOCAL_ORIGIN_RE.test(origin);
}

function corsHeaders(origin) {
  const allow = isAllowedOrigin(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

// Best-effort per-IP rate limit (defence-in-depth against Anthropic cost abuse).
// NOTE: this lives in an isolate's memory, so it is NOT a hard global cap — a
// distributed flood can hit multiple isolates. The REAL control is a Cloudflare
// Rate Limiting rule on this Worker's route + an Anthropic console spend cap.
// This just stops a lazy single-source loop cheaply.
const RATE_MAX = 15; // requests
const RATE_WINDOW_MS = 60 * 1000; // per minute per IP
const rateHits = new Map(); // ip -> number[] (recent request timestamps)

function isRateLimited(ip) {
  const now = Date.now();
  const recent = (rateHits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  rateHits.set(ip, recent);
  // Bound memory: occasionally evict stale IPs so the Map can't grow unbounded.
  if (rateHits.size > 5000) {
    for (const [k, v] of rateHits) {
      if (!v.length || now - v[v.length - 1] > RATE_WINDOW_MS) rateHits.delete(k);
    }
  }
  return recent.length > RATE_MAX;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    // Health check: GET reports which version is deployed and whether the key secret is present.
    if (request.method === 'GET') {
      return new Response(
        JSON.stringify({ ok: true, version: VERSION, model: MODEL, hasKey: !!(env && env.ANTHROPIC_API_KEY) }),
        { headers: { 'Content-Type': 'application/json', ...cors } }
      );
    }
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: cors });
    }

    // Server-side origin gate: the browser widget always sends an allow-listed
    // Origin on this cross-origin POST, so this blocks no-Origin bots and calls
    // from other sites. (Origin is spoofable, so this is a speed bump, not a
    // wall — pair it with the Cloudflare rate-limit rule + Anthropic spend cap.)
    if (!isAllowedOrigin(origin)) {
      return new Response(JSON.stringify({ error: 'forbidden origin' }),
        { status: 403, headers: { 'Content-Type': 'application/json', ...cors } });
    }

    // Best-effort per-IP throttle (see note on isRateLimited).
    const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (isRateLimited(clientIp)) {
      return new Response(
        JSON.stringify({ reply: "You're sending messages very quickly — please wait a moment and try again. 🙏" }),
        { status: 429, headers: { 'Content-Type': 'application/json', ...cors } }
      );
    }

    try {
      const body = await request.json();

      // Keep the last 12 turns BEFORE any work on them (a long array costs nothing), then normalise roles and cap length.
      const raw = body && Array.isArray(body.messages) ? body.messages.slice(-12) : [];
      const convo = raw.map((m) => ({
        role: m && m.role === 'assistant' ? 'assistant' : 'user',
        content: String((m && m.content) || '').slice(0, 2000),
      })).filter((m) => m.content.trim()); // blank turns go first (review round 2), so the role checks below see real turns
      // Anthropic requires the conversation to start with a 'user' turn — drop any
      // leading assistant messages (e.g. the widget's greeting).
      while (convo.length && convo[0].role !== 'user') convo.shift();
      // A trailing assistant turn would be sent as the start of the model's own reply (words put in its mouth): drop it.
      while (convo.length && convo[convo.length - 1].role !== 'user') convo.pop();

      if (!convo.length) {
        return new Response(JSON.stringify({ reply: 'Namaste! How can I help plan your trip? 🙏' }),
          { headers: { 'Content-Type': 'application/json', ...cors } });
      }

      const now = Date.now();
      const system = systemPromptFor(now);
      // ONE request body: the retry below sends it again byte for byte, so the retry also hits the prompt cache.
      const payload = JSON.stringify({
        model: MODEL,
        max_tokens: 1000, // Sonnet 5.5 writes longer replies; at 400 a reply was cut off mid-number (2026-09-30)
        thinking: { type: 'between_tools' }, // no up-front thinking: with no tools the reply is text only
        // Prompt caching (Anthropic's prompt-caching page, checked 2026-09-30): the system prompt as one text block
        // marked ephemeral (5-minute cache, no beta header; Sonnet 5.5 caches from 512 tokens, this is ~3,000).
        // A hit needs the prefix byte-identical: systemPromptFor() changes only at the Diwali date cutovers, and the
        // thinking setting above must stay as it is, because changing it invalidates the cache.
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: convo,
      });
      // One call to Anthropic: its JSON, or null after an error. Anthropic's error (bad key, no credits, etc.) goes to
      // the Worker log for the owner - never to the visitor.
      const ask = async () => {
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: payload,
        });
        const data = await resp.json();
        if (!resp.ok || data.type === 'error' || data.error) {
          console.error(JSON.stringify({ upstream: resp.status, type: data.error && data.error.type, message: data.error && data.error.message }));
          return null;
        }
        return data;
      };
      const textOf = (data) => {
        const textBlock = Array.isArray(data.content) ? data.content.find((b) => b.type === 'text') : null;
        return textBlock ? String(textBlock.text || '').trim() : '';
      };
      const answer = (text) => new Response(JSON.stringify({ reply: text }), { status: 200, headers: { 'Content-Type': 'application/json', ...cors } });

      let data = await ask();
      if (!data) return answer(FALLBACK_LINE);
      let reply = textOf(data);
      // anthropic-7: a garbled reply (see isGarbled) is asked for ONCE more with the same request; if that one is garbled
      // too, the visitor gets a fixed line. The log says what happened and carries none of the reply.
      if (isGarbled(reply)) {
        console.warn(JSON.stringify({ garbled: 'retrying once' }));
        data = await ask();
        if (!data) return answer(FALLBACK_LINE);
        reply = textOf(data);
        if (isGarbled(reply)) {
          console.warn(JSON.stringify({ garbled: 'again, fixed line sent' }));
          return answer(GARBLED_LINE);
        }
      }
      // A refusal with no text: the team can help (asking to rephrase would invite rewording until it passes).
      if (!reply) reply = data.stop_reason === 'refusal' ? REFUSAL_LINE : 'Sorry, could you please rephrase that? 🙏';
      // The chat window shows plain text: remove markdown symbols (**bold**, headings, "- " bullets). Live since 2026-09-30.
      // anthropic-7: *italics* and _italics_ too (stripItalics), after the bullets so a "* " list item stays a bullet.
      const written = reply;
      reply = stripItalics(reply
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/__(.+?)__/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^(\s*)[-*]\s+/gm, '$1• '));

      // Judged on the model's own words, before any note. A figure nobody published, or a Diwali price under the
      // offer, REPLACES the reply (a note after it would still show the wrong figure); the rest append a note.
      // Money is read in the text as the model wrote it, BEFORE the strip (review round 2: the strip made the "-" line
      // of "₹9,999\n-\n₹12,500" a bullet, so the range read as two published figures), and again as shown, where a
      // bold "**₹9,999**-**12,500**" first reads as one range.
      let replaced = false, extra = false;
      for (const text of written === reply ? [reply] : [written, reply]) {
        const figures = moneyFigures(text);
        const offer = diwaliChecks(text, figures, now);
        extra = extra || offer.extra;
        replaced = replaced || offer.lowPrice || quotesUnpublishedFigure(text, figures, system, convo);
      }
      if (replaced) reply = honestPriceReply(convo[convo.length - 1].content, now);

      // Guarantee the price disclaimer whenever the reply quotes any prices (₹ / Rs / INR / rupees / 5k / ...),
      // even if the model forgot to add it. Skipped if a similar note is already present.
      if ((/[₹]|\bRs\.?\b|\bINR\b/i.test(reply) || moneyFigures(reply).length) && !/indicative|subject to change|can change with/i.test(reply)) {
        reply += '\n\nNote: Prices are indicative starting-from estimates and can change with season, hotel availability and current rates.';
      }

      // Deterministic safety backstop (do not rely on the prompt alone): if the model
      // ever asserts a CONFIRMED booking, a GUARANTEED/locked price, or a visa outcome,
      // append a correction. These claims are real business/legal liability.
      if (PROMISE.test(reply) || claimsIndicBooking(reply)) {
        reply += '\n\n(To be clear: I can\'t confirm bookings, hold seats, guarantee prices, or guarantee visa outcomes — our team or the official provider confirms those. Please message us on WhatsApp at +91 88660 50291 for an exact quote.)';
      }
      if (extra && !replaced) reply += DIWALI_INCLUDED_NOTE;

      return new Response(
        JSON.stringify({ reply }),
        { headers: { 'Content-Type': 'application/json', ...cors } }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ reply: FALLBACK_LINE }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...cors } }
      );
    }
  },
};
