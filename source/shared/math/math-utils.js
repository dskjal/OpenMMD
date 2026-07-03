import { mat4, quat, vec3, vec4 } from '../../lib/esm/index.js';

export function mat4Perspective(fovy, aspect, near, far) {
  const out = mat4.create();
  mat4.perspectiveZO(out, fovy, aspect, near, far);
  return out;
}

export function mat4LookAt(eye, center, up) {
  const out = mat4.create();
  mat4.lookAt(out, eye, center, up);
  return out;
}

export function mat4Multiply(a, b) {
  const out = mat4.create();
  mat4.multiply(out, a, b);
  return out;
}

export function mat4Translation(x, y, z) {
  const out = mat4.create();
  mat4.fromTranslation(out, [x, y, z]);
  return out;
}

export function mat4Scale(x, y, z) {
  const out = mat4.create();
  mat4.fromScaling(out, [x, y, z]);
  return out;
}

export function mat4Invert(a) {
  const out = mat4.create();
  if (mat4.invert(out, a)) {
    return out;
  }
  return null;
}

export function quatToMat4(value) {
  const out = mat4.create();
  mat4.fromQuat(out, value);
  return out;
}

export function quatRotateY(value, radians) {
  const out = quat.create();
  quat.rotateY(out, value, radians);
  return out;
}

export function quatMultiply(a, b, out = quat.create()) {
  quat.multiply(out, a, b);
  return out;
}

export function quatSlerp(a, b, t, out = quat.create()) {
  quat.slerp(out, a, b, t);
  return out;
}

export function mat4Vec4Mul(matrix, vector, out = vec4.create()) {
  vec4.transformMat4(out, vector, matrix);
  return out;
}

/**
 * 4x4 行列で 3D 点を変換します。
 * @param {ArrayLike<number>} matrix - 変換行列。
 * @param {ArrayLike<number>} point - 変換対象の点。
 * @param {Float32Array|Array<number>} [out=vec3.create()] - 出力先。
 * @returns {Float32Array|Array<number>} 変換後の点。
 */
export function transformPoint(matrix, point, out = vec3.create()) {
  vec3.transformMat4(out, point, matrix);
  return out;
}

export function vec4Scale(vector, scale, out = vec4.create()) {
  vec4.scale(out, vector, scale);
  return out;
}

export function normalize(vector, out = vec3.create()) {
  vec3.normalize(out, vector);
  return out;
}

export function cross(a, b, out = vec3.create()) {
  vec3.cross(out, a, b);
  return out;
}

export function mat4Ortho(left, right, bottom, top, near, far) {
  const out = mat4.create();
  mat4.orthoZO(out, left, right, bottom, top, near, far);
  return out;
}

/**
 * 値が有限数かを判定します。
 * @param {number} value - 判定対象。
 * @returns {boolean} 有限数なら true。
 */
export function isFiniteNumber(value) {
  return Number.isFinite(value);
}

/**
 * 配列または TypedArray かどうかを返します。
 * @param {unknown} value - 判定対象。
 * @returns {boolean} 配列系なら true。
 */
export function isArrayLikeNumbers(value) {
  return Array.isArray(value) || ArrayBuffer.isView(value);
}

/**
 * ベクトルを加算します。
 * @param {Array<number>} a - 左辺ベクトル。
 * @param {Array<number>} b - 右辺ベクトル。
 * @returns {Array<number>} 加算結果。
 */
export function addVec3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/**
 * ベクトルを減算します。
 * @param {Array<number>} a - 左辺ベクトル。
 * @param {Array<number>} b - 右辺ベクトル。
 * @returns {Array<number>} 減算結果。
 */
export function subtractVec3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/**
 * ベクトルをスカラー倍します。
 * @param {Array<number>} vector - 対象ベクトル。
 * @param {number} scalar - 乗算係数。
 * @returns {Array<number>} 乗算結果。
 */
export function scaleVec3(vector, scalar) {
  return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar];
}

/**
 * ベクトルの外積を返します。
 * @param {Array<number>} a - 左辺ベクトル。
 * @param {Array<number>} b - 右辺ベクトル。
 * @returns {Array<number>} 外積。
 */
