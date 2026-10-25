# One description of every Tubes screen, in frame units (1024 wide, H tall), read by the
# Blender panel render (plates, screws, fixed legends, blank label plates) and, through the
# generated chiketi/assets/ui/tubes_layout.js, by the renderer (the live parts: Nixie digits,
# filament glow, magic eyes, lamps, windows, lettering). Pure Python, no Blender.
# Run as a script to write every variant at every height as JSON.
import hashlib
import json
import os
import sys

W = 1024
HEIGHTS = [576, 600, 620, 640, 660, 683, 700, 720, 745, 770]
VARIANTS = ['lab', 'sessions', 'gpus4', 'gpus8', 'notice']
HDR = dict(x=6, y=6, w=1012, h=86)
TITLES = {'lab': 'HOME LAB MONITOR', 'sessions': 'SESSION BOARD', 'gpus4': 'GPU ARRAY', 'gpus8': 'GPU ARRAY',
          'notice': 'STANDBY'}
# The tab row: built screens take 84 units (a lamp over a bakelite plate, the 'tabplate' part),
# planned ones 46 (a small lamp over painted lettering), left to right in the display's order.
TAB_X0, TAB_X1 = 222, 676


def header(variant):
    """The header: the same on every screen and at every height. Nothing about the tabs is
    baked: the renderer lays them out in the display's order along the tab row (built 84
    units wide, planned 46), so the lamps follow the plan like every other look's menu."""
    plates = [dict(HDR)]
    paint = [dict(t='CHIKETI INSTRUMENT CO.', x=24, y=22, s=9, c='dim'), dict(t=TITLES[variant], x=24, y=48, s=15)]
    labels = []
    slots = [dict(kind='tabrow', x=TAB_X0, w=TAB_X1 - TAB_X0, lamp_y=26, small_lamp_y=24, d=24, small_d=14,
                  plate_y=48, plate_w=76, plate_h=22, built_w=84, planned_w=46)]
    slots.append(dict(kind='date', x=676, y=16, w=112, h=62))
    slots.append(dict(kind='clock', x=818, y=16, h=60))
    return plates, paint, labels, slots


