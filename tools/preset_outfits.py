"""A leather travel coat and an indigo, side-opening Shanghai riding jacket."""
from math import asin, cos, exp, pi, sin, sqrt

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree

from hero_coat import BODY, OPENING, SLEEVE, build_coat, clamp, sample
from tailored_surface import folds, garment_atlas, garment_uv, material_surface, rounded_profile
from hero_footwear import build_footwear
from hero_head import _fedora


def recolor(ctx, material, color, roughness):
    mat = bpy.data.materials.get(material)
    if not mat:
        return
    value = int(color,16)
    rgb = [(value >> s & 255)/255 for s in (16,8,0)]
    linear = tuple(v/12.92 if v<.04045 else ((v+.055)/1.055)**2.4 for v in rgb)+(1,)
    mat.diffuse_color=linear
    p=mat.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=linear
    p.inputs['Roughness'].default_value=roughness


def torso(p):
    x,y,_=p
    if y<.18:
        hip=clamp((.18-y)/.245)*.83
        left=clamp(.5+(x+.007)/.09)
        return {'Hips':1-hip,'LeftUpLeg':hip*left,'RightUpLeg':hip*(1-left)}
    levels=[(.18,'Hips'),(.325,'Spine'),(.447,'Spine1'),(.565,'Spine2')]
    weights={levels[-1][1]:1}
    for (a,name),(b,nextname) in zip(levels,levels[1:]):
        if y <= b:
            k=clamp((y-a)/(b-a))
            weights={name:1-k,nextname:k}
            break
    shoulder=.54*clamp((abs(x+.007)-.065)/.14)*clamp((y-.52)/.135)
    neck=.54*(1-clamp((abs(x+.007)-.045)/.08))*clamp((y-.665)/.095)
    weights={n:w*(1-shoulder-neck) for n,w in weights.items()}
    weights['LeftShoulder' if x>-.007 else 'RightShoulder']=shoulder
    weights['Neck']=neck
    return weights


class Tailor:
    def __init__(self):
        self.vertices,self.faces,self.weights,self.slots=[],[],[],[]

    def panel(self,rows,slot,weight=torso):
        start=len(self.vertices)
        for i,row in enumerate(rows):
            width=len(row)
            for j,p in enumerate(row):
                self.vertices.append(tuple(p));self.weights.append(weight(p))
                if i and j:
                    k=start+i*width+j
                    self.faces.append((k-width-1,k-width,k,k-1))
                    self.slots.append(slot)

    def cord(self, path, radius, slot, weight=torso):
        rows=[]
        for i,p in enumerate(path):
            axis=Vector(path[min(i+1,len(path)-1)])-Vector(path[max(i-1,0)])
            axis.normalize()
            right=axis.cross(Vector((0,0,1)))
            if right.length < .001:
                right=axis.cross(Vector((0,1,0)))
            right.normalize(); up=axis.cross(right)
            rows.append([Vector(p)+radius*(right*cos(j*pi/4)+up*sin(j*pi/4)) for j in range(9)])
        self.panel(rows,slot,weight)


def fastener(cloth,x,y,front,span,mat):
    for sign in (-1,1):
        cx=x+sign*span*.47
        path=[front(cx+span*.51*cos(t),y+.0054*sin(t),.0038) for t in np.linspace(0,2*pi,23)]
        cloth.cord(path,.0018,mat)
    cloth.cord([front(x+dx,y+dy,.007) for dx,dy in
                ((-.004,-.002),(-.004,.003),(0,.005),(.004,.003),(.004,-.002),(0,-.004),(-.004,-.002))],
               .0029,mat)


