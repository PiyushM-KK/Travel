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
const VERSION = 'anthropic-10'; // reported by the GET health check

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
// Booking backstops (AI Security round): a Hindi/Gujarati confirmation in a past or perfective form is a claim whoever
// confirms it, and only habitual/future forms describe the process; the English "confirmed by" excuses only the
// provider, airline, operator, hotel or railway. A visitor whose own message is garbled gets no retry.
// anthropic-8 (2026-09-30, the owner's price decision and live test run 3): the destination-level "from" prices of Kashmir,
// Sikkim, Uttarakhand and the six North-East states are the owner's figures and are listed as destination prices, apart
// from the named packages (PUBLISHED_PRICES); the prompt forbids turning a package into another kind of trip ("Bali
// Honeymoon-style stays for families" at the honeymoon price) and describing services or features the site does not list
// (wheelchair assistance, "drive-up" sights), says who chooses, suggests and confirms hotels, and aims for 70-90 words
// (hard limit 110); Hindi and Gujarati replies keep the package names in English. The price note follows the reply's language and is added only when no note is there in any of the
// three languages (run 3: GU1 and GU2 showed the model's Gujarati note and then the English one; see PRICE_NOTE).
// anthropic-9 (2026-10-05, the owner's regular-rate flyer, live on the site in 53cf0e3): "Bali Honeymoon, 6N / 7D, from
// ₹46,000" is replaced by "Bali 7 Nights with Flights", 7N / 8D, return flights from Ahmedabad on VietJet, from ₹70,200
// with three hotel options (₹70,200 / ₹72,200 / ₹74,000) - BALI_PACKAGE holds the package page's details. A Bali figure
// in a sentence that names Diwali (any spelling, "festival", November) is the regular package only as the honest
// comparison - the offer's ₹1,15,000 first, then the package's NAME, no Diwali or linking word after that price
// (isBaliPackageFigure; two AI Security rounds). A bare "honeymoon" no longer excuses anything.
// AI Security round, same version: a published figure must be the one of the trip it is quoted for (a package's own
// figure, a destination's for its stated days - tripFigureMismatch), a note is recognised only as a real note sentence,
// and the note's language is chosen with package, place and page names left out of the count.
// anthropic-10 (2026-10-06, the owner's second Diwali flyer, diwali-lakshadweep.html): the "Lakshadweep Escape" Diwali
// Special - 3N/4D on Agatti and Bangaram, travel 5-20 November 2026, ₹54,000 per person for a minimum of 2 travellers or
// ₹47,000 for a minimum of 4, flight tickets extra - is in the prompt until 21 November (IST), then an "it has ended" line
// for a week. Lakshadweep is also a destination (no published price, the entry permit). With two Diwali offers, a spot in a
// reply is about the place named last before it (anchorAt): Bali, Lakshadweep or another place, and a Diwali word stands for
// the offer named last before it. The Bali offer's discount check keeps its comparison rule for a lower figure next to a
// Bali word in a Diwali sentence, and three ways of tying a lower figure to the Bali offer (another place nearer the figure,
// "same as ..." in the next sentence, "... and Bali costs the same") are judged as the Bali offer. The ₹47,000 price needs its
// "minimum 4 travellers" beside it (a note is added) and is never a couple's or a group of three's (the reply is replaced);
// a Lakshadweep inclusion nobody listed (flights, meals, insurance, the permit, water sports) gets its own note.
// Review round 1, same version (AI Security x2, Bug Hunter): only words of equivalence tie a lower figure to Bali ("unlike",
// "cheaper", "too" and a month name are honest answers); a "Diwali" tied to neither offer reads the visitor's words, else
// the replacement gives both offers' prices; ₹47,000 without its condition, or for 1-3 travellers named by the reply or
// the visitor, is replaced; flights "part of" / "a package with" count as claims; a Lakshadweep price with no word on
// flights gets the flights line; permit promises get the owner's rule; "40 thousand rupees", "rupaye", percentage
// discounts and seat claims are caught.
// Review round 2, same version: a Diwali word belongs to a place only in its own clause, and the visitor's words never
// excuse a figure (only an offer's own price, for a "Diwali" tied to no place); "same" ties only as "same as / same price";
// a refusal that names a percentage is not a discount; "90 thousand per person" is money; ₹47,000 stated with its
// minimum-4 condition stays (a note gives a couple their price); flights count as a claim only in a package or price
// sentence; more permit promises; "we will reserve your seat".
const SYSTEM_PROMPT = `You are the Skyline AI Travel Assistant for "Skyline Travel Planner", an India-based travel planning website (WhatsApp +91 8866050291, info@skylinetravelplanner.com). Help with: destination selection, trip duration, preliminary itineraries, hotel-category comparison (3/4/5-star), packing lists, transport recommendations, family/honeymoon/religious/group planning, budget planning, travel-season guidance, and FAQs. The destinations we cover are listed under DESTINATIONS WE COVER below. Reply in the same language the customer writes in (English, Hindi or Gujarati). In Hindi or Gujarati replies, write package names in English (Latin script) exactly as listed. Never say which languages our WhatsApp team speaks; only you, the assistant, answer in English, Hindi and Gujarati. Prices are in Indian Rupees and ALWAYS "starting from" estimates, never guaranteed. Budget is OPTIONAL — never insist on it and never make the traveller feel they must share money or budget details. If the traveller has not mentioned a budget, still give a genuinely helpful answer using the published starting-from prices listed below (never a made-up range); do NOT repeatedly ask about budget or money. Ask about budget at most once, and only if it would clearly improve your recommendation — otherwise proceed happily without it and simply invite them to the "Customize My Trip" form or WhatsApp for an exact quote. Whenever your reply mentions any prices, budget figures or cost estimates, end that reply with a short one-line note on its own line, such as: "Note: Prices are indicative starting-from estimates and can change with season, hotel availability and current rates." Write the note once, in the language of your reply. Add this note only when you actually mention prices. Keep replies warm, concise and practical (see the LENGTH limit at the end). After understanding the trip, encourage the user to request a customized package (the website "Customize My Trip" form) or chat on WhatsApp (+91 8866050291) for a quote. NEVER claim to confirm tickets, process payments, guarantee hotel availability, guarantee prices, guarantee visa approval, or give official immigration advice — politely defer those to the team or official provider. Never state flight durations, flying times or travel times between places, not even as an estimate (trip lengths in nights and days are fine). NEVER ask for card, bank, Aadhaar or passport details. Do not invent specific hotel bookings. Never describe services, facilities or website features that our website does not list, such as wheelchair assistance or sights that are "drive-up"; for mobility or health needs, ask the traveller to mention them on the "Customize My Trip" form or WhatsApp so our team can plan around them. Keep the "no payments on this website" disclosure when relevant. SAMPLE TOUR PACKAGES you can recommend (all fully customizable; prices are indicative "starting from" and shared on request via the "Customize My Trip" form or WhatsApp — never quote a fixed figure for these EXCEPT where a "from" price is stated below): (1) Nainital · Mussoorie · Jim Corbett — 6N/7D, Uttarakhand: Mussoorie sightseeing (Kempty Falls, Gun Hill), Nainital lake tour (Bhimtal, Sattal, Naukuchiatal), Jim Corbett jeep safari. (2) Ooty · Coorg · Mysore — 5N/6D, South India: Mysore Palace & Brindavan Gardens, Coorg (Abbey Falls, Talacauvery), Ooty & Coonoor. (3) Sikkim · Darjeeling — 5N/6D: Gangtok, Tsomgo Lake & New Baba Mandir, Darjeeling Tiger Hill sunrise. (4) Shimla · Manali — 5N/6D, from ₹10,999 per person (indicative starting-from), Himachal: Shimla–Kufri, Kullu valley, Solang Valley, Manali (Hadimba Temple, Vashisht). (5) Untouched Spiti Valley — 8N/9D, Himachal: Narkanda, Sangla–Chitkul, Nako–Tabo, Kaza (Key Monastery, Hikkim highest post office), Kalpa. When a traveller asks about any of these regions, mention the matching package and its nights, then invite them to the Domestic tours page or the "Customize My Trip" form / WhatsApp for a tailored quote.`;

// PUBLISHED PRICES, DESTINATIONS and BEST SEASONS: copied by script (not typed) from the site files on 2026-09-30.
// Packages and "From (3★, per person)" prices: Domestic.dc.html. "From, per person": International.dc.html.
// Destination "From ... per person", trip lengths, places and "Best time": Destination.dc.html (index.html carries
// the same figures). Spiti season: Package.dc.html. Destinations on the custom-trip form: Customize.dc.html.
// Source of the Shimla & Manali upper figure (₹15,000 or more): owner, 2026-09-30 - not a site file. It is the only
// upper figure allowed.
// Destination-level "from" prices of Kashmir ₹12,900, Sikkim ₹20,900, Uttarakhand ₹15,900 and the six North-East states
// (Meghalaya, Assam · Kaziranga, Arunachal Pradesh, Nagaland, Manipur · Loktak, Mizoram) ₹20,500 each: owner, 2026-09-30
// ("Kashmir : start from 12,900* Rupee, Sikkim - Starting from 20,900*, Uttarakhand: starting from 15,900*, Six
// North-East states- Start from 20,500*"; the "*" is the site's indicative-price note). They replace the pages' earlier
// figures, which were lower than the same place's package and so were left out of anthropic-6 and -7; Destination.dc.html
// and index.html show the owner's figures since the site commit of the same day. They are destination prices, not
// package prices: the named packages (Kashmir Valley, Sikkim Discovery, Meghalaya Wonders ...) keep their own figures.
const PUBLISHED_PRICES = `PUBLISHED STARTING PRICES - per person, in Indian Rupees, exactly as our website shows them. These are the ONLY rupee figures you may quote (plus the prices of a festive offer listed below, while it is listed). Quote a figure exactly as written, per person, with its package name and nights (for a destination-page figure, its trip length). A domestic package figure is a 3-star price: always write "(3-star)" right after it. Never invent any other figure: no ranges, no 4-star or 5-star prices, no per-night hotel rates, no totals for a group, no flight or ticket prices, and no inclusions (what a package includes is confirmed with the quote). For anything not listed here, say our team quotes it on WhatsApp (+91 8866050291) or through the "Customize My Trip" form. When asked whether we have a package for a place, name the matching package with its nights and from-price first, then offer to customize it. Never adapt a package into a different kind of trip or apply one package's price to another kind of trip - for example, never offer "Bali Honeymoon-style stays for families" at the Bali Honeymoon price; for another kind of trip, give the place's destination "from" price if one is listed below, and say our team tailors and quotes it.
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
- Bali 7 Nights with Flights, 7N / 8D (From Ahmedabad · Kuta · Ubud · Uluwatu · Tanah Lot): from ₹70,200 including return flights from Ahmedabad on VietJet; by hotel option ₹70,200 / ₹72,200 / ₹74,000.
- Maldives Escape, 4N / 5D (Beach or overwater villa · Male atolls): from ₹58,000.
Destination "from" prices (each destination page's "From ... per person", for the trip length shown). A destination "from" price is the starting price of a trip to that place; it is not the price of any named package above, and each named package keeps its own figure. Quote a destination price as, for example, "trips to Kashmir of 5–6 days start from" its figure, and a package with its name, nights and "(3-star)"; never give one as the price of the other:
- Rajasthan (4–7 days): from ₹18,000.
- Himachal Pradesh (5–7 days): from ₹10,999.
- Kashmir (5–6 days): from ₹12,900.
- Kerala (4–5 days): from ₹18,000.
- Goa (3–5 days): from ₹9,999.
- Ooty & Nilgiris (3–4 days): from ₹12,000.
- Mysuru & Coorg (3–4 days): from ₹13,000.
- Agra & Taj Mahal (2–3 days): from ₹9,000.
- Uttarakhand (5–7 days): from ₹15,900.
- Thailand (5–7 days): from ₹42,000.
- Bali (5–7 days): from ₹70,200.
- Maldives (4–6 days): from ₹58,000.
- Meghalaya (5–7 days): from ₹20,500.
- Assam · Kaziranga (4–6 days): from ₹20,500.
- Arunachal Pradesh (6–8 days): from ₹20,500.
- Nagaland (5–7 days): from ₹20,500.
- Manipur · Loktak (4–6 days): from ₹20,500.
- Mizoram (5–7 days): from ₹20,500.
- Sikkim (6–7 days): from ₹20,900.`;

const DESTINATIONS = `DESTINATIONS WE COVER (our website's own list). When asked what we cover, name these; do not add places that are not here.
- North India: Rajasthan · Himachal · Uttarakhand · Kashmir · Uttar Pradesh.
- Western India: Gujarat · Goa.
- East India: Sikkim & the Himalayas (Gangtok and Darjeeling).
- Northeast India: Meghalaya · Assam · Arunachal · Nagaland · Manipur · Mizoram.
- South India: Kerala · Karnataka & the Nilgiris · Tamil Nadu.
- International: Thailand, Bali, Maldives.
- Also on our "Customize My Trip" form, as custom trips with no package or published price: Varanasi, Amritsar, Tirupati, Char Dham, Shirdi.
- Islands: Lakshadweep, India's coral islands (Agatti, with the islands' airport, is the gateway) - a destination page with no regular package and no published price. Every visitor, Indian citizens included, needs an entry permit from the Lakshadweep Administration, and our team assists with it: ask the traveller to check the current rules with our team, and never say how long it takes, what it costs or that it will be granted.
Places on our destination pages: Rajasthan: Jaipur, Udaipur, Jodhpur, Jaisalmer; Himachal Pradesh: Shimla, Manali, Dharamshala & McLeodganj, Kasol & Parvati Valley; Kashmir: Srinagar, Gulmarg, Pahalgam, Sonamarg; Kerala: Munnar, Alleppey, Thekkady, Kochi; Goa: North Goa, South Goa, Old Goa, Dudhsagar Falls; Ooty & Nilgiris: Ooty, Coonoor, Doddabetta Peak, Tea Estates; Mysuru & Coorg: Mysore Palace, Chamundi Hills, Coorg, Dubare Camp; Agra & Taj Mahal: Taj Mahal, Agra Fort, Fatehpur Sikri, Mathura & Vrindavan; Uttarakhand: Nainital, Kausani, Mukteshwar, Jim Corbett; Thailand: Bangkok, Phuket & Krabi, Pattaya, Chiang Mai; Bali: Ubud, Seminyak & Kuta, Nusa Penida, Uluwatu; Maldives: Male Atolls, Resort Islands, Maafushi, House Reefs; Meghalaya: Shillong, Cherrapunji (Sohra), Dawki, Mawlynnong; Assam · Kaziranga: Kaziranga National Park, Guwahati, Jorhat & Tea Gardens, Majuli; Arunachal Pradesh: Tawang, Nuranang Falls, Sela Pass, Ziro Valley; Nagaland: Kohima, Dzükou Valley, Khonoma, Kisama Heritage Village; Manipur · Loktak: Loktak Lake, Keibul Lamjao, Imphal, Sendra Island; Mizoram: Aizawl, Vantawng Falls, Reiek, Hmuifang; Sikkim: Gangtok, Tsomgo Lake & Nathu La, Pelling, Lachung & Yumthang; Lakshadweep: Agatti, Bangaram, Lagoons & reefs.
When you suggest places or sketch an itinerary, build it from these places and the package routes above. If a traveller asks for somewhere not named here, do not present it as one of our tours; say our team can check whether it can be added to a custom trip.`;

