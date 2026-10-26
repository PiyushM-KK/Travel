// The GUIDED WhatsApp intake (owner 2026-10-26): every photo, video or note opens a menu; the guide asks only
// what the choice needs (price, accounts, destination, the AI Reel's cost) and hands the work to its actions.
// Offline: an in-memory Redis, fake WhatsApp sends, fake actions and fake hosting - nothing leaves the process.
//   node tests/check_wa_guide.js

const path = require("path");
const A = (f) => path.join(__dirname, "..", "automation", f);
const { handleInbound, extractIncomingMessage } = require(A("whatsapp.js"));
const { createGuide, filmablePlace, cleanLabel, platformsFrom } = require(A("wa-guide.js"));
const { guideActions } = require(A("wa-guide-actions.js"));
const RR = require(A("reel-requests.js"));
const { parseMarkup, repricedLine, markupLabel } = require(A("packages.js"));
const { buildResellerCards } = require(A("reseller.js"));
const { makePhotoClip, downloadPhoto } = require(A("photo-clip.js"));
const { InMemoryStore } = require(A("store.js"));

delete process.env.WHATSAPP_TO; // the reel-request job's notices must have nobody to reach

const fails = [];
function ok(cond, label) { console.log(`  ${cond ? "ok" : "FAIL"} - ${label}`); if (!cond) fails.push(label); }

/** Just enough Redis for the guide and the reel queue (the commands they use, as Upstash answers them). */
function memRedis() {
  const kv = new Map(), lists = new Map();
  const L = (k) => { if (!lists.has(k)) lists.set(k, []); return lists.get(k); };
  return {
    kv, lists,
    async cmd(a) {
      const [c, ...r] = a;
      switch (String(c).toUpperCase()) {
        case "GET": return kv.has(r[0]) ? kv.get(r[0]) : null;
        case "SET": if (r.includes("NX") && kv.has(r[0])) return null; kv.set(r[0], r[1]); return "OK";
        case "DEL": { const had = kv.delete(r[0]); lists.delete(r[0]); return had ? 1 : 0; }
        case "INCR": { const v = (Number(kv.get(r[0])) || 0) + 1; kv.set(r[0], String(v)); return v; }
        case "EXPIRE": return 1;
        case "LPUSH": L(r[0]).unshift(r[1]); return L(r[0]).length;
        case "RPUSH": L(r[0]).push(r[1]); return L(r[0]).length;
        case "LLEN": return L(r[0]).length;
        case "LRANGE": return L(r[0]).slice();
        case "LREM": { const l = L(r[0]); const i = l.indexOf(r[2]); if (i < 0) return 0; l.splice(i, 1); return 1; }
        case "LSET": { const l = L(r[0]); const i = Number(r[1]); if (i < 0 || i >= l.length) throw new Error("ERR index out of range"); l[i] = r[2]; return "OK"; }
        case "LMOVE": { const s = L(r[0]); if (!s.length) return null; const v = s.pop(); L(r[1]).unshift(v); return v; }
        default: throw new Error("memRedis: no " + c);
      }
    },
  };
}

const OWNER = "15550001234";
let seq = 0;
const wa = (m) => ({ entry: [{ changes: [{ value: { messages: [{ from: OWNER, id: "wamid." + ++seq, ...m }] } }] }] });
const photo = (caption) => wa({ type: "image", image: { id: "MEDIA" + seq, mime_type: "image/jpeg", ...(caption ? { caption } : {}) } });
const video = () => wa({ type: "video", video: { id: "VID" + seq, mime_type: "video/mp4" } });
const note = (body) => wa({ type: "text", text: { body } });
const tap = (id, title = "x") => wa({ type: "interactive", interactive: { type: "button_reply", button_reply: { id, title } } });
const pick = (id, title = "x") => wa({ type: "interactive", interactive: { type: "list_reply", list_reply: { id, title } } });

