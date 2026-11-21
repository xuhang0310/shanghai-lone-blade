"""Shen's portrait study in the bind-space coordinates of the game mesh."""

from pathlib import Path

import numpy as np
from PIL import Image


class FaceSculpt:
    """A smooth 3D landmark fit shared by skin, eyelids, eyeballs and brows."""

    def __init__(self):
        path = Path(__file__).with_name('shen_face_cage.csv')
        cage = np.loadtxt(path, delimiter=',', skiprows=1, usecols=range(2, 8))
        # Solve in units of one decimetre. A small regularizer keeps the lip
        # and eyelid margins distinct even where neighbouring anchors almost meet.
        self.centres = cage[:, :3] * 10
        n = len(cage)
        distances = np.linalg.norm(self.centres[:, None] - self.centres, axis=2)
        linear = np.column_stack((np.ones(n), self.centres))
        matrix = np.block([[distances - 0.028 * np.eye(n), linear], [linear.T, np.zeros((4, 4))]])
        coefficients = np.linalg.solve(matrix, np.vstack((cage[:, 3:], np.zeros((4, 3)))))
        self.weights = coefficients[:n]
        self.affine = coefficients[n:]

    def __call__(self, vertices):
        positions = vertices.copy()
        head = vertices[:, 1] > 0.704
        points = vertices[head] * 10
        distances = np.linalg.norm(points[:, None] - self.centres, axis=2)
        offsets = (
            distances @ self.weights + np.column_stack((np.ones(len(points)), points)) @ self.affine
        )
        neck = np.clip((vertices[head, 1] - 0.704) / 0.043, 0, 1)
        positions[head] += offsets * (neck * neck * (3 - 2 * neck))[:, None]
        return positions


def apply_complexion(colors, coordinates, skin_detail):
    """Transfer the de-lit colour study to the front UV islands.

    The alpha gradient ends before the ears and inside each eye opening.
    The skin atlas still supplies pores, and the separate eyes catch light.
    """
    path = Path(__file__).resolve().parents[1] / 'art/portrait-study/shen-complexion.png'
    study = np.asarray(Image.open(path).convert('RGBA'), dtype=np.float32)
    x, y, z = coordinates.transpose(2, 0, 1)
    region = (x > -0.112) & (x < 0.098) & (y > 0.725) & (y < 0.984) & (z > 0.127)
    h, w = study.shape[:2]
    u = np.clip((x[region] + 0.112) / 0.210 * w - 0.5, 0, w - 1.001)
    v = np.clip((0.984 - y[region]) / 0.259 * h - 0.5, 0, h - 1.001)
    i, j = u.astype(int), v.astype(int)
    du, dv = (u - i)[:, None], (v - j)[:, None]
    top = study[j, i] * (1 - du) + study[j, i + 1] * du
    bottom = study[j + 1, i] * (1 - du) + study[j + 1, i + 1] * du
    paint = top * (1 - dv) + bottom * dv
    alpha = paint[:, 3:4] / 255 * np.clip((z[region, None] - 0.127) / 0.035, 0, 1)
    target = paint[:, :3] + 0.80 * skin_detail[region, None]
    colors[region] += alpha * (target - colors[region])
