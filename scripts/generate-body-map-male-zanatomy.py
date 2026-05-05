import math
import os
import re
import subprocess

import bpy
from mathutils import Vector
from mathutils.geometry import tessellate_polygon


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SOURCE_BLEND = os.path.join(ROOT, ".tmp_bodymap_assets", "Z-Anatomy", "Z-Anatomy.blend")
OUT_DIR = os.path.join(ROOT, "ios", "Zenith")
TEMP_USDC = os.path.join(OUT_DIR, "BodyMapModel.usdc")
OUT_USDZ = os.path.join(OUT_DIR, "BodyMapModel.usdz")
PREVIEW_DIR = os.path.join(ROOT, ".tmp_bodymap_render", "zanatomy_v1")

REGION_COLORS = {
    "CHEST": "#E97862",
    "DELTS": "#2F74FF",
    "BICEPS": "#9264F4",
    "TRICEPS": "#E73E89",
    "FOREARMS": "#22BFE2",
    "BACK": "#7447E8",
    "ABS": "#8FBDF6",
    "CORE_SIDE": "#22AFC0",
    "GLUTES": "#FF791A",
    "HIP": "#F3CD45",
    "QUADS": "#31A94F",
    "HAMSTRINGS": "#2788F8",
    "CALVES": "#F43E92",
    "TIBIALIS": "#8656E9",
    "NECK": "#14C4D4",
    "FACE": "#E85D6A",
    "FACE_BONE": "#E6D09C",
    "BASE": "#10151D",
}

SIDE_SOURCE = {"L": ".r", "R": ".l"}
EXCLUDES = (
    " insertion",
    "-insertion",
    " origin",
    " on ",
    " artery",
    " vein",
    " nerve",
    " tendon",
    " region",
    " fold",
    " border",
    " cord",
    " retinaculum",
    " membrane",
    " phalanx",
    " metatarsal",
    " metacarpal",
    " calcane",
    " tuberc",
    " surface",
    " bone",
    " cartilage",
)

SIDE_GROUPS = {
    "CHEST": ["clavicular head of pectoralis major muscle", "sternocostal head of pectoralis major muscle", "abdominal part of pectoralis major muscle"],
    "DELTS_FRONT": ["clavicular part of deltoid muscle"],
    "DELTS_SIDE": ["acromial part of deltoid muscle"],
    "DELTS_REAR": ["scapular part of deltoid uscle"],
    "BICEPS": ["long head of biceps brachii muscle", "short head of biceps brachii"],
    "TRICEPS": ["lateral head of triceps brachii muscle", "triceps brachii muscle"],
    "FOREARMS": [
        "brachioradialis muscle",
        "flexor carpi radialis",
        "humeral head of flexor carpi ulnaris",
        "ulnar head of flexor carpi ulnaris",
        "extensor carpi radialis longus",
        "extensor carpi radialis brevis",
        "humeral head of extensor carpi ulnaris",
        "ulnar head of extensor carpi ulnaris",
        "extensor digitorum",
        "flexor digitorum superficialis",
        "superficial head of pronator teres muscle",
        "supinator",
    ],
    "UPPER_BACK": ["rhomboid major muscle", "rhomboid minor muscle", "infraspinatus muscle", "teres major muscle", "teres minor muscle"],
    "LATS": ["latissimus dorsi muscle"],
    "TRAPS": ["descending part of trapezius muscle", "transverse part of trapezius muscle", "ascending part of trapezius muscle"],
    "OBLIQUES": ["external abdominal oblique", "internal abdominal oblique"],
    "GLUTES": ["gluteus maximus muscle", "gluteus medius muscle"],
    "HIP_FLEXORS": ["iliacus muscle", "psoas muscle", "tensor fasciae latae", "sartorius muscle"],
    "ADDUCTORS": ["adductor longus", "adductor brevis", "adductor magnus", "adductor minimus", "gracilis muscle", "pectineus muscle"],
    "QUADS": ["rectus femoris muscle", "vastus lateralis muscle", "vastus medialis muscle", "vastus intermedius muscle"],
    "HAMSTRINGS": ["long head of biceps femoris muscle", "short head of biceps femoris muscle", "semitendinosus muscle", "semimembranosus muscle"],
    "CALVES": ["lateral head of gastrocnemius", "medial head of gastrocnemius", "soleus muscle"],
    "TIBIALIS": ["tibialis anterior muscle"],
}

