import { mat4, vec3, quat } from '../../lib/esm/index.js';
import { applyChildWorldOffsetToMatrix, getChildWorldOffset } from '../../shared/bones/bone-transform-utils.js';
import { resolvePreferredTailBoneIndex } from '../../shared/bones/vrm-child-bone-utils.js';

/**
 * Ammo.js (Bullet Physicsのポート) を使用した物理演算エンジン。
 */
export const AMMO_LENGTH_SCALE = 10;
export const AMMO_INV_LENGTH_SCALE = 1 / AMMO_LENGTH_SCALE;
const GRAVITY_ACCELERATION_AMMO = -9.8 * AMMO_LENGTH_SCALE;
const SPLIT_IMPULSE_PENETRATION_THRESHOLD_AMMO = -0.01 * AMMO_LENGTH_SCALE;
const CONTACT_PROCESSING_THRESHOLD_AMMO = 0.05 * AMMO_LENGTH_SCALE;
const MIN_SEPARATION_AMMO = 1e-4 * AMMO_LENGTH_SCALE;

export class PhysicsEngine {
  /**
   * 実際の FPS は target FPS * simulation Multiplier
   * @param {int} targetFPS シミュレーションのベース FPS。FPS を下げると重力が強くなるような効果。FPS を上げると物理動作がゆっくりになる
   * @param {int} simulationMultiplier シミュレーションのベース FPS の乗算係数
   */
  constructor(targetFPS=60, simulationMultiplier=4, maxSubSteps=20) {
    this.targetSPF = 1.0 / targetFPS;
    this.simulationMultiplier = simulationMultiplier;
    this.maxSubSteps = maxSubSteps;
    this.enabled = true;
    this.Ammo = null;
    this.world = null;
    this.models = []; // { model, scene, bodies: [], joints: [], boneToBodiesMap: {}, boneToPostSimulationBodyMap: {} }
    this.pointerToBodyMap = new Map(); // Ammo pointer -> body object
    this.onCollision = null // デバッグ用。衝突した剛体や impulse を取得できる。function(body0, body1, impulse, contactPoint)
    
    // Scratch objects for performance (to avoid GC pressure and memory leaks)
    // ... rest of constructor ...
    this._tempMatA = mat4.identity(mat4.create());
    this._tempMatB = mat4.identity(mat4.create());
    this._tempMatC = mat4.identity(mat4.create());
    this._tempVec3 = vec3.create();
    this._tempQuat = quat.create();
    
    this._tempBTTr = null;
    this._tempBTTr2 = null;
    this._tempBTVec = null;
    this._tempBTVec2 = null;
    this._tempBTQuat = null;
    this.modelManager = null;
  }

