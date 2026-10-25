# Small Tubes parts, rendered top-down on a transparent background:
#   jewel-<colour>-<on|off>.png   chrome-bezel pilot lamp with a faceted lens
#   eye-back.png / eye-front.png  magic-eye mount: dark well behind, chrome bezel + glass dome in front
#   ann-<colour>.png              backlit annunciator window (frame + frosted glass), for 9-slice use
# Run: blender -b -P parts.py -- <outdir> [samples]
import bpy, bmesh, math, os, sys, json
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '/tmp/kl4'
SAMPLES = int(argv[1]) if len(argv) > 1 else 256
os.makedirs(OUT, exist_ok=True)
BL = os.path.dirname(bpy.app.binary_path)
HDRI = os.path.join(BL, '%d.%d' % bpy.app.version[:2], 'datafiles', 'studiolights', 'world', 'interior.exr')
COL = {'amber': (1.0, 0.30, 0.0), 'green': (0.10, 1.0, 0.12), 'red': (1.0, 0.07, 0.03), 'blue': (0.08, 0.32, 1.0), 'white': (1.0, 0.78, 0.48)}


def reset(res):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    p = bpy.context.preferences.addons['cycles'].preferences
    p.compute_device_type = 'OPTIX'
    p.get_devices()
    for d in p.devices:
        d.use = d.type == 'OPTIX'
    s.cycles.device = 'GPU'
    s.cycles.samples = SAMPLES
    s.cycles.use_denoising = True
    s.cycles.transmission_bounces = 16
    s.render.film_transparent = True
    s.cycles.film_transparent_glass = False
    s.render.image_settings.file_format = 'PNG'
    s.render.image_settings.color_mode = 'RGBA'
    s.view_settings.view_transform = 'AgX'
    s.view_settings.look = 'AgX - Medium High Contrast'
    s.render.resolution_x, s.render.resolution_y = res
    w = bpy.data.worlds.new('w')
    s.world = w
    w.use_nodes = True
    env = w.node_tree.nodes.new('ShaderNodeTexEnvironment')
    env.image = bpy.data.images.load(HDRI)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.4
    w.node_tree.links.new(env.outputs['Color'], w.node_tree.nodes['Background'].inputs['Color'])
    return s


def mat(name, color=(0.8, 0.8, 0.8), metal=0.0, rough=0.5, trans=0.0, ior=1.5, emit=None, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    b.inputs['Transmission Weight'].default_value = trans
    b.inputs['IOR'].default_value = ior
    b.inputs['Coat Weight'].default_value = coat
    if emit:
        b.inputs['Emission Color'].default_value = (*emit[0], 1)
        b.inputs['Emission Strength'].default_value = emit[1]
    return m


def link(o, m=None):
    bpy.context.scene.collection.objects.link(o)
    if m:
        o.data.materials.append(m)
    return o


def lathe(name, prof, seg=96, smooth=True):
    bm = bmesh.new()
    rings = [[bm.verts.new((r * math.cos(2 * math.pi * k / seg), r * math.sin(2 * math.pi * k / seg), z)) for k in range(seg)] for r, z in prof]
    for i in range(len(rings) - 1):
        for k in range(seg):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % seg], rings[i + 1][(k + 1) % seg], rings[i + 1][k]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for f in me.polygons:
        f.use_smooth = smooth
    return me


def camera(scale, z=20):
    cd = bpy.data.cameras.new('cam')
    cd.type = 'ORTHO'
    cd.ortho_scale = scale
    c = link(bpy.data.objects.new('cam', cd))
    c.location = (0, 0, z)
    bpy.context.scene.camera = c


def light(name, loc, power, size, color=(1, 0.9, 0.8), target=(0, 0, 0)):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.energy, ld.size, ld.color = power, size, color
    lo = link(bpy.data.objects.new(name, ld))
    lo.location = loc
    lo.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()


