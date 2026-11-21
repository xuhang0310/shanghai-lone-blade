"""Bake short-range sky occlusion into the two hero costumes in bind space."""
from math import cos, pi, sin, sqrt

from mathutils import Vector
from mathutils.bvhtree import BVHTree


def _blocks_light(material):
    if not material or not material.use_nodes:
        return True
    shader = next((node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED'), None)
    if shader is None:
        return True
    alpha = shader.inputs['Alpha']
    # Hair cards and eyelashes have cutouts; their rectangular carriers must
    # never bake dark squares onto the forehead and eyes underneath.
    return not alpha.is_linked and alpha.default_value > 0.98


def bake_hero_occlusion(rig):
    objects = [obj for obj in rig.children_recursive if obj.type == 'MESH']
    positions, triangles = [], []
    for obj in objects:
        mesh = obj.data
        offset = len(positions)
        positions.extend(obj.matrix_world @ vertex.co for vertex in mesh.vertices)
        opaque = [_blocks_light(mat) for mat in mesh.materials]
        mesh.calc_loop_triangles()
        triangles.extend([offset + index for index in face.vertices]
                         for face in mesh.loop_triangles if not opaque or opaque[face.material_index])
    tree = BVHTree.FromPolygons(positions, triangles, all_triangles=True)
    # Equal-area samples of the projected disk give a cosine-weighted hemisphere.
    rays = []
    for i in range(48):
        u = (i + .5) / 48
        angle = pi * (3 - sqrt(5)) * i
        rays.append((sqrt(u) * cos(angle), sqrt(u) * sin(angle), sqrt(1 - u)))
    radius = .26
    for obj in objects:
        mesh = obj.data
        normal_matrix = obj.matrix_world.to_3x3().inverted().transposed()
        values = []
        for vertex in mesh.vertices:
            normal = (normal_matrix @ vertex.normal).normalized()
            if normal.length_squared < .5:
                values.append(0.)
                continue
            tangent = normal.orthogonal().normalized()
            bitangent = normal.cross(tangent)
            origin = obj.matrix_world @ vertex.co + normal * .0012
            blocked = total = 0.
            for x, y, z in rays:
                ray = tangent * x + bitangent * y + normal * z
                # Most indirect illumination in the level comes from above.
                weight = .4 + .6 * max(0., ray.z)
                total += weight
                distance = tree.ray_cast(origin, ray, radius)[3]
                if distance is not None:
                    blocked += weight * (1 - (distance / radius) ** 2)
            values.append(min(.85, blocked / total))
        attr = mesh.attributes.get('_HERO_OCC') or mesh.attributes.new('_HERO_OCC', 'FLOAT', 'POINT')
        attr.data.foreach_set('value', values)
