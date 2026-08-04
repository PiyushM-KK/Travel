# Skyline destination photos

The card generator uses these to build **Skyline-branded** image posts (logo + repriced
offer over a real destination photo). We NEVER post a vendor's poster — this is our own art.

## How to add photos (naming format)

Drop `.jpg` files into **this folder** (`social-automation/assets/destinations/`) named:

```
<destination-slug>-NN.jpg
```

- **`<destination-slug>`** = one of the slugs below (lowercase, hyphens)
- **`NN`** = a two-digit number, `01`, `02`, `03` … (just increment; any number of photos per destination)

Examples: `himachal-hills-03.jpg`, `kashmir-valley-04.jpg`, `goa-02.jpg`

The generator picks a **random** photo matching the post's destination; if there's no match it
falls back to a **`generic-NN.jpg`**. So always keep a few `generic-*` scenic India shots.

## Destination slugs (match Skyline's packages)

| slug | package / area |
|---|---|
| `himachal-hills` | Himachal Hills — Shimla · Manali · Dharamshala |
| `kashmir-valley` | Kashmir Valley — Srinagar · Gulmarg · Pahalgam · Sonamarg |
| `kausani-kumaon` | Kausani & Kumaon — Almora · Baijnath · Bageshwar |
| `royal-rajasthan` | Royal Rajasthan — Jaipur · Udaipur · Jodhpur |
| `kerala-backwaters` | Kerala Backwaters — Alleppey · Munnar |
| `meghalaya-wonders` | Meghalaya Wonders — Cherrapunji · living root bridges |
| `sikkim` | Sikkim — Gangtok · Kanchenjunga |
| `goa` | Goa — beaches |
| `generic` | fallback: any scenic India/Himalaya shot |

(Add a new slug here if Skyline adds a package — then upload `<new-slug>-01.jpg`.)

## Photo requirements
- **Landscape** orientation preferred, **≥ 1200 px** wide, `.jpg`
- **Your own** photos are best. Otherwise use **licensed / Creative-Commons** images and add a
  line to `CREDITS.md` (title · author · license · source URL). The seed photos here are CC from
  Wikimedia Commons — replace them with better/owned ones when you can.
- No text/watermark/other-brand logos on the photo (the card adds Skyline's branding).

## Where this lives
GitHub: `PiyushM-KK/Travel` → `social-automation/assets/destinations/`
You can upload via the GitHub web UI (Add file → Upload files) **or** drop files in the local
folder and they'll sync on the next commit.