def render(path):
    bpy.context.scene.render.filepath = os.path.join(OUT, path)
    bpy.ops.render.render(write_still=True)


chrome = lambda: mat('chrome', (0.9, 0.9, 0.88), 1, 0.12)
meta = {}

# ---------------------------------------------------------------- jewel pilot lamps
for colour, rgb in COL.items():
    for on in (True, False):
        reset((192, 192))
        # chrome bezel: knurled-looking outer ring with a chamfer
        link(bpy.data.objects.new('bezel', lathe('bezel', [(1.00, 0.0), (1.00, 0.10), (0.94, 0.20), (0.80, 0.24), (0.70, 0.22), (0.68, 0.12)])), chrome())
        # faceted lens: low-poly dome, flat shaded so each facet catches light
        bpy.context.scene.view_settings.view_transform = 'Standard'
        bpy.context.scene.view_settings.look = 'None'
        lens = mat('lens', tuple(0.08 + 0.92 * c for c in rgb), 0, 0.06, trans=1.0, ior=1.55)
        link(bpy.data.objects.new('lens', lathe('lens', [(0.69, 0.12), (0.66, 0.30), (0.52, 0.46), (0.30, 0.55), (0.0001, 0.58)], 14, smooth=False)), lens)
        # the bulb behind the lens
        bulb = mat('bulb', tuple(c * (0.9 if on else 0.08) for c in rgb), 0, 0.5, emit=(rgb, 3.2) if on else None)
        link(bpy.data.objects.new('bulb', lathe('bulb', [(0.0001, -0.05), (0.55, -0.05), (0.40, 0.12), (0.0001, 0.2)])), bulb)
        link(bpy.data.objects.new('well', lathe('well', [(0.0001, -0.08), (0.69, -0.08), (0.69, 0.12)])), mat('well', (0.03, 0.03, 0.03), 0, 0.6))
        light('key', (-3, 4, 8), 120, 3)
        light('rim', (4, -3, 3), 40, 2, (0.8, 0.85, 1))
        camera(2.2)
        render('jewel-%s-%s.png' % (colour, 'on' if on else 'off'))
meta['jewel'] = {'px': 192, 'units': 2.2, 'bezel_r': 1.0}

# ---------------------------------------------------------------- magic-eye mount
reset((384, 384))
bez = link(bpy.data.objects.new('bezel', lathe('bezel', [(1.00, 0.0), (1.00, 0.08), (0.96, 0.16), (0.86, 0.20), (0.80, 0.18), (0.78, 0.06), (0.78, -0.2)])), chrome())
dome = link(bpy.data.objects.new('dome', lathe('dome', [(0.79, 0.06), (0.74, 0.18), (0.60, 0.30), (0.38, 0.38), (0.0001, 0.41)])),
            mat('glass', (1, 0.98, 0.95), 0, 0.02, trans=1.0, ior=1.47))
well = link(bpy.data.objects.new('well', lathe('well', [(0.0001, -0.3), (0.78, -0.3), (0.78, 0.06)])), mat('well', (0.012, 0.012, 0.012), 0, 0.7))
light('key', (-3, 4, 8), 220, 3)
light('rim', (4, -3, 3), 80, 2, (0.8, 0.85, 1))
camera(2.2)
bpy.context.scene.cycles.film_transparent_glass = True
for o in (bez, dome):
    o.hide_render = True
render('eye-back.png')
well.hide_render = True
for o in (bez, dome):
    o.hide_render = False
render('eye-front.png')
meta['eye'] = {'px': 384, 'units': 2.2, 'opening_r': 0.78}