def ranger(ctx):
    coat=build_coat(ctx, photographed=True)
    # Remove the original pointed shirt collar/tie. The inset high-collared
    # shirt uses its own cut and prominent knotted closures.
    edit=bmesh.new();edit.from_mesh(coat.data)
    bmesh.ops.delete(edit,geom=[p for p in edit.faces if p.material_index in (7,8)],context='FACES')
    edit.to_mesh(coat.data);edit.free()
    for m,color,rough in [('HeroWool Gabardine','393c3d',.57),('HeroWool Storm shield','424548',.54),
                           ('HeroWool Underfold','57383a',.75),('HeroWool Pressed edge','58544e',.59),
                           ('HeroWool Belt','544237',.44),('Hero Black horn','282523',.28)]:
        recolor(ctx,m,color,rough)
    atlas=garment_atlas(False)
    for i,(rough,grain) in enumerate(((1.,.75),(.92,.84),(1.20,.40),(.84,.75),(.82,.9))):
        material_surface(coat.data.materials[i],atlas,rough,grain)
    cloth=Tailor()
    def front(x,y,lift=0):
        radius,back,fore=sample(BODY,y)
        t=asin(np.clip((x+.007)/radius,-.95,.95))
        return x,y,(fore+back)/2+(fore-back)/2*(cos(t)**.88)+.004+lift
    # The neckline follows the new jaw. Round the bib away at the throat so
    # its two square upper corners cannot project through the collar stand.
    ys=np.linspace(.41,.700,26)
    cloth.panel([[front(-.007+(sample(OPENING,y)[0]+.001)*t,
                        y-.010*(1-t*t)*clamp((y-.667)/.033)**2)
                  for t in np.linspace(-1,1,15)] for y in ys],0)
    angles=np.linspace(.105,2*pi-.105,65)
    cloth.panel([[(-.007+sin(a)*rx,y-.020*max(0,cos(a))**2,.060+rz*cos(a)) for a in angles]
                 for y,rx,rz in ((.690,.092,.098),(.701,.087,.091),(.716,.079,.083),
                                 (.728,.074,.078),(.729,.072,.076),(.724,.071,.075))],0)
    cloth.cord([front(-.009,y,.003) for y in np.linspace(.425,.686,33)],.0020,1)
    for y,span in ((.473,.015),(.529,.023),(.586,.027),(.643,.029),(.683,.023)):
        fastener(cloth,-.009,y,front,span,1)
    shirt = ctx.mat('Slate Chinese silk','#6c7775',.7)
    mesh = ctx.mesh('RangerStandingCollar',cloth.vertices,cloth.faces,cloth.weights,cloth.slots,
                    [shirt,ctx.mat('Braided placket','#323c3e',.65)]).data
    uv = mesh.uv_layers.new(name='Shirt grain')
    for loop in mesh.loops:
        x,y,z = cloth.vertices[loop.vertex_index]
        uv.data[loop.index].uv = (x/.23,(y-.36*z)/.23)
    from tailored_surface import apply_scan
    apply_scan(shirt,'rough_linen',.87,normal_strength=.13)


