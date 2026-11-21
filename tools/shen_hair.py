"""A side-parted brush-up, blocked against Shen's fitted scalp in bind space."""

from math import atan2, cos, pi, sin
from pathlib import Path

import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from PIL import Image

from portrait_materials import packed_image, surface_maps


def smooth(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def comb_angle(theta, height):
    # The front wave sweeps away from the part. The short temple to its
    # right is combed in the opposite direction and lies flatter.
    separation = np.arctan2(np.sin(theta - 0.62), np.cos(theta - 0.62))
    sweep = (0.30 + 0.38 * np.maximum(0.0, np.cos(theta))) * np.tanh(separation / 0.28)
    return theta + sweep * height + 0.075 * np.sin(theta - 1.1) * height**2


def pigment(phase, cross, warmth):
    fibre = (
        0.44 * np.sin(phase)
        + 0.25 * np.sin(phase * 2 + 1.2)
        + 0.17 * np.sin(phase * 3 - cross)
        + 0.14 * np.sin(phase * 5 + 0.8)
    )
    colour = np.stack(
        (54 + 14 * fibre + 12 * warmth, 41 + 11 * fibre + 7 * warmth, 35 + 10 * fibre + 6 * warmth),
        axis=2,
    )
    return colour, fibre


def hair_material(ctx, locks=False):
    width, height = (160, 384) if locks else (1536, 512)
    v, u = np.mgrid[:height, :width]
    u = (u + 0.5) / width
    v = 1 - (v + 0.5) / height
    if locks:
        path = u + 0.020 * np.sin(5 * v + 7 * u) + 0.023 * v**2
        phase = 2 * pi * (22 * path + 0.25 * np.sin(17 * path))
        dye, fibre = pigment(phase, 4 * v, 0.35 + 0.3 * np.sin(3 * v))
        alpha = smooth(np.minimum(u, 1 - u) * 10) * smooth(v * 15) * smooth((1 - v) * 12)
        alpha *= np.clip(0.47 + 0.70 * fibre, 0.02, 1)
        name = 'Shen • brushed locks'
    else:
        theta = (u - 0.5) * 2 * pi
        # Invert the smooth comb direction so the colour follows the geometry.
        root = theta.copy()
        for _ in range(4):
            root += (theta - comb_angle(root, v)) * 0.68
        bundle = 24 * root + 1.1 * np.sin(3 * root + 2.2 * v) + 0.35 * np.sin(7 * root - 5 * v)
        phase = 339 * root + 2.8 * np.sin(bundle) + 0.44 * np.sin(47 * root - 9 * v)
        warmth = 0.68 * np.maximum(0.0, np.cos(root)) * smooth(v * 4) + 0.28 * np.cos(bundle)
        dye, fibre = pigment(phase, 7 * v, warmth)
        rng = np.random.default_rng(213)
        strand_index = (root / (2 * pi) + 0.5) % 1
        variation = np.interp(strand_index, np.arange(1150) / 1150, rng.normal(0, 4.2, 1150), period=1)
        dye += (3.1 * np.cos(bundle) + 1.5 * np.sin(bundle * 2) + variation)[..., None]
        study = Path(__file__).resolve().parents[1] / 'art/portrait-study/shen-hair-tones.png'
        tones = np.asarray(
            Image.open(study).resize((width, height), Image.Resampling.BICUBIC), dtype=float
        )
        dye += ((tones - 128) / 3)[..., None] * [1.04, 0.96, 0.85]
        # The cropped temples show some scalp through closely spaced short hairs.
        temple = np.abs(np.sin(root)) ** 4 * np.exp(-((v / 0.32) ** 2))
        dye += (temple * (0.40 + 0.43 * (1 - fibre)))[..., None] * [29, 23, 18]
        hairline = 0.004 + 0.0009 * np.sin(147 * root + 1.8 * np.sin(17 * root)) + 0.002 * fibre
        alpha = smooth((v - hairline) / 0.009)
        roots = np.exp(-((v / 0.055) ** 2))
        dye += (roots * (0.56 - 0.40 * fibre))[..., None] * [40, 32, 24]
        name = 'Shen • chestnut side part'
    rgba = np.dstack((np.clip(dye, 0, 255), np.clip(alpha * 255, 0, 255))).astype(np.uint8)
    albedo = packed_image(name + ' colour', Image.fromarray(rgba))
    dy, dx = np.gradient(fibre)
    relief = np.stack((-0.23 * dx, 0.18 * dy, np.ones_like(dx)), axis=2)
    relief /= np.linalg.norm(relief, axis=2, keepdims=True)
    rough = np.clip(0.56 - 0.09 * fibre + 0.04 * np.cos(2 * pi * v), 0.39, 0.72)
    response = np.stack((np.ones_like(rough), rough, np.zeros_like(rough)), axis=2)
    mat = ctx.mat(name, '#ffffff', 0.58)
    nodes, link = mat.node_tree.nodes, mat.node_tree.links.new
    shader = nodes.get('Principled BSDF')
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = albedo
    tex.extension = 'EXTEND'
    link(tex.outputs['Color'], shader.inputs['Base Color'])
    step = nodes.new('ShaderNodeMath')
    step.operation = 'GREATER_THAN'
    step.inputs[1].default_value = 0.23
    link(tex.outputs['Alpha'], step.inputs[0])
    link(step.outputs[0], shader.inputs['Alpha'])
    mat.surface_render_method = 'DITHERED'
    shader.inputs['Specular IOR Level'].default_value = 0.27
    surface_maps(
        mat,
        packed_image(
            name + ' fibre relief', Image.fromarray(np.uint8((relief * 0.5 + 0.5) * 255)), data=True
        ),
        packed_image(name + ' roughness', Image.fromarray(np.uint8(response * 255)), data=True),
        0.57,
    )
    return mat


def make_mesh(ctx, name, points, faces, texcoords, mat):
    mesh = ctx.mesh(name, points, faces, [{'Head': 1}] * len(points), [0] * len(faces), [mat]).data
    layer = mesh.uv_layers.new(name='Comb direction')
    for coordinates, poly in zip(texcoords, mesh.polygons):
        for uv, index in zip(coordinates, poly.loop_indices):
            layer.data[index].uv = uv


def build_side_part(ctx, skin, skin_faces):
    scalp = BVHTree.FromPolygons(skin, [[v for v, _ in face] for face in skin_faces])
    centre = np.array([-0.006, 0.912, 0.074])
    cuts = np.array(
        [
            [0, 0.966],
            [0.42, 0.968],
            [0.64, 0.963],
            [0.84, 0.955],
            [1.02, 0.942],
            [1.16, 0.906],
            [1.28, 0.874],
            [1.36, 0.875],
            [1.52, 0.890],
            [1.76, 0.888],
            [1.93, 0.870],
            [2.10, 0.841],
            [2.52, 0.807],
            [pi, 0.798],
        ]
    )
    around, rows = 112, 43
    grid = np.empty((around, rows, 3))

    def trace(origin, direction):
        hit = scalp.ray_cast(Vector(origin + direction * 0.42), Vector(-direction), 0.51)[0]
        if hit is None:
            raise ValueError('The hair block missed the fitted head')
        return np.asarray(hit)

    for i in range(around):
        theta = (i / around - 0.5) * 2 * pi
        base_y = np.interp(abs(theta), cuts[:, 0], cuts[:, 1])
        base_y += 0.0015 * sin(4 * theta + 0.5) + 0.0007 * sin(23 * theta)
        horizontal = np.array([sin(theta), 0, cos(theta)])
        start = trace(centre + [0, base_y - centre[1], 0], horizontal)
        elevation = atan2(base_y - centre[1], np.linalg.norm((start - centre)[[0, 2]]))
        for j in range(rows):
            t = j / (rows - 1)
            a = elevation + (pi / 2 - elevation) * t
            ray = np.array([sin(theta) * cos(a), sin(a), cos(theta) * cos(a)])
            p = trace(centre, ray)
            x, y, z = p - centre
            fade = smooth(t / 0.13)
            front = np.exp(-(((z - 0.087) / 0.106) ** 2))
            wave = front * np.exp(-(((x - 0.006) / 0.076) ** 4)) * fade
            part_x = 0.056 + 0.27 * (z - 0.056)
            part = np.exp(-(((x - part_x) / 0.009) ** 2)) * front * fade
            thickness = 0.0017 + fade * (0.0023 + 0.0025 * max(0, sin(a)))
            p += ray * thickness
            p[1] += 0.025 * wave - 0.013 * part
            p[0] -= 0.003 * wave
            p[2] += 0.007 * wave
            # Horizontal rays can strike the pinna as the hairline turns
            # around the ear. The cropped sideburn belongs inside that ridge.
            near_ear = smooth((0.917 - p[1]) / 0.026) * smooth((abs(theta) - 1.12) / 0.20)
            max_side = 0.092 + 0.003 * smooth((p[1] - 0.855) / 0.055)
            p[0] -= np.sign(x) * max(0, abs(p[0] - centre[0]) - max_side) * near_ear
            grid[i, j] = p
    grid[:, -1] = grid[:, -1].mean(axis=0)

    def on_surface(theta, t):
        u = (theta / (2 * pi) + 0.5) * around
        v = np.clip(t, 0, 0.999) * (rows - 1)
        i, j = int(np.floor(u)), int(v)
        du, dv = u % 1, v - j
        lower = grid[i % around, j] * (1 - du) + grid[(i + 1) % around, j] * du
        upper = grid[i % around, j + 1] * (1 - du) + grid[(i + 1) % around, j + 1] * du
        return lower * (1 - dv) + upper * dv

    points = grid[:, :-1].reshape(-1, 3).tolist()
    tip = len(points)
    points.append(grid[0, -1])
    faces, coords = [], []
    for i in range(around):
        a, b = i * (rows - 1), ((i + 1) % around) * (rows - 1)
        left, right = i / around, (i + 1) / around
        for j in range(rows - 2):
            low, high = j / (rows - 1), (j + 1) / (rows - 1)
            faces.append((a + j, b + j, b + j + 1, a + j + 1))
            coords.append(((left, low), (right, low), (right, high), (left, high)))
        faces.append((a + rows - 2, b + rows - 2, tip))
        coords.append(((left, high), (right, high), ((left + right) / 2, 1)))
    make_mesh(ctx, 'ShenSidePart', points, faces, coords, hair_material(ctx))

    rng = np.random.default_rng(1981)
    points, faces, coords = [], [], []
    for i in range(232):
        root = rng.uniform(-pi, pi)
        front = max(0, cos(root))
        start = rng.uniform(0.002, 0.46) if i % 3 else rng.uniform(0.01, 0.055)
        length = min(1 - start - 0.04, rng.uniform(0.20, 0.46) + 0.11 * front)
        width = rng.uniform(0.017, 0.043)
        loft = rng.uniform(0.0005, 0.0016) * (1 + 0.28 * front)
        turn = rng.uniform(-0.04, 0.04)
        base = len(points)
        for j in range(10):
            along = j / 9
            t = start + length * along
            heading = comb_angle(root, t) + turn * sin(pi * along)
            fan = width * (0.22 + 0.78 * sin(pi * along) ** 0.58)
            for k in range(3):
                theta = heading + (k - 1) * fan
                p = on_surface(theta, t)
                n = np.cross(
                    on_surface(theta + 0.004, t) - on_surface(theta - 0.004, t),
                    on_surface(theta, t + 0.002) - on_surface(theta, t - 0.002),
                )
                n /= max(1e-12, np.linalg.norm(n))
                p += n * (0.00032 + loft * sin(pi * along) * (1 if k == 1 else 0.58))
                points.append(p)
            if j:
                for k in range(2):
                    a = base + (j - 1) * 3 + k
                    faces.append((a, a + 1, a + 4, a + 3))
                    coords.append(
                        (
                            (k / 2, (j - 1) / 9),
                            ((k + 1) / 2, (j - 1) / 9),
                            ((k + 1) / 2, j / 9),
                            (k / 2, j / 9),
                        )
                    )
    make_mesh(ctx, 'ShenCombedLocks', points, faces, coords, hair_material(ctx, locks=True))

    # Broken roots at the temples soften the transition to bare skin. Each
    # thin strand runs along the scalp for its first few millimetres.
    points, faces = [], []
    for root in rng.uniform(-1.42, 1.42, 410):
        length = rng.uniform(0.024, 0.085)
        extension = rng.uniform(0.0003, 0.0036)
        width = rng.uniform(0.00007, 0.00016)
        turn = rng.uniform(-0.024, 0.022)
        base = len(points)
        for j in range(6):
            along = j / 5
            t = length * along
            ang = comb_angle(root, t) + turn * (1 - along)
            p = on_surface(ang, t)
            heading = np.array([sin(ang), 0, cos(ang)])
            p[1] -= extension * (1 - along)
            if j < 2:
                hit = trace(p - heading * 0.14, heading)
                radius = (hit - p) @ heading
                p += (radius + 0.0003) * heading
            tangent = np.array([cos(ang), 0, -sin(ang)]) * width * (0.14 + 0.86 * along)
            points.extend((p - tangent, p + tangent))
            if j:
                k = base + 2 * j
                faces.append((k - 2, k - 1, k + 1, k))
    mat = ctx.mat('Shen • temple roots', '#49362c', 0.66)
    ctx.mesh('ShenHairline', points, faces, [{'Head': 1}] * len(points), [0] * len(faces), [mat])
