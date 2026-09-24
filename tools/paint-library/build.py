#!/usr/bin/env python3
"""
Builds a colour library of New Zealand house paints from what each maker
publishes, for matching a Nix reading against.

    pip install xlrd
    python3 tools/paint-library/build.py                 # fetch (cached) and write out/
    python3 tools/paint-library/build.py match 93.2 -0.1 4.4   # nearest colours to a D50/2° reading

Why this is a script and not a file in the repo: Dulux, Porter's and Wattyl
license their sites for personal, non-commercial use and forbid reproducing or
redistributing what is on them. Committing the output — or shipping it inside
Snag — would be exactly that. The script is how the library is made; the CSV it
writes is for the person who ran it. `out/` and `.cache/` are gitignored.

What every row is, and is not: an ESTIMATE of the paint's CIELAB colour, worked
out from the RGB and LRV the maker publishes. No maker in this file publishes a
measured Lab value, a spectrum, or the illuminant behind its numbers, so each row
carries how its Lab was arrived at (`lab_basis`) and how far that estimate agrees
with the maker's own LRV (`lrv_check`, `lab_quality`). A match against this file
is a shortlist to take to the counter, never an identification. See README.md.
"""

import csv
import html
import json
import math
import os
import re
import struct
import subprocess
import sys
import threading
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '.cache')
OUT = os.path.join(HERE, 'out')
UA = 'Mozilla/5.0 (snag paint-library builder; personal use)'
TODAY = date.today().isoformat()

# ---------------------------------------------------------------------------
# Colour arithmetic. sRGB (IEC 61966-2-1) -> XYZ D65 -> Bradford -> XYZ D50.
# D50/2° is the Nix Toolkit's default and the condition Nix quotes its accuracy
# at, so it is the primary Lab here; D65/2° rides beside it for anyone who has
# switched the app over. A 10° observer is deliberately absent: converting
# between observers needs a spectrum, and nobody publishes one.
# ---------------------------------------------------------------------------

D65 = (0.95047, 1.0, 1.08883)
D50 = (0.96422, 1.0, 0.82521)


def srgb_to_linear(c8):
    c = c8 / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_to_xyz(r, g, b):
    return (0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
            0.2126729 * r + 0.7151522 * g + 0.0721750 * b,
            0.0193339 * r + 0.1191920 * g + 0.9503041 * b)


def bradford_d65_to_d50(x, y, z):
    return (1.0478112 * x + 0.0228866 * y - 0.0501270 * z,
            0.0295424 * x + 0.9904844 * y - 0.0170491 * z,
            -0.0092345 * x + 0.0150436 * y + 0.7521316 * z)


def xyz_to_lab(x, y, z, white):
    def f(t):
        return t ** (1 / 3) if t > 216 / 24389 else (24389 / 27 * t + 16) / 116
    fx, fy, fz = f(x / white[0]), f(y / white[1]), f(z / white[2])
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def lab_from_rgb(rgb, tone=1.0, lrv=None):
    """Lab (D50, D65) from a maker's 8-bit RGB.

    `tone` undoes a display curve the maker applied before publishing: the
    published linear value is raised to it. 1.0 means the RGB is taken as it
    stands. See TONE below for where each value comes from.

    `lrv`, when given, anchors the luminance to it: the colour keeps the RGB's
    chromaticity and takes its lightness from the LRV, which is a measurement
    rather than a rendering. For a maker whose RGB and LRV disagree without any
    one curve explaining it.
    """
    lin = [srgb_to_linear(c) ** tone for c in rgb]
    xyz65 = linear_to_xyz(*lin)
    if lrv and xyz65[1] > 0:
        scale = (lrv / 100) / xyz65[1]
        xyz65 = tuple(v * scale for v in xyz65)
    return xyz_to_lab(*bradford_d65_to_d50(*xyz65), D50), xyz_to_lab(*xyz65, D65)


def l_star_from_lrv(lrv):
    """LRV is the tristimulus Y on a 0-100 scale, so it fixes L* on its own."""
    y = lrv / 100
    return 116 * y ** (1 / 3) - 16 if y > 216 / 24389 else y * 24389 / 27


