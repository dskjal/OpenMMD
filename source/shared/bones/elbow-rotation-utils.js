import { quaternionFromEulerXYZ, quaternionToEulerXYZ } from '../math/math-utils.js';

/**
 * 肘ボーンの優先回転方向を返します。
 * Alicia 系のように localZ が負なら正方向、Miku 系のように localZ が正なら負方向を優先します。
 * @param {object} local - ボーンのローカル変換状態。
 * @param {object} [bone] - ボーン定義。
 * @returns {number} `1` または `-1`。
 */
export function getElbowPreferredDirectionSign(local, bone = null) {
  const localZ = Array.isArray(local?.localZ)
    ? local.localZ
    : Array.isArray(bone?.localZ)
      ? bone.localZ
      : null;
  return Array.isArray(localZ) && localZ[2] < 0 ? 1 : -1;
}

/**
 * 肘の Euler 候補から、基底に合う方向で最小回転の Y 角を選択します。
 * @param {Array<number>|ArrayLike<number>} rotation - 対象クォータニオン。
 * @param {object} local - ボーンのローカル変換状態。
 * @param {Array<number>|null} [prevEuler=null] - 前回 Euler 値。
 * @param {object} [bone=null] - ボーン定義。
 * @returns {number} 選択された Y 角（ラジアン）。
 */
export function selectPreferredElbowEulerY(rotation, local, prevEuler = null, bone = null) {
  const preferredSign = getElbowPreferredDirectionSign(local, bone);
  const candidates = [];

  if (prevEuler) {
    candidates.push(quaternionToEulerXYZ(rotation, prevEuler));
  }
  candidates.push(quaternionToEulerXYZ(rotation, [0, 0, 0]));
  candidates.push(quaternionToEulerXYZ(rotation, [Math.PI, 0, Math.PI]));
  candidates.push(quaternionToEulerXYZ(rotation, [-Math.PI, 0, -Math.PI]));

  let bestY = null;
  for (const candidate of candidates) {
    const candidateY = Math.abs(candidate[1]);
    if (bestY === null || candidateY < Math.abs(bestY)) {
      bestY = candidate[1];
    }
  }

  if (bestY === null) {
    bestY = candidates.reduce((best, current) => (Math.abs(current[1]) < Math.abs(best[1]) ? current : best), candidates[0])[1];
  }

  return preferredSign * Math.abs(bestY);
}

/**
 * 肘回転を pure Y のクォータニオンへ投影します。
 * @param {Array<number>|ArrayLike<number>} rotation - 対象クォータニオン。
 * @param {object} local - ボーンのローカル変換状態。
 * @param {object} [bone=null] - ボーン定義。
 * @returns {Array<number>} pure Y のクォータニオン。
 */
export function projectElbowRotationToPreferredAxis(rotation, local, bone = null) {
  return quaternionFromEulerXYZ([0, selectPreferredElbowEulerY(rotation, local, null, bone), 0]);
}
