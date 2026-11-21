"""Build Shen Guhong's editable Blender source and the game's skinned hero.glb.

Run with Blender 4.5: blender -b -P tools/build_hero.py
To export hand edits, open the saved .blend in background and pass -- --export-only.
"""
import json
import math
import struct
import sys
import tempfile
from pathlib import Path

import bpy
import numpy as np
from mathutils import Quaternion, Vector


ROOT = Path(__file__).resolve().parents[1]
CHARS = ROOT / 'public/assets/chars'
BLEND = ROOT / 'art/沈孤鸿.blend'
sys.path.insert(0, str(Path(__file__).resolve().parent))


def read_glb(path):
    data = path.read_bytes()
    end = 20 + struct.unpack_from('<I', data, 12)[0]
    return json.loads(data[20:end]), bytearray(data[end + 8:])


def write_glb(path, doc, data):
    doc['buffers'][0]['byteLength'] = len(data)
    header = json.dumps(doc, ensure_ascii=False, separators=(',', ':')).encode()
    header += b' ' * (-len(header) % 4)
    data += bytes(-len(data) % 4)
    path.write_bytes(struct.pack('<4sIIII', b'glTF', 2, 28 + len(header) + len(data),
                                 len(header), 0x4E4F534A) + header
                     + struct.pack('<II', len(data), 0x004E4942) + data)


def accessor(doc, data, index):
    acc = doc['accessors'][index]
    view = doc['bufferViews'][acc['bufferView']]
    dtype = {5121: 'u1', 5123: '<u2', 5125: '<u4', 5126: '<f4'}[acc['componentType']]
    width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[acc['type']]
    offset = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
    return np.ndarray((acc['count'], width), dtype, data, offset,
                      strides=(view.get('byteStride', np.dtype(dtype).itemsize * width),
                               np.dtype(dtype).itemsize))


def xyz(point):
    x, y, z = point
    return x, -z, y


def short(name):
    return name.removeprefix('mixamorig:')


