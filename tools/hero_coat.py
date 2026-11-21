"""Tailored gabardine coat for Shen Guhong, authored in the Male bind space.

Cross-sections are measured on the neutral model. The body panels are open at
the throat and at the kick pleat, so the garment has actual cut edges in motion.
"""

from math import asin, atan2, cos, sin, pi, exp
import bpy
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree


def clamp(x):
    return max(0.0, min(1.0, x))


def sample(rows, y):
    if y <= rows[0][0]:
        return rows[0][1:]
    for low, high in zip(rows, rows[1:]):
        if y <= high[0]:
            t = (y - low[0]) / (high[0] - low[0])
            return tuple(a + (b - a) * t for a, b in zip(low[1:], high[1:]))
    return rows[-1][1:]


# Y, half width, rear and front extents. +Z is the chest; +X is anatomical left.
BODY = [
    (-0.39, 0.266, -0.108, 0.257),
    (-0.30, 0.258, -0.095, 0.253),
    (-0.15, 0.245, -0.077, 0.251),
    (0.015, 0.225, -0.061, 0.264),
    (0.115, 0.210, -0.052, 0.258),
    (0.20, 0.200, -0.032, 0.251),
    (0.235, 0.195, -0.026, 0.249),
    (0.30, 0.202, -0.022, 0.250),
    (0.40, 0.216, -0.042, 0.254),
    (0.51, 0.222, -0.080, 0.249),
    (0.58, 0.232, -0.084, 0.224),
    (0.645, 0.232, -0.083, 0.193),
    (0.673, 0.211, -0.078, 0.169),
    (0.70, 0.169, -0.068, 0.143),
    (0.727, 0.108, -0.048, 0.125),
]

# Y, distance of sleeve centre from centre line, half width, rear and front.
SLEEVE = [
    (0.084, 0.446, 0.047, 0.003, 0.105),
    (0.099, 0.440, 0.049, -0.003, 0.102),
    (0.123, 0.432, 0.052, -0.007, 0.099),
    (0.169, 0.407, 0.063, -0.016, 0.091),
    (0.22, 0.375, 0.073, -0.044, 0.086),
    (0.27, 0.350, 0.077, -0.061, 0.066),
    (0.325, 0.332, 0.076, -0.064, 0.059),
    (0.38, 0.302, 0.073, -0.064, 0.059),
    (0.414, 0.282, 0.082, -0.070, 0.073),
    (0.47, 0.264, 0.091, -0.079, 0.113),
    (0.53, 0.237, 0.094, -0.077, 0.150),
    (0.594, 0.205, 0.092, -0.078, 0.154),
    (0.646, 0.175, 0.088, -0.078, 0.150),
    (0.675, 0.159, 0.077, -0.070, 0.132),
    (0.695, 0.154, 0.059, -0.045, 0.107),
    (0.707, 0.149, 0.030, -0.004, 0.080),
    (0.71, 0.148, 0.008, 0.028, 0.050),
]

OPENING = [
    (0.42, 0.004),
    (0.464, 0.020),
    (0.525, 0.044),
    (0.583, 0.062),
    (0.619, 0.077),
    (0.63, 0.083),
    (0.655, 0.090),
    (0.684, 0.091),
    (0.71, 0.088),
    (0.727, 0.082),
]


