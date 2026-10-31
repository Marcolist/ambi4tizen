#!/usr/bin/env python3
"""Render actual exported CAD meshes and a dimensioned explanatory drawing."""
from pathlib import Path
import json, math
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon, Rectangle, Arc
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
import trimesh

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'exports'
P=json.loads((ROOT/'parameters.json').read_text())
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'svg.fonttype':'none','figure.facecolor':'#f4f6f8'})

def draw_mesh(ax,name,color,angle=0,at=(0,0,0),alpha=1):
    mesh=trimesh.load_mesh(OUT/(name+'.stl'),process=True)
    transform=trimesh.transformations.rotation_matrix(math.radians(angle),(0,0,1));mesh.apply_transform(transform);mesh.apply_translation(at)
    rgba=np.array(matplotlib.colors.to_rgba(color))
    light=np.array([.4,.3,.85]);light=light/np.linalg.norm(light)
    shades=.4+.6*np.clip(mesh.face_normals@light,0,1)
    facecolors=np.tile(rgba,(len(mesh.faces),1));facecolors[:,:3]*=shades[:,None]
    if not hasattr(ax,'_cad_faces'):ax._cad_faces=[];ax._cad_colors=[]
    ax._cad_faces.extend(list(mesh.triangles));ax._cad_colors.extend(list(facecolors))
    return mesh.bounds

def poly3(ax,points,color,alpha=1):
    if not hasattr(ax,'_cad_faces'):ax._cad_faces=[];ax._cad_colors=[]
    ax._cad_faces.append(np.array(points));ax._cad_colors.append(matplotlib.colors.to_rgba(color,alpha))

def view(ax,lo,hi,elev=32,azim=-52):
    if hasattr(ax,'_cad_faces'):ax.add_collection3d(Poly3DCollection(ax._cad_faces,facecolors=ax._cad_colors,edgecolors='none',zsort='average'))
    lo=np.array(lo);hi=np.array(hi);pad=np.maximum((hi-lo)*.06,1)
    ax.set_xlim(lo[0]-pad[0],hi[0]+pad[0]);ax.set_ylim(lo[1]-pad[1],hi[1]+pad[1]);ax.set_zlim(lo[2]-pad[2],hi[2]+pad[2])
    ax.set_box_aspect(np.maximum(hi-lo,1));ax.view_init(elev,azim);ax.set_axis_off();ax.set_facecolor('#f4f6f8')

