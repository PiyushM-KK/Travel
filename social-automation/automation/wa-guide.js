/**
 * wa-guide.js — the GUIDED WhatsApp intake (owner 2026-10-26: "make that workflow adaptive and dynamic by
 * requesting information what user want to do"; "always show a menu first").
 *
 * Before this, anything the owner sent was drafted blind: a photo became a photo post (or a +10% reseller
 * card if a price was read), a note became a caption, and a video, a document or a voice note got "send a
 * photo or a note". Now EVERY photo, video or note opens a menu (WhatsApp tap buttons / a list) that fits
 * what was sent, and the guide asks only for what that choice still needs:
 *
 *   photo -> Post this photo | Offer card (the price the owner picks) | Reel from this photo | Cancel
 *   video -> Post as a Reel | Cancel
 *   note  -> Package card (the price the owner picks) | AI Reel of a destination (paid) | Cancel
 *
 *   price     : +10% (the usual) | as is | another amount (+12%, +2000)        (offer card, package card)
 *   accounts  : Instagram + Facebook | Instagram only | Facebook only            (posts; Reels go to both)
 *   place     : the destination (a Reel; an AI Reel only for places it can film)
 *   confirm   : the AI Reel's cost, before anything paid starts
 *
 * The answers live in Redis for 30 minutes (one conversation per sender). Nothing here drafts, prices or
 * posts: the webhook's ACTIONS do (api/whatsapp-webhook.js), and every result still comes back for the
 * owner's "approve". Typing "cancel" ends a conversation at any step.
 */

const { parseMarkup, markupLabel, matchPackage, priceNum, DEFAULT_MARKUP, NO_MARKUP } = require("./packages");
const { SCENES, resolvePinned } = require("./video-scenes");

const TTL_S = 30 * 60;
const MAX_TRIES = 3; // a typed answer the guide cannot read, at most this many times, then it gives up
const MAX_NOTE = 1000;
const guideKey = (from) => "wa:guide:" + String(from || "").replace(/\D/g, "").slice(-15);

// Every choice id starts "g:" so the inbound router can tell a guide tap from anything else.
const ACTIONS = {
  photo: { id: "g:a:photo", title: "Post this photo", description: "Enhanced where safe, with a caption" },
  offer: { id: "g:a:offer", title: "Offer card (poster)", description: "A Skyline card from this poster at your price" },
  reel_photo: { id: "g:a:reel_photo", title: "Reel from this photo", description: "A 10 s moving Reel with music + our branding" },
  video: { id: "g:a:video", title: "Post as a Reel", description: "Your video as an Instagram/Facebook Reel" },
  card: { id: "g:a:card", title: "Package card", description: "A Skyline card for the package your note names" },
  reel_ai: { id: "g:a:reel_ai", title: "AI Reel", description: "A 10 s AI video of a destination (paid)" },
};
const CANCEL = { id: "g:cancel", title: "Cancel", description: "Do nothing with it" };
const MENU = {
  photo: { body: "📸 Got your photo. What would you like to make?", actions: ["photo", "offer", "reel_photo"] },
  video: { body: "🎬 Got your video. What would you like to do?", actions: ["video"] },
  text: { body: "✍️ Got your note. What would you like to make?", actions: ["card", "reel_ai"] },
};
const REELS = new Set(["reel_photo", "reel_ai"]);
const AI_REEL_COST = "about 11 Higgsfield credits (≈ US$0.70)";

