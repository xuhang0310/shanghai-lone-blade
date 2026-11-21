"""Shen Guhong's portrait, pomaded side part and hand-blocked fedora.

Construction coordinates match the rest mesh used by build_hero.Character.
The front of the head uses a dedicated portrait UV, with the original atlas on the neck.
"""
from math import atan2, cos, exp, pi, sin, sqrt

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def _gauss(value, width):
    return exp(-((value / width) ** 2))


def _smooth(start, end, value):
    t = min(1.0, max(0.0, (value - start) / (end - start)))
    return t * t * (3.0 - 2.0 * t)


def _portrait_atlas(ctx):
    """Project the front of the head to a contiguous portrait UV for close shots."""
    mesh = ctx.body.data
    skin = mesh.materials[0]
    texture_node = next(n for n in skin.node_tree.nodes if n.type == 'TEX_IMAGE')
    source = texture_node.image
    sw, sh = source.size
    source_pixels = np.empty(sw * sh * 4, np.float32)
    source.pixels.foreach_get(source_pixels)
    source_pixels.shape = (sh, sw, 4)

    width, height = 640, 640
    pos = np.array(ctx.positions)
    uv = mesh.uv_layers.active.data
    coords = np.column_stack(((pos[:, 0] + .115) / .23, (pos[:, 1] - .71) / .32))
    grid = coords * [width, height]
    atlas = np.empty((height, width, 4), np.float32)
    atlas[:] = (.57, .315, .23, 1)
    depth = np.full((height, width), -9.0)
    skin_polys = [p for p in mesh.polygons if p.material_index == 0
                  and min(pos[i, 1] for i in p.vertices) > .71
                  and min(pos[i, 2] for i in p.vertices) > .102]
    for poly in skin_polys:
        indices = list(poly.vertices)
        p = pos[indices]
        a, b, c = grid[indices]
        lo = np.maximum(0, np.floor(np.minimum(np.minimum(a, b), c))).astype(int)
        hi = np.minimum([width, height], np.ceil(np.maximum(np.maximum(a, b), c))).astype(int)
        yy, xx = np.mgrid[lo[1]:hi[1], lo[0]:hi[0]]
        e, f = b - a, c - a
        det = e[0] * f[1] - f[0] * e[1]
        if abs(det) < 1e-7 or not xx.size:
            continue
        dx, dy = xx + .5 - a[0], yy + .5 - a[1]
        s = (dx * f[1] - dy * f[0]) / det
        t = (dy * e[0] - dx * e[1]) / det
        z = p[0, 2] + s * (p[1, 2] - p[0, 2]) + t * (p[2, 2] - p[0, 2])
        visible = (s >= 0) & (t >= 0) & (s + t <= 1) & (z >= depth[yy, xx])
        if not visible.any():
            continue
        uy, ux = yy[visible], xx[visible]
        depth[uy, ux] = z[visible]
        ta, tb, tc = np.array([tuple(uv[k].uv) for k in poly.loop_indices])
        sample_uv = ta + s[visible, None] * (tb - ta) + t[visible, None] * (tc - ta)
        pixels = np.clip(sample_uv * [sw, sh] - .5, [0, 0], [sw-1.001, sh-1.001])
        i, j = pixels.astype(int).T
        fx, fy = (pixels - pixels.astype(int)).T
        top = source_pixels[j, i] * (1 - fx[:, None]) + source_pixels[j, i+1] * fx[:, None]
        bottom = source_pixels[j+1, i] * (1 - fx[:, None]) + source_pixels[j+1, i+1] * fx[:, None]
        atlas[uy, ux] = top * (1 - fy[:, None]) + bottom * fy[:, None]

    yy, xx = np.mgrid[:height, :width]
    x, y = (xx + .5) / width * .23 - .115, (yy + .5) / height * .32 + .71
    center = x + .002
    half = abs(center)
    rgb = atlas[:, :, :3]

    def ease(low, high, v):
        w = np.clip((v - low) / (high - low), 0, 1)
        return w * w * (3 - 2 * w)

    def paint(color, mask):
        rgb[:] = rgb * (1 - mask[..., None]) + color * mask[..., None]

    def bell(v, spread):
        return np.exp(-((v / spread) ** 2))

    # Remove the original atlas' horseshoe moustache. Preserve skin outside
    # the shaving area, including the cool beard tint already on the jaw.
    shave = (1 - ease(.050, .063, half)) * ease(.752, .771, y) * (1 - ease(.822, .833, y))
    skin_ref = rgb[(half > .050) & (half < .062) & (y > .834) & (y < .847) & (depth > .13)]
    tone = np.median(skin_ref, axis=0)
    grain = np.mod(np.sin(xx * 17.13 + yy * 61.07) * 43177.8, 1) - .5
    shave_color = tone * (1 + .024 * grain[..., None])
    shave_color *= (1 - .065 * ease(.826, .755, y))[..., None]
    paint(shave_color, shave)

    # A defined but quiet mouth with a bow in the upper lip, a warm lower lip,
    # and a tapered pencil moustache that follows the upper lip.
    lip_center = .8008 + .0013 * bell(half - .010, .009) - .0016 * (half / .038) ** 2
    lips = 1 - ease(.027, .041, half)
    upper = lip_center + .0036 + .0013 * bell(half - .008, .005)
    paint(tone * [.68, .52, .49], .66 * lips * bell(y - upper, .0033))
    paint(tone * [.80, .63, .59], .66 * lips * bell(y - lip_center + .0028, .0037))
    paint(tone * [.36, .25, .26], .74 * lips * bell(y - lip_center, .00095))
    paint(tone * [.9, .73, .67], .25 * lips * bell(y - lip_center + .004, .0018))
    philtrum = .15 * bell(half - .005, .002) * bell(y - .814, .007)
    paint(tone * [.55, .46, .42], philtrum)
    mustache_curve = .8145 - .005 * (half / .038) ** 1.75 + .0008 * bell(half - .013, .009)
    span = (1 - ease(.022, .041, half)) * (.35 + .65 * ease(.0005, .006, half))
    strand = .63 + .036 * np.sin(1930 * center + (y - .81) * 620) + .13 * grain
    hair = bell(y - mustache_curve, .0032 - .0008 * ease(.022, .041, half)) * span * strand
    paint(tone * [.22, .20, .19], hair)
    nostrils = bell(half - .013, .005) * bell(y - .8295 - .0015 * (half / .014), .0027)
    paint(tone * [.30, .24, .23], .68 * nostrils)
    alar = bell(half - .022, .0038) * bell(y - .836, .0051)
    paint(tone * [.56, .50, .46], .38 * alar)
    # Refresh the irises and the upper eyelid in the original orbital openings.
    # Small differences between the eyes follow the source head's asymmetry.
    for cx, cy in [(-.0407, .8797), (.0384, .8775)]:
        dx = x - cx
        side = 1 if cx > 0 else -1
        eyelid = cy + .067 * side * dx
        dy = y - eyelid
        envelope = np.maximum(0, 1 - (dx / .0145) ** 2) ** .72
        opening = (1 - ease(.0135, .0152, abs(dx))) * (1 - ease(.0002, .0016, abs(dy - .0003) - .0052 * envelope))
        orbit = ease(.0048, .010, abs(dy)) * bell(dx, .016) * bell(dy, .010)
        paint(tone * [.92, .80, .76], .22 * orbit)
        sclera = tone * [.88, 1.22, 1.34] * (1 - .16 * ease(.004, .015, abs(dx)))[..., None]
        paint(sclera, opening * .93)
        radius = np.sqrt((dx + .00015) ** 2 + (dy - .0005) ** 2)
        iris = (1 - ease(.0051, .0062, radius)) * opening
        iris_color = np.array([.064, .037, .021]) + (.012 * np.cos(12 * np.arctan2(dy, dx)))[..., None]
        paint(iris_color, iris)
        paint(np.array([.018, .012, .009]), (1 - ease(.0020, .0028, radius)) * opening)
        glint = np.exp(-((dx + .00155) / .00085) ** 2 - ((dy - .00145) / .00075) ** 2)
        paint(np.array([.80, .75, .65]), .84 * glint * opening)
        lash = bell(dy - .0054 * envelope, .00135) * (1 - ease(.0122, .0154, abs(dx)))
        paint(tone * [.22, .19, .18], .78 * lash)
        fold = bell(dy - (.0078 * envelope + .0016), .0011) * (1 - ease(.011, .016, abs(dx)))
        paint(tone * [.54, .42, .39], .48 * fold)

    # Texture filtering needs a few texels beyond the new UV island edges.
    covered = depth > -8
    for _ in range(5):
        old = covered.copy()
        for axis, shift in [(0, 1), (0, -1), (1, 1), (1, -1)]:
            grow = ~covered & np.roll(old, shift, axis)
            atlas[grow] = np.roll(atlas, shift, axis)[grow]
            covered |= grow
    portrait = bpy.data.images.new('Shen • painted portrait', width, height, alpha=False)
    portrait.pixels.foreach_set(np.clip(atlas, 0, 1).ravel())
    portrait.update()
    portrait.pack()
    face_material = skin.copy()
    face_material.name = 'Portrait • Shen Guhong'
    next(n for n in face_material.node_tree.nodes if n.type == 'TEX_IMAGE').image = portrait
    slot = len(mesh.materials)
    mesh.materials.append(face_material)
    for poly in skin_polys:
        poly.material_index = slot
        for i in poly.loop_indices:
            uv[i].uv = coords[mesh.loops[i].vertex_index]


