# Verify

    node scripts/doctor.mjs                     # always first
    node scripts/serve.mjs builds/<name> --port 4477
    node scripts/verify.mjs http://localhost:4477/

Run `doctor` before anything else. It is not ceremony: the three most common
setup faults all surface later as errors that point at the wrong thing.

## What the harness actually does

It opens the page in headless Chrome at a real desktop viewport, then walks it
in fixed steps from top to bottom. At each step it waits for the page to settle
— which includes waiting for any scrubbed video's playhead to actually land,
because a seek that has been requested but not completed will screenshot as the
previous frame and quietly poison every measurement after it.

Then, at each step, four checks.

### 1. Dead scroll

It hashes the composited screenshot at every step and compares consecutive
hashes. A run of identical frames means a stretch of scroll where nothing on
screen changed — the reader is turning the wheel and being given nothing. It
reports the scroll range and its length as a percentage of the page.

Some dead scroll is deliberate: a held frame before the peak is the `rest`
device. The harness cannot tell those apart, so it reports and you judge. A run
longer than about 12% of the page is almost never deliberate.

### 2. Cues that never arrive

It tracks the computed opacity of every text-bearing element across the whole
walk and records each one's maximum. Anything whose maximum never reaches 0.98
is copy the reader can only ever see faded. This is a failure, not a warning —
see the cue contract in `devices.md`.

### 3. Contrast, measured on the composited page

Not on the CSS colours. On the actual pixels.

For each line of text it samples the rendered pixels behind that line's box, at
the **brightest frame that ever passes under it** during the walk — because a
line that is legible over the dark part of a photograph and illegible three
scroll steps later, when the bright part has travelled under it, is illegible.

The direction is picked **per line**: light-on-dark and dark-on-light are graded
against their own thresholds, so a page that hard-cuts between grounds is graded
correctly on both sides rather than failing half its copy by construction.

Thresholds: 4.5:1 for body text, 3:1 for text at 24px+ or 19px+ bold.

### 4. Posters that never became film

A `<video data-sc-scrub>` whose `readyState` never reaches 3, or whose
`currentTime` never moves despite the scroll position changing, is a clip that
silently failed to decode. On screen this looks exactly like a paused film,
which is why it survives review so often. It is reported as a hard failure.

## The contact sheet

The harness writes `verify-out/contact-sheet.html` — every sampled frame in
order, at size, with its scroll position and any findings against it.

Open it. A machine can prove that a page works. It cannot tell you that the page
means anything, that the peak lands, or that the third act is filler. That is
still your job, and the contact sheet is the cheapest way to do it, because
seeing forty frames in a row makes a page's rhythm — or its absence — obvious in
a way that scrolling never does.

## What the harness cannot check

- whether the feeling curve is real
- whether the peak is a peak
- whether the signature move is bespoke or a recoloured stock device
- whether the copy is any good
- whether the page looks like the last four pages you built

The last one is what the fingerprint gate is for. The rest is why you look.
