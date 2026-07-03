# PMD Specification

PMD (Polygon Model Data) is the original model format used by MikuMikuDance (MMD). It is a binary format that defines a 3D character model, including geometry, skeleton, materials, and physics.

**MMD uses left-handed system**. Format is Little-Endian.

OpenMMD negates the Z-axis during loading to convert to its internal coordinate system (usually right-handed with Z pointing forward/backward depending on convention, but PMX/PMD typically have Z pointing "into" the screen in MMD's view).

## Types

| Name    | Size (bytes) | Notes                                      |
| ------- | ------------ | ------------------------------------------ |
| byte    | 1            | int8                                       |
| ubyte   | 1            | uint8                                      |
| short   | 2            | int16                                      |
| ushort  | 2            | uint16                                     |
| int     | 4            | int32                                      |
| uint    | 4            | uint32                                     |
| float   | 4            | IEEE 754 single                            |
| vec2    | 8            | float[2]                                   |
| vec3    | 12           | float[3]                                   |
| sjis    | N            | Shift-JIS encoded string, null-terminated  |

## File Structure

A PMD file is parsed sequentially in the following order:

### 1. Header

| Field      | Type      | Value/Notes                       |
| ---------- | --------- | --------------------------------- |
| Signature  | byte[3]   | "Pmd"                             |
| Version    | float     | e.g., 1.0                         |
| Model Name | sjis[20]  | Null-padded Shift-JIS             |
| Comment    | sjis[256] | Null-padded Shift-JIS             |

### 2. Vertices

| Field         | Type   | Notes                                               |
| ------------- | ------ | --------------------------------------------------- |
| Count         | uint   | Number of vertices                                  |

**Vertex Structure:**

| Field         | Type      | Notes                                               |
| ------------- | --------- | --------------------------------------------------- |
| Position      | vec3      | XYZ coordinates (Z is negated in OpenMMD)           |
| Normal        | vec3      | Normal vector (Z is negated in OpenMMD)             |
| UV            | vec2      | Texture coordinates (U, V)                          |
| Bone Indices  | ushort[2] | Indices of bones affecting this vertex              |
| Bone Weight   | ubyte     | Weight of first bone (0-100). Second is 100-Weight. |
| Edge Flag     | ubyte     | 0: No edge, 1: Draw edge                            |

### 3. Vertex Indices

| Field   | Type     | Notes                               |
| ------- | -------- | ----------------------------------- |
| Count   | uint     | Number of indices (usually 3 * triangles) |
| Indices | ushort[] | Array of vertex indices             |

### 4. Materials

| Field | Type | Notes               |
| ----- | ---- | ------------------- |
| Count | uint | Number of materials |

**Material Structure:**

| Field             | Type     | Notes                                            |
| ----------------- | -------- | ------------------------------------------------ |
| Diffuse Color     | float[4] | RGBA (0.0 - 1.0)                                 |
| Shininess         | float    | Specular power                                   |
| Specular Color    | float[3] | RGB                                              |
| Ambient Color     | float[3] | RGB                                              |
| Toon Index        | ubyte    | Index for toon textures (0-9 or 255 for none)    |
| Edge Flag         | ubyte     | 0: No edge, 1: Draw edge                         |
| Face Vertex Count | uint     | Number of indices used by this material          |
| Texture Path      | sjis[20] | Texture file name (can include `*` for sphere)   |

Note: `Texture Path` can contain a primary texture and a sphere map separated by `*`. OpenMMD detects the sphere mode by extension: `.sph` (1: Multiply) or `.spa` (2: Additive).

### 5. Bones

| Field | Type   | Notes           |
| ----- | ------ | --------------- |
| Count | ushort | Number of bones |

**Bone Structure:**

| Field         | Type     | Notes                                                     |
| ------------- | -------- | --------------------------------------------------------- |
| Name          | sjis[20] | Bone name                                                 |
| Parent Index  | short    | Index of parent bone (-1 if none)                         |
| Tail Index    | short    | Index of child bone for target display                    |
| Type          | ubyte    | 0: Rotate, 1: Rot/Move, 2: IK, 3: Hidden, 4: IK Child... |
| IK Index      | ushort   | Associated IK bone index (if Type=2 or 4)                 |
| Position      | vec3     | Absolute position in world space (Z negated in OpenMMD)   |

### 6. IK (Inverse Kinematics)

| Field | Type   | Notes             |
| ----- | ------ | ----------------- |
| Count | ushort | Number of IK data |

**IK Structure:**

| Field              | Type     | Notes                                     |
| ------------------ | -------- | ----------------------------------------- |
| IK Bone Index      | ushort   | Index of the IK bone                      |
| Target Bone Index  | ushort   | Index of the target bone (IK effector)    |
| Chain Length       | ubyte    | Number of bones in the IK chain           |
| Iteration          | ushort   | Number of iterations for CCD              |
| Limitation         | float    | Angle limit (radians) per iteration       |
| Child Bone Indices | ushort[] | Array of indices (size = `Chain Length`)  |

### 7. Morphs (Faces)

| Field | Type   | Notes             |
| ----- | ------ | ----------------- |
| Count | ushort | Number of morphs  |

**Morph Structure:**

| Field        | Type     | Notes                                       |
| ------------ | -------- | ------------------------------------------- |
| Name         | sjis[20] | Morph name                                  |
| Vertex Count | uint     | Number of vertices affected by this morph   |
| Type         | ubyte    | 0: Base, 1: Brow, 2: Eye, 3: Lip, 4: Other  |
| Data         | ~[]      | Array of vertex morph data                  |

**Vertex Morph Data:**

| Field    | Type   | Notes                               |
| -------- | ------ | ----------------------------------- |
| Index    | uint   | Vertex index (offset from base)     |
| Position | vec3   | Coordinate offset (delta, Z negated in OpenMMD) |

### 8. Morph Display Indices

| Field   | Type     | Notes                                  |
| ------- | -------- | -------------------------------------- |
| Count   | ubyte    | Number of morphs to display in the UI  |
| Indices | ushort[] | Array of morph indices                 |

### 9. Bone Frame Names

| Field | Type    | Notes                              |
| ----- | ------- | ---------------------------------- |
| Count | ubyte   | Number of bone display groups      |
| Names | sjis[50][] | Array of display group names    |

### 10. Bone Display Entries

| Field | Type   | Notes                  |
| ----- | ------ | ---------------------- |
| Count | uint   | Total number of entries |

**Entry Structure:**

| Field       | Type   | Notes                         |
| ----------- | ------ | ----------------------------- |
| Bone Index  | ushort | Index of the bone             |
| Frame Index | ubyte  | Index of the bone frame name  |

### 11. English Metadata (Optional)

This section exists if there are bytes remaining after the above sections.

| Field                 | Type       | Notes                                      |
| --------------------- | ---------- | ------------------------------------------ |
| English Compatibility | ubyte      | 1 if English data is present               |
| Model Name En         | sjis[20]   | English model name                         |
| Comment En            | sjis[256]  | English comment                            |
| Bone Names En         | sjis[20][] | One per bone                               |
| Face Names En         | sjis[20][] | One per morph (excluding "Base" morph)     |
| Frame Names En        | sjis[50][] | One per bone frame name                    |

### 12. Toon Textures

| Field      | Type        | Notes                                |
| ---------- | ----------- | ------------------------------------ |
| File Names | sjis[100][] | Exactly 10 strings (1000 bytes total) |

### 13. Physics (Rigid Bodies)

| Field | Type | Notes                  |
| ----- | ---- | ---------------------- |
| Count | uint | Number of rigid bodies |

**Rigid Body Structure:**

| Field               | Type      | Notes                                      |
| ------------------- | --------- | ------------------------------------------ |
| Name                | sjis[20]  | Name                                       |
| Related Bone Index  | short     | Associated bone index (-1 if none)         |
| Group ID            | ubyte     | Collision group index                      |
| Collision Mask      | ushort    | Non-collision group mask                   |
| Shape               | ubyte     | 0: Sphere, 1: Box, 2: Capsule              |
| Size                | vec3      | Dimensions (Radius, Height, etc.)          |
| Position            | vec3      | Position offset from associated bone (Z negated in OpenMMD) |
| Rotation            | vec3      | Euler angles (radians, X/Y negated in OpenMMD) |
| Mass                | float     |                                            |
| Move Attenuation    | float     | Linear damping                             |
| Rotation Damping    | float     | Angular damping                            |
| Repulsion           | float     | Restitution                                |
| Friction            | float     |                                            |
| Physics Mode        | ubyte     | 0: Follow bone, 1: Physics, 2: Bone + Phys |

OpenMMD load-time note: if a rigid body has `Physics Mode = 2` and its parent bone is attached to a rigid body whose `Physics Mode` is `1` or `2`, OpenMMD normalizes that rigid body to `Physics Mode = 1` during import. This avoids instability in chained `2 -> 2` physics bodies.

### 14. Physics (Joints)

| Field | Type | Notes            |
| ----- | ---- | ---------------- |
| Count | uint | Number of joints |

**Joint Structure:**

| Field             | Type     | Notes                                   |
| ----------------- | -------- | --------------------------------------- |
| Name              | sjis[20] | Name                                    |
| Rigid Body A      | uint     | Index of first rigid body               |
| Rigid Body B      | uint     | Index of second rigid body              |
| Position          | vec3     | World position (Z negated in OpenMMD)   |
| Rotation          | vec3     | World rotation (Euler radians, X/Y negated in OpenMMD) |
| Position Min      | vec3     | Linear constraint lower limit           |
| Position Max      | vec3     | Linear constraint upper limit           |
| Rotation Min      | vec3     | Angular constraint lower limit (Z negated in OpenMMD) |
| Rotation Max      | vec3     | Angular constraint upper limit (Z negated in OpenMMD) |
| Position Spring   | vec3     | Linear stiffness                        |
| Rotation Spring   | vec3     | Angular stiffness                       |

Note: In OpenMMD, the linear constraint Z limits (`Position Min/Max`) are calculated as:
- `posMin.z = -max(posMinRaw.z, posMaxRaw.z)`
- `posMax.z = -min(posMinRaw.z, posMaxRaw.z)`