BOTH_SIDE_GROUPS = {
    "ABS": ["rectus abdominis muscle", "pyramidalis muscle"],
    "LOWER_BACK": ["quadratus lumborum muscle", "longissimus thoracis muscle", "iliocostalis lumborum muscle", "spinalis thoracis muscle"],
    "NECK": ["sternocleidomastoid muscle", "sternohyoid muscle", "sternothyroid muscle", "scalene anterior muscle", "splenius capitis muscle", "longissimus colli muscle"],
}

HEAD_BONE_PATTERNS = [
    "frontal bone",
    "parietal bone",
    "occipital bone",
    "temporal bone",
    "mandible",
    "maxilla",
    "nasal bone",
    "zygomatic bone",
    "sphenoid bone",
    "palatine bone",
    "ethmoid bone",
    "vomer",
    "lacrimal bone",
]

FACE_MUSCLE_PATTERNS = [
    "frontalis",
    "occipitalis",
    "orbicularis oris",
    "orbicularis oculi",
    "zygomaticus major",
    "zygomaticus minor",
    "levator anguli oris",
    "levator labii superioris",
    "levator nasolabialis",
    "depressor anguli oris",
    "depressor labii superioris",
    "depressor septi nasi",
    "mentalis muscle",
    "nasalis muscle",
    "procerus",
    "risorius",
    "masseter",
    "temporalis muscle",
    "platysma",
]

REGION_COLOR_KEY = {
    "CHEST": "CHEST",
    "DELTS_FRONT": "DELTS",
    "DELTS_SIDE": "DELTS",
    "DELTS_REAR": "DELTS",
    "BICEPS": "BICEPS",
    "TRICEPS": "TRICEPS",
    "FOREARMS": "FOREARMS",
    "UPPER_BACK": "BACK",
    "LATS": "BACK",
    "TRAPS": "BACK",
    "ABS": "ABS",
    "OBLIQUES": "CORE_SIDE",
    "LOWER_BACK": "CORE_SIDE",
    "GLUTES": "GLUTES",
    "HIP_FLEXORS": "HIP",
    "ADDUCTORS": "HIP",
    "QUADS": "QUADS",
    "HAMSTRINGS": "HAMSTRINGS",
    "CALVES": "CALVES",
    "TIBIALIS": "TIBIALIS",
    "NECK": "NECK",
}


def hex_rgba(hex_color):
    value = hex_color.lstrip("#")
    return tuple(int(value[i : i + 2], 16) / 255 for i in (0, 2, 4)) + (1.0,)


def material(name, hex_color, alpha=1.0):
    mat = bpy.data.materials.new(name)
    rgba = hex_rgba(hex_color)
    rgba = (rgba[0], rgba[1], rgba[2], alpha)
    mat.diffuse_color = rgba
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Roughness"].default_value = 0.52
        bsdf.inputs["Metallic"].default_value = 0
        if "Alpha" in bsdf.inputs:
            bsdf.inputs["Alpha"].default_value = alpha
    if alpha < 1:
        mat.blend_method = "BLEND"
        mat.use_screen_refraction = False
        mat.show_transparent_back = False
    return mat


def make_materials():
    mats = {key: material(f"{key}_material", value) for key, value in REGION_COLORS.items()}
    mats["BASE_BOUNDS"] = material("BASE_BOUNDS_material", REGION_COLORS["BASE"], alpha=0.0)
    return mats


def clean_side_object(name, suffix):
    low = name.lower()
    return low.endswith(suffix) and re.search(r"\.\d{3}$", low) is None


def allowed_name(name):
    low = name.lower()
    return not any(excluded in low for excluded in EXCLUDES)