def _sculpt(ctx):
    mesh = ctx.body.data
    for i, (x, y, z) in enumerate(ctx.positions):
        if y < .725 or ctx.weights[i].get('Head', 0) < .35:
            continue
        center_x = x + .0035
        width = abs(center_x)
        side = 1 if center_x >= 0 else -1
        face = _smooth(.08, .158, z)
        cheek = _gauss(width - .06, .025) * _gauss(y - .866, .025)
        hollow = _gauss(width - .063, .025) * _gauss(y - .827, .021)
        brow = _gauss(width - .04, .029) * _gauss(y - .908, .012)
        jaw = _gauss(y - .789, .035) * _smooth(.025, .068, width)
        chin = _gauss(width, .046) * _gauss(y - .771, .019)
        bridge = _gauss(width, .014) * _gauss(y - .873, .041)
        tip = _gauss(width, .018) * _gauss(y - .838, .013)
        x += side * ((cheek * .004 - hollow * .003) * face + jaw * .004)
        y += face * (.003 * cheek + .004 * brow - .004 * chin + .002 * tip)
        z += face * (.005 * cheek - .004 * hollow + .005 * brow
                     + .007 * bridge + .005 * chin - .0025 * tip)
        mesh.vertices[i].co = (x, -z, y)
    mesh.update()


