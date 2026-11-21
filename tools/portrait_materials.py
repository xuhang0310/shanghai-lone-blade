"""Bake the authored skin islands and facial surface maps for the two portraits."""
import tempfile
from pathlib import Path

import bpy
import numpy as np
from PIL import Image, ImageFilter


def packed_image(name, image, data=False, quality=94):
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / (name + ('.png' if image.mode == 'RGBA' else '.jpg'))
        image.save(path, **({'quality': quality, 'subsampling': 0} if path.suffix == '.jpg' else {}))
        result = bpy.data.images.load(str(path))
        result.name = name
        if data:
            result.colorspace_settings.name = 'Non-Color'
        result.pack()
    return result


def surface_maps(material, normal, roughness, strength):
    nodes = material.node_tree.nodes
    link = material.node_tree.links.new
    bsdf = nodes.get('Principled BSDF')
    bump = nodes.new('ShaderNodeNormalMap')
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = normal
    bump.inputs['Strength'].default_value = strength
    link(tex.outputs['Color'], bump.inputs['Color'])
    link(bump.outputs['Normal'], bsdf.inputs['Normal'])
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = roughness
    # glTF's green metallic-roughness channel stores perceptual roughness.
    separate = nodes.new('ShaderNodeSeparateColor')
    link(tex.outputs['Color'], separate.inputs['Color'])
    link(separate.outputs['Green'], bsdf.inputs['Roughness'])


def islands(faces):
    """Group the head, neck, inner lips and eyelids by connected UV indices."""
    parents = {}

    def root(i):
        parent = parents.setdefault(i, i)
        if parent != i:
            parents[i] = root(parent)
        return parents[i]

    for face in faces:
        key = root(face[0][1])
        for _, index in face[1:]:
            parents[root(index)] = key
    pieces = {}
    for face in faces:
        pieces.setdefault(root(face[0][1]), []).append(face)
    return pieces.values()


def repack(source, uvs, faces, points):
    # One rectangular crop across all UVs used to include nearly the entire
    # full-body sheet. Repack the five disconnected regions at source resolution.
    sw, sh = source.size
    pix = uvs * [sw, -sh] + [0, sh]
    patches = []
    for group in islands(faces):
        idx = np.unique([i for face in group for _, i in face])
        lo = np.maximum(0, np.floor(pix[idx].min(0)) - 5).astype(int)
        hi = np.minimum([sw, sh], np.ceil(pix[idx].max(0)) + 5).astype(int)
        patch = source.crop((*lo, *hi))
        local = pix[idx] - lo
        if patch.width < patch.height:
            local = np.column_stack((patch.height - local[:, 1], local[:, 0]))
            patch = patch.transpose(Image.Transpose.ROTATE_270)
        patches.append((patch, idx, local))
    atlas_width = max(max(p.width for p, _, _ in patches), 1450)
    packed = {}
    left = top = row_h = 0
    atlas_px = np.zeros_like(pix)
    for patch, idx, local in sorted(patches, key=lambda item: -item[0].height):
        if left + patch.width > atlas_width:
            left = 0
            top += row_h
            row_h = 0
        packed[left, top] = patch
        atlas_px[idx] = local + [left, top]
        left += patch.width
        row_h = max(row_h, patch.height)
    height = top + row_h
    image = Image.new('RGB', (atlas_width, height), '#b8977c')
    for offset, patch in packed.items():
        image.paste(patch, offset)
    xyz = np.zeros((height, atlas_width, 3), np.float32)
    for face in faces:
        for k in range(1, len(face) - 1):
            polygon = [face[0], face[k], face[k + 1]]
            a, b, c = atlas_px[[i for _, i in polygon]]
            lo = np.floor(np.minimum(np.minimum(a, b), c)).astype(int)
            hi = np.ceil(np.maximum(np.maximum(a, b), c)).astype(int)
            rows, cols = np.mgrid[lo[1]:hi[1], lo[0]:hi[0]]
            u, v = b - a, c - a
            det = u[0]*v[1] - v[0]*u[1]
            if abs(det) < .0001:
                continue
            dx, dy = cols+.5-a[0], rows+.5-a[1]
            s, t = (dx*v[1]-dy*v[0])/det, (dy*u[0]-dx*u[1])/det
            mask = (s >= 0) & (t >= 0) & (s+t <= 1)
            p, q, r = points[[i for i, _ in polygon]]
            xyz[rows[mask], cols[mask]] = p + s[mask,None]*(q-p) + t[mask,None]*(r-p)
    uv = (atlas_px - [0, height]) / [atlas_width, -height]
    return image, uv, xyz