export function crossVec3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * ベクトルの内積を返します。
 * @param {Array<number>} a - 左辺ベクトル。
 * @param {Array<number>} b - 右辺ベクトル。
 * @returns {number} 内積。
 */
export function dotVec3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * ベクトルの長さを返します。
 * @param {Array<number>} vector - 入力ベクトル。
 * @returns {number} 長さ。
 */
export function lengthVec3(vector) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

/**
 * ベクトルを正規化します。
 * @param {Array<number>|null} vector - 入力ベクトル。
 * @returns {Array<number>|null} 正規化後ベクトル。
 */
export function normalizeVec3(vector) {
  if (!Array.isArray(vector) && !ArrayBuffer.isView(vector)) {
    return null;
  }

  const length = lengthVec3(vector);
  if (!isFiniteNumber(length) || length < 1e-8) {
    return null;
  }

  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

/**
 * 直交基底からクォータニオンを作成します。
 * @param {Array<number>} xAxis - ローカル X 軸。
 * @param {Array<number>} yAxis - ローカル Y 軸。
 * @param {Array<number>} zAxis - ローカル Z 軸。
 * @returns {quat} `[x, y, z, w]`。
 */
export function quaternionFromBasis(xAxis, yAxis, zAxis) {
  const m00 = xAxis[0];
  const m01 = yAxis[0];
  const m02 = zAxis[0];
  const m10 = xAxis[1];
  const m11 = yAxis[1];
  const m12 = zAxis[1];
  const m20 = xAxis[2];
  const m21 = yAxis[2];
  const m22 = zAxis[2];

  let x;
  let y;
  let z;
  let w;
  const trace = m00 + m11 + m22;

  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    w = 0.25 / s;
    x = (m21 - m12) * s;
    y = (m02 - m20) * s;
    z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }

  const length = Math.hypot(x, y, z, w);
  if (!isFiniteNumber(length) || length < 1e-8) {
    return quat.fromValues(0, 0, 0, 1);
  }

  return quat.fromValues(x / length, y / length, z / length, w / length);
}

/**
 * クォータニオンを XYZ 順の Euler 角へ変換します。
 * @param {ArrayLike<number>} rotation - 回転クォータニオン。
 * @param {ArrayLike<number>|null} [prevEuler=null] - 前回の Euler。
 * @returns {number[]} X, Y, Z の Euler 角（ラジアン）。
 */
export function quaternionToEulerXYZ(rotation, prevEuler = null) {
  const x = rotation[0];
  const y = rotation[1];
  const z = rotation[2];
  const w = rotation[3];

  // quaternionFromEulerXYZ() は I * Rx * Ry * Rz の順で回転を合成する。
  // その逆変換になるよう、同じ XYZ 順の回転行列から Euler を抽出する。
  const m00 = 1 - 2 * (y * y + z * z);
  const m01 = 2 * (x * y - z * w);
  const m02 = 2 * (x * z + y * w);
  const m12 = 2 * (y * z - x * w);
  const m22 = 1 - 2 * (x * x + y * y);

  const clampedM02 = Math.max(-1, Math.min(1, m02));
  const angleY = Math.asin(clampedM02);
  const angleX = Math.atan2(-m12, m22);
  const angleZ = Math.atan2(-m01, m00);

  let out = [angleX, angleY, angleZ];

  if (prevEuler) {
    // 2つの解（ブランチ）のうち、前回値に近い方を選択する
    // 解1: (x, y, z)
    // 解2: (x + PI, PI - y, z + PI)
    const sol1 = [
      unwrapAngle(out[0], prevEuler[0]),
      unwrapAngle(out[1], prevEuler[1]),
      unwrapAngle(out[2], prevEuler[2]),
    ];

    const sol2 = [
      unwrapAngle(normalizeRadians(out[0] + Math.PI), prevEuler[0]),
      unwrapAngle(Math.PI - out[1], prevEuler[1]),
      unwrapAngle(normalizeRadians(out[2] + Math.PI), prevEuler[2]),
    ];

    const dist1 = vec3.sqrDist(sol1, prevEuler);
    const dist2 = vec3.sqrDist(sol2, prevEuler);

    out = dist1 < dist2 ? sol1 : sol2;
  }

  return out;
}