const BEST_SEASONS = `BEST TIME TO VISIT, as our destination pages publish it: Rajasthan: Oct–Mar; Himachal Pradesh: Mar–Jun · Dec–Feb (snow); Kashmir: Mar–Oct · tulips in Apr · snow Dec–Feb; Kerala: Sep–Mar; Goa: Nov–Feb; Ooty & Nilgiris: Oct–Jun; Mysuru & Coorg: Oct–Mar; Agra & Taj Mahal: Oct–Mar; Uttarakhand: Mar–Jun · Sep–Nov; Thailand: Nov–Mar; Bali: Apr–Oct; Maldives: Nov–Apr; Meghalaya: Oct–Apr; Assam · Kaziranga: Nov–Apr; Arunachal Pradesh: Oct–Apr; Nagaland: Oct–Apr · Hornbill in Dec; Manipur · Loktak: Oct–Mar; Mizoram: Oct–Mar; Sikkim: Mar–May · Oct–Dec; Lakshadweep: Oct–mid May.
Untouched Spiti Valley package page: best season May-Oct. For a place with no season listed here, give brief general guidance and suggest confirming timing with our team.`;

// Who confirms what (the International page: "Visas, flights and hotel availability are confirmed by the official
// provider, never on this website"). The live assistant said "Bookings and confirmations are handled by our travel team".
// anthropic-8: who chooses hotels (run 3, Q10 said "Hotels are chosen ... by the official provider" and "Our team will
// share suggested stays with your quote"): the traveller picks the category on the "Customize My Trip" form ("Hotel
// category", "Pick the comfort level(s) you like."), the team suggests, the provider confirms availability.
const CONFIRMATIONS = `CONFIRMATIONS: Flights, trains, buses and hotel availability are confirmed by the official provider, never on this website; our team sends the itinerary and quote and confirms the plan with the traveller directly. Never say that you or our team issue tickets or confirm bookings, seats or hotel availability. Hotels and their availability are confirmed at booking by the official provider, never "in your quote". Hotels: the traveller chooses the hotel category (3, 4 or 5-star), our team can suggest options in it, and the official provider confirms availability at booking. Never say hotels are "chosen by the provider", and never promise "suggested stays" or named hotels "with your quote".`;

// Last in the prompt on purpose (it replaced the older "under 130 words"; the live replies ran to 153 words). anthropic-7:
// the run-2 replies still ran to 134-160 words against a bare limit of 120, so the rule now also gives a target.
// anthropic-8: run 3 still went over (122, 142 and 121 words; only 5 of 11 replies landed in 80-100), so both come down.
const LENGTH_RULE = `LENGTH: Aim for 70-90 words; hard limit 110 words and at most two questions.`;

// Diwali in Bali (diwali-bali.html). Facts copied from the offer page - never add to them here.
const DIWALI_BALI = `CURRENT FESTIVE OFFER - "Diwali in Bali", 7N/8D, departs Tuesday 3 November 2026, return flights on Singapore Airlines from Ahmedabad (connecting through Singapore), from ₹1,15,000 per person (indicative starting-from). Stays, all "or similar" and confirmed at booking: 4 nights Kuta (Fairfield by Marriott, Nagraa or Legian; Deluxe room), 1 night Ubud (Mara River Safari Lodge; Savala Deluxe room, with a Jungle Hopper pass), 2 nights Jimbaran (Royal Tulip; a one-bedroom villa with its own private pool). Itinerary: Day 1 arrive, garland welcome, private transfer to Kuta. Day 2 water sports (jet ski, banana boat, parasailing), then Uluwatu Temple at sunset. Day 3 full-day Ubud tour with Tanah Lot and Ulun Danu temples. Day 4 free day. Day 5 transfer to Mara River Safari Lodge. Day 6 is Diwali, Sunday 8 November: Bali Swing and Tegenungan Waterfall, then the Jimbaran pool villa. Day 7 free day at the villa. Day 8 transfer for the flight home. Included: return Singapore Airlines flights from Ahmedabad; 7 nights' stay as per the itinerary; daily breakfast; all transfers and sightseeing on a private basis; entrance fees as per the itinerary; garland welcome and daily mineral water. Nothing else is included in this list - if asked about anything not listed (for example visa, travel insurance, lunch or dinner), say it is not listed and the team will confirm on WhatsApp. Mara River Safari Lodge is not a Marriott property. When a traveller asks about Bali, Diwali or festive trips, mention this offer, share https://skylinetravelplanner.com/diwali-bali.html, and invite them to enquire there or on WhatsApp (+91 8866050291) for availability and the exact price.`;
const DIWALI_BALI_DEPARTED = `The "Diwali in Bali" trip that departed on 3 November 2026 has already left. If a traveller asks about it, say so kindly, do not quote its price, and offer to plan a custom Bali trip through the "Customize My Trip" form or WhatsApp.`;
// Offered until departure day (diwali-promo.js and /offers drop Bali then too); then only "it has left" for a week; from
// 9 Nov 2026 00:00 IST not mentioned at all. Nothing to remove afterwards - the dates retire it.
const DIWALI_BALI_DEPARTS = Date.parse('2026-11-03T00:00:00+05:30');
const DIWALI_BALI_UNTIL = Date.parse('2026-11-09T00:00:00+05:30');

function offerState(now) {
  if (now < DIWALI_BALI_DEPARTS) return 'diwali-bali';
  if (now < DIWALI_BALI_UNTIL) return 'diwali-bali-departed';
  return 'none';
}

// The Lakshadweep Escape (diwali-lakshadweep.html, the owner's flyer of 2026-10-05). Facts copied from the offer page -
// never add to them here. Each price stands on its own line, so the two never form a "published range" ("₹47,000-54,000"
// would drop the group-size condition). The minimum-4 rule is worded without figures for the same reason.
const LAKSHADWEEP_OFFER = `SECOND FESTIVE OFFER - "Lakshadweep Escape", our Lakshadweep Diwali Special 2026: 3N/4D on Agatti Island and Bangaram Island, for travel between 5 and 20 November 2026 - a trip may start on any day up to 20 November (owner, 2026-10-06; exact dates are given when the traveller enquires). It is a separate trip from every other offer and package: never give one trip's price, dates, flights or inclusions for another. Its prices are per person and indicative starting-from, depend on the group size, and do NOT include flight tickets:
- Lakshadweep Escape for a minimum of 2 travellers: from ₹54,000 per person.
- Lakshadweep Escape for a minimum of 4 travellers: from ₹47,000 per person.
Quote the minimum-4 price only together with the words "minimum 4 travellers", and never for 1, 2 or 3 travellers: for 2 or 3 travellers the minimum-2 price applies. For one traveller, say the offer is for a minimum of 2 and our team can advise. Whenever you quote a price, say that flight tickets are extra. Stays: 2 nights on Agatti Island at Sand Bank Beach Resort, then 1 night on Bangaram Island at Coral Pearl, Lakshadweep – IHCL SeleQtions, confirmed at booking by the provider; no room type or star rating is published, so never describe the rooms, their facilities or a star rating. Highlights: Agatti Island sightseeing, the Sand Bank Beach experience, the Kalpitti Island tour, a glass-bottom boat experience, beach leisure and relaxation, and island sunsets. No day-by-day itinerary is published. Included: 3 nights / 4 days accommodation; Agatti airport pickup and drop; Agatti local sightseeing; the Kalpitti Island tour with a glass-bottom boat; island transfers; breakfast and other inclusions as per the package (the page's own words - name no meal but breakfast); assistance throughout the tour. Not included: flight tickets. Nothing else is listed - if asked about anything else (lunch or dinner, other meals, scuba diving, snorkelling, water sports, travel insurance), say it is not listed and our team will confirm on WhatsApp. Entry permit: every visitor to Lakshadweep, Indian citizens included, needs an entry permit from the Lakshadweep Administration, and our team assists with it (owner, 2026-10-06). Never promise how long it takes, what it costs or that it will be granted; ask the traveller to check the current rules with our team. When a traveller asks about Lakshadweep, islands, beaches, Diwali or festive trips, mention this offer, share https://skylinetravelplanner.com/diwali-lakshadweep.html, and invite them to enquire there or on WhatsApp (+91 8866050291) for availability and the exact price.`;
const LAKSHADWEEP_ENDED = `The "Lakshadweep Escape" Diwali Special (travel 5-20 November 2026) has ended. If a traveller asks about it, say so kindly, do not quote its price, and offer to plan a custom Lakshadweep trip through the "Customize My Trip" form or WhatsApp.`;
// Offered until the end of 20 Nov (the page and diwali-promo.js switch off at 21 Nov 00:00 IST), then "it has ended" for a
// week, then not mentioned at all. Nothing to remove afterwards - the dates retire it.
const LAKSHADWEEP_UNTIL = Date.parse('2026-11-21T00:00:00+05:30');
const LAKSHADWEEP_ENDED_UNTIL = Date.parse('2026-11-28T00:00:00+05:30');
function laksState(now) {
  if (now < LAKSHADWEEP_UNTIL) return 'live';
  if (now < LAKSHADWEEP_ENDED_UNTIL) return 'ended';
  return 'none';
}

function systemPromptFor(now) {
  const parts = [SYSTEM_PROMPT, PUBLISHED_PRICES, BALI_PACKAGE, DESTINATIONS, BEST_SEASONS, CONFIRMATIONS];
  const state = offerState(now), laks = laksState(now);
  if (state === 'diwali-bali') parts.push(DIWALI_BALI);
  if (state === 'diwali-bali-departed') parts.push(DIWALI_BALI_DEPARTED);
  if (laks === 'live') parts.push(LAKSHADWEEP_OFFER);
  if (laks === 'ended') parts.push(LAKSHADWEEP_ENDED);
  parts.push(LENGTH_RULE);
  return parts.join('\n\n');
}