def xia(ctx):
    # Garment dimensions were taken in the original rig's neutral stance.
    # A short skirt with side vents, fitted waist and crossed front make a
    # distinct silhouette even when the front fastenings are off camera.
    profile=rounded_profile([
        (-.040,.216,-.040,.244),(.020,.214,-.037,.244),(.12,.202,-.043,.237),
        (.21,.175,-.038,.217),(.29,.164,-.032,.210),(.37,.172,-.037,.217),
        (.47,.194,-.050,.230),(.53,.204,-.060,.235),(.60,.203,-.061,.212),
        (.65,.200,-.058,.173),(.684,.167,-.050,.143),(.706,.113,-.036,.132),
        (.721,.078,-.027,.124)])
    def shell(y,a,lift=0):
        width,back,fore=sample(profile,y)
        wave=.0018*sin(8*a+.7)*clamp((.33-y)/.32)+folds(a,y,False,True)
        # The woven front bridges the chest and eases into the armholes.
        chest=exp(-((y-.520)/.082)**2)
        contour=.013*(exp(-((abs(sin(a))-.53)/.27)**2)-.38*exp(-(sin(a)/.29)**2))
        wave+=chest*max(0,cos(a))**2*contour
        return (-.007+(width+lift+wave)*sin(a),y,
                (fore+back)/2+((fore-back)/2+lift+wave)*cos(a))
    def front(x,y,lift=0):
        width,*_=sample(profile,y)
        return shell(y,asin(np.clip((x+.007)/width,-.998,.998)),lift)
    cloth=Tailor()
    for half in (0,pi):
        ring=np.linspace(half-pi/2,half+pi/2,49)
        def vent(y,a):
            return .047*(abs(sin(a))**10)*clamp((.083-y)/.123)
        heights=np.linspace(-.040,.721,78)
        cloth.panel([[shell(y+vent(y,a),a) for a in ring] for y in heights],0)
        cloth.panel([[shell(-.04+vent(-.04,a)+dy,a,.0015) for a in ring] for dy in (0,.008)],1)
    # The double-turned shoulder yoke and two tapered back darts can be read
    # over the shoulder of the player even when the chest closures are hidden.
    rear=np.linspace(.55*pi,1.45*pi,67)
    cloth.panel([[shell(.573-.034*cos(a-pi)+dy,a,lift) for a in rear]
                 for dy,lift in ((-.004,0),(-.001,.0034),(.0035,.0033),(.006,.0004))],0)
    for side in (-1,1):
        curve=np.linspace(.270,.558,32)
        def dart(y,width,lift):
            phase=(y-.270)/.288
            a=pi+side*(.60+.23*phase+.12*sin(phase*pi)+width*sin(phase*pi))
            return shell(y,a,lift*sin(phase*pi))
        cloth.panel([[dart(y,d,l) for d,l in ((-.018,0),(0,.0035),(.018,0))]
                     for y in curve],0)
    angles=np.linspace(.026,2*pi-.026,65)
    cloth.panel([[(-.007+rx*sin(a),y-.005*cos(a),.049+rz*cos(a)) for a in angles]
                 for y,rx,rz in ((.694,.093,.092),(.719,.084,.088),(.749,.072,.079),(.752,.071,.078),
                                 (.748,.064,.071),(.740,.053,.060),(.706,.049,.055))],0)
    # A shoulder facing closes the slight gap between the stand and bodice
    # as the neck tilts away from the upper spine in locomotion.
    cloth.panel([[shell(.721,a) for a in angles],
                 [(-.007+.059*sin(a),.722,.049+.061*cos(a)) for a in angles]],0)
    cloth.cord([(-.007+.072*sin(a),.749-.005*cos(a),.049+.079*cos(a)) for a in angles],.0022,1)
    # A bias piping follows one continuous curve, from throat to right side.
    path=[(-.005,.715),(-.020,.684),(-.061,.644),(-.101,.600),
          (-.136,.548),(-.158,.482),(-.163,.416),(-.151,.348),(-.151,.306)]
    samples=[]
    for (ax,ay),(bx,by) in zip(path,path[1:]):
        samples.extend(front(ax+(bx-ax)*s,ay+(by-ay)*s,.0035) for s in np.linspace(0,1,8,endpoint=False))
    cloth.cord(samples,.0034,1)
    for x,y in ((-.026,.676),(-.096,.606),(-.139,.542),(-.155,.472)):
        fastener(cloth,x,y,front,.022,1)
    # The jacket shoulders close over softly gathered, narrow sleeves.
    sleeve_start=len(cloth.faces)
    sleeve_profile=rounded_profile(SLEEVE)
    for side,sign in [('Right',-1),('Left',1)]:
        tree=KDTree(len(ctx.positions))
        for i,ws in enumerate(ctx.weights):
            if sum(ws.get(side+bone,0) for bone in ('Shoulder','Arm','ForeArm','Hand'))>.50:
                tree.insert(ctx.positions[i],i)
        tree.balance()
        def arm_weight(p):
            ws={}
            for _,i,d in tree.find_n(p,6):
                for k,w in ctx.weights[i].items():
                    ws[k]=ws.get(k,0)+w/(d*d+.00004)
            total=sum(ws.values())
            blend=.8*clamp((p[1]-.605)/.103)
            ws={k:v/total*(1-blend) for k,v in ws.items()}
            for k,v in torso(p).items():
                ws[k]=ws.get(k,0)+v*blend
            return ws
        def sleeve(y,a,lift=0):
            cx,rx,b,f=sample(sleeve_profile,y)
            fullness=.74+.17*clamp((.51-y)/.36)
            radial=lift+folds(a,y,True,True)
            shoulder=clamp((y-.588)/.104)
            return (-.007+sign*(cx+.005-.006*shoulder+(rx*fullness+radial)*sin(a)),y-.006*shoulder,
                    (b+f)/2+((f-b)*.5*fullness+radial)*cos(a))
        a=np.linspace(0,2*pi,39)
        ys=sorted(set(s[0] for s in SLEEVE).union(np.linspace(SLEEVE[0][0],SLEEVE[-1][0],64)))
        cloth.panel([[sleeve(y,t) for t in a] for y in ys],0,arm_weight)
        cloth.panel([[sleeve(y,t,lift) for t in a] for y,lift in
                     ((.082,.001),(.087,.0038),(.146,.004),(.151,.001))],2,arm_weight)
        for y in (.093,.138):
            cloth.panel([[sleeve(y+dy,t,.0047) for t in a] for dy in (0,.0033)],1,arm_weight)
    sleeve_end=len(cloth.faces)
    # Rust-red woven waist wrap with two practical, weighted tails at the hip.
    a=np.linspace(0,2*pi,81)
    def sash_y(t):
        return .238+.009*sin(t-.35)+.005*sin(2*t+.12)
    cloth.panel([[shell(sash_y(t)+dy,t,lift) for t in a] for dy,lift in
                 ((-.037,.001),(-.034,.007),(-.013,.006),(-.009,.009),(.008,.006),(.028,.008),(.030,.003))],3)
    # The outside turn of the sash shows its rolled bias edge across the back.
    turn=np.linspace(1.97,1.97+2*pi,95)
    cloth.panel([[shell(sash_y(t)+.012-.032*(t-1.97)/(2*pi)+dy,t,lift) for t in turn]
                 for dy,lift in ((-.001,.0092),(0,.0120),(.0033,.0125),(.005,.010),
                                 (.010,.0093),(.016,.008))],3)
    for k in (-1,1):
        cloth.panel([[shell(y,1.91+k*(.12+s*.25)+k*t*(.11-.055*s),.014+s*.006)
                      for t in np.linspace(-1,1,7)] for s,y in zip(np.linspace(0,1,13),np.linspace(.261,.05 if k==1 else .09,13))],3)
    materials=[ctx.mat('HeroWool River-indigo twill','#3a5461',.8),
               ctx.mat('Bound edges • antique wheat','#a59266',.67),
               ctx.mat('Blue black cotton facings','#242e34',.77),
               ctx.mat('Persimmon silk sash','#835448',.64)]
    obj=ctx.mesh('XiaCrossFrontJacket',cloth.vertices,cloth.faces,cloth.weights,cloth.slots,materials)
    garment_uv(obj,cloth.vertices,(sleeve_start,sleeve_end),profile,sleeve_profile,sample)
    atlas=garment_atlas(True)
    for material,(rough,grain) in zip(materials,((1.,.87),(.87,.42),(.98,.68),(.86,.61))):
        material_surface(material,atlas,rough,grain)
    # Slim the trousers at the waist and calf while keeping foot placements.
    for v in ctx.body.data.vertices:
        x,y,z=v.co.x,v.co.z,-v.co.y
        if y<.18 and abs(x)<.29:
            center=-.007+(-.115 if x<-.007 else .115)
            covered=clamp((y+.12)/.20)
            v.co.x=center+(v.co.x-center)*(.86-.24*covered)
            v.co.y=-(.065+(z-.065)*(.91-.30*covered))


