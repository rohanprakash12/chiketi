# IN-12 Nixie, seen end-on through the top of the glass (the clock tubes in refs/tubes/*.webp):
# a rounded-rectangle glass window, a square anode mesh in front, the cathode numerals stacked
# behind it, mica clips top and bottom. Two transparent layers, as for the other tubes:
#   in12-back.png   cathode stack, clips, dark interior
#   in12-front.png  glass envelope (thick bright edge) and the mesh
# The page draws the lit numeral between them.
# Run: blender -b -P in12.py -- <outdir> [samples]
import bpy, bmesh, math, os, sys, json
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '/tmp/kl4'
SAMPLES = int(argv[1]) if len(argv) > 1 else 384
HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, 'Antonio-Thin.ttf')  # static wght=100 cut of the bundled Antonio
BL = os.path.dirname(bpy.app.binary_path)
HDRI = os.path.join(BL, '%d.%d' % bpy.app.version[:2], 'datafiles', 'studiolights', 'world', 'interior.exr')
os.makedirs(OUT, exist_ok=True)

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
s.cycles.film_transparent_glass = True
s.render.image_settings.file_format = 'PNG'
s.render.image_settings.color_mode = 'RGBA'
s.render.image_settings.color_depth = '16'
s.view_settings.view_transform = 'AgX'
s.view_settings.look = 'AgX - Medium High Contrast'
w = bpy.data.worlds.new('w')
s.world = w
w.use_nodes = True
env = w.node_tree.nodes.new('ShaderNodeTexEnvironment')
env.image = bpy.data.images.load(HDRI)
w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.5
w.node_tree.links.new(env.outputs['Color'], w.node_tree.nodes['Background'].inputs['Color'])


def mat(name, color, metal=0.0, rough=0.5, trans=0.0, ior=1.47):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    b.inputs['Transmission Weight'].default_value = trans
    b.inputs['IOR'].default_value = ior
    return m


def link(o, m=None):
    s.collection.objects.link(o)
    if m:
        o.data.materials.append(m)
    return o


def stadium(hw, hh, r, n=24):
    """Rounded-rectangle outline (half width, half height, corner radius), counter-clockwise."""
    pts = []
    for cx, cy, a0 in ((hw - r, hh - r, 0), (-(hw - r), hh - r, 90), (-(hw - r), -(hh - r), 180), (hw - r, -(hh - r), 270)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def can(name, hw, hh, r, z0, z1, dome, m):
    """Glass can: rounded-rect walls from z0 to z1, closed by a shallow dome toward the camera."""
    bm = bmesh.new()
    ring = stadium(hw, hh, r)
    rings = []
    for z, sc in [(z0, 1.0), (z1, 1.0)] + [(z1 + dome * math.sin(math.radians(t)), math.cos(math.radians(t))) for t in (20, 40, 60, 75, 88)]:
        rings.append([bm.verts.new((x * sc, y * sc, z)) for x, y in ring])
    for i in range(len(rings) - 1):
        n = len(ring)
        for k in range(n):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % n], rings[i + 1][(k + 1) % n], rings[i + 1][k]))
    bm.faces.new(rings[-1])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for f in me.polygons:
        f.use_smooth = True
    o = link(bpy.data.objects.new(name, me), m)
    so = o.modifiers.new('solid', 'SOLIDIFY')
    so.thickness = 0.09
    so.offset = -1
    return o


HW, HH, R = 0.95, 1.45, 0.62
glass = mat('glass', (1.0, 0.97, 0.92), rough=0.02, trans=1.0)
anode = mat('anode', (0.16, 0.15, 0.14), metal=1, rough=0.5)
cathm = mat('cathode', (0.09, 0.08, 0.07), metal=1, rough=0.65)
mica = mat('mica', (0.55, 0.52, 0.48), metal=1, rough=0.35)
inside = mat('inside', (0.012, 0.010, 0.009), rough=0.8)
env_o = can('envelope', HW, HH, R, -1.2, 0.35, 0.18, glass)
# square mesh just under the glass
bm = bmesh.new()
pitch = 0.058
nx, ny = int(2 * HW / pitch) + 2, int(2 * HH / pitch) + 2
vs = [[bm.verts.new((-HW + i * pitch, -HH + j * pitch, 0.22)) for j in range(ny)] for i in range(nx)]
for i in range(nx - 1):
    for j in range(ny - 1):
        bm.faces.new((vs[i][j], vs[i + 1][j], vs[i + 1][j + 1], vs[i][j + 1]))