def preview():
    fig=plt.figure(figsize=(16,10),layout='constrained')
    grid=fig.add_gridspec(2,2,width_ratios=(1.55,1),height_ratios=(1,1))
    ax=fig.add_subplot(grid[0,0],projection='3d');r=P['corner_seat_radius_mm'];L=P['rail_length_mm'];w=P['strip_width_mm'];z=P['base_thickness_mm']+P['lower_lip_mm']+.4
    corner=f'corner_90_r{r:g}';rail=f'rail_90_{L:g}'
    draw_mesh(ax,corner,'#2587af');draw_mesh(ax,rail,'#5d6b78',at=(-L,r,0));draw_mesh(ax,rail,'#5d6b78',angle=-90,at=(r,0,0))
    draw_mesh(ax,'joint_key_standard','#ef9a35',at=(-14,r-9.5-P['key_width_mm']/2,3.8))
    draw_mesh(ax,'joint_key_standard','#ef9a35',angle=-90,at=(r-9.5-P['key_width_mm']/2,14,3.8))
    poly3(ax,[(-L,r+.06,z),(0,r+.06,z),(0,r+.06,z+w),(-L,r+.06,z+w)],'#4bbf82')
    poly3(ax,[(r+.06,-L,z),(r+.06,0,z),(r+.06,0,z+w),(r+.06,-L,z+w)],'#4bbf82')
    theta=np.linspace(0,np.pi/2,100)
    for a,b in zip(theta[:-1],theta[1:]):
        points=[((r+.06)*np.cos(a),(r+.06)*np.sin(a),z),((r+.06)*np.cos(b),(r+.06)*np.sin(b),z),((r+.06)*np.cos(b),(r+.06)*np.sin(b),z+w),((r+.06)*np.cos(a),(r+.06)*np.sin(a),z+w)]
        poly3(ax,points,'#4bbf82')
    for x in np.arange(-L+16.7,-1,33.333):
        poly3(ax,[(x-2.5,r+.1,z+w/2-2.5),(x+2.5,r+.1,z+w/2-2.5),(x+2.5,r+.1,z+w/2+2.5),(x-2.5,r+.1,z+w/2+2.5)],'#f6f1d6')
    for y in np.arange(-L+16.7,-1,33.333):
        poly3(ax,[(r+.1,y-2.5,z+w/2-2.5),(r+.1,y+2.5,z+w/2-2.5),(r+.1,y+2.5,z+w/2+2.5),(r+.1,y-2.5,z+w/2+2.5)],'#f6f1d6')
    view(ax,(-L,-L,0),(r+1,r+1,22),elev=45,azim=42)
    ax.set_title('90° OUTWARD — MAIN DESIGN\nTwo 180 mm rails + R50 corner + drop-in keys',loc='left',fontsize=15,fontweight='bold')
    ax.text2D(.03,.04,'Green: adhesive strip (schematic)  |  Orange: joint keys\nCorner turns in the strip\'s easy-bend direction; no ribbon twist.',transform=ax.transAxes,fontsize=10)
    detail=fig.add_subplot(grid[0,1],projection='3d')
    draw_mesh(detail,'fit_coupon_90_40','#5d6b78');draw_mesh(detail,'fit_coupon_90_40','#5d6b78',at=(40,0,0))
    draw_mesh(detail,'joint_key_standard','#ef9a35',at=(26,-9.5-P['key_width_mm']/2,13))
    view(detail,(0,-16,0),(80,1,23),elev=34,azim=-65)
    detail.set_title('SIMPLE JOINT\nDrop in, then glue or use two M3×5 screws',loc='left',fontsize=12,fontweight='bold')
    detail.text2D(.02,.02,'Pilot holes stay 0.8 mm above the TV-contact face.\nScrews join printed parts only.',transform=detail.transAxes,fontsize=9)
    plan=fig.add_subplot(grid[1,0])
    plan.add_patch(matplotlib.patches.Wedge((0,0),r+.8,0,90,width=16.8,facecolor='#c5d0d9',edgecolor='#677988'))
    plan.add_patch(Rectangle((-35,r-16),35,16.8,facecolor='#c5d0d9',edgecolor='#677988'))
    plan.add_patch(Rectangle((r-16,-35),16.8,35,facecolor='#c5d0d9',edgecolor='#677988'))
    plan.plot([-35,0],[r,r],color='#2f9b68',lw=4)
    plan.plot([r,r],[-35,0],color='#2f9b68',lw=4)
    plan.add_patch(Arc((0,0),2*r,2*r,theta1=0,theta2=90,color='#2f9b68',lw=4))
    v=r/math.sqrt(2);plan.annotate('',(0,0),(v,v),arrowprops={'arrowstyle':'<->','color':'#34495e'})
    plan.text(v*.45,v*.45+6,f'R{r:g} mm',rotation=45)
    plan.text(-34,-46,'Strip stands vertically: width points toward the wall.\nVerify the strip datasheet before using this bend radius.',fontsize=9)
    plan.set_title('CORNER PLAN — NO COMPOUND RIBBON TWIST',loc='left',fontsize=12,fontweight='bold')
    plan.set_xlim(-39,r+9);plan.set_ylim(-49,r+8);plan.set_aspect('equal');plan.axis('off')
    hook=fig.add_subplot(grid[1,1]);gap=P['hook_clear_gap_mm'];t=P['hook_wall_mm'];drop=P['hook_rear_drop_mm'];front=P['hook_front_return_mm']
    xy=np.array([(0,-drop),(-t,-drop),(-t,t),(gap+t,t),(gap+t,-front),(gap,-front),(gap,0),(0,0)])
    hook.add_patch(Polygon(xy,facecolor='#5d6b78'))
    hook.add_patch(Rectangle((1,-drop),gap-2,drop,facecolor='#d5dce3',edgecolor='#aab5bf'))
    hook.add_patch(Rectangle((0,-8),1,8,facecolor='#6ec6a0'));hook.add_patch(Rectangle((gap-1,-front),1,front,facecolor='#6ec6a0'))
    hook.annotate('',(0,10),(gap,10),arrowprops={'arrowstyle':'<->','color':'#243746'})
    hook.text(gap/2,12,f'{gap:g} mm throat BEFORE pads',ha='center',fontsize=10)
    hook.text(gap/2,-drop/2,'TV housing\nreference only',ha='center',va='center',color='#4e5963')
    hook.set_aspect('equal');hook.set_xlim(-12,gap+12);hook.set_ylim(-drop-4,22);hook.axis('off')
    hook.set_title('OPTIONAL TOP HOOK — FIT UNVERIFIED\nParametric gap; padded contact on housing only',loc='left',fontsize=12,fontweight='bold')
    fig.suptitle('Ambi4Tizen  |  12 mm self-adhesive strip  |  longest printable part: 180 mm',fontsize=18,fontweight='bold')
    fig.savefig(ROOT/'assembly_preview.png',dpi=150)
    plt.close(fig)

