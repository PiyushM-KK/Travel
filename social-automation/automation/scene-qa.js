/**
 * scene-qa.js — the SINGLE gate every AI-generated SCENE image passes before it becomes a card.
 *
 * gpt-image-1 routinely emits "weird" renders (warped/melted architecture, extra fingers, garbled
 * signage, impossible geometry). Every card-building intake — calendar-card, package-post, the
 * WhatsApp reseller and the Gmail reseller — generates its card-B scene through the SAME path, so the
 * QA gate must live in ONE place they all call, or a new intake silently ships unchecked AI images.
 *
 *   resolveImageQaConfig(ctx)  — read the QA knobs off a runner ctx ONCE (assessor, on/off, tries,
 *                                time budget, threshold). Same env/ctx contract everywhere.
 *   generateQaScene({...})     — generate a scene, score it with the vision QA reviewer, and RE-ROLL
 *                                a fresh concept on a fail, bounded by a wall-clock budget so it never
 *                                blows a serverless cap. Returns the ACCEPTED bytes, or buffer:null when
 *                                every attempt failed → the caller posts its safe decorative card.
 *
 * Transport-agnostic: the caller supplies `nextScene` (its own resolveScenePrompt closure) and
 * `imageGen`, so all four intakes share ONE QA path. Nothing here hosts or renders — it only decides
 * WHICH scene bytes (if any) are good enough to use.
 */

/** Read the image-QA configuration off a runner ctx (+ env), once. */
function resolveImageQaConfig(ctx = {}) {
  const assessImage = ctx.assessImage || require("../engine/generate").assessAiSceneQuality;
  // ON when not explicitly disabled AND we have SOME way to assess (a real key, or an injected client/fn).
  const qaOn = ctx.imageQa !== false && process.env.SOCIAL_IMAGE_QA !== "off" &&
    !!(process.env.ANTHROPIC_API_KEY || ctx.qaClient || ctx.assessImage);
  // Default 3 = the first render + up to TWO corrective re-rolls (each steered by the prior QA verdict).
  const maxTries = Number.isFinite(ctx.imageQaMaxTries) ? Math.max(1, ctx.imageQaMaxTries) : 3;
  // Each gpt-image-1 render is ~40–60s, so a re-roll needs a SECOND render. Bound it: once this much
  // wall-clock is spent, stop re-rolling so the function returns in time. UNSET = Infinity (local/CLI/tests).
  const budgetMs = Number.isFinite(ctx.imageQaBudgetMs) ? ctx.imageQaBudgetMs
    : (Number(process.env.SOCIAL_IMAGE_QA_BUDGET_MS) || Infinity);
  return { assessImage, qaOn, maxTries, budgetMs, qaClient: ctx.qaClient, minScore: ctx.imageQaMinScore };
}

/**
 * Generate an AI scene that PASSES the vision QA gate, re-rolling weird renders within the time budget.
 *
 * @param nextScene    async () => { prompt, sceneMeta }  — a fresh concept per call (varies each time).
 * @param imageGen     async (prompt, opts) => { buffer, contentType }  — the text→image API.
 * @param imageGenOpts extra opts passed to imageGen.
 * @param cfg          from resolveImageQaConfig().
 * @returns { buffer, contentType, sceneMeta, qaNote, rejected }
 *          buffer is null when every attempt failed QA (the caller falls back to its decorative card).
 *          qaNote is a plain owner-facing line (empty when the first render passed cleanly).
 */
/**
 * Turn a QA reviewer's defect list into a CORRECTIVE directive appended to the NEXT image prompt, so a
 * re-roll actively fixes what was wrong instead of rolling the dice again. Human anatomy (hands/faces) is
 * the #1 AI-render failure, so when it's flagged we steer HARD to a people-free landscape — the single
 * most reliable way to clear the QA bar. Empty defect list → no directive.
 */
