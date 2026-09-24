# NZ paint colour library

A CSV of New Zealand house-paint colours — Resene, Dulux, Wattyl/Taubmans,
Porter's and Aalto — with an estimated CIELAB value for each, built so a Nix
Pro 2 reading off a wall can be matched against it.

**Read this before trusting a match.** No maker publishes a measured Lab value,
a spectrum, or the light its numbers assume. Every Lab here is *worked out* from
the RGB and LRV the maker puts on its website. The same maker's whites often sit
closer to each other than that estimate can tell apart. A match gives you a
**shortlist to take to the counter**, never an identification.

## What gets built

`python3 build.py` writes three files into `out/`:

| File | What it is |
|---|---|
| `nz-paint-library.csv` | Every colour, every column (below). The master copy. |
| `nix-import-gaps.csv` | Only the colours Nix does **not** already ship a library for. This is the one to load into Nix. |
| `nix-import-all.csv` | Every colour with a usable Lab, in the same slim layout. |

The two `nix-import-*` files have six columns: `Name, L, a, b, Hex, Comment`.
L, a and b are **D50 / 2°**, which is the Nix Toolkit's default setting.
Rows with no Lab, or whose Lab is rated `poor`, are left out.

### Columns in `nz-paint-library.csv`

| Column | Meaning |
|---|---|
| `id` | A stable key, `brand/maker-id`. It stays the same when you rebuild, so a Snag record or a future match can point at it. |
| `brand`, `name`, `code` | As the maker writes them. For Resene, `code` is the Total Colour Code (`Y91-020-082`); for Dulux, the atlas code (`NZ9H3`); for Wattyl/Taubmans, the Colour Designer code (`CW 102.3`). Porter's and Aalto publish no code. |
| `collection` | The range or chart. For an archived Resene colour, this is the last few charts it appeared in. |
| `status` | `current`, or `archived` when the maker no longer lists it in a current range. |
| `aliases` | Other names for the same colour. Resene says so itself. For Dulux it is inferred: two colours whose RGB, LRV and solar absorptance all match exactly (for example Mt Aspiring Half and Snowy Mountains Half). |
| `hex_published`, `r`, `g`, `b` | The maker's own on-screen colour, exactly as published. |
| `lrv` | The maker's light reflectance value, which is the Y in XYZ. |
| `lab_d50_*`, `lab_d65_*` | The estimated CIELAB value under D50/2° (Nix's default) and D65/2°. There is no 10° observer column, because converting between observers needs a spectrum and no maker publishes one. |
| `lab_basis` | How the Lab was worked out from the maker's RGB. See *How good the numbers are* below. |
| `lrv_check` | The estimated L\* minus the L\* implied by the maker's own LRV. Near 0 means the maker's two published figures agree. |
| `lab_quality` | `good` (within ±1 L\*), `approx` (within ±3, or the RGB is clipped at the edge of the screen range), `poor` (the maker's RGB and LRV contradict each other), or `none` (a stain, metallic or texture, or the maker published no colour). |
| `in_nix_already` | `yes` means Nix already ships a library with this colour, so match against Nix's own. `check` means Nix has a library of that name, but it isn't clear it's the same edition. `no` means it isn't in Nix. |
| `source_url`, `retrieved` | Where the data came from, and on which day. |

## Using it with a Nix Pro 2

1. **Set the Toolkit to D50 / 2°.** If you use D65, work from the `lab_d65_*`
   columns instead.
2. **Match against Nix's own libraries first.** Nix already ships the current
   Resene, Porter's and Wattyl ranges, plus Dulux's *World of Colour Series II
   Atlas*. A match against Nix's own library beats anything in this file.
3. **For everything else, make a custom library in the Toolkit**: *Manage and
   browse libraries → Create & manage custom libraries → new library.* Then
   either:
   - **Import** `nix-import-gaps.csv`, if your version of the app offers
     *Import from file*. Nix doesn't publish its import layout. If the file is
     refused, make a custom library with one scan in it, export it to CSV, and
     rearrange these columns to match that header.
   - **Add colours by hand** with *Manually add color*, typing each colour's
     name and its L, a, b values. This works in every version, and it's
     practical for 10–30 candidates. For example, filter `nz-paint-library.csv`
     to the maker and range you think the house was painted in.
4. **Scan properly.** Clean the spot first. Pick a flat face: the flat side of
   an architrave, not its curved moulding. Stay away from sun-faded walls; the
   inside of a cupboard or behind a switch plate shows the original colour.
   Take three readings and average them.
5. **Read the ΔE honestly.**
   - **Below about 1:** worth taking to the counter.
   - **1–2:** possible.
   - **Above 2:** probably not in the library. It may be a custom tint, faded
     paint, or a maker not listed here.
6. **Confirm at the maker's shop** with the shortlist and a physical chip. The
   counter's spectrophotometer and tint system settle it; this file doesn't.

### Without importing anything

```bash
python3 build.py match 93.2 -0.1 4.4          # a D50/2° reading
python3 build.py match 93.2 -0.1 4.4 --d65    # a D65/2° reading
```

This prints the ten nearest colours by ΔE2000, leaving out `poor` rows
(`--all` includes them).

### Recording the answer in Snag

A paint record takes the brand as its **Brand**, `code` as its **Colour
code**, and `name` as its colour. `hex_published` is the maker's own published
swatch value, which is what Snag's swatch rule asks for. Note that for Dulux,
Porter's and older Resene data it's darker on screen than the paint really is
(below).

## How good the numbers are

Each maker's published RGB was tested against its own LRV across its whole
range. Where the two disagreed consistently, a single display curve was fitted
and undone (a power on linear RGB).

| Maker | Source | L\* vs LRV, as published | After correction |
|---|---|---|---|
| Resene | 2022 CAD colour book (Resene derives it from its master Lab) | +0.06 ± 1.44 | used as published |
| Resene, archived colours missing from that book | 2016 "visual" RGB | −7.10 ± 4.19 | ^0.77 → −0.01 ± 2.08 |
| Dulux | Colour Atlas | −3.31 ± 1.87 | ^0.87 → +0.09 ± 0.67 |
| Porter's (DuluxGroup) | all-colours page | −3.65 ± 2.49 | ^0.87 → −0.03 ± 1.79 |
| Wattyl / Taubmans | colour pages | fitted at build time; the build prints it | |
| Aalto | colour pages | fitted at build time; the build prints it | |

Lightness is checked this way. **Hue and chroma can't be checked**, because
nothing else published says what they should be. And even where every figure
agrees, 8-bit RGB can't separate the closest whites: several Resene and Dulux
colours come out *identical*.

## Terms of use

Dulux, Porter's and Wattyl license their websites for **personal,
non-commercial use** and forbid copying, redistributing or publishing what is on
them. Resene supplies its swatches for specifying and recommending Resene
colours. So:

- A library built for your own Nix app to identify the paint on your own house
  is fine.
- Publishing the CSV, sharing it through Nix's paid shared-library dashboard, or
  shipping it inside Snag is **not** fine without each maker's written
  permission.

That's why the builder is committed and its output isn't (`out/` and `.cache/`
are gitignored).

## Rebuilding

```bash
pip install xlrd
python3 tools/paint-library/build.py
```

The first run takes about half an hour. Wattyl and Aalto publish one page per
colour, and they're fetched three at a time with a pause between each, which is
under one request a second. Everything is cached in `.cache/`, so later runs
take seconds. Delete `.cache/` to pick up a maker's changes.

The display-curve exponents in `TONE` were measured in September 2026. If a
maker changes how it renders colours online, the `lrv_check` column will drift
away from zero. That's the signal to re-fit them with `fit_tone()`.

## Known gaps

- **Stains, metallics and textures** (Resene Woodsman and Colorwood, Resene
  metallics, Porter's speciality finishes) are listed with no Lab. A sensor
  doesn't read them as a flat colour.
- **Older Dulux colours are missing.** Dulux publishes its current range only,
  and there's no archive to draw on. Resene and Aalto both publish theirs.
- **Wattyl/Taubmans in Nix.** Nix's Wattyl libraries carry Australian range
  names. Whether they cover New Zealand's *Colour Designer* range is marked
  `check`; see whether a colour like *Teal* (CW 102.3) matches in the app.
