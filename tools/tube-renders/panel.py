# Renders the Tubes instrument panel for each variant and height in layout.py: black
# wrinkle-finish steel, raised hammertone plates with slotted screws, the fixed legends in
# cream paint, blank bakelite label plates (the live lettering goes on them in the page).
# One 2048 x 2H PNG, panel-<variant>-<H>.png, per variant and height.
# Also the 'tabplate' part: the bakelite tab plate on its own, transparent around it, which
# the renderer places along the tab row in the display's order.
# Run: blender -b -P panel.py -- <outdir> [samples] [variant:H ... | tabplate]   (default: all)
import bpy, bmesh, math, os, sys
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from layout import HEIGHTS, VARIANTS, screen

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '/tmp/kl4'
SAMPLES = int(argv[1]) if len(argv) > 1 else 256
ONLY = argv[2:] or ['%s:%d' % (v, h) for v in VARIANTS for h in HEIGHTS] + ['tabplate']
FONT = os.path.join(HERE, 'IBMPlexMono-Regular.ttf')
os.makedirs(OUT, exist_ok=True)
BL = os.path.dirname(bpy.app.binary_path)
HDRI = os.path.join(BL, '%d.%d' % bpy.app.version[:2], 'datafiles', 'studiolights', 'world', 'interior.exr')
U = 0.01  # world units per frame unit


def P(x, y, z=0.0):
    return Vector((x * U, -y * U, z))


def reset():
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
    s.render.image_settings.file_format = 'PNG'
    s.render.image_settings.color_mode = 'RGB'
    s.view_settings.view_transform = 'AgX'
    s.view_settings.look = 'AgX - Medium High Contrast'
    w = bpy.data.worlds.new('w')
    s.world = w
    w.use_nodes = True
    env = w.node_tree.nodes.new('ShaderNodeTexEnvironment')
    env.image = bpy.data.images.load(HDRI)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.12
    w.node_tree.links.new(env.outputs['Color'], w.node_tree.nodes['Background'].inputs['Color'])
    return s