/** What the owner sent, as the guide sees it. `link` = an image URL inside a note (the old intake took it). */
function materialOf(msg, link) {
  const text = String(msg.text || "").trim().slice(0, MAX_NOTE);
  const doc = msg.document && msg.document.id ? msg.document : null;
  if (msg.image && msg.image.id) return { kind: "photo", mediaId: msg.image.id, text, wamid: msg.id || "" };
  if (doc && /^image\//i.test(doc.mime || "")) return { kind: "photo", mediaId: doc.id, text, wamid: msg.id || "" };
  if (link) return { kind: "photo", link, text, wamid: msg.id || "" };
  if (msg.video && msg.video.id) return { kind: "video", mediaId: msg.video.id, text, wamid: msg.id || "" };
  if (doc) return { kind: "document", text, wamid: msg.id || "" };
  if (msg.audio) return { kind: "audio", text, wamid: msg.id || "" };
  if (text) return { kind: "text", text, wamid: msg.id || "" };
  return null;
}

/** A destination the AI Reel can film, named in free text ("Goa", "a Kerala reel please"); null unless exactly one. */
function filmablePlace(text) {
  const exact = resolvePinned(String(text || "").trim(), { max: 1 });
  if (exact.length === 1) return exact[0];
  const t = String(text || "").toLowerCase();
  const hits = SCENES.filter((s) => new RegExp(`(^|[^a-z])(${s.label.toLowerCase()}|${s.slug.toLowerCase()})([^a-z]|$)`).test(t));
  return hits.length === 1 ? hits[0] : null;
}

/** The owner's own label for a photo Reel: letters, spaces and a little punctuation, at most 28 characters. */
function cleanLabel(text) {
  const t = String(text || "").replace(/[^\p{L}\p{N} &,.'-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 28).trim();
  return /\p{L}/u.test(t) ? t : "";
}

function platformsFrom(text) {
  const t = String(text || "").toLowerCase();
  const ig = /insta|\big\b/.test(t), fb = /facebook|\bfb\b/.test(t);
  if (/both|all|everywhere/.test(t) || (ig && fb)) return ["instagram", "facebook"];
  if (ig) return ["instagram"];
  if (fb) return ["facebook"];
  return null;
}
const PLATFORM_CHOICE = { "g:pf:both": ["instagram", "facebook"], "g:pf:ig": ["instagram"], "g:pf:fb": ["facebook"] };
const platformLabel = (p) => (p.length === 2 ? "Instagram + Facebook" : p[0] === "instagram" ? "Instagram" : "Facebook");

/**
 * deps = {
 *   kv:      { cmd(args) } - Redis commands (the queue's RedisStore, keys namespaced by deps.k),
 *   k:       (key) => namespaced key (default identity),
 *   send:    { text(to, body), buttons(to, body, [{id,title}]), list(to, body, button, rows) },
 *   actions: { photo, offer, card, video, reel } - each (job) => reply text; job = { from, action, material,
 *            markup, platforms, place, pkg }. They do the work and return what to tell the owner.
 *   now:     () => Date (tests)
 * }
 */
function createGuide(deps) {
  const { kv, send, actions } = deps;
  const k = deps.k || ((x) => x);
  const now = deps.now || (() => new Date());

  async function load(from) {
    const raw = await kv.cmd(["GET", k(guideKey(from))]);
    if (!raw) return null;
    try { const st = JSON.parse(raw); return st && st.v === 1 ? st : null; } catch { return null; }
  }
  const save = (from, st) => kv.cmd(["SET", k(guideKey(from)), JSON.stringify(st), "EX", String(TTL_S)]);
  const clear = (from) => kv.cmd(["DEL", k(guideKey(from))]);
  const say = (to, body) => send.text(to, body).catch(() => {});

  async function showMenu(to, st) {
    const m = MENU[st.material.kind];
    const options = m.actions.map((a) => ACTIONS[a]);
    // up to 3 options fit as tap buttons (one tap); four need a list (WhatsApp's limit)
    if (options.length + 1 <= 3) await send.buttons(to, m.body, [...options, CANCEL].map(({ id, title }) => ({ id, title })));
    else await send.list(to, m.body, "Choose", [...options, CANCEL]);
  }

  /** Ask for whatever the chosen action still needs; run it once nothing is missing. */
  async function next(to, st) {
    const a = st.action;
    if (a === "card" && !st.pkg) {
      const m = matchPackage(st.material.text);
      if (!m) {
        await clear(to);
        await say(to, `🔎 I couldn't find a Skyline package for "${st.material.text.slice(0, 60)}". Send a note that names the package or destination (for example "Kerala backwaters" or "Royal Rajasthan") and choose Package card again.`);
        return { action: "guide", step: "no_package" };
      }
      st.pkg = { item: m.pkg.item, route: m.pkg.route || "", price: priceNum(m.pkg) || null };
    }
    if ((a === "offer" || a === "card") && !st.markup) {
      st.step = "markup";
      await save(to, st);
      const base = a === "card" && st.pkg ? `the website price${st.pkg.price ? ` (From Rs ${Number(st.pkg.price).toLocaleString("en-IN")} / person)` : ""} for ${st.pkg.item}` : "the per-person price on the poster";
      await send.buttons(to, `💰 What price should the card show? It is worked out from ${base}.`, [
        { id: "g:mk:10", title: "+10% (usual)" }, { id: "g:mk:0", title: "As is" }, { id: "g:mk:other", title: "Other amount" }]);
      return { action: "guide", step: "markup" };
    }
    if (REELS.has(a) && !st.place) {
      st.step = "place";
      await save(to, st);
      const body = a === "reel_ai"
        ? `📍 Which destination? I can film: ${SCENES.map((s) => s.label).join(", ")}.`
        : "📍 Which destination is in this photo? (for example Goa or Kashmir) - it is written on the Reel.";
      await say(to, body);
      return { action: "guide", step: "place" };
    }
    if (a === "reel_ai" && !st.confirmed) {
      st.step = "confirm";
      await save(to, st);
      await send.buttons(to, `🎬 An AI Reel of ${st.place.label} costs ${AI_REEL_COST}. It comes back here for your approval before anything posts.`, [
        { id: "g:ai:yes", title: "Yes, make it" }, { id: CANCEL.id, title: CANCEL.title }]);
      return { action: "guide", step: "confirm" };
    }
    if (!REELS.has(a) && !st.platforms) {
      st.step = "platforms";
      await save(to, st);
      await send.buttons(to, "📲 Where should it go?", [
        { id: "g:pf:both", title: "Instagram + Facebook" }, { id: "g:pf:ig", title: "Instagram only" }, { id: "g:pf:fb", title: "Facebook only" }]);
      return { action: "guide", step: "platforms" };
    }
    return run(to, st);
  }

  async function run(to, st) {
    await clear(to); // before the work: a redelivered tap finds no conversation and cannot run it twice
    const job = { from: to, action: st.action, material: st.material, markup: st.markup || null, platforms: st.platforms || ["instagram", "facebook"], place: st.place || null, pkg: st.pkg || null };
    const fn = REELS.has(st.action) ? actions.reel : actions[st.action];
    if (!REELS.has(st.action)) await say(to, `✍️ On it - ${platformLabel(job.platforms)}${st.markup ? `, price ${markupLabel(st.markup)}` : ""}. Back in about 30 seconds for your approval.`);
    let out;
    try { out = await fn(job); }
    catch (e) { out = "Sorry - something went wrong making that. Please send it again in a moment."; }
    if (out) await say(to, out);
    return { action: "guide", step: "done", ran: st.action };
  }

  async function start(to, mat, prefix) {
    if (mat.kind === "audio") { await say(to, "🎙 I can't listen to voice notes yet - please type what you'd like, or send a photo or a video."); return { action: "guide", step: "audio" }; }
    if (mat.kind === "document") { await say(to, "📄 I can read photos and videos, not documents - send the poster as a photo (or a screenshot of it)."); return { action: "guide", step: "document" }; }
    const st = { v: 1, step: "action", material: mat, tries: 0, at: now().toISOString() };
    await save(to, st);
    if (prefix) await say(to, prefix);
    await showMenu(to, st);
    return { action: "guide", step: "action" };
  }

  /** A tap on one of the guide's buttons or list rows (msg.choice.id starts "g:"). */
  async function onChoice(msg) {
    const to = msg.from, id = String(msg.choice.id);
    if (id === CANCEL.id) { await clear(to); await say(to, "👍 Cancelled - nothing was made."); return { action: "guide", step: "cancelled" }; }
    const st = await load(to);
    if (!st) { await say(to, "⌛ That menu has expired. Send the photo, video or note again and I'll ask once more."); return { action: "guide", step: "expired" }; }
    const stale = async () => { await say(to, "That button is from an earlier menu - please use the latest one (or type cancel)."); return { action: "guide", step: "stale" }; };
    if (id.startsWith("g:a:")) {
      const a = id.slice(4);
      if (st.step !== "action" || !MENU[st.material.kind].actions.includes(a)) return stale();
      st.action = a;
      if (a === "reel_ai") { const p = filmablePlace(st.material.text); if (p) st.place = { slug: p.slug, label: p.label, known: true }; }
      return next(to, st);
    }
    if (id.startsWith("g:mk:")) {
      if (st.step !== "markup") return stale();
      if (id === "g:mk:other") {
        st.step = "markup_text";
        await save(to, st);
        await say(to, "Type what to add per person, for example +12% or +2000 (rupees). Or type as is.");
        return { action: "guide", step: "markup_text" };
      }
      st.markup = id === "g:mk:10" ? { ...DEFAULT_MARKUP } : { ...NO_MARKUP };
      return next(to, st);
    }
    if (id.startsWith("g:pf:")) {
      if (st.step !== "platforms" || !PLATFORM_CHOICE[id]) return stale();
      st.platforms = PLATFORM_CHOICE[id];
      return next(to, st);
    }
    if (id === "g:ai:yes") {
      if (st.step !== "confirm") return stale();
      st.confirmed = true;
      return next(to, st);
    }
    return stale();
  }

  /** Anything else the owner sends: an answer to the open question, a note on the material, or new material. */
  async function onMessage(msg, link) {
    const to = msg.from;
    const mat = materialOf(msg, link);
    const text = String(msg.text || "").trim();
    if (/^(cancel|stop|exit|quit)$/i.test(text) && !(mat && mat.kind !== "text")) {
      await clear(to);
      await say(to, "👍 Cancelled - nothing was made.");
      return { action: "guide", step: "cancelled" };
    }
    const st = await load(to);
    if (st && mat && mat.kind === "text") {
      const giveUp = async (why) => {
        st.tries = (st.tries || 0) + 1;
        if (st.tries >= MAX_TRIES) { await clear(to); await say(to, "I couldn't read that, so I've stopped here - nothing was made. Send it again whenever you're ready."); return { action: "guide", step: "gave_up" }; }
        await save(to, st);
        await say(to, why);
        return { action: "guide", step: st.step, retry: st.tries };
      };
      if (st.step === "markup" || st.step === "markup_text") {
        const m = parseMarkup(text);
        if (!m) return giveUp("Reply like +10%, +12%, +2000 (rupees per person) or as is.");
        st.markup = m;
        return next(to, st);
      }
      if (st.step === "platforms") {
        const p = platformsFrom(text);
        if (!p) return giveUp("Tap one of the buttons, or reply Instagram, Facebook or both.");
        st.platforms = p;
        return next(to, st);
      }
      if (st.step === "place") {
        if (st.action === "reel_ai") {
          const p = filmablePlace(text);
          if (!p) return giveUp(`I can make AI Reels of: ${SCENES.map((s) => s.label).join(", ")}. Reply with one of them.`);
          st.place = { slug: p.slug, label: p.label, known: true };
        } else {
          const known = filmablePlace(text), label = cleanLabel(text);
          if (!known && !label) return giveUp("Reply with the destination's name, for example Goa.");
          st.place = known ? { slug: known.slug, label: known.label, known: true } : { slug: label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "place", label, known: false };
        }
        return next(to, st);
      }
      if (st.step === "confirm") {
        if (/^(yes|y|ok|go|make it|haan|ha)$/i.test(text)) { st.confirmed = true; return next(to, st); }
        return giveUp("Tap Yes, make it - or type cancel.");
      }
      if (st.step === "action") {
        // A note while the menu is open is about the same photo/video: keep it with the material and ask again.
        st.material.text = (st.material.text ? st.material.text + "\n" : "") + text;
        st.material.text = st.material.text.slice(0, MAX_NOTE);
        await save(to, st);
        await say(to, "📝 Added your note. Now pick an option 👇");
        await showMenu(to, st);
        return { action: "guide", step: "action", noted: true };
      }
    }
    if (!mat) { await say(to, "Send a photo, a video or a note and I'll ask what you'd like to make - or reply: approve <code> | reject <code>."); return { action: "help" }; }
    return start(to, mat, st ? "🔄 Starting over with what you just sent." : "");
  }

  /** True while the guide waits for a typed or tapped answer (the inbound router asks before a bare "yes"). */
  async function awaitingAnswer(from) {
    const st = await load(from);
    return !!st && st.step !== "action";
  }

  return { onChoice, onMessage, awaitingAnswer, load };
}

module.exports = { createGuide, materialOf, filmablePlace, cleanLabel, platformsFrom, guideKey, TTL_S, AI_REEL_COST };
