# 剛体が揺れ続ける

Bullet で剛体が「揺れ続ける」ときは、たいてい次のどれかです。Bullet は sequential impulse 系の拘束ソルバを使い、反復解法なので、接触やジョイントの誤差が少し残ると細かい振動として見えます。さらに Bullet は固定内部 timestep と substep を前提にしており、変動 dt をそのまま流すと不安定になりやすいです。([ケント州立大学][1])

1. **solver / timestep が足りない**
   `stepSimulation` は内部 fixed timestep と最大 substep 数で安全側に倒す設計です。dt が大きい、substep が少ない、solver iterations が少ないと、接触が収束しきらずに微振動が残ります。対策は「固定 1/60 秒前後で回す」「必要なら substep を増やす」「solver iterations を増やす」です。([ケント州立大学][1])

2. **質量・慣性テンソルのバランスが悪い**
   Bullet のマニュアルは、**大きな質量差は不安定になりやすく、質量は 1 付近に揃えるのがよい**としています。慣性テンソルが形状に対して極端だと回転が暴れやすく、結果として揺れが続きます。重い物体の上に極端に軽い物体を置く構成は特に要注意です。([ケント州立大学][1])

3. **摩擦・反発・接触マージンの組み合わせ**
   Bullet は collision margin を小さく入れて安定性を確保しており、**margin を 0 にしない**ことが推奨されています。反発係数が高い、摩擦が高すぎる、あるいは接触形状がギリギリで食い込むと、ソルバが毎フレーム押し戻して振動しやすくなります。特に convex hull や triangle mesh で、形状が細かすぎる・三角形が大きすぎる／退化している場合も不安定要因です。([ケント州立大学][1])

4. **sleeping（休止）に入れていない / 入れにくい**
   Bullet は動的剛体を、速度がしきい値以下の状態が一定時間続くと自動で deactivation します。`setSleepingThresholds(linear, angular)` のしきい値が低すぎる、またはどこかから微小な力や拘束誤差が入り続けると、いつまでも起きたままで揺れます。止めたい物体は sleeping threshold を適切に設定し、不要な外力や kinematic の微小追従を減らします。([GitHub][2])

実務上の優先順は、まず **dt を固定して substep を確保**、次に **solver iterations を増やす**、その次に **質量比を詰める**、最後に **damping / sleeping thresholds / friction / restitution / collision margin** を詰める、です。`damping` は速度を減衰させるので、揺れの“残り”には効きますが、根本原因が solver 収束不足なら damping だけでは止まりません。`setDamping(lin, ang)` は剛体に対する線形・角速度の減衰設定です。([GitHub][2])

典型的には、次の順で効きます。

* **まず fixed timestep + substep 増加**
* **次に solver iterations 増加**
* **質量差を縮める**
* **restitution を下げる**
* **linear / angular damping を少し上げる**
* **sleeping threshold を調整する** ([ケント州立大学][1])

\[1\]: https://www.cs.kent.edu/~ruttan/GameEngines/lectures/Bullet_User_Manual "Bullet Physics Manual"  
\[2\]: https://github.com/bulletphysics/bullet3/blob/master/src/BulletDynamics/Dynamics/btRigidBody.h "bullet3/src/BulletDynamics/Dynamics/btRigidBody.h at master · bulletphysics/bullet3 · GitHub"

# 貫通
ERP↓ + CFM↑ はセットで考えるのが定石です。

### ERP (Error Reduction Parameter) 
1ステップで戻す誤差の量。デフォルトは通常 0.2。値を上げるとめり込み修正が強くなる。

### CFM (Constraint Force Mixing) の設定
CFM は拘束の“柔らかさ”。0 なら硬い衝突、値を大きくすると柔らかくなる。

### split impulse
これは**貫入解消を速度に反映しない**モードで、接触バウンドを抑えます。これを有効にしないと、「押し戻し → 速度発生 → 振動」のループに入りやすい。

> const info = world.getSolverInfo();  
> info.set_m_splitImpulse(true);  
> info.set_m_splitImpulsePenetrationThreshold(-0.02);

