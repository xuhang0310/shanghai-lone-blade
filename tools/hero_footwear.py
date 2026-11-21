"""Lasted leather shoes and turned trouser cuffs, fitted to the Male rig."""
from math import cos, pi, sin


# Longitudinal sections of the last: forward position, centre, half-width,
# upper height and the slightly raised arch of the sole.
LAST = [
    (-.033, .152, .006, -.93, -.974), (-.028, .151, .031, -.865, -.977),
    (-.012, .152, .045, -.843, -.979), (.014, .155, .048, -.844, -.977),
    (.043, .161, .048, -.851, -.970), (.063, .169, .046, -.86, -.966),
    (.085, .177, .045, -.888, -.971), (.111, .185, .049, -.912, -.977),
    (.14, .193, .052, -.93, -.980), (.169, .196, .049, -.94, -.981),
    (.195, .196, .040, -.949, -.979), (.212, .195, .027, -.955, -.976),
    (.221, .194, .012, -.962, -.973), (.223, .193, .002, -.967, -.973),
]


def build_footwear(ctx):
    leather = ctx.mat('Oxfords • burnished calf', '#3e302b', .40)
    toe = ctx.mat('Oxfords • polished toecap', '#352824', .31)
    welt = ctx.mat('Oxfords • stacked sole', '#28221f', .65)
    welt_edge = ctx.mat('Oxfords • welt edge', '#524137', .51)
    lace = ctx.mat('Oxfords • waxed laces', '#413931', .63)
    flannel = ctx.mat('Flannel • trousers', '#383d42', .85)
    fold = ctx.mat('Flannel • turn-up edge', '#42464b', .86)
    slots = [leather, toe, welt, welt_edge, lace, flannel, fold]
    points, faces, weights, ids = [], [], [], []
    for sign, side in ((1, 'Left'), (-1, 'Right')):
        def strip(rows, material, cuff=False):
            start = len(points)
            n = len(rows[0])
            for row in rows:
                for x, y, z in row:
                    points.append((x if sign == 1 else -.0142-x, y, z))
                    toe_w = max(0., min(1., (z-.108)/.092))
                    if cuff:
                        weights.append({side+'Leg': .93, side+'Foot': .07})
                    else:
                        weights.append({side+'Foot': 1-toe_w, side+'ToeBase': toe_w})
            for r in range(len(rows)-1):
                for k in range(n-1):
                    a = start+r*n+k
                    quad = [a, a+1, a+n+1, a+n]
                    faces.append(quad if sign == 1 else quad[::-1])
                    ids.append(material(r, k) if callable(material) else material)

        def vamp(z, cx, rx, top, base, t):
            return (cx+rx*sin(t), base+.010+(top-base-.010)*max(0.,cos(t))**.78, z)

        # The vamp is cut over the sole. A separate projecting line of welt
        # runs uninterrupted around it, including the shaded arch underfoot.
        rows = [[vamp(z,cx,rx,top,base,-pi/2+pi*i/18) for i in range(19)]
                for z,cx,rx,top,base in LAST]
        strip(rows, lambda r,k: 1 if LAST[r][0] >= .14 else 0)
        for i in (0, -1):
            z,cx,rx,top,base = LAST[i]
            edge = [vamp(z,cx,rx,top,base,-pi/2+pi*j/18) for j in range(19)]
            strip([edge, [(x,base-.002,z) for x,y,z in edge]], 0)
        for direction in (-1, 1):
            strip([[(cx+direction*(rx+pad),base+dy,z) for pad,dy in
                    ((0,.011),(.003,.009),(.004,.006),(.004,.002),(.002,-.002))]
                   for z,cx,rx,top,base in LAST],lambda r,k:3 if k==1 else 2)
        strip([[(cx-rx-.002,base-.002,z),(cx+rx+.002,base-.002,z)]
               for z,cx,rx,top,base in LAST],2)

        def section(z):
            for a,b in zip(LAST,LAST[1:]):
                if a[0] <= z <= b[0]:
                    f = (z-a[0])/(b[0]-a[0])
                    return [v+(w-v)*f for v,w in zip(a,b)]
            raise ValueError(z)

        # Crossed waxed laces run along the actual sloping vamp.
        for z in (.067,.077,.087,.097):
            for direction in (-1,1):
                rows = []
                for i in range(8):
                    t=(i/7-.5)*1.13*direction
                    p=vamp(*section(z+(i/7-.5)*.010),t)
                    rows.append([(p[0],p[1]+.0018+sin(pi*i/7)*.0013,p[2]+dz)
                                 for dz in (-.0016,.0016)])
                strip(rows,4)
        strip([[vamp(*section(z),-1.52+3.04*i/22) for i in range(23)]
               for z in (.139,.1405)],3)

        # A rolled hem gives a clean cloth/leather junction on a flexed ankle.
        strip([[(cx+rx*cos(2*pi*i/32), y+.005*cos(2*pi*i/32),
                  cz+rz*sin(2*pi*i/32)) for i in range(33)]
               for y,cx,cz,rx,rz in ((-.805,.149,.030,.059,.055),
                                      (-.825,.152,.031,.060,.056),
                                      (-.832,.153,.032,.062,.059),
                                      (-.865,.155,.032,.059,.057),
                                      (-.870,.155,.032,.055,.054))],
              lambda r,k:6 if r==1 or r==3 else 5,cuff=True)
    ctx.mesh('HeroOxfords', points, faces, weights, ids, slots)