/**
 * クォータニオンを YXZ 順の Euler 角へ変換します。
 * @param {ArrayLike<number>} rotation - 回転クォータニオン。
 * @param {ArrayLike<number>|null} [prevEuler=null] - 前回の Euler。
 * @returns {number[]} X, Y, Z の Euler 角（ラジアン）。
 */
export function quaternionToEulerYXZ(rotation, prevEuler = null) {
  const x = rotation[0];
  const y = rotation[1];
  const z = rotation[2];
  const w = rotation[3];

  // quaternionFromEulerYXZ() は I * Ry * Rx * Rz の順で回転を合成する。
  // その逆変換になるよう、同じ YXZ 順の回転行列から Euler を抽出する。
  const m00 = 1 - 2 * (y * y + z * z);
  const m02 = 2 * (x * z + y * w);
  const m10 = 2 * (x * y + z * w);
  const m11 = 1 - 2 * (x * x + z * z);
  const m12 = 2 * (y * z - x * w);
  const m22 = 1 - 2 * (x * x + y * y);

  const clampedM12 = Math.max(-1, Math.min(1, m12));
  const angleX = Math.asin(-clampedM12);
  const angleY = Math.atan2(m02, m22);
  const angleZ = Math.atan2(m10, m11);

  let out = [angleX, angleY, angleZ];

  if (prevEuler) {
    // 2つの解（ブランチ）のうち、前回値に近い方を選択する
    // 解1: (x, y, z)
    // 解2: (pi - x, y + pi, z + pi)
    const sol1 = [
      unwrapAngle(out[0], prevEuler[0]),
      unwrapAngle(out[1], prevEuler[1]),
      unwrapAngle(out[2], prevEuler[2]),
    ];

    const sol2 = [
      unwrapAngle(normalizeRadians(Math.PI - out[0]), prevEuler[0]),
      unwrapAngle(normalizeRadians(out[1] + Math.PI), prevEuler[1]),
      unwrapAngle(normalizeRadians(out[2] + Math.PI), prevEuler[2]),
    ];

    const dist1 = vec3.sqrDist(sol1, prevEuler);
    const dist2 = vec3.sqrDist(sol2, prevEuler);

    out = dist1 < dist2 ? sol1 : sol2;
  }

  return out;
}

/**
 * Euler 角から XYZ 順のクォータニオンを作成します。
 * @param {ArrayLike<number>} euler - X, Y, Z の Euler 角（ラジアン）。
 * @param {quat} [out=quat.create()] - 出力先。
 * @returns {quat} 回転クォータニオン。
 */
export function quaternionFromEulerXYZ(euler, out = quat.create()) {
  quat.identity(out);
  quat.rotateX(out, out, euler[0]);
  quat.rotateY(out, out, euler[1]);
  quat.rotateZ(out, out, euler[2]);
  quat.normalize(out, out);
  return out;
}

/**
 * YXZ 順の Euler 角からクォータニオンを作成します。
 * @param {ArrayLike<number>} euler - X, Y, Z の Euler 角（ラジアン）。
 * @param {quat} [out=quat.create()] - 出力先。
 * @returns {quat} 回転クォータニオン。
 */
export function quaternionFromEulerYXZ(euler, out = quat.create()) {
  quat.identity(out);
  quat.rotateY(out, out, euler[1]);
  quat.rotateX(out, out, euler[0]);
  quat.rotateZ(out, out, euler[2]);
  quat.normalize(out, out);
  return out;
}

/**
 * ボーン名に応じた Euler 回転順を返します。
 * 体幹、脚、足、頭は YXZ、それ以外は XYZ を使います。
 * @param {string} boneName - ボーン名。
 * @returns {'XYZ'|'YXZ'} Euler 回転順。
 */
export function getBoneEulerOrder(boneName) {
  if (typeof boneName !== 'string' || boneName.length === 0) {
    return 'XYZ';
  }

  const useYXZ = [
    '下半身',
    '上半身',
    '上半身2',
    '首',
    '頭',
    '左腰',
    '右腰',
    '左足',
    '右足',
    '左膝',
    '右膝',
    '左足首',
    '右足首',
    '左つま先',
    '右つま先',
  ].some((token) => boneName.includes(token));

  return useYXZ ? 'YXZ' : 'XYZ';
}

