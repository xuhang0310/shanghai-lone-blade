"""Fit CC0 MakeHuman head topology and accessories to the game bind pose.

Source files are read from the --makehuman-source directory. See art/角色素材来源.md.
"""
import io
import tempfile
import zipfile
from pathlib import Path

import bpy
import bmesh
import numpy as np
from PIL import Image
from braided_hair import groom_maps, groom_shape
from portrait_materials import bake_skin, packed_image, surface_maps
from shen_portrait import FaceSculpt


def obj(text):
    positions, uvs, faces, groups = [], [], [], []
    group = ''
    for line in text.splitlines():
        fields = line.split()
        if not fields:
            continue
        if fields[0] == 'v':
            positions.append(tuple(map(float, fields[1:4])))
        elif fields[0] == 'vt':
            uvs.append(tuple(map(float, fields[1:3])))
        elif fields[0] == 'g':
            group = fields[1]
        elif fields[0] == 'f':
            faces.append([(int(a.split('/')[0])-1, int(a.split('/')[1])-1) for a in fields[1:]])
            groups.append(group)
    return np.asarray(positions), np.asarray(uvs), faces, groups


def fit_accessory(text, shaped):
    rows, scale = [], np.ones(3)
    reading = False
    for line in text.splitlines():
        fields = line.split()
        if not fields:
            continue
        if fields[0] in ('x_scale','y_scale','z_scale'):
            axis = 'xyz'.index(fields[0][0])
            a,b = map(int, fields[1:3])
            scale[axis] = abs(shaped[a,axis]-shaped[b,axis])/float(fields[3])
        if fields[0] == 'verts':
            reading = True
        elif reading and fields[0].isdigit():
            if len(fields) == 1:
                rows.append(shaped[int(fields[0])])
            elif len(fields) == 9:
                refs = list(map(int,fields[:3]))
                rows.append(np.array(fields[3:6],float) @ shaped[refs] + np.array(fields[6:9],float)*scale)
            else:
                break
        elif reading and rows:
            break
    return np.array(rows)


