"""Fit the swept fringe and prepare directional hair textures for Lu Qingwu."""
from collections import defaultdict

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


def groom_shape(points, uvs, faces):
    # The base coiffure covers the scalp. Eight single-quad-wide loops drawn
    # over it cross the forehead in midair after the individual head fit.
    neighbours = defaultdict(set)
    for face in faces:
        for (v,_),(w,_) in zip(face,face[1:]+face[:1]):
            neighbours[v].add(w)
            neighbours[w].add(v)
    keeper, overlays = set(), set()
    todo = set(neighbours)
    while todo:
        group = {todo.pop()}
        frontier = list(group)
        while frontier:
            unseen = neighbours[frontier.pop()] & todo
            todo.difference_update(unseen)
            group.update(unseen)
            frontier.extend(unseen)
        heights = points[list(group),1]
        if heights.max() > 1.0:
            keeper = group
        elif heights.min() > .70 and heights.max() > .91 and len(group) <= 64:
            overlays.update(group)
    excluded = keeper | overlays
    rest = [face for face in faces if face[0][0] not in excluded]
    shell = [face for face in faces if face[0][0] in keeper]
    if not shell:
        raise ValueError('Braided hairstyle is missing its scalp mesh')

    # A single Catmull-Clark step rounds the silhouette and the long hair
    # sections. UV interpolation stays on its own side of a seam.
    new_points = list(points)
    new_uvs = list(uvs)
    centers = [points[[v for v,_ in face]].mean(0) for face in shell]
    faces_at = defaultdict(list)
    edges = defaultdict(list)
    for f, face in enumerate(shell):
        for (v,_),(w,_) in zip(face,face[1:]+face[:1]):
            faces_at[v].append(f)
            edges[tuple(sorted((v,w)))].append(f)
    edge_points = {}
    boundary = defaultdict(list)
    for (v,w), linked in edges.items():
        q = (points[v]+points[w])*.5
        if len(linked)==2:
            q = (q+(centers[linked[0]]+centers[linked[1]])*.5)*.5
        else:
            boundary[v].append(w)
            boundary[w].append(v)
        edge_points[v,w] = len(new_points)
        new_points.append(q)
    for v in keeper:
        if v in boundary:
            new_points[v] = .75*points[v]+.25*points[boundary[v]].mean(0)
        else:
            n=len(faces_at[v])
            center=np.mean([centers[f] for f in faces_at[v]],0)
            edge_mean=(points[v]+points[list(neighbours[v])].mean(0))*.5
            new_points[v]=(center+2*edge_mean+(n-3)*points[v])/n
    rounded = []
    def add_uv(value):
        new_uvs.append(value)
        return len(new_uvs)-1
    for face, center in zip(shell,centers):
        center_id = len(new_points)
        new_points.append(center)
        center_uv = add_uv(uvs[[u for _,u in face]].mean(0))
        for i, (v,u) in enumerate(face):
            prev,up=face[i-1]
            next_v,un=face[(i+1)%len(face)]
            a=edge_points[tuple(sorted((v,next_v)))]
            b=edge_points[tuple(sorted((prev,v)))]
            rounded.append([(v,u),(a,add_uv((uvs[un]+uvs[u])*.5)),(center_id,center_uv),
                            (b,add_uv((uvs[up]+uvs[u])*.5))])
    return np.array(new_points),np.array(new_uvs),rest+rounded,rounded


def groom_maps(image, uv, points, shell):
    w,h=image.size
    values=np.array(image)
    lum=np.array(image.convert('L'),np.float32)
    dy,dx=np.gradient(lum)

    def average(data,r):
        pad=np.pad(data,((r,r),(r,r)),mode='edge')
        total=np.pad(pad,((1,0),(1,0))).cumsum(0,dtype=np.float64).cumsum(1)
        s=2*r+1
        return ((total[s:,s:]-total[s:,:-s]-total[:-s,s:]+total[:-s,:-s])/(s*s)).astype(np.float32)

    # Derive the flow direction from the original photograph's strand
    # structure tensor. The weak prior follows the sweep in its native UV.
    py,px=np.indices((h,w),np.float32)
    default=np.where(py/h>.70,-.70*np.sin((px/w-.49)*np.pi*2),.81)
    a=average(dy*dy-dx*dx,6)+.50*np.cos(2*default)
    b=average(-2*dx*dy,6)+.50*np.sin(2*default)
    theta=.5*np.arctan2(b,a)
    tx,ty=np.cos(theta),np.sin(theta)
    rng=np.random.default_rng(38941)
    noise=rng.standard_normal((h,w)).astype(np.float32)
    def blurred_along(length):
        summed=np.zeros_like(lum)
        total=0
        for s in range(-length,length+1):
            weight=1-abs(s)/(length+1)
            iy=np.clip(np.rint(py+s*ty).astype(int),0,h-1)
            ix=np.clip(np.rint(px+s*tx).astype(int),0,w-1)
            summed+=weight*noise[iy,ix]
            total+=weight
        strand=summed/total
        return np.clip(strand/max(.01,strand.std()),-2.6,2.6)

    strands=blurred_along(10)
    sheet=np.asarray(image,dtype=np.float32)[:,:,:3]
    variation=(strands*(3.6+.056*lum))[...,None]
    color=.85*sheet + .14*np.sqrt(sheet/255)*255 + variation + [2,1,1]
    values[:,:,:3]=np.uint8(np.clip(color,0,255))

    # Only the cut edge visible against the forehead and temples is feathered.
    # Keep a completely opaque scalp and braid beneath the inner margin.
    edges=defaultdict(list)
    for face in shell:
        for va,vb in zip(face,face[1:]+face[:1]):
            edges[tuple(sorted((va[0],vb[0])))].append((va[1],vb[1]))
    outline=Image.new('L',(w,h))
    draw=ImageDraw.Draw(outline)
    for (i,j),coords in edges.items():
        x,y,z=(points[i]+points[j])*.5
        if len(coords)==1 and y>.792 and z>.081:
            p,q=uv[list(coords[0])]*[w,-h]+[0,h]
            draw.line([tuple(p),tuple(q)],fill=255,width=2)
    dist=np.full((h,w),16,np.float32)
    ring=outline
    for i in range(14):
        dist[np.asarray(ring)>0]=np.minimum(dist[np.asarray(ring)>0],i)
        ring=ring.filter(ImageFilter.MaxFilter(3))
    cutoff=1.8+.7*average(strands,1)+.8*np.sin(px*.027+py*.041)
    alpha=np.clip((dist-cutoff)*.48+.52,0,1)
    values[:,:,3]=np.uint8(values[:,:,3]*alpha)

    # Strand relief and fibre-dependent roughness break the long crown
    # highlight into soft, aligned ribbons under moving game lights.
    relief=.100*strands+.006*lum
    dy,dx=np.gradient(relief)
    normal=np.stack((-dx,dy,np.ones_like(dx)),axis=-1)
    normal/=np.linalg.norm(normal,axis=2,keepdims=True)
    roughness=np.clip(.60-.18*(lum/255)-.046*strands,.41,.73)
    orm=np.stack((np.ones_like(lum),roughness,np.zeros_like(lum)),axis=-1)
    return Image.fromarray(values),Image.fromarray(np.uint8((normal*.5+.5)*255)),Image.fromarray(np.uint8(orm*255))
