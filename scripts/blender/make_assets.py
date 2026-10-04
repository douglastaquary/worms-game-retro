"""Hand-built cartoon Worms-style props for Blender 2.91. Exports GLB into public/models.

Axis convention: Blender X = screen right, Blender Z = up, Blender -Y = towards the
game camera (glTF export converts to Y-up, so -Y becomes +Z in three.js).
"""

import math
import os

import bpy

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "public", "models")
os.makedirs(OUT, exist_ok=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    try:
        import addon_utils

        addon_utils.enable("io_scene_gltf2")
    except Exception as exc:  # pragma: no cover - exporter is bundled
        print("gltf addon", exc)


def srgb(value):
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def material(name, hex_color, rough=0.62, metal=0.0):
    hex_color = hex_color.lstrip("#")
    color = [srgb(int(hex_color[i : i + 2], 16) / 255) for i in (0, 2, 4)]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (color[0], color[1], color[2], 1)
    bsdf.inputs["Roughness"].default_value = rough
    if "Metallic" in bsdf.inputs:
        bsdf.inputs["Metallic"].default_value = metal
    if "Specular" in bsdf.inputs:
        bsdf.inputs["Specular"].default_value = 0.28
    return mat


def activate(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def polish(obj, mat, smooth=True):
    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)
    mesh = obj.data
    if hasattr(mesh, "polygons"):
        for poly in mesh.polygons:
            poly.use_smooth = smooth
    return obj


def apply_transform(obj):
    activate(obj)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def bevel(obj, width, segments=3):
    activate(obj)
    mod = obj.modifiers.new("Bevel", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    obj.data.use_auto_smooth = True
    obj.data.auto_smooth_angle = math.radians(60)
    try:
        mod.harden_normals = True
    except Exception:
        pass
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def cube(name, loc, scale, mat, round_k=0.22, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    apply_transform(obj)
    polish(obj, mat)
    if round_k:
        bevel(obj, min(scale) * round_k)
    return obj


def uv_sphere(name, loc, scale, mat, seg=20, ring=12, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=ring, radius=1, location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    apply_transform(obj)
    return polish(obj, mat)


def cylinder(name, loc, radius, depth, mat, verts=16, rot=(0, 0, 0), round_k=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.name = name
    polish(obj, mat)
    if round_k:
        bevel(obj, min(radius, depth) * round_k, 2)
    return obj


def cone(name, loc, r1, r2, depth, mat, rot=(0, 0, 0), verts=16, scale=(1, 1, 1), smooth=True):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    apply_transform(obj)
    return polish(obj, mat, smooth)


def torus(name, loc, major, minor, mat, rot=(0, 0, 0), seg=20):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major,
        minor_radius=minor,
        location=loc,
        rotation=rot,
        major_segments=seg,
        minor_segments=8,
    )
    obj = bpy.context.active_object
    obj.name = name
    return polish(obj, mat)


def tube(name, points, radius, mat, taper=None, res=10):
    """Smooth bevelled bezier tube through (x, y, z) points, converted to a mesh."""
    curve = bpy.data.curves.new(name + "Curve", type="CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    curve.resolution_u = res
    curve.use_fill_caps = True
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for i, point in enumerate(points):
        bp = spline.bezier_points[i]
        bp.co = point
        bp.handle_left_type = "AUTO"
        bp.handle_right_type = "AUTO"
        if taper:
            bp.radius = taper[i]
    obj = bpy.data.objects.new(name, curve)
    bpy.context.scene.collection.objects.link(obj)
    activate(obj)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.active_object
    obj.name = name
    return polish(obj, mat)


def blob(name, balls, mat, resolution=0.05):
    """Metaball body (x, y, z, radius) converted to a single smooth mesh."""
    meta = bpy.data.metaballs.new(name + "Meta")
    meta.resolution = resolution
    meta.render_resolution = resolution
    meta.threshold = 0.6
    obj = bpy.data.objects.new(name, meta)
    bpy.context.scene.collection.objects.link(obj)
    for x, y, z, r in balls:
        element = meta.elements.new()
        element.co = (x, y, z)
        element.radius = r
        element.stiffness = 2.0
    activate(obj)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.active_object
    obj.name = name
    return polish(obj, mat)


def join(name):
    bpy.ops.object.select_all(action="SELECT")
    meshes = [obj for obj in bpy.context.selected_objects if obj.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    return obj


def export(filename):
    path = os.path.join(OUT, filename)
    bpy.ops.object.select_all(action="SELECT")
    kwargs = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=True)
    try:
        bpy.ops.export_scene.gltf(**kwargs, export_yup=True)
    except TypeError:
        bpy.ops.export_scene.gltf(**kwargs)
    tris = 0
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            obj.data.calc_loop_triangles()
            tris += len(obj.data.loop_triangles)
            print("  ", obj.name, "dims", tuple(round(v, 2) for v in obj.dimensions))
    print("EXPORTED", path, "tris", tris)


def empty(name, loc):
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=loc)
    obj = bpy.context.active_object
    obj.name = name
    return obj


def parent_to(child, parent):
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()


def worm():
    reset()
    body = material("Body", "#f27a8e", 0.55)
    belly = material("Belly", "#ffb4b4", 0.55)
    white = material("Eye", "#ffffff", 0.3)
    black = material("Pupil", "#120c0c", 0.3)
    mouth = material("Mouth", "#7a1f2a", 0.5)
    # S-shaped upright worm: tail curls back on the ground, chunky body, big round head.
    balls = [
        (-0.36, 0.0, 0.07, 0.09),
        (-0.26, 0.0, 0.09, 0.14),
        (-0.13, 0.0, 0.13, 0.2),
        (0.0, 0.0, 0.2, 0.25),
        (0.06, 0.0, 0.36, 0.28),
        (0.07, 0.0, 0.54, 0.28),
        (0.06, 0.0, 0.7, 0.29),
        (0.1, 0.0, 0.86, 0.33),
    ]
    try:
        blob("WormBody", balls, body, 0.045)
    except Exception as exc:  # pragma: no cover - fallback to spheres
        print("metaball failed", exc)
        for i, (x, y, z, r) in enumerate(balls):
            uv_sphere(f"seg{i}", (x, y, z), (r * 0.62, r * 0.6, r * 0.6), body)
    uv_sphere("belly", (0.13, -0.12, 0.42), (0.13, 0.1, 0.22), belly, 14, 10)
    # Big goggle eyes on top of the head, both visible from the side camera.
    for name, x, z in (("L", -0.03, 1.12), ("R", 0.25, 1.1)):
        uv_sphere("eye" + name, (x, -0.1, z), (0.15, 0.12, 0.175), white, 18, 12)
        uv_sphere("pup" + name, (x + 0.08, -0.2, z - 0.01), (0.068, 0.05, 0.08), black, 12, 8)
    torus("smile", (0.26, -0.16, 0.8), 0.075, 0.018, mouth, (math.radians(90), math.radians(-20), 0), 14)
    join("Worm")
    export("worm.glb")


def bazooka():
    reset()
    tube_mat = material("Tube", "#5d7a3a", 0.45, 0.2)
    wood = material("Grip", "#7a4422", 0.7)
    band = material("Band", "#f2c94c", 0.4, 0.3)
    rx = (0, math.pi / 2, 0)
    cylinder("barrel", (0.15, 0, 0), 0.11, 0.9, tube_mat, 18, rx)
    cone("muzzle", (0.66, 0, 0), 0.17, 0.11, 0.18, tube_mat, rx)
    cone("rear", (-0.36, 0, 0), 0.1, 0.15, 0.16, tube_mat, rx)
    cube("grip", (0.04, 0, -0.17), (0.08, 0.08, 0.24), wood)
    torus("ring", (0.3, 0, 0), 0.125, 0.03, band, (0, math.pi / 2, 0))
    torus("ring2", (-0.1, 0, 0), 0.125, 0.03, band, (0, math.pi / 2, 0))
    join("Bazooka")
    export("bazooka.glb")


def holy_grenade():
    reset()
    gold = material("Gold", "#f5c542", 0.32, 0.5)
    white = material("Cross", "#fff8e0", 0.4)
    uv_sphere("orb", (0, 0, 0), (0.24, 0.24, 0.24), gold, 22, 14)
    cylinder("neck", (0, 0, 0.25), 0.07, 0.1, gold, 12)
    cube("crossV", (0, 0, 0.42), (0.07, 0.07, 0.3), white)
    cube("crossH", (0, 0, 0.46), (0.22, 0.07, 0.07), white)
    torus("band", (0, 0, 0), 0.24, 0.025, white, (0, 0, 0))
    join("HolyGrenade")
    export("holy-grenade.glb")


def donkey():
    reset()
    stone = material("Concrete", "#a9a4ad", 0.9)
    dark = material("Crack", "#5e5866", 0.85)
    eye = material("DonkeyEye", "#1a1416", 0.4)
    cube("body", (0, 0, 0.66), (1.2, 0.5, 0.56), stone, 0.3)
    cube("neck", (0.5, 0, 0.88), (0.32, 0.3, 0.42), stone, 0.3)
    cube("head", (0.82, 0, 1.08), (0.5, 0.36, 0.38), stone, 0.3)
    cube("snout", (1.08, 0, 0.98), (0.24, 0.3, 0.22), dark, 0.3)
    cube("earL", (0.72, 0.1, 1.38), (0.12, 0.08, 0.34), stone, 0.3)
    cube("earR", (0.86, -0.1, 1.38), (0.12, 0.08, 0.34), stone, 0.3)
    uv_sphere("eye", (0.95, -0.18, 1.14), (0.05, 0.03, 0.06), eye, 10, 8)
    for i, x in enumerate((-0.36, 0.26)):
        for j, y in enumerate((-0.18, 0.18)):
            cube(f"leg{i}{j}", (x, y, 0.24), (0.2, 0.18, 0.5), stone, 0.3)
    cube("tail", (-0.68, 0, 0.82), (0.3, 0.1, 0.1), dark, 0.3)
    cube("crack", (0.05, -0.26, 0.74), (0.55, 0.04, 0.07), dark, 0.2)
    cube("base", (0, 0, 0.03), (1.3, 0.62, 0.08), dark, 0.3)
    join("Donkey")
    export("donkey.glb")


def helicopter():
    reset()
    body = material("HeliBody", "#5f8a3c", 0.5, 0.1)
    dark = material("HeliDark", "#22261e", 0.45, 0.3)
    glass = material("Glass", "#a7e3f2", 0.15, 0.1)
    stripe = material("HeliStripe", "#f2c94c", 0.5)
    uv_sphere("cabin", (0.12, 0, 0), (0.6, 0.38, 0.36), body, 22, 14)
    uv_sphere("nose", (0.5, -0.04, 0.02), (0.26, 0.24, 0.22), glass, 16, 10)
    tube("tail", [(-0.35, 0, 0.06), (-0.9, 0, 0.12), (-1.3, 0, 0.2)], 0.1, body, [1.2, 0.85, 0.6])
    cube("fin", (-1.32, 0, 0.36), (0.14, 0.08, 0.4), dark)
    cube("band", (-0.05, 0, 0.0), (0.12, 0.8, 0.74), stripe, 0.4)
    cylinder("skidL", (0.05, 0.26, -0.42), 0.04, 1.0, dark, 8, (0, math.pi / 2, 0))
    cylinder("skidR", (0.05, -0.26, -0.42), 0.04, 1.0, dark, 8, (0, math.pi / 2, 0))
    cube("strutA", (0.3, 0, -0.32), (0.05, 0.56, 0.2), dark, 0.2)
    cube("strutB", (-0.2, 0, -0.32), (0.05, 0.56, 0.2), dark, 0.2)
    rotor = empty("Rotor", (0.05, 0, 0.52))
    parent_to(cylinder("rotorMast", (0.05, 0, 0.44), 0.06, 0.2, dark, 10), rotor)
    parent_to(cube("Blade", (0.05, 0, 0.55), (1.9, 0.12, 0.04), dark, 0.3), rotor)
    parent_to(cube("BladeB", (0.05, 0, 0.57), (0.12, 1.7, 0.04), dark, 0.3), rotor)
    export("helicopter.glb")


def tank():
    reset()
    paint = material("TankPaint", "#6f8a3a", 0.55, 0.15)
    dark = material("Track", "#231f1a", 0.7, 0.2)
    metal = material("Barrel", "#4a4f45", 0.35, 0.45)
    wheel = material("Wheel", "#8a8f80", 0.5, 0.3)
    cube("hull", (0, 0, 0.36), (1.6, 0.82, 0.4), paint, 0.3)
    cube("trackL", (0, 0.44, 0.22), (1.75, 0.2, 0.38), dark, 0.45)
    cube("trackR", (0, -0.44, 0.22), (1.75, 0.2, 0.38), dark, 0.45)
    for i, x in enumerate((-0.6, -0.2, 0.2, 0.6)):
        cylinder(f"wheel{i}", (x, -0.56, 0.2), 0.14, 0.06, wheel, 14, (math.pi / 2, 0, 0))
    uv_sphere("turret", (0.02, 0, 0.66), (0.44, 0.38, 0.28), paint, 18, 12)
    cylinder("hatch", (-0.08, 0, 0.92), 0.14, 0.08, dark, 12)
    pivot = empty("Turret", (0.2, 0, 0.68))
    parent_to(cylinder("gun", (0.64, 0, 0.68), 0.08, 0.9, metal, 14, (0, math.pi / 2, 0)), pivot)
    parent_to(cone("brake", (1.1, 0, 0.68), 0.13, 0.09, 0.16, metal, (0, math.pi / 2, 0)), pivot)
    export("tank.glb")


def bunker():
    reset()
    stone = material("Wall", "#a88f86", 0.85)
    stone_dark = material("WallDark", "#7b6460", 0.85)
    roof = material("Roof", "#5b6b78", 0.75)
    hole = material("Opening", "#241612", 0.9)
    cube("base", (0, 0, 0.62), (2.4, 1.3, 1.24), stone, 0.16)
    for i, (x, z, w) in enumerate(((-0.75, 0.25, 0.8), (0.2, 0.3, 0.9), (0.95, 0.28, 0.5), (-0.4, 0.95, 1.0), (0.65, 0.98, 0.9))):
        cube(f"block{i}", (x, -0.64, z), (w, 0.1, 0.42), stone_dark, 0.4)
    cube("slab", (0, 0, 1.36), (2.7, 1.5, 0.28), roof, 0.35)
    uv_sphere("boulder", (-0.6, 0, 1.6), (0.36, 0.3, 0.26), stone_dark, 12, 8)
    cube("slit", (0.1, -0.68, 0.98), (0.9, 0.08, 0.16), hole, 0.3)
    cube("door", (-0.25, -0.67, 0.4), (0.5, 0.08, 0.72), hole, 0.3)
    join("Bunker")
    export("bunker.glb")


def workshop():
    reset()
    wood = material("ShopWall", "#9b6236", 0.8)
    wood_dark = material("ShopBeam", "#5e3519", 0.8)
    roof = material("ShopRoof", "#e3b04b", 0.85)
    gear = material("Gear", "#f2c94c", 0.4, 0.6)
    door = material("ShopDoor", "#2e1c10", 0.9)
    cube("shed", (0, 0, 0.6), (2.1, 1.2, 1.2), wood, 0.12)
    for i, x in enumerate((-1.0, 1.0)):
        cube(f"post{i}", (x, -0.6, 0.6), (0.16, 0.16, 1.3), wood_dark, 0.3)
    cube("beam", (0, -0.62, 1.15), (2.3, 0.12, 0.14), wood_dark, 0.3)
    cone("roof", (0, 0, 1.62), 1.75, 0.1, 0.9, roof, (0, 0, math.radians(45)), 4, (1.0, 0.62, 1.0), False)
    cylinder("chimney", (-0.65, 0.2, 1.95), 0.15, 0.7, wood_dark, 10)
    torus("gear", (0.62, -0.62, 0.72), 0.24, 0.07, gear, (math.pi / 2, 0, 0))
    cube("door", (-0.2, -0.62, 0.42), (0.55, 0.08, 0.72), door, 0.3)
    join("Workshop")
    export("workshop.glb")


def cactus():
    reset()
    green = material("Cactus", "#4f9a3a", 0.7)
    tube("trunk", [(0, 0, 0), (0, 0, 0.6), (0.02, 0, 1.15)], 0.16, green)
    tube("armL", [(0, 0, 0.5), (-0.3, 0, 0.55), (-0.32, 0, 0.9)], 0.1, green)
    tube("armR", [(0, 0, 0.42), (0.3, 0, 0.45), (0.32, 0, 0.75)], 0.09, green)
    join("Cactus")
    export("cactus.glb")


def crate():
    reset()
    wood = material("Crate", "#b0702e", 0.8)
    band = material("CrateBand", "#5a3416", 0.6)
    cube("box", (0, 0, 0.32), (0.64, 0.64, 0.64), wood, 0.12)
    cube("bandX", (0, 0, 0.32), (0.68, 0.12, 0.68), band, 0.3)
    cube("bandZ", (0, 0, 0.32), (0.12, 0.68, 0.68), band, 0.3)
    join("Crate")
    export("crate.glb")


def bomb():
    reset()
    red = material("Bomb", "#d8392b", 0.45)
    dark = material("Fin", "#2a2020", 0.5)
    uv_sphere("shell", (0, 0, 0), (0.2, 0.2, 0.3), red, 18, 12)
    cone("nose", (0, 0, -0.3), 0.19, 0.03, 0.2, red, (math.pi, 0, 0))
    cube("finA", (0, 0, 0.26), (0.32, 0.04, 0.18), dark, 0.3)
    cube("finB", (0, 0, 0.26), (0.04, 0.32, 0.18), dark, 0.3)
    join("Bomb")
    export("bomb.glb")


def spear():
    reset()
    wood = material("Pole", "#7a4420", 0.8)
    stone = material("Stone", "#8d93a8", 0.85)
    stone_dark = material("StoneDark", "#5d6278", 0.85)
    rope = material("Rope", "#d8a85a", 0.8)
    tube("pole", [(0, 0, -0.5), (0.03, 0, 1.6), (0.0, 0, 3.7)], 0.13, wood, [1.1, 1.0, 0.9], 6)
    # Faceted flint arrowhead (bipyramid flattened towards the camera).
    cone("tip", (0, 0, 4.35), 0.5, 0.0, 1.25, stone, verts=6, scale=(1.0, 0.42, 1.0), smooth=False)
    cone("tipBase", (0, 0, 3.6), 0.12, 0.5, 0.25, stone_dark, verts=6, scale=(1.0, 0.42, 1.0), smooth=False)
    for i, z in enumerate((3.25, 3.38, 3.51)):
        torus(f"rope{i}", (0, 0, z), 0.15, 0.045, rope, (0, 0, 0), 14)
    tube("strap", [(0.1, -0.12, 3.3), (0.22, -0.16, 3.0), (0.18, -0.16, 2.7)], 0.03, rope)
    join("Spear")
    export("spear.glb")


def stalk():
    reset()
    wood = material("Stalk", "#8a5226", 0.8)
    light = material("StalkCup", "#b9773a", 0.8)
    rope = material("StalkRope", "#d8a85a", 0.8)
    tube(
        "branch",
        [(0, 0, -0.5), (0.05, 0, 0.9), (0.35, 0, 1.9), (0.95, 0, 2.6), (1.7, 0, 2.95)],
        0.13,
        wood,
        [1.3, 1.0, 0.85, 0.7, 0.6],
    )
    uv_sphere("cup", (2.15, 0, 3.02), (0.62, 0.3, 0.2), light, 18, 10, (0, math.radians(-12), 0))
    uv_sphere("cupRim", (2.15, -0.02, 3.1), (0.5, 0.22, 0.08), wood, 16, 8, (0, math.radians(-12), 0))
    tube("twig", [(0.3, 0, 1.7), (0.0, 0, 2.1), (-0.25, 0, 2.3)], 0.05, wood)
    torus("knot", (0.06, 0, 0.9), 0.15, 0.04, rope, (0, math.radians(-8), 0), 14)
    join("Stalk")
    export("stalk.glb")


def airship():
    reset()
    hull = material("Hull", "#b8c2cc", 0.6, 0.1)
    hull_dark = material("HullDark", "#7d8792", 0.6, 0.1)
    stripe = material("Stripe", "#1f63c9", 0.5)
    rib = material("Rib", "#f2a3a3", 0.6)
    inside = material("HullInside", "#3a1a2a", 0.9)
    uv_sphere("hull", (0, 0, 0), (3.1, 1.0, 1.0), hull, 32, 18)
    uv_sphere("stripe", (0, 0, -0.08), (3.13, 1.035, 0.24), stripe, 32, 10)
    # Torn-open top showing the pink ribs, like the crashed zeppelin in the reference.
    uv_sphere("tear", (0.5, -0.05, 0.62), (1.6, 0.75, 0.42), inside, 20, 10)
    for i, x in enumerate((-0.6, 0.0, 0.6, 1.2, 1.7)):
        torus(f"rib{i}", (x, 0, 0.0), 0.95 - abs(x - 0.5) * 0.12, 0.06, rib, (0, math.pi / 2, 0), 18)
    for i, rot in enumerate((0, math.pi / 2)):
        cube(f"fin{i}", (-2.95, 0, 0), (0.9, 0.1, 1.5), hull_dark, 0.3, (rot, 0, 0))
    cube("gondola", (0.3, 0, -1.02), (1.3, 0.5, 0.36), hull_dark, 0.35)
    cone("prop", (-3.25, 0, 0), 0.22, 0.05, 0.3, hull_dark, (0, math.pi / 2, 0))
    join("Airship")
    export("airship.glb")


def oil_drum():
    reset()
    green = material("Drum", "#3f8f2e", 0.5, 0.2)
    ring = material("DrumRing", "#23561a", 0.5, 0.2)
    label = material("DrumLabel", "#f5c518", 0.5)
    cylinder("drum", (0, 0, 0.38), 0.3, 0.76, green, 22, (0, 0, 0), 0.25)
    for i, z in enumerate((0.04, 0.26, 0.5, 0.72)):
        torus(f"ring{i}", (0, 0, z), 0.305, 0.028, ring, (0, 0, 0), 22)
    uv_sphere("flame", (0, -0.29, 0.4), (0.12, 0.035, 0.15), label, 12, 8)
    cylinder("cap", (0.12, 0, 0.78), 0.05, 0.04, ring, 10)
    join("OilDrum")
    export("oil-drum.glb")


if __name__ == "__main__":
    worm()
    bazooka()
    holy_grenade()
    donkey()
    helicopter()
    tank()
    bunker()
    workshop()
    cactus()
    crate()
    bomb()
    spear()
    stalk()
    airship()
    oil_drum()
    print("DONE")