def source_objects(patterns, suffixes):
    if isinstance(suffixes, str):
        suffixes = [suffixes]
    matches = []
    seen = set()
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        low = obj.name.lower()
        if obj.name in seen or not allowed_name(obj.name):
            continue
        if not any(clean_side_object(obj.name, suffix) for suffix in suffixes):
            continue
        if any(pattern in low for pattern in patterns):
            matches.append(obj)
            seen.add(obj.name)
    return matches


def object_center_x(obj):
    xs = [(obj.matrix_world @ Vector(corner)).x for corner in obj.bound_box]
    return (min(xs) + max(xs)) * 0.5


def source_objects_by_rendered_side(patterns, label):
    target_is_left = label == "L"
    matches = []
    seen = set()
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        low = obj.name.lower()
        if obj.name in seen or not allowed_name(obj.name):
            continue
        if not any(pattern in low for pattern in patterns):
            continue
        center_x = object_center_x(obj)
        if target_is_left and center_x >= -0.005:
            continue
        if not target_is_left and center_x <= 0.005:
            continue
        matches.append(obj)
        seen.add(obj.name)
    return matches


def source_objects_any(patterns, allow_excluded=False):
    matches = []
    seen = set()
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        low = obj.name.lower()
        if obj.name in seen:
            continue
        if not allow_excluded and not allowed_name(obj.name):
            continue
        if re.search(r"\.\d{3}$", low):
            continue
        if any(pattern in low for pattern in patterns):
            matches.append(obj)
            seen.add(obj.name)
    return matches


