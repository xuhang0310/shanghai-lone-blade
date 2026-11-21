"""Shape the trouser break over each shoe and unwrap the dressed lower body."""

from math import atan2, cos, exp, pi, sin

import bmesh
import bpy
import numpy as np


def bell(t):
    return exp(-min(45.0, t * t))


def cylindrical_uv(mesh, coordinates, name):
    layer = mesh.uv_layers.active or mesh.uv_layers.new(name=name)
    layer.name = name
    for polygon in mesh.polygons:
        points = [coordinates(mesh.vertices[i].co, polygon) for i in polygon.vertices]
        first = points[0][0]
        for loop, (turn, u_scale, along) in zip(polygon.loop_indices, points):
            layer.data[loop].uv = ((turn + round(first - turn)) * u_scale, along)


def sculpt_flannel(ctx, variant):
    # The visible legacy trouser mesh has UV seams and comparatively few rings.
    # Weld and subdivide its rest mesh before shaping cloth, keeping skin weights.
    body = ctx.body
    editable = bmesh.new()
    editable.from_mesh(body.data)
    bmesh.ops.delete(editable, geom=[v for v in editable.verts if not v.link_faces], context='VERTS')
    bmesh.ops.remove_doubles(editable, verts=list(editable.verts), dist=0.000015)
    editable.to_mesh(body.data)
    editable.free()
    bpy.context.view_layer.objects.active = body
    subdivision = body.modifiers.new('Knee and hem topology', 'SUBSURF')
    subdivision.levels = 1
    bpy.ops.object.modifier_move_to_index(modifier=subdivision.name, index=0)
    bpy.ops.object.modifier_apply(modifier=subdivision.name)
    mesh = body.data
    # Track the trouser leg itself. The rest positions of the feet splay outward.
    points = np.array([tuple(v.co) for v in mesh.vertices])
    levels = np.linspace(-0.85, 0.17, 32)
    profiles = {}
    for side in (-1, 1):
        centers = []
        for height in levels:
            section = points[
                (np.abs(points[:, 2] - height) < 0.031) & ((points[:, 0] + 0.007) * side > 0)
            ]
            if len(section):
                low, high = np.percentile(section, [6, 94], axis=0)
                centers.append((height, (low[0] + high[0]) * 0.5, -(low[1] + high[1]) * 0.5))
        profiles[side] = np.array(centers).T

    def polar(co):
        x, depth, y = co
        side = 1 if x > -0.007 else -1
        heights, xs, zs = profiles[side]
        dx = x - np.interp(y, heights, xs)
        dz = -depth - np.interp(y, heights, zs)
        return side, atan2(dx * side, dz), y

    for v in mesh.vertices:
        side, angle, y = polar(v.co)
        if y >= -0.035:
            continue
        # Compression fans at the back of the knee. Below it the cloth hangs
        # straighter and stacks diagonally against the shoe or bound gaiter.
        rear = (1 - cos(angle)) * 0.5
        phase = angle + 0.32 * side
        displacement = 0.0027 * bell((y + 0.50) / 0.23) * cos(5 * phase + 0.45 * sin((y + 0.48) * 8.0))
        for at, width, rise in [(-0.347, 0.018, 0.009), (-0.402, 0.012, 0.006)]:
            slope = 0.038 * sin(phase + 0.3) + 0.012 * cos(2 * phase)
            h = (y - at - slope) / width
            displacement += rise * (bell(h) - 0.58 * bell(h - 1.45)) * (0.18 + 0.82 * rear)
        bottom = -0.725 if variant == 'ranger' else -0.566
        for dy, offset, amplitude in [(0, 0.1, 0.0085), (-0.062, 1.9, 0.007), (0.043, -1.2, 0.0055)]:
            h = (y - bottom - dy - 0.032 * cos(angle + offset + side * 0.3)) / 0.018
            displacement += amplitude * (bell(h) - 0.52 * bell(h - 1.7))
        # A narrow pressed line down the front is softened around the kneecap.
        displacement += (
            0.0037 * bell(sin(angle) * 8) * max(0, cos(angle)) * (1 - 0.75 * bell((y + 0.37) / 0.07))
        )
        if y < -0.79:
            displacement *= max(0, (y + 0.85) / 0.06)
        v.co.x += side * sin(angle) * displacement
        v.co.y -= cos(angle) * displacement
    mesh.update()
    cylindrical_uv(mesh, lambda co, face: (polar(co)[1] / (2 * pi), 2.1, co.z / 0.28), 'Flannel grain')


def finish_trousers_and_shoes(ctx, variant):
    from tailored_surface import apply_scan

    sculpt_flannel(ctx, variant)
    apply_scan(bpy.data.materials['Flannel • trousers'], 'rough_linen', 0.88, normal_strength=0.19)
    shoes = next(ob for ob in ctx.armature.children if ob.name in ('HeroOxfords', 'LuClothShoes'))

    def shoe_uv(co, polygon):
        x, depth, y = co
        if x < -0.007:
            x = -0.0142 - x
        z = -depth
        cx = 0.151 + 0.046 * min(1, max(0, (z + 0.02) / 0.2))
        angle = atan2(x - cx, max(-0.008, y + 0.974))
        if polygon.material_index >= 5:
            return atan2(x - cx, z - 0.03) / (2 * pi), 1.02, y / 0.28
        return angle / (2 * pi), 2.3, z / 0.25

    cylindrical_uv(shoes.data, shoe_uv, 'Cut leather')
    for index, strength in [(0, 0.18), (1, 0.10), (3, 0.12)]:
        mat = shoes.data.materials[index]
        rough = mat.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value
        scan = 'rough_linen' if variant == 'xia' and index == 0 else 'brown_leather'
        apply_scan(
            mat, scan, max(0.65, rough) if scan == 'rough_linen' else rough, normal_strength=strength
        )
    gaiters = bpy.data.objects.get('LuBoundGaiters')
    if gaiters:

        def gaiter_uv(co, polygon):
            x, z, y = co
            cx = 0.141 if x > 0 else -0.155
            return atan2(x - cx, -z - 0.044) / (2 * pi), 1.4, y / 0.28

        cylindrical_uv(gaiters.data, gaiter_uv, 'Binding weave')
        apply_scan(gaiters.data.materials[0], 'rough_linen', 0.84, normal_strength=0.26)