# 用途別設定
|実現したいこと|使用するAPI / パラメータ|
|:---|:---|
|ボールのように跳ねさせたい|`setRestitution`|
|めり込みをガチガチに硬くしたい|`m_erp` を上げ、`m_cfm` を 0 にする|
|キャラが壁に埋まった時にジワっと戻したい|`m_erp` を下げ、`m_splitImpulse` を有効にする|
|特定の床だけジャンプ台のようにしたい|`gContactAddedCallback` でインパルスを増幅|

# 髪や服の反発が大きい

このケースは「布・髪（軽量・多数・柔らかい） vs 身体（重い・剛体）」という質量比と拘束剛性のミスマッチが原因で、Bullet の接触ソルバが過剰な押し戻し（反発）を生成している典型例です。
単に restitution や friction を触るより、接触解決の“剛性”と“収束挙動”を下げる方向で調整します。

### 1) restitution をほぼ 0 に固定（前提）
髪・服側も身体側も両方：

> rb.setRestitution(0.0);

ここが 0 でないと、ERP/CFM 調整の前にバウンスが発生して破綻します。

### 2) 髪・服側だけ CFM を上げて“柔らかくする”
髪・服の拘束（ボーン間 constraint）に対して：

> constraint.setParam(Ammo.BT_CONSTRAINT_CFM, 1e-3, -1);
> constraint.setParam(Ammo.BT_CONSTRAINT_STOP_CFM, 1e-3, -1);

- 値目安: `1e-4 ～ 1e-2`
- 効果:
   - 剛体が押し戻される代わりに“潰れる”
   - 衝突時のインパルスが分散 → 反発減少

### 3) ERP を下げる（めり込み許容）

> constraint.setParam(Ammo.BT_CONSTRAINT_ERP, 0.05, -1);
> constraint.setParam(Ammo.BT_CONSTRAINT_STOP_ERP, 0.05, -1);

- 値目安: `0.02 ～ 0.2`
- 効果:
   - 「めり込みをすぐ解消しない」→ 反発が弱くなる
   - 髪・服ではむしろ自然な挙動になる

### 4) split impulse を必ず有効化（重要）

> const info = world.getSolverInfo();  
> info.set_m_splitImpulse(true);  
> info.set_m_splitImpulsePenetrationThreshold(-0.02);

- 効果:
- 貫入解消を速度に変換しない
  - 「押し戻し → 速度 → 跳ねる」のループを遮断

これをやらないと調整の意味が半減します。

### 5) 髪・服の mass を“軽すぎにしない”

ありがちなミス：

- 髪: 0.01
- 体: 10

→ この比率はほぼ確実に発振します

#### 推奨
- 比率は **1:1 ～ 1:10 程度に収める**

> 体: 10  
> 髪: 0.5 ～ 2

※ 軽すぎると solver が押し負けて「弾かれる」挙動になります

### 6) damping を強める（髪・服のみ）
> rb.setDamping(0.3, 0.8);

- 角ダンピングは特に重要
- 反発後の“残響振動”を抑える

### 7) 接触の感度を下げる
> rb.setContactProcessingThreshold(0.05);

- 小さな接触で強く反応しないようにする
- 髪の“ビリビリ震え”防止

### 8) コリジョン形状の見直し（かなり効く）
モデルを変えられない場合でも：

#### NG
- triangle mesh 同士のコリジョン
- 細かすぎる convex hull

#### 推奨
- 身体側 → カプセル or 球で近似
- 髪 → 小さめの球 or カプセル

理由：
- 接触法線が安定する
- solver が収束しやすい

### 9) サブステップを増やす
> world.stepSimulation(dt, 10, 1/120);

- 衝突解決の精度向上
- 特に高速動作時に効く

## 本質的な理解

今回の現象は：

> 「剛体同士の“硬い衝突”として解いている」ことが原因

髪・服は本来：

- 連続体
- 変形する
- エネルギーを吸収する

→ なので Bullet 的には
「**拘束を柔らかくする（CFM）**」＋「**誤差を急いで直さない（ERP）**」
に寄せるのが正解になります。