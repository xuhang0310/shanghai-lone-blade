"""Dress the hero meshes with directional folds and photographed PBR surfaces."""
import math
from pathlib import Path
import tempfile

import bpy
import numpy as np
from PIL import Image


SOURCES = Path(__file__).resolve().parents[1] / 'art' / 'textiles'
SPLIT = .6875
TWOPI = math.tau


def rounded_profile(measurements, spacing=.005):
    """Densify measured sections with a slope-limited cubic, preserving extrema."""
    data=np.asarray(measurements)
    y,sections=data[:,0],data[:,1:]
    dy=np.diff(y)[:,None]
    secants=np.diff(sections,axis=0)/dy
    tangent=np.zeros_like(sections)
    tangent[0],tangent[-1]=secants[0],secants[-1]
    # The weighted harmonic mean flattens local peaks and avoids overshoot.
    left,right=secants[:-1],secants[1:]
    a,b=2*dy[1:]+dy[:-1],dy[1:]+2*dy[:-1]
    np.divide((a+b)*left*right,a*right+b*left,out=tangent[1:-1],where=left*right>0)
    levels=np.unique(np.concatenate((y,np.linspace(y[0],y[-1],math.ceil((y[-1]-y[0])/spacing)+1))))
    i=np.clip(np.searchsorted(y,levels,side='right')-1,0,len(dy)-1)
    t=(levels-y[i])[:,None]/dy[i]
    smoothed=(1+2*t)*(1-t)**2*sections[i] + t*(1-t)**2*dy[i]*tangent[i]
    smoothed+=t*t*(3-2*t)*sections[i+1] + t*t*(t-1)*dy[i]*tangent[i+1]
    return np.column_stack((levels,smoothed)).tolist()


def crease(distance, width, strength, exp):
    # An asymmetric rolled fold with a shadow pocket on the compressed side.
    d = distance / width
    return strength * (exp(-d*d) - .62 * exp(-((d + 1.08) / .76)**2))


def folds(angle, y, sleeve, female=False):
    """Return radial displacement in the original bind-pose length units."""
    lib = math if np.isscalar(angle) and np.isscalar(y) else np
    sn, cs, ex = lib.sin, lib.cos, lib.exp
    if sleeve:
        # Tension radiates from the front/inside of the slightly bent elbow.
        bend = (.5 + .5 * cs(angle - .60))**1.35
        wrist = (.5 + .5 * cs(angle + 1.4))**1.65
        drape = 0
        for anchor, slant, size, width, gain in (
            (.298, .032, .008, .012, .65 + .35*bend),
            (.341, -.024, .014, .012, .38 + .62*bend),
            (.376, .034, .019, .014, .27 + .73*bend),
            (.414, .026, .014, .011, .33 + .67*bend),
            (.467, -.047, .009, .016, .31 + .69*bend),
            (.190, -.031, .009, .010, wrist),
            (.224, -.038, .007, .013, wrist),
            (.544, .052, .008, .012, .45+.55*bend),
        ):
            path = anchor + slant*sn(angle+.25) + .007*sn(2*angle+anchor*9)
            # A fold dies away before it can run full circle around a sleeve.
            taper=.21+.79*(.5+.5*cs(angle-anchor*23))**.85
            drape += taper*gain * crease(y-path, width*1.13, size, ex)
        return drape * (.64 if female else .73)
    side = sn(angle)
    back = .5-.5*cs(angle)
    # Fabric bunches over the belt. These tapered ridges cross the back
    # obliquely and fan into the armscye; their ends die out at the placket.
    fullness = (.12+.88*back) if female else (.36+.64*back)
    drape = 0
    for anchor,slope,bow,width,amp,phase in (
        (.295,.063,-.019,.011,.013,.2), (.332,-.036,.021,.013,.013,1.2),
        (.413,.087,.038,.015,.011,2.4), (.548,-.060,.065,.014,.010,1.7),
        (.157,-.042,.021,.013,.011,3.0),
    ):
        h = anchor + slope*side + bow*cs(2*angle+.44)
        end = (.12+.88*(.5+.5*cs(angle-phase))**1.5)*fullness
        drape += .65*end * crease(y-h,width*1.2,amp,ex)
    # Long, tapered folds at the side fronts and below the rear box pleat.
    skirt = np.clip((.215-y)/(.25 if female else .5),0,1) if lib is np else max(0,min(1,(.215-y)/(.25 if female else .5)))
    for a,amp in ((.74,.012),(1.93,.019),(2.68,.016),(-2.36,.020),(-1.25,.014),(-.56,.010)):
        dist = 2*sn((angle-a-.22*skirt)/2)
        drape += skirt*crease(dist,.115,amp,ex)
    return drape