def set_material(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.material_index = 0


def duplicate_mesh_object(obj, mat):
    copy = obj.copy()
    copy.data = obj.data.copy()
    bpy.context.collection.objects.link(copy)
    copy.matrix_world = obj.matrix_world.copy()
    set_material(copy, mat)
    return copy


def join_objects(name, objects, mat, preserve_materials=False):
    objects = [obj for obj in objects if obj and obj.type == "MESH"]
    if not objects:
        raise RuntimeError(f"No source geometry for {name}")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    joined = bpy.context.object
    joined.name = name
    joined.data.name = name
    if not preserve_materials:
        set_material(joined, mat)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.shade_smooth()

    vertices = len(joined.data.vertices)
    if vertices > 45000:
        ratio = 0.32
    elif vertices > 20000:
        ratio = 0.45
    elif vertices > 9000:
        ratio = 0.62
    else:
        ratio = 1.0
    if ratio < 1.0:
        decimate = joined.modifiers.new("mobile asset decimation", "DECIMATE")
        decimate.ratio = ratio
        bpy.ops.object.modifier_apply(modifier=decimate.name)
    normal_mod = joined.modifiers.new("weighted normals", "WEIGHTED_NORMAL")
    normal_mod.keep_sharp = True
    bpy.ops.object.modifier_apply(modifier=normal_mod.name)
    joined.select_set(False)
    return joined


def ellipse_points(cx, cz, rx, rz, angle=0.0, segments=56):
    ca = math.cos(angle)
    sa = math.sin(angle)
    points = []
    for i in range(segments):
        t = 2 * math.pi * i / segments
        lx = rx * math.cos(t)
        lz = rz * math.sin(t)
        points.append((cx + lx * ca - lz * sa, cz + lx * sa + lz * ca))
    return points


def panel_mesh(name, points, y0, y1, mat):
    verts = [(x, y0, z) for x, z in points] + [(x, y1, z) for x, z in points]
    count = len(points)
    tris = tessellate_polygon([[Vector((x, z, 0)) for x, z in points]])
    faces = []
    for a, b, c in tris:
        faces.append((c, b, a))
        faces.append((count + a, count + b, count + c))
    for i in range(count):
        j = (i + 1) % count
        faces.append((i, j, count + j, count + i))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def capsule_points(start, end, radius, segments=56):
    sx, sz = start
    ex, ez = end
    cx = (sx + ex) * 0.5
    cz = (sz + ez) * 0.5
    dx = ex - sx
    dz = ez - sz
    length = math.sqrt(dx * dx + dz * dz)
    return ellipse_points(cx, cz, radius, max(length * 0.5, radius), angle=math.atan2(dx, dz), segments=segments)


def build_base_body(mats):
    mat = mats["BASE"]
    bounds_mat = bpy.data.materials["BASE_BOUNDS_material"]
    bounds_front = -0.045
    bounds_back = 0.045
    parts = []
    # BaseBody is intentionally a thin neutral frame. The anatomical source
    # meshes provide the surface detail; this node exists for fit bounds and
    # subtle structure without hiding front/back muscle groups.
    head_bones = source_objects_any(HEAD_BONE_PATTERNS, allow_excluded=True)
    face_muscles = source_objects_any(FACE_MUSCLE_PATTERNS)
    parts.extend(duplicate_mesh_object(obj, mats["FACE_BONE"]) for obj in head_bones)
    parts.extend(duplicate_mesh_object(obj, mats["FACE"]) for obj in face_muscles)
    parts.append(panel_mesh("base_neck", capsule_points((0, 1.56), (0, 1.43), 0.022), bounds_front, bounds_back, bounds_mat))
    parts.append(panel_mesh("base_spine", capsule_points((0, 1.42), (0, 0.73), 0.018), bounds_front, bounds_back, bounds_mat))
    parts.append(panel_mesh("base_shoulder_bar", capsule_points((-0.36, 1.35), (0.36, 1.35), 0.016), bounds_front, bounds_back, bounds_mat))
    parts.append(panel_mesh("base_pelvis_bar", capsule_points((-0.20, 0.77), (0.20, 0.77), 0.020), bounds_front, bounds_back, bounds_mat))
    for side in (-1, 1):
        parts.append(panel_mesh(f"base_upper_arm_{side}", capsule_points((side * 0.34, 1.30), (side * 0.48, 1.05), 0.018), bounds_front, bounds_back, bounds_mat))
        parts.append(panel_mesh(f"base_forearm_{side}", capsule_points((side * 0.48, 1.03), (side * 0.60, 0.78), 0.016), bounds_front, bounds_back, bounds_mat))
        parts.append(panel_mesh(f"base_hand_{side}", ellipse_points(side * 0.62, 0.74, 0.032, 0.045), bounds_front, bounds_back, bounds_mat))
        parts.append(panel_mesh(f"base_thigh_{side}", capsule_points((side * 0.12, 0.78), (side * 0.13, 0.43), 0.020), bounds_front, bounds_back, bounds_mat))
        parts.append(panel_mesh(f"base_shin_{side}", capsule_points((side * 0.12, 0.40), (side * 0.10, 0.10), 0.018), bounds_front, bounds_back, bounds_mat))
        parts.append(panel_mesh(f"base_foot_{side}", ellipse_points(side * 0.10, 0.035, 0.060, 0.020), bounds_front, bounds_back, bounds_mat))
    return join_objects("BaseBody", parts, mat, preserve_materials=True)


def build_regions(mats):
    output = [build_base_body(mats)]
    report = []
    for app_group, patterns in SIDE_GROUPS.items():
        for label in ("L", "R"):
            suffix = SIDE_SOURCE[label]
            if app_group == "LATS":
                sources = source_objects_by_rendered_side(patterns, label)
            else:
                sources = source_objects(patterns, suffix)
            name = f"{app_group}_{label}"
            mat = mats[REGION_COLOR_KEY[app_group]]
            copies = [duplicate_mesh_object(obj, mat) for obj in sources]
            output.append(join_objects(name, copies, mat))
            report.append((name, [obj.name for obj in sources]))

    for app_group, patterns in BOTH_SIDE_GROUPS.items():
        suffixes = [".r", ".l"]
        sources = source_objects(patterns, suffixes)
        mat = mats[REGION_COLOR_KEY[app_group]]
        copies = [duplicate_mesh_object(obj, mat) for obj in sources]
        joined = join_objects(app_group, copies, mat)
        if app_group == "ABS":
            joined.location.y -= 0.035
        output.append(joined)
        report.append((app_group, [obj.name for obj in sources]))
    return output, report


def remove_non_output(output):
    keep = set(output)
    for obj in list(bpy.context.scene.objects):
        if obj not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)


