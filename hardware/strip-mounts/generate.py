#!/usr/bin/env python3
"""Generate editable CAD and checked meshes for modular Ambi4Tizen strip mounts."""
from pathlib import Path
import argparse, json, math
import cadquery as cq
import trimesh

ROOT = Path(__file__).resolve().parent

def box(x,y,z,at=(0,0,0)):
    return cq.Workplane('XY').box(x,y,z,centered=(False,False,False)).translate(at)

def cylinder(radius,height,at):
    return cq.Workplane('XY').circle(radius).extrude(height).translate(at)

def transformed(shape,at=(0,0,0),angle=0):
    return shape.rotate((0,0,0),(0,0,1),angle).translate(at)

def models(p):
    w=p['strip_width_mm']+p['width_clearance_mm']; base=p['base_thickness_mm']
    wall=p['wall_thickness_mm']; lip=p['lower_lip_mm']; bw=p['base_width_mm']
    height=base+lip+w; key_y=-9.5; floor=3.8; socket_depth=2.2
    def lug(start):
        return box(14.5,10.0,6.0-base,(start,key_y-5,base))
    def socket(start):
        return box(14.2,p['key_socket_width_mm'],socket_depth+.1,
                   (start,key_y-p['key_socket_width_mm']/2,floor))
    def pilot(x):
        # M3x5 from a seated 2-mm key stops 0.8 mm above the TV-contact plane.
        return cylinder(1.3,6,(x,key_y,.8))
    def rail(length):
        if not 32<=length<=180:raise ValueError('Rail length must be 32..180 mm')
        part=box(length,bw,base,(0,-16,0))
        part=part.union(box(length,wall,height-base,(0,-wall,base)))
        part=part.union(box(length,lip,lip,(0,0,base)))
        for start,hole in [(0,7),(length-14.5,length-7)]:
            part=part.union(lug(start))
            pocket_start=0 if start==0 else length-14.2
            part=part.cut(socket(pocket_start)).cut(pilot(hole))
        # Only printed hanger/rail hardware, never a screw into the television.
        part=part.cut(cylinder(1.7,base+.2,(length/2,key_y,-.1)))
        return part.clean()
    def key(width=None):
        width=p['key_width_mm'] if width is None else width
        part=box(28,width,2,(-14,-width/2,0)).edges('|Z').fillet(.5)
        for x in (-7,7):part=part.cut(cylinder(1.7,2.2,(x,0,-.1)))
        return part.clean().translate((14,width/2,0))
    def annulus(inner,outer,h,z):
        ring=cq.Workplane('XY').circle(outer).circle(inner).extrude(h).translate((0,0,z))
        return ring.intersect(box(outer+1,outer+1,h+2,(0,0,z-1)))
    def corner():
        r=p['corner_seat_radius_mm']
        if r<30:raise ValueError('Use R>=30 mm and verify the actual strip datasheet')
        part=annulus(r-16,r+.8,base,0)
        part=part.union(annulus(r-wall,r,height-base,base))
        part=part.union(annulus(r,r+lip,lip,base))
        # Input at (0,R), output at (R,0); identical keys serve both ports.
        for at,angle,is_input in [((0,r,0),0,True),((r,0,0),-90,False)]:
            start=0 if is_input else -14.5
            pocket_start=0 if is_input else -14.2
            part=part.union(transformed(lug(start),at,angle))
            part=part.cut(transformed(socket(pocket_start),at,angle))
            part=part.cut(transformed(pilot(7 if is_input else -7),at,angle))
        return part.clean()
    def sample45():
        # Plane normal points equally outward and toward the wall. The 12.8-mm
        # strip seat is the sloping face; corners would need cut/jumper joints.
        rise=w/math.sqrt(2)
        # A YZ profile extrudes along +X.
        wedge=cq.Workplane('YZ').polyline([(-rise,base),(0,base),(-rise,base+rise)]).close().extrude(60)
        return box(60,bw,base,(0,-16,0)).union(wedge).clean()
    def hook(gap):
        t=p['hook_wall_mm']; drop=p['hook_rear_drop_mm']; front=p['hook_front_return_mm']; width=p['hook_width_mm']
        # Printed flat on its side: this XY profile is the TV cross-section.
        profile=[(0,-drop),(-t,-drop),(-t,t),(gap+t,t),(gap+t,-front),(gap,-front),(gap,0),(0,0)]
        part=cq.Workplane('XY').polyline(profile).close().extrude(width)
        for y in (-24,-42):
            # Through hole across rear wall, and a recessed M3 nut on TV side.
            bore=cq.Workplane('YZ').center(y,width/2).circle(1.7).extrude(t+2).translate((-t-1,0,0))
            nut=cq.Workplane('YZ').center(y,width/2).polygon(6,6.6).extrude(2.6).translate((-2.6,0,0))
            part=part.cut(bore).cut(nut)
        return part.clean().translate((t,drop,0))
    result={
        f"rail_90_{p['rail_length_mm']:g}":rail(p['rail_length_mm']),
        'rail_90_120':rail(120),
        'rail_90_60':rail(60),
        'fit_coupon_90_40':rail(40),
        f"corner_90_r{p['corner_seat_radius_mm']:g}":corner(),
        'joint_key_standard':key(),
        'joint_key_loose':key(p['key_width_mm']-.2),
        'sample_45_60':sample45(),
        f"top_hook_gap{p['hook_clear_gap_mm']:g}_PROVISIONAL":hook(p['hook_clear_gap_mm'])
    }
    return result, {'seat_width_mm':w,'seat_height_from_base_mm':height,
        'adhesive_seat_corner_radius_mm':p['corner_seat_radius_mm'],
        'corner_arc_length_mm':math.pi*p['corner_seat_radius_mm']/2,
        'key_socket_floor_z_mm':floor,'key_installed_top_z_mm':floor+2,
        'joint_screw_tip_z_mm':floor+2-5,
        'hook_fit_verified':False,'strip_bend_specification_verified':False}

