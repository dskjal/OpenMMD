# ボーンの回転をクォータニオンで持っています。これをオイラー回転XYZでユーザーに表示するときに、90度以上の回転が表現できない問題の解決方法

それは **クォータニオンの問題ではなく、Euler XYZ への「見せ方」の問題**です。
`asin` ベースで Euler に戻す実装だと、中央軸が **±90° で折り返す**ため、90°を超えた回転が表現できないように見えます。これは XYZ オイラー角の固有の特異点です。

実務上の解決策は、**内部表現はクォータニオンのまま保持し、UI 用にだけ「連続化した Euler」を別途持つ**方法です。

## おすすめのデータ構造

```ts
type BoneRotationState = {
  quat: Quaternion;       // 真の姿勢
  eulerDisplay: Vec3;     // UI表示用の連続Euler（ラジアン or 度）
  prevEulerDisplay: Vec3; // 前回表示値
};
```

ポイントは `eulerDisplay` を **毎回クォータニオンから素直に再計算しない**ことです。
毎フレーム、前回値に最も近い Euler 解を選んで「unwrap」します。

---

## アルゴリズム 1: 近い解を選んで連続化する

クォータニオン → Euler XYZ 変換には、同じ姿勢に対して複数の解があります。
その中から **前回表示値に最も近い解**を採用します。

### 流れ

1. quaternion から Euler XYZ の候補を複数作る
2. 各軸について `2π` の周期を考慮して前回値に近いものへ補正する
3. 前回表示値との差が最小の解を採用する

### 1軸の unwrap

```ts
function unwrapAngle(angle: number, reference: number): number {
  const TWO_PI = Math.PI * 2;
  let d = angle - reference;
  d = ((d + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
  return reference + d;
}
```

### 使い方

```ts
euler.x = unwrapAngle(euler.x, prev.x);
euler.y = unwrapAngle(euler.y, prev.y);
euler.z = unwrapAngle(euler.z, prev.z);
```

これで `179° → 181°` のような連続回転を自然に表示できます。

---

## アルゴリズム 2: Euler を「入力値」として持ち、姿勢更新だけクォータニオンで行う

UI が「X/Y/Z のスライダー」で、ユーザーが直接操作するならこちらが安定です。

* UI 側では Euler をそのまま保持
* 変化量 `Δx, Δy, Δz` を受け取ったら
* その差分だけクォータニオンに積む

```ts
quat = quat * quatFromEulerXYZ(deltaX, deltaY, deltaZ);
```

この方式だと、**表示値が勝手に 90° で折り返さない**ので扱いやすいです。
ただし「現在の姿勢を毎回 Quaternion → Euler に逆変換して表示する」設計にすると、また折り返し問題が出ます。

---

## アルゴリズム 3: Euler ではなく回転ベクトルで UI を作る

もし「3軸スライダー」にこだわらないなら、次の表現の方が本質的に安定です。

* **軸角表現**
* **回転ベクトル（rotation vector / exponential map）**
* **Swing-Twist 分解**

特に回転ベクトルは、
`v = axis * angle`
として扱えるので、90°制限のような見かけ上の破綻が少ないです。

---

## 重要な注意点

XYZ Euler は、**どんな実装でも完全には避けられない特異点**があります。
つまり、

* 「全部の姿勢を一意に」
* 「Euler XYZ のまま」
* 「特異点なし」

は同時に満たせません。

なので実際は次のどちらかになります。

* **内部は quaternion、表示は連続化した Euler**
* **UI も quaternion / 回転ベクトル寄りにする**

---

## 実装方針として一番おすすめ

3DCG の姿勢制御なら、私はこうします。

1. **内部姿勢は quaternion**
2. **UI 表示用に `prevEuler` を持つ**
3. quaternion → Euler 変換後、`unwrapAngle` で前回値に追従
4. もし操作 UI が必要なら、Euler は「表示・入力の差分」だけに使う

これが一番壊れにくいです。