/**
 * ボーン名に応じた Euler 角からクォータニオンを作成します。
 * @param {ArrayLike<number>} euler - X, Y, Z の Euler 角（ラジアン）。
 * @param {string} boneName - ボーン名。
 * @param {quat} [out=quat.create()] - 出力先。
 * @returns {quat} 回転クォータニオン。
 */
export function quaternionFromEulerForBone(euler, boneName, out = quat.create()) {
  return getBoneEulerOrder(boneName) === 'YXZ'
    ? quaternionFromEulerYXZ(euler, out)
    : quaternionFromEulerXYZ(euler, out);
}

/**
 * ボーン名に応じたクォータニオンを Euler 角へ変換します。
 * @param {ArrayLike<number>} rotation - 回転クォータニオン。
 * @param {string} boneName - ボーン名。
 * @param {ArrayLike<number>|null} [prevEuler=null] - 前回の Euler。
 * @returns {number[]} X, Y, Z の Euler 角（ラジアン）。
 */
export function quaternionToEulerForBone(rotation, boneName, prevEuler = null) {
  return getBoneEulerOrder(boneName) === 'YXZ'
    ? quaternionToEulerYXZ(rotation, prevEuler)
    : quaternionToEulerXYZ(rotation, prevEuler);
}

function normalizeRadians(angle) {
  let normalized = angle;
  while (normalized > Math.PI) {
    normalized -= Math.PI * 2;
  }
  while (normalized < -Math.PI) {
    normalized += Math.PI * 2;
  }
  return normalized;
}

