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
  const maxTries = Number.isFinite(ctx.imageQaMaxTries) ? Math.max(1, ctx.imageQaMaxTries) : 2;
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
async function generateQaScene({ nextScene, imageGen, imageGenOpts, cfg }) {
  const { assessImage, qaOn, maxTries, budgetMs, qaClient, minScore } = cfg;
  const start = Date.now();
  const rejected = []; // per-attempt QA notes (owner digest + logs)
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    // Never START a re-roll we can't afford — the first render always runs; later ones only if in budget.
    if (attempt > 1 && Date.now() - start > budgetMs) {
      rejected.push(`time budget reached (${budgetMs}ms) — not re-rolling`);
      try { console.warn(JSON.stringify({ evt: "image_qa_budget_stop", attempt, elapsedMs: Date.now() - start, budgetMs })); } catch { /* ignore */ }
      break;
    }
    const r = await nextScene();
    const gen = await imageGen(r.prompt, imageGenOpts || {});
    if (!qaOn) return { buffer: gen.buffer, contentType: gen.contentType, sceneMeta: r.sceneMeta, qaNote: "", rejected };
    const qa = await assessImage({ buffer: gen.buffer, contentType: gen.contentType || "image/png" }, { client: qaClient, minScore });
    if (qa.pass) {
      const qaNote = rejected.length ? `🖼️ AI-scene QA re-rolled ${rejected.length} weird render(s) before this one.` : "";
      return { buffer: gen.buffer, contentType: gen.contentType, sceneMeta: r.sceneMeta, qaNote, rejected };
    }
    rejected.push(qa.note || `attempt ${attempt} failed QA`);
    try { console.warn(JSON.stringify({ evt: "image_qa_reject", attempt, score: qa.score, defects: qa.defects })); } catch { /* ignore */ }
  }
  const qaNote = `🖼️ AI scene skipped — ${rejected.length} render(s) failed quality QA (${rejected.slice(-1)[0] || "weird/broken"}). Posting the clean decorative card instead.`;
  return { buffer: null, contentType: null, sceneMeta: null, qaNote, rejected };
}

module.exports = { resolveImageQaConfig, generateQaScene };