def bake_skin(source, uvs, faces, points, male):
    image, uv, xyz = repack(source, uvs, faces, points)
    x, y, z = xyz.transpose(2, 0, 1)
    x = x + .007
    ax = np.abs(x)
    valid = y > .1
    front = np.clip((z-.065)/.095, 0, 1) * valid

    def bell(distance, width):
        return np.exp(-(distance/width)**2)

    def zone(cx, cy, wx, wy):
        return bell(ax-cx, wx) * bell(y-cy, wy) * front

    rng = np.random.default_rng(7401 if male else 328)
    def noise(scale):
        w, h = image.size
        data = rng.integers(0, 256, (max(3,h//scale),max(3,w//scale)), dtype=np.uint8)
        return np.asarray(Image.fromarray(data).resize((w,h),Image.Resampling.BICUBIC), np.float32)/255-.5

    fine, mottling = noise(2), noise(22) + .45*noise(7)
    eye = zone(.037, .861, .028, .013)
    cheeks = zone(.066, .842, .038, .031)
    nose = zone(0, .829, .025, .025)
    lips = zone(0, .779, .031, .011)
    forehead = zone(0, .931, .085, .034)
    temples = zone(.086, .883, .028, .051)
    colors = np.asarray(image, dtype=np.float32).copy()
    lum = np.asarray(image.convert('L'), dtype=np.float32)
    low = np.asarray(image.convert('L').filter(ImageFilter.GaussianBlur(4)), dtype=np.float32)
    photo_detail = np.clip(lum-low, -17, 17)
    # Restore the original photograph's cheek and temple detail. Weathering
    # varies regionally across the face rather than darkening the entire atlas.
    colors += photo_detail[...,None] * .31
    colors += mottling[...,None] * np.array([11, 7, 5]) * valid[...,None]
    colors += (cheeks + .8*nose)[...,None] * np.array([4, -4, -3])
    colors -= eye[...,None] * np.array([11, 13, 8]) * (.4 if male else 1.)
    colors += temples[...,None] * np.array([-8, -8, -6])
    colors *= np.array([.99,.99,.97]) if male else np.array([1.,.98,.97])
    if male:
        from shen_portrait import apply_complexion
        apply_complexion(colors, xyz, photo_detail)

    # Skin creases follow the orbital margin, mouth and brow. The relief and
    # melanin contributions are independent, so direct lighting still models them.
    smile = (.023+.36*np.maximum(0,.815-y)) + .007*np.sin(np.clip((.817-y)*53,0,2.5))
    fold = bell(ax-smile, .0020) * bell(y-.793,.026)
    lower_eye = bell(y-(.863-.004*(1-np.minimum(1,abs(ax-.040)/.022))),.0013)*bell(ax-.039,.019)
    furrows = np.zeros_like(x)
    for cy in (.918,.928,.937):
        line = cy+.004*(ax/.07)**2 + .0015*np.sin(x*90+cy*280)
        furrows += bell(y-line,.0011)*bell(x,.062)
    creases = np.minimum(1, (fold*.91 + lower_eye*.64 + furrows*.39)*front)
    creases *= np.clip(.8+.8*mottling,0,1) * (.42 if male else .53)
    colors -= creases[...,None] * np.array([21,20,18])
    pore = np.maximum(0, fine-.17)**1.3 * (1+.6*cheeks+.55*nose)
    relief = .019*photo_detail + .07*fine - .99*pore - 1.35*creases
    dy, dx = np.gradient(relief)
    normal = np.stack((-dx,dy,np.ones_like(dx)),axis=-1)
    normal /= np.linalg.norm(normal,axis=-1,keepdims=True)
    rough = .65 - .21*nose - .11*forehead - .17*lips - .08*cheeks + .055*mottling + .10*pore
    rough = np.clip(rough, .32, .86)
    orm = np.stack((np.ones_like(x),rough,np.zeros_like(x)),axis=-1)

    # Carry the authored maps across the geometric UV boundary for mip filtering.
    maps = [np.uint8(np.clip(colors,0,255)),np.uint8((normal*.5+.5)*255),np.uint8(orm*255)]
    for _ in range(4):
        before = valid.copy()
        for axis, shift in ((0,1),(0,-1),(1,1),(1,-1)):
            fill = ~valid & np.roll(before,shift,axis)
            for data in maps:
                data[fill] = np.roll(data,shift,axis)[fill]
            valid |= fill
    return uv, [Image.fromarray(data) for data in maps]
