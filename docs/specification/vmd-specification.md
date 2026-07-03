**MMD uses left-handed system**. Format is Little-Endian.

VMD is 30 fps.

# C Types

|Name|Size (bytes)|Range|Notes|std type|
|---|---|---|---|---|
|byte|1|-128..127|char|int8_t|
|ubyte|1|0..255|unsigned char|uint8_t|
|int|4|-2^31..( 2^31 - 1 )|int|int32_t|
|uint|4|0..( 2^32 - 1 )|unsigned int|uint32_t|
|float|4|IEEE 754 single|float|float|

# Header
|Field|Structure|Value|Notes|
|---|---|---|---|
|Signature|byte[30]|"Vocaloid Motion Data file" or "Vocaloid Motion Data 0002" | Encoding is Shift-JIS. "Vocaloid Motion Data file" if the VMD was created with MikuMikuDance 1.30 (prior to the "Multi-Model" version). "Vocaloid Motion Data 0002" if the VMD was created with later versions (Multi-Model Edition)|
|model name|byte[10] or byte[20]|NULL terminated model name|Encoding is Shift-JIS. byte[10] if old version else byte[20]|

# Bone keyframe list
|Field|Structure|Notes|
|---|---|---|
|Keyframe Count|uint||
|Keyframe|Keyframe * Keyframe Count||

## Keyframe
|Field|Structure|Notes|
|---|---|---|
|Bone name|byte[15]|Encoding is Shift-JIS. A null-terminated string|
|Frame number|uint|The frame number. Since keyframes are not necessarily stored for each actual frame, the animation software must interpolate between two adjacent keyframes with different frame indices.|
|X pos|float|Local coordinate|
|Y pos|float|Local coordinate|
|Z pos|float|Local coordinate|
|X rotation|float|Quaternion, local coordinate|
|Y rotation|float|Quaternion, local coordinate|
|Z rotation|float|Quaternion, local coordinate|
|W rotation|float|Quaternion, local coordinate|
|Frame interpolation|byte[64]|Not all of the data is used|

## Interpolation Data
Cubic-bezier interpolation.

If you divide each value by 127.0, you can convert it to a value between 0.0 and 1.0.

|Field|Structure|Notes|
|---|---|---|
|X pos bezier x0|byte||
|X pos bezier y0|byte||
|X pos bezier x1|byte||
|X pos bezier y1|byte||
|Y pos bezier x0|byte||
|Y pos bezier y0|byte||
|Y pos bezier x1|byte||
|Y pos bezier y1|byte||
|Z pos bezier x0|byte||
|Z pos bezier y0|byte||
|Z pos bezier x1|byte||
|Z pos bezier y1|byte||
|Rotation bezier x0|byte|Quaternion interpolation|
|Rotation bezier y0|byte|Quaternion interpolation|
|Rotation bezier x1|byte|Quaternion interpolation|
|Rotation bezier y1|byte|Quaternion interpolation|
|Padding|byte[48]|Not used|

# Face keyframe list
|Field|Structure|Notes|
|---|---|---|
|FaceKeyframe Count|uint||
|FaceKeyframe|FaceKeyframe * FaceKeyframe Count||

## FaceKeyframe
|Field|Structure|Notes|
|---|---|---|
|Face name|byte[15]|Encoding is Shift-JIS. A null-terminated string|
|Frame number|uint|The frame number|
|Weight|float|Weight - this value is on a scale of 0.0-1.0. It is used to scale how much a face morph should move a vertex based off of the maximum possible coordinate that it can move by (specified in the PMD)|

# Camera keyframe list
|Field|Structure|Notes|
|---|---|---|
|CameraKeyframe Count|uint||
|CameraKeyframe|CameraKeyframe * CameraKeyframe Count||

## CameraKeyframe
|Field|Structure|Notes|
|---|---|---|
|Frame index|uint||
|Camera distance|float|Distance from camera position to target|
|Target X pos|float|World X-coordinate of target position|
|Target Y pos|float|World Y-coordinate of target position|
|Target Z pos|float|World Z-coordinate of target position|
|Camera X pos|float|World X-coordinate of camera position|
|Camera Y pos|float|World Y-coordinate of camera position|
|Camera Z pos|float|World Z-coordinate of camera position|
|Interpolation|byte[24]|All data is used|
|Camera FOV|uint||
|Perspective|byte|Perspective toggle|

## Interpolation Data
Cubic-bezier interpolation.

If you divide each value by 127.0, you can convert it to a value between 0.0 and 1.0.

|Field|Structure|Notes|
|---|---|---|
|Traget X pos bezier x0|byte||
|Traget X pos bezier y0|byte||
|Traget X pos bezier x1|byte||
|Traget X pos bezier y1|byte||
|Target Y pos bezier x0|byte||
|Target Y pos bezier y0|byte||
|Target Y pos bezier x1|byte||
|Target Y pos bezier y1|byte||
|Target Z pos bezier x0|byte||
|Target Z pos bezier y0|byte||
|Target Z pos bezier x1|byte||
|Target Z pos bezier y1|byte||
|Camera X pos bezier x0|byte||
|Camera X pos bezier y0|byte||
|Camera X pos bezier x1|byte||
|Camera X pos bezier y1|byte||
|Camera Y pos bezier x0|byte||
|Camera Y pos bezier y0|byte||
|Camera Y pos bezier x1|byte||
|Camera Y pos bezier y1|byte||
|Camera Z pos bezier x0|byte||
|Camera Z pos bezier y0|byte||
|Camera Z pos bezier x1|byte||
|Camera Z pos bezier y1|byte||

# Light keyframe list
|Field|Structure|Notes|
|---|---|---|
|LightKeyframe Count|uint||
|LightKeyframe|LightKeyframe * LightKeyframe Count||

## LightKeyframe
|Field|Structure|Notes|
|---|---|---|
|Frame index|uint||
|Color r|float|Red|
|Color g|float|Green|
|Color b|float|Blue|
|Light X pos|float|World X-coordinate of light position|
|Light Y pos|float|World Y-coordinate of light position|
|Light Z pos|float|World Z-coordinate of light position|

# Slef-Shadow keyframe list
|Field|Structure|Notes|
|---|---|---|
|SelfShadowKeyFrame Count|uint||
|SelfShadowKeyFrame|SelfShadowKeyFrame * SelfShadowKeyFrame Count||

## SelfShadowKeyFrame
|Field|Structure|Notes|
|---|---|---|
|Frame index|uint||
|Mode|byte||
|Distance|float||