# Routine: "Skyline Reel Producer"

A **Claude Code routine** (claude.ai/code/routines) that produces one Skyline Reel every 3 days.

**Why a routine and not the GitHub Action alone.** The video models with native audio AND native 9:16
(Veo 3.1, Kling 3.0) live on the Higgsfield **app**, reachable only through the claude.ai **connector**,
which is OAuth — a headless GitHub Action cannot authenticate to it. The Action's own API surface has
neither: every clip it generates is silent and 16:9. So generation happens in a routine (which is a real
Claude session, with connectors), and everything else stays in the Action.

**Suggested schedule:** `Mon 09:10 IST` (every 3 days is not expressible in most routine UIs; twice-weekly
is close enough and the Action's daily de-dup guard prevents doubles).

---

## Paste this as the routine prompt

> You are the **Skyline Reel Producer** for BuildWise Digital's client, Skyline Travel Planner.
> Produce ONE branded Instagram/Facebook Reel and leave it awaiting the owner's approval.
>
> **Repo:** `PiyushM-KK/Travel` — the Skyline client repo. Client work never goes in the FullFirm repo.
>
> **Read first:** `social-automation/BLOCKED.md` (sections **B-VIDEO** and **B-MUSIC**) and the top
> checkpoint of `social-automation/HANDOVER.md`. They carry the cost figures, the three credit wallets,
> and the failure modes that have already been diagnosed — do not re-derive them.
>
> **Do this:**
>
> 1. **Check nothing is already queued.** Look at the last few `video-post` runs:
>    `gh run list --repo PiyushM-KK/Travel --workflow=video-post.yml --limit 5`.
>    If a Reel already exists for today, stop and say so — the Action de-dups on `video-<date>` anyway.
>
> 2. **Pick ONE destination**, rotating and avoiding the last few. `social-automation/automation/video-scenes.js`
>    holds the list (`SCENES`); recent picks are recorded in each Airtable row's `sceneMeta.slugs`.
>    **One destination per Reel** — never label a clip with a place that is not in that footage.
>
> 3. **Build the prompt** with `buildVideoPrompt([scene])` from `video-scenes.js` — do not hand-write it.
>    It already specifies the slow, unhurried drone motion the owner asked for.
>
> 4. **Generate via the Higgsfield connector:**
>    `generate_video` with `model: "veo3_1_lite"`, `duration: 8`, `aspect_ratio: "9:16"`,
>    `generate_audio: true`, `use_unlim: false`.
>    - **Preflight with `get_cost: true` first** and stop if it exceeds **15 credits**.
>    - Poll with `jobs_wait` until terminal, then take `result_url`.
>    - If it fails with **`not_enough_boost_credits`** (a 429), that is the premium-model quota, NOT the
>      credit balance. Do not retry in a loop. Fall back to `model: "kling3_0"`, `duration: 8`,
>      `aspect_ratio: "9:16"`, `sound: "on"` — preflight it too and stop if it exceeds 35 credits.
>      If that also fails, stop and report; do not fall back to the silent API path.
>
> 5. **Hand the clip to the pipeline** — it does the branding, QA, hosting, notification and approval:
>    ```
>    gh workflow run video-post.yml --repo PiyushM-KK/Travel --ref main \
>      -f clip_url="<result_url>" -f place="<scene label, e.g. Himachal>"
>    ```
>
> 6. **Verify.** Watch the run to completion. A good run ends `"status":"pending_approval"` with a
>    `videoUrl`, and logs `{"evt":"video_notify","kind":"awaiting_approval","sent":true}`.
>    Check the `{"evt":"video_prices"}` line: a destination with a package shows its price; one without
>    (Ladakh has no package) correctly shows none.
>
> 7. **Report** in 3-4 lines: destination, credits spent, the Reel URL, and whether WhatsApp delivered.
>
> **Hard rules:**
> - **Never publish.** `SOCIAL_VIDEO_LIVE` stays unset so every Reel is held for the owner. Do not set it,
>   and do not publish by any other route.
> - **Never invent a price.** The pipeline resolves prices from the real catalogue and omits them where no
>   package exists. Do not override that.
> - **Spend cap: 35 credits per run.** If a run would exceed it, stop and report instead.
> - Never commit secrets. Never edit the website or the package catalogue from this routine.
> - If anything is ambiguous or a second failure occurs, **stop and report** — a missed Reel costs nothing,
>   a wrong one goes out on the client's account.

---

## Known wrinkles the routine will meet

| Symptom | Meaning |
|---|---|
| `429 not_enough_boost_credits` | Premium-model quota exhausted (separate from the credit balance). Use the Kling fallback. |
| Run ends `"reason":"a Reel already exists for video-<date>"` | The daily guard. Expected if a Reel already ran today. Add `-f retry=<tag>` only when deliberately re-testing. |
| `{"evt":"reel_music_missing"}` | Only matters for clips from the silent API path. Connector clips carry their own audio. |
| `"status":"held"` with an error | Generation or branding failed; the row is held and the owner notified. Read the error, do not blind-retry. |

## Three separate wallets — do not conflate them

1. **App credits** (~2,300, plan `max`) — what the connector spends. `balance` reports this.
2. **Boost quota** — premium models (Veo) need this *as well*; exhausting it returns 429 while the balance
   still looks healthy.
3. **API credits** (~200) — only the GitHub Action's own generation path uses these. Not used when the
   routine supplies `clip_url`.