def bumpmat(name, color, metal, rough, kind, scale, strength, var=0.0):
    """Principled material with a procedural surface: 'wrinkle' (noise) or 'hammer' (voronoi)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    tc = nt.nodes.new('ShaderNodeTexCoord')
    if kind == 'hammer':
        t = nt.nodes.new('ShaderNodeTexVoronoi')
        t.feature = 'SMOOTH_F1'
        t.inputs['Scale'].default_value = scale
        h = t.outputs['Distance']
    else:
        t = nt.nodes.new('ShaderNodeTexNoise')
        t.inputs['Scale'].default_value = scale
        t.inputs['Detail'].default_value = 12
        t.inputs['Roughness'].default_value = 0.65
        h = t.outputs['Fac']
    nt.links.new(tc.outputs['Object'], t.inputs['Vector'])
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = strength
    bump.inputs['Distance'].default_value = 0.002
    nt.links.new(h, bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    # slight tonal variation (wear, uneven paint)
    n2 = nt.nodes.new('ShaderNodeTexNoise')
    n2.inputs['Scale'].default_value = 3.0
    nt.links.new(tc.outputs['Object'], n2.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*[c * (1 - var) for c in color], 1)
    ramp.color_ramp.elements[1].color = (*[min(1, c * (1 + var)) for c in color], 1)
    nt.links.new(n2.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    return m


def mat(name, color, metal=0.0, rough=0.5, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    b.inputs['Coat Weight'].default_value = coat
    return m


def link(o, m=None):
    bpy.context.scene.collection.objects.link(o)
    if m:
        o.data.materials.append(m)
    return o


def box(name, x, y, w, h, z0, z1, m, bevel=0.0):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bm.to_mesh(me)
    bm.free()
    o = link(bpy.data.objects.new(name, me), m)
    o.scale = (w * U, h * U, (z1 - z0))
    o.location = P(x + w / 2, y + h / 2, (z0 + z1) / 2)
    if bevel:
        bpy.context.view_layer.update()
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        o.select_set(False)
        bv = o.modifiers.new('bv', 'BEVEL')
        bv.width = bevel
        bv.segments = 4
        bv.limit_method = 'ANGLE'
        for f in o.data.polygons:
            f.use_smooth = True
        o.data.shade_smooth()
    return o


def screw(x, y, z, r, m_head, m_slot, ang):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r * U, segments=32, ring_count=16, location=P(x, y, z))
    o = bpy.context.active_object
    o.scale = (1, 1, 0.45)
    o.data.materials.append(m_head)
    bpy.ops.object.shade_smooth()
    bpy.ops.mesh.primitive_cube_add(size=1, location=P(x, y, z + r * U * 0.3))
    s = bpy.context.active_object
    s.scale = (r * U * 2.2, r * U * 0.28, r * U * 0.6)
    s.rotation_euler = (0, 0, math.radians(ang))
    bo = o.modifiers.new('slot', 'BOOLEAN')
    bo.operation = 'DIFFERENCE'
    bo.object = s
    s.hide_render = True
    s.hide_viewport = True


def text(t, x, y, size, z, m, align='l'):
    cu = bpy.data.curves.new('t', 'FONT')
    cu.body = t
    cu.font = FONTD
    cu.size = size * U * 1.0
    cu.space_character = 1.18
    cu.align_x = {'l': 'LEFT', 'c': 'CENTER', 'r': 'RIGHT'}[align]
    cu.align_y = 'CENTER'
    cu.extrude = 0.00005
    o = link(bpy.data.objects.new('t', cu), m)
    o.location = P(x, y, z)
    return o


def light(name, loc, power, size, color, target):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.energy, ld.size, ld.color = power, size, color
    lo = link(bpy.data.objects.new(name, ld))
    lo.location = loc
    lo.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()


def tabplate():
    """The tab plate (76 x 22 units, brass rivets), lit like the panels, on a clear ground."""
    s = reset()
    s.render.film_transparent = True
    s.render.image_settings.color_mode = 'RGBA'
    bake = mat('bakelite', (0.012, 0.010, 0.009), 0, 0.28, coat=0.5)
    brass = mat('brass', (0.70, 0.50, 0.25), 1, 0.35)
    box('lab', 0, 0, 76, 22, 0.03, 0.036, bake, bevel=0.003)
    for rx in (5, 71):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=1.6 * U, location=P(rx, 11, 0.036))
        r = bpy.context.active_object
        r.scale = (1, 1, 0.5)
        r.data.materials.append(brass)
    light('key', (-2.0, 3.0, 9.0), 1100, 7, (1.0, 0.86, 0.70), (0.38, -0.11, 0))
    light('fill', (12, -9, 6), 160, 8, (0.80, 0.86, 1.0), (0.38, -0.11, 0))
    cd = bpy.data.cameras.new('cam')
    cd.type = 'ORTHO'
    cd.ortho_scale = 0.80              # 80 units across: the plate plus a 2-unit margin
    c = link(bpy.data.objects.new('cam', cd))
    c.location = (0.38, -0.11, 20)
    s.camera = c
    s.render.resolution_x, s.render.resolution_y = 320, 104   # 4 px a unit, 80 x 26 units
    s.render.filepath = os.path.join(OUT, 'tabplate.png')
    bpy.ops.render.render(write_still=True)


for job in ONLY:
    if job == 'tabplate':
        tabplate()
        continue
    variant, H = job.split(':')[0], int(job.split(':')[1])
    L = screen(variant, H)
    s = reset()
    FONTD = bpy.data.fonts.load(FONT)
    panel = bumpmat('panel', (0.016, 0.015, 0.014), 0.2, 0.62, 'wrinkle', 380, 0.35, 0.25)
    plate = bumpmat('plate', (0.032, 0.033, 0.035), 0.55, 0.40, 'hammer', 160, 0.22, 0.35)
    bake = mat('bakelite', (0.012, 0.010, 0.009), 0, 0.28, coat=0.5)
    nickel = mat('nickel', (0.62, 0.60, 0.56), 1, 0.3)
    slot = mat('slot', (0.02, 0.02, 0.02), 0, 0.8)
    paint = mat('paint', (0.80, 0.74, 0.60), 0, 0.65)
    paintd = mat('paintd', (0.42, 0.39, 0.33), 0, 0.7)
    brass = mat('brass', (0.70, 0.50, 0.25), 1, 0.35)
    box('panel', -20, -20, 1064, H + 40, -0.02, 0.0, panel)
    for i, p in enumerate(L['plates']):
        box('plate%d' % i, p['x'], p['y'], p['w'], p['h'], 0.0, 0.03, plate, bevel=0.012)
        for (sx, sy, a) in ((p['x'] + 11, p['y'] + 11, 20), (p['x'] + p['w'] - 11, p['y'] + 11, 75),
                            (p['x'] + 11, p['y'] + p['h'] - 11, 130), (p['x'] + p['w'] - 11, p['y'] + p['h'] - 11, 160)):
            screw(sx, sy, 0.03, 5.0, nickel, slot, a)
    for i, l in enumerate(L['labels']):
        box('lab%d' % i, l['x'], l['y'], l['w'], l['h'], 0.03, 0.036, bake, bevel=0.003)
        for rx in (l['x'] + 5, l['x'] + l['w'] - 5):
            bpy.ops.mesh.primitive_uv_sphere_add(radius=1.6 * U, location=P(rx, l['y'] + l['h'] / 2, 0.036))
            r = bpy.context.active_object
            r.scale = (1, 1, 0.5)
            r.data.materials.append(brass)
    for t in L['paint']:
        text(t['t'], t['x'], t['y'], t['s'], 0.0302 if t['y'] > 6 else 0.0002, paintd if t.get('c') == 'dim' else paint, t.get('a', 'l'))
    mid = H / 200.0   # the panel's vertical middle, in world units (3.0 at H = 600)
    light('key', (-2.0, 3.0, 9.0), 1100, 7, (1.0, 0.86, 0.70), (4.5, -mid, 0))
    light('fill', (12, -9 * mid / 3.0, 6), 160, 8, (0.80, 0.86, 1.0), (5, -mid, 0))
    light('rake', (5.12, 4.0, 1.2), 380, 10, (1.0, 0.75, 0.5), (5.12, -2, 0))
    cd = bpy.data.cameras.new('cam')
    cd.type = 'ORTHO'
    cd.ortho_scale = 10.24
    c = link(bpy.data.objects.new('cam', cd))
    c.location = (5.12, -mid, 20)
    s.camera = c
    s.render.resolution_x, s.render.resolution_y = 2048, 2 * H
    s.render.filepath = os.path.join(OUT, 'panel-%s-%d.png' % (variant, H))
    bpy.ops.render.render(write_still=True)
print('DONE')
