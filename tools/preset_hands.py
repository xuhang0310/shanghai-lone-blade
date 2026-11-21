"""Fit textured MakeHuman hands to the existing game rig in its A pose."""

import zipfile

import bmesh
import numpy as np
from mathutils.kdtree import KDTree

from preset_heads import obj, textured_mesh


FINGERS = ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky')


def fit_landmarks(vertices, source, target):
    """A 3-D polyharmonic warp preserves the palm between finger landmarks."""
    source, target = np.asarray(source), np.asarray(target)
    n = len(source)
    affine = np.column_stack([np.ones(n), source])
    distances = np.linalg.norm(source[:, None] - source, axis=2)
    system = np.block([[distances, affine], [affine.T, np.zeros((4, 4))]])
    solution = np.linalg.solve(system, np.vstack([target, np.zeros((4, 3))]))
    return (
        np.linalg.norm(vertices[:, None] - source, axis=2) @ solution[:n]
        + np.column_stack([np.ones(len(vertices)), vertices]) @ solution[n:]
    )


def build_hands(ctx, variant, directory):
    female = variant == 'xia'
    sex = 'female' if female else 'male'
    pos, uv, faces, groups = obj((directory / 'base.obj').read_text(encoding='utf8'))
    deltas = np.loadtxt(directory / f'asian-{sex}-young.target')
    pos[deltas[:, 0].astype(int)] += deltas[:, 1:]
    helpers = {}
    for face, group in zip(faces, groups):
        if group.startswith('joint-'):
            helpers.setdefault(group, set()).update(i for i, _ in face)
    anchors = {group: pos[sorted(indices)].mean(0) for group, indices in helpers.items()}

    fitted = pos.copy()
    hand_faces = []
    weight_trees = {}
    for side, prefix in [('Left', 'joint-l-'), ('Right', 'joint-r-')]:
        wrist, elbow = anchors[prefix + 'hand'], anchors[prefix + 'elbow']
        src = [elbow, wrist]
        bone_names = [side + 'ForeArm', side + 'Hand']
        for digit, finger in enumerate(FINGERS, 1):
            for link in range(1, 5):
                src.append(anchors[f'{prefix}finger-{digit}-{link}'])
                bone_names.append(f'{side}Hand{finger}{link}')
        dst = []
        for name in bone_names:
            x, z, y = ctx.armature.data.bones[name].head_local
            dst.append((x, y, -z))
        # Include a ring of forearm inside the cuff, with room for wrist flexion.
        axis = wrist - elbow
        delta = pos - wrist
        in_hand = (
            (delta @ axis / np.linalg.norm(axis) > -0.63)
            & (np.linalg.norm(delta, axis=1) < 2.19)
            & (pos[:, 0] * (1 if side == 'Left' else -1) > 3)
        )
        selected = [f for f, g in zip(faces, groups) if g == 'body' and all(in_hand[i] for i, _ in f)]
        used = sorted({i for f in selected for i, _ in f})
        fitted[used] = fit_landmarks(pos[used], src, dst)
        hand_faces.extend(selected)
        # Reuse the character's grip weights, including the thumb opposition.
        candidates = [
            i
            for i, w in enumerate(ctx.weights)
            if any(k.startswith(side + 'Hand') or k == side + 'ForeArm' for k in w)
        ]
        tree = KDTree(len(candidates))
        for i in candidates:
            tree.insert(ctx.positions[i], i)
        tree.balance()
        weight_trees[side] = tree

    def weight(pt):
        side = 'Left' if pt[0] > 0 else 'Right'
        influences = {}
        for _, i, distance in weight_trees[side].find_n(pt, 4):
            influence = 1 / max(0.0005, distance) ** 3
            for bone, value in ctx.weights[i].items():
                influences[bone] = influences.get(bone, 0.0) + influence * value
        return influences

    image = (
        'skins/young_asian_female/young_lightskinned_female_diffuse3.png'
        if female
        else 'skins/young_asian_male/young_lightskinned_male_diffuse3.png'
    )
    # Match the back of Shen's hand to his portrait complexion. Preserve
    # the lighter palm, nail beds and creases already in the colour photograph.
    complexion = None if female else (1.025, 1.045, 1.05)
    with zipfile.ZipFile(next(p for p in directory.glob('*.zip') if zipfile.is_zipfile(p))) as archive:
        textured_mesh(
            ctx,
            'LuHands' if female else 'ShenHands',
            fitted,
            uv,
            hand_faces,
            weight,
            archive,
            image,
            1536,
            0.61,
            tint=complexion,
        )
    body = ctx.body.data
    old = body.materials.find('Nappa • gloves')
    if old >= 0:
        edit = bmesh.new()
        edit.from_mesh(body)
        bmesh.ops.delete(edit, geom=[f for f in edit.faces if f.material_index == old], context='FACES')
        edit.to_mesh(body)
        edit.free()
        body.materials.pop(index=old)