def photo(name, suffix):
    path = SOURCES / f'{name}-{suffix}.jpg'
    return np.asarray(Image.open(path).convert('RGB' if suffix == 'normal' else 'L'),dtype=np.float32)/255


def packed_image(name, pixels, data=False):
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / (name + '.jpg')
        Image.fromarray(np.uint8(np.clip(pixels,0,1)*255+.5)).save(path,quality=91,subsampling=0)
        img = bpy.data.images.load(str(path))
        img.name = name
        if data:
            img.colorspace_settings.name='Non-Color'
        img.pack()
    return img


def scan_image(scan, suffix):
    name=f'{scan} · {suffix}'
    img=bpy.data.images.get(name)
    if not img:
        img=bpy.data.images.load(str(SOURCES/f'{scan}-{suffix}.jpg'))
        img.name=name
        if suffix!='tone':
            img.colorspace_settings.name='Non-Color'
        img.pack()
    return img


def material_surface(mat, images, roughness, strength):
    nodes=mat.node_tree.nodes
    links=mat.node_tree.links
    shader=nodes.get('Principled BSDF')
    def image(img, label):
        node=nodes.new('ShaderNodeTexImage')
        node.image=img
        node.label=label
        return node.outputs['Color']
    dye=nodes.new('ShaderNodeMix')
    dye.data_type='RGBA'
    dye.blend_type='MULTIPLY'
    dye.inputs[0].default_value=1
    dye.inputs[7].default_value=shader.inputs['Base Color'].default_value[:]
    links.new(image(images[0],'Pigment and wear'),dye.inputs[6])
    links.new(dye.outputs[2],shader.inputs['Base Color'])
    n=nodes.new('ShaderNodeNormalMap')
    n.inputs['Strength'].default_value=strength
    links.new(image(images[1],'Surface grain'),n.inputs['Color'])
    links.new(n.outputs['Normal'],shader.inputs['Normal'])
    # Pack the roughness into its glTF green channel alongside zero metallic.
    separate=nodes.new('ShaderNodeSeparateColor')
    links.new(image(images[2],'Roughness'),separate.inputs[0])
    scalar=nodes.new('ShaderNodeMath')
    scalar.operation='MULTIPLY'
    scalar.inputs[1].default_value=roughness
    links.new(separate.outputs['Green'],scalar.inputs[0])
    links.new(scalar.outputs[0],shader.inputs['Roughness'])


def apply_scan(material, scan, roughness=1., normal_strength=.55):
    """Apply a repeating photographed surface to an existing physical-scale UV."""
    if material.get('scanApplied'):
        return
    material_surface(material,[scan_image(scan,s) for s in ('tone','normal','rough')],roughness,normal_strength)
    material['scanApplied']=True


def garment_uv(obj, positions, sleeve_faces, torso_profile, sleeve_profile, sample):
    """Keep separate, padded UV panels for torso and sleeve. Grain follows the cut."""
    mesh=obj.data
    uv=mesh.uv_layers.active or mesh.uv_layers.new(name='Tailor cut')
    uv.name='Tailor cut'
    for face in mesh.polygons:
        sleeve=sleeve_faces[0]<=face.index<sleeve_faces[1]
        turns=[]
        for index in face.vertices:
            x,y,z=positions[index]
            if sleeve:
                cx,rx,back,front=sample(sleeve_profile,y)
                sign=1 if x>-.007 else -1
                x=(x+.007)*sign-cx-.006
                width=rx
            else:
                width,back,front=sample(torso_profile,y)
                x+=.007
            theta=math.atan2(x/max(.003,width),(z-(back+front)/2)/max(.004,(front-back)/2))
            t=theta/TWOPI+.5
            if turns:
                t+=round(turns[0]-t)
            turns.append(t)
        # The cloth panel has a cut at the back; hardware that straddles it
        # wraps as a whole instead of interpolating across the arm's UV island.
        shift=math.floor(sum(turns)/len(turns))
        for loop,index,u in zip(face.loop_indices,face.vertices,turns):
            y=positions[index][1]
            start,end=(SPLIT+.01,.99) if sleeve else (.01,SPLIT-.01)
            uv.data[loop].uv=(start+(u-shift)*(end-start),(y-.055)/.70 if sleeve else (y+.405)/1.186)