# ---------------------------------------------------------------- annunciator windows
AW, AH = 4.0, 1.4   # sprite in world units; frame width 0.16
for colour, rgb in list(COL.items()) + [('off', None)]:
    reset((800, 280))
    fr = 0.16
    me = bpy.data.meshes.new('frame')
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bm.to_mesh(me)
    bm.free()
    fmat = mat('frame', (0.02, 0.02, 0.02), 0.6, 0.35, coat=0.3)
    for nm, sx, sy, lx, ly in (('t', AW, fr, 0, (AH - fr) / 2), ('b', AW, fr, 0, -(AH - fr) / 2),
                               ('l', fr, AH, -(AW - fr) / 2, 0), ('r', fr, AH, (AW - fr) / 2, 0)):
        bar = link(bpy.data.objects.new('frame' + nm, me.copy()), fmat)
        bar.scale = (sx, sy, 0.14)
        bar.location = (lx, ly, 0)
        bv = bar.modifiers.new('bv', 'BEVEL')
        bv.width = 0.02
        bv.segments = 3
    # frosted glass pane and the lamp behind it
    bpy.context.scene.view_settings.view_transform = 'Standard'
    bpy.context.scene.view_settings.look = 'None'
    fm = mat('frost', (0.02, 0.02, 0.02) if rgb else (0.03, 0.028, 0.026), 0, 0.5, emit=(rgb, 1.0) if rgb else None)
    if rgb:  # frosted diffuser over two bulbs: two soft hot spots, darker toward the frame, faint grain
        nt = fm.node_tree
        tc = nt.nodes.new('ShaderNodeTexCoord')
        acc = None
        for cx in (-0.95, 0.95):
            mp = nt.nodes.new('ShaderNodeMapping')
            mp.inputs['Location'].default_value = (-cx * 0.62, 0, 0)
            mp.inputs['Scale'].default_value = (0.62, 1.15, 1)
            nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
            gr = nt.nodes.new('ShaderNodeTexGradient')
            gr.gradient_type = 'SPHERICAL'
            nt.links.new(mp.outputs['Vector'], gr.inputs['Vector'])
            if acc is None:
                acc = gr.outputs['Fac']
            else:
                ad = nt.nodes.new('ShaderNodeMath')
                ad.operation = 'ADD'
                nt.links.new(acc, ad.inputs[0])
                nt.links.new(gr.outputs['Fac'], ad.inputs[1])
                acc = ad.outputs['Value']
        nz = nt.nodes.new('ShaderNodeTexNoise')
        nz.inputs['Scale'].default_value = 700
        nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
        m1 = nt.nodes.new('ShaderNodeMath')
        m1.operation = 'MULTIPLY_ADD'
        nt.links.new(acc, m1.inputs[0])
        m1.inputs[1].default_value = 0.75
        m1.inputs[2].default_value = 0.28
        m2 = nt.nodes.new('ShaderNodeMath')
        m2.operation = 'MULTIPLY_ADD'
        nt.links.new(nz.outputs['Fac'], m2.inputs[0])
        m2.inputs[1].default_value = 0.06
        nt.links.new(m1.outputs['Value'], m2.inputs[2])
        nt.links.new(m2.outputs['Value'], nt.nodes['Principled BSDF'].inputs['Emission Strength'])
    g = link(bpy.data.objects.new('glass', me.copy()), fm)
    g.scale = (AW - 2 * fr + 0.02, AH - 2 * fr + 0.02, 0.03)
    g.location = (0, 0, -0.01)
    back = link(bpy.data.objects.new('lamp', me.copy()), mat('lamp', rgb or (0.02, 0.02, 0.02), 0, 0.8, emit=(rgb, 6.0) if rgb else None))
    back.scale = (AW - 2 * fr, AH - 2 * fr, 0.02)
    back.location = (0, 0, -0.12)
    light('key', (-3, 4, 8), 300, 4)
    light('rim', (5, -3, 3), 80, 3, (0.8, 0.85, 1))
    camera(AW)
    render('ann-%s.png' % colour)
meta['ann'] = {'px_w': 800, 'px_h': 280, 'units_w': AW, 'frame_units': 0.16}
json.dump(meta, open(os.path.join(OUT, 'parts.json'), 'w'), indent=1)
print('DONE')