me = bpy.data.meshes.new('mesh')
bm.to_mesh(me)
bm.free()
mesh_o = link(bpy.data.objects.new('mesh', me), anode)
wf = mesh_o.modifiers.new('wf', 'WIREFRAME')
wf.thickness = 0.0055
# clip the mesh to the window
cl = link(bpy.data.objects.new('clip', bpy.data.meshes.new('clip')))
bmc = bmesh.new()
top = [bmc.verts.new((x * 0.93, y * 0.95, 0.4)) for x, y in stadium(HW, HH, R)]
bot = [bmc.verts.new((x * 0.93, y * 0.95, 0.0)) for x, y in stadium(HW, HH, R)]
bmc.faces.new(top)
bmc.faces.new(list(reversed(bot)))
for k in range(len(top)):
    bmc.faces.new((bot[k], bot[(k + 1) % len(top)], top[(k + 1) % len(top)], top[k]))
bmc.to_mesh(cl.data)
bmc.free()
cl.hide_render = True
bo = mesh_o.modifiers.new('clip', 'BOOLEAN')
bo.operation = 'INTERSECT'
bo.object = cl
# cathodes, front to back (IN-12 order), and the dark interior behind them
order = '3890145276'
FS = 3.75
cath = []
for k, ch in enumerate(order):
    cu = bpy.data.curves.new('d' + ch, 'FONT')
    cu.body = ch
    cu.font = bpy.data.fonts.load(FONT)
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.size = FS
    cu.extrude = 0.004
    o = link(bpy.data.objects.new('d' + ch, cu), cathm)
    o.location = (0, 0.0, 0.12 - k * 0.06)
    cath.append(o)
back = link(bpy.data.objects.new('back', bpy.data.meshes.new('back')), inside)
bmb = bmesh.new()
bmb.faces.new([bmb.verts.new((x, y, -0.6)) for x, y in stadium(HW, HH, R)])
bmb.to_mesh(back.data)
bmb.free()
# panel escutcheon: a dark rounded-rect ring the tube sits through
esc = link(bpy.data.objects.new('esc', bpy.data.meshes.new('esc')), mat('esc', (0.018, 0.017, 0.016), metal=0.5, rough=0.32))
bme = bmesh.new()
outer = [bme.verts.new((x, y, -0.95)) for x, y in stadium(HW + 0.16, HH + 0.16, R + 0.16)]
inner = [bme.verts.new((x, y, -0.95)) for x, y in stadium(HW + 0.01, HH + 0.01, R + 0.01)]
n = len(outer)
for k in range(n):
    bme.faces.new((outer[k], outer[(k + 1) % n], inner[(k + 1) % n], inner[k]))
bme.to_mesh(esc.data)
bme.free()
sv = esc.modifiers.new('s', 'SOLIDIFY')
sv.thickness = 0.12
bvv = esc.modifiers.new('b', 'BEVEL')
bvv.width = 0.035
bvv.segments = 4
for f in esc.data.polygons:
    f.use_smooth = True
clips = []
for y in (HH - 0.22, -(HH - 0.22)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.07, location=(0, y, 0.18))
    c = bpy.context.active_object
    c.data.materials.append(mica)
    bpy.ops.object.shade_smooth()
    clips.append(c)
bpy.context.view_layer.update()
ref = cath[order.index('8')]
ys = [(ref.matrix_world @ Vector(c)).y for c in ref.bound_box]
dy = -(max(ys) + min(ys)) / 2
for o in cath:
    o.location.y += dy
bpy.context.view_layer.update()
ys = [(ref.matrix_world @ Vector(c)).y for c in ref.bound_box]
for nm, loc, pw, sz, col in (('key', (-4, 5, 8), 260, 4, (1, 0.9, 0.8)), ('rim', (5, -4, 3), 160, 3, (1, 0.85, 0.7))):
    ld = bpy.data.lights.new(nm, 'AREA')
    ld.energy, ld.size, ld.color = pw, sz, col
    lo = link(bpy.data.objects.new(nm, ld))
    lo.location = loc
    lo.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
cd = bpy.data.cameras.new('cam')
cd.type = 'ORTHO'
SC = 3.3
cd.ortho_scale = SC
c = link(bpy.data.objects.new('cam', cd))
c.location = (0, 0, 20)
s.camera = c
s.render.resolution_x, s.render.resolution_y = 240, 330
for layer, show in (('back', cath + clips + [back, esc]), ('front', [env_o, mesh_o])):
    for o in s.objects:
        if o.type in ('MESH', 'FONT'):
            o.hide_render = o not in show or o is cl
    s.render.filepath = os.path.join(OUT, 'in12-%s.png' % layer)
    bpy.ops.render.render(write_still=True)
json.dump({'w': 240, 'h': 330, 'units_h': SC, 'digit_h_units': max(ys) - min(ys), 'digit_cy_units': (max(ys) + min(ys)) / 2, 'font_size_units': FS, 'baseline_shift_units': dy,
           'hw': HW, 'hh': HH}, open(os.path.join(OUT, 'in12.json'), 'w'), indent=1)
print('DONE')