def weave(coat, positions, weights, wool_materials):
    """Pack a seamless twill normal map and lay the grain along each pattern piece."""
    size = 128
    row, col = np.mgrid[:size, :size]
    x, y = 2 * pi * col / size, 2 * pi * row / size
    twill = np.sin(8 * (x - y) + 0.28 * np.sin(16 * y))
    threads = 0.70 * twill + 0.25 * np.cos(16 * x) * np.cos(16 * y) + 0.14 * np.sin(32 * y)
    dx = (np.roll(threads, -1, 1) - np.roll(threads, 1, 1)) * 0.30
    dy = (np.roll(threads, -1, 0) - np.roll(threads, 1, 0)) * 0.30
    unit = np.stack((-dx, -dy, np.ones_like(dx)), -1)
    unit /= np.linalg.norm(unit, axis=2, keepdims=True)
    rgba = np.concatenate((unit * 0.5 + 0.5, np.ones((size, size, 1))), axis=2)
    image = bpy.data.images.new("Gabardine • diagonal twill", size, size, alpha=False)
    image.colorspace_settings.name = "Non-Color"
    image.pixels.foreach_set(rgba.astype(np.float32).ravel())
    image.pack()
    for mat in wool_materials:
        nt = mat.node_tree
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image
        normals = nt.nodes.new("ShaderNodeNormalMap")
        normals.inputs["Strength"].default_value = 0.22
        nt.links.new(tex.outputs["Color"], normals.inputs["Color"])
        nt.links.new(normals.outputs["Normal"], nt.nodes.get("Principled BSDF").inputs["Normal"])

    mesh = coat.data
    uv = mesh.uv_layers.new(name="Cloth grain")
    for poly in mesh.polygons:
        indices = list(poly.vertices)
        first = indices[0]
        hand = sum(v for key, v in weights[first].items() if "Arm" in key or "Hand" in key) > 0.4
        pattern = []
        for i in indices:
            x, y, z = positions[i]
            if hand:
                cx, _, rear, front = sample(SLEEVE, y)
                x -= -0.007 + (cx + 0.006) * (1 if x > 0 else -1)
                z -= (rear + front) / 2
            else:
                _, rear, front = sample(BODY, y)
                x += 0.007
                z -= (rear + front) / 2
            turns = atan2(x, z) / (2 * pi)
            if pattern:  # unwrap each quad that meets the rear pattern seam
                turns += round(pattern[0][0] - turns)
            pattern.append((turns, y))
        for loop, (turns, y) in zip(poly.loop_indices, pattern):
            uv.data[loop].uv = (turns * (7 if hand else 17), y / 0.076)