def garment_atlas(female):
    name='Indigo cotton' if female else 'Travel leather'
    scan='rough_linen' if female else 'brown_leather'
    sources={k:photo(scan,k) for k in ('tone','normal','rough')}
    size=1024
    row,col=np.mgrid[:size,:size].astype(np.float32)
    u,v=(col+.5)/size,1-(row+.5)/size
    sleeve=u>=SPLIT
    turn=np.where(sleeve,(u-SPLIT-.01)/(.98-SPLIT),(u-.01)/(SPLIT-.02))
    a=(turn-.5)*TWOPI
    y=np.where(sleeve,.055+v*.70,-.405+v*1.186)
    repeat=.27 if female else .40
    # The small jitter is coherent with the grain, so the photograph follows
    # the bias of the cut across folds instead of forming a rigid screen grid.
    uu=(turn*np.where(sleeve,.45,1.12)+.004*np.sin(2*a+9*y))/repeat
    vv=(y+.006*np.cos(a-.5))/repeat
    def tile(pic):
        return pic[((-vv*pic.shape[0]).astype(np.int32))%pic.shape[0],
                   ((uu*pic.shape[1]).astype(np.int32))%pic.shape[1]]
    height=np.where(sleeve,folds(a,y,True,female),folds(a,y,False,female))
    # Stitch impressions along the back and side seams; a faint crescent
    # below each elbow catches the lustre of handled fabric or broken-in hide.
    seam_pos=np.where(sleeve, .56+.019*np.sin(y*5), .5+.003*np.sin(y*8))
    def seam(location, width):
        d=(turn-location+.5)%1-.5
        return np.exp(-(d/width)**2)
    seam1=seam(seam_pos,np.where(sleeve,.0063,.0028))
    sides=seam(.24+.014*np.sin(6*y),.0033)+seam(.76-.014*np.sin(6*y),.0033)
    onback=seam(0,.0028)
    seam1=np.where(sleeve,seam1,.55*sides+.85*onback)
    stitch=seam(seam_pos+.004,.0018)*(.5+.5*np.sin(TWOPI*y/.009))**3
    if not female:
        stitch+=seam(.006,.0013)*(.5+.5*np.sin(TWOPI*y/.010))**3
    texture=tile(sources['tone'])
    variation=.026*np.sin(3*a+11*y)+.022*np.sin(4*a-27*y)+.014*np.cos(a+52*y)
    tone=np.clip(texture*(1+variation) + np.clip(height/.015,-1,1)*.028 - seam1*.11 + stitch*.08,0,1)
    # The map augments only the crease shoulders: the broad folds already exist
    # as geometry and must continue to cast their own moving shadows.
    small=.22*height-.00057*seam1+.00026*stitch
    dx=np.gradient(small,axis=1)*size*np.where(sleeve,(.98-SPLIT)/.45,(SPLIT-.02)/1.12)
    dy=-np.gradient(small,axis=0)*size/np.where(sleeve,.70,1.186)
    normal=tile(sources['normal'])*2-1
    normal[:,:,:2]*=.50 if female else .72
    normal[:,:,0]-=np.clip(dx,-.40,.40)
    normal[:,:,1]-=np.clip(dy,-.40,.40)
    normal/=np.maximum(np.linalg.norm(normal,axis=2,keepdims=True),.001)
    nr=tile(sources['rough'])
    rough=np.clip((.78 if female else .55)+(.40 if female else .68)*(nr-np.mean(nr))
                  -.055*np.clip(height/.014,0,1)+.045*seam1+variation,.24,.98)
    orm=np.stack((np.ones_like(rough),rough,np.zeros_like(rough)),axis=-1)
    return [packed_image(name+' · dye',tone),packed_image(name+' · grain',normal*.5+.5,True),
            packed_image(name+' · roughness',orm,True)]