function harness() {
  const redis = memRedis(), sent = [], ran = [], decisions = [];
  const send = {
    text: async (to, b) => { sent.push({ t: "text", b }); },
    buttons: async (to, b, bt) => { sent.push({ t: "buttons", b, raw: bt.map((x) => x.id), ids: bt.map((x) => x.id.split("~")[0]), titles: bt.map((x) => x.title) }); },
    list: async (to, b, btn, rows) => { sent.push({ t: "list", b, raw: rows.map((x) => x.id), ids: rows.map((x) => x.id.split("~")[0]), titles: rows.map((x) => x.title) }); },
  };
  const act = (name) => async (job) => { ran.push({ name, job }); return `DONE ${name}`; };
  const flags = { aiAllowed: true };
  const guide = createGuide({ kv: redis, k: (x) => "social:" + x, send, actions: { photo: act("photo"), note: act("note"), offer: act("offer"), card: act("card"), video: act("video"), reel: act("reel"), aiAllowed: async () => flags.aiAllowed } });
  const ctx = {
    authorizedNumber: OWNER, guide,
    seen: async (id) => (await redis.cmd(["SET", "social:wa:seen:" + id, "1", "NX", "EX", "172800"])) === "OK",
    applyDecision: async (id, decision) => { decisions.push({ id, decision }); return { ok: true, status: "approved" }; },
    reply: async (to, b) => { sent.push({ t: "reply", b }); },
    extractImageUrl: () => "",
  };
  const go = (body) => handleInbound(body, ctx);
  const last = () => sent[sent.length - 1];
  return { redis, sent, ran, decisions, ctx, go, last, guide, flags };
}

