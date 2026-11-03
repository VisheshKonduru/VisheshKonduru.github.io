# Build ur5e.glb from the official UR5e visual .dae meshes.
# Each link becomes one node (link0..link6) whose geometry is already in that
# link's URDF frame (visual origin from visual_parameters.yaml baked in).
# Usage: python -I build_glb.py <src_dir> <out.glb>
import sys, numpy as np, trimesh
from trimesh.transformations import euler_matrix
src, out = sys.argv[1], sys.argv[2]
d = np.pi/180
# name, file, xyz, rpy (visual_parameters.yaml, ur5e)
V = [('link0','base',[0,0,0],[0,0,180*d]), ('link1','shoulder',[0,0,0],[0,0,180*d]),
     ('link2','upperarm',[0,0,0.138],[90*d,0,-90*d]), ('link3','forearm',[0,0,0.007],[90*d,0,-90*d]),
     ('link4','wrist1',[0,0,-0.127],[90*d,0,0]), ('link5','wrist2',[0,0,-0.0997],[0,0,0]),
     ('link6','wrist3',[0,-0.0005,-0.0989],[90*d,0,0])]
TARGET = 0.25   # keep this fraction of faces per part
scene = trimesh.Scene()
tot0 = tot1 = 0
for name, f, xyz, rpy in V:
    s = trimesh.load(f'{src}/meshes/ur5e/visual/{f}.dae')
    T = euler_matrix(rpy[0], rpy[1], rpy[2], 'sxyz'); T[:3,3] = xyz
    by = {}
    for node in s.graph.nodes_geometry:
        Tn, g = s.graph[node]
        m = s.geometry[g].copy(); m.apply_transform(T @ Tn)
        c = tuple(m.visual.material.main_color[:3]); by.setdefault(c, []).append(m)
    allv = []
    for c, ms in by.items():
        m = trimesh.util.concatenate(ms); m.merge_vertices()
        n0 = len(m.faces); tot0 += n0
        if n0 > 400:
            m = m.simplify_quadric_decimation(percent=1-TARGET, aggression=3)
        tot1 += len(m.faces)
        mat = trimesh.visual.material.PBRMaterial(baseColorFactor=[*[x/255 for x in c],1.0],
              metallicFactor=0.1, roughnessFactor=0.55)
        m.visual = trimesh.visual.TextureVisuals(material=mat)
        scene.add_geometry(m, node_name=f'{name}_{len(allv)}', geom_name=f'{name}_{len(allv)}')
        allv.append(m.vertices)
    v = np.vstack(allv); print(name, 'bounds', v.min(0).round(3), v.max(0).round(3))
print('faces', tot0, '->', tot1)
scene.export(out)