  /**
   * 物理演算の有効 / 無効を切り替えます。
   * @param {boolean} enabled - 有効なら true。
   */
  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
  }

  /**
   * 物理演算が有効かどうかを返します。
   * @returns {boolean} 有効なら true。
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * dirty フラグ更新に使う ModelManager を設定します。
   * @param {object|null} modelManager - ModelManager インスタンス。
   */
  setModelManager(modelManager) {
    this.modelManager = modelManager;
  }

  /**
   * Child 影響込みで worldMatrix と worldPosition を確定します。
   * @param {object} scene - シーン状態。
   * @param {number} boneIndex - ボーン index。
   * @param {object} local - ローカル変換状態。
   */
  _finalizeBoneWorldTransform(scene, boneIndex, local) {
    mat4.getTranslation(this._tempVec3, local.worldMatrix);
    mat4.getRotation(local.worldRotation, local.worldMatrix);
    if (local.childEnabled) {
      const childPosition = vec3.clone(this._tempVec3);
      const childRotation = quat.clone(local.worldRotation);
      if (getChildWorldOffset(scene, local, childPosition, childRotation)) {
        applyChildWorldOffsetToMatrix(local.worldMatrix, childPosition, childRotation, local.worldMatrix);
        mat4.getTranslation(this._tempVec3, local.worldMatrix);
        mat4.getRotation(local.worldRotation, local.worldMatrix);
      }
    }

    mat4.fromRotationTranslationScale(local.worldMatrix, local.worldRotation, this._tempVec3, local.scale);
    scene.boneWorldPositions[boneIndex][0] = local.worldMatrix[12];
    scene.boneWorldPositions[boneIndex][1] = local.worldMatrix[13];
    scene.boneWorldPositions[boneIndex][2] = local.worldMatrix[14];
  }

  /**
   * vec3 を Ammo の長さ単位へ拡大します。
   * @private
   * @param {ArrayLike<number>} source 元ベクトル
   * @param {vec3} out 出力先
   * @returns {vec3} out
   */
  _scaleVec3ToAmmo(source, out) {
    out[0] = source[0] * AMMO_LENGTH_SCALE;
    out[1] = source[1] * AMMO_LENGTH_SCALE;
    out[2] = source[2] * AMMO_LENGTH_SCALE;
    return out;
  }

  /**
   * vec3 を OpenMMD の長さ単位へ縮小します。
   * @private
   * @param {ArrayLike<number>} source 元ベクトル
   * @param {vec3} out 出力先
   * @returns {vec3} out
   */
  _scaleVec3FromAmmo(source, out) {
    out[0] = source[0] * AMMO_INV_LENGTH_SCALE;
    out[1] = source[1] * AMMO_INV_LENGTH_SCALE;
    out[2] = source[2] * AMMO_INV_LENGTH_SCALE;
    return out;
  }

  /**
   * mat4 の平行移動成分だけを Ammo 用に拡大します。
   * @private
   * @param {mat4} source 元行列
   * @param {mat4} out 出力先
   * @returns {mat4} out
   */
  _scaleMat4TranslationToAmmo(source, out) {
    mat4.copy(out, source);
    out[12] *= AMMO_LENGTH_SCALE;
    out[13] *= AMMO_LENGTH_SCALE;
    out[14] *= AMMO_LENGTH_SCALE;
    return out;
  }

  /**
   * mat4 の平行移動成分だけを OpenMMD 用に縮小します。
   * @private
   * @param {mat4} source 元行列
   * @param {mat4} out 出力先
   * @returns {mat4} out
   */
  _scaleMat4TranslationFromAmmo(source, out) {
    mat4.copy(out, source);
    out[12] *= AMMO_INV_LENGTH_SCALE;
    out[13] *= AMMO_INV_LENGTH_SCALE;
    out[14] *= AMMO_INV_LENGTH_SCALE;
    return out;
  }

  /**
   * OpenMMD 空間の mat4 を Ammo の Transform へ書き込みます。
   * @private
   * @param {Object} tr Bullet の transform
   * @param {mat4} m OpenMMD 空間の mat4
   */
  _setBTTransformFromMat4Scaled(tr, m) {
    mat4.getRotation(this._tempQuat, m);
    mat4.getTranslation(this._tempVec3, m);
    this._tempBTVec.setValue(
      this._tempVec3[0] * AMMO_LENGTH_SCALE,
      this._tempVec3[1] * AMMO_LENGTH_SCALE,
      this._tempVec3[2] * AMMO_LENGTH_SCALE
    );
    this._tempBTQuat.setValue(this._tempQuat[0], this._tempQuat[1], this._tempQuat[2], this._tempQuat[3]);
    tr.setOrigin(this._tempBTVec);
    tr.setRotation(this._tempBTQuat);
  }

  /**
   * Ammo の Transform を OpenMMD 空間の mat4 へ読み込みます。
   * @private
   * @param {Object} tr Bullet の transform
   * @param {mat4} out 出力先
   */
  _getMat4FromBTTransformScaled(tr, out) {
    const q = tr.getRotation();
    const p = tr.getOrigin();
    this._tempQuat[0] = q.x();
    this._tempQuat[1] = q.y();
    this._tempQuat[2] = q.z();
    this._tempQuat[3] = q.w();
    quat.normalize(this._tempQuat, this._tempQuat);
    mat4.fromRotationTranslation(out, this._tempQuat, [
      p.x() * AMMO_INV_LENGTH_SCALE,
      p.y() * AMMO_INV_LENGTH_SCALE,
      p.z() * AMMO_INV_LENGTH_SCALE
    ]);
  }

  /**
   * Bullet の Transform をそのまま mat4 へ読み込みます。
   * @private
   * @param {Object} tr Bullet の transform
   * @param {mat4} out 出力先
   */
  _getMat4FromBTTransform(tr, out) {
    const q = tr.getRotation();
    const p = tr.getOrigin();
    this._tempQuat[0] = q.x();
    this._tempQuat[1] = q.y();
    this._tempQuat[2] = q.z();
    this._tempQuat[3] = q.w();
    quat.normalize(this._tempQuat, this._tempQuat);
    mat4.fromRotationTranslation(out, this._tempQuat, [p.x(), p.y(), p.z()]);
  }

  /**
   * mat4 を Bullet の Transform へそのまま書き込みます。
   * @private
   * @param {Object} tr Bullet の transform
   * @param {mat4} m mat4
   */
  _setBTTransformFromMat4(tr, m) {
    mat4.getRotation(this._tempQuat, m);
    mat4.getTranslation(this._tempVec3, m);
    this._tempBTVec.setValue(this._tempVec3[0], this._tempVec3[1], this._tempVec3[2]);
    this._tempBTQuat.setValue(this._tempQuat[0], this._tempQuat[1], this._tempQuat[2], this._tempQuat[3]);
    tr.setOrigin(this._tempBTVec);
    tr.setRotation(this._tempBTQuat);
  }

  /**
   * 物理演算エンジンを初期化します。
   */
  async init() {
    const ammoInstance = typeof window !== 'undefined' ? window.Ammo : typeof global !== 'undefined' ? global.Ammo : undefined;

    if (!ammoInstance) {
      throw new Error('Ammo.js not found. Make sure it is loaded before initializing PhysicsEngine.');
    }

    this.Ammo = typeof ammoInstance === 'function' ? await ammoInstance() : ammoInstance;

    const {
      btDefaultCollisionConfiguration,
      btCollisionDispatcher,
      btDbvtBroadphase,
      btSequentialImpulseConstraintSolver,
      btDiscreteDynamicsWorld,
      btVector3,
      btTransform,
      btQuaternion
    } = this.Ammo;

    const config = new btDefaultCollisionConfiguration();
    const dispatcher = new btCollisionDispatcher(config);
    const cache = new btDbvtBroadphase();
    const solver = new btSequentialImpulseConstraintSolver();
    this.world = new btDiscreteDynamicsWorld(dispatcher, cache, solver, config);
    
    // Ammo 側だけ 10 倍スケールで回す。
    this.world.setGravity(new btVector3(0, GRAVITY_ACCELERATION_AMMO, 0));

    const info = this.world.getSolverInfo();
    info.set_m_splitImpulse(true);
    info.set_m_splitImpulsePenetrationThreshold(SPLIT_IMPULSE_PENETRATION_THRESHOLD_AMMO);

    this._tempBTTr = new btTransform();
    this._tempBTTr2 = new btTransform();
    this._tempBTVec = new btVector3(0, 0, 0);
    this._tempBTVec2 = new btVector3(0, 0, 0);
    this._tempBTQuat = new btQuaternion(0, 0, 0, 1);
  }

  /**
   * レイキャストを行い、最初に衝突した剛体を返します。
   * @param {Array<number>} rayFrom レイの開始地点 [x, y, z]
   * @param {Array<number>} rayTo レイの終了地点 [x, y, z]
   * @returns {Object|null} 衝突した剛体情報 { entry, bodyIndex, body }
   */
  rayTest(rayFrom, rayTo) {
    if (!this.world) return null;

    this._tempBTVec.setValue(
      rayFrom[0] * AMMO_LENGTH_SCALE,
      rayFrom[1] * AMMO_LENGTH_SCALE,
      rayFrom[2] * AMMO_LENGTH_SCALE
    );
    this._tempBTVec2.setValue(
      rayTo[0] * AMMO_LENGTH_SCALE,
      rayTo[1] * AMMO_LENGTH_SCALE,
      rayTo[2] * AMMO_LENGTH_SCALE
    );

    const rayCallback = new this.Ammo.ClosestRayResultCallback(this._tempBTVec, this._tempBTVec2);
    // Ensure the ray hits everything by setting mask to AllFilter (-1)
    // and group to a value that will pass common filters.
    if (rayCallback.set_m_collisionFilterMask) {
      rayCallback.set_m_collisionFilterMask(-1);
    }
    if (rayCallback.set_m_collisionFilterGroup) {
      rayCallback.set_m_collisionFilterGroup(-1);
    }

    this.world.rayTest(this._tempBTVec, this._tempBTVec2, rayCallback);

    let result = null;
    if (rayCallback.hasHit()) {
      const hitObj = rayCallback.get_m_collisionObject();
      if (hitObj) {
        const hitPtr = this.Ammo.getPointer(hitObj);
        for (const entry of this.models) {
          const bodyIndex = entry.bodies.findIndex(b => this.Ammo.getPointer(b.ammoBody) === hitPtr);
          if (bodyIndex !== -1) {
            result = { entry, bodyIndex, body: entry.bodies[bodyIndex] };
            break;
          }
        }
      }
    }

    this.Ammo.destroy(rayCallback);
    return result;
  }

  /**
   * 物理演算対象のモデルを追加します。
   * @param {Object} model モデルデータ
   * @param {Object} scene シーンデータ
   */
  addModel(model, scene) {
    const bodies = [];
    const joints = [];
    const boneToBodiesMap = {};
    const boneToPostSimulationBodyMap = {};

    for (let i = 0; i < model.rigidBodies.length; i++) {
      const rbData = model.rigidBodies[i];
      const body = this._createRigidBody(rbData, model, scene);
      bodies.push(body);
      this.world.addRigidBody(body.ammoBody, 1 << rbData.groupId, rbData.collisionMask);
      
      this.pointerToBodyMap.set(this.Ammo.getPointer(body.ammoBody), body);
      
      if (rbData.boneIndex !== -1) {
        if (!boneToBodiesMap[rbData.boneIndex]) {
          boneToBodiesMap[rbData.boneIndex] = [];
        }
        boneToBodiesMap[rbData.boneIndex].push(body);
        if (rbData.physicsMode !== 0) {
          boneToPostSimulationBodyMap[rbData.boneIndex] = body;
        }
      }
    }

    for (let i = 0; i < model.joints.length; i++) {
      const jointData = model.joints[i];
      const bodyA = bodies[jointData.rigidBodyIndexA];
      const bodyB = bodies[jointData.rigidBodyIndexB];
      if (!bodyA || !bodyB) continue;

      const joint = this._createJoint(jointData, bodyA, bodyB);
      joints.push(joint);
      this.world.addConstraint(joint.ammoConstraint, true);
    }

    this.models.push({ model, scene, bodies, joints, boneToBodiesMap, boneToPostSimulationBodyMap });
    this.resetModel(this.models[this.models.length - 1]);
  }

  /**
   * Bullet の剛体へ現在の transform を書き戻します。
   * @private
   * @param {Object} body 剛体オブジェクト
   * @param {Object} transform Bullet の transform
   */
  _writeBodyTransform(body, transform) {
    body.ammoBody.setCenterOfMassTransform(transform);
    const motionState = body.ammoBody.getMotionState();
    if (motionState) {
      motionState.setWorldTransform(transform);
      if (typeof motionState.setInterpolationWorldTransform === 'function') {
        motionState.setInterpolationWorldTransform(transform);
      }
    }
    if (typeof body.ammoBody.setInterpolationWorldTransform === 'function') {
      body.ammoBody.setInterpolationWorldTransform(transform);
    }

    this._tempBTVec2.setValue(0, 0, 0);
    body.ammoBody.setLinearVelocity(this._tempBTVec2);
    body.ammoBody.setAngularVelocity(this._tempBTVec2);
    if (typeof body.ammoBody.setInterpolationLinearVelocity === 'function') {
      body.ammoBody.setInterpolationLinearVelocity(this._tempBTVec2);
    }
    if (typeof body.ammoBody.setInterpolationAngularVelocity === 'function') {
      body.ammoBody.setInterpolationAngularVelocity(this._tempBTVec2);
    }
    if (typeof body.ammoBody.clearForces === 'function') {
      body.ammoBody.clearForces();
    }
    if (typeof this.world.updateSingleAabb === 'function') {
      this.world.updateSingleAabb(body.ammoBody);
    }
    body.ammoBody.activate();
  }

  /**
   * Bullet の剛体 transform を読み込みます。
   * @private
   * @param {Object} body 剛体オブジェクト
   * @param {Object} out 出力先 transform
   * @returns {boolean} 読み込みに成功した場合は true
   */
  _readBodyTransform(body, out) {
    const motionState = body.ammoBody.getMotionState();
    if (motionState && typeof motionState.getWorldTransform === 'function') {
      motionState.getWorldTransform(out);
      return true;
    }

    if (typeof body.ammoBody.getWorldTransform === 'function') {
      body.ammoBody.getWorldTransform(out);
      return true;
    }

    return false;
  }

  /**
   * 特定のモデルの物理演算状態をリセットし、現在のボーン位置に同期させます。
   * この関数は「再同期」専用で、貫通解消や衝突からの押し戻しは行いません。
   * @param {Object} entry モデルエントリ
   */
  resetModel(entry) {
    if (!this.world) return;
    const { scene, bodies } = entry;
    this._tempBTVec.setValue(0, 0, 0);
    this._tempBTQuat.setValue(0, 0, 0, 1);

    for (const body of bodies) {
      const boneIndex = body.boneIndex;
      if (boneIndex === -1) {
        // ボーンに関連付けられていない場合は初期値に戻す
        const { rbData } = body;
        const q = this._setQuatFromMmdEulerRadians(this._tempQuat, rbData.rotation);
        this._tempBTVec.setValue(
          rbData.position[0] * AMMO_LENGTH_SCALE,
          rbData.position[1] * AMMO_LENGTH_SCALE,
          rbData.position[2] * AMMO_LENGTH_SCALE
        );
        this._tempBTQuat.setValue(q[0], q[1], q[2], q[3]);
        this._tempBTTr.setOrigin(this._tempBTVec);
        this._tempBTTr.setRotation(this._tempBTQuat);
      } else {
        // ボーンの現在のワールド行列に同期
        const worldMatrix = scene.boneLocalTransforms[boneIndex].worldMatrix;
        const rbWorldMatrix = mat4.multiply(this._tempMatA, worldMatrix, body.boneOffsetMat);
        const setBTTransformFromMat4Scaled = this._setBTTransformFromMat4Scaled || this._setBTTransformFromMat4;
        setBTTransformFromMat4Scaled.call(this, this._tempBTTr, rbWorldMatrix);
      }

      this._writeBodyTransform(body, this._tempBTTr);
    }
  }

  /**
   * 特定のモデルの物理演算状態を再構築します。
   * resetModel() で現在ポーズへ同期したあと、Bullet の衝突解決で押し戻しを行い、
   * 結果を再度ボーン側へ反映します。
   * @param {Object} entry モデルエントリ
   */
  rebuildModel(entry) {
    if (!this.world) return;

    this.resetModel(entry);
    this._resolveEntryPenetrations(entry);
    this._postSimulation(entry);
  }

  /**
   * entry に属する剛体の貫通を解消します。
   * Bullet の contact manifold を参照し、entry 側の剛体だけを外向きに押し戻します。
   * @private
   * @param {Object} entry モデルエントリ
   * @param {number} [maxIterations=4] 解消の繰り返し回数
   * @returns {boolean} 少なくとも 1 回は押し戻した場合は true
   */
  _resolveEntryPenetrations(entry, maxIterations = 4) {
    if (!this.world || !entry?.bodies?.length) {
      return false;
    }

    const entryBodies = new Set(entry.bodies);
    let resolved = false;
    const minSeparation = MIN_SEPARATION_AMMO;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      if (typeof this.world.performDiscreteCollisionDetection === 'function') {
        this.world.performDiscreteCollisionDetection();
      }

      const corrections = new Map();
      const dispatcher = this.world.getDispatcher?.();
      const numManifolds = dispatcher?.getNumManifolds?.() ?? 0;
      let hasPenetration = false;

      for (let i = 0; i < numManifolds; i++) {
        const manifold = dispatcher.getManifoldByIndexInternal(i);
        const body0 = this.pointerToBodyMap.get(this.Ammo.getPointer(manifold.getBody0()));
        const body1 = this.pointerToBodyMap.get(this.Ammo.getPointer(manifold.getBody1()));
        const body0InEntry = entryBodies.has(body0);
        const body1InEntry = entryBodies.has(body1);

        if (!body0InEntry && !body1InEntry) {
          continue;
        }

        const numContacts = manifold.getNumContacts();
        for (let j = 0; j < numContacts; j++) {
          const contactPoint = manifold.getContactPoint(j);
          const distance = contactPoint.getDistance?.();
          if (!Number.isFinite(distance) || distance >= -minSeparation) {
            continue;
          }

          const normal = this._readContactNormal(contactPoint);
          if (!normal) {
            continue;
          }

          const penetration = Math.max(-distance + minSeparation, 0);
          if (penetration <= 0) {
            continue;
          }

          hasPenetration = true;
          const invMass0 = body0InEntry ? this._getBodyInverseMass(body0) : 0;
          const invMass1 = body1InEntry ? this._getBodyInverseMass(body1) : 0;
          const totalInvMass = invMass0 + invMass1;

          if (body0InEntry && !body1InEntry) {
            this._addPenetrationCorrection(corrections, body0, normal, penetration);
          } else if (!body0InEntry && body1InEntry) {
            this._addPenetrationCorrection(corrections, body1, [-normal[0], -normal[1], -normal[2]], penetration);
          } else if (totalInvMass > 0) {
            const scale0 = invMass0 / totalInvMass;
            const scale1 = invMass1 / totalInvMass;
            this._addPenetrationCorrection(corrections, body0, normal, penetration * scale0);
            this._addPenetrationCorrection(corrections, body1, [-normal[0], -normal[1], -normal[2]], penetration * scale1);
          } else {
            this._addPenetrationCorrection(corrections, body0, normal, penetration * 0.5);
            this._addPenetrationCorrection(corrections, body1, [-normal[0], -normal[1], -normal[2]], penetration * 0.5);
          }
        }
      }

      if (!hasPenetration || corrections.size === 0) {
        break;
      }

      for (const [body, correction] of corrections) {
        this._applyPenetrationCorrection(body, correction);
      }
      resolved = true;
    }

    return resolved;
  }

  /**
   * 貫通解消の押し戻し量を加算します。
   * @private
   * @param {Map<Object, vec3>} corrections 押し戻し量の累積先
   * @param {Object} body 剛体オブジェクト
   * @param {ArrayLike<number>} direction 押し戻し方向
   * @param {number} magnitude 押し戻し量
   */
  _addPenetrationCorrection(corrections, body, direction, magnitude) {
    if (!body || magnitude <= 0) {
      return;
    }

    let correction = corrections.get(body);
    if (!correction) {
      correction = vec3.create();
      corrections.set(body, correction);
    }

    correction[0] += direction[0] * magnitude;
    correction[1] += direction[1] * magnitude;
    correction[2] += direction[2] * magnitude;
  }

  /**
   * 貫通解消後の剛体 transform を書き戻します。
   * @private
   * @param {Object} body 剛体オブジェクト
   * @param {ArrayLike<number>} correction 押し戻し量
   */
  _applyPenetrationCorrection(body, correction) {
    if (!this._readBodyTransform(body, this._tempBTTr)) {
      return;
    }

    const origin = this._tempBTTr.getOrigin();
    this._tempBTVec.setValue(
      origin.x() + correction[0],
      origin.y() + correction[1],
      origin.z() + correction[2]
    );
    this._tempBTTr.setOrigin(this._tempBTVec);
    this._writeBodyTransform(body, this._tempBTTr);
  }

  /**
   * 貫通解消に使う剛体の逆質量を返します。
   * @private
   * @param {Object} body 剛体オブジェクト
   * @returns {number} 逆質量。静的 / きinematic は 0。
   */
  _getBodyInverseMass(body) {
    if (!body?.ammoBody) {
      return 0;
    }

    if (body.rbData?.physicsMode === 0) {
      return 0;
    }

    if (typeof body.ammoBody.getInvMass === 'function') {
      const invMass = body.ammoBody.getInvMass();
      if (Number.isFinite(invMass)) {
        return Math.max(invMass, 0);
      }
    }

    const mass = Number(body.rbData?.mass ?? 0);
    return mass > 0 ? 1 / mass : 0;
  }

  /**
   * contact point のワールド法線を返します。
   * @private
   * @param {Object} contactPoint contact point
   * @returns {vec3|null} 正規化済み法線
   */
  _readContactNormal(contactPoint) {
    if (!contactPoint) {
      return null;
    }

    if (typeof contactPoint.get_m_normalWorldOnB === 'function') {
      const normal = contactPoint.get_m_normalWorldOnB();
      if (normal) {
        return vec3.fromValues(normal.x(), normal.y(), normal.z());
      }
    }

    if (typeof contactPoint.get_m_normalWorldOnA === 'function') {
      const normal = contactPoint.get_m_normalWorldOnA();
      if (normal) {
        return vec3.fromValues(-normal.x(), -normal.y(), -normal.z());
      }
    }

    return null;
  }

  /**
   * 物理演算対象のモデルを削除します。
   * @param {Object} model モデルデータ
   * @param {Object} scene シーンデータ
   */
  removeModel(model, scene) {
    const index = this.models.findIndex(m => m.model === model && m.scene === scene);
    if (index === -1) return;

    const entry = this.models[index];
    
    // Remove and destroy constraints
    for (const joint of entry.joints) {
      this.world.removeConstraint(joint.ammoConstraint);
      this.Ammo.destroy(joint.ammoConstraint);
    }

    // Remove and destroy bodies
    for (const body of entry.bodies) {
      this.pointerToBodyMap.delete(this.Ammo.getPointer(body.ammoBody));
      this.world.removeRigidBody(body.ammoBody);
      const motionState = body.ammoBody.getMotionState();
      const shape = body.ammoBody.getCollisionShape();
      this.Ammo.destroy(body.ammoBody);
      if (motionState) this.Ammo.destroy(motionState);
      if (shape) this.Ammo.destroy(shape);
    }

    this.models.splice(index, 1);
  }

  /**
   * 剛体を生成します。
   * @private
   * @param {Object} rbData 剛体データ
   * @param {Object} model モデルデータ
   * @param {Object} scene シーンデータ
   * @returns {Object} 剛体オブジェクト
   */
  _createRigidBody(rbData, model, scene) {
    const { Ammo } = this;
    const {
      btSphereShape, btBoxShape, btCapsuleShape, btCapsuleShapeX, btCapsuleShapeZ,
      btVector3, btTransform, btQuaternion,
      btRigidBodyConstructionInfo, btRigidBody, btDefaultMotionState
    } = Ammo;

    let shape;
    let capsuleAxis = 'y';
    const size = rbData.size;
    const scaledSize = [
      size[0] * AMMO_LENGTH_SCALE,
      size[1] * AMMO_LENGTH_SCALE,
      size[2] * AMMO_LENGTH_SCALE
    ];
    switch (rbData.shape) {
      case 0: shape = new btSphereShape(scaledSize[0]); break;
      case 1: shape = new btBoxShape(new btVector3(scaledSize[0], scaledSize[1], scaledSize[2])); break;
      case 2: shape = new btCapsuleShape(scaledSize[0], scaledSize[1]); break;
      default: shape = new btSphereShape(AMMO_LENGTH_SCALE);
    }

    const q = this._setQuatFromMmdEulerRadians(this._tempQuat, rbData.rotation);
    this._tempBTQuat.setValue(q[0], q[1], q[2], q[3]);

    const bone = model.bones[rbData.boneIndex];
    const bonePos = bone ? bone.position : [0, 0, 0];
    const rbWorldMatrixBind = mat4.fromRotationTranslation(mat4.create(), q, rbData.position);
    const boneWorldMatrixBind = mat4.fromTranslation(mat4.create(), bonePos);
    const invBoneWorldMatrixBind = mat4.invert(mat4.create(), boneWorldMatrixBind);
    const boneOffsetMat = mat4.multiply(mat4.create(), invBoneWorldMatrixBind, rbWorldMatrixBind);
    const invBoneOffsetMat = mat4.invert(mat4.create(), boneOffsetMat);

    const transform = new btTransform();
    transform.setIdentity();

    // Use current bone world matrix to determine initial position if available
    if (rbData.boneIndex !== -1 && scene.boneLocalTransforms[rbData.boneIndex]) {
      const worldMatrix = scene.boneLocalTransforms[rbData.boneIndex].worldMatrix;
      const initialRbWorldMatrix = mat4.multiply(this._tempMatA, worldMatrix, boneOffsetMat);
      const setBTTransformFromMat4Scaled = this._setBTTransformFromMat4Scaled || this._setBTTransformFromMat4;
      setBTTransformFromMat4Scaled.call(this, transform, initialRbWorldMatrix);
    } else {
      this._tempBTVec.setValue(
        rbData.position[0] * AMMO_LENGTH_SCALE,
        rbData.position[1] * AMMO_LENGTH_SCALE,
        rbData.position[2] * AMMO_LENGTH_SCALE
      );
      transform.setOrigin(this._tempBTVec);
      transform.setRotation(this._tempBTQuat);
    }

    const mass = rbData.physicsMode === 0 ? 0 : rbData.mass;
    const localInertia = new btVector3(0, 0, 0);
    if (mass > 0) shape.calculateLocalInertia(mass, localInertia);

    // const boneName = bone ? bone.name : "Unknown";
    // console.log(`bone: ${boneName}, mass: ${mass}`);

    const motionState = new btDefaultMotionState(transform);
    const rbInfo = new btRigidBodyConstructionInfo(mass, motionState, shape, localInertia);
    rbInfo.set_m_friction(rbData.friction);
    rbInfo.set_m_restitution(rbData.repulsion);

    const ammoBody = new btRigidBody(rbInfo);
    if (rbData.physicsMode === 0) {
      ammoBody.setCollisionFlags(ammoBody.getCollisionFlags() | 2); // CF_KINEMATIC_OBJECT
      ammoBody.setActivationState(4); // DISABLE_DEACTIVATION
    }
    ammoBody.setDamping(rbData.moveAttenuation, rbData.rotationDamping);
    // 接触の感度を下げる
    ammoBody.setContactProcessingThreshold(CONTACT_PROCESSING_THRESHOLD_AMMO);
    ammoBody.setSleepingThresholds(0, 0);

    return {
      ammoBody,
      rbData,
      boneOffsetMat,
      invBoneOffsetMat,
      boneIndex: rbData.boneIndex,
      capsuleAxis,
    };
  }

  /**
   * 剛体に対応する参照方向を返します。ボーン tail を優先し、なければ親子関係から推定します。
   * @private
   * @param {Object} model モデルデータ
   * @param {Object} rbData 剛体データ
   * @returns {vec3|null} 正規化済み方向ベクトル
   */
  _getRigidBodyReferenceDirection(model, rbData) {
    if (!model || !Array.isArray(model.bones)) {
      return null;
    }
    const boneIndex = rbData?.boneIndex ?? -1;
    if (boneIndex < 0 || boneIndex >= model.bones.length) {
      return null;
    }
    return this._getBoneReferenceDirection(model, boneIndex);
  }

  /**
   * ボーンの tail / 子 / 親 から参照方向を推定します。
   * @private
   * @param {Object} model モデルデータ
   * @param {number} boneIndex ボーン index
   * @returns {vec3|null} 正規化済み方向ベクトル
   */
  _getBoneReferenceDirection(model, boneIndex) {
    const bone = model.bones[boneIndex];
    if (!bone) {
      return null;
    }

    const tailBoneIndex = resolvePreferredTailBoneIndex(model, boneIndex, model.bones.length);
    if (tailBoneIndex >= 0) {
      const tail = model.bones[tailBoneIndex];
      if (tail) {
        this._tempVec3[0] = tail.position[0] - bone.position[0];
        this._tempVec3[1] = tail.position[1] - bone.position[1];
        this._tempVec3[2] = tail.position[2] - bone.position[2];
        if (vec3.length(this._tempVec3) > 1e-5) {
          return vec3.normalize(vec3.create(), this._tempVec3);
        }
      }
    }

    if (Array.isArray(bone.tailOffset)) {
      this._tempVec3[0] = bone.tailOffset[0];
      this._tempVec3[1] = bone.tailOffset[1];
      this._tempVec3[2] = bone.tailOffset[2];
      if (vec3.length(this._tempVec3) > 1e-5) {
        return vec3.normalize(vec3.create(), this._tempVec3);
      }
    }

    const childIndex = model.bones.findIndex((candidate) => candidate?.parentIndex === boneIndex);
    if (childIndex !== -1) {
      const child = model.bones[childIndex];
      this._tempVec3[0] = child.position[0] - bone.position[0];
      this._tempVec3[1] = child.position[1] - bone.position[1];
      this._tempVec3[2] = child.position[2] - bone.position[2];
      if (vec3.length(this._tempVec3) > 1e-5) {
        return vec3.normalize(vec3.create(), this._tempVec3);
      }
    }

    if (typeof bone.parentIndex === 'number' && bone.parentIndex >= 0 && bone.parentIndex < model.bones.length) {
      const parent = model.bones[bone.parentIndex];
      this._tempVec3[0] = bone.position[0] - parent.position[0];
      this._tempVec3[1] = bone.position[1] - parent.position[1];
      this._tempVec3[2] = bone.position[2] - parent.position[2];
      if (vec3.length(this._tempVec3) > 1e-5) {
        return vec3.normalize(vec3.create(), this._tempVec3);
      }
    }

    return null;
  }

  /**
   * ジョイントを生成します。
   * @private
   * @param {Object} jointData ジョイントデータ
   * @param {Object} bodyA ボディA
   * @param {Object} bodyB ボディB
   * @returns {Object} ジョイントオブジェクト
   */
  _createJoint(jointData, bodyA, bodyB) {
    const { Ammo } = this;
    const { btTransform, btVector3, btGeneric6DofSpringConstraint } = Ammo;

    const jointMat = this._tempMatC;
    const q = this._setQuatFromMmdEulerRadians(this._tempQuat, jointData.rotation);
    mat4.fromRotationTranslation(jointMat, q, jointData.position);
    jointMat[12] *= AMMO_LENGTH_SCALE;
    jointMat[13] *= AMMO_LENGTH_SCALE;
    jointMat[14] *= AMMO_LENGTH_SCALE;

    const matA = this._tempMatA;
    const matB = this._tempMatB;
    const readBTTransformToMat4 = (tr, out) => {
      const qRead = tr.getRotation();
      const pRead = tr.getOrigin();
      this._tempQuat[0] = qRead.x();
      this._tempQuat[1] = qRead.y();
      this._tempQuat[2] = qRead.z();
      this._tempQuat[3] = qRead.w();
      quat.normalize(this._tempQuat, this._tempQuat);
      mat4.fromRotationTranslation(out, this._tempQuat, [pRead.x(), pRead.y(), pRead.z()]);
    };
    readBTTransformToMat4(bodyA.ammoBody.getWorldTransform(), matA);
    readBTTransformToMat4(bodyB.ammoBody.getWorldTransform(), matB);
    
    const invA = mat4.invert(matA, matA);
    const invB = mat4.invert(matB, matB);
    const relAMat = mat4.multiply(mat4.create(), invA, jointMat);
    const relBMat = mat4.multiply(mat4.create(), invB, jointMat);

    const relA = new btTransform();
    const relB = new btTransform();
    this._setBTTransformFromMat4(relA, relAMat);
    this._setBTTransformFromMat4(relB, relBMat);

    const constraint = new btGeneric6DofSpringConstraint(bodyA.ammoBody, bodyB.ammoBody, relA, relB, true);

    const lLimit = new btVector3(
      jointData.posMin[0] * AMMO_LENGTH_SCALE,
      jointData.posMin[1] * AMMO_LENGTH_SCALE,
      jointData.posMin[2] * AMMO_LENGTH_SCALE
    );
    const uLimit = new btVector3(
      jointData.posMax[0] * AMMO_LENGTH_SCALE,
      jointData.posMax[1] * AMMO_LENGTH_SCALE,
      jointData.posMax[2] * AMMO_LENGTH_SCALE
    );
    constraint.setLinearLowerLimit(lLimit);
    constraint.setLinearUpperLimit(uLimit);

    const alLimit = new btVector3(jointData.rotMin[0], jointData.rotMin[1], jointData.rotMin[2]);
    const auLimit = new btVector3(jointData.rotMax[0], jointData.rotMax[1], jointData.rotMax[2]);
    constraint.setAngularLowerLimit(alLimit);
    constraint.setAngularUpperLimit(auLimit);

    for (let i = 0; i < 3; i++) {
      if (jointData.posSpring[i] !== 0) {
        constraint.enableSpring(i, true);
        constraint.setStiffness(i, jointData.posSpring[i]);
      }
      if (jointData.rotSpring[i] !== 0) {
        constraint.enableSpring(i + 3, true);
        constraint.setStiffness(i + 3, jointData.rotSpring[i]);
      }
    }

    constraint.setParam(Ammo.BT_CONSTRAINT_ERP, 1e-3, -1);
    constraint.setParam(Ammo.BT_CONSTRAINT_STOP_ERP, 1e-3, -1);
    constraint.setParam(Ammo.BT_CONSTRAINT_CFM, 0.05, -1);
    constraint.setParam(Ammo.BT_CONSTRAINT_STOP_CFM, 0.05, -1);

    Ammo.destroy(relA);
    Ammo.destroy(relB);
    Ammo.destroy(lLimit);
    Ammo.destroy(uLimit);
    Ammo.destroy(alLimit);
    Ammo.destroy(auLimit);

    return { ammoConstraint: constraint, jointData };
  }

  /**
   * BulletのTransformからmat4を取得します。
   * @private
   * @param {Object} tr BulletのTransform
   * @param {mat4} out 出力先
   */
  /**
   * PMD/PMX の剛体・ジョイント用 Euler 回転（ラジアン）を Bullet 用 quaternion に変換します。
   * 物理用回転は Y -> X -> Z の順で解釈する。
   * @private
   * @param {quat} out 出力先 quaternion
   * @param {Array<number>} eulerRadians ラジアンの Euler 回転 [x, y, z]
   * @returns {quat} out
   */
  _setQuatFromMmdEulerRadians(out, eulerRadians) {
    return quat.fromEuler(
      out,
      eulerRadians[0] * 180 / Math.PI,
      eulerRadians[1] * 180 / Math.PI,
      eulerRadians[2] * 180 / Math.PI,
      'yxz',
    );
  }

  /**
   * 物理演算を更新します。実際の処理は stepSimulation が行います。stepSimulation の前に _preSimulation が呼ばれ、stepSimulation の後に _postSimulation が呼ばれます。
   * @param {number} dframe 進めるフレーム数
   */
  update(dframe) {
    if (!this.world || !this.enabled) return;
    const dt = dframe * this.targetSPF;
    if (dt <= 0) return;

    for (const entry of this.models) {
      this._preSimulation(entry, dt);
    }

    // stepSimulation(timeStep/* sec */, maxSubSteps, fixedTimeStep)
    this.world.stepSimulation(dt, this.maxSubSteps, this.targetSPF / this.simulationMultiplier);

    // デバッグ用。実際の衝突解決は stepSimulation で行う
    this._processCollisions();

    for (const entry of this.models) {
      this._postSimulation(entry);
    }
  }

  /**
   * 物理演算状態をリセットします。
   */
  reset() {
    if (!this.world) return;

    for (const entry of this.models) {
      this.resetModel(entry);
    }
  }

  /**
   * 物理演算状態を再構築します。
   */
  rebuild() {
    if (!this.world) return;

    for (const entry of this.models) {
      this.rebuildModel(entry);
    }
  }

  /**
   * 物理演算中の衝突情報を処理します。
   * @private
   */
  _processCollisions() {
    if (!this.onCollision || !this.world) return;

    const dispatcher = this.world.getDispatcher();
    const numManifolds = dispatcher.getNumManifolds();

    for (let i = 0; i < numManifolds; i++) {
      const manifold = dispatcher.getManifoldByIndexInternal(i);
      const numContacts = manifold.getNumContacts();
      if (numContacts === 0) continue;

      const body0 = this.pointerToBodyMap.get(this.Ammo.getPointer(manifold.getBody0()));
      const body1 = this.pointerToBodyMap.get(this.Ammo.getPointer(manifold.getBody1()));

      // どちらか一方が管理対象の剛体であれば通知
      if (!body0 && !body1) continue;

      for (let j = 0; j < numContacts; j++) {
        const contactPoint = manifold.getContactPoint(j);
        const impulse = contactPoint.getAppliedImpulse();

        // 実際に衝撃が発生しているか、めり込んでいる場合にコールバックを呼び出す
        if (impulse !== 0 || contactPoint.getDistance() <= 0) {
          this.onCollision(body0, body1, impulse, contactPoint);
        }
      }
    }
  }

  onCollision(body0, body1, impulse, contactPoint){
    if (impulse > 10.0) {
          console.log(`激しい衝突を検知: ${body0.rbData.name} vs ${body1.rbData.name}. inpulse: ${impulse}`);
    }
  }

  /**
   * シミュレーション前の処理を実行します。
   * @private
   * @param {Object} entry モデルエントリ
   * @param {number} dt デルタタイム
   */
  _preSimulation({ model, scene, bodies }, dt) {
    for (const body of bodies) {
      const boneIndex = body.boneIndex;
      if (boneIndex === -1) continue;

      const physicsMode = body.rbData.physicsMode;
      if (physicsMode === 0 || physicsMode === 2) {
        // 1. target transform を作る
        const worldMatrix = scene.boneLocalTransforms[boneIndex].worldMatrix;
        const rbWorldMatrix = mat4.multiply(this._tempMatA, worldMatrix, body.boneOffsetMat);
        const setBTTransformFromMat4Scaled = this._setBTTransformFromMat4Scaled || this._setBTTransformFromMat4;
        setBTTransformFromMat4Scaled.call(this, this._tempBTTr, rbWorldMatrix);
        
        const ammoBody = body.ammoBody;
        
        if (physicsMode === 0) {
          // Kinematic: Velocity-based move for interaction
          // 2. 現在 transform を取得
          ammoBody.getMotionState().getWorldTransform(this._tempBTTr2);

          // 3. 速度を計算
          const targetPos = this._tempBTTr.getOrigin();
          const currentPos = this._tempBTTr2.getOrigin();
          
          this._tempBTVec.setValue(
            (targetPos.x() - currentPos.x()) / dt,
            (targetPos.y() - currentPos.y()) / dt,
            (targetPos.z() - currentPos.z()) / dt
          );
          ammoBody.setLinearVelocity(this._tempBTVec);

          // 4. 角速度を計算
          const targetRot = this._tempBTTr.getRotation();
          const currentRot = this._tempBTTr2.getRotation();
          
          const qTarget = [targetRot.x(), targetRot.y(), targetRot.z(), targetRot.w()];
          const qCurrent = [currentRot.x(), currentRot.y(), currentRot.z(), currentRot.w()];
          
          // できれば両方正規化してから使う
          quat.invert(this._tempQuat, qCurrent);
          quat.multiply(this._tempQuat, qTarget, this._tempQuat);
          
          // shortest arc
          if (this._tempQuat[3] < 0) {
            this._tempQuat[0] = -this._tempQuat[0];
            this._tempQuat[1] = -this._tempQuat[1];
            this._tempQuat[2] = -this._tempQuat[2];
            this._tempQuat[3] = -this._tempQuat[3];
          }
          
          const angle = 2 * Math.acos(Math.min(1.0, this._tempQuat[3]));
          if (angle > 0.0001) {
            const s = angle / dt;
            const axisNorm = Math.sqrt(Math.max(0.0, 1.0 - this._tempQuat[3] * this._tempQuat[3]));
            if (axisNorm > 0.0001) {
              this._tempBTVec.setValue(
                (this._tempQuat[0] / axisNorm) * s,
                (this._tempQuat[1] / axisNorm) * s,
                (this._tempQuat[2] / axisNorm) * s
              );
            } else {
              this._tempBTVec.setValue(0, 0, 0);
            }
          } else {
            this._tempBTVec.setValue(0, 0, 0);
          }
          ammoBody.setAngularVelocity(this._tempBTVec);

          ammoBody.getMotionState().setWorldTransform(this._tempBTTr);
        } else {
          // Mode 2: Warp position to bone origin, but KEEP physical rotation and angular velocity
          ammoBody.getMotionState().getWorldTransform(this._tempBTTr2);
          this._tempBTTr2.setOrigin(this._tempBTTr.getOrigin());
          
          ammoBody.setCenterOfMassTransform(this._tempBTTr2);
          ammoBody.getMotionState().setWorldTransform(this._tempBTTr2);
          
          // Clear linear velocity to prevent additive force, but keep angular
          ammoBody.setLinearVelocity(this._tempBTVec.setValue(0, 0, 0));
        }
        
        ammoBody.activate();
      }
    }
  }

  /**
   * シミュレーション後の処理を実行します。
   * @private
   * @param {Object} entry モデルエントリ
   */
  _postSimulation({ model, scene, bodies, boneToPostSimulationBodyMap }) {
    const rbTr = this._tempBTTr; 

    for (const boneIndex of scene.sortedBoneIndices) {
      const body = boneToPostSimulationBodyMap[boneIndex];
      const local = scene.boneLocalTransforms[boneIndex];
      const bone = model.bones[boneIndex];
      const parentIndex = bone.parentIndex;
      
      const parentWorld = parentIndex !== -1 ? scene.boneLocalTransforms[parentIndex].worldMatrix : mat4.identity(this._tempMatC);

      if (body && body.rbData.physicsMode !== 0) {
        body.ammoBody.getMotionState().getWorldTransform(rbTr);
        const rbWorldMatrix = this._tempMatB;
        const rotation = rbTr.getRotation();
        const origin = rbTr.getOrigin();
        this._tempQuat[0] = rotation.x();
        this._tempQuat[1] = rotation.y();
        this._tempQuat[2] = rotation.z();
        this._tempQuat[3] = rotation.w();
        quat.normalize(this._tempQuat, this._tempQuat);
        mat4.fromRotationTranslation(
          rbWorldMatrix,
          this._tempQuat,
          [origin.x() * AMMO_INV_LENGTH_SCALE, origin.y() * AMMO_INV_LENGTH_SCALE, origin.z() * AMMO_INV_LENGTH_SCALE]
        );

        // boneWorldMatrix = rbWorldMatrix * invBoneOffsetMat
        const boneWorldMatrix = mat4.multiply(this._tempMatA, rbWorldMatrix, body.invBoneOffsetMat);
        
        // baseMatrix = parentWorld * Translation(baseTranslation)
        const baseMatrix = mat4.multiply(this._tempMatB, parentWorld, mat4.fromTranslation(this._tempMatB, local.baseTranslation));
        
        const invBaseMatrix = mat4.invert(this._tempMatB, baseMatrix);
        if (invBaseMatrix) {
          const localTransform = mat4.multiply(this._tempMatB, invBaseMatrix, boneWorldMatrix);
          
          // Mode 1, 2 共通で回転は物理から取得
          mat4.getRotation(local.rotation, localTransform);

          if (body.rbData.physicsMode === 1) {
            // Mode 1 のみ移動も物理から取得
            mat4.getTranslation(local.translation, localTransform);
            mat4.copy(local.worldMatrix, boneWorldMatrix);
            local.physicsDriven = true; // Signal to ModelManager to keep this worldMatrix
          } else {
            // Mode 2 は位置はアニメーション/IKに従うため、FKを再計算してworldMatrixを更新
            vec3.add(this._tempVec3, local.baseTranslation, local.translation);
            
            // Add manual transforms
            this._tempQuat[0] = local.manualRotation[0];
            this._tempQuat[1] = local.manualRotation[1];
            this._tempQuat[2] = local.manualRotation[2];
            this._tempQuat[3] = local.manualRotation[3];
            quat.multiply(this._tempQuat, this._tempQuat, local.rotation);

            mat4.fromRotationTranslationScale(this._tempMatA, this._tempQuat, vec3.add(this._tempVec3, this._tempVec3, local.manualTranslation), local.scale);
            mat4.multiply(local.worldMatrix, parentWorld, this._tempMatA);
            
            // Note: Mode 2 is NOT marked as physicsDriven here because we want its position updated by FK in the next frame
          }
          
        }
        this.modelManager?.markBoneLocalTransformDirty(local);
      } else {
        // No physics or Kinematic: Update worldMatrix based on current local transform (including translation)
        // This ensures child bones (which might be physical) have the correct parent world matrix.
        vec3.add(this._tempVec3, local.baseTranslation, local.translation);
        
        // Add manual transforms
        this._tempQuat[0] = local.manualRotation[0];
        this._tempQuat[1] = local.manualRotation[1];
        this._tempQuat[2] = local.manualRotation[2];
        this._tempQuat[3] = local.manualRotation[3];
        quat.multiply(this._tempQuat, this._tempQuat, local.rotation);

        mat4.fromRotationTranslationScale(this._tempMatA, this._tempQuat, vec3.add(this._tempVec3, this._tempVec3, local.manualTranslation), local.scale);
        mat4.multiply(local.worldMatrix, parentWorld, this._tempMatA);
        
        // Note: we don't set physicsDriven here as this is just hierarchical propagation
      }

      this._finalizeBoneWorldTransform(scene, boneIndex, local);
    }
  }
}