// The Bali package page's details (Package.dc.html?pkg=bali, the owner's flyer). One option per line, so no two of its
// figures form a "published range" by sharing a line.
const BALI_PACKAGE = `BALI PACKAGE - "Bali 7 Nights with Flights", 7N / 8D, a REGULAR package (not a special offer), exactly as our Bali package page lists it. No departure dates are published for it: dates are given when the traveller enquires.
- Included: 7 nights' accommodation; all transfers and tours on a private basis; entrance fees as per the itinerary; a garland welcome on arrival; return airfare from Ahmedabad on VietJet (non-refundable); daily mineral water during the tour. Nothing else is listed as included (no meals, visa or insurance).
- Hotel option 1, ₹70,200 per person: 4 nights in Kuta at Golden Tulip (Deluxe Room) or similar, then 3 nights in Jimbaran at Royal Tulip (One Bedroom Pool Villa) or similar.
- Hotel option 2, ₹72,200 per person: 4 nights in Kuta at Anathera Resort Kuta (Deluxe Room, no balcony) or similar, then 3 nights in Ubud at Samakhya Villa (One Bedroom Pool Villa) or similar.
- Hotel option 3, ₹74,000 per person: 4 nights in Legian at Fairfield by Marriott Legian (Deluxe Room) or similar, then 3 nights in Ubud at Sathala by Marriott (Deluxe Room) or similar.
- Itinerary: Day 1 arrival, garland welcome, private transfer to the hotel; Day 2 water sports (jet ski, banana boat, parasailing) and the Uluwatu temple; Day 3 free; Day 4 Ubud (a swing at My Swing, a coffee plantation, Celuk Mas village); Day 5 Bedugul (Ulun Danu temple) and the Tanah Lot sunset; Day 6 GWK Culture Park (entrance only) and Pandawa Beach; Day 7 free; Day 8 departure, private transfer from the hotel.
- It is a separate trip from any special offer: never give one trip's price, airline, dates or inclusions for another. When you quote it, say "regular package"; do not describe it with festival or month words.`;

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
// anthropic-10 (AI Security x2): also "covers", "part of", "a package with", "all-inclusive", "full board", "you get", "is
// provided" and romanised Hindi / Gujarati ("included hai", "shamil").
const INCLUDED_CLAIM = /\b(?:includes|including|(?:does|do|will)\s+include|comes?\s+with|covers\s+(?:the\s+|your\s+|all\s+)?(?:return\s+)?(?:flights?|air\s*fares?|airfares?|meals?|lunch(?:es)?|dinners?|insurance|permits?|visas?)|part\s+of\s+(?:the\s+|your\s+|this\s+)?(?:[\w-]+\s+){0,3}?(?:package|escape|offer|deal|price|special)|package\s+with\s+(?:return\s+)?(?:flights?|air\s*fares?|airfares?|meals?|lunch|dinner|insurance|permits?|visas?)|all[-\s]inclusive|full[-\s]board|(?:you|guests|travell?ers|everyone)\s+(?:will\s+)?(?:also\s+)?get|(?:is|are)\s+provided|included\s+(?:hai|hain|he|che|chhe)|shamil)\b|(?:\b(?:is|are|comes?)|'s|’s)\s+(?:[a-z]+\s+){0,3}?(?:included|covered|free|provided)\b|\bincluded\s*:|शामिल|सम्मिलित|इनक्लूड|સામેલ|શામેલ|સમાવેશ|ઇન્ક્લુડ/i;
// Visa-on-arrival / visa-free ADVICE is about the country, not the package: its visa mention is never an inclusion.
const VISA_ADVICE = /\barrival\b|\bvisa[-\s]?free\b|अराइवल|आगमन|वीज़ा[-\s]?फ्री|અરાઇવલ|આગમન|વિઝા[-\s]?ફ્રી/i;
const QUESTION_END = /\?["'”’)\]]*\s*$/;
const OFFER_WORDS = /bali|diwali|deepavali|बाली|दिवाली|दीपावली|બાલી|દિવાળી|દીવાળી/gi;
// anthropic-10: two Diwali offers, so the offer words are split - the place Bali, and the festival's name, which stands for
// whichever offer the reply named last (anchorAt). Lakshadweep and its islands, as the site writes them in English, Hindi
// and Gujarati (diwali-lakshadweep.html, Destination.dc.html), plus the owner's own spelling "Lakshdeep" and other common ones.
const BALI_WORDS = /bali|बाली|બાલી/gi;
const DIWALI_NAMES = /diwali|divali|deepavali|deepawali|dipawali|dipavali|दिवाली|दीवाली|दीपावली|दिपावली|दिवाळी|દિવાળી|દીવાળી/gi;
const LAKS_WORDS = /\b(?:lakshadweep|lakshdweep|lakshadeep|lakshdeep|lakshwadeep|laccadives?|agatti|bangaram|kalpitti|kadmat)|लक्षद्वीप|अगत्ती|बंगारम|कल्पित्ती|લક્ષદ્વીપ|અગત્તી|બંગારમ|કલ્પિત્તી/gi;
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
// The Hindi/Gujarati booking check reads the VERB after कन्फर्म / पक्की / રિઝર્વ ... (AI Security, anthropic-7). A past or
// perfective form, or the plain "is confirmed" state, is a claim whoever is said to confirm it ("हमारी टीम द्वारा कन्फर्म
// हुई", "... द्वारा कन्फर्म कर दी गई है", "... દ્વારા કન્ફર્મ કરવામાં આવી", "કન્ફર્મ કરાઈ છે", "કન્ફર્મ છે"). Only a
// habitual, future, "can" or "until / after being" form describes the process ("प्रदाता द्वारा कन्फर्म की जाती है",
// "कन्फर्म होने तक", "કન્ફર્મ થાય છે", "કન્ફર્મ થશે", "કન્ફર્મ થયા પછી"). A done form wins over a process form in the same
// sentence. The process forms are here; the done forms (INDIC_CONFIRMED_DONE) sit beside claimsIndicBooking.
const INDIC_CONFIRM_PROCESS = /(?:कन्फर्म(?:्ड)?|पक्की|पक्का|रिज़र्व|रिजर्व|होल्ड)\s*(?:(?:भी|तो|ही)\s*)?(?:(?:(?:की|किया|किए|हो|कर\s*(?:दी|दिया|दिए))\s*)?(?:जाती|जाता|जाते|जाएगी|जाएगा|जाएंगे|जाएँगे|जाए|जा\s*सक)|होती|होता|होते|होगी|होगा|होंगे|होने|हो\s*सक|करता|करती|करते|करेगा|करेगी|करेंगे|करना|करने)|(?:કન્ફર્મ|પાકી|પાકું|રિઝર્વ|હોલ્ડ)\s*(?:(?:પણ|તો|જ)\s*)?(?:થાય|થશે|થઈ\s*શક|થઇ\s*શક|થવા|થયા\s*પછી|કરવામાં\s*આવે|કરવામાં\s*આવશે|કરી\s*દેવામાં\s*આવશે|કરાય\s*છે|કરે|કરશે|કરી\s*શક|કરવા)/;
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
const NUMBER = /(\d[\d,]*(?:\.\d+)?)(?:\s*(k|lakhs?|lacs?|लाख|લાખ|thousand|hazaa?r|ह(?:ज\u093C?|\u095B)ार|હજાર)(?![a-z\u0900-\u097F\u0A80-\u0AFF]))?/gi;
// anthropic-10: "thousand" multiplies like "k", but counts as money only with a currency beside it ("5 thousand years" is not).
const THOUSAND = /^(?:thousand|hazaa?r|ह(?:ज\u093C?|\u095B)ार|હજાર)$/i;
// ...and in a price phrase: "per person", "each", "onwards" after it, or "from", "about", "only", "costs" before it - never
// before years, distances or people.
const PRICE_AFTER = /^\s*(?:per\s+(?:person|head|night|couple)|pp\b|each\b|onwards\b|a\s+night\b|\/-|प्रति\s+व्यक्ति|વ્યક્તિ\s+દીઠ)/i;
const PRICE_BEFORE = /\b(?:from|at|around|about|approx(?:imately)?|only|just|costs?|costing|price[ds]?|starts?|starting|under|below|up\s*to)\s*$|(?:सिर्फ|केवल|लगभग|ફક્ત|લગભગ)\s*$/i;
const NOT_MONEY_AFTER = /^\s*(?:years?|yrs?|km|kilomet|metres?|meters?|feet|ft|steps|islands?|species|visitors|tourists|people)\b/i;
const CURRENCY_BEFORE = /(?:₹|\$|(?:^|[^a-z])(?:rs\.?|inr|usd)|(?:रु|रू|રૂ)\.?)\s*$/i;
// A unit AFTER a number - unless another number follows it, which makes it that number's prefix ("Day 2 ₹500").
const CURRENCY_AFTER = /^\s*(?:rupees?\b|ruppees?\b|rupa(?:i)?ye\b|rupaiya\b|rupaya\b|rupiye\b|\/-|रुपये|रुपए|रुपया|रुपयों|રૂપિયા|(?:rs\b|inr\b|usd\b|(?:रु|रू)(?![\u0900-\u097F])|રૂ(?![\u0A80-\u0AFF])|₹)(?!\.?\s*\d))/i;
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
    const thousand = THOUSAND.test(unit), mult = unit === 'k' || thousand ? 1000 : unit ? 100000 : 1;
    const at = m.index, end = m.index + m[0].length, after = text.slice(end, end + 16);
    const marked = CURRENCY_BEFORE.test(text.slice(Math.max(0, at - 10), at)) || CURRENCY_AFTER.test(after);
    // Paise are dropped, never rounded up ("₹1,15,000.50" is ₹1,15,000, not ₹1,15,001); "1.15 lakh" is rounded only to
    // undo floating-point error (1.15 * 100000 = 114999.99...).
    toks.push({ at, end, num, mult, n: mult === 1 ? Math.floor(num) : Math.round(num * mult), money: marked || (mult > 1 && !HEADCOUNT_AFTER.test(after) && (!thousand || (!NOT_MONEY_AFTER.test(after) && (PRICE_AFTER.test(after) || PRICE_BEFORE.test(text.slice(Math.max(0, at - 24), at)))))) });
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
  const at = (re) => [...text.matchAll(re)].map((m) => m.index);
  return { text, bali: at(BALI_WORDS), diwali: at(DIWALI_NAMES), laks: at(LAKS_WORDS), other: at(OTHER_PLACES) };
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
// anthropic-10: which place a spot is about - 'bali', 'laks' (Lakshadweep and its islands), 'other', or null when the
// reply names none. A Diwali word stands for the offer named last before IT, else the first named after it in its
// sentence, else the offer the visitor's own words name (`hint`, offerHint), else 'diwali': it could be either offer.
// (Review round 1: "For the islands, our Diwali Special is from ₹54,000" was read as Bali's.)
const ANCHOR_KINDS = ['bali', 'diwali', 'laks', 'other'];
const ATTACH_BREAK = /(?<!\d),|,(?!\d)|[;:()[\]—–!?।\n]|\.(?!\d)|\s-\s/;
function anchorAt(places, at, sentenceEnd, hint = null) {
  let kind = null, pos = -1;
  for (const k of ANCHOR_KINDS) { const i = lastBefore(places[k], at); if (i > pos) { pos = i; kind = k; } }
  if (!kind) {
    pos = Infinity;
    for (const k of ANCHOR_KINDS) { const i = firstIn(places[k], at, sentenceEnd); if (i >= 0 && i < pos) { pos = i; kind = k; } }
    if (!kind) return null;
  }
  if (kind !== 'diwali') return kind;
  // Review round 2 (second opinion): only a place in the Diwali word's own clause - "Like Bali, it has a Diwali Special"
  // and "Diwali in Bali is ... . For the islands, our Diwali Special" leave it open.
  const attached = (p) => p >= 0 && !ATTACH_BREAK.test(places.text.slice(Math.min(p, pos), Math.max(p, pos)));
  const b = lastBefore(places.bali, pos), l = lastBefore(places.laks, pos), near = Math.max(b, l);
  if (attached(near)) return near === l ? 'laks' : 'bali';
  const b2 = firstIn(places.bali, pos, sentenceEnd), l2 = firstIn(places.laks, pos, sentenceEnd);
  const next = b2 < 0 ? l2 : l2 < 0 ? b2 : Math.min(b2, l2);
  if (attached(next)) return next === l2 ? 'laks' : 'bali';
  return hint === 'laks' || hint === 'bali' ? hint : 'diwali';
}
// The Bali offer's inclusion check: about Bali, or a Diwali word that could be either offer (it fails safe, as before).
const aboutTheOffer = (places, at, sentenceEnd, hint) => { const a = anchorAt(places, at, sentenceEnd, hint); return a === 'bali' || a === 'diwali'; };
// The offer the visitor's own words name: the latest message that names Bali or Lakshadweep (not both), or another place.
function offerHint(convo) {
  for (let i = convo.length - 1; i >= 0; i--) {
    if (convo[i].role !== 'user') continue;
    const t = convo[i].content, has = (re) => [...t.matchAll(re)].length > 0;
    const l = has(LAKS_WORDS), b = has(BALI_WORDS);
    if (l || b) return l && b ? null : l ? 'laks' : 'bali';
    if (has(OTHER_PLACES)) return 'other';
  }
  return null;
}
const INDIC_BOOKING_CLAIM = /(बुकिंग|सीट|टिकट|બુકિંગ|સીટ|ટિકિટ)[^.।!?\n]{0,40}(कन्फर्म|पक्की|पक्का|रिज़र्व|रिजर्व|होल्ड|કન્ફર્મ|પાકી|પાકું|રિઝર્વ|હોલ્ડ)|(कन्फर्म|रिज़र्व|रिजर्व|होल्ड)\s*(कर\s*(दी|दिया|दिए)|हो\s*(गई|गया))|(કન્ફર્મ|રિઝર્વ|હોલ્ડ)\s*(કરી|થઈ)/;

// Bali's own published figures (the Bali 7 Nights with Flights package and the Bali destination page), read from the
// price list. Quoted in a sentence that names no Diwali word, such a figure is that package, not a discount on the offer.
// In a sentence that DOES name Diwali it is excused only as the honest comparison: the offer's real price (₹1,15,000)
// comes first, the regular package's NAME stands between that price and this figure, and no Diwali word follows that
// price - "Diwali in Bali is from ₹1,15,000, and the Bali 7 Nights with Flights, 7N / 8D, from ₹70,200". AI Security
// (anthropic-9): "the nearer name" excused "The Diwali in Bali offer, like our Bali 7 Nights with Flights, starts at
// ₹70,200" and "दिवाली इन बाली, बाली 7 रातें पैकेज सिर्फ ₹70,200 में"; a bare "honeymoon" no longer excuses anything.
const BALI_PUBLISHED_INR = new Set(PUBLISHED_PRICES.split('\n').filter((l) => /\bbali\b/i.test(l)).flatMap((l) => moneyFigures(l).map((f) => f.n)));
// AI Security round 2 (anthropic-9): every spelling of the festival, "festival", and the trip's month count - "Deepawali in
// Bali is only ₹70,200" and "The November trip to Bali is ₹70,200" were excused as the regular package (a hole older than
// this version). A sentence that merely mentions November is held to the comparison rule: it fails safe.
const DIWALI_WORDS = /diwali|divali|deepavali|deepawali|dipawali|dipavali|festive|festival|november|\bnov\b|दिवाली|दीवाली|दीपावली|दिपावली|दिवाळी|नवंबर|નવેમ્બર|દિવાળી|દીવાળી/i;
// Words that tie the regular package to the offer after the offer's price ("...but you can get it as the Bali 7 Nights
// with Flights at ₹70,200", "...is the same itinerary"): the honest comparison never needs them.
const LINKING = /\b(?:it|same|this|that|as|equivalent|instead|cheaper|alternative|get|book|also|discount|deal|offer|special)\b|वही|यही|इसी|सस्त|भी|એ\s*જ|આ\s*જ|સસ્ત|પણ/i;
// "honeymoon" still names a package key (Sikkim Honeymoon vs Sikkim Discovery - KEY_WORDS below); it no longer excuses a
// Bali figure next to the offer (anthropic-9).
const HONEYMOON = /honeymoon|हनीमून|હનીમૂન/i;
const REGULAR_BALI_NAME = /bali\s+7\s+nights?\s+with\s+flights|बाली\s*7\s*रातें|બાલી\s*7\s*રાત/i;
const isBaliPackageFigure = (n, s, at) => {
  if (!BALI_PUBLISHED_INR.has(n)) return false;
  if (!DIWALI_WORDS.test(s)) return true;
  const offerAt = moneyFigures(s).filter((f) => f.n === DIWALI_FROM_INR && f.at < at).map((f) => f.at).pop();
  return offerAt !== undefined && !DIWALI_WORDS.test(s.slice(offerAt)) && !LINKING.test(s.slice(offerAt))
    && REGULAR_BALI_NAME.test(s.slice(offerAt, at));
};
// anthropic-10: with Lakshadweep's ₹54,000 / ₹47,000 under the Bali offer's price, a lower figure that another place stands
// nearer to is still judged as the Bali offer when the reply ties it to Bali (the "nearer name" class of anthropic-9).
// Review round 1 narrowed the ties: a contrast or a cheaper alternative is an honest answer ("Unlike Diwali in Bali, the
// Lakshadweep Escape is from ₹54,000"; "If you want something cheaper, Goa Getaway ... ₹9,999"; "Bali is a great option
// too"), so only words that make Bali the subject of the other trip's price count:
// (a) in the figure's sentence, after the last Bali word (or after Bali's own price, when it is given first): "like",
//     "same", "equivalent", "matches"... ("Diwali in Bali, like the Lakshadweep Escape, is ₹47,000"), or Bali joined to
//     the other trip ("Bali and Lakshadweep Diwali offers start at ₹47,000");
// (b) a sentence after one that last named Bali, with a word of equivalence before the figure ("Diwali in Bali? Same as
//     Lakshadweep: ₹47,000.");
// (c) Bali named after the figure as costing the same ("Lakshadweep is ₹47,000, and Diwali in Bali costs the same");
// (d) in diwaliChecks: a figure-free Bali sentence that matches an earlier lower figure ("... Diwali in Bali matches that.").
const TIE_AFTER_BALI = /\b(?:like|same\s+(?:as|price|rate|amount|figure|cost|fare)|equivalent|identical|match(?:es|ed|ing)?|as\s+much\s+as|that\s+price|on\s+par|similarly\s+priced|comparabl[ey]|equals?|equally|as\s+well\s+as|along\s+with|together\s+with)\b|जैसा|जैसे|जैसी|तरह|(?:कीमत|दाम|रेट)\s*(?:भी\s*)?(?:वही|उतनी|उतना)|(?:वही|उतनी|उतना)\s*(?:कीमत|दाम|रेट)|જેવ|જેમ|(?:કિંમત|ભાવ|રેટ)\s*(?:પણ\s*)?(?:એ\s*જ|સરખ|એટલ)|(?:એ\s*જ|એટલી|સરખી)\s*(?:કિંમત|ભાવ|રેટ)/i;
const TIE_STRONG = /\b(?:same\s+(?:as|price|rate|amount|figure|cost|fare)|equivalent|identical|match(?:es|ed|ing)?|just\s+like|as\s+much\s+as|that\s+price|on\s+par|similarly\s+priced|comparably\s+priced|equals?)\b|(?:कीमत|दाम|रेट)\s*(?:भी\s*)?(?:वही|उतनी|उतना|एक\s*जैसी)|(?:वही|उतनी|उतना)\s*(?:कीमत|दाम|रेट)|(?:કિંમત|ભાવ|રેટ)\s*(?:પણ\s*)?(?:એ\s*જ|સરખ|એટલ)|(?:એ\s*જ|એટલી|સરખી)\s*(?:કિંમત|ભાવ|રેટ)/i;
// A tie that is denied is no tie: "Diwali in Bali ... is not the same as the Lakshadweep Escape".
const BOTH_OFFERS = /\b(?:both|all|either|each)\b[^.!?।\n]{0,30}?\b(?:diwali|festive|offers|trips|specials|deals|packages)\b|\b(?:diwali|festive)\s+(?:offers|trips|specials|deals|packages)\b|दोनों|બંને/i;
const TIE_NEG = /\b(?:not|unlike|whereas|different|differs?|never|cannot|unable)\b|n't|n’t|नहीं|अलग|નથી|અલગ/i;
const BALI_JOINED = /^(?:bali\b|बाली|બાલી)\s*,?\s*(?:and|&|or|plus|और|या|तथा|અને|કે|તથા)\s/i;
const SAME_AFTER_BALI = /^(?:bali\b|बाली|બાલી)[^.!?।\n]{0,30}?\b(?:is|are|costs?|priced|comes?\s+to)\s+(?:also\s+)?(?:at\s+)?(?:the\s+same(?:\s+price)?|too|as\s+well|equal|that\s+much)\b|^(?:bali\b|बाली|બાલી)[^.!?।\n]{0,40}?\b(?:that\s+(?:rate|price|figure|amount)|the\s+same\s+(?:rate|price)|similarly\s+priced|on\s+par|equals?)\b|^(?:bali\b|बाली|બાલી)[^.!?।\n]{0,30}?(?:वही|उतना|उतनी|उतने|एक\s*जैसा|એ\s*જ|એટલ|સરખ)/i;
function tiedToBali(reply, places, start, end, at, sFigs) {
  const rel = at - start, s = reply.slice(start, end);
  const b = lastBefore(places.bali, at);
  if (b >= start) {
    const g = sFigs.find((x) => x.at > b && x.at < at && (x.n === DIWALI_FROM_INR || BALI_PUBLISHED_INR.has(x.n)));
    const span = reply.slice(g ? g.at : b, at);
    return (TIE_AFTER_BALI.test(span) && !TIE_NEG.test(span)) || (!g && BALI_JOINED.test(reply.slice(b, at)));
  }
  const lb = lastBefore(places.bali, start);
  if (lb >= 0 && lb > lastBefore(places.laks, start) && lb > lastBefore(places.other, start) && TIE_STRONG.test(s.slice(0, rel)) && !TIE_NEG.test(s.slice(0, rel))) return true;
  const ba = firstIn(places.bali, at + 1, end);
  return ba >= 0 && !sFigs.some((x) => x.at > ba) && SAME_AFTER_BALI.test(reply.slice(ba, end));
}
// The sentence as the Bali package rule reads it: a festival or month word that belongs to Lakshadweep (the last offer
// named before it is Lakshadweep) is blanked, so "The Lakshadweep Escape is a Diwali Special, from ₹54,000, whereas Bali
// starts at ₹70,200" is no Diwali sentence for Bali's regular figure (review round 1). Lengths are kept.
const DIWALI_WORDS_G = new RegExp(DIWALI_WORDS.source, 'gi');
const baliDiwaliText = (reply, places, start, end) => reply.slice(start, end)
  .replace(DIWALI_WORDS_G, (w, i) => {
    const at = start + i, nl = firstIn(places.laks, at, end), nb = firstIn(places.bali, at, end);
    const laksOwned = lastBefore(places.laks, at + 1) > lastBefore(places.bali, at + 1) || (nl >= 0 && (nb < 0 || nl < nb));
    return laksOwned ? ' '.repeat(w.length) : w;
  });

// ---- the Lakshadweep Escape's own checks (anthropic-10) ----------------------------------------------------------------
// The minimum-4 price is quoted only with its condition in the same sentence, and never to 1-3 travellers - named in that
// sentence or in the visitor's own latest message about their group; otherwise the reply is replaced with both prices and
// their conditions (review round 1: a note after the wrong price still showed it). A sentence that gives both prices may
// name "2 travellers" for the other one, but needs the "4" of this one.
const LAKS_MIN2_INR = 54000, LAKS_MIN4_INR = 47000;
const MIN_FOUR = /\bmin(?:imum)?\.?\s*(?:of\s+)?(?:4|four)\b|\b(?:4|four)\s*(?:\+|or\s+more\b|and\s+(?:above|more)\b)|\bat\s+least\s+(?:4|four)\b|\bgroups?\s+of\s+(?:4|four)\b|न्यूनतम\s*4|कम\s*से\s*कम\s*4|4\s*या\s*(?:अधिक|ज़्यादा|ज्यादा)|4\s*\+|ઓછામાં\s*ઓછા\s*4|ન્યૂનતમ\s*4|4\s*કે\s*(?:વધુ|તેથી\s*વધુ)/i;
const SMALL_GROUP = /\b(?:(?<!\b(?:\d+|two|three|four|five|six|seven|eight)\s+)couples?|my\s+(?:wife|husband|partner|spouse)(?:\s+and\s+I)?|(?:me|myself)\s+and\s+my\s+(?:wife|husband|partner|spouse)|honeymoon\w*|solo|alone|you\s+two|both\s+of\s+you|husband\s+and\s+wife|(?:the\s+)?(?:two|three)\s+of\s+(?:you|us)|(?:1|2|3)\s+of\s+(?:you|us)|your\s+(?:wife|husband|partner|spouse)|(?:family|party|group)\s+of\s+(?:1|2|3|one|two|three)\b|we\s+(?:are|r)\s+(?:1|2|3|one|two|three)\b|(?:1|2|3|one|two|three)\s+(?:people|persons?|pax|adults?|travell?ers|guests)|for\s+(?:1|2|3|one|two|three)\b(?!\s*-?\s*(?:days?|nights?|N\b|D\b)))|(?:दो|तीन|[123])\s*(?:लोग|लोगों|यात्री|यात्रियों|व्यक्ति)|हम\s*(?:दो|तीन|[123])|पत्नी|पति|पार्टनर|कपल|जोड़े|जोड़ा|हनीमून|(?:બે|ત્રણ|[123])\s*(?:લોકો|મુસાફર|વ્યક્તિ)|અમે\s*(?:બે|ત્રણ|[123])|દંપતી|પત્ની|પતિ|કપલ|યુગલ|હનીમૂન/i;
const CONDITION_KEPT = /\b(?:only|not|never|unless|need|needs|required|requires)\b|n't|n’t|सिर्फ|केवल|नहीं|ज़रूरी|जरूरी|ફક્ત|માત્ર|નહીં|જરૂરી/i;
const LARGE_GROUP = /\b(?:[2-9]|two|three|four|five)\s+couples\b|\b(?:we\s+(?:are|r)|group\s+of|family\s+of|party\s+of)\s+(?:[4-9]|\d{2}|four|five|six|seven|eight|nine|ten)\b|\b(?:[4-9]|\d{2}|four|five|six|seven|eight|nine|ten)\s+(?:people|persons?|pax|adults?|travell?ers|guests|of\s+us)\b|(?:चार|पांच|पाँच|[4-9])\s*(?:लोग|लोगों|यात्री|व्यक्ति)|हम\s*(?:चार|पांच|पाँच|[4-9])|(?:ચાર|પાંચ|[4-9])\s*(?:લોકો|મુસાફર|વ્યક્તિ)|અમે\s*(?:ચાર|પાંચ|[4-9])/i;
// The visitor's own group size: the latest of their last few messages that states one.
function smallGroupAsked(convo) {
  for (let i = convo.length - 1, seen = 0; i >= 0 && seen < 3; i--) {
    if (convo[i].role !== 'user') continue;
    seen++;
    const t = asciiDigits(convo[i].content);
    if (LARGE_GROUP.test(t)) return false;
    if (SMALL_GROUP.test(t)) return true;
  }
  return false;
}
// What the page does not list as included (flights are the page's own exclusion).
const LAKS_ITEMS = /\b(?:flights?|air\s*fares?|airfares?|air\s+tickets?|flight\s+tickets?|plane\s+tickets?|lunch(?:es)?|dinners?|meals?|insurance|permits?|scuba(?:\s+diving)?|snorkell?ing|water\s+sports?)\b|फ\u093C?्लाइट|\u095E्लाइट|हवाई\s*टिकट|हवाई\s*किराया|लंच|डिनर|खाना|भोजन|बीमा|परमिट|वॉटर\s*स्पोर्ट्स|वाटर\s*स्पोर्ट्स|स्कूबा|स्नॉर्कलिंग|स्नोर्कलिंग|ફ્લાઇટ|ફ્લાઈટ|હવાઈ\s*ટિકિટ|લંચ|ડિનર|ભોજન|જમવાનું|વીમો|પરમિટ|વોટર\s*સ્પોર્ટ્સ|સ્કૂબા|સ્નોર્કલિંગ/gi;
// Flights in a Lakshadweep sentence are an inclusion claim unless the sentence says they are extra or separate (review
// round 1: "Return flights are part of the Lakshadweep Escape package", "a package with flights" had no claim verb).
const FLIGHT_WORDS = /\b(?:flights?|air\s*fares?|airfares?|air\s+tickets?|plane\s+tickets?)\b|फ\u093C?्लाइट|\u095E्लाइट|हवाई\s*(?:टिकट|किराया|यात्रा)|उ(?:ड\u093C?|\u095C)ान|ફ્લાઇટ|ફ્લાઈટ|હવાઈ\s*(?:ટિકિટ|ભાડું)/gi;
const FLIGHT_CTX = /\b(?:escape|package|price|priced|per\s+person|deal|offer|special|includ\w*|cover\w*|part\s+of)\b|पैकेज|कीमत|शामिल|પેકેજ|કિંમત|સામેલ|શામેલ/i;
const FLIGHT_LOGISTICS = /\b(?:reach|fly|flying|operat\w*|schedul\w*|options?|help|takes?|run|runs|depart\w*|connect\w*|daily|hours?)\b/i;
const FLIGHT_OK = /\b(?:not|no|never|exclud\w*|extra|separate(?:ly)?|additional|except|own|book\w*|buy|purchase|lands?|landing|arriv\w*)\b|n't|n’t|अलग|अतिरिक्त|नहीं|અલગ|નથી|વધારાન/i;
const LAKS_INCLUDED_NOTE = '\n\n(To be clear: the Lakshadweep Escape includes 3 nights\' accommodation, Agatti airport pickup and drop, Agatti sightseeing, the Kalpitti Island tour with a glass-bottom boat, island transfers, breakfast, and assistance throughout. Flight tickets are not included, and every visitor needs an entry permit (our team assists with it). Anything else is confirmed by our team on WhatsApp at +91 88660 50291.)';
// A Lakshadweep price in a reply that says nothing about flights gets this line (second opinion: "flights extra" was a
// prompt rule only).
const LAKS_PAX_NOTE = '\n\n(To be clear: for 2 or 3 travellers the Lakshadweep Escape is from ₹54,000 per person; ₹47,000 per person applies only to a minimum of 4 travellers. Flight tickets are extra.)';
const LAKS_FLIGHTS_NOTE = '\n\n(Flight tickets are not included in the Lakshadweep Escape.)';
// The entry permit: "mention it, no promise" (owner, 2026-10-05), and "assisted" (owner, 2026-10-06) - our team assists, so
// "we help / assist with the permit" is true. A Lakshadweep sentence that says we arrange or take care of it, how long it
// takes, that it is free / online / included, or that someone does not need one gets the rule stated.
const PERMIT_CLAIM = /\b(?:arrange|get|obtain|process|handle|issue|apply\s+for|sort\s+out|take\s+care\s+of|look\s+after|organi[sz]e|secure|facilitate|manage)\w*\s+(?:(?:your|the|an|all|any)\s+)?(?:[\w-]+\s+){0,2}?(?:entry\s+)?permits?\b|\bon\s+your\s+behalf\b[^.!?\n]{0,40}?\bpermits?\b|\bpermits?\b[^.!?\n]{0,40}?\bon\s+your\s+behalf\b|\bpermits?\b[^.!?\n]{0,60}?\b(?:arranged|included|free|issued|guaranteed|easy|quick|takes?|within|online|website|portal|on\s+arrival|\d+\s*(?:working\s+)?(?:days?|hours?))\b|\b(?:no|not|don'?t|do\s+not|doesn'?t|does\s+not|won'?t)\s+(?:need|require)\w*\s+(?:a\s+|an\s+|any\s+)?(?:entry\s+)?permits?\b|\bpermits?\s+(?:is|are)\s+not\s+(?:needed|required)\b|परमिट[^।!?\n]{0,40}?(?:दिन|घंटे|मिल\s*जा|बनवा|करवा|शामिल|मुफ़्त|मुफ्त|ऑनलाइन)|પરમિટ[^.!?\n]{0,40}?(?:દિવસ|કલાક|મળી\s*જ|કરાવ|સામેલ|શામેલ|મફત|ઓનલાઇન)/i;
const PERMIT_WORD = /permits?|परमिट|પરમિટ/i;
const LAKS_PERMIT_NOTE = '\n\n(To be clear: every visitor to Lakshadweep, Indian citizens included, needs an entry permit from the Lakshadweep Administration. Our team assists with it and shares the current rules on WhatsApp at +91 88660 50291; we cannot promise how long it takes, what it costs or that it will be granted.)';
// A percentage discount nobody published (second opinion: "with 20% off for early booking" got only the price note): the
// reply is replaced like an unpublished figure. Read after asciiDigits.
const DISCOUNT = /\b\d{1,2}(?:\.\d)?\s*(?:%|per\s*cent|percent)\s*(?:off|discount|cash\s*back|savings?|less|rebate|cheaper|lower)\b|\b(?:save|saving)\s+(?:up\s+to\s+)?\d{1,2}(?:\.\d)?\s*(?:%|per\s*cent|percent)|\b(?:discount|savings?|rebate|cash\s*back)\s+(?:of\s+)?(?:up\s+to\s+)?\d{1,2}(?:\.\d)?\s*(?:%|per\s*cent|percent)|\d{1,2}\s*(?:%|प्रतिशत|ટકા)\s*(?:की\s*)?(?:छूट|डिस्काउंट|ડિસ્કાઉન્ટ|છૂટ)|(?:छूट|डिस्काउंट|ડિસ્કાઉન્ટ|છૂટ)\s*\d{1,2}\s*(?:%|प्रतिशत|ટકા)/i;
// The sentence of a discount must not be a refusal ("I cannot offer a 10% discount", "हम 10% छूट नहीं दे सकते").
const DISCOUNT_REFUSAL = /\b(?:not|no|never|cannot|can't|can’t|unable|don't|don’t|do\s+not|doesn't|does\s+not|isn't|aren't|won't|without)\b|नहीं|નથી|નહીં/i;
const offersDiscount = (text) => sentences(text).some(({ start, end }) => { const t = asciiDigits(text.slice(start, end)); return DISCOUNT.test(t) && !DISCOUNT_REFUSAL.test(t); });
// Seats: confirmed, available or "only 3 left" - nobody can say so (second opinion); the booking note is added, as for PROMISE.
const SEAT_CLAIM = /(?<!\b(?:whether|if|check|ask|confirm)\s+(?:the\s+|your\s+)?)\b(?:your\s+)?(?:seats?|spots?)\s+(?:is|are|has\s+been|have\s+been)\s+(?:now\s+|still\s+)?(?:confirmed|available|open|guaranteed)\b(?!\s+(?:by|only|after|once|when|at|on\s+request|subject)\b)|\b(?:only\s+)?\d+\s+(?:seats?|spots?)\s+(?:left|remaining|available)\b|\b(?:seats?|spots?)\s+(?:are\s+)?(?:filling|selling)\s+(?:up\s+)?fast\b|\b(?:will|'ll|’ll|can)\s+(?:reserve|hold|block|secure)\s+(?:your|a|the)\s+(?:seats?|spots?|places?|rooms?)\b/i;
function permitClaimed(text, hint) {
  const places = placeIndex(text);
  return sentences(text).some(({ start, end }) => {
    const s = text.slice(start, end);
    if (QUESTION_END.test(s) || !PERMIT_CLAIM.test(s)) return false;
    const a = anchorAt(places, start + s.search(PERMIT_WORD), end, hint);
    return a === 'laks' || a === 'diwali' || (a === null && hint === 'laks');
  });
}

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
function claimedExtraAt(s, items = OFFER_ITEMS) {
  if (QUESTION_END.test(s) || !INCLUDED_CLAIM.test(s)) return -1;
  const advice = VISA_ADVICE.test(s);
  let cs = null, k = 0;
  for (const m of s.matchAll(items)) {
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

// The two offers' checks on one reply (as written, and again as shown). `hint` is the offer the visitor's own words name
// (offerHint); `smallAsked` whether they said they are 1-3 travellers (smallGroupAsked).
// replace + about: a wrong offer price - 'bali' (a discount on Diwali in Bali), 'laks' (₹47,000 for fewer than 4 or without
// its condition), 'both' (a "Diwali" price tied to neither offer) or null (an offer price for no named trip: the question
// decides the replacement). extra / laksExtra: an inclusion the offer does not list. laksFlights: a Lakshadweep price in a
// reply that says nothing about flights.
function diwaliChecks(reply, figures, now, hint = null, smallAsked = false) {
  const found = { replace: false, about: null, extra: false, laksExtra: false, laksFlights: false, laksPax: false };
  const bali = offerState(now) !== 'none', laks = laksState(now) === 'live';
  if (!bali && !laks) return found;
  const places = placeIndex(reply);
  const flag = (about) => { if (!found.replace) { found.replace = true; found.about = about; } };
  let f = 0, lowSeen = false, laksFigure = false;
  for (const { start, end } of sentences(reply)) {
    const s = reply.slice(start, end);
    const sFigs = [];
    for (; f < figures.length && figures[f].at < end; f++) if (figures[f].at >= start) sFigs.push(figures[f]);
    if (bali && !found.replace) {
      const sb = baliDiwaliText(reply, places, start, end);
      for (const { at, n } of sFigs) {
        if (!(n > 0 && n < DIWALI_FROM_INR) || isBaliPackageFigure(n, sb, at - start)) continue;
        // Read WITHOUT the visitor's words (review round 2: a stale "Lakshadweep" in the conversation excused "Our Diwali
        // Special is ₹70,200"). A "Diwali" tied to no place may carry a Lakshadweep price - unless the visitor asked about
        // Bali; any other figure there is replaced with both offers. A Bali replacement for a visitor who asked about
        // Lakshadweep gives both offers.
        const about = anchorAt(places, at, end);
        const laksFig = laks && (n === LAKS_MIN2_INR || n === LAKS_MIN4_INR);
        if (about === 'bali') { flag(hint === 'laks' ? 'both' : 'bali'); break; }
        if (about === 'diwali') {
          // A length stated between the Diwali word and the end of the figure's clause must be the offer's 3N / 4D (round 2:
          // "Our Diwali special: 7 nights, ₹54,000"; a later "Bali 7 Nights with Flights" clause is not the offer's).
          const tail = reply.slice(at, end), cutAt = tail.search(/[;।]|\.(?!\d)/);
          const span = reply.slice(Math.max(start, lastBefore(places.diwali, at)), at + (cutAt < 0 ? tail.length : cutAt));
          const wrongLength = dayCounts(asciiDigits(span)).some(([a, z]) => a !== 4 || z !== 4);
          if (!laksFig || hint === 'bali' || wrongLength || BOTH_OFFERS.test(s.slice(0, at - start))) { flag('both'); break; }
          continue;
        }
        if (about && tiedToBali(reply, places, start, end, at, sFigs)) { flag(hint === 'laks' ? 'both' : 'bali'); break; }
      }
      if (!found.replace && lowSeen && !sFigs.length && firstIn(places.bali, start, end) >= 0 && TIE_STRONG.test(s) && !TIE_NEG.test(s)) flag('bali');
    }
    if (sFigs.some((x) => x.n > 0 && x.n < DIWALI_FROM_INR && !BALI_PUBLISHED_INR.has(x.n))) lowSeen = true;
    if (laks) {
      for (const { at, n } of sFigs) {
        if (n !== LAKS_MIN2_INR && n !== LAKS_MIN4_INR) continue;
        laksFigure = true;
        // An offer price in a reply that names no place at all is the Lakshadweep Escape's only if the visitor asked about it
        // (AI Security: "It starts from ₹47,000 per person" to "how much is Goa?" was kept).
        if (hint !== 'laks' && anchorAt(places, at, end, hint) === null) flag(hint === 'bali' ? 'bali' : null);
      }
      if (sFigs.some((x) => x.n === LAKS_MIN4_INR)) {
        const t = asciiDigits(s), both = sFigs.some((x) => x.n === LAKS_MIN2_INR);
        if (both) { if (!MIN_FOUR.test(t) && !/\b(?:4|four)\b/i.test(t)) flag('laks'); }
        else if (!MIN_FOUR.test(t) || (SMALL_GROUP.test(t) && !CONDITION_KEPT.test(t))) flag('laks');
        // Stated correctly, but the visitor said they are 1-3 and the reply gives them no price of their own (round 2:
        // replacing it removed a correct answer).
        else if (smallAsked && !figures.some((x) => x.n === LAKS_MIN2_INR)) found.laksPax = true;
      }
    }
    if (bali && !found.extra) {
      const item = claimedExtraAt(s);
      if (item >= 0 && aboutTheOffer(places, start + item, end, hint)) found.extra = true;
    }
    if (laks && !found.laksExtra) {
      const item = claimedExtraAt(s, LAKS_ITEMS);
      const a = item >= 0 ? anchorAt(places, start + item, end, hint) : null;
      if (a === 'laks' || a === 'diwali') found.laksExtra = true;
      else if (!QUESTION_END.test(s) && !FLIGHT_OK.test(s) && FLIGHT_CTX.test(s) && !FLIGHT_LOGISTICS.test(s)) {
        for (const m of s.matchAll(FLIGHT_WORDS)) if (anchorAt(places, start + m.index, end, hint) === 'laks') { found.laksExtra = true; break; }
      }
    }
  }
  // The flights line: a Lakshadweep price and no flight word that is Lakshadweep's (a Bali sentence's "return flights" does
  // not count - Bug Hunter round 2).
  if (laks && laksFigure && ![...reply.matchAll(FLIGHT_WORDS)].some((m) => { const a = anchorAt(places, m.index, reply.length, hint); return a === 'laks' || a === 'diwali' || a === null; })) found.laksFlights = true;
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
const MONEY_TALK = /\b(?:budget|per person|per head|pp|spend|afford|total|around|approx(?:imately)?|about|max(?:imum)?|under|below|up\s?to|within|have|rupees?|rupa(?:i)?ye|rupiye|rs|inr)\b|बजट|खर्च|रुपये|रुपए|બજેટ|ખર્ચ|રૂપિયા/i;
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
const KEY_WORDS = new RegExp(`${OTHER_PLACES.source}|${OFFER_WORDS.source}|${HONEYMOON.source}|${LAKS_WORDS.source}`, 'gi');
const KEY_ALIAS = { mysore: 'mysuru', alleppey: 'alappuzha', deepavali: 'diwali',
  lakshdweep: 'lakshadweep', lakshadeep: 'lakshadweep', lakshdeep: 'lakshadweep', lakshwadeep: 'lakshadweep', laccadive: 'lakshadweep', laccadives: 'lakshadweep' };
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
// anthropic-10: the Lakshadweep Escape, its two prices read from the offer text (never typed twice); it answers a question
// that names Lakshadweep or one of its islands, in any of the three languages, with or without "Diwali".
const LAKS_PRICES = ['minimum of 2', 'minimum of 4'].map((m) => (new RegExp(`for a ${m} travellers: from (₹[\\d,]+) per person`).exec(LAKSHADWEEP_OFFER) || [])[1]);
const LAKS_PACKAGE = LAKS_PRICES.every(Boolean) ? { name: 'Lakshadweep Escape (Diwali Special)', nights: '3N / 4D',
  quote: `from ${LAKS_PRICES[0]} per person for a minimum of 2 travellers, or ${LAKS_PRICES[1]} per person for a minimum of 4 travellers; flight tickets are extra.`,
  keys: keysOf('Lakshadweep Diwali Agatti Bangaram Kalpitti लक्षद्वीप दिवाली अगत्ती बंगारम कल्पित्ती લક્ષદ્વીપ દિવાળી અગત્તી બંગારમ કલ્પિત્તી') } : null;
// A question about star ratings, luxury, hotels, nights or a group size gets no package figure: a 3-star per-person
// starting price is not its answer ("Goa 5-star price?", "Goa for 6 people?", "per night?").
const NO_FIGURE_QUESTION = /\bstars?\b|★|\bluxur(?:y|ious)\b|\bpremium\b|\bdeluxe\b|\bhotels?\b|\bresorts?\b|\bnights?\b|\bnightly\b|\bgroups?\b|\b(?:\d{1,3}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen)\s+(?:people|persons?|pax|adults?|travell?ers|guests|members|friends|couples|families|kids|children|of\s+us)\b|\bfamily\s+of\s+(?:\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\b|\bwe\s+are\s+(?:\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\b|\bfor\s+(?:\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\b(?!\s*(?:days?|nights?|weeks?|months?|years?)\b)|होटल|स्टार|लक्ज़री|लक्जरी|लग्ज़री|लग्जरी|प्रति\s+रात|रातों|रातें|\d+\s*रात|ग्रुप|समूह|\d+\s*(?:लोग|लोगों|व्यक्ति)|હોટેલ|હોટલ|સ્ટાર|લક્ઝરી|રાત્રિ|રાત\s*દીઠ|પ્રતિ\s+રાત|\d+\s*રાત|ગ્રુપ|જૂથ|\d+\s*(?:લોકો|વ્યક્તિ)/i;
// anthropic-10: a reply replaced for a wrong price of an offer (`about` 'bali', 'laks' or 'both') gets that offer's own
// price while it is offered, whatever the question named ("Diwali?" now names two offers) - also for a group-size question
// (review round 1: "We are 3, Lakshadweep price?" lost the ₹54,000): the offer prices are per person, with their conditions.
function honestPriceReply(question, now, about) {
  const own = [];
  if ((about === 'bali' || about === 'both') && offerState(now) === 'diwali-bali' && DIWALI_PACKAGE) own.push(DIWALI_PACKAGE);
  if ((about === 'laks' || about === 'both') && laksState(now) === 'live' && LAKS_PACKAGE) own.push(LAKS_PACKAGE);
  if (own.length) return [HONEST_PRICE_LINE, ...own.map((p) => `${p.name}, ${p.nights}, is ${p.quote}`)].join(' ');
  if (NO_FIGURE_QUESTION.test(asciiDigits(question))) return HONEST_PRICE_LINE;
  const asked = keysOf(question);
  const packages = [...PRICED_PACKAGES, ...(offerState(now) === 'diwali-bali' && DIWALI_PACKAGE ? [DIWALI_PACKAGE] : []),
    ...(laksState(now) === 'live' && LAKS_PACKAGE ? [LAKS_PACKAGE] : [])];
  const hits = asked.size ? packages.filter((p) => [...asked].every((k) => p.keys.has(k))) : [];
  return hits.length === 1 ? `${HONEST_PRICE_LINE} ${hits[0].name}, ${hits[0].nights}, is ${hits[0].quote}` : HONEST_PRICE_LINE;
}

// ---- the figure must be the named trip's own (anthropic-8, AI Security review) ------------------------------------
// With the owner's destination prices in the prompt, each of them is a published figure, so the check above let through
// "Kashmir Valley 5N/6D (3-star) is from ₹12,900" (the package is ₹27,800; ₹12,900 is the Kashmir destination price),
// "Sikkim Discovery from ₹20,900", "Meghalaya Wonders from ₹20,500", "Kausani & Kumaon from ₹15,900" and "Kashmir for 10
// days from ₹12,900" (that figure is for 5-6 days). Here each published figure is judged against the trip it is quoted
// for: the last package or destination named before it in its sentence, or else the first one named after it in the
// same clause; in a sentence that names none, the last one named earlier in the same paragraph or bullet line (AI
// Security round 2: "Kashmir Valley 5N/6D. Starts from ₹12,900."). A package's figure must be one on that package's own line (Shimla & Manali: also the owner's ₹15,000; a
// package "on request" has none); a destination's must be its own "from" price or a figure of one of its packages; and
// a day or night count stated with it ("for 10 days", "a 10-day", "5N / 6D") must fit that trip - the destination's
// range, the package's own days. Otherwise the reply is replaced. A figure the traveller typed, repeated in a clause
// about their budget, is left to the budget rules above. Names are read in English and, since round 2, in Devanagari and
// Gujarati script too (INDIC_SITE_NAMES, INDIC_TRANSLITERATIONS below).
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ANY_SEP = '(?:\\s*(?:&|and|·|–|—|-|,)\\s*|\\s+)';
const namePattern = (name, sep) => name.split(/\s*(?:&|·|–|,)\s*|\s+/).filter(Boolean).map(escapeRe).join(sep);
const TRIPS = { packages: [], destinations: [] };
for (const line of PUBLISHED_PRICES.split('\n')) {
  const p = /^- (.+?), \d+N \/ (\d+)D \(([^)]*)\): (.*)$/.exec(line);
  if (p) { TRIPS.packages.push({ name: p[1], lo: +p[2], hi: +p[2], figures: moneyFigures(p[4]).map((f) => f.n), keys: keysOf(p[1]), words: [p[1], ...p[3].split(' · ')] }); continue; }
  const d = /^- (.+?) \((\d+)–(\d+) days\): from (₹[\d,]+)\.$/.exec(line);
  if (d) TRIPS.destinations.push({ name: d[1], lo: +d[2], hi: +d[3], figures: moneyFigures(d[4]).map((f) => f.n), keys: keysOf(d[1]) });
}
if (DIWALI_PACKAGE) {
  const days = +(/(\d+)D/.exec(DIWALI_PACKAGE.nights) || [])[1];
  TRIPS.packages.push({ name: DIWALI_PACKAGE.name, lo: days, hi: days, figures: moneyFigures(DIWALI_OFFER_PRICE).map((f) => f.n), keys: DIWALI_PACKAGE.keys, words: [DIWALI_PACKAGE.name] });
}
// anthropic-10: Lakshadweep is a destination with no published price (3-4 days on its page), and the Lakshadweep Escape a
// 3N / 4D trip with its two prices; a figure quoted for Lakshadweep or one of its islands must be one of those two. After
// the offer the two are no longer in the prompt, so any figure for Lakshadweep is an unpublished one.
TRIPS.destinations.push({ name: 'Lakshadweep', lo: 3, hi: 4, figures: [], keys: keysOf('Lakshadweep') });
if (LAKS_PACKAGE) TRIPS.packages.push({ name: 'Lakshadweep Escape', lo: 4, hi: 4, figures: LAKS_PRICES.flatMap((p) => moneyFigures(p).map((f) => f.n)), keys: LAKS_PACKAGE.keys, words: ['Lakshadweep Escape', 'Agatti', 'Bangaram'] });
// Each destination's places, from DESTINATIONS ("Places on our destination pages: Rajasthan: Jaipur, ...; ..."): a
// package belongs to a destination when it names it or visits one of its named places (Kausani & Kumaon - Uttarakhand);
// a shared common noun is not a place ("Tea gardens" would tie Gangtok & Darjeeling to Assam).
const PLACES = new Map(((/Places on our destination pages: ([^\n]*)/.exec(DESTINATIONS) || [])[1] || '').replace(/\.$/, '').split('; ')
  .map((e) => [e.slice(0, e.indexOf(': ')), e.slice(e.indexOf(': ') + 2).split(/,\s*|\s*&\s*/).map((w) => w.replace(/\s*\([^)]*\)/, '').trim().toLowerCase())]));
for (const d of TRIPS.destinations) {
  const places = new Set([...(PLACES.get(d.name) || []), ...d.name.split(/\s*(?:&|·)\s*/).map((w) => w.toLowerCase())]);
  d.owners = [d, ...TRIPS.packages.filter((p) => [...d.keys].some((k) => p.keys.has(k)) || p.words.some((w) => places.has(w.trim().toLowerCase()) && keysOf(w).size > 0))];
}
for (const p of TRIPS.packages) p.dests = TRIPS.destinations.filter((d) => d.owners.includes(p));
// The names, in the order a match is tried: a destination written with its own "·" ("Assam · Kaziranga" is the
// destination, "Assam & Kaziranga" the package), then the packages, longest first ("Kashmir Valley" before "Kashmir"),
// then each part of a destination's name ("Himachal", "Coorg", "Mysore" for Mysuru).
const MENTIONS = [
  ...TRIPS.destinations.filter((d) => d.name.includes('·')).map((d) => ({ src: namePattern(d.name, '\\s*·\\s*'), owners: d.owners })),
  ...[...TRIPS.packages].sort((a, b) => b.name.length - a.name.length).map((p) => ({ src: namePattern(p.name, ANY_SEP), owners: [p], pkg: p })),
  ...TRIPS.destinations.flatMap((d) => [...d.name.split(/\s*(?:&|·)\s*/), ...(d.keys.has('mysuru') ? ['Mysore'] : []), ...(d.name === 'Lakshadweep' ? ['Agatti', 'Bangaram', 'Kalpitti'] : [])]
    .map((part) => ({ src: /^\S+ Pradesh$/.test(part) ? `${escapeRe(part.split(' ')[0])}(?:\\s+Pradesh)?` : namePattern(part, '\\s+'), owners: d.owners, len: part.length })))
    .sort((a, b) => b.len - a.len),
].map((m) => ({ src: m.src, owners: m.owners, pkg: m.pkg, re: new RegExp(`^(?:${m.src})$`, 'i') }));
const TRIP_MENTION = new RegExp(`\\b(?:${MENTIONS.map((m) => m.src).join('|')})\\b`, 'gi');
// Hindi and Gujarati names (AI Security round 2: "कश्मीर वैली 5N/6D ₹12,900 से शुरू है।" passed). The prompt asks for
// package names in English; these catch a reply that translates or spells them out anyway. The site's own names, copied
// by script from name_hi / name_gu in Domestic.dc.html, International.dc.html and Destination.dc.html:
const INDIC_SITE_NAMES = {
  "Royal Rajasthan": ["शाही राजस्थान", "શાહી રાજસ્થાન"],
  "Himachal Hills": ["हिमाचल की पहाड़ियाँ", "હિમાચલની ટેકરીઓ"],
  "Kashmir Valley": ["कश्मीर घाटी", "કાશ્મીર ખીણ"],
  "Kausani & Kumaon": ["कौसानी और कुमाऊँ", "કૌસાની અને કુમાઉં"],
  "Nainital · Mussoorie · Corbett": ["नैनीताल · मसूरी · कॉर्बेट", "નૈનીતાલ · મસૂરી · કોર્બેટ"],
  "Shimla & Manali": ["शिमला और मनाली", "શિમલા અને મનાલી"],
  "Untouched Spiti Valley": ["अछूती स्पीति घाटी", "અસ્પૃશ્ય સ્પિતિ ખીણ"],
  "Gujarat Darshan": ["गुजरात दर्शन", "ગુજરાત દર્શન"],
  "Goa Getaway": ["गोवा गेटअवे", "ગોવા ગેટવે"],
  "Braj & Agra Yatra": ["ब्रज और आगरा यात्रा", "બ્રજ અને આગ્રા યાત્રા"],
  "Sikkim Discovery": ["सिक्किम खोज", "સિક્કિમ શોધ"],
  "Sikkim Honeymoon": ["सिक्किम हनीमून", "સિક્કિમ હનીમૂન"],
  "Gangtok & Darjeeling": ["गंगटोक और दार्जिलिंग", "ગંગટોક અને દાર્જિલિંગ"],
  "Sikkim & Darjeeling": ["सिक्किम और दार्जिलिंग", "સિક્કિમ અને દાર્જિલિંગ"],
  "Meghalaya Wonders": ["मेघालय के अजूबे", "મેઘાલયના અજાયબીઓ"],
  "Assam & Kaziranga": ["असम और काज़ीरंगा", "આસામ અને કાઝીરંગા"],
  "Arunachal Explorer": ["अरुणाचल एक्सप्लोरर", "અરુણાચલ એક્સપ્લોરર"],
  "Nagaland Highlands": ["नागालैंड हाइलैंड्स", "નાગાલેન્ડ હાઇલેન્ડ્સ"],
  "Manipur & Loktak": ["मणिपुर और लोकतक", "મણિપુર અને લોકતક"],
  "Mizoram Discovery": ["मिज़ोरम खोज", "મિઝોરમ શોધ"],
  "Kerala Backwaters": ["केरल बैकवाटर्स", "કેરળ બેકવોટર્સ"],
  "Mysuru–Coorg–Ooty": ["मैसूर–कूर्ग–ऊटी", "મૈસૂર–કૂર્ગ–ઊટી"],
  "South Temple Trail": ["दक्षिण मंदिर यात्रा", "દક્ષિણ મંદિર માર્ગ"],
  "Ooty · Coorg · Mysore": ["ऊटी · कूर्ग · मैसूर", "ઊટી · કૂર્ગ · મૈસૂર"],
  "Thailand Explorer": ["थाईलैंड एक्सप्लोरर", "થાઇલેન્ડ એક્સપ્લોરર"],
  "Bali 7 Nights with Flights": ["बाली 7 रातें, फ़्लाइट सहित", "બાલી 7 રાત, ફ્લાઇટ સાથે"],
  "Maldives Escape": ["मालदीव एस्केप", "માલદીવ્સ એસ્કેપ"],
  "Rajasthan": ["राजस्थान", "રાજસ્થાન"],
  "Himachal Pradesh": ["हिमाचल प्रदेश", "હિમાચલ પ્રદેશ"],
  "Kashmir": ["कश्मीर", "કાશ્મીર"],
  "Kerala": ["केरल", "કેરળ"],
  "Goa": ["गोवा", "ગોવા"],
  "Ooty & Nilgiris": ["ऊटी और नीलगिरि", "ઊટી અને નીલગિરિ"],
  "Mysuru & Coorg": ["मैसूर और कूर्ग", "મૈસૂર અને કૂર્ગ"],
  "Agra & Taj Mahal": ["आगरा और ताज महल", "આગ્રા અને તાજમહેલ"],
  "Uttarakhand": ["उत्तराखंड", "ઉત્તરાખંડ"],
  "Thailand": ["थाईलैंड", "થાઇલેન્ડ"],
  "Bali": ["बाली", "બાલી"],
  "Maldives": ["मालदीव", "માલદીવ્સ"],
  "Meghalaya": ["मेघालय", "મેઘાલય"],
  "Assam · Kaziranga": ["असम · काज़ीरंगा", "આસામ · કાઝીરંગા"],
  "Arunachal Pradesh": ["अरुणाचल प्रदेश", "અરુણાચલ પ્રદેશ"],
  "Nagaland": ["नागालैंड", "નાગાલેન્ડ"],
  "Manipur · Loktak": ["मणिपुर · लोकतक", "મણિપુર · લોકતક"],
  "Mizoram": ["मिज़ोरम", "મિઝોરમ"],
  "Sikkim": ["सिक्किम", "સિક્કિમ"],
  "Lakshadweep": ["लक्षद्वीप", "લક્ષદ્વીપ"],
  "Lakshadweep Escape": ["लक्षद्वीप की सैर", "લક્ષદ્વીપની સફર"],
};
// anthropic-10: Lakshadweep's islands, as diwali-lakshadweep.html writes them (data-hi / data-gu of "Agatti Island",
// "Bangaram Island", "Kalpitti Island"); read as the destination, like "Agatti" in English.
const INDIC_PLACE_ALIASES = { "Lakshadweep": ["अगत्ती", "बंगारम", "कल्पित्ती", "અગત્તી", "બંગારમ", "કલ્પિત્તી"] };
// TRANSLITERATION - needs the owner's fluent read. The English names spelt out in Devanagari / Gujarati script, and a
// few spelling variants, written for this check (not site text):
//   Royal Rajasthan: रॉयल राजस्थान, રોયલ રાજસ્થાન
//   Himachal Hills: हिमाचल हिल्स, હિમાચલ હિલ્સ
//   Kashmir Valley: कश्मीर वैली, काश्मीर वैली, કાશ્મીર વેલી
//   Kausani & Kumaon: कौसानी और कुमाऊं, કૌસાની અને કુમાઉ
//   Untouched Spiti Valley: स्पीति वैली, સ્પિતિ વેલી
//   Goa Getaway: गोवा गेटवे, ગોવા ગેટઅવે
//   Sikkim Discovery: सिक्किम डिस्कवरी, સિક્કિમ ડિસ્કવરી
//   Meghalaya Wonders: मेघालय वंडर्स, મેઘાલય વન્ડર્સ, મેઘાલય વંડર્સ
//   Mizoram Discovery: मिज़ोरम डिस्कवरी, મિઝોરમ ડિસ્કવરી
//   Kerala Backwaters: केरला बैकवाटर्स, કેરલા બેકવોટર્સ
//   Mysuru–Coorg–Ooty: मैसूरु–कूर्ग–ऊटी, મૈસુરુ–કૂર્ગ–ઊટી
//   South Temple Trail: साउथ टेम्पल ट्रेल, સાઉથ ટેમ્પલ ટ્રેલ
//   Thailand Explorer: थाइलैंड एक्सप्लोरर, થાઈલેન્ડ એક્સપ્લોરર
//   Maldives Escape: मालदीव्स एस्केप, માલદીવ એસ્કેપ
//   Diwali in Bali: दिवाली इन बाली, बाली में दिवाली, दिवाली बाली, દિવાળી ઇન બાલી, બાલીમાં દિવાળી, દિવાળી બાલી
//   Kashmir: काश्मीर, કશ્મીર
//   Kerala: केरला, કેરલ, કેરાલા
//   Assam · Kaziranga: आसाम
//   Uttarakhand: उत्तराखण्ड
//   Thailand: थाइलैंड, થાઈલેન્ડ
//   Maldives: मालदीव्स, માલદીવ
//   Mysuru & Coorg: मैसूरु, મૈસુરુ, મૈસુર
//   Agra & Taj Mahal: ताजमहल
const INDIC_TRANSLITERATIONS = {
  "Royal Rajasthan": ["रॉयल राजस्थान", "રોયલ રાજસ્થાન"],
  "Himachal Hills": ["हिमाचल हिल्स", "હિમાચલ હિલ્સ"],
  "Kashmir Valley": ["कश्मीर वैली", "काश्मीर वैली", "કાશ્મીર વેલી"],
  "Kausani & Kumaon": ["कौसानी और कुमाऊं", "કૌસાની અને કુમાઉ"],
  "Untouched Spiti Valley": ["स्पीति वैली", "સ્પિતિ વેલી"],
  "Goa Getaway": ["गोवा गेटवे", "ગોવા ગેટઅવે"],
  "Sikkim Discovery": ["सिक्किम डिस्कवरी", "સિક્કિમ ડિસ્કવરી"],
  "Meghalaya Wonders": ["मेघालय वंडर्स", "મેઘાલય વન્ડર્સ", "મેઘાલય વંડર્સ"],
  "Mizoram Discovery": ["मिज़ोरम डिस्कवरी", "મિઝોરમ ડિસ્કવરી"],
  "Kerala Backwaters": ["केरला बैकवाटर्स", "કેરલા બેકવોટર્સ"],
  "Mysuru–Coorg–Ooty": ["मैसूरु–कूर्ग–ऊटी", "મૈસુરુ–કૂર્ગ–ઊટી"],
  "South Temple Trail": ["साउथ टेम्पल ट्रेल", "સાઉથ ટેમ્પલ ટ્રેલ"],
  "Thailand Explorer": ["थाइलैंड एक्सप्लोरर", "થાઈલેન્ડ એક્સપ્લોરર"],
  "Maldives Escape": ["मालदीव्स एस्केप", "માલદીવ એસ્કેપ"],
  "Diwali in Bali": ["दिवाली इन बाली", "बाली में दिवाली", "दिवाली बाली", "દિવાળી ઇન બાલી", "બાલીમાં દિવાળી", "દિવાળી બાલી"],
  "Kashmir": ["काश्मीर", "કશ્મીર"],
  "Kerala": ["केरला", "કેરલ", "કેરાલા"],
  "Assam · Kaziranga": ["आसाम"],
  "Uttarakhand": ["उत्तराखण्ड"],
  "Thailand": ["थाइलैंड", "થાઈલેન્ડ"],
  "Maldives": ["मालदीव्स", "માલદીવ"],
  "Mysuru & Coorg": ["मैसूरु", "મૈસુરુ", "મૈસુર"],
  "Agra & Taj Mahal": ["ताजमहल"],
};
// Matched like the English names (a "·" destination first, then packages longest first, then destination parts; "X
// प्रदेश" also as X), with any nukta optional (मिज़ोरम = मिजोरम). A Devanagari name must end the word ("असम" is not in
// "असमर्थ"); a Gujarati one may carry a case ending ("કાશ્મીરમાં").
const NUKTA = String.fromCharCode(0x093C);
const INDIC_SEP = '(?:\\s*(?:&|और|અને|·|–|—|-|,)\\s*|\\s+)';
const indicPattern = (alias, sep) => {
  const words = alias.normalize('NFD').split(NUKTA).join('').split(/\s*(?:&|·|–|—|,)\s*|\s+(?:और|અને)\s+|\s+/).filter(Boolean);
  const pradesh = words.length === 2 && /^(?:प्रदेश|પ્રદેશ)$/.test(words[1]);
  const pat = pradesh ? `${escapeRe(words[0])}(?:\\s+${words[1]})?` : words.map((w) => escapeRe(w).replace(/[कखगजडढफय]/g, (c) => c + NUKTA + '?')).join(sep);
  const deva = alias.charCodeAt(0) >= 0x0900 && alias.charCodeAt(0) <= 0x097F;
  return `(?<![\\p{L}\\p{M}])${pat}${deva ? '(?![\\p{L}\\p{M}])' : ''}`;
};
const indicAliases = (name) => [...(INDIC_SITE_NAMES[name] || []), ...(INDIC_TRANSLITERATIONS[name] || []), ...(INDIC_PLACE_ALIASES[name] || [])];
const INDIC_MENTIONS = [
  ...TRIPS.destinations.filter((d) => d.name.includes('·')).flatMap((d) => indicAliases(d.name).filter((a) => a.includes('·')).map((a) => ({ src: indicPattern(a, '\\s*·\\s*'), owners: d.owners }))),
  ...TRIPS.packages.flatMap((p) => indicAliases(p.name).map((a) => ({ src: indicPattern(a, INDIC_SEP), owners: [p], pkg: p, len: a.length }))).sort((a, b) => b.len - a.len),
  ...TRIPS.destinations.flatMap((d) => indicAliases(d.name).flatMap((a) => (/^\S+ (?:प्रदेश|પ્રદેશ)$/.test(a) ? [a] : a.split(/\s*·\s*|\s+(?:और|અને)\s+/)))
    .map((part) => ({ src: indicPattern(part, '\\s+'), owners: d.owners, len: part.length }))).sort((a, b) => b.len - a.len),
].map((m) => ({ src: m.src, owners: m.owners, pkg: m.pkg, re: new RegExp(`^(?:${m.src})$`, 'u') }));
const INDIC_TRIP_MENTION = new RegExp(INDIC_MENTIONS.map((m) => m.src).join('|'), 'gu');
const mentionOf = (list, name) => list.find((m) => m.re.test(name)) || { owners: [] };
// Every trip named in s (which starts at `at` in the reply), in order.
const mentionsIn = (s, at) => [...s.matchAll(TRIP_MENTION)].map((m) => ({ start: at + m.index, end: at + m.index + m[0].length, ...mentionOf(MENTIONS, m[0]) }))
  .concat([...s.matchAll(INDIC_TRIP_MENTION)].map((m) => ({ start: at + m.index, end: at + m.index + m[0].length, ...mentionOf(INDIC_MENTIONS, m[0]) })))
  .sort((a, b) => a.start - b.start);
// Day counts: "10 days", "5–6 days", "10-day", "6D", "5 nights" and "5N" (6 days), in Hindi and Gujarati too.
const DAY_COUNT = /(?<![\d,.])(\d{1,2})(?:\s*(?:-|–|—|to)\s*(\d{1,2}))?\s*-?\s*(?:([Dd]ays?\b|D\b|दिन|દિવસ)|([Nn]ights?\b|N\b|रात|રાત))/g;
const DAY_COUNT_AT = new RegExp(`^(?:${DAY_COUNT.source})`);
const dayCounts = (s) => [...s.matchAll(DAY_COUNT)].map((m) => { const add = m[4] ? 1 : 0, a = +m[1] + add; return [a, (m[2] ? +m[2] : +m[1]) + add]; });
const FIGURE_TEXT = /^\d[\d,]*(?:\.\d+)?(?:\s*(?:k|lakhs?|lacs?|लाख|લાખ)(?![a-z]))?/i;
// "from ₹12,900 per person for 10 days": a count right after the figure belongs to it too.
const TRAILING_FOR = /^\s*(?:(?:\/-|rupees?|rs\.?|inr|per\s+person|pp|each|onwards|\((?:3-star|3★)\))\s*)*(?:for|of)\s+(?:a\s+|an\s+)?(?=\d)/i;
const FIG_CLAUSE = /(?<!\d),|,(?!\d)|[;:]/g;
// A paragraph ends at a blank line, and a bullet or numbered line is a paragraph of its own.
const UNIT_BREAK = /\n[ \t]*\n|\n(?=[ \t]*(?:[-*•]|\d{1,2}[.)])\s)/g;
// anthropic-10, review round 2 (second opinion): while a Diwali offer runs, a Diwali word between the trip named before a
// figure (or carried from an earlier sentence) and the figure means the figure is an offer's ("Diwali in Bali is ... . For
// a shorter trip, our Diwali Special to the islands is from ₹54,000"; "Like Bali, it has a Diwali Special: from ₹54,000");
// the Diwali checks judge it instead (diwaliChecks), so it is not held to that trip here.
function tripFigureMismatch(text, figures, known, convo, offersLive = false) {
  if (!figures.some((f) => known.figures.has(f.n))) return false;
  const digits = asciiDigits(text);
  const unitEnds = [...text.matchAll(UNIT_BREAK)].map((m) => m.index);
  const diwaliAt = offersLive ? [...text.matchAll(DIWALI_NAMES)].map((m) => m.index) : [];
  let typed = null, fi = 0, ui = 0, carry = null, carryUnit = -1;
  for (const { start, end } of sentences(text)) {
    while (ui < unitEnds.length && unitEnds[ui] < start) ui++;
    if (ui !== carryUnit) carry = null;
    const figs = [];
    for (; fi < figures.length && figures[fi].at < end; fi++) if (figures[fi].at >= start) figs.push(figures[fi]);
    const s = text.slice(start, end);
    const mentions = mentionsIn(s, start);
    if (figs.some((f) => known.figures.has(f.n)) && (mentions.length || carry)) {
      const breakAt = [], breakEnd = [];
      for (const m of s.matchAll(FIG_CLAUSE)) { breakAt.push(start + m.index); breakEnd.push(start + m.index + m[0].length); }
      const ends = mentions.map((m) => m.end);
      let prevFigEnd = start;
      for (const f of figs) {
        const figEnd = f.at + (FIGURE_TEXT.exec(digits.slice(f.at, f.at + 40)) || [''])[0].length;
        if (known.figures.has(f.n) && (f.hi === undefined || known.figures.has(f.hi))) {
          let k = 0; { let hi = ends.length; while (k < hi) { const mid = (k + hi) >> 1; if (ends[mid] <= f.at) k = mid + 1; else hi = mid; } } // mentions[k - 1] ends before f
          let trip = null, span = '', carried = false;
          const trailing = () => {
            const trail = TRAILING_FOR.exec(digits.slice(figEnd, figEnd + 60));
            const count = trail && DAY_COUNT_AT.exec(digits.slice(figEnd + trail[0].length, figEnd + trail[0].length + 24));
            return count ? ' ' + count[0] : '';
          };
          if (k > 0) {
            trip = mentions[k - 1];
            const clauseStart = Math.max(start, lastBefore(breakEnd, trip.start + 1));
            span = digits.slice(Math.max(prevFigEnd, k > 1 ? mentions[k - 2].end : start, clauseStart), f.at) + trailing();
          } else if (mentions.length) {
            if (firstIn(breakAt, figEnd, mentions[0].start) < 0) { trip = mentions[0]; span = digits.slice(f.at, trip.end); }
          } else {
            trip = carry; carried = true;
            span = digits.slice(prevFigEnd, f.at) + trailing();
          }
          if (trip && (carried ? firstIn(diwaliAt, start, f.at) >= 0 : firstIn(diwaliAt, trip.end, f.at) >= 0)) trip = null;
          if (trip) {
            const stated = dayCounts(span);
            const fitsTrip = (o) => o.figures.includes(f.n) && (f.hi === undefined || o.figures.includes(f.hi)) && stated.every(([a, b]) => a >= o.lo && b <= o.hi);
            // A package named in an earlier sentence: its own figure, or - only when this sentence states a length the
            // package does not have ("Shorter trips (4-7 days) start from ₹18,000") - one of its destinations' figures.
            let owners = trip.owners;
            if (carried && trip.pkg) owners = stated.length && !stated.every(([a, b]) => a >= trip.pkg.lo && b <= trip.pkg.hi) ? [trip.pkg, ...trip.pkg.dests] : [trip.pkg];
            if (!owners.some(fitsTrip)) {
              if (!typed) typed = typedAmounts(convo);
              const a = lastBefore(breakEnd, f.at + 1), b = firstIn(breakAt, f.at, end);
              if (!(typed.has(f.n) && BUDGET_WORDS.test(text.slice(Math.max(start, a), b < 0 ? end : b)))) return true;
            }
          }
        }
        prevFigEnd = Math.max(prevFigEnd, figEnd);
      }
    }
    if (mentions.length) { carry = mentions[mentions.length - 1]; carryUnit = ui; }
  }
  return false;
}

// Promises nobody can keep: a confirmed booking, a guaranteed/locked/fixed price, a visa outcome, a held seat, a
// booking made or a payment received. "confirmed only/by/after/until ..." describes who confirms, not a confirmation.
// anthropic-7 (AI Security): "booking is confirmed by ..." is the process only when the provider, airline, operator, hotel
// or railway confirms it (also "at (the time of) booking by" one of them, and with one adverb: "confirmed directly by the
// airline"), and never in a sentence that also says today, now, already, done or is booked; "confirmed after / until /
// once / when ..." (also "only after") still describes the process. "Your booking is confirmed by our team today", "...
// confirmed at booking time. Done." and "Your booking is already / now confirmed" are claims.
const PROMISE = /\b(booking\s+(is\s+)?(?:(?:already|now|also|all|fully)\s+)?confirmed(?!\s+(?:[a-z]+ly\s+)?(?:after|until|once|when)\b|(?<!\b(?:today|now|already|done|is\s+booked)\b[^.!?\n]*)\s+(?:[a-z]+ly\s+)?(?:at\s+(?:the\s+time\s+of\s+)?booking\s+)?by\s+(?:the\s+)?(?:official\s+)?(?:provider|airline|operator|hotel|railway)s?\b(?![^.!?\n]*\b(?:today|now|already|done|is\s+booked)\b))|confirmed\s+your\s+booking|guarantee[ds]?\s+(the\s+|your\s+)?price|price\s+(is\s+)?(locked|guaranteed)|locked[-\s]?in\s+price|visa\s+(is\s+)?(approved|guaranteed|confirmed)(?!\s+(only|by|after|until)\b)|guarantee[ds]?\s+(your\s+)?visa|reserved\s+(a\s+|your\s+|the\s+)?(seats?|spots?|places?)|hold(ing)?\s+((you|for\s+you)\s+)?(a\s+|your\s+|the\s+)?(seats?|spots?|places?)|lock(ed|ing)?\s+(it|this|that|them)\s+in|lock(ed|ing)?\s+in\s+(the\s+|your\s+|this\s+|a\s+)?(price|rate|deal|seats?|spots?|fare)|(seats?|spots?|places?|booking)\s+(is|are|has\s+been|have\s+been)\s+(now\s+)?(reserved|held|secured|locked)|(?<!\bnot\s|n't\s|n’t\s)booked\s+(your|the)\s+(seats?|tickets?|hotel)|payment\s+(is\s+|has\s+been\s+)?received|received\s+your\s+payment|(visa|approval)\s+(is\s+)?assured|prices?\s+(is\s+|are\s+)?fixed|prices?\s+(won't|won’t|will\s+not)\s+change)\b/i;

// Hindi/Gujarati "booking confirmed / seat reserved" claims (the English ones are PROMISE above). The verb decides whether
// a sentence that names a booking and a confirmation claims one: a done form (below) always does; otherwise a process
// form (INDIC_CONFIRM_PROCESS, beside NEGATION, which explains both) means it does not.
const INDIC_CONFIRMED_DONE = /(?:कन्फर्म(?:्ड)?|पक्की|पक्का|रिज़र्व|रिजर्व|होल्ड)\s*(?:(?:भी|तो|अब|आज|ही)\s*)?(?:है|हैं|हुई|हुआ|हुए|किया(?!\s*जा)|(?:की|किया|किए)\s*(?:गई|गयी|गया|गए)|कर\s*(?:दी|दिया|दिए|ली|लिया|लिए)(?!\s*जा)|हो\s*(?:गई|गयी|गया|गए|चुकी|चुका|चुके))|(?:કન્ફર્મ|પાકી|પાકું|રિઝર્વ|હોલ્ડ)\s*(?:(?:પણ|તો|હવે|આજે|જ)\s*)?(?:છે|થયું|થયો|થયેલ|થયા(?!\s*પછી)|થઈ\s*(?:ગ|ચૂક)|થઇ\s*(?:ગ|ચૂક)|કરાઈ|કરાઇ|કરાયું|કરાયો|કરાયા|કરી\s*(?:દીધ|લીધ)|કરી\s*દેવા(?:ઈ|યું|માં\s*આવ(?:ી|્ય))|કરવામાં\s*(?:આવી|આવ્ય)|કરેલ)/;
const claimsIndicBooking = (reply) => sentences(reply).some(({ start, end }) => {
  const s = reply.slice(start, end);
  return INDIC_BOOKING_CLAIM.test(s) && !NEGATION.test(s) && (INDIC_CONFIRMED_DONE.test(s) || !INDIC_CONFIRM_PROCESS.test(s));
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

// ---- the price note (anthropic-8) ---------------------------------------------------------------------------------
// Live test run 3 (2026-09-30): a Gujarati reply that carried the model's own Gujarati note got the English note as well
// (GU1, GU2), and one without a note got the English note under Gujarati text (GU3). The note now follows the reply: the
// most Gujarati letters - Gujarati; the most Devanagari letters - Hindi; otherwise English, counting no Latin letters of
// our package, destination, place or page names (AI Security review: a Hindi reply that quoted "Goa Getaway" and
// "Customize My Trip" got the English note). It is added only when no note sentence is there already, in any of the
// three languages, so a reply never carries two.
// The Hindi and Gujarati wording is the site's own, copied by script (not typed): the sentence is the first one of the
// fine print on diwali-bali.html - the data-hi / data-gu of the note whose data-en begins "*Prices are indicative
// starting-from estimates per person and can change with season, hotel availability and current rates." - without its
// "*"; the label is the one on Destination.dc.html's price note (data-hi "ध्यान दें:", data-gu "નોંધ:").
// The test (server/test-chat-worker.mjs) reads both files and fails if these words and the site's drift apart.
const PRICE_NOTE = {
  en: 'Note: Prices are indicative starting-from estimates and can change with season, hotel availability and current rates.',
  hi: 'ध्यान दें: कीमतें प्रति व्यक्ति शुरुआती अनुमान हैं, सिर्फ़ अंदाज़े के लिए, और सीज़न, होटल की उपलब्धता और मौजूदा रेट के हिसाब से बदल सकती हैं।',
  gu: 'નોંધ: દર્શાવેલી કિંમતો વ્યક્તિ દીઠ અંદાજિત શરૂઆતી ભાવ છે અને સીઝન, હોટેલની ઉપલબ્ધતા અને વર્તમાન દરો પ્રમાણે બદલાઈ શકે છે.',
};
const GUJARATI_LETTER = /[\u0A80-\u0AFF]/g;
const DEVANAGARI_LETTER = /[\u0900-\u097F]/g;
const LATIN_LETTER = /[A-Za-z]/g;
const PAGE_NAMES = /\b(?:Customize\s+My\s+Trip|WhatsApp|Skyline(?:\s+AI)?(?:\s+Travel\s+(?:Planner|Assistant))?|Domestic\s+tours?|International|Festive\s+offers?)\b/gi;
const PLACE_NAMES = new RegExp(`\\b(?:${[...new Set([...PLACES.values()].flat().concat(TRIPS.packages.flatMap((p) => p.words.slice(1).map((w) => w.toLowerCase()))))]
  .filter((w) => w.length > 2).sort((a, b) => b.length - a.length).map((w) => namePattern(w, '\\s+')).join('|')})\\b`, 'gi');
function priceNoteFor(reply) {
  const text = reply.replace(TRIP_MENTION, ' ').replace(PLACE_NAMES, ' ').replace(PAGE_NAMES, ' ');
  const n = (re) => (text.match(re) || []).length;
  const gu = n(GUJARATI_LETTER), hi = n(DEVANAGARI_LETTER), en = n(LATIN_LETTER);
  if (gu > hi && gu > en) return PRICE_NOTE.gu;
  if (hi > gu && hi > en) return PRICE_NOTE.hi;
  return PRICE_NOTE.en;
}
// A note already there - a real note SENTENCE (AI Security review: a stray word is not a note, and when in doubt the
// note is added). English: a sentence that says "indicative" and opens with "Note:" or also says "starting-from" or
// "estimate" ("Prices indicative? Ignore this." is not one). Hindi / Gujarati: a sentence with a price word and a
// can-change / indicative word that opens with a note label (नोट: / ध्यान दें: / નોંધ:) or says starting-from
// (शुरुआती / શરૂઆતી) - the model's own notes of run 3 (GU1: "નોંધ: કિંમતો સૂચક શરૂઆતના અંદાજ છે અને સીઝન, હોટેલ
// ઉપલબ્ધતા તથા વર્તમાન દર મુજબ બદલાઈ શકે છે.") and the site's wording above count; "ભાવ ફેરફાર", "અમારી ટીમ ભાવ સૂચક
// રીતે કહેશે" and a bare "कीमतें बदल सकती हैं" do not.
const NOTE_LABEL = /^[\s(*_]*(?:note|नोट|ध्यान\s*दें|નોંધ|નોટ)\s*:/i;
const INDICATIVE_EN = /indicative/i;
const STARTING_EN = /starting[-\s]from|estimate/i;
const INDIC_PRICE_WORD = /कीमत|क़ीमत|मूल्य|दाम|भाव|रेट|કિંમત|ભાવ|રેટ/;
const INDIC_CHANGE_WORD = /बदल\s*सकत|बदल\s*जा\s*सकत|परिवर्तन|सांकेतिक|सूचक|બદલાઈ\s*શક|બદલાઇ\s*શક|બદલી\s*શક|બદલાય|ફેરફાર|સૂચક|સાંકેતિક/;
const INDIC_STARTING = /शुरुआत|શરૂઆત/;
const isNoteSentence = (s) => (INDICATIVE_EN.test(s) && (NOTE_LABEL.test(s) || STARTING_EN.test(s)))
  || (INDIC_PRICE_WORD.test(s) && INDIC_CHANGE_WORD.test(s) && (NOTE_LABEL.test(s) || INDIC_STARTING.test(s)));
const hasPriceNote = (reply) => sentences(reply).some(({ start, end }) => isNoteSentence(reply.slice(start, end)));

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
        // AI Security: when the visitor's own message is garbled too, a retry would only bring the same again - no second
        // call (it would double the cost of every such message).
        if (isGarbled(convo[convo.length - 1].content)) {
          console.warn(JSON.stringify({ garbled: 'visitor text garbled too, no retry' }));
          return answer(GARBLED_LINE);
        }
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
      let replaced = false, extra = false, laksExtra = false, laksFlights = false, laksPax = false, about = null;
      const hint = offerHint(convo), smallAsked = smallGroupAsked(convo);
      for (const text of written === reply ? [reply] : [written, reply]) {
        const figures = moneyFigures(text);
        const offer = diwaliChecks(text, figures, now, hint, smallAsked);
        extra = extra || offer.extra;
        laksExtra = laksExtra || offer.laksExtra;
        laksFlights = laksFlights || offer.laksFlights;
        laksPax = laksPax || offer.laksPax;
        if (offer.replace && !about) about = offer.about;
        replaced = replaced || offer.replace || offersDiscount(text) || quotesUnpublishedFigure(text, figures, system, convo)
          || tripFigureMismatch(text, figures, publishedFigures(system), convo, offerState(now) !== 'none' || laksState(now) === 'live');
      }
      const permit = permitClaimed(written, hint);
      if (replaced) reply = honestPriceReply(convo[convo.length - 1].content, now, about);

      // Guarantee the price disclaimer whenever the reply quotes any prices (₹ / Rs / INR / rupees / 5k / ...),
      // even if the model forgot to add it. anthropic-8: in the reply's language, and skipped if a note is already
      // present in any of the three languages (hasPriceNote, priceNoteFor).
      if ((/[₹]|\bRs\.?\b|\bINR\b/i.test(reply) || moneyFigures(reply).length) && !hasPriceNote(reply)) {
        reply += '\n\n' + priceNoteFor(reply);
      }

      // Deterministic safety backstop (do not rely on the prompt alone): if the model
      // ever asserts a CONFIRMED booking, a GUARANTEED/locked price, or a visa outcome,
      // append a correction. These claims are real business/legal liability.
      if (PROMISE.test(reply) || SEAT_CLAIM.test(reply) || claimsIndicBooking(reply)) {
        reply += '\n\n(To be clear: I can\'t confirm bookings, hold seats, guarantee prices, or guarantee visa outcomes — our team or the official provider confirms those. Please message us on WhatsApp at +91 88660 50291 for an exact quote.)';
      }
      if (extra && !replaced) reply += DIWALI_INCLUDED_NOTE;
      if (laksExtra && !replaced) reply += LAKS_INCLUDED_NOTE;
      else if (laksFlights && !replaced) reply += LAKS_FLIGHTS_NOTE;
      if (laksPax && !replaced) reply += LAKS_PAX_NOTE;
      if (permit && !replaced) reply += LAKS_PERMIT_NOTE;

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