def textured_mesh(ctx,name,points,uvs,faces,weight,source,image_file,limit,roughness,alpha=False,tint=None,groom=None):
    # Crop to the UV islands actually used by this object, particularly the head
    # at the edge of the full-body atlas. Keep two pixels of texture gutter.
    uv = uvs.copy()
    used_uv = [t for face in faces for _, t in face]
    im = Image.open(io.BytesIO(source.read(image_file))).convert('RGBA' if alpha else 'RGB')
    surface = None
    if name in ('ShenPortrait', 'LuPortrait'):
        is_ranger = name == 'ShenPortrait'
        uv, (im, normals, roughness_map) = bake_skin(im, uv, faces, points, is_ranger)
        surface = (packed_image(name+' • pore relief', normals, data=True),
                   packed_image(name+' • skin response', roughness_map, data=True))
    else:
        low = np.maximum(0, np.floor(uv[used_uv].min(0)*im.size) - 2).astype(int)
        high = np.minimum(im.size, np.ceil(uv[used_uv].max(0)*im.size) + 2).astype(int)
        uv = (uv * im.size - low)/(high-low)
        im = im.crop((low[0],im.height-high[1],high[0],im.height-low[1]))
        im.thumbnail((limit,limit), Image.Resampling.LANCZOS)
    if tint is not None:
        values = np.array(im)
        values[:,:,:3] = np.clip(values[:,:,:3]*np.array(tint),0,255).astype(np.uint8)
        im = Image.fromarray(values)
    if groom is not None:
        im, groom_normal, groom_roughness = groom_maps(im,uv,points,groom)
    if name.startswith('eyebrow'):
        values = np.array(im)
        values[:,:,:3] = np.minimum(255, values[:,:,:3]*.74 + [29,24,22]).astype(np.uint8)
        if name == 'eyebrow001':
            values[:,:,3] = (values[:,:,3] * .70).astype(np.uint8)
        im = Image.fromarray(values)
    with tempfile.TemporaryDirectory() as tmp:
        f = Path(tmp) / (name + ('.png' if alpha else '.jpg'))
        im.save(f, **({} if alpha else {'quality':94}))
        image = bpy.data.images.load(str(f))
        image.name = name
        image.pack()
    mat = ctx.mat(name, '#ffffff',roughness)
    nt=mat.node_tree
    p=nt.nodes.get('Principled BSDF')
    tex=nt.nodes.new('ShaderNodeTexImage')
    tex.image=image
    nt.links.new(tex.outputs['Color'],p.inputs['Base Color'])
    if surface is not None:
        surface_maps(mat,*surface,.70)
        p.inputs['Subsurface Weight'].default_value=.065
        p.inputs['Subsurface Radius'].default_value=(.8,.34,.20)
        p.inputs['Subsurface Scale'].default_value=.0014
        p.inputs['Specular IOR Level'].default_value=.34
    if groom is not None:
        surface_maps(mat,packed_image(name+' • fibre relief',groom_normal,True),
                     packed_image(name+' • fibre response',groom_roughness,True),.81)
        p.inputs['Specular IOR Level'].default_value=.245
    if alpha:
        # A clipped hair card writes depth and supports multiple overlapping
        # locks without translucent sorting artifacts in WebGL.
        if name.startswith('eyebrow'):
            nt.links.new(tex.outputs['Alpha'],p.inputs['Alpha'])
            mat.surface_render_method='BLENDED'
        else:
            step=nt.nodes.new('ShaderNodeMath')
            step.operation='GREATER_THAN'
            step.inputs[1].default_value=.29
            nt.links.new(tex.outputs['Alpha'], step.inputs[0])
            nt.links.new(step.outputs[0],p.inputs['Alpha'])
            mat.surface_render_method='DITHERED'
    used=sorted({v for face in faces for v,_ in face})
    ix={v:i for i,v in enumerate(used)}
    ps=points[used]
    mesh=ctx.mesh(name,ps,[[ix[v] for v,_ in face] for face in faces],
                  [weight(v) for v in ps],[0]*len(faces),[mat]).data
    layer=mesh.uv_layers.new(name='Appearance')
    for f,loops in zip(faces,mesh.polygons):
        for (_,t),k in zip(f,loops.loop_indices):
            layer.data[k].uv=uv[t]
    return mesh