class _Surface:
    def __init__(self):
        self.points, self.faces, self.material_ids = [], [], []

    def point(self, p):
        self.points.append(tuple(p))
        return len(self.points) - 1

    def face(self, vertices, material):
        self.faces.append(tuple(vertices))
        self.material_ids.append(material)

    def strip(self, low, high, material):
        for i in range(len(low)):
            j = (i + 1) % len(low)
            self.face((low[i], low[j], high[j], high[i]), material)

    def finish(self, ctx, name, materials):
        return ctx.mesh(name, self.points, self.faces,
                        [{'Head': 1.0}] * len(self.points), self.material_ids, materials)


def _hair(ctx):
    # Cast rays on the sculpt itself. This keeps the hairline and tapered nape
    # against the actual cranium, including its slight natural asymmetry.
    source = ctx.body.data
    positions = [(v.co.x, v.co.z, -v.co.y) for v in source.vertices]
    faces = [tuple(p.vertices) for p in source.polygons if p.center.z > .717]
    tree = BVHTree.FromPolygons(positions, faces, all_triangles=True)
    scalp = Vector((-.003, .887, .073))
    surf = _Surface()
    count, tiers = 112, 31
    prev = []
    for j in range(tiers):
        t = j / tiers
        row = []
        for i in range(count):
            theta = 2 * pi * i / count
            sx, cz = sin(theta), cos(theta)
            # The front is brushed off the forehead, with short, tapered temples.
            # In profile the swept section clears the ear before dipping at the nape.
            temple = _gauss(cz - .51, .15)
            base_height = .779 + .153 * _smooth(-.95, .88, cz) + .022 * abs(sx) ** 3
            base_height -= .035 * temple
            base_height += .010 * _gauss(cz - .78, .17) + .004 * sx
            edge_lat = atan2(base_height - scalp.y, sqrt((.096 * sx) ** 2 + (.122 * cz) ** 2))
            lat = edge_lat + (.5 * pi - edge_lat) * t
            ray = Vector((sx * cos(lat), sin(lat), cz * cos(lat))).normalized()
            point, _, _, _ = tree.ray_cast(scalp + ray * .38, -ray, .62)
            if point is None:
                raise ValueError('Open cranium encountered while fitting the hair mesh')
            # Parallel waves turn over the left temple into the diagonal part.
            wave = .5 + .5 * cos(25 * theta + 5.5 * t + 2 * sin(theta - 1.6 * t))
            part = _gauss(atan2(sin(theta - .65 - 1.0 * t), cos(theta - .65 - 1.0 * t)), .095)
            thickness = (.0045 + .0045 * cos(theta * .5) ** 2 + .002 * wave ** 3
                         + .009 * _gauss(t - .40, .27) * max(0, cz) - .003 * part)
            thickness *= .14 + .86 * _smooth(0, .115, t)
            thickness *= .65 + .35 * (1 - t)
            row.append(surf.point(point + ray * thickness))
        if prev:
            surf.strip(prev, row, 0)
        prev = row
    top = surf.point((scalp.x, max(p[1] for p in surf.points) + .0003, scalp.z))
    for i in range(count):
        surf.face((prev[i], prev[(i + 1) % count], top), 0)
    surf.finish(ctx, 'HeroHair_SidePart', [ctx.mat('Pomade • black chestnut', '#302823', .43)])