def build_coat(ctx, photographed=False):
    if photographed:
        from tailored_surface import folds, garment_uv
    materials = [
        ctx.mat("HeroWool Gabardine", "#485650", 0.83),
        ctx.mat("HeroWool Storm shield", "#53605A", 0.80),
        ctx.mat("HeroWool Underfold", "#303B38", 0.89),
        ctx.mat("HeroWool Pressed edge", "#5D6860", 0.77),
        ctx.mat("HeroWool Belt", "#414A43", 0.76),
        ctx.mat("Hero Black horn", "#3A3129", 0.37),
        ctx.mat("Hero Oxidised brass", "#947B4D", 0.38, 0.68),
        ctx.mat("Hero Oxblood silk", "#652723", 0.66),
        ctx.mat("Hero Ivory shirt", "#BFB3A0", 0.85),
    ]
    wool, shield, lining, edge, webbing, horn, brass, silk, cotton = range(9)
    p, faces, skin, slots = [], [], [], []
    trees = {}
    for area in ("trunk", "Left", "Right"):
        allow = (
            ("Hips", "Spine", "Neck") if area == "trunk" else (area + "Arm", area + "ForeArm", area + "Shoulder")
        )
        filtered = [
            i for i, ws in enumerate(ctx.weights) if sum(w for k, w in ws.items() if k.startswith(allow)) > 0.47
        ]
        tree = KDTree(len(filtered))
        for i in filtered:
            tree.insert(ctx.positions[i], i)
        tree.balance()
        trees[area] = tree

    def fitted_weight(point, area):
        weights = {}
        near = trees[area].find_n(point, 5)
        for _, i, dist in near:
            factor = 1 / (dist * dist + 0.000025)
            for bone, v in ctx.weights[i].items():
                weights[bone] = weights.get(bone, 0.0) + factor * v
        best = sorted(weights.items(), key=lambda pair: -pair[1])[:4]
        total = sum(v for _, v in best)
        return {k: v / total for k, v in best}

    def body_weight(point, panel_side=0):
        x, y, _ = point
        if y >= 0.185:
            # All adjacent garment layers must bend together, including on a
            # hunched back where nearest-body projection crosses a shoulder joint.
            shoulder_bone = "LeftShoulder" if x > -0.007 else "RightShoulder"
            shoulder = 0.54 * clamp((abs(x + 0.007) - 0.065) / 0.14) * clamp((y - 0.52) / 0.135)
            neck = 0.48 * (1 - clamp((abs(x + 0.007) - 0.045) / 0.08)) * clamp((y - 0.665) / 0.095)
            joints = ("Hips", "Spine", "Spine1", "Spine2")
            levels = (0.202, 0.326, 0.446, 0.565)
            upper = {joints[-1]: 1}
            for i in range(3):
                if y < levels[i + 1]:
                    a = clamp((y - levels[i]) / (levels[i + 1] - levels[i]))
                    upper = {joints[i]: 1 - a, joints[i + 1]: a}
                    break
            weights = {k: v * (1 - shoulder - neck) for k, v in upper.items()}
            weights[shoulder_bone] = shoulder
            weights["Neck"] = neck
            return weights
        # The two split tails hinge at each hip. A wide gait can separate
        # the front and rear vents without pulling either hem across the knees.
        leg = clamp((0.185 - y) / 0.210)
        leg *= 2 - leg
        left = float(panel_side > 0) if panel_side else clamp(0.5 + (x + 0.007) / 0.055)
        shin = 0.57 * clamp((-0.315 - y) / 0.095)
        return {
            "Hips": 1 - leg,
            "LeftUpLeg": leg * (1 - shin) * left,
            "RightUpLeg": leg * (1 - shin) * (1 - left),
            "LeftLeg": shin * left,
            "RightLeg": shin * (1 - left),
        }

    def garment(point, panel_side=0):
        return point, body_weight(point, panel_side)

    def point_vertex(vertex):
        point, weights = vertex
        p.append(tuple(point))
        skin.append(weights)
        return len(p) - 1

    def patch(rows, columns, mat, flip=False):
        grid = [[point_vertex(v) for v in row] for row in rows]
        for r in range(len(grid) - 1):
            for c in range(columns):
                f = (grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c])
                faces.append(f[::-1] if flip else f)
                slots.append(mat(r, c) if callable(mat) else mat)

    def shell(y, a, lift=0):
        width, rear, front = sample(BODY, y)
        # Broad panels across the shoulder blades; stronger vertical drape below belt.
        zmid, depth = (front + rear) / 2, (front - rear) / 2
        sk = clamp((0.215 - y) / 0.58)
        back = max(0.0, -cos(a))
        wave = (0.007 * cos(8 * a + 0.7) + 0.0035 * cos(13 * a - 0.5)) * sk
        wave += (
            0.006
            * cos(7 * a + 0.4)
            * back
            * (exp(-(((y - 0.34) / 0.14) ** 2)) + 0.55 * exp(-(((y - 0.09) / 0.09) ** 2)))
        )
        if photographed:
            wave = .55 * wave + folds(a, y, False)
        w = sin(a)
        d = cos(a)
        # A softly squared section across the shoulder blades and chest.
        xx = (1 if w >= 0 else -1) * abs(w) ** 0.89
        zz = (1 if d >= 0 else -1) * abs(d) ** 0.85
        return (-0.007 + (width + lift + wave) * xx, y, zmid + (depth + lift + wave) * zz)

    # Handed cloth fronts meet at the buttons and open out naturally toward the hem.
    heights = [
        -0.39,
        -0.38,
        -0.35,
        -0.30,
        -0.235,
        -0.17,
        -0.11,
        -0.045,
        0.015,
        0.075,
        0.13,
        0.18,
        0.215,
        0.24,
        0.27,
        0.30,
        0.35,
        0.40,
        0.45,
        0.49,
        0.53,
        0.58,
        0.61,
        0.645,
        0.673,
        0.70,
        0.727,
    ]
    if photographed:
        heights = sorted(set(heights).union(np.linspace(heights[0], heights[-1], 66)))
    def angles(y):
        front = 0.014 + 0.235 * clamp((-0.065 - y) / 0.325) ** 1.4
        if y > 0.42:
            (opening,) = sample(OPENING, y)
            width, _, _ = sample(BODY, y)
            front = asin((opening / width) ** (1 / 0.89))
        rear = pi - 0.12 * clamp((-0.12 - y) / 0.27) ** 1.3
        return front, rear

    for side in (1, -1):

        def panel(y, t):
            a, b = angles(y)
            angle = side * (a + (b - a) * t)
            y -= 0.009 * clamp((-0.20 - y) / 0.19) * (0.45 + 0.55 * cos(5 * angle + 0.7))
            return shell(y, angle)

        n = 52 if photographed else 44
        patch([[garment(panel(y, i / n), side) for i in range(n + 1)] for y in heights], n, wool, flip=side < 0)

        # Turnbacks along lower hem, with a visible inside face at the cut edges.
        def turned(pos, dy):
            x, y, z = pos
            return (x * 0.975, y + dy, 0.075 + (z - 0.075) * 0.967)

        hem = [panel(heights[0], i / n) for i in range(n + 1)]
        patch(
            [
                [garment(v, side) for v in hem],
                [garment(turned(v, 0.008), side) for v in hem],
                [garment(turned(v, 0.035), side) for v in hem],
            ],
            n,
            lining,
            flip=side > 0,
        )
        for t in (0.0, 1.0):
            path = [panel(y, t) for y in heights]
            patch(
                [[garment(v, side), garment(turned(v, 0), side)] for v in path],
                1,
                lining,
                flip=(side > 0) == (t == 0),
            )

    # A shallow inverted pleat covers the starting point of the back vent
    # as the two skirts spread apart across the seat in a wide stride.
    n = 22
    patch(
        [
            [garment(shell(y, pi + (i / n - 0.5) * 0.91, -0.006)) for i in range(n + 1)]
            for y in (-0.085, -0.040, 0.020, 0.08, 0.14, 0.185)
        ],
        n,
        wool,
    )

    # Finish the shoulders under the collar all the way to the neck. Deep
    # flexion reveals the inside of this facing from the over-shoulder camera.
    n = 52

    def shoulder_facing(a, t):
        x, y, z = shell(0.727, a)
        neck_x = -0.007 + 0.053 * sin(a)
        neck_z = 0.044 + 0.056 * cos(a)
        # The stand on Shen's shirt is open at the throat. Turn the inside
        # facing down behind it, keeping the outer shoulder seam in place.
        rise = .012 - (.020 * max(0., cos(a)) if photographed else 0.)
        pos = (x + (neck_x - x) * t, y + rise * t, z + (neck_z - z) * t)
        weights = body_weight(pos)
        for k in weights:
            weights[k] *= 1 - 0.70 * t
        weights["Neck"] = weights.get("Neck", 0) + 0.70 * t
        return pos, weights

    def facing_row(t):
        opening = angles(.727)[0] + .45*t if photographed else 0.
        return [shoulder_facing(opening + (2*pi - 2*opening)*i/n, t) for i in range(n+1)]

    patch([facing_row(t) for t in (0, .12, .4, .72, 1)], n, wool)

    # Closed overlap under the button stand. Below the lower button the front parts.
    patch(
        [
            [garment(shell(y, -0.19 + 0.38 * i / 8, -0.004)) for i in range(9)]
            for y in (0.135, 0.16, 0.20, 0.22, 0.34, 0.427)
        ],
        8,
        wool,
    )

    # Curved back storm shield: the centre drops to a buttoned swallow point.
    def yoke_point(u, t, extra=0):
        a = pi + (u - 0.5) * 3.42
        mid = sin(pi * u)
        top = 0.645 + 0.077 * mid**0.75
        bottom = 0.527 - 0.053 * mid - 0.046 * mid**10
        y = bottom + (top - bottom) * t
        return shell(y, a, 0.004 + 0.007 * (1 - t) ** 1.1 + extra)

    n = 48
    patch(
        [
            [garment(yoke_point(c / n, t)) for c in range(n + 1)]
            for t in (0, 0.025, 0.07, 0.13, 0.22, 0.32, 0.42, 0.52, 0.62, 0.72, 0.82, 0.92, 1)
        ],
        n,
        shield,
    )
    patch(
        [
            [garment(yoke_point(c / n, t, extra)) for c in range(n + 1)]
            for t, extra in ((0, -0.009), (0, 0), (0.025, 0.0008))
        ],
        n,
        lambda row, col: lining if row == 0 else edge,
    )

    # Stand and collar fall. The raised rear collar surrounds the shirt, and two
    # distinct points turn down to meet the notched, rolled lapels on the chest.
    n = 48

    def collar(u, v):
        a = 0.71 + u * (2 * pi - 1.42)
        back = (1 - cos(a)) / 2
        x = -0.006 + sin(a) * (0.100 + 0.043 * (1 - v))
        z = 0.061 + cos(a) * (0.097 + 0.040 * (1 - v))
        y = 0.678 + 0.017 * back + 0.067 * v
        return (x, y, z)

    patch([[garment(collar(i / n, v)) for i in range(n + 1)] for v in (0, 0.08, 0.46, 0.90, 1)], n, shield)
    patch(
        [
            [
                garment(collar(i / n, 1)),
                garment(
                    tuple(
                        v + (0, 0.001, -0.004 * cos(0.71 + i / n * (2 * pi - 1.42)))[k]
                        for k, v in enumerate(collar(i / n, 1))
                    )
                ),
            ]
            for i in range(n + 1)
        ],
        1,
        edge,
    )

    # Use the shell itself as a tailor's form for facing pieces, straps, buttons.
    def face(x, y, lift=0):
        width, _, _ = sample(BODY, y)
        angle = asin(
            max(-0.998, min(0.998, ((abs(x + 0.007) / width) ** (1 / 0.89)) * (1 if x >= -0.007 else -1)))
        )
        a, b, z = shell(y, angle)
        return a, b, z + lift

    for sign in (-1, 1):
        lapels = [
            (0.421, 0.009, 0.011),
            (0.464, 0.016, 0.035),
            (0.525, 0.028, 0.067),
            (0.583, 0.042, 0.104),
            (0.619, 0.053, 0.138),
            (0.630, 0.056, 0.115),
            (0.655, 0.063, 0.132),
            (0.684, 0.070, 0.121),
            (0.710, 0.078, 0.100),
            (0.714, 0.080, 0.094),
        ]
        patch(
            [
                [
                    garment(
                        face(
                            -0.007 + sign * (inside + (outside - inside) * s),
                            y,
                            0.010 + 0.014 * sin(pi * s) + 0.008 * (1 - s),
                        )
                    )
                    for s in (0, 0.22, 0.54, 0.86, 1)
                ]
                for y, inside, outside in lapels
            ],
            4,
            shield,
            flip=sign < 0,
        )
        # Bias-cut welt hidden to the side of each front, a shallow ascending angle.
        patch(
            [
                [
                    garment(shell(0.095 + 0.095 * s + dy, sign * (0.67 + 0.44 * s), 0.006 + 0.004 * sin(pi * s)))
                    for s in (0, 0.10, 0.40, 0.73, 0.94, 1)
                ]
                for dy in (0, 0.006, 0.014, 0.022)
            ],
            5,
            shield,
            flip=sign < 0,
        )

    def sleeve(y, a, sign, lift=0):
        cx, rx, back, front = sample(SLEEVE, y)
        # A dart gathers fabric on the inner elbow while the outside stretches smooth.
        inner = (0.5 - 0.5 * sign * sin(a)) ** 1.8
        ruffle = 0.0048 * inner * exp(-(((y - 0.381) / 0.067) ** 2)) * cos(
            y * 75 + 2.5 * sin(a)
        ) + 0.003 * inner * exp(-(((y - 0.18) / 0.05) ** 2)) * sin(y * 115 - 2 * cos(a))
        if photographed:
            ruffle = .3 * ruffle + folds(sign*a, y, True)
        upper = clamp((y - 0.36) / 0.20)
        rx = rx * (1 - 0.18 * upper) + ruffle + lift
        rz = (front - back) * (0.5 - 0.085 * upper) + lift + ruffle
        return (-0.007 + sign * (cx + 0.006) + sin(a) * rx, y - 0.008 * upper, (front + back) / 2 + cos(a) * rz)

    sleeve_start = len(faces)
    n = 40 if photographed else 30
    ys = sorted(
        set([s[0] for s in SLEEVE] + [0.34, 0.354, 0.369, 0.395, 0.438, 0.446, 0.452, 0.18, 0.194, 0.201, 0.221])
    )
    if photographed:
        ys = sorted(set(ys).union(np.linspace(ys[0], ys[-1], 63)))
    for sign, side in ((1, "Left"), (-1, "Right")):

        def arm(y, a, lift=0):
            pt = sleeve(y, a, sign, lift)
            sleeve_weights = fitted_weight(pt, side)
            blend = 0.84 * clamp((y - 0.61) / 0.10)
            weights = {k: v * (1 - blend) for k, v in sleeve_weights.items()}
            for k, v in body_weight(pt).items():
                weights[k] = weights.get(k, 0) + v * blend
            return pt, weights

        patch([[arm(y, 2 * pi * i / n) for i in range(n + 1)] for y in ys], n, wool)
        # A tapered cuff tab closes on the outside of the wrist.
        segments = 16
        patch(
            [
                [
                    arm(
                        0.136 + dy * (0.25 + 0.75 * clamp(min(i, segments - i) / 2)),
                        sign * 1.38 - 1.12 + 2.24 * i / segments,
                        lift,
                    )
                    for i in range(segments + 1)
                ]
                for dy, lift in ((-0.011, 0.001), (-0.009, 0.0035), (0.009, 0.0035), (0.011, 0.001))
            ],
            segments,
            webbing,
        )
        patch(
            [
                [
                    arm(
                        0.136 + r * 0.0064 * sin(2 * pi * i / 12),
                        sign * 1.05 + r * 0.110 * cos(2 * pi * i / 12),
                        lift,
                    )
                    for i in range(13)
                ]
                for r, lift in ((1, 0.0035), (0.86, 0.0055), (0.12, 0.006))
            ],
            12,
            horn,
        )
        patch([[arm(0.084, 2 * pi * i / n, lift) for i in range(n + 1)] for lift in (-0.007, 0)], n, lining)

    sleeve_end = len(faces)
    # Waist belt follows the shape of the coat; the brass frame is hollow.
    n = 80
    patch(
        [
            [
                garment(shell(0.225 + dy + 0.003 * cos(2 * pi * i / n - 0.5), 2 * pi * i / n, lift))
                for i in range(n + 1)
            ]
            for dy, lift in ((-0.021, 0.003), (-0.019, 0.008), (0.017, 0.008), (0.020, 0.003))
        ],
        n,
        webbing,
    )

    def button(center, normal, radius, material):
        center = Vector(center)
        normal = Vector(normal).normalized()
        across = Vector((0, 1, 0)).cross(normal).normalized()
        up = normal.cross(across)
        n = 14
        patch(
            [
                [
                    garment(
                        tuple(
                            center
                            + (across * cos(2 * pi * i / n) + up * sin(2 * pi * i / n)) * radius * r
                            + normal * h
                        )
                    )
                    for i in range(n + 1)
                ]
                for r, h in ((1, 0), (1, 0.0027), (0.78, 0.0045), (0.04, 0.0042))
            ],
            n,
            material,
        )

    for x in (-0.064, 0.048):
        for y in (0.332, 0.424, 0.508):
            button(face(x, y, 0.013), (x * 2, 0.04, 1), 0.0125, horn)
    button(yoke_point(0.5, 0.09, 0.0015), (0, 0.04, -1), 0.0105, horn)
    for a in (-2.18, 2.18, -1.15, 1.15):
        patch(
            [
                [garment(shell(0.225 + dy, a + offset, 0.012)) for offset in (-0.035, 0.035)]
                for dy in (-0.030, -0.024, 0.023, 0.030)
            ],
            1,
            wool,
        )

    for x0, x1, y0, y1 in (
        (-0.040, 0.022, 0.206, 0.212),
        (-0.040, 0.022, 0.242, 0.248),
        (-0.040, -0.034, 0.212, 0.242),
        (0.016, 0.022, 0.212, 0.242),
        (-0.012, 0.015, 0.224, 0.228),
    ):
        patch([[garment(face(x, y, 0.014)) for x in (x0, x1)] for y in (y0, y1)], 1, brass)

    # One continuous shirt bib supports the lapels and necktie. Its hidden
    # margins extend under the actual coat opening, including the high notches.
    shirt_sections = [
        (0.417, 0.013),
        (0.45, 0.030),
        (0.49, 0.051),
        (0.53, 0.081),
        (0.58, 0.111),
        (0.62, 0.142),
        (0.66, 0.141),
        (0.69, 0.127),
        (0.710, 0.098),
    ]

    def shirt(x, y, lift=0):
        px, py, pz = face(x, y)
        # The very top turns back to the neck, inside the raised coat collar.
        taper = clamp((y - 0.665) / 0.045)
        return (px, py, pz + 0.006 - 0.008 * taper + lift)

    spans = (-1, -0.75, -0.48, -0.2, 0, 0.2, 0.48, 0.75, 1)
    patch(
        [
            [garment(shirt(-0.007 + min(w, sample(OPENING, y)[0] + 0.003) * t, y)) for t in spans]
            for y, w in shirt_sections
        ],
        len(spans) - 1,
        cotton,
    )

    # A shallow stand falls toward the front knot. The narrow upper edge also
    # covers the junction between the sculpted neck and the cloth.
    n = 42
    patch(
        [
            [
                garment(
                    (
                        -0.007 + rx * sin(2 * pi * i / n),
                        y - 0.010 * cos(2 * pi * i / n),
                        0.041 + rz * cos(2 * pi * i / n) + 0.025 * max(0, -cos(2 * pi * i / n)) ** 2,
                    )
                )
                for i in range(n + 1)
            ]
            for y, rx, rz in (
                (0.701, 0.095, 0.104),
                (0.717, 0.091, 0.096),
                (0.735, 0.085, 0.094),
                (0.736, 0.083, 0.092),
            )
        ],
        n,
        cotton,
    )

    # Blade and four-in-hand knot have different outlines. A very small roll
    # catches light along the knot without enlarging the whole neck.
    rows = ((0.476, 0.002), (0.492, 0.016), (0.55, 0.018), (0.616, 0.012), (0.660, 0.009), (0.675, 0.009))
    patch(
        [[garment(shirt(-0.009 + w * t, y, 0.005 + 0.002 * (1 - t * t))) for t in spans] for y, w in rows],
        len(spans) - 1,
        silk,
    )
    patch(
        [
            [garment(shirt(-0.009 + w * t, y, 0.006 + roll * (1 - t * t))) for t in spans]
            for y, w, roll in (
                (0.66, 0.007, 0.002),
                (0.675, 0.011, 0.006),
                (0.691, 0.020, 0.008),
                (0.700, 0.017, 0.006),
                (0.704, 0.012, 0.002),
            )
        ],
        len(spans) - 1,
        silk,
    )
    for sign in (-1, 1):
        # Two pointed cotton leaves fold over the tie knot.
        rows = ((0.657, 0.035, 0.036), (0.673, 0.027, 0.047), (0.692, 0.015, 0.060), (0.707, 0.013, 0.057))
        patch(
            [
                [
                    garment(shirt(-0.007 + sign * (a + (b - a) * t), y, 0.004 + 0.005 * (1 - t)))
                    for t in (0, 0.45, 1)
                ]
                for y, a, b in rows
            ],
            2,
            cotton,
            flip=sign < 0,
        )

    coat = ctx.mesh("HeroCoat", p, faces, skin, slots, materials)
    if photographed:
        garment_uv(coat, p, (sleeve_start, sleeve_end), BODY, SLEEVE, sample)
    else:
        weave(coat, p, skin, materials[:5])
    return coat