function correctiveDirective(defects, note) {
  const list = (Array.isArray(defects) ? defects : []).filter(Boolean).map(String);
  const joined = (list.length ? list.slice(0, 6).join("; ") : String(note || "").trim());
  if (!joined) return "";
  let d = `\n\nCRITICAL REGENERATION NOTE: the previous render was REJECTED by a professional photo-quality ` +
    `check for these specific problems: ${joined}. Produce a DIFFERENT composition that fully AVOIDS every ` +
    `one of them — physically plausible geometry, sharp coherent detail everywhere, no garbled text or ` +
    `signage, natural lighting consistent across the whole frame, and a clear real photographic travel scene ` +
    `(never a blank/empty or plain-gradient frame).`;
  if (/\b(hand|finger|thumb|face|facial|limb|arm|leg|anatomy|anatomical|person|people|figure|skin|body|portrait)\b/i.test(joined)) {
    d += ` Because human anatomy was flagged, show NO people at all: a pure, unpopulated landscape / scenery ` +
      `composition with NO visible hands, faces, or human figures anywhere in the frame.`;
  }
  return d;
}

async function generateQaScene({ nextScene, imageGen, imageGenOpts, cfg }) {
  const { assessImage, qaOn, maxTries, budgetMs, qaClient, minScore } = cfg;
  const { redact } = require("../engine/publish");
  const start = Date.now();
  const rejected = [];   // per-attempt QA notes (owner digest + logs)
  let correction = "";   // QA feedback from the PREVIOUS attempt, fed into the NEXT image prompt
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    // Never START a re-roll we can't afford — the first render always runs; later ones only if in budget.
    if (attempt > 1 && Date.now() - start > budgetMs) {
      rejected.push(`time budget reached (${budgetMs}ms) — not re-rolling`);
      try { console.warn(JSON.stringify({ evt: "image_qa_budget_stop", attempt, elapsedMs: Date.now() - start, budgetMs })); } catch { /* ignore */ }
      break;
    }
    const r = await nextScene();
    // Feed the previous QA verdict into THIS prompt so the re-roll corrects the specific defects.
    const prompt = correction ? String(r.prompt) + correction : r.prompt;
    let gen;
    try {
      gen = await imageGen(prompt, imageGenOpts || {});
    } catch (e) {
      // Image wasn't generated properly (API error/timeout) — record and RETRY within budget rather than
      // sinking the card. If every attempt errors, buffer:null → the caller uses the real photo (no blank).
      rejected.push("image not generated: " + redact(String((e && e.message) || e)));
      try { console.warn(JSON.stringify({ evt: "image_gen_error", attempt, error: redact(String((e && e.message) || e)) })); } catch { /* ignore */ }
      continue;
    }
    if (!qaOn) return { buffer: gen.buffer, contentType: gen.contentType, sceneMeta: r.sceneMeta, qaNote: "", rejected };
    const qa = await assessImage({ buffer: gen.buffer, contentType: gen.contentType || "image/png" }, { client: qaClient, minScore });
    if (qa.pass) {
      const qaNote = rejected.length ? `🖼️ AI-scene QA re-rolled ${rejected.length} weak render(s) — this one passed the quality check.` : "";
      return { buffer: gen.buffer, contentType: gen.contentType, sceneMeta: r.sceneMeta, qaNote, rejected };
    }
    rejected.push(qa.note || `attempt ${attempt} failed QA`);
    correction = correctiveDirective(qa.defects, qa.note); // steer the NEXT attempt away from THESE defects
    try { console.warn(JSON.stringify({ evt: "image_qa_reject", attempt, score: qa.score, defects: qa.defects })); } catch { /* ignore */ }
  }
  const qaNote = `🖼️ AI scene skipped — ${rejected.length} render(s) failed quality QA (${rejected.slice(-1)[0] || "weird/broken"}). Using the real destination photo instead (no blank card).`;
  return { buffer: null, contentType: null, sceneMeta: null, qaNote, rejected };
}

module.exports = { resolveImageQaConfig, generateQaScene, correctiveDirective };