def delta_e_2000(lab1, lab2):
    L1, a1, b1 = lab1
    L2, a2, b2 = lab2
    c_bar = (math.hypot(a1, b1) + math.hypot(a2, b2)) / 2
    g = 0.5 * (1 - math.sqrt(c_bar ** 7 / (c_bar ** 7 + 25 ** 7)))
    a1p, a2p = (1 + g) * a1, (1 + g) * a2
    c1p, c2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1 = math.degrees(math.atan2(b1, a1p)) % 360
    h2 = math.degrees(math.atan2(b2, a2p)) % 360
    dl, dc = L2 - L1, c2p - c1p
    if c1p * c2p == 0:
        dh = 0
    elif abs(h2 - h1) <= 180:
        dh = h2 - h1
    else:
        dh = h2 - h1 - 360 if h2 > h1 else h2 - h1 + 360
    dH = 2 * math.sqrt(c1p * c2p) * math.sin(math.radians(dh / 2))
    l_bar, cp_bar = (L1 + L2) / 2, (c1p + c2p) / 2
    if c1p * c2p == 0:
        h_bar = h1 + h2
    elif abs(h1 - h2) <= 180:
        h_bar = (h1 + h2) / 2
    else:
        h_bar = (h1 + h2 + 360) / 2 if h1 + h2 < 360 else (h1 + h2 - 360) / 2
    t = (1 - 0.17 * math.cos(math.radians(h_bar - 30)) + 0.24 * math.cos(math.radians(2 * h_bar))
         + 0.32 * math.cos(math.radians(3 * h_bar + 6)) - 0.20 * math.cos(math.radians(4 * h_bar - 63)))
    d_theta = 30 * math.exp(-(((h_bar - 275) / 25) ** 2))
    rc = 2 * math.sqrt(cp_bar ** 7 / (cp_bar ** 7 + 25 ** 7))
    sl = 1 + 0.015 * (l_bar - 50) ** 2 / math.sqrt(20 + (l_bar - 50) ** 2)
    sc, sh = 1 + 0.045 * cp_bar, 1 + 0.015 * cp_bar * t
    rt = -math.sin(math.radians(2 * d_theta)) * rc
    return math.sqrt((dl / sl) ** 2 + (dc / sc) ** 2 + (dH / sh) ** 2 + rt * (dc / sc) * (dH / sh))


# Each maker's published RGB was tested against its own LRV across the whole
# range, and a single exponent on linear RGB fitted where the two disagreed.
# These are measured properties of the published data (September 2026), not
# assumptions — re-fit them if a maker changes how it renders its colours.
#
#   Resene CAD/ASE 2022   1.00   L* vs LRV   +0.06 ± 1.44  (derived by Resene from master Lab)
#   Resene "visual" RGB   0.77   −7.10 ± 4.19 raw → −0.01 ± 2.08 corrected
#   Dulux atlas           0.87   −3.31 ± 1.87 raw → +0.09 ± 0.67 corrected
#   Porter's (DuluxGroup) 0.87   −3.65 ± 2.49 raw → −0.03 ± 1.79 corrected
#
# Wattyl and Aalto are not in the table because no one curve fits either: part
# of each range is published on its LRV and part is published lighter by a
# varying amount. Those take their lightness from the LRV (`anchor_to_lrv`).
# fit_tone() is how the exponents above were found, kept for re-fitting.
TONE = {'resene_cad': 1.0, 'resene_visual': 0.77, 'dulux': 0.87, 'porters': 0.87}


def fit_tone(samples):
    """The exponent that best reconciles a set of (rgb, lrv) with each other."""
    best = None
    for k in [x / 100 for x in range(60, 131)]:
        d = [lab_from_rgb(rgb, k)[1][0] - l_star_from_lrv(lrv) for rgb, lrv in samples]
        mean = sum(d) / len(d)
        sd = math.sqrt(sum((x - mean) ** 2 for x in d) / len(d))
        score = abs(mean) + sd
        if best is None or score < best[0]:
            best = (score, k, mean, sd)
    return best[1], best[2], best[3]


# ---------------------------------------------------------------------------
# Fetching. Everything is cached, so a rebuild costs nothing until the cache is
# cleared. Where a maker needs one page per colour it is fetched three at a
# time with a pause — under one request a second — because this is somebody's
# shop front and not an API.
# ---------------------------------------------------------------------------

def fetch(url, cache_name, binary=False):
    path = os.path.join(CACHE, cache_name)
    if os.path.exists(path) and os.path.getsize(path) > 0:
        with open(path, 'rb') as fh:
            data = fh.read()
    else:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        data = subprocess.run(['curl', '-sS', '-L', '--max-time', '60', '-A', UA, url],
                              capture_output=True, check=True).stdout
        with open(path, 'wb') as fh:
            fh.write(data)
    return data if binary else data.decode('utf-8', errors='replace')


def page_text(markup):
    markup = re.sub(r'<script.*?</script>|<style.*?</style>', '', markup, flags=re.S)
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', markup)))