def validate_and_export(parts,p,out):
    out.mkdir(parents=True,exist_ok=True);records={}
    for name,part in parts.items():
        shape=part.val();assert shape.isValid(),f'{name}: invalid B-rep'
        assert len(part.solids().vals())==1,f'{name}: disconnected CAD bodies'
        bounds=shape.BoundingBox();size=[bounds.xlen,bounds.ylen,bounds.zlen]
        assert max(size)<=p['maximum_part_extent_mm']+1e-5,(name,size)
        assert bounds.zmin>=-1e-6,(name,'below print bed')
        stl=out/(name+'.stl');step=out/(name+'.step')
        cq.exporters.export(part,str(stl),tolerance=.06,angularTolerance=.1)
        cq.exporters.export(part,str(step))
        mesh=trimesh.load_mesh(stl,process=True)
        assert mesh.is_watertight and mesh.is_winding_consistent and mesh.is_volume,(name,'invalid closed mesh')
        assert len(mesh.split())==1,(name,'disconnected mesh')
        assert max(mesh.extents)<=p['maximum_part_extent_mm']+1e-3
        imported=cq.importers.importStep(str(step))
        assert imported.val().isValid() and len(imported.solids().vals())==1,(name,'STEP roundtrip')
        assert abs(imported.val().Volume()-shape.Volume())<.01,(name,'STEP volume mismatch')
        records[name]={'dimensions_mm':[round(x,3) for x in size],'solid_volume_cm3':round(shape.Volume()/1000,3),
            'watertight':True,'single_solid':True,'step_roundtrip':True}
        print(name,records[name]['dimensions_mm'],flush=True)
    return records

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--parameters',type=Path,default=ROOT/'parameters.json')
    parser.add_argument('--output',type=Path,default=ROOT/'exports')
    args=parser.parse_args();p=json.loads(args.parameters.read_text())
    if not 8<=p['strip_width_mm']<=14:raise ValueError('This base family accepts strip widths 8..14 mm; verify the regenerated geometry')
    parts,derived=models(p);records=validate_and_export(parts,p,args.output)
    manifest={'units':'mm','status':'dimensioned prototype, physical fit unverified','parameters':p,'derived':derived,'parts':records}
    (args.output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    # One assembled sample corner, two rails and the actual two inserted keys.
    r=p['corner_seat_radius_mm'];L=p['rail_length_mm'];ky=-9.5
    assembly=cq.Assembly(name='corner_assembly_example')
    assembly.add(parts[f"corner_90_r{p['corner_seat_radius_mm']:g}"],name='corner',color=cq.Color(.15,.45,.7))
    assembly.add(parts[f"rail_90_{p['rail_length_mm']:g}"],name='input_rail',loc=cq.Location(cq.Vector(-L,r,0)),color=cq.Color(.25,.3,.35))
    assembly.add(parts[f"rail_90_{p['rail_length_mm']:g}"],name='output_rail',loc=cq.Location(cq.Vector(r,0,0),cq.Vector(0,0,1),-90),color=cq.Color(.25,.3,.35))
    centered_key=parts['joint_key_standard'].translate((-14,-p['key_width_mm']/2,0))
    for name,at,angle in [('key_input',(0,r+ky,3.8),0),('key_output',(r-9.5,0,3.8),-90)]:
        assembly.add(transformed(centered_key,at,angle),name=name,color=cq.Color(.95,.55,.15))
    # Exact-solid collision checks in the assembled default mating positions.
    placed=[]
    for name,item in assembly.objects.items():
        if item.obj is not None:placed.append((name,item.obj.val().located(item.loc)))
    for i,(name,shape) in enumerate(placed):
        for other,other_shape in placed[i+1:]:
            assert shape.intersect(other_shape).Volume()<1e-4,(name,other,'assembly interference')
    manifest['assembly_interference_check']='passed'
    (args.output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    assembly.save(str(args.output/'corner_assembly_REFERENCE_ONLY.step'))
    print('PASS: B-rep, closed meshes, individual part extents <=200 mm and STEP roundtrips. Assembly is reference-only, not one printable part.')
if __name__=='__main__':main()