def build_costume(ctx,variant):
    if variant=='ranger':
        ranger(ctx)
        _fedora(ctx, shanghai_block=True)
        # The original hat was blocked on a different head. Fit it to the
        # deeper forehead and pompadour while keeping the crown hollow.
        for v in bpy.data.objects['HeroHat'].data.vertices:
            v.co.x=-.007+(v.co.x+.007)*1.07
            v.co.y=-.071+(v.co.y+.071)*1.12-.031
            v.co.z+=.013
        for name,col,r in [('Felt • tobacco','333439',.9),('Underbrim • umber','292a2d',.93),
                           ('Binding • brushed grosgrain','414148',.72),('Ribbon • oxblood','232326',.6),
                           ('Ribbon edge • wine','39343a',.7)]:
            recolor(ctx,name,col,r)
    else:
        xia(ctx)
    build_footwear(ctx)
    recolor(ctx,'Flannel • trousers','313740' if variant=='xia' else '303536',.87)
    recolor(ctx,'Oxfords • burnished calf','392f2a' if variant=='xia' else '252627',.46)
    if variant=='xia':
        # Short cloth gaiters overlap the shoe uppers, with a spiralling
        # binding and a narrow folded edge rather than the man's turned cuff.
        shoes=bpy.data.objects['HeroOxfords']
        edit=bmesh.new();edit.from_mesh(shoes.data)
        bmesh.ops.delete(edit,geom=[f for f in edit.faces if f.material_index>=4],context='FACES')
        edit.to_mesh(shoes.data);edit.free()
        shoes.name='LuClothShoes'
        cloth=Tailor()
        profile=[(-.871,.155,.030,.060,.055),(-.825,.153,.031,.062,.058),
                 (-.76,.145,.039,.064,.058),(-.69,.132,.045,.068,.060),
                 (-.62,.128,.053,.075,.073),(-.58,.126,.056,.073,.078)]
        for sign,side in [(1,'Left'),(-1,'Right')]:
            def weight(p):
                foot=.13*clamp((-.80-p[1])/.075)
                return {side+'Leg':1-foot,side+'Foot':foot}
            def section(y,a,lift=0):
                cx,cz,rx,rz=sample(profile,y)
                x=cx+(rx+lift)*cos(a)
                return (x if sign==1 else -.0142-x,y,cz+(rz+lift)*sin(a))
            angles=np.linspace(0,2*pi,41)
            cloth.panel([[section(y,a) for a in angles] for y,*_ in profile],0,weight)
            for j in range(4):
                t=np.linspace(0,2*pi,41)
                cloth.panel([[section(-.845+(j+a/(2*pi))*.056+dy,a,.0028) for a in t]
                             for dy in (0,.005)],1,weight)
            cloth.panel([[section(-.597+dy,a,.003) for a in angles] for dy in (0,.008)],1,weight)
        ctx.mesh('LuBoundGaiters',cloth.vertices,cloth.faces,cloth.weights,cloth.slots,
                 [ctx.mat('Indigo leg wraps','#333c43',.84),ctx.mat('Binding tape','#4d5a5f',.74)])