def _fedora(ctx, shanghai_block=False):
    # Felt, ribbon and edge binding share a mesh so the hat can detach as a unit.
    materials = [
        ctx.mat('Felt • tobacco', '#675548', .89),
        ctx.mat('Underbrim • umber', '#4c3e35', .91),
        ctx.mat('Binding • brushed grosgrain', '#58483e', .67),
        ctx.mat('Ribbon • oxblood', '#4b3230', .57),
        ctx.mat('Ribbon edge • wine', '#62443e', .63),
    ]
    surf = _Surface()
    count = 72
    angles = [2 * pi * i / count for i in range(count)]
    ax, az = .111, .136

    def place(x, h, z):
        # A rakish set over one brow keeps the eyes visible in three-quarter view.
        return (x - .003 + h * .035, .935 + h - .058 * z - .065 * x, .071 + z)

    def brim(theta, u, dy):
        sx, cz = sin(theta), cos(theta)
        x = (ax + (.053 - .005 * cz) * u) * sx
        z = (az + (.058 + .010 * cz) * u) * cz
        # Snapped down over the eyes, turned up and bound around the nape.
        shape = .007 + .021 * sx * sx - .029 * max(0, cz) ** 2 + .024 * max(0, -cz) ** 2
        if shanghai_block:
            # A worn snap brim dips off centre and curls up by the temples.
            shape += .009 * sx * sx + .006 * sx - .007 * max(0, cz) ** 3
            x += .005 * sx * u
        h = shape * u ** 1.65 - .006 * sin(pi * u) + .005 * sx * u + dy
        return place(x, h, z)

    def crown(theta, u, extra=0):
        sx, cz = sin(theta), cos(theta)
        pinch = _gauss(abs(atan2(sx, cz)) - .66, .32) * _smooth(.17, .85, u)
        roll = .010 * sin(pi * u) - .141 * u ** 1.35
        x = (ax * (1 + roll) - .016 * pinch + extra) * sx
        height = u * (.121 - .006 * cz - .006 * sx * cz)
        z = (az * (1 + roll) - .007 * pinch + extra) * cz - .006 * u
        if shanghai_block:
            # Depress the front quarters below the ridge. Preserving the lip of
            # the crown makes each thumb-dent catch light separately.
            angle = atan2(sx, cz)
            hollow = _gauss(abs(angle + .055) - .71, .34) * _gauss(u - .72, .25)
            x -= sx * .021 * hollow
            z -= cz * .011 * hollow
            height += u*u * (.009 * cz - .015 * max(0, -cz) - .004 * sx)
        return x, height, z

    prev = []
    for u, dy, material in [(.0, -.004, 1), (.40, -.0045, 1), (.79, -.004, 1),
                            (.96, -.0033, 1), (1, -.0017, 2), (1, .0002, 2),
                            (.978, .0013, 2), (.951, .0004, 2), (.82, .0, 0),
                            (.50, .0, 0), (.18, .0, 0), (.0, .0, 0)]:
        row = [surf.point(brim(theta, u, dy)) for theta in angles]
        if prev:
            surf.strip(prev, row, material)
        prev = row
    crown_levels = [.025, .075, .21, .40, .55, .65, .74, .83, .91, .96, 1] if shanghai_block else [.025, .075, .21, .4, .61, .80, .94, 1]
    for u in crown_levels:
        row = [surf.point(place(*crown(theta, u))) for theta in angles]
        surf.strip(prev, row, 0)
        prev = row
    # A blocked, recessed teardrop. The soft break in the crown rolls into
    # two asymmetric front pinches, visible even from the default rear camera.
    for s in [.965, .88, .77, .62, .44, .24, .10]:
        row = []
        for theta in angles:
            x, h, z = crown(theta, 1)
            x = x * s
            z = z * s - .006 * (1 - s)
            ridge = .0046 * _gauss(s - .91, .08)
            dent = .023 * _gauss(x + .004, .035) * _gauss(z + .006, .098)
            h += ridge - dent * _smooth(0, .18, 1 - s)
            row.append(surf.point(place(x, h, z)))
        surf.strip(prev, row, 0)
        prev = row
    top = surf.point(place(0, .098, -.006))
    for i in range(count):
        surf.face((prev[i], prev[(i + 1) % count], top), 0)

    prev = []
    for u, off, material in [(.041, .0006, 3), (.053, .002, 4), (.073, .0021, 4),
                             (.12, .0018, 3), (.30, .0019, 3), (.32, .0022, 4),
                             (.332, .0015, 4), (.335, .0005, 4)]:
        row = [surf.point(place(*crown(theta, u, off))) for theta in angles]
        if prev:
            surf.strip(prev, row, material)
        prev = row

    # Folded ribbon bow, forward and rear wings gathered into a short keeper.
    anchor = 1.74
    for start, stop, keeper in [(-.32, -.028, False), (.035, .39, False), (-.04, .047, True)]:
        prev = []
        for t in [0, .06, .29, .54, .78, .96, 1]:
            angle = anchor + start + (stop - start) * t
            to_center = 1 - min(1, abs(angle - anchor) / .34)
            height = .23 if keeper else .27 - .12 * to_center
            row = []
            for k in range(7):
                side = k / 6
                u = .195 + (side - .5) * height
                off = .0055 + .0032 * sin(pi * side) * sin(pi * t)
                off += .0025 * cos(side * 3 * pi) * to_center
                if keeper:
                    off = .0105 + .0012 * sin(pi * t)
                row.append(surf.point(place(*crown(angle, u, off))))
            if prev:
                for k in range(6):
                    surf.face((prev[k], row[k], row[k + 1], prev[k + 1]), 3)
            prev = row
    mesh = surf.finish(ctx, 'HeroHat', materials).data
    _finish_felt(mesh, surf.points, materials)


