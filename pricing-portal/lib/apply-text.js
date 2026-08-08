/**
 * apply-text.js — a safe, targeted text fix for "the site says X, it should say Y" reports.
 *
 * The owner (or their customer) reports an error — a typo, wrong wording, a stale fact, a bad line in the
 * on-site chatbot's greeting. The agent locates the exact text and proposes an EXACT find→replace, shown
 * as a diff and approved before commit. Guards keep it bounded: `find` must be present, and unique unless
 * `all` is set; and validateSiteFile refuses any change that would break a page's script (syntax check).
 */

// Exact substring replace. Returns {ok, src, count} or {ok:false, error}.
function replaceTextInSource(src, { find, replace, all = false } = {}) {
  if (find == null || find === "") return { ok: false, error: "the exact text to fix ('find') is required" };
  if (replace == null) return { ok: false, error: "the replacement text is required (use \"\" to delete)" };
  if (find === replace) return { ok: false, error: "find and replace are identical — nothing to change" };
  const count = src.split(find).length - 1;
  if (count === 0) return { ok: false, error: `couldn't find that exact text on the page. Looked for: ${JSON.stringify(find.slice(0, 100))}` };
  if (count > 1 && !all) return { ok: false, error: `that text appears ${count} times — include more surrounding words to pinpoint it, or set all:true to fix every occurrence` };
  const out = all ? src.split(find).join(replace) : src.replace(find, replace);
  return { ok: true, src: out, count: all ? count : 1 };
}

// Every inline <script> (no src=) must still PARSE as JS after the edit — catches a replacement that
// accidentally breaks a widget/quote. new Function only parses (doesn't run), so undefined refs are fine.
function validateSiteFile(file, src) {
  const re = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m, n = 0;
  while ((m = re.exec(src))) {
    n++;
    let js = m[1];
    // The Duda widget scripts extend a framework global; stub it so parsing doesn't need it.
    js = js.replace(/class\s+Component\s+extends\s+DCLogic/, "class DCLogic{}\nclass Component extends DCLogic");
    try { new Function(js); } catch (e) { return `script block #${n} would have a syntax error: ${e.message}`; }
  }
  return null; // ok
}

module.exports = { replaceTextInSource, validateSiteFile };