def isolate_output_scene(output):
    scene = bpy.data.scenes.new("BodyMapExportScene")
    for obj in output:
        try:
            scene.collection.objects.link(obj)
        except RuntimeError:
            pass
    if bpy.context.window:
        bpy.context.window.scene = scene
    for other in list(bpy.data.scenes):
        if other != scene:
            bpy.data.scenes.remove(other)
    return scene


def center_output(output):
    min_v = Vector((float("inf"), float("inf"), float("inf")))
    max_v = Vector((-float("inf"), -float("inf"), -float("inf")))
    for obj in output:
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            min_v.x = min(min_v.x, world.x)
            min_v.y = min(min_v.y, world.y)
            min_v.z = min(min_v.z, world.z)
            max_v.x = max(max_v.x, world.x)
            max_v.y = max(max_v.y, world.y)
            max_v.z = max(max_v.z, world.z)
    center = (min_v + max_v) * 0.5
    for obj in output:
        obj.location -= center
    return min_v, max_v


def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def render_preview(name, location, target=(0, 0, 0), ortho_scale=1.95):
    camera = bpy.context.scene.camera
    camera.location = location
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = ortho_scale
    look_at(camera, target)
    bpy.context.scene.render.filepath = os.path.join(PREVIEW_DIR, f"{name}.png")
    bpy.ops.render.render(write_still=True)


def render_previews():
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1080
    scene.render.resolution_y = 1440
    scene.render.image_settings.file_format = "PNG"
    scene.world = bpy.data.worlds.new("ZAnatomyPreviewWorld")
    scene.world.color = (0.018, 0.021, 0.026)
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1

    camera = bpy.data.objects.new("PreviewCamera", bpy.data.cameras.new("PreviewCamera"))
    bpy.context.collection.objects.link(camera)
    scene.camera = camera

    for name, loc, energy in [("Key", (0, -3.8, 2.2), 460), ("Fill", (2.6, 2.2, 1.8), 135), ("Rim", (-2.4, 2.4, 2.4), 120)]:
        data = bpy.data.lights.new(f"Preview{name}", "AREA")
        data.energy = energy
        data.size = 4.5
        light = bpy.data.objects.new(f"Preview{name}", data)
        light.location = loc
        bpy.context.collection.objects.link(light)

    render_preview("male_front", (0, -3.6, 0.05))
    render_preview("male_back", (0, 3.6, 0.05))
    render_preview("male_side", (3.6, 0, 0.05))
    render_preview("male_orbit", (2.5, -3.2, 0.45), ortho_scale=2.0)


def export_asset(output):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in output:
        obj.select_set(True)
    bpy.ops.wm.usd_export(
        filepath=TEMP_USDC,
        export_animation=False,
        export_materials=True,
        selected_objects_only=True,
        export_lights=False,
        export_cameras=False,
        export_curves=False,
        export_points=False,
        export_volumes=False,
        root_prim_path="/root",
        merge_parent_xform=True,
    )
    subprocess.run(["usdzip", OUT_USDZ, TEMP_USDC], check=True)
    os.remove(TEMP_USDC)


def main():
    if not os.path.exists(SOURCE_BLEND):
        raise SystemExit(f"Missing Z-Anatomy source blend at {SOURCE_BLEND}")
    bpy.ops.wm.open_mainfile(filepath=SOURCE_BLEND, load_ui=False)
    mats = make_materials()
    output, report = build_regions(mats)
    for name, sources in report:
        print(f"{name}: {len(sources)} source meshes")
    center_output(output)
    isolate_output_scene(output)
    render_previews()
    export_asset(output)
    print("Generated from Z-Anatomy source")
    print(f"Asset: {OUT_USDZ}")
    print(f"Previews: {PREVIEW_DIR}")


if __name__ == "__main__":
    main()