(async () => {
  console.log("Guided WhatsApp intake (offline)");

  // ---------------------------------------------------------------- reading what arrives
  {
    const v = extractIncomingMessage(video());
    const t = extractIncomingMessage(pick("g:a:offer", "Offer card (poster)"));
    const d = extractIncomingMessage(wa({ type: "document", document: { id: "D1", mime_type: "application/pdf", caption: "Goa offer" } }));
    const au = extractIncomingMessage(wa({ type: "audio", audio: { id: "A1" } }));
    ok(v.video && v.video.id && t.choice && t.choice.id === "g:a:offer" && d.document && d.text === "Goa offer" && au.audio === true, "videos, documents, voice notes and the id of a tapped list row are read");
  }

  // ---------------------------------------------------------------- photo -> offer card, a typed markup, Instagram only
  {
    const h = harness();
    await h.go(photo());
    ok(h.last().t === "list" && h.last().ids.join() === "g:a:photo,g:a:offer,g:a:reel_photo,g:cancel", "a photo ALWAYS opens the menu first: post / offer card / Reel / cancel (a list: four options)");
    ok(h.ran.length === 0, "...and nothing is drafted before the owner chooses");
    await h.go(pick("g:a:offer"));
    ok(h.last().t === "buttons" && h.last().ids.join() === "g:mk:10,g:mk:0,g:mk:other" && /per-person price on the poster/.test(h.last().b), "Offer card asks the price: +10% / as is / other amount");
    await h.go(tap("g:mk:other"));
    ok(/\+12%/.test(h.last().b), "Other amount asks for a typed figure");
    await h.go(note("+12%"));
    ok(h.last().t === "buttons" && h.last().ids.join() === "g:pf:both,g:pf:ig,g:pf:fb", "then the accounts: Instagram + Facebook / Instagram / Facebook");
    await h.go(tap("g:pf:ig"));
    const r = h.ran[0];
    ok(h.ran.length === 1 && r.name === "offer" && r.job.markup.kind === "pct" && r.job.markup.value === 12 && r.job.platforms.join() === "instagram" && r.job.material.mediaId, "the offer action runs once with the photo, +12% and Instagram only");
    ok(h.sent.some((s) => /On it - Instagram, price \+12%/.test(s.b || "")) && h.last().b === "DONE offer", "the owner is told what is being made, then gets the action's answer");
    ok(!(await h.redis.cmd(["GET", "social:wa:guide:" + OWNER])), "the conversation is cleared once the work starts");
  }

  // ---------------------------------------------------------------- photo -> post as is; a note while the menu is open
  {
    const h = harness();
    await h.go(photo());
    await h.go(note("Goa sunset, our Diwali group"));
    ok(/Added your note/.test(h.sent[h.sent.length - 2].b) && h.last().t === "list", "a note while the menu is open is kept with the photo and the menu shown again");
    await h.go(pick("g:a:photo"));
    await h.go(tap("g:pf:both"));
    ok(h.ran[0] && h.ran[0].name === "photo" && h.ran[0].job.material.text === "Goa sunset, our Diwali group" && !h.ran[0].job.markup, "Post this photo carries the note, asks no price, and goes to both accounts");
  }

  // ---------------------------------------------------------------- photo -> Reel from this photo (own label)
  {
    const h = harness();
    await h.go(photo());
    await h.go(pick("g:a:reel_photo"));
    ok(/Which destination is in this photo/.test(h.last().b), "a Reel from a photo asks the destination (no price, no accounts: Reels go to both)");
    await h.go(note("Our Lonavala trip!"));
    const r = h.ran[0];
    ok(r && r.name === "reel" && r.job.action === "reel_photo" && r.job.place.label === "Our Lonavala trip" && r.job.place.known === false, "the owner's own place name is cleaned and used");
  }

  // ---------------------------------------------------------------- note -> AI Reel: place prefilled, cost confirmed, a bare "yes"
  {
    const h = harness();
    await h.go(note("make a reel for Goa please"));
    ok(h.last().t === "list" && h.last().ids.join() === "g:a:note,g:a:card,g:a:reel_ai,g:cancel", "a note opens its own menu: post from my note / package card / AI Reel / cancel");
    await h.go(pick("g:a:reel_ai"));
    ok(h.last().t === "buttons" && /AI Reel of Goa costs about 11 Higgsfield credits/.test(h.last().b) && h.last().ids.join() === "g:ai:yes,g:cancel", "the destination is read from the note and the paid cost is shown before anything starts");
    await h.go(note("yes"));
    ok(h.decisions.length === 0 && !h.ran.length && /tap Yes, make it/.test(h.last().b), "a typed 'yes' at the cost question neither approves another post nor starts the PAID Reel (it needs the tap)");
    await h.go(tap("g:ai:yes"));
    ok(h.ran[0] && h.ran[0].name === "reel" && h.ran[0].job.place.slug === "goa", "...the tap starts it");
  }
  {
    const h = harness();
    await h.go(note("an AI reel please"));
    await h.go(pick("g:a:reel_ai"));
    ok(/I can film: Agra/.test(h.last().b), "without a place in the note the guide lists the places it can film");
    await h.go(note("Mars"));
    ok(/Reply with one of them/.test(h.last().b) && !h.ran.length, "a place it cannot film is refused (asked again)");
    await h.go(note("kerala"));
    await h.go(tap("g:ai:yes"));
    ok(h.ran[0] && h.ran[0].job.place.label === "Kerala", "...and a filmable one goes on to the cost and the request");
  }

  // ---------------------------------------------------------------- note -> package card; no package
  {
    const h = harness();
    await h.go(note("Royal Rajasthan tour for Diwali"));
    await h.go(pick("g:a:card"));
    ok(h.last().t === "buttons" && /website price/.test(h.last().b) && /Rajasthan/i.test(h.last().b), "a package card names the matched package and its website price before asking the markup");
    await h.go(tap("g:mk:0"));
    await h.go(tap("g:pf:fb"));
    ok(h.ran[0] && h.ran[0].name === "card" && h.ran[0].job.markup.kind === "none" && h.ran[0].job.pkg && h.ran[0].job.platforms.join() === "facebook", "as is + Facebook only reach the card action with the package");
    const h2 = harness();
    await h2.go(note("hello there"));
    await h2.go(pick("g:a:card"));
    ok(/couldn't find a Skyline package/.test(h2.last().b) && !h2.ran.length, "a note that names no package gets a plain answer, no card");
  }

  // ---------------------------------------------------------------- video
  {
    const h = harness();
    await h.go(video());
    ok(h.last().t === "buttons" && h.last().ids.join() === "g:a:video,g:cancel", "a video opens: post as a Reel / cancel (it used to get 'send a photo or a note')");
    await h.go(tap("g:a:video"));
    await h.go(tap("g:pf:both"));
    ok(h.ran[0] && h.ran[0].name === "video" && h.ran[0].job.material.mediaId, "...and the owner's video reaches the video action");
  }

  // ---------------------------------------------------------------- guard rails
  {
    const h = harness();
    await h.go(wa({ type: "audio", audio: { id: "A1" } }));
    ok(/can't listen to voice notes/.test(h.last().b), "a voice note gets a plain answer");
    await h.go(wa({ type: "document", document: { id: "D1", mime_type: "application/pdf" } }));
    ok(/not documents/.test(h.last().b), "a PDF asks for the poster as a photo");
    await h.go(wa({ type: "document", document: { id: "D2", mime_type: "image/jpeg" } }));
    ok(h.last().t === "list", "an image sent as a document is treated as a photo");
    await h.go(tap("g:mk:10"));
    ok(/earlier menu/.test(h.last().b) && !h.ran.length, "a button from an earlier step is refused (stale or re-delivered taps never act)");
    await h.go(note("cancel"));
    ok(/Cancelled/.test(h.last().b) && !(await h.redis.cmd(["GET", "social:wa:guide:" + OWNER])), "typing cancel ends the conversation");
    await h.go(tap("g:pf:both"));
    ok(/menu has expired/.test(h.last().b), "a tap with no open conversation says the menu expired");
    await h.go(note("approve 4821"));
    ok(h.decisions.length === 1 && h.decisions[0].id === "4821", "an approval WITH a code still goes straight to the post");
    await h.go(note("yes"));
    ok(h.decisions.length === 2, "...and a bare 'yes' with no open question is still the old approval");
    const body = photo();
    await h.go(body);
    const before = h.sent.length;
    const out = await h.go(body);
    ok(out.ignored === "duplicate delivery" && h.sent.length === before, "a re-delivered message (same id) is ignored");
    await h.go(pick("g:a:offer"));
    for (const t of ["lots", "more", "?"]) await h.go(note(t));
    ok(/stopped here/.test(h.last().b) && !(await h.redis.cmd(["GET", "social:wa:guide:" + OWNER])), "three unreadable answers end the conversation politely");
    await h.go(photo());
    await h.go(video());
    ok(h.sent.some((s) => /Starting over/.test(s.b || "")) && h.last().ids.includes("g:a:video"), "new material while a menu is open starts over with it");
  }

  // ---------------------------------------------------------------- review regressions (Bug Hunter, QA, App Security 2026-10-26)
  {
    const h = harness();
    await h.go(wa({ type: "video", video: { id: "VCAP", mime_type: "video/mp4", caption: "approve 4821" } }));
    ok(h.decisions.length === 0 && h.last().t === "buttons" && h.last().ids.includes("g:a:video"), "a video captioned 'approve 4821' opens the menu (no decision, no approval-help text)");
    await h.go(note("cancel"));
    await h.go(photo("ok"));
    ok(h.decisions.length === 0 && h.last().t === "list", "a photo captioned 'ok' opens the menu - its caption never approves another post");
    await h.go(note("yes"));
    ok(h.decisions.length === 0 && /Tap one of the options/.test(h.sent[h.sent.length - 2].b) && h.last().t === "list", "a bare 'yes' while the FIRST menu is open goes to the guide, not to a waiting post");
    const oldMenu = h.last().raw;
    await h.go(photo());
    await h.go(pick(oldMenu[1]));
    ok(/earlier menu/.test(h.last().b) && !h.ran.length, "a tap on an older photo's menu never acts on the newer photo (menu token)");
    await h.go(pick(h.sent.filter((s) => s.t === "list").pop().raw[2])); // the NEW photo's menu: Reel from this photo
    for (const w of ["yes", "approve"]) await h.go(note(w));
    ok(!h.ran.length && /destination's name/.test(h.last().b), "'yes' / 'approve' are never taken as a Reel's place name");
    const h2 = harness();
    h2.flags.aiAllowed = false;
    await h2.go(note("Goa reel"));
    await h2.go(pick("g:a:reel_ai"));
    ok(/used up/.test(h2.last().b) && !h2.sent.some((s) => /costs about/.test(s.b || "")), "when today's AI Reels are used up the guide says so BEFORE showing a cost");
    const h3 = harness();
    await h3.go(note("Happy Diwali from Skyline - our office is open till 8"));
    await h3.go(pick("g:a:note"));
    ok(h3.ran[0] && h3.ran[0].name === "note" && h3.ran[0].job.platforms.join() === "facebook" && h3.sent.some((s) => /Instagram needs a photo/.test(s.b || "")), "Post from my note: a text post, Facebook only (Instagram needs an image), no accounts question");
    const h4 = harness();
    await h4.go(note("Goa package"));
    await h4.go(note("Kerala backwaters"));
    await h4.go(pick("g:a:card"));
    ok(/Kerala/i.test(h4.last().b) && !/Goa/.test(h4.last().b), "a second note replaces the first (no glued text matching the wrong package)");
  }

  // ---------------------------------------------------------------- helpers
  ok(filmablePlace("Goa") && filmablePlace("a reel of kerala please").slug === "kerala" && !filmablePlace("goa and kerala") && !filmablePlace("Mars"), "a filmable place is found only when exactly one is named");
  ok(cleanLabel("<b>Lonavala</b>!") === "b Lonavala b" && cleanLabel("1234") === "" && cleanLabel("x".repeat(60)).length === 28, "the owner's label keeps letters/digits/punctuation only, needs a letter, max 28");
  ok(platformsFrom("insta only").join() === "instagram" && platformsFrom("both").length === 2 && platformsFrom("FB").join() === "facebook" && platformsFrom("hmm") === null, "typed accounts are read");

  // ---------------------------------------------------------------- the owner's markup
  {
    const cases = [["+10%", "pct", 10], ["as is", "none", 0], ["+2000", "inr", 2000], ["₹2,000", "inr", 2000], ["Rs 1500", "inr", 1500], ["12.5 %", "pct", 12.5]];
    ok(cases.every(([t, k, v]) => { const m = parseMarkup(t); return m && m.kind === k && m.value === v; }), "markups read: +10%, as is, +2000, ₹2,000, Rs 1500, 12.5 %");
    ok(["150%", "+300000", "abc", "-10%", "", "10", "+10"].every((t) => parseMarkup(t) === null), "out-of-range, unreadable or ambiguous markups are refused (a bare 10 could mean % or Rs - asked again)");
    const own = [["add 10%", "pct", 10], ["10% extra", "pct", 10], ["plus 1500", "inr", 1500], ["1500/-", "inr", 1500], ["as it is", "none", 0], ["Rs 50", "inr", 50]];
    ok(own.every(([t, k, v]) => { const m = parseMarkup(t); return m && m.kind === k && m.value === v; }), "the owner's own wording is read: add 10%, 10% extra, plus 1500, 1500/-, as it is, Rs 50");
    ok(repricedLine([18450], null, parseMarkup("as is")).amount === 18450 && repricedLine([12449], null, parseMarkup("as is")).amount === 12449 && repricedLine([18450], null, parseMarkup("+1500")).amount === 19950 && repricedLine([18450], null, parseMarkup("+7.5%")).amount === 19900 && repricedLine([18450], null).amount === 20300, "as is and a rupee amount are exact; a percentage rounds UP to Rs 100 (never below cost)");
    ok(repricedLine([20000], null).amount === 22000 && repricedLine([20000], null, parseMarkup("as is")).amount === 20000 && repricedLine([20000], null, parseMarkup("+2000")).amount === 22000 && repricedLine([20000], null, parseMarkup("+12%")).amount === 22400, "a vendor price: +10% by default, or the owner's markup");
    ok(repricedLine([], { price: "Rs 30,000" }).amount === 30000 && repricedLine([], { price: "Rs 30,000" }, parseMarkup("+5%")).amount === 31500, "a catalogue price stays as is unless the owner adds a markup");
    ok(markupLabel(parseMarkup("+2000")) === "+Rs 2,000" && markupLabel(null) === "as is", "markups are labelled for the owner");
    const card = await buildResellerCards({ imageGen: null, matchPackage: () => ({ pkg: { item: "Royal Rajasthan", route: "Jaipur", price: "Rs 30,000" }, slug: "royal-rajasthan" }), makeCard: async () => Buffer.from([0xff, 0xd8]), pickPhoto: () => "p.jpg", hostCard: async () => "https://blob.example/a.jpg" },
      { offerText: "Royal Rajasthan", smid: "t", useCatalogPrice: true, markup: parseMarkup("+2000") });
    ok(card.matched && card.rp.amount === 32000, "a package card from a note is priced from the catalogue + the owner's markup");
    const noPrice = await buildResellerCards({ imageGen: null, matchPackage: () => ({ pkg: { item: "X", route: "Y" }, slug: "x" }) }, { offerText: "X", useCatalogPrice: true });
    ok(!noPrice.matched && noPrice.reason === "no_price", "a package without a website price is never priced by guesswork");
  }

  // ---------------------------------------------------------------- the reel queue
  {
    const r = memRedis(), k = (x) => "social:" + x, t0 = new Date("2026-10-26T10:00:00Z");
    ok((await RR.enqueueReel(r, { kind: "ai", place: "goa", label: "Goa", wamid: "w1" }, { k, now: t0 })).ok && (await RR.enqueueReel(r, { kind: "ai", place: "goa", label: "Goa", wamid: "w2" }, { k, now: t0 })).ok, "two AI Reels a day are accepted");
    const third = await RR.enqueueReel(r, { kind: "ai", place: "goa", label: "Goa", wamid: "w3" }, { k, now: t0 });
    ok(!third.ok && third.reason === "ai_cap", "the third paid AI Reel of the day is refused (nothing charged)");
    ok((await RR.enqueueReel(r, { kind: "photo", place: "x", label: "X", wamid: "w4", photoUrl: "https://a.public.blob.vercel-storage.com/p.jpg" }, { k, now: t0 })).ok, "a photo Reel is free and has no daily cap");
    ok(await RR.peekReels(r, { k, now: t0 }), "peek sees waiting requests");
    const a = await RR.takeReel(r, { k, now: t0 });
    ok(a.req && a.req.wamid === "w1" && a.req.tries === 1, "the oldest request is taken first");
    await RR.finishReel(r, a.busyRaw, { k });
    const b = await RR.takeReel(r, { k, now: t0 }); // w2 (a PAID AI Reel) - its run "dies" (never finished)
    ok(JSON.parse(r.lists.get("social:wa:reel_requests:busy")[0]).takenAt === t0.toISOString(), "a taken request is rewritten in place in the busy list (LSET), never out of every list");
    const later = new Date(t0.getTime() + RR.STALE_MS + 60000);
    const c = await RR.takeReel(r, { k, now: later });
    ok(b.req.wamid === "w2" && c.dropped.length === 1 && c.dropped[0].wamid === "w2" && c.req && c.req.wamid === "w4", "a stranded PAID AI Reel is dropped (owner told), never retried - its generation may already be spent");
    const e = await RR.takeReel(r, { k, now: new Date(later.getTime() + RR.STALE_MS + 60000) }); // w4 (photo) died too
    ok(e.req && e.req.wamid === "w4" && e.req.tries === 2, "a stranded free photo Reel is retried once");
    const f = await RR.takeReel(r, { k, now: new Date(later.getTime() + 2 * RR.STALE_MS + 120000) });
    ok(f.dropped.length === 1 && f.dropped[0].wamid === "w4" && !f.req, "...then dropped");
    ok((await RR.aiReelsLeft(r, { k, now: t0 })) === 0 && (await RR.aiReelsLeft(r, { k, now: new Date("2026-10-27T10:00:00Z") })) === 2, "the AI Reels left today are counted per day");
    ok(!(await RR.peekReels(r, { k, now: later })) && r.lists.get("social:wa:reel_requests:busy").length === 0, "an empty queue peeks as nothing to do");
    const q = memRedis();
    for (let i = 0; i < RR.MAX_WAITING; i++) await RR.enqueueReel(q, { kind: "photo", wamid: "p" + i }, { k, now: t0 });
    ok((await RR.enqueueReel(q, { kind: "photo", wamid: "full" }, { k, now: t0 })).reason === "queue_full", "the queue holds at most 10 waiting Reels");
    ok(RR.requestSmid({ wamid: "a" }) === RR.requestSmid({ wamid: "a" }) && RR.requestSmid({ wamid: "a" }) !== RR.requestSmid({ wamid: "b" }), "each request gets its own stable Reel key (a re-run never makes a second Reel)");
  }

  // ---------------------------------------------------------------- the actions
  {
    const store = new InMemoryStore(), redis = memRedis();
    store.cmd = (a) => redis.cmd(a); store.k = (x) => "social:" + x;
    const drafts = [], hosted = [], deleted = [];
    const client = { id: "skyline", facts: {}, profile: {} };
    const acts = guideActions({
      store, client, k: store.k,
      draftAndDigest: async (row, opts) => { drafts.push({ row, opts }); return "DIGEST"; },
      fetchMedia: async (id) => (id === "MOV" ? { buffer: Buffer.from("x"), contentType: "video/quicktime" } : { buffer: Buffer.from("mp4"), contentType: "video/mp4" }),
      resolveBytes: async () => ({ buffer: Buffer.from([0xff, 0xd8]), contentType: "image/jpeg" }),
      hostImage: async ({ keyHint }) => { hosted.push(keyHint); return { url: `https://s.public.blob.vercel-storage.com/${keyHint}.jpg` }; },
      hostVideo: (buf, key) => new Promise((r) => setTimeout(() => r({ url: `https://s.public.blob.vercel-storage.com/${key}.mp4` }), 30)), // a real upload takes time
      deleteHosted: async (u) => { deleted.push(u); },
      generateOne: async (st, row) => { await st.update(row.id, { status: "approved", caption: "A caption" }); return { outcome: "approved" }; },
      digest: (row) => `POST ${row.status}`,
    });
    const job = (over) => ({ from: OWNER, platforms: ["instagram"], markup: { kind: "pct", value: 12 }, material: { kind: "photo", mediaId: "M1", text: "Goa", wamid: "wx" + ++seq }, ...over });
    await acts.offer(job({ action: "offer" }));
    ok(drafts[0].opts.mode === "offer" && drafts[0].opts.markup.value === 12 && drafts[0].row.platforms.join() === "instagram" && drafts[0].row.imageSource.mediaId === "M1", "offer: the row keeps the photo and the accounts; the draft gets mode offer + the markup");
    await acts.card(job({ action: "card", pkg: { item: "Royal Rajasthan" }, material: { kind: "text", text: "Rajasthan", wamid: "wc" } }));
    ok(drafts[1].opts.mode === "card" && !drafts[1].row.imageSource && drafts[1].row.subject === "Royal Rajasthan", "card: no image on the row; the package is the subject");
    const mov = await acts.video(job({ action: "video", material: { kind: "video", mediaId: "MOV", text: "", wamid: "wv1" } }));
    ok(/MP4/.test(mov), "a video that is not MP4 is refused with a plain answer");
    const v = await acts.video(job({ action: "video", material: { kind: "video", mediaId: "V1", text: "Kashmir", wamid: "wv2" } }));
    const vr = await store.findBySourceMessageId("wv2");
    ok(vr && vr.source === "wa-video" && vr.status === "pending_approval" && /\.mp4$/.test(vr.imageUrl) && /Reel is ready to check/.test(v), "the owner's video: hosted, captioned, and HELD for approval even when the drafter auto-approved");
    const slow = guideActions({ store, client, k: store.k, reviewDeadlineMs: Date.now() - 1, fetchMedia: async () => ({ buffer: Buffer.from("x"), contentType: "video/mp4" }), hostVideo: async (b, key) => ({ url: `https://s.public.blob.vercel-storage.com/${key}.mp4` }), deleteHosted: async (u) => { deleted.push(u); }, generateOne: async () => { throw new Error("must not draft"); } });
    const sv = await slow.video(job({ action: "video", material: { kind: "video", mediaId: "V2", text: "", wamid: "wv3" } }));
    ok(/too long/.test(sv) && !(await store.findBySourceMessageId("wv3")), "a video that used up the webhook's time stops BEFORE the upload: no row, nothing hosted, owner told");
    const hung = guideActions({ store, client, k: store.k, reviewDeadlineMs: Date.now() + 25500, fetchMedia: async () => ({ buffer: Buffer.from("x"), contentType: "video/mp4" }), hostVideo: () => new Promise(() => {}), deleteHosted: async () => {}, generateOne: async () => { throw new Error("must not draft"); } });
    const hv = await hung.video(job({ action: "video", material: { kind: "video", mediaId: "V3", text: "", wamid: "wv4" } }));
    ok(/too long/.test(hv) && !(await store.findBySourceMessageId("wv4")), "an upload that hangs is cut off at the deadline: no row, owner told");
    const rp = await acts.reel(job({ action: "reel_photo", place: { slug: "lonavala", label: "Lonavala", known: false } }));
    const queued = JSON.parse(redis.lists.get("social:wa:reel_requests")[0]);
    ok(/queued/.test(rp) && queued.kind === "photo" && /public\.blob\.vercel-storage\.com/.test(queued.photoUrl) && hosted.length === 1, "a photo Reel: the photo is hosted on our Blob store and the request queued");
    await acts.reel(job({ action: "reel_ai", place: { slug: "goa", label: "Goa", known: true } }));
    await acts.reel(job({ action: "reel_ai", place: { slug: "goa", label: "Goa", known: true } }));
    const capped = await acts.reel(job({ action: "reel_ai", place: { slug: "goa", label: "Goa", known: true } }));
    ok(/daily limit/.test(capped), "the third AI Reel of the day gets the daily-limit answer");
  }

  // ---------------------------------------------------------------- the photo clip + the reel-request job
  {
    let args = null;
    const fs = require("fs"), os = require("os");
    const tmpPhoto = path.join(os.tmpdir(), `wa-guide-test-${process.pid}.jpg`), tmpOut = tmpPhoto + ".mp4";
    fs.writeFileSync(tmpPhoto, Buffer.from([0xff, 0xd8]));
    makePhotoClip(tmpPhoto, tmpOut, { run: (bin, a) => { args = a; fs.writeFileSync(tmpOut, "x"); return { status: 0 }; } });
    ok(args && args.join(" ").includes("zoompan") && args.includes("1080x1920") === false && args.join(" ").includes("s=1080x1920"), "the photo clip is a 1080x1920 slow push-in (ffmpeg zoompan)");
    let refused = "";
    try { await downloadPhoto("https://evil.example/p.jpg", os.tmpdir(), { fetchImpl: async () => { throw new Error("fetched!"); } }); } catch (e) { refused = e.message; }
    ok(/our Blob store/.test(refused), "the GitHub run downloads only from our own Blob store");
    fs.rmSync(tmpPhoto, { force: true }); fs.rmSync(tmpOut, { force: true });

    const { runJob } = require(A("run.js"));
    const store = new InMemoryStore(), redis = memRedis();
    store.cmd = (a) => redis.cmd(a); store.k = (x) => "social:" + x;
    const none = await runJob({ job: "reel-request", store });
    ok(none.ok && none.reelRequest.status === "none", "the reel-request job with nothing waiting does nothing");
    await RR.enqueueReel(store, { kind: "ai", place: "mars", label: "Mars", known: true, wamid: "wm" }, { k: store.k, now: new Date() });
    const bad = await runJob({ job: "reel-request", store });
    ok(!bad.ok && /needs a place it can film/.test(bad.reelRequest.error) && redis.lists.get("social:wa:reel_requests:busy").length === 0, "an AI Reel of a place it cannot film fails BEFORE any generation and leaves nothing stranded");
    const noRedis = await runJob({ job: "reel-request", store: new InMemoryStore() });
    ok(!noRedis.ok && /Redis/.test(noRedis.error), "without the Redis queue the job refuses plainly");
  }

  console.log(fails.length ? `\nWA-GUIDE FAIL: ${fails.length}\n  ${fails.join("\n  ")}` : "\nWA-GUIDE PASS: every photo/video/note opens a menu; the guide asks only what the choice needs (price, accounts, place, the AI cost); bare yes never approves the wrong post; Reels queue for GitHub; nothing posts without approve.");
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