def fitted_eyes(ctx, frame, helpers):
    # A continuous opaque globe avoids exposing the atlas's red tear-duct
    # island when the camera sees an oblique angle through the eyelids.
    from math import cos, sin, pi
    from PIL import Image
    vertices,faces,uvs=[],[],[]
    for cloud in helpers:
        pts=frame(cloud)
        center=(pts.min(0)+pts.max(0))/2
        radii=(pts.max(0)-pts.min(0))/2
        radii[2]*=1.09
        # The lower lid sits behind the upper lid in profile. Keep the cornea
        # inside both margins so that the sphere cannot erase the lower lid.
        center[2]-=.0020
        start=len(vertices)
        for j in range(33):
            lat=(j/32-.5)*pi
            for i in range(65):
                lon=(i/64-.5)*2*pi
                vertices.append(center+radii*(sin(lon)*cos(lat),sin(lat),cos(lon)*cos(lat)))
                uvs.append((i/64,j/32))
                if i and j:
                    a=start+j*65+i
                    faces.append((a-66,a-65,a,a-1))
    h,w=256,512
    py,px=np.mgrid[:h,:w]
    lon=((px+.5)/w-.5)*2*pi
    lat=(.5-(py+.5)/h)*pi
    x,y=np.sin(lon)*np.cos(lat),np.sin(lat)
    rad=np.hypot(x,y)
    rgb=np.zeros((h,w,3))+[209,201,194]
    shade=np.clip(.97-.12*np.maximum(0,y)-.11*np.minimum(1,abs(x)),.65,1)
    rgb*=shade[:,:,None]
    iris=(rad<.46)&(np.cos(lon)>0)
    angle=np.arctan2(y,x)
    fil=.5+.25*np.sin(67*angle+13*rad)+.11*np.cos(151*angle-rad*29)
    ring=(.68+.35*fil+.14*np.cos(rad*35))*(.78-.22*y)
    iris_rgb=ring[:,:,None]*[114,73,40]
    iris_rgb[(rad>.405)&iris]*=.63
    rgb[iris]=iris_rgb[iris]
    pupil=(rad<.206)&iris
    rgb[pupil]=[26,22,20]
    spot=(np.exp(-((x+.115)/.050)**2-((y-.115)/.050)**2)*.45+
          np.exp(-((x-.081)/.025)**2-((y+.100)/.022)**2)*.10)*iris
    rgb=rgb*(1-spot[:,:,None])+np.array([246,238,221])*spot[:,:,None]
    with tempfile.TemporaryDirectory() as tmp:
        file=Path(tmp)/'Dark amber iris.png'
        Image.fromarray(np.uint8(np.clip(rgb,0,255))).save(file)
        image=bpy.data.images.load(str(file));image.pack()
    mat=ctx.mat('Eyes • amber brown','#ffffff',.16)
    node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=image
    mat.node_tree.links.new(node.outputs['Color'],mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    mesh=ctx.mesh('Eyes',vertices,faces,[{'Head':1}]*len(vertices),[0]*len(faces),[mat]).data
    layer=mesh.uv_layers.new(name='Iris')
    for loop in mesh.loops:
        layer.data[loop.index].uv=uvs[loop.vertex_index]


def build_portrait(ctx, variant, directory):
    female=variant=='xia'
    sex='female' if female else 'male'
    base,uv,faces,groups=obj((directory/'base.obj').read_text(encoding='utf8'))
    target=np.loadtxt(directory/f'asian-{sex}-young.target')
    shaped=base.copy()
    shaped[target[:,0].astype(int)] += target[:,1:]
    if not female:
        mature=np.loadtxt(directory/'asian-male-old.target')
        aged=base.copy()
        aged[mature[:,0].astype(int)]+=mature[:,1:]
        shaped=.90*shaped+.10*aged
    def joint(name):
        vertices={v for f,g in zip(faces,groups) if g==name for v,_ in f}
        return shaped[sorted(vertices)].mean(0)
    neck,eye=joint('joint-neck'),joint('joint-l-eye')
    scale=(.875-.703)/(eye[1]-neck[1])
    def frame(coords):
        pts=(coords-neck)*scale+[-.007,.703,.048]
        # Give each portrait individual proportions, with eyes and accessories
        # sampled through the same continuous sculpt field as the skin.
        x,y,z=pts.T.copy()
        jaw=np.exp(-((y-.799)/.049)**2)
        cheek=np.exp(-((y-.856)/.031)**2)
        pts[:,0]=-.007+(x+.007)*(1+(-.09 if female else -.048)*jaw+.016*cheek)
        pts[:,2]+=(.002 if female else .006)*np.exp(-((y-.901)/.018)**2)*np.clip((z-.13)/.06,0,1)
        if not female:
            brow=np.exp(-((y-.900)/.013)**2)*np.exp(-((abs(x+.007)-.028)/.037)**2)
            pts[:,1]-=.0015*brow*np.clip((z-.13)/.06,0,1)
        ax=np.abs(x+.007)
        front=np.clip((z-.115)/.075,0,1)
        def bell(d,w):
            return np.exp(-(d/w)**2)
        # Buccal hollow below the cheekbone and forward chin create readable
        # planar changes at the portrait and game camera distances.
        hollow=bell(ax-.064,.031)*bell(y-.819,.033)
        malar=bell(ax-.064,.031)*bell(y-.851,.022)
        pts[:,2]+=front*((.004 if female else .006)*malar-(.005 if female else .008)*hollow
                         +(.003 if female else .007)*bell(x+.007,.030)*bell(y-.747,.016))
        pts[:,0]-=np.sign(x+.007)*front*(.002 if female else .003)*hollow
        # Bring the relaxed lip edges together without collapsing the lip line.
        seam=.792 if female else .778
        lip=bell(y-seam,.016)*bell((x+.007),.044)*front
        pts[:,1]-=.47*(y-seam)*lip
        # Squint lifts the lower lid and lowers its upper edge at centre;
        # the inner and outer corners stay anchored.
        lid=bell(ax-.039,.016)*bell(y-.872,.012)*front
        pts[:,1]-=(.21 if female else .045)*(y-.872)*lid
        return pts
    coords=frame(shaped)
    throat=np.clip((.752-coords[:,1])/.09,0,1)
    coords[:,0]=-.007+(coords[:,0]+.007)*(1-.34*throat)
    coords[:,2]=.048+(coords[:,2]-.048)*(1-.56*throat)
    sculpt = None if female else FaceSculpt()
    if sculpt is not None:
        coords = sculpt(coords)

    def accessory_frame(points):
        fitted = frame(points)
        return fitted if sculpt is None else sculpt(fitted)

    body_faces=[f for f,g in zip(faces,groups) if g=='body' and
                all(coords[v,1]>.630 and (coords[v,1]>.705 or abs(coords[v,0]+.007)<.095) for v,_ in f)]
    # Hide the legacy head and preserve the hands, trousers and game skeleton.
    body=ctx.body.data
    edit=bmesh.new();edit.from_mesh(body)
    bmesh.ops.delete(edit,geom=[f for f in edit.faces if f.material_index==0],context='FACES')
    edit.to_mesh(body);edit.free()
    body.materials.pop(index=0)
    def head_weight(p):
        h=np.clip((p[1]-.730)/.057,0,1)
        neck=np.clip((p[1]-.684)/.067,0,1)
        return {'Head':h,'Neck':(1-h)*neck,'Spine2':(1-h)*(1-neck)}
    with zipfile.ZipFile(next(p for p in directory.glob('*.zip') if zipfile.is_zipfile(p))) as assets:
        skin=('skins/young_asian_female/young_lightskinned_female_diffuse3.png' if female
              else 'skins/young_asian_male/young_lightskinned_male_diffuse3.png')
        textured_mesh(ctx,'LuPortrait' if female else 'ShenPortrait',coords,uv,body_faces,head_weight,assets,skin,1024,.58)
        fitted_eyes(ctx,accessory_frame,[shaped[sorted({v for f,g in zip(faces,groups) if g==name for v,_ in f})]
                              for name in ('helper-l-eye','helper-r-eye')])
        hair='braid01'
        brow='eyebrow010' if female else 'eyebrow001'
        accessories = [(f'eyebrows/{brow}', brow, f'eyebrows/{brow}/{brow}.png', True, 384)]
        if female:
            accessories.append((f'hair/{hair}', hair, f'hair/{hair}/{hair}_diffuse.png', True, 1024))
        else:
            from shen_hair import build_side_part
            build_side_part(ctx, coords, body_faces)
        for folder,meshname,image,alpha,limit in accessories:
            pref=f'{folder}/{meshname}'
            raw,uvs,fs,_=obj(assets.read(pref+'.obj').decode('utf8'))
            fitted=fit_accessory(assets.read(pref+'.mhclo').decode('utf8'), shaped)
            assert len(raw)==len(fitted), (meshname,len(raw),len(fitted))
            pos=accessory_frame(fitted)
            groom=None
            if meshname==brow:
                pos[:,2]+=.0013
            if female and meshname==hair:
                # Bring the braid off the spine and over the left shoulder blade.
                low=np.clip((.86-pos[:,1])/.34,0,1)
                pos[:,0]+=.104*low
                pos[:,2]-=.065*low
                pos,uvs,fs,groom=groom_shape(pos,uvs,fs)
            def weight(p):
                if meshname!=hair or not female:
                    return {'Head':1}
                on_back=np.clip((.82-p[1])/.17,0,1)
                return {'Head':1-on_back,'Spine2':on_back}
            textured_mesh(ctx,meshname,pos,uvs,fs,weight,assets,image,limit,
                          .43 if meshname==hair else .40,alpha,
                          (.78,.84,.88) if meshname==hair else None,groom)