def lab(H):
    plates, paint, labels, slots = header('lab')
    plates += [dict(x=6, y=98, w=302, h=208), dict(x=316, y=98, w=702, h=208),
               dict(x=6, y=314, w=1012, h=H - 320)]
    paint += [dict(t='CONDITION', x=26, y=120, s=12), dict(t='STATIONS', x=336, y=120, s=12),
              dict(t='LAMPS:  UP · HEALTH', x=998, y=120, s=9, c='dim', a='r'),
              dict(t='HOSTS', x=26, y=272, s=11), dict(t='FAULTS', x=148, y=272, s=11),
              dict(t='FAULT REGISTER', x=26, y=336, s=12)]
    for i, x in enumerate((57, 157, 257)):
        slots.append(dict(kind='cond', i=i, x=x, y=160, d=52))
        labels.append(dict(x=x - 44, y=194, w=88, h=22, kind='cond', i=i))
    slots += [dict(kind='hosts', x=88, y=244, h=48), dict(kind='faults', x=222, y=244, h=48)]
    for k in range(9):
        cx, cy = 336 + (k % 3) * 226, 150 + (k // 3) * 52
        slots += [dict(kind='hostup', k=k, x=cx + 12, y=cy + 6, d=24),
                  dict(kind='hosthealth', k=k, x=cx + 42, y=cy + 6, d=24)]
        labels.append(dict(x=cx + 60, y=cy - 9, w=158, h=30, kind='host', k=k))
    slots.append(dict(kind='faultcount', x=998, y=336))
    slots.append(dict(kind='faultlist', x=26, y=352, w=972, h=H - 368))
    return dict(plates=plates, paint=paint, labels=labels, slots=slots)


def sessions(H):
    plates, paint, labels, slots = header('sessions')
    extra = H - 600
    rh = 88 + extra // 5
    for k in range(5):
        y = 98 + k * (rh + 6)
        h = rh + (extra - 5 * (extra // 5) if k == 4 else 0)
        plates.append(dict(x=6, y=y, w=1012, h=h))
        mid = y + h / 2
        paint += [dict(t='TOKENS', x=742, y=y + 20, s=9, c='dim', a='r'),
                  dict(t='AGENTS', x=820, y=y + 20, s=9, c='dim', a='c'),
                  dict(t='RUNNING', x=996, y=y + 20, s=9, c='dim', a='r')]
        slots += [dict(kind='slamp', k=k, x=40, y=round(mid), d=34),
                  dict(kind='swin', k=k, x=70, y=round(mid - 33), w=500, h=66),
                  dict(kind='stok', k=k, x=742, y=round(mid - 14), h=44),
                  dict(kind='sagents', k=k, x=820, y=round(mid - 14), h=44),
                  dict(kind='srun', k=k, x=996, y=round(mid - 14), h=44)]
    slots.append(dict(kind='sfoot', x=12, y=H - 24, w=1000, h=20))
    return dict(plates=plates, paint=paint, labels=labels, slots=slots)


def gpus(H, rows):
    variant = 'gpus8' if rows == 2 else 'gpus4'
    plates, paint, labels, slots = header(variant)
    base = 496 if rows == 1 else 244            # the v4 module height at H = 600
    # The modules leave a 24-unit footer line (counts, power, inventory, stale, +N MORE),
    # which v4 did not have.
    mh = H - 128 if rows == 1 else (H - 136) // 2
    k_y = mh / base                             # module offsets scale with the module

    def sy(v):
        return round(v * k_y)
    for k in range(4 * rows):
        x, y = 6 + (k % 4) * 254, 98 + (k // 4) * (mh + 8)
        plates.append(dict(x=x, y=y, w=248, h=mh))
        labels.append(dict(x=x + 24, y=y + 14, w=200, h=28, kind='gpu', k=k))
        if rows == 1:
            slots += [dict(kind='geye', k=k, x=x + 124, y=y + sy(150), d=150),
                      dict(kind='gtemp', k=k, x=x + 124, y=y + sy(272), h=56),
                      dict(kind='gvram', k=k, x=x + 14, y=y + sy(380), w=220),
                      dict(kind='gpow', k=k, x=x + 14, y=y + sy(428), w=220),
                      dict(kind='gstate', k=k, x=x + 22, y=y + sy(476))]
        else:
            slots += [dict(kind='geye', k=k, x=x + 66, y=y + sy(104), d=96),
                      dict(kind='gtemp', k=k, x=x + 184, y=y + sy(56), h=40),
                      dict(kind='gvram', k=k, x=x + 112, y=y + sy(158), w=126),
                      dict(kind='gpow', k=k, x=x + 112, y=y + sy(194), w=126),
                      dict(kind='gstate', k=k, x=x + 18, y=y + sy(226))]
    slots.append(dict(kind='gfoot', x=12, y=H - 24, w=1000, h=20))
    return dict(plates=plates, paint=paint, labels=labels, slots=slots)


def notice(H):
    """The empty-plan notice: the header and one plate with a window in its middle."""
    plates, paint, labels, slots = header('notice')
    plates.append(dict(x=6, y=98, w=1012, h=H - 104))
    mid = 98 + (H - 104) // 2
    slots.append(dict(kind='nwin', x=212, y=mid - 50, w=600, h=72))
    slots.append(dict(kind='nhint', x=212, y=mid + 34, w=600, h=20))
    return dict(plates=plates, paint=paint, labels=labels, slots=slots)


def screen(variant, H):
    if variant == 'notice':
        return notice(H)
    if variant == 'lab':
        return lab(H)
    if variant == 'sessions':
        return sessions(H)
    return gpus(H, 2 if variant == 'gpus8' else 1)


def everything():
    return {v: {str(h): screen(v, h) for h in HEIGHTS} for v in VARIANTS}


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(',', ':'))


def layout_hash():
    return hashlib.sha256(canonical(everything()).encode()).hexdigest()[:12]


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'layout.json')
    with open(out, 'w') as f:
        json.dump({'hash': layout_hash(), 'heights': HEIGHTS, 'screens': everything()}, f, indent=1)
    print('wrote', out)