def drawing():
    fig,axes=plt.subplots(2,2,figsize=(14,10),layout='constrained')
    ax=axes[0,0];L=P['rail_length_mm'];bw=P['base_width_mm'];ky=-9.5
    ax.add_patch(Rectangle((0,-16),L,bw,facecolor='#d4dce3',edgecolor='#34495e'))
    ax.add_patch(Rectangle((0,-2.4),L,2.4,facecolor='#5d6b78'))
    for x in (0,L-14.2):ax.add_patch(Rectangle((x,ky-4),14.2,8,facecolor='#efb25d',edgecolor='#b97720'))
    for x in (7,L-7,L/2):ax.add_patch(plt.Circle((x,ky),1.7,facecolor='white',edgecolor='#34495e'))
    ax.annotate('',(0,7),(L,7),arrowprops={'arrowstyle':'<->'});ax.text(L/2,9,f'{L:g} mm overall',ha='center')
    ax.text(L/2,-25,'Two end sockets: 14.2 × 8.0 mm; installed key: 28 × 7.6 × 2.0 mm',ha='center',fontsize=9)
    ax.set_title('Rail: plan view / TV-contact side faces away');ax.set_xlim(-8,L+8);ax.set_ylim(-29,16);ax.set_aspect('equal');ax.axis('off')
    ax=axes[0,1];r=P['corner_seat_radius_mm']
    ax.add_patch(matplotlib.patches.Wedge((0,0),r+.8,0,90,width=16.8,facecolor='#d4dce3',edgecolor='#34495e'))
    ax.add_patch(Arc((0,0),2*r,2*r,theta1=0,theta2=90,color='#2f9b68',lw=4))
    v=r/math.sqrt(2);ax.annotate('',(0,0),(v,v),arrowprops={'arrowstyle':'<->','color':'#34495e'})
    ax.text(v*.55,v*.55+4,f'R{r:g} strip seat',rotation=45)
    ax.text(2,-9,f'Envelope {r+.8:g} × {r+.8:g} mm; arc {r*math.pi/2:.2f} mm',fontsize=9)
    ax.set_title('90° corner: same part, rotated for either top corner');ax.set_xlim(-5,r+10);ax.set_ylim(-13,r+8);ax.set_aspect('equal');ax.axis('off')
    base=P['base_thickness_mm'];seat=P['strip_width_mm']+P['width_clearance_mm'];lip=P['lower_lip_mm'];rise=seat/math.sqrt(2)
    for ax,angle in zip(axes[1],[90,45]):
        ax.add_patch(Rectangle((-16,0),16.8,base,facecolor='#d4dce3',edgecolor='#34495e'))
        if angle==90:
            ax.add_patch(Rectangle((-2.4,base),2.4,lip+seat,facecolor='#5d6b78'))
            ax.add_patch(Rectangle((0,base),lip,lip,facecolor='#5d6b78'))
            ax.plot([.12,.12],[base+lip+.4,base+lip+.4+12],color='#2f9b68',lw=4)
            point=(.2,base+lip+6.4);direction=(9,0)
            caption='Continuous strip uses an easy-bend R50 corner.\nMain option: lower assembly effort; less direct wall aiming.'
        else:
            ax.add_patch(Polygon([(-rise,base),(0,base),(-rise,base+rise)],facecolor='#5d6b78'))
            ax.plot([-.28,-rise+.28],[base+.28,base+rise-.28],color='#2f9b68',lw=4)
            point=(-rise/2,base+rise/2);direction=(7,7)
            caption='Short comparison coupon only. A complete 45° frame\nneeds cut/jumper corners to avoid compound ribbon bending.'
        ax.annotate('',(point[0]+direction[0],point[1]+direction[1]),point,arrowprops={'arrowstyle':'->','color':'#e38a24','lw':2})
        ax.axhline(0,color='#34495e',lw=2);ax.text(-16,-3,'TV rear / tape contact plane',fontsize=9)
        ax.text(-16,-10,caption,fontsize=9)
        ax.text(5,21,'Toward wall ↑',fontsize=9);ax.text(5,-3,'Outward →',fontsize=9)
        ax.set_title(f'{angle}° cross-section — green seat is 12 mm strip');ax.set_xlim(-19,27);ax.set_ylim(-14,27);ax.set_aspect('equal');ax.axis('off')
    fig.suptitle('Mount geometry and connection details — dimensions in mm; schematic, not 1:1',fontsize=16,fontweight='bold')
    fig.savefig(ROOT/'technical_drawing.svg');fig.savefig(ROOT/'technical_drawing.png',dpi=140);plt.close(fig)

if __name__=='__main__':preview();drawing();print('Rendered actual mesh assembly and dimensioned drawing.')