class Character:
    def __init__(self, doc, data):
        nodes = doc['nodes']
        skin = doc['skins'][0]
        self.names = [short(nodes[i]['name']) for i in skin['joints']]
        self.joint_names = set(self.names)
        matrices = accessor(doc, data, skin['inverseBindMatrices']).reshape(-1, 4, 4)
        bind = np.linalg.inv(matrices.transpose(0, 2, 1))
        parents = {child: i for i, node in enumerate(nodes) for child in node.get('children', [])}
        arm = bpy.data.armatures.new('沈孤鸿 · 角色骨架')
        self.armature = bpy.data.objects.new('HeroRig', arm)
        bpy.context.collection.objects.link(self.armature)
        bpy.context.view_layer.objects.active = self.armature
        self.armature.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        for idx, name in enumerate(self.names):
            b = arm.edit_bones.new(name)
            mat = bind[idx]
            b.head = Vector(xyz(mat[:3, 3]))
            direction = Vector(xyz(mat[:3, 1])).normalized()
            children = nodes[skin['joints'][idx]].get('children', [])
            length = 0.028
            if children:
                child = skin['joints'].index(children[0])
                length = np.linalg.norm(bind[child, :3, 3] - mat[:3, 3])
            b.tail = b.head + direction * max(float(length), 0.012)
            b.align_roll(Vector(xyz(mat[:3, 2])))
        for node, name in zip(skin['joints'], self.names):
            parent_name = short(nodes[parents[node]]['name'])
            if parent_name in arm.edit_bones:
                arm.edit_bones[name].parent = arm.edit_bones[parent_name]
        bpy.ops.object.mode_set(mode='OBJECT')
        self.armature.show_in_front = False
        arm.display_type = 'STICK'
        primitive = doc['meshes'][0]['primitives'][0]
        attrs = {k: accessor(doc, data, v) for k, v in primitive['attributes'].items()}
        self.positions = attrs['POSITION'].tolist()
        self.weights = [{self.names[int(k)]: float(v) for k, v in zip(ids, weights) if v > 0}
                        for ids, weights in zip(attrs['JOINTS_0'], attrs['WEIGHTS_0'])]
        faces = accessor(doc, data, primitive['indices']).reshape(-1, 3).tolist()
        self._build_body(faces, attrs['TEXCOORD_0'])

    def mat(self, name, hex_srgb, roughness, metallic=0):
        existing = bpy.data.materials.get(name)
        if existing:
            return existing
        value = int(hex_srgb.lstrip('#'), 16) if isinstance(hex_srgb, str) else hex_srgb
        rgb = [(value >> shift & 255) / 255 for shift in (16, 8, 0)]
        color = tuple(c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in rgb) + (1,)
        mat = bpy.data.materials.new(name)
        mat.diffuse_color = color
        mat.use_nodes = True
        node = mat.node_tree.nodes.get('Principled BSDF')
        node.inputs['Base Color'].default_value = color
        node.inputs['Roughness'].default_value = roughness
        node.inputs['Metallic'].default_value = metallic
        return mat

    def mesh(self, name, positions, faces, weights, face_materials, materials):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([xyz(p) for p in positions], [], faces)
        mesh.materials.clear()
        for mat in materials:
            mesh.materials.append(mat)
        for face, slot in zip(mesh.polygons, face_materials, strict=True):
            face.material_index = int(slot)
            face.use_smooth = True
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        obj.parent = self.armature
        mod = obj.modifiers.new('角色骨架', 'ARMATURE')
        mod.object = self.armature
        groups = {}
        for i, values in enumerate(weights):
            positive = sorted(((short(k), w) for k, w in values.items() if w > 0),
                              key=lambda pair: -pair[1])[:4]
            total = sum(v for _, v in positive)
            if not positive:
                raise ValueError(f'{name} has no bone weights at vertex {i}')
            for bone, weight in positive:
                if bone not in self.joint_names:
                    raise ValueError(f'Unknown joint {bone} on {name}')
                if bone not in groups:
                    groups[bone] = obj.vertex_groups.new(name=bone)
                groups[bone].add([i], weight / total, 'REPLACE')
        return obj

    def _build_body(self, faces, uvs):
        face_mat = self.mat('HeroSkin', '#d7a184', .58)
        image = bpy.data.images.load(str(CHARS / 'man_diff.png'))
        image.name = 'Shen • complexion'
        self._paint_complexion(image, faces, uvs)
        image.pack()
        nodes = face_mat.node_tree.nodes
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = image
        face_mat.node_tree.links.new(tex.outputs['Color'], nodes.get('Principled BSDF').inputs['Base Color'])
        materials = [face_mat, self.mat('Flannel • trousers', '#383d42', .85),
                     self.mat('Nappa • gloves', '#493830', .51)]
        kept_faces, regions = [], []
        for face in faces:
            pos = np.mean([self.positions[i] for i in face], axis=0)
            x, y, z = pos
            primary = max(self.weights[face[0]], key=self.weights[face[0]].get)
            if y < -.845:
                continue
            if y >= .715 or (y >= .64 and abs(x+.007) < .097 and -.016 < z < .16):
                region = 0
            elif 'Hand' in primary or ('ForeArm' in primary and y < .125):
                region = 2
            elif y < .175 and abs(x+.007) < .292:
                region = 1
            else:
                # The coat and shirt occupy this volume in every outfit pose.
                continue
            regions.append(region)
            kept_faces.append(face)
        self.body = self.mesh('Male', self.positions, kept_faces, self.weights, regions, materials)
        # Taper the covered thighs so that a bent leg has room inside the skirt.
        for v in self.body.data.vertices:
            x, y, z = self.positions[v.index]
            if -.45 < y < .15 and abs(x) < .285:
                factor = .16 * min(1., (.15-y)/.12, (y+.45)/.12)
                center = (-.007 + (.11 if x>-.007 else -.11))
                v.co.x = x + (center-x)*factor
                v.co.y = -(z+(.097-z)*factor)
        layer = self.body.data.uv_layers.new(name='Skin atlas')
        for loop in self.body.data.loops:
            u, v = uvs[loop.vertex_index]
            layer.data[loop.index].uv = (u, 1 - v)

    def _paint_complexion(self, image, faces, uvs):
        # Paint in face space, then bake into the original discontinuous UVs.
        # The eyes and moustache retain their registration after the sculpt.
        w, h = image.size
        pixels = np.empty(w * h * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        rgba = pixels.reshape(h, w, 4)
        uv = uvs.copy()
        uv[:, 0] *= w
        uv[:, 1] = (1 - uv[:, 1]) * h
        points = np.asarray(self.positions)
        for face in faces:
            if min(points[face, 1]) < .695 or self.weights[face[0]].get('Head', 0) < .36:
                continue
            a, b, c = uv[face]
            lo = np.maximum(0, np.floor(np.minimum(np.minimum(a, b), c))).astype(int)
            hi = np.minimum([w, h], np.ceil(np.maximum(np.maximum(a, b), c))).astype(int)
            yy, xx = np.mgrid[lo[1]:hi[1], lo[0]:hi[0]]
            e, f = b - a, c - a
            det = e[0] * f[1] - f[0] * e[1]
            if abs(det) < 1e-6 or not xx.size:
                continue
            dx, dy = xx + .5 - a[0], yy + .5 - a[1]
            s, t = (dx * f[1] - dy * f[0]) / det, (dy * e[0] - dx * e[1]) / det
            inside = (s >= 0) & (t >= 0) & (s + t <= 1)
            ypx, xpx = yy[inside], xx[inside]
            p, q, r = points[face]
            x, y, z = (p + s[inside,None] * (q - p) + t[inside,None] * (r - p)).T
            rgb = rgba[ypx, xpx, :3]
            skin = np.clip((rgb[:, 0] - rgb[:, 2]) * 5.5, 0, 1)
            cheek = np.exp(-((abs(x + .007) - .055) / .036)**2 - ((y - .826) / .053)**2)
            jaw = np.clip((.835 - y) / .069, 0, 1) * np.clip((z - .055) / .07, 0, 1)
            noise = np.mod(np.sin(xpx * 12.9898 + ypx * 78.233) * 43758.5453, 1) - .5
            rgb *= 1 + skin[:,None] * (cheek[:,None] * [.07, -.025, -.032]
                                       + jaw[:,None] * [-.15, -.09, -.025]
                                       + noise[:,None] * (.035 + .095 * jaw[:,None]))
            bright = (rgb.min(axis=1) > .55) & (rgb.max(axis=1) - rgb.min(axis=1) < .23)
            rgb[bright] *= [.72, .68, .64]
            rgba[ypx, xpx, :3] = np.clip(rgb, 0, 1)
        image.pixels.foreach_set(pixels)
        image.update()

    def smooth_body_seams(self):
        mesh = self.body.data
        mesh.update()
        totals = {}
        coordinates = [tuple(round(x, 5) for x in v.co) for v in mesh.vertices]
        for face in mesh.polygons:
            vector = face.normal * face.area
            for i in face.vertices:
                k = coordinates[i]
                totals[k] = totals.get(k, Vector((0, 0, 0))) + vector
        mesh.normals_split_custom_set_from_vertices(
            [totals[k].normalized() if k in totals else (0, 0, 1) for k in coordinates])


def preserve_game_rig(path, base, base_data):
    # Blender stores bone lengths in its armature. The game animates the original
    # Mixamo local frames directly, so keep those exact nodes and inverse binds.
    doc, data = read_glb(path)
    old_nodes = doc['nodes']
    base_nodes = base['nodes']
    source_skin = base['skins'][0]
    source_binds = accessor(base, base_data, source_skin['inverseBindMatrices'])
    node_by_name = {short(base_nodes[n]['name']): n for n in source_skin['joints']}
    nodes = [dict(n) for n in base_nodes]
    root_id = base['scenes'][0]['nodes'][0]
    nodes[root_id]['children'] = [i for i in base_nodes[root_id]['children'] if 'mesh' not in base_nodes[i]]
    for skin in doc['skins']:
        ordered = [node_by_name[short(old_nodes[k]['name'])] for k in skin['joints']]
        binds = accessor(doc, data, skin['inverseBindMatrices'])
        binds[:] = source_binds[[source_skin['joints'].index(n) for n in ordered]]
        skin['joints'] = ordered
        skin.pop('skeleton', None)
    # Reuse the slot of the old Male mesh and append the remaining outfit nodes.
    male_id = next(i for i, n in enumerate(nodes) if n.get('name') == 'Male')
    used_male = False
    for node in old_nodes:
        if 'mesh' not in node:
            continue
        if 'skin' not in node or any(k in node for k in ('matrix', 'scale', 'rotation', 'translation')):
            raise ValueError(f'Exported mesh must be in bind space: {node}')
        idx = male_id if node['name'] == 'Male' else len(nodes)
        if idx == male_id:
            nodes[idx] = node
            used_male = True
        else:
            nodes.append(node)
        nodes[root_id]['children'].append(idx)
    if not used_male:
        raise ValueError('Missing Male body in hero export')
    doc['nodes'] = nodes
    doc['scenes'] = [{'name': 'Shen Guhong', 'nodes': [root_id]}]
    doc['scene'] = 0
    write_glb(path, doc, data)


def main():
    base, data = read_glb(CHARS / 'man.glb')
    variant = sys.argv[sys.argv.index('--preset')+1] if '--preset' in sys.argv else None
    model_name = 'hero'
    source = BLEND
    if variant is not None:
        names = {'ranger': '沈孤鸿-黑衣游侠', 'xia': '陆青梧-女侠'}
        if variant not in names:
            raise ValueError(f'Unknown preset: {variant}')
        model_name = f'hero-{variant}'
        source = BLEND.with_name(names[variant] + '.blend')
    if '--export-only' not in sys.argv:
        from hero_coat import build_coat
        from hero_head import build_head
        from hero_footwear import build_footwear
        bpy.ops.wm.read_factory_settings(use_empty=True)
        ctx = Character(base, data)
        if variant:
            from preset_heads import build_portrait
            from preset_outfits import build_costume
            from preset_hands import build_hands
            from preset_tailoring import finish_trousers_and_shoes
            directory = Path(sys.argv[sys.argv.index('--makehuman-source')+1])
            build_portrait(ctx, variant, directory)
            build_costume(ctx, variant)
            build_hands(ctx, variant, directory)
            finish_trousers_and_shoes(ctx, variant)
            ctx.armature.data.name = source.stem + ' · 角色骨架'
            bpy.data.orphans_purge(do_recursive=True)
        else:
            build_head(ctx)
            build_coat(ctx)
            build_footwear(ctx)
        ctx.smooth_body_seams()
        bpy.ops.object.select_all(action='DESELECT')
        bpy.context.view_layer.objects.active = ctx.body
        for screen in bpy.data.screens:
            for area in screen.areas:
                if area.type == 'VIEW_3D':
                    space = area.spaces.active
                    space.overlay.show_overlays = False
                    space.shading.type = 'MATERIAL'
                    space.shading.color_type = 'MATERIAL'
                    space.region_3d.view_distance = 3.4
                    space.region_3d.view_rotation = Quaternion((0, 0, 1), .35) @ Quaternion((1, 0, 0), math.radians(84))
    rig = bpy.data.objects['HeroRig']
    if variant:
        from hero_occlusion import bake_hero_occlusion
        bpy.context.view_layer.update()
        bake_hero_occlusion(rig)
    if '--export-only' not in sys.argv:
        BLEND.parent.mkdir(parents=True, exist_ok=True)
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(source), compress=True)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in (rig, *rig.children_recursive):
        obj.select_set(True)
    with tempfile.TemporaryDirectory() as tmp:
        export = Path(tmp) / 'hero.glb'
        bpy.ops.export_scene.gltf(filepath=str(export), use_selection=True, export_animations=False,
                                  export_format='GLB', export_extras=False, export_yup=True,
                                  export_attributes=bool(variant))
        preserve_game_rig(export, base, data)
        (CHARS / (model_name + '.glb')).write_bytes(export.read_bytes())


if __name__ == '__main__':
    main()