export function unwrapAngle(angle, reference) {
  const TWO_PI = Math.PI * 2;
  let d = angle - reference;
  d = ((d + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
  return reference + d;
}

/**
 * クォータニオンを正規化して返します。
 * @param {quat|Array<number>} quaternion - 対象クォータニオン。
 * @returns {quat} 正規化済みクォータニオン。
 */
export function normalizeQuaternion(quaternion) {
  const out = quat.fromValues(
    quaternion?.[0] || 0,
    quaternion?.[1] || 0,
    quaternion?.[2] || 0,
    quaternion?.[3] || 1
  );
  quat.normalize(out, out);
  return out;
}

/**
 * クォータニオンを乗算します。
 * @param {Array<number>|quat} a - 左辺。
 * @param {Array<number>|quat} b - 右辺。
 * @returns {quat} 乗算結果。
 */
export function multiplyQuaternions(a, b) {
  const out = quat.create();
  quat.multiply(out, normalizeQuaternion(a), normalizeQuaternion(b));
  quat.normalize(out, out);
  return out;
}

/**
 * クォータニオンの逆を返します。
 * @param {Array<number>|quat} quaternion - 対象クォータニオン。
 * @returns {quat} 逆クォータニオン。
 */
export function invertQuaternion(quaternion) {
  const out = quat.create();
  quat.invert(out, normalizeQuaternion(quaternion));
  quat.normalize(out, out);
  return out;
}

/**
 * 空の AABB を作成します。
 * @returns {{min: number[], max: number[]}} AABB。
 */
export function createAabb() {
  return {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
}

/**
 * AABB に点を含めます。
 * @param {{min: number[], max: number[]}} aabb - 更新対象 AABB。
 * @param {ArrayLike<number>} point - 含める点。
 */
export function expandAabbWithPoint(aabb, point) {
  if (point[0] < aabb.min[0]) aabb.min[0] = point[0];
  if (point[1] < aabb.min[1]) aabb.min[1] = point[1];
  if (point[2] < aabb.min[2]) aabb.min[2] = point[2];
  if (point[0] > aabb.max[0]) aabb.max[0] = point[0];
  if (point[1] > aabb.max[1]) aabb.max[1] = point[1];
  if (point[2] > aabb.max[2]) aabb.max[2] = point[2];
}

/**
 * 複数点から AABB を生成します。
 * @param {Array<ArrayLike<number>>} points - 点配列。
 * @returns {{min: number[], max: number[]}} AABB。
 */
export function computeAabbFromPoints(points) {
  const aabb = createAabb();
  for (const point of points) {
    expandAabbWithPoint(aabb, point);
  }
  return aabb;
}

/**
 * AABB の 8 頂点を返します。
 * @param {{min: number[], max: number[]}} aabb - AABB。
 * @returns {Array<number[]>} 8 頂点。
 */
export function getAabbCorners(aabb) {
  const { min, max } = aabb;
  return [
    [min[0], min[1], min[2]],
    [max[0], min[1], min[2]],
    [min[0], max[1], min[2]],
    [max[0], max[1], min[2]],
    [min[0], min[1], max[2]],
    [max[0], min[1], max[2]],
    [min[0], max[1], max[2]],
    [max[0], max[1], max[2]],
  ];
}

/**
 * AABB を別の AABB で拡張します。
 * @param {{min: number[], max: number[]}|null} target - 更新対象。
 * @param {{min: number[], max: number[]}|null} source - 拡張元。
 * @returns {{min: number[], max: number[]}|null} 更新後 AABB。
 */
export function unionAabb(target, source) {
  if (!source) {
    return target;
  }
  if (!target) {
    return {
      min: [...source.min],
      max: [...source.max],
    };
  }
  if (source.min[0] < target.min[0]) target.min[0] = source.min[0];
  if (source.min[1] < target.min[1]) target.min[1] = source.min[1];
  if (source.min[2] < target.min[2]) target.min[2] = source.min[2];
  if (source.max[0] > target.max[0]) target.max[0] = source.max[0];
  if (source.max[1] > target.max[1]) target.max[1] = source.max[1];
  if (source.max[2] > target.max[2]) target.max[2] = source.max[2];
  return target;
}

/**
 * AABB を指定量だけ広げます。
 * @param {{min: number[], max: number[]}} aabb - AABB。
 * @param {number} margin - 追加マージン。
 * @returns {{min: number[], max: number[]}} 拡張後 AABB。
 */
export function padAabb(aabb, margin) {
  return {
    min: [aabb.min[0] - margin, aabb.min[1] - margin, aabb.min[2] - margin],
    max: [aabb.max[0] + margin, aabb.max[1] + margin, aabb.max[2] + margin],
  };
}

/**
 * AABB の中心を返します。
 * @param {{min: number[], max: number[]}} aabb - AABB。
 * @returns {number[]} 中心。
 */
export function getAabbCenter(aabb) {
  return [
    (aabb.min[0] + aabb.max[0]) * 0.5,
    (aabb.min[1] + aabb.max[1]) * 0.5,
    (aabb.min[2] + aabb.max[2]) * 0.5,
  ];
}

/**
 * AABB のサイズを返します。
 * @param {{min: number[], max: number[]}} aabb - AABB。
 * @returns {number[]} サイズ。
 */
export function getAabbSize(aabb) {
  return [
    aabb.max[0] - aabb.min[0],
    aabb.max[1] - aabb.min[1],
    aabb.max[2] - aabb.min[2],
  ];
}

/**
 * 値を範囲へ収めます。
 * @param {number} value - 対象値。
 * @param {number} min - 下限。
 * @param {number} max - 上限。
 * @returns {number} 範囲内の値。
 */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * 2点間の線分を厚みを持たせるための 6 頂点（2枚の三角形）として頂点配列に追加します。
 * 頂点構造: [pos(3), color(3), other(3), side(1)]
 * @param {Array<number>} vertices - 頂点配列。
 * @param {Array<number>} start - 開始点 [x, y, z]。
 * @param {Array<number>} end - 終了点 [x, y, z]。
 * @param {Array<number>} color - 色 [r, g, b]。
 */
export function pushLineQuads(vertices, start, end, color) {
  // 1つの線分につき 6 頂点追加する
  // 三角形1
  vertices.push(...start, ...color, ...end, -1.0);
  vertices.push(...start, ...color, ...end,  1.0);
  vertices.push(...end,   ...color, ...start,  1.0);
  // 三角形2
  vertices.push(...end,   ...color, ...start,  1.0);
  vertices.push(...start, ...color, ...end,  1.0);
  vertices.push(...end,   ...color, ...start, -1.0);
}
