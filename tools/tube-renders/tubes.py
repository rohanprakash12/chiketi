# The IN-13 bargraph tube for the Tubes look, rendered in Blender (Cycles). (The Nixie
# clock tubes are IN-12s, in12.py.)
# Each part is rendered as two transparent PNG layers:
#   <part>-back.png   everything behind the glow (cathodes, back mesh, mica, socket, getter)
#   <part>-front.png  everything in front of the glow (glass envelope, front mesh)
# The page stacks back -> live glow (today's code) -> front, so the glow sits inside the glass.
# Run: blender -b -P tubes.py -- <outdir> [samples]
import bpy, bmesh, math, json, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '/tmp/kl4'
SAMPLES = int(argv[1]) if len(argv) > 1 else 384
os.makedirs(OUT, exist_ok=True)
BL = os.path.dirname(bpy.app.binary_path)
HDRI = os.path.join(BL, '%d.%d' % bpy.app.version[:2], 'datafiles', 'studiolights', 'world', 'interior.exr')


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
    s.cycles.max_bounces = 16
    s.cycles.transmission_bounces = 16
    s.cycles.glossy_bounces = 8
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
    nt = w.node_tree
    env = nt.nodes.new('ShaderNodeTexEnvironment')
    env.image = bpy.data.images.load(HDRI)
    bg = nt.nodes['Background']
    bg.inputs['Strength'].default_value = 0.35
    nt.links.new(env.outputs['Color'], bg.inputs['Color'])
    return s


def mat(name, color=(0.8, 0.8, 0.8), metal=0.0, rough=0.5, trans=0.0, ior=1.45, alpha=1.0, emit=None, coat=0.0, aniso=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    b.inputs['Transmission Weight'].default_value = trans
    b.inputs['IOR'].default_value = ior
    b.inputs['Alpha'].default_value = alpha
    b.inputs['Coat Weight'].default_value = coat
    b.inputs['Anisotropic'].default_value = aniso
    if emit:
        b.inputs['Emission Color'].default_value = (*emit[0], 1)
        b.inputs['Emission Strength'].default_value = emit[1]
    return m


def obj(name, me, m=None, smooth=True):
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    if m:
        o.data.materials.append(m)
    if smooth and hasattr(me, 'polygons'):
        for f in me.polygons:
            f.use_smooth = True
    return o


def lathe(name, prof, seg=96, axis='Z'):
    """Revolve (r, z) profile points around Z into a mesh."""
    bm = bmesh.new()
    rings = []
    for r, z in prof:
        ring = []
        for k in range(seg):
            a = 2 * math.pi * k / seg
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(seg):
            a, b = rings[i][k], rings[i][(k + 1) % seg]
            c, d = rings[i + 1][(k + 1) % seg], rings[i + 1][k]
            bm.faces.new((a, b, c, d))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def cyl(name, r, z0, z1, m, seg=64):
    return obj(name, lathe(name, [(0.0001, z0), (r, z0), (r, z1), (0.0001, z1)], seg), m)


def hexmesh(name, r, th0, th1, z0, z1, cell):
    """Hexagonal wire mesh on a cylinder of radius r between angles th0..th1 (0 = facing camera, -Y)."""
    bm = bmesh.new()
    w = math.sqrt(3) * cell
    u0, u1 = th0 * r, th1 * r
    row = 0
    z = z0
    while z < z1:
        off = (w / 2) if row % 2 else 0
        u = u0 + off
        while u < u1:
            vs = []
            for k in range(6):
                a = math.pi / 6 + k * math.pi / 3
                uu, zz = u + cell * math.cos(a), z + cell * math.sin(a)
                th = uu / r
                vs.append(bm.verts.new((r * math.sin(th), -r * math.cos(th), zz)))
            bm.faces.new(vs)
            u += w
        z += 1.5 * cell
        row += 1
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=cell * 0.02)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = obj(name, me, None, smooth=False)
    wf = o.modifiers.new('wf', 'WIREFRAME')
    wf.thickness = cell * 0.09
    wf.use_even_offset = True
    return o


def camera(cx, cz, scale, rx, ry):
    s = bpy.context.scene
    cd = bpy.data.cameras.new('cam')
    cd.type = 'ORTHO'
    cd.ortho_scale = scale
    c = bpy.data.objects.new('cam', cd)
    s.collection.objects.link(c)
    c.location = (cx, -40, cz)
    c.rotation_euler = (math.radians(90), 0, 0)
    s.camera = c
    s.render.resolution_x, s.render.resolution_y = rx, ry
    s.render.resolution_percentage = 100


def light(name, loc, power, size, color=(1, 0.92, 0.82), target=(0, 0, 1.5)):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.energy = power
    ld.size = size
    ld.color = color
    lo = bpy.data.objects.new(name, ld)
    bpy.context.scene.collection.objects.link(lo)
    lo.location = loc
    d = Vector(target) - Vector(loc)
    lo.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def render_layers(part, front, back):
    s = bpy.context.scene
    for layer, show in (('back', back), ('front', front)):
        for o in s.objects:
            if o.type == 'MESH' or o.type == 'FONT' or o.type == 'CURVE':
                o.hide_render = o not in show
        s.render.filepath = os.path.join(OUT, '%s-%s.png' % (part, layer))
        bpy.ops.render.render(write_still=True)


GLASS = dict(color=(1.0, 0.975, 0.94), rough=0.025, trans=1.0, ior=1.47)
meta = {}

# ----------------------------------------------------------------- IN-13 bargraph
reset()
glass = mat('glass', **GLASS)
nickel = mat('nickel', (0.62, 0.58, 0.52), metal=1, rough=0.35)
anode = mat('anode', (0.10, 0.095, 0.09), metal=1, rough=0.6)
mica = mat('mica', (0.30, 0.28, 0.25), rough=0.6, trans=0.15)
getter = mat('getter', (0.30, 0.29, 0.30), metal=1, rough=0.3)
tin = mat('tin', (0.75, 0.74, 0.72), metal=1, rough=0.25)
L, R = 10.0, 0.38
prof = [(0.0001, -0.05), (0.18, -0.04), (0.30, 0.05), (0.36, 0.22), (R, 0.45), (R, L - 0.35), (0.35, L - 0.12),
        (0.27, L + 0.02), (0.15, L + 0.08), (0.06, L + 0.11), (0.05, L + 0.22), (0.0001, L + 0.24)]
env = obj('envelope', lathe('envelope', prof, 96), glass)
so = env.modifiers.new('solid', 'SOLIDIFY')
so.thickness = 0.022
so.offset = -1
inner = []
# anode ribbon behind the cathode, cathode wire, auxiliary cathode, mica spacers, getter flash, leads
rib = bpy.data.meshes.new('rib')
bm = bmesh.new()
v = [bm.verts.new(p) for p in [(-0.12, 0.10, 0.7), (0.12, 0.10, 0.7), (0.12, 0.10, L - 0.6), (-0.12, 0.10, L - 0.6)]]
bm.faces.new(v)
bm.to_mesh(rib)
bm.free()
ro = obj('ribbon', rib, anode, smooth=False)
ro.modifiers.new('s', 'SOLIDIFY').thickness = 0.01
inner.append(ro)
inner.append(cyl('cathode', 0.010, 0.6, L - 0.5, nickel, 12))
aux = cyl('aux', 0.05, 0.62, 0.95, nickel, 24)
aux.location = (0, 0.02, 0)
inner.append(aux)
inner += [cyl('micaA', 0.34, 0.55, 0.57, mica), cyl('micaB', 0.34, L - 0.55, L - 0.53, mica)]
gm = lathe('getter', [(R - 0.03, L - 0.40), (R - 0.03, L - 0.95)], 96)
bm = bmesh.new()
bm.from_mesh(gm)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < 0.05], context='VERTS')  # flash on the back wall only
bm.to_mesh(gm)
bm.free()
go = obj('getter', gm, getter)
inner.append(go)
for k, dx in enumerate((-0.12, 0, 0.12)):
    w = cyl('lead%d' % k, 0.012, -1.1, 0.0, tin, 12)
    w.location = (dx, 0, 0)
    inner.append(w)
grp = [env] + inner
for o in grp:
    o.rotation_euler = (0, math.radians(90), 0)   # lay the tube along X (left = lead end)
    o.location = (o.location.z - L / 2, o.location.y, o.location.x)
light('key', (-3, -8, 6), 900, 6, target=(0, 0, 0))
light('rim', (4, 6, 3), 700, 4, (1, 0.85, 0.7), target=(0, 0, 0))
light('fill', (0, -9, -3), 120, 8, (0.85, 0.9, 1), target=(0, 0, 0))
SC = 12.6
camera(0.1, 0, SC, 1400, 140)
ppu = 1400 / SC
meta['in13'] = {'w': 1400, 'h': 140, 'px_per_unit': ppu, 'left_x': 0.1 - SC / 2,
                'glow_x0_units': 0.6 - L / 2, 'glow_x1_units': L - 0.6 - L / 2, 'axis_z': 0}
render_layers('in13', front=[env], back=inner)

json.dump(meta, open(os.path.join(OUT, 'meta.json'), 'w'), indent=1)
print('DONE', OUT)