def fetch_many(keys, fetch_one, cache_name, complete):
    """Resumable per-colour fetching into one JSON file keyed by `keys`.

    A page that came back without its colour data is fetched again on the next
    run rather than remembered as a failure for ever.
    """
    path = os.path.join(CACHE, cache_name)
    done = json.load(open(path)) if os.path.exists(path) else {}
    lock = threading.Lock()
    todo = [k for k in keys if k not in done or not complete(done[k])]
    if todo:
        print(f'  {cache_name}: {len(todo)} pages to fetch', flush=True)

    def work(key):
        rec = fetch_one(key)
        with lock:
            done[key] = rec
            if len(done) % 50 == 0:
                json.dump(done, open(path, 'w'))
                print(f'    {len(done)}/{len(keys)}', flush=True)
        time.sleep(0.5)

    with ThreadPoolExecutor(3) as pool:
        list(pool.map(work, todo))
    os.makedirs(CACHE, exist_ok=True)
    json.dump(done, open(path, 'w'))
    return done


def js_unescape(s):
    """Strings lifted out of a page's embedded JSON keep their \\uXXXX escapes."""
    return html.unescape(re.sub(r'\\u([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), s))


def slugify(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower().replace('®', '').replace('&', 'and')).strip('-')


# ---------------------------------------------------------------------------
# Resene
# ---------------------------------------------------------------------------

RESENE_LISTS = 'https://www.resene.co.nz/swatches/'
RESENE_CAD = ('https://www.resene.co.nz/download_files/autocad_colour_books/'
              'Resene%20Total%20Colour%20System%20-%202022.acb')
# The ranges on sale now, as Resene's own swatch-file page lists them. Anything
# in the master list that is in none of these is archived.
RESENE_CURRENT = {
    'BS5252 range (2008)': 'Resene%20BS5252%20range%20%282008%29.ase',
    'Classics Collection (2021)': 'Resene%20Classics%20Collection%20%282021%29.ase',
    'Colorwood interior wood stains (2011)': 'Resene%20Colorwood%20interior%20wood%20stains%20range%20%282011%29.ase',
    'Decks, paths, driveways (2014)': 'Resene%20Decks_driveways%20range%20%282014%29.ase',
    'Heritage (2015)': 'Resene%20Heritage%20range%20%282015%29.ase',
    'Karen Walker range 5': 'Resene%20Karen%20Walker%20range%205.ase',
    'KidzColour (2015)': 'Resene%20KidzColour%20range%20%282015%29.ase',
    'Metallics and special effects (2019)': 'Resene%20Metallics%20and%20special%20effects%20range%20%282019%29.ase',
    'Multi-finish (2016)': 'Resene%20Multi-finish%20range%20%282016%29.ase',
    'The Range whites & neutrals (2021)': 'Resene%20The%20Range%20Whites%20%26%20Neutrals%20%282021%29.ase',
    'The Range fashion colours 24': 'Resene%20The%20Range%20fashion%20colours%2024.ase',
    'The Range fashion colours 20': 'Resene%20The%20Range%20fashion%20colours%2020.ase',
    'Woodsman exterior wood stains (2015)': 'Resene%20Woodsman%20exterior%20wood%20stains%20range%20%282015%29.ase',
}
# Stains, metallics and effects do not read as a flat colour through a sensor.
RESENE_NOT_FLAT = ('Colorwood', 'Woodsman', 'Metallics', 'wood stain', 'Metallic')


def ase_names(data):
    """Swatch names from an Adobe Swatch Exchange file."""
    count = struct.unpack('>I', data[8:12])[0]
    pos, names = 12, []
    for _ in range(count):
        kind, length = struct.unpack('>HI', data[pos:pos + 6])
        block = data[pos + 6:pos + 6 + length]
        pos += 6 + length
        if kind == 0x0001:
            n = struct.unpack('>H', block[:2])[0]
            names.append(block[2:2 + n * 2].decode('utf-16-be').rstrip('\x00'))
    return names


def xls_rows(data, header_first_cell):
    import xlrd
    sheet = xlrd.open_workbook(file_contents=data).sheet_by_index(0)
    rows = [[c.value for c in sheet.row(r)] for r in range(sheet.nrows)]
    start = next(i for i, r in enumerate(rows) if str(r[0]).strip() == header_first_cell)
    header = [str(h).strip() for h in rows[start]]
    return [dict(zip(header, r)) for r in rows[start + 1:] if str(r[0]).strip()]


def chart_year(chart):
    m = re.search(r'(\d{4})', chart)
    if m:
        return int(m.group(1)) - (1 if 'pre' in chart.lower() else 0)
    m = re.search(r'colours (\d{2})$', chart)
    return 2000 + int(m.group(1)) if m else 0


def build_resene():
    print('Resene', flush=True)
    master = xls_rows(fetch(RESENE_LISTS + 'download_alphabetical_list.xls', 'resene/alphabetical.xls', True),
                      'Colour name')
    pencils = xls_rows(fetch(RESENE_LISTS + 'download_pencils.xls', 'resene/pencils.xls', True), 'Colour name')
    visual = {}
    for r in pencils:
        try:
            visual[r['Colour name'].strip()] = (int(r['R']), int(r['G']), int(r['B']))
        except (ValueError, KeyError):
            pass

    cad = {}
    root = ET.fromstring(fetch(RESENE_CAD, 'resene/master-2022.acb'))
    for entry in root.iter('colorEntry'):
        m = re.match(r'Resene (.*) ([A-Z]{1,2}\d+-\d+-\d+)$', entry.find('colorName').text or '')
        if m:
            rgb = entry.find('RGB8')
            cad[m.group(1)] = tuple(int(rgb.find(k).text) for k in ('red', 'green', 'blue'))

    current = {}
    for chart, file in RESENE_CURRENT.items():
        data = fetch('https://www.resene.co.nz/download_files/ASE/' + file, f'resene/{slugify(chart)}.ase', True)
        for n in ase_names(data):
            m = re.match(r'Resene (.*) [A-Z]{1,2}\d+-\d+-\d+$', n)
            if m:
                current.setdefault(m.group(1), []).append(chart)

    # Merged case-blind: the list carries 'TrIple Sea Fog' beside 'Triple Sea
    # Fog', one colour typed twice. The spelling the CAD file uses wins.
    by_name, spelling = {}, {n.lower(): n for n in cad}
    for r in master:
        typed = str(r['Colour name']).strip()
        name = spelling.get(typed.lower(), by_name.get(typed.lower(), {}).get('name', typed))
        e = by_name.setdefault(name.lower(), {'name': name, 'code': str(r['TotalColCode']).strip(), 'charts': [],
                                              'lrv': r['LRV'], 'aliases': str(r.get('Same as', '')).strip()})
        e['charts'].append(str(r['Chart']).strip())

    rows = []
    for e in sorted(by_name.values(), key=lambda e: e['name']):
        name = e['name']
        lrv = float(e['lrv']) if isinstance(e['lrv'], float) and e['lrv'] > 0 else None
        in_ranges = current.get(name, [])
        charts = sorted(set(e['charts']), key=chart_year, reverse=True)
        if name in cad:
            rgb, tone, basis = cad[name], TONE['resene_cad'], 'Resene 2022 CAD RGB (derived by Resene from its master Lab)'
        elif name in visual:
            rgb, tone, basis = visual[name], TONE['resene_visual'], 'Resene 2016 screen RGB, display curve undone (^0.77)'
        else:
            rgb, tone, basis = None, None, ''
        not_flat = any(w.lower() in ' '.join(in_ranges + charts[:1]).lower() for w in RESENE_NOT_FLAT)
        rows.append(row(
            # Keyed by name, not code: Resene gives some differently named
            # colours one code (Chalk Dust and Quarter Albescent White are both
            # Y94-010-085), and an id that collides is not an id.
            brand='Resene', name=name, code=e['code'], maker_id=name,
            collection='; '.join(in_ranges) if in_ranges else '; '.join(charts[:3]),
            status='current' if in_ranges else 'archived', aliases=e['aliases'],
            rgb=rgb, lrv=lrv, tone=tone, basis=basis, not_flat=not_flat,
            source='https://www.resene.co.nz/swatches/colour-lists.htm'))
    return rows


# ---------------------------------------------------------------------------
# Dulux — the atlas page carries every current colour in one response.
# ---------------------------------------------------------------------------

def build_dulux():
    print('Dulux', flush=True)
    page = fetch('https://www.dulux.co.nz/specifier/colour/colour-atlas/', 'dulux/atlas.html').replace('\\"', '"')
    pat = re.compile(
        r'"colour":\{"slug":"(\d+_\d+)","displayName":"([^"]*)","imageUrl":"[^"]*","specifierNumber":"([^"]*)",'
        r'"categoryEntries":(\[.*?\]),"brand":\{"name":"([^"]*)".*?"rgb":\{"hex":"([^"]*)","r":(\d+),"g":(\d+),"b":(\d+)'
        r'.*?"lrv":([\d.]+|null),"sa":([\d.]+|null)')
    found = {}
    for m in pat.finditer(page):
        slug, name, code, cats, _brand, _hex, r, g, b, lrv, sa = m.groups()
        if slug not in found:
            found[slug] = (js_unescape(name), code, cats, (int(r), int(g), int(b)), lrv, sa)

    # Colours of New Zealand is, for about half its length, the atlas under
    # other names: Mt Aspiring Half carries exactly the RGB, LRV and solar
    # absorptance of Snowy Mountains Half. Three published figures agreeing to
    # three decimals is the same paint, so each is named as the other's alias —
    # which is also how a colour Nix knows by its Australian name is found.
    twins = {}
    for slug, (name, code, _c, rgb, lrv, sa) in found.items():
        twins.setdefault((rgb, lrv, sa), []).append(f'{name} {code}')

    rows = []
    for slug, (name, code, cats, rgb, lrv, sa) in found.items():
        cat_names = list(dict.fromkeys(js_unescape(c) for c in
                                       re.findall(r'"name":"([^"]+)","__typename":"ConsumerColourCategory"', cats)))
        rows.append(row(
            brand='Dulux', name=name, code=code, maker_id=slug,
            collection='; '.join(cat_names), status='current',
            aliases='; '.join(t for t in twins[(rgb, lrv, sa)] if t != f'{name} {code}'),
            rgb=rgb, lrv=None if lrv == 'null' else float(lrv),
            tone=TONE['dulux'], basis='Dulux atlas RGB, display curve undone (^0.87)', not_flat=False,
            source='https://www.dulux.co.nz/specifier/colour/colour-atlas/'))
    return rows


# ---------------------------------------------------------------------------
# Wattyl — and Taubmans, which in New Zealand is the same company (Hempel
# (Wattyl) NZ) selling the same Colour Designer range. Hex for every colour is
# in the listing page's stylesheet; the code and LRV are on each colour's page.
# ---------------------------------------------------------------------------

def build_wattyl():
    print('Wattyl / Taubmans', flush=True)
    listing = fetch('https://www.wattyl.co.nz/shop/colours/', 'wattyl/listing.html')
    swatches = re.findall(
        r'\[title="([^"]+)"\]::before,\s*\[data-color-circle="([^"]+)"\]::before,\s*\.color-circle-[^:]+::before,'
        r'\s*\.bg-[^\s{]+\s*\{\s*background-color:\s*(#[0-9A-Fa-f]{6})', listing)

    def one(slug):
        text = page_text(subprocess.run(
            ['curl', '-sS', '-L', '--max-time', '40', '-A', UA, f'https://www.wattyl.co.nz/paint-colour/{slug}/'],
            capture_output=True, text=True, errors='replace').stdout)
        m = re.search(r'Code:\s*(.*?)\s*Usage:\s*(.*?)\s*RGB:\s*(\d+),\s*(\d+),\s*(\d+)\s*LRV:\s*([\d.]+)', text)
        return {'code': m.group(1), 'usage': m.group(2), 'rgb': [int(m.group(k)) for k in (3, 4, 5)],
                'lrv': float(m.group(6)), 'ok': True} if m else {'ok': False}

    pages = fetch_many([s for _, s, _ in swatches], one, 'wattyl_pages.json', lambda p: p.get('ok'))
    report_wattyl(pages)
    rows = []
    for name, slug, hexv in swatches:
        p = pages.get(slug, {})
        rgb = tuple(p['rgb']) if p.get('ok') else tuple(int(hexv[i:i + 2], 16) for i in (1, 3, 5))
        lrv = p.get('lrv')
        roofing = name.upper().startswith(('COLORBOND', 'COLORSTEEL'))
        # Colours with a whole-number LRV are published exactly on it. The newer
        # ones, carrying a two-decimal LRV, are published 0-5 L* lighter with
        # no one curve explaining it — so those take their lightness from the LRV.
        newer = lrv is not None and lrv != int(lrv)
        rows.append(row(
            brand='Wattyl / Taubmans', name=html.unescape(name), code=p.get('code', ''), maker_id=slug,
            collection='Roofing steel' if roofing else 'Colour Designer', status='current', aliases='',
            rgb=rgb, lrv=lrv, tone=1.0,
            basis=('Wattyl listing swatch (the colour has no page of its own)' if not p.get('ok')
                   else 'Wattyl RGB hue' if newer else 'Wattyl RGB as published'),
            anchor_to_lrv=newer, not_flat=False, source=f'https://www.wattyl.co.nz/paint-colour/{slug}/'))
    return rows


def report_wattyl(pages):
    for group, is_newer in (('whole-number LRV', False), ('two-decimal LRV', True)):
        d = [lab_from_rgb(p['rgb'])[1][0] - l_star_from_lrv(p['lrv']) for p in pages.values()
             if p.get('ok') and p['lrv'] > 0 and (p['lrv'] != int(p['lrv'])) == is_newer]
        if d:
            mean = sum(d) / len(d)
            sd = math.sqrt(sum((x - mean) ** 2 for x in d) / len(d))
            print(f'  Wattyl, {group}: n={len(d)}, RGB L* vs LRV {mean:+.2f} ± {sd:.2f}, '
                  f'{sum(abs(x) <= 1 for x in d)} within 1 L*')


# ---------------------------------------------------------------------------
# Porter's — every colour on one page. DuluxGroup's, and its RGB carries the
# same display curve as Dulux's.
# ---------------------------------------------------------------------------

def build_porters():
    print("Porter's", flush=True)
    page = fetch('https://www.porterspaints.com/colours/all-colours/', 'porters/all.html')
    rows, seen = [], set()
    for href, block in re.findall(r'<a[^>]+href="(/colours/[^"#?]+/[^"#?]+)"[^>]*>(.*?)</a>', page, flags=re.S):
        m = re.search(r'R:\s*(\d+)\s*<br\s*/?>\s*G:\s*(\d+)\s*<br\s*/?>\s*B:\s*(\d+)\s*<br\s*/?>\s*LRV:\s*([\d.]+)', block)
        n = re.search(r'class="swatch-name">([^<]+)<', block)
        if not (m and n) or href in seen:
            continue
        seen.add(href)
        category = href.split('/')[2]
        lrv = float(m.group(4))
        rows.append(row(
            # The category is part of the id: 'Half Ballet Slipper' is both a
            # paint and a speciality finish, and they are not the same colour.
            brand="Porter's Paints", name=html.unescape(n.group(1).strip()), code='',
            maker_id='/'.join(href.split('/')[2:]),
            collection=category.replace('-', ' '), status='current', aliases='',
            rgb=tuple(int(m.group(i)) for i in (1, 2, 3)), lrv=lrv if lrv > 0 else None,
            tone=TONE['porters'], basis="Porter's RGB, display curve undone (^0.87)",
            not_flat=category == 'speciality-finishes', source='https://www.porterspaints.com' + href))
    return rows


# ---------------------------------------------------------------------------
# Aalto — paginated list, one page per colour, and an archive collection.
# ---------------------------------------------------------------------------

AALTO = 'https://www.aaltopaint.co.nz/shop/colours'
AALTO_COLLECTIONS = ['artist-palette', 'heritage-collection', 'master-palette', 'popular-derivatives',
                     'roof-timber', 'the-archive', 'toi-maori-aotearoa']


def build_aalto():
    print('Aalto', flush=True)

    def listing(query=''):
        slugs = []
        for p in range(1, 40):
            url = AALTO + ('' if p == 1 else f'/p{p}') + query
            page = fetch(url, f'aalto/list-{slugify(query) or "all"}-{p}.html')
            new = [s for s in dict.fromkeys(re.findall(r'/shop/colour/([a-z0-9-]+)\?', page)) if s not in slugs]
            if not new:
                break
            slugs += new
        return slugs

    slugs = listing()
    collections = {}
    for c in AALTO_COLLECTIONS:
        for s in listing(f'?collection={c}'):
            collections.setdefault(s, []).append(c.replace('-', ' '))
    slugs += [s for s in collections if s not in slugs]

    def one(slug):
        page = subprocess.run(['curl', '-sS', '-L', '--max-time', '40', '-A', UA,
                               f'https://www.aaltopaint.co.nz/shop/colour/{slug}'],
                              capture_output=True, text=True, errors='replace').stdout
        m = re.search(r'Colour data R(\d+)\W+G(\d+)\W+B(\d+)\s*LRV\s*([\d.]+)', page_text(page))
        t = re.search(r'<title>([^<|]+)', page)
        return {'name': html.unescape(t.group(1)).strip() if t else slug,
                'rgb': [int(m.group(k)) for k in (1, 2, 3)] if m else None,
                'lrv': float(m.group(4)) if m else None}

    pages = fetch_many(slugs, one, 'aalto_pages.json', lambda p: p.get('rgb'))
    samples = [(p['rgb'], p['lrv']) for p in pages.values()
               if p.get('rgb') and p.get('lrv') and 0 not in p['rgb'] and 255 not in p['rgb']]
    # No single curve reconciles Aalto's RGB with its LRV: about 40% agree to
    # ±1 L*, about 30% are published 3-5 L* lighter (whites at RGB 249-252,
    # brighter than any white paint), and a few LRVs are typos (Tinto 105).
    # So the RGB gives the hue and the LRV gives the lightness.
    k = 1.0
    within = sum(1 for rgb, lrv in samples if abs(lab_from_rgb(rgb)[1][0] - l_star_from_lrv(lrv)) <= 1)
    print(f'  Aalto: n={len(samples)}, {within} with RGB and LRV within 1 L*; lightness taken from LRV')
    rows = []
    for slug in slugs:
        p = pages.get(slug, {})
        cols = collections.get(slug, [])
        rows.append(row(
            brand='Aalto', name=re.sub(r'\s*[-–•|]\s*Aalto.*$', '', p.get('name', slug)), code='', maker_id=slug,
            collection='; '.join(cols), status='archived' if 'the archive' in cols else 'current', aliases='',
            rgb=tuple(p['rgb']) if p.get('rgb') else None, lrv=p.get('lrv'), tone=k,
            basis='Aalto RGB hue', anchor_to_lrv=True,
            not_flat=False, source=f'https://www.aaltopaint.co.nz/shop/colour/{slug}'))
    return rows


# ---------------------------------------------------------------------------
# One row, one shape.
# ---------------------------------------------------------------------------

COLUMNS = ['id', 'brand', 'name', 'code', 'collection', 'status', 'aliases',
           'hex_published', 'r', 'g', 'b', 'lrv',
           'lab_d50_L', 'lab_d50_a', 'lab_d50_b', 'lab_d65_L', 'lab_d65_a', 'lab_d65_b',
           'lab_basis', 'lrv_check', 'lab_quality', 'in_nix_already', 'source_url', 'retrieved']

# What Nix already ships for these makers (nixsensor.com/nix-paint-library,
# September 2026). A colour in one of these is better matched against Nix's own
# library; the gaps file leaves them out. 'check' means the maker's range and
# Nix's library share a name but it is not clear the editions are the same.
NIX_RESENE = {'BS5252 range (2008)', 'Classics Collection (2021)', 'Heritage (2015)', 'Karen Walker range 5',
              'KidzColour (2015)', 'Multi-finish (2016)', 'The Range whites & neutrals (2021)',
              'The Range fashion colours 24'}
NIX_HAS = {
    'Resene': lambda r: 'yes' if r['status'] == 'current' and NIX_RESENE & set(r['collection'].split('; ')) else 'no',
    # Colours of NZ is not a Nix library, but a colour in it with an atlas twin
    # may well be in Nix's atlas under the twin's name.
    'Dulux': lambda r: 'no' if 'Colours of NZ' in r['collection'] and not r['aliases'] else 'check',
    'Wattyl / Taubmans': lambda r: 'yes' if r['collection'] == 'Roofing steel' else 'check',
    "Porter's Paints": lambda r: 'yes',
    'Aalto': lambda r: 'no',
}


def row(brand, name, code, maker_id, collection, status, aliases, rgb, lrv, tone, basis, not_flat, source,
        anchor_to_lrv=False):
    r = {c: '' for c in COLUMNS}
    r.update(id=f'{slugify(brand)}/{slugify(str(maker_id) or name)}', brand=brand, name=name, code=code,
             collection=collection, status=status, aliases=aliases, source_url=source, retrieved=TODAY,
             lrv='' if lrv is None else (int(lrv) if lrv == int(lrv) else lrv))
    if rgb:
        r.update(hex_published='#%02X%02X%02X' % tuple(rgb), r=rgb[0], g=rgb[1], b=rgb[2])
    if not rgb or not_flat:
        r['lab_quality'] = 'none — a stain, metallic or texture' if not_flat else 'none — no colour data published'
        return r
    as_published = lab_from_rgb(rgb, tone)[1]
    # An LRV over 100 is not a measurement, and one that puts a colour more
    # than 15 L* from its own RGB is a typo on one side or the other.
    anchored = bool(anchor_to_lrv and lrv and 0 < lrv <= 100
                    and abs(as_published[0] - l_star_from_lrv(lrv)) <= 15)
    lab50, lab65 = lab_from_rgb(rgb, tone, lrv if anchored else None)
    if anchored:
        basis += ', lightness from LRV'
    r.update(lab_d50_L=round(lab50[0], 2), lab_d50_a=round(lab50[1], 2), lab_d50_b=round(lab50[2], 2),
             lab_d65_L=round(lab65[0], 2), lab_d65_a=round(lab65[1], 2), lab_d65_b=round(lab65[2], 2),
             lab_basis=basis)
    clipped = 0 in rgb or 255 in rgb
    if lrv:
        # Measured before any anchoring: how far the maker's own two figures
        # agree is the evidence, and anchoring would make it read 0 always.
        check = as_published[0] - l_star_from_lrv(lrv)
        r['lrv_check'] = round(check, 2)
        limit = 6 if anchored else 3
        quality = 'good' if abs(check) <= 1 else 'approx' if abs(check) <= limit else 'poor'
    else:
        quality = 'approx'
    if clipped and quality == 'good':
        quality = 'approx'
    notes = []
    if abs(r['lrv_check'] or 0) > 3:
        notes.append("maker's RGB and LRV disagree")
    if clipped:
        notes.append('outside screen gamut, clipped')
    r['lab_quality'] = quality + (' — ' + '; '.join(notes) if notes else '')
    return r


def write(rows):
    os.makedirs(OUT, exist_ok=True)
    for r in rows:
        r['in_nix_already'] = NIX_HAS[r['brand']](r)
    rows.sort(key=lambda r: (r['brand'], r['name'].lower()))

    # utf-8-sig: Excel on Windows guesses a code page without a BOM, and the
    # macrons in Dulux's names (Pūkaki, Tīrau) come back mangled — the same
    # reason Snag's own CSV export writes one.
    with open(os.path.join(OUT, 'nz-paint-library.csv'), 'w', newline='', encoding='utf-8-sig') as fh:
        w = csv.DictWriter(fh, COLUMNS, quoting=csv.QUOTE_ALL, lineterminator='\r\n')
        w.writeheader()
        w.writerows(rows)

    usable = [r for r in rows if r['lab_d50_L'] != '' and not r['lab_quality'].startswith('poor')]

    def slim(name, subset):
        path = os.path.join(OUT, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', newline='', encoding='utf-8-sig') as fh:
            w = csv.writer(fh, quoting=csv.QUOTE_ALL, lineterminator='\r\n')
            w.writerow(['Name', 'L', 'a', 'b', 'Hex', 'Comment'])
            for r in subset:
                # 'Aalto Black' is already a name with the maker in it.
                brand = r['brand'].split(' / ')[0]
                label = ('' if r['name'].startswith(brand) else brand + ' ') + r['name']
                label += f" {r['code']}" if r['code'] else ''
                w.writerow([label, r['lab_d50_L'], r['lab_d50_a'], r['lab_d50_b'], r['hex_published'],
                            f"{r['collection']} · {r['status']} · Lab {r['lab_quality'].split(' ')[0]} · id {r['id']}"])
        return len(subset)

    # The gaps file is only what is certainly not in a Nix library. 'check'
    # stays out of it — the Dulux atlas alone is 4,900 colours that are very
    # likely Nix's own World of Colour atlas — and lives in the per-brand files.
    n_gaps = slim('nix-import-gaps.csv', [r for r in usable if r['in_nix_already'] == 'no'])
    for brand in sorted({r['brand'] for r in usable}):
        slim(f"nix-by-brand/{slugify(brand)}.csv", [r for r in usable if r['brand'] == brand])
    print(f'\n{len(rows)} colours · {len(usable)} with a usable Lab · {n_gaps} certainly not in a Nix library')
    by = {}
    for r in rows:
        b = by.setdefault(r['brand'], {'rows': 0, 'good': 0, 'approx': 0, 'poor': 0, 'none': 0, 'archived': 0})
        b['rows'] += 1
        b[r['lab_quality'].split(' ')[0]] += 1
        b['archived'] += r['status'] == 'archived'
    for brand, b in by.items():
        print(f"  {brand:20} {b['rows']:5}  good {b['good']:5}  approx {b['approx']:4}  poor {b['poor']:3}  "
              f"no Lab {b['none']:3}  archived {b['archived']:4}")


def match(argv):
    """Nearest colours to a reading: build.py match L a b [--d65] [--all]"""
    lab = tuple(float(x) for x in argv[:3])
    key = 'lab_d65_' if '--d65' in argv else 'lab_d50_'
    rows = list(csv.DictReader(open(os.path.join(OUT, 'nz-paint-library.csv'), encoding='utf-8-sig')))
    scored = sorted(((delta_e_2000(lab, (float(r[key + 'L']), float(r[key + 'a']), float(r[key + 'b']))), r)
                     for r in rows if r[key + 'L'] and ('--all' in argv or not r['lab_quality'].startswith('poor'))),
                    key=lambda pair: pair[0])
    print(f"Reading {lab} ({'D65' if '--d65' in argv else 'D50'}/2°) — a shortlist, not an answer:\n")
    for de, r in scored[:10]:
        print(f"  ΔE {de:5.2f}  {r['brand']:18} {r['name']:28} {r['code']:14} "
              f"{r['status']:8} Lab {r['lab_quality'].split(' ')[0]}")


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'match':
        match(sys.argv[2:])
    else:
        write(build_resene() + build_dulux() + build_wattyl() + build_porters() + build_aalto())
