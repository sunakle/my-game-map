"""Isolated native mesh session. Coordinates are converted at the boundary."""
import bpy
import json
import math
import os
import sys
from pathlib import Path

folder = Path(sys.argv[sys.argv.index("--") + 1])
source = json.loads((folder / "input.json").read_text(encoding="utf-8"))
for obj in list(bpy.context.scene.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
data = bpy.data.meshes.new("Фигура")
data.from_pydata([(x, -z, y) for x, y, z in source["vertices"]], [], source["faces"])
data.update()
obj = bpy.data.objects.new(source["name"], data)
bpy.context.collection.objects.link(obj)
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
bpy.context.preferences.view.show_splash = False
bpy.context.preferences.view.language = 'ru_RU'
bpy.context.preferences.filepaths.save_version = 0
for area in bpy.context.screen.areas:
    if area.type == 'VIEW_3D':
        area.spaces.active.shading.type = 'SOLID'
        area.spaces.active.region_3d.view_distance = max(5, max(obj.dimensions) * 2.5)
    if area.type == 'PROPERTIES':
        area.spaces.active.context = 'DATA'

def collect():
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    deps = bpy.context.evaluated_depsgraph_get()
    points, faces, tris = [], [], []
    for source_obj in bpy.context.scene.objects:
        if source_obj.type != 'MESH':
            continue
        item = source_obj.evaluated_get(deps)
        mesh = item.to_mesh()
        try:
            base = len(points)
            if base + len(mesh.vertices) > 100000 or len(faces) + len(mesh.polygons) > 150000:
                raise ValueError("Слишком много вершин или граней")
            for vert in mesh.vertices:
                p = item.matrix_world @ vert.co
                if any(not math.isfinite(v) or abs(v) > 10000 for v in p):
                    raise ValueError("Координаты вне рабочего диапазона")
                points.append([p.x, p.z, -p.y])
            faces.extend([[base+i for i in f.vertices] for f in mesh.polygons])
            mesh.calc_loop_triangles()
            tris.extend([[base+i for i in t.vertices] for t in mesh.loop_triangles])
        finally:
            item.to_mesh_clear()
    if not tris or len(tris) > 200000:
        raise ValueError("Нужна поверхность до 200 000 треугольников")
    return {"vertices": points, "faces": faces, "triangles": tris}

class MAP_OT_return(bpy.types.Operator):
    bl_idname = "mesh.mapstudio_return"
    bl_label = "Вернуть в карту"
    def execute(self, context):
        try:
            result = collect()
            tmp = folder / "output.tmp"
            tmp.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
            os.replace(tmp, folder / "output.json")
        except Exception as exc:
            self.report({'ERROR'}, str(exc))
            return {'CANCELLED'}
        bpy.ops.wm.quit_blender()
        return {'FINISHED'}

def header(self, context):
    self.layout.operator("mesh.mapstudio_return", text="Вернуть в карту", icon='CHECKMARK')

bpy.utils.register_class(MAP_OT_return)
bpy.types.VIEW3D_HT_header.prepend(header)
bpy.ops.object.mode_set(mode='EDIT')