def _finish_felt(mesh, points, materials):
    from PIL import Image
    from portrait_materials import packed_image, surface_maps

    uv = mesh.uv_layers.new(name='Felt grain')
    for polygon in mesh.polygons:
        coords = np.array([points[i] for i in polygon.vertices])
        x, h, z = coords.T
        # The brim is cut across a sheet; the crown and ribbon wrap around
        # the block. Each polygon crossing the ribbon seam unwraps locally.
        if abs(polygon.normal.z) > .76 and polygon.material_index < 3:
            tile = np.column_stack((x*4.6+.5,z*4.6+.2))
        else:
            around = np.arctan2(x+.003,z-.071)/(2*pi)+.5
            if np.ptp(around) > .5:
                around[around<.5] += 1
            tile = np.column_stack((around*4,(h-.92)*5.4))
        for loop, coord in zip(polygon.loop_indices,tile):
            uv.data[loop].uv = coord

    rng = np.random.default_rng(3456)
    n = 256
    y,x = np.mgrid[:n,:n]
    def grain(scale):
        data = rng.integers(0,256,(scale,scale),dtype=np.uint8)
        padded = Image.fromarray(np.tile(data,(3,3))).resize((3*n,3*n),Image.Resampling.BICUBIC)
        return np.asarray(padded.crop((n,n,2*n,2*n)),np.float32)/255-.5
    naps = grain(256)
    mottling = grain(5)*.65+grain(25)*.35
    felt = .19*naps+.17*grain(98)+.08*grain(36)
    cross = np.sin(2*pi*y/4) * (.67+.22*np.cos(2*pi*x/8))
    ribbon = .23*cross+.095*np.sin(2*pi*x/4)+.06*naps
    for name, slots, height, rough, strength in [
            ('Felt', [0,1], felt, .86+.12*mottling+.08*naps, .78),
            ('Grosgrain', [2,3,4], ribbon, .60+.06*cross+.08*mottling, .70)]:
        dy = (np.roll(height,-1,0)-np.roll(height,1,0))*.5
        dx = (np.roll(height,-1,1)-np.roll(height,1,1))*.5
        normal = np.stack((-dx,dy,np.ones_like(dx)),axis=2)
        normal /= np.linalg.norm(normal,axis=2,keepdims=True)
        orm = np.stack((np.ones_like(dx),rough,np.zeros_like(dx)),axis=2)
        relief = packed_image(name+' • relief',Image.fromarray(np.uint8((normal*.5+.5)*255)),True)
        response = packed_image(name+' • response',Image.fromarray(np.uint8(orm*255)),True)
        for slot in slots:
            surface_maps(materials[slot], relief, response, strength)
            # The felt keeps small areas of lighter worn nap; the bound edge
            # and ribbon have a subtly directional sheen and a denser weave.
            base = np.array([(52,50,48),(43,42,41),(63,59,55),(37,35,33),(55,51,47)][slot])
            variation = (mottling*23 + naps*9) if slot<2 else (cross*3 + mottling*9)
            texels = Image.fromarray(np.uint8(np.clip(base + variation[:,:,None],0,255)))
            mat = materials[slot]
            tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
            tex.image = packed_image(name+str(slot)+' • color',texels)
            bsdf = mat.node_tree.nodes.get('Principled BSDF')
            mat.node_tree.links.new(tex.outputs['Color'],bsdf.inputs['Base Color'])


def build_head(ctx):
    _portrait_atlas(ctx)
    _sculpt(ctx)
    _hair(ctx)
    _fedora(ctx)
