# OpenMMD のアーキテクチャ

OpenMMD は、`UI`、`Application / Logic`、`Core Runtime`、`Infrastructure / Adapter`、`External Engine / Library` の 5 層で考える。

依存方向は原則として次の通りに固定する。

`UI -> Application / Logic -> Core Runtime <- Infrastructure / Adapter`

`Infrastructure / Adapter -> External Engine / Library`

この文書の目的は、実装詳細ではなく責務境界を明確にすることにある。具体的なクラス名やファイル分割は変わってもよいが、層の責務と依存方向は維持する。

## Bootstrap / Composition Root

Bootstrap は層のひとつではなく、各層を組み立てる合成根である。

### 責務

- `ApplicationContext` を生成する
- `Application / Logic` の command surface と facade を生成する
- UI、Core Runtime、Infrastructure の依存を注入する
- 編集系の Application / Logic サービスと UI コントローラを組み立てる
- bone inspector / import candidate / debug / material / texture / environment / light / render settings の panel service と controller を組み立て、bootstrap 自身は薄い同期入口だけを持つ
- scene refresh や inspector UI sync の coordinator を組み立てる
- 初期化順の影響を受ける UI 同期や manager 参照は、安全な getter / callback 入口として公開する
- 互換性のための `window.*` エイリアスは必要最小限だけ残す
- `timelineManager` は bootstrap 内部の構築物として閉じ込め、他層へは playback service / command surface 経由でのみ流す
- browser shell 固有の fullscreen、drag & drop、tab 切替、API bridge install は browser bootstrap module に寄せる

### 境界

- Bootstrap はユースケースの本体を持たない
- Bootstrap は DOM や runtime state の詳細を保持しない
- Bootstrap は command の順序制御を担当しない
- Bootstrap は command surface の実体を直接実行しない
- Bootstrap 内の先行定義ヘルパーから、後段で初期化される `timelineManager` や UI controller のローカル変数を直接参照しない
- Bootstrap は material / texture / import candidate の候補配列や UI 集約 cache をローカル state として保持しない

### 対象モジュールの例

- `source/bootstrap/openmmd-app.js`
- `source/bootstrap/browser-openmmd-app.js`
- `source/application/app-context.js`
- `source/application/app-facade.js`
- `source/application/ui/ui-read-model-service.js`

## 1. UI

UI はユーザー入力の受付、表示、状態の可視化を担当する。

### 責務

- 画面描画と DOM 操作
- ボタン、スライダー、タイムライン、ダイアログなどの操作受付
- 選択状態、再生状態、設定値の表示
- i18n の反映
- 画面上の補助表示
- animation source の選択、削除、キー登録のような変更要求は facade 経由で Application / Logic に委譲する
- 再生ショートカット、timeline key 削除、animation export のような変更要求も facade / command surface 経由で Application / Logic に委譲する
- モデル一覧、animation 一覧、削除確認、animation export 初期値のような UI 読み取りも facade の read-model API 経由で受け取る

### 対象モジュールの例

- `source/ui/renderer-ui.js`
- `source/ui/timeline.js`
- `source/ui/ui-components.js`
- `source/ui/panels/color-picker-ui.js`
- `source/ui/panels/bone-info-ui.js`
- `source/ui/panels/world-rotation-ui.js`
- `source/ui/panels/bgm-controller.js`
- `source/ui/panels/inspector-select-ui.js`
- `source/ui/panels/bone-editing-controller.js`
- `source/ui/panels/camera-editing-controller.js`
- `source/ui/panels/light-panel-controller.js`
- `source/ui/panels/environment-panel-controller.js`
- `source/ui/panels/debug-panel-controller.js`
- `source/ui/panels/import-candidates-controller.js`
- `source/ui/panels/material-panel-controller.js`
- `source/ui/panels/render-settings-controller.js`
- `source/ui/panels/texture-panel-controller.js`

### 境界

- UI は OpenMMD の API を直接叩かない
- UI はモデル変換、再生制御、保存形式の解釈を持たない
- UI は Application / Logic 層に対して意図を送るだけにする
- UI は `timelineManager` や model instance を変更系の主経路として直接操作しない
- UI は model manager / vmd manager / selection を一覧描画や削除確認のために直接読まず、描画用 DTO を受け取る
- UI は debug 情報、import candidate 一覧、render 設定候補の組み立てを持たず、Application / Logic が返す read-model / option state を描画する
- UI は material / texture panel の集約状態、picker 候補、material JSON の組み立てを持たず、Application / Logic が返す panel state を描画する

## 2. Application / Logic

Application / Logic は、UI や外部入力を OpenMMD の操作手順に変換する層である。  
ここは `何をしたいか` を受け取り、`どの順で内部を動かすか` を決める。

### 必要性

現状の `renderer.js` は、UI 配線、読み込み、保存、再生、外部 API、各種 state 連携を広く持っている。  
この状態では、UI 差し替え、API 経由実行、ヘッドレス実行、テストを分離しにくい。

そのため、SOLID の観点では UI と Core Runtime の間に Application / Logic 層を置くのが妥当である。

### 責務

- ユースケースの実行順序を管理する
- UI から来た操作を domain 操作へ変換する
- 外部 API の command を内部操作へ変換する
- command surface を通じて UI、API bridge、外部連携に実行手段を提供する
- command surface / facade を通じて UI 向け read-model も提供する
- 読込、保存、再生、編集の一連のフローを組み立てる
- Core Runtime の state を更新し、必要なら Infrastructure を呼ぶ
- animation list の選択・解除・削除や morph / timeline key 登録のような UI 操作を command surface に集約する
- scene refresh や inspector UI sync の実行順序を coordinator に集約する
- model activate 後の UI sync、timeline rebuild、playback range sync のような後処理も command surface / coordinator に集約する
- animation assignment、morph key 登録、export のような timeline 関連副作用を command surface 側で吸収する
- playback / animation source / timeline key 操作の主経路を timeline orchestration service に集約する
- bone / camera / light の scene keyframe 登録と current frame 参照も timeline orchestration service に集約する
- shared playback frame advance、timeline view sync、animation update snapshot 生成を playback runtime service に集約する
- active instance 切替に伴う timeline rebuild / playback range sync / timeline view sync も playback runtime service に集約する
- モデル追加、モデル削除、active model 切替のような model lifecycle を service 化して集約する
- ZIP、単体 model file、VMD、VPD、BGM 候補の読込フローを asset loading service に集約する
- dropped input service は file 種別判定と use-case 呼び出し順序だけを担当し、BGM / shader / model manager の具体実装は operation 注入で隠蔽する
- model 選択待ちの settings / pose staging は pending import service に閉じ込め、browser shell と app bootstrap の共有 state として扱う
- viewer state の組み立てや runtime readiness 判定を viewer state service に集約する
- video export 時の playback / scene refresh / temporary UI state 制御を export runtime service に集約する
- 外部 command 由来の `set-bone-params` payload 適用を bone parameter command service に集約する
- bridge protocol、file payload serialize / deserialize、viewer command transport を integration 用の共有 utility / client に集約する

### 対象モジュールの例

- `source/application/app-context.js`
- `source/application/app-facade.js`
- `source/application/commands/application-commands.js`
- `source/application/timeline/timeline-headless.js`
- `source/application/timeline/playback-runtime-service.js`
- `source/application/timeline/timeline-orchestration-service.js`
- `source/core/animation/animation.js`
- `source/application/animation/runtime-animation.js`
- `source/application/interaction/renderer-interaction.js` のうち入力解釈と gesture state 遷移
- `source/application/interaction/viewport-input-binder.js`
- `source/application/assets/dropped-input-service.js`
- `source/application/assets/pending-import-service.js`
- `source/application/assets/asset-loading-service.js`
- `source/application/assets/import-candidate-service.js`
- `source/application/debug/debug-read-model-service.js`
- `source/application/integration/api-bridge.js`
- `source/application/integration/openmmd-bridge-protocol.js`
- `source/application/integration/viewer-command-client.js`
- `source/application/material/material-panel-service.js`
- `source/application/material/texture-panel-service.js`
- `source/application/render/render-settings-service.js`
- `source/application/viewer/viewer-state-service.js`
- `source/application/export/export-runtime-service.js`
- `source/application/export/video-export-manager.js`
- `source/application/editing/bone-editing-service.js`
- `source/application/editing/bone-parameter-command-service.js`
- `source/application/editing/camera-editing-service.js`
- `source/application/editing/light-editing-service.js`
- `source/application/models/model-lifecycle-service.js`
- `source/application/scene/scene-refresh-coordinator.js`
- `source/application/scene/inspector-sync-coordinator.js`

### 想定するサブ領域

#### Playback Logic

- 再生/停止
- フレーム移動
- 再生範囲管理
- BGM 同期
- shared playback advance と animation update state の供給
- active instance 切替、seek、play、stop、rewind、goToEnd のような low-level playback primitive の隔離
- bone / camera / light の scene keyframe 登録
- active playback context の current frame / scene source 参照
- timeline view sync や animation source assignment のような `timelineManager` 依存操作の隔離
- export 用 playback state snapshot / seek / restore
- animation source 切替や timeline key 編集に伴う UI / BGM 副作用の吸収

#### Editing Logic

- ボーン選択
- 手動姿勢補正
- IK 編集
- モーフ編集
- ライト/カメラ編集
- scene keyframe 登録要求を timeline orchestration service に委譲する
- camera FOV 編集のような current frame 依存入力も editing service 経由で適用し、UI controller が playback manager を知らないようにする
- 編集 UI の入力値を Core Runtime への操作列に変換する

#### Asset Loading Logic

- ドラッグ＆ドロップの振り分け
- モデル、モーション、HDR、設定ファイルの読込フロー
- 読込対象の判定と優先順位の決定
- VPD の適用先解決や model mismatch 確認を含む、import 後の適用手順
- environment HDR 候補や model 候補の選択状態、複数候補の一括読込手順

#### UI Read Model / Panel State Logic

- debug panel 用の camera / bone / animation read-model 構築
- import candidate list の表示用 state 構築
- material panel の集約状態、texture picker 候補、material JSON export state の構築
- texture panel の grid state と color space 集約状態の構築
- render aspect ratio / internal resolution の候補解決と適用手順
- DOM に依存しない selector option state と現在値の同期
- bootstrap に残っていた import candidate / material / texture のローカル helper 群を置き換える単一の責務面として扱う

#### Model Lifecycle Logic

- モデル追加時の physics 登録、auto animation assignment、active instance 更新
- モデル削除時の active instance 再計算、selection reset、morph UI 再構築
- active model 切替時の inspector / material / animation mapping / playback range / timeline view の同期

#### Import / Export Logic

- VMD、VRMA、VPD、Model JSON、UI JSON の読み書きフロー
- 動画 export 時の一時的な render / playback state 制御
- export service は再生 manager を直接知らず、playback runtime service を通して playback snapshot / seek / restore を扱う
- 保存前の正規化
- 保存後の状態同期

#### Integration Logic

- Local API command の処理
- control panel など外部連携の仲介
- control panel のような browser 側 integration は module import 時の副作用で起動せず、明示的 bootstrap / dispose API で管理する
- postMessage / SSE bridge の protocol と transport の共通化
- browser の event target 解決や overlay 要素取得は binder / adapter 側に寄せ、interaction service は gesture 解釈に集中させる
- `api-bridge` のような外部コマンド受け口は、注入された runtime / appContext / appFacade から解決した command surface に対してのみ作用する
- `api-bridge` は readiness 判定や viewer state 取得も service 経由に寄せ、`timelineManager` 直接前提を持たない
- `api-bridge` は module-level の install 副作用を持たず、`createApiBridge(...).install()` のような明示 factory で transport を起動する
- viewer state の active instance 解決は `selection` や注入された getter を優先し、API state builder が `timelineManager` を前提にしない
- bridge protocol の base64 変換や viewer state readiness 待機は browser global を直参照せず、`atob` / `btoa` / timer / clock / document adapter を注入可能にする

### 境界

- Application / Logic は DOM の詳細を持たない
- Application / Logic は WebGPU の詳細を持たない
- Application / Logic は File API、fetch、postMessage の実装差を持たない
- Application / Logic は handedness 変換や単位変換を自前実装しない
- Application / Logic は bootstrap の都合で直接組み立てられず、可能な限り context 経由で依存を受け取る
- Application / Logic の integration module は `window`、`document`、`EventSource` を直参照する代わりに注入可能な adapter を優先する
- Application / Logic の panel state service は DOM node や option 要素を返さず、UI controller がその state を描画する
- Application / Logic の material / texture panel service は `model.materials` 更新と `morphController.materialStates` 更新を同じ use-case に閉じ込める

## 3. Core Runtime

Core Runtime は OpenMMD の内部表現と、そこに対する計算の中心である。  
ここは右手系の内部表現だけを扱う。

### 責務

- 内部 model の保持
- 内部 animation の保持
- カメラ、ライト、選択状態、補助状態の保持
- IK、物理、モーフ、アニメーション適用の実行
- manual 補正や runtime state の合成

### 対象モジュールの例

- `source/core/model/runtime-model.js`
- `source/core/model/model-scene.js`
- `source/core/model/model-manager.js`
- `source/application/animation/runtime-animation.js`
- `source/core/animation/animation-clip.js`
- `source/core/animation/animation-mapper.js`
- `source/core/animation/animation.js`
- `source/core/model/morphing.js`
- `source/core/physics/ik.js`
- `source/core/physics/physics.js`
- `source/core/physics/vrm-springbone.js`
- `source/core/scene/camera.js`
- `source/core/scene/light-object.js`
- `source/core/selection/renderer-selection.js`

### Core Runtime の扱うもの

- 内部座標系は右手系
- 内部長さ単位は meter
- 内部 animation は OpenMMD の canonical 形式に正規化されている
- VRM、PMD、PMX、VMD、VPD、VRMA の外部差はここでは扱わない

### 境界

- Core Runtime は DOM を参照しない
- Core Runtime はファイル形式を解釈しない
- Core Runtime は ZIP、HTTP、cookie、local storage に依存しない
- Core Runtime は UI の都合で振る舞いを変えない
- Core Runtime は application bootstrap からの詳細な配線を知らない

## 4. Infrastructure / Adapter

Infrastructure / Adapter は、外部形式やプラットフォーム機能を OpenMMD の内部表現に接続する層である。

### 責務

- モデル、モーション、ポーズ、設定の入出力
- handedness 変換
- 単位変換
- winding 補正
- WebGPU resource と shader の構築
- File API、ZIP、fetch、postMessage、cookie などの platform 依存処理

### 対象モジュールの例

- `source/loader/*`
- `source/infrastructure/io/file-loading.js`
- `source/infrastructure/units/unit-conversion.js`
- `source/infrastructure/animation/vmd-manager.js`
- `source/infrastructure/serialization/model-json.js`
- `source/infrastructure/animation/vpd-utils.js`
- `source/infrastructure/animation/gltf-animation.js`
- `source/infrastructure/gpu/renderer-gpu.js`
- `source/infrastructure/gpu/renderer-resources.js`
- `source/infrastructure/gpu/model-manager-pipelines.js`
- `source/infrastructure/gpu/material-resources.js`
- `source/infrastructure/gpu/shadow-manager.js`
- `source/infrastructure/gpu/post-effect-planner.js`
- `source/infrastructure/config/ui-settings-loader.js`
- `source/infrastructure/config/defaults/defaults-manager.js`
- `source/infrastructure/api/api-state.js`

### 変換の責務

- PMD / PMX / VMD / VPD の左手系データは loader 側で右手系へ変換する
- VRMA のチャンネルや回転は保存・読込境界で必要な変換を行う
- 保存時は必要に応じて右手系から左手系へ戻す
- 変換ルールは Core Runtime に持ち込まない

### 境界

- Infrastructure は UI の状態管理を主目的にしない
- Infrastructure はユースケースの順序制御を主目的にしない
- Infrastructure は内部ルールの本体を持たない
- Infrastructure は必要な runtime 依存を注入で受け取り、`window.*` に直接依存しない実装へ寄せる
- `api-state` のような snapshot builder は、再生 manager の具体実装ではなく、runtime から受け取る選択状態や getter に依存する

## 5. External Engine / Library

External Engine / Library は OpenMMD が利用する外部実装である。  
OpenMMD のルールはここに置かない。

### 例

- Ammo.js / Bullet
- SpringBone
- WebGPU
- JSZip
- Mediabunny
- glMatrix
- three.js

### 境界

- 外部ライブラリのデータ構造をそのまま UI に露出しない
- 外部ライブラリの制約は Adapter 層で吸収する
- 依存先の差し替え可能性を Application / Logic と Core Runtime から守る

## OpenMMD の内部モジュール

この節は、内部の責務を実装詳細ではなく役割で整理したもの。

### Runtime Model / Scene

- model、bone、material、scene の内部状態を保持する
- ボーン階層、ローカル軸、選択状態、補助ボーンを扱う
- 物理やアニメーションの結果を受けて runtime state を更新する

### Animation / Timeline Logic

- animation source、clip、channel を統一的に扱う
- 再生、停止、フレーム移動、タイムライン編集を扱う
- VMD、VRMA、glTF 由来の animation を内部形式へまとめる

### Physics / Constraint Solving

- PMD / PMX の物理と VRM の SpringBone を扱う
- IK と剛体の同期を扱う
- 物理回転の Euler 順など、物理固有のルールを持つ

### Rendering

- WebGPU による描画を扱う
- 深度、影、ポストエフェクト、マテリアル描画を扱う
- runtime state を描画可能な形に変換する

### Asset Conversion

- 外部フォーマットと内部形式の変換を扱う
- handedness、単位、補間、チャンネル名、ボーン名の差を吸収する
- Importer / Exporter として独立して責務を持つ

### External Integration

- Local API
- control panel
- bridge protocol utility
- viewer command client
- これらの外部入力を Application / Logic に流す

### Command Surface / Facade

- UI や API bridge から見える実行口をまとめる
- 読込、保存、再生、編集、書き出しの command を公開する
- facade は mutation command だけでなく、一覧描画や削除確認に必要な read-model API も公開できる
- read-model の組み立ては bootstrap のローカル helper に置かず、UI read-model service に閉じ込めて facade / command surface から参照する
- debug panel、import candidate、render settings のような UI 専用 state も bootstrap のローカル helper に残さず、専用 service と controller に分離する
- material / texture panel の集約 state、picker state、material 編集副作用も bootstrap のローカル helper に残さず、専用 service と controller に分離する
- animation/timeline の変更操作も `editing` や `animation` の facade 経由で公開し、UI の直接 mutation を禁止する
- playback shortcut や export UI からの要求も facade / command surface に統一し、`timelineManager` 直接呼び出しを増やさない
- command surface は timeline 操作本体だけでなく、関連する UI sync や BGM sync などの副作用もまとめて引き受ける
- command surface 自体は薄く保ち、複雑な読込フローや model lifecycle は専用 service に委譲する
- command surface は timeline orchestration service や viewer state service の薄い委譲口として保ち、UI や bridge から runtime 直操作を受けない
- command surface は scene keyframe 登録も受け口として公開し、editing service や UI が `timelineManager` を直接知らないようにする
- video export manager や BGM UI 初期化も shared playback getter / facade を通して接続し、`timelineManager` 直結を増やさない
- Bootstrap が組み立てた runtime state を直接触らず、必要な依存だけを受け取る

### Defaults / Configuration

- 初期値、UI 設定、表示プリセットを扱う
- 実行時の既定値を一元管理する
- 変更可能な初期状態と固定定数を混同しない

## 依存ルール

SOLID リファクタリングで守るべきルールを明示する。

- UI は Core Runtime に直接触れず、Application / Logic を経由する
- Importer / Exporter は UI を参照しない
- Application / Logic の coordinator は option 要素生成のような DOM 構築を持たず、UI helper に描画を委譲する
- Core Runtime は file、ZIP、HTTP、DOM を知らない
- browser 固有の canvas / blob 変換は adapter 経由で export manager に注入する
- Rendering は runtime state を読むが、入力や保存ルールを解釈しない
- Physics は runtime state を更新するが、UI や保存形式を解釈しない
- API bridge は command を Application / Logic に渡すだけにし、実 runtime には注入された command surface を介してアクセスする
- Bootstrap は context、command surface、facade を組み立てて各層へ渡すだけにする

## 現時点の具体的なリファクタリング候補

この節は、`docs/openmmd-architecture.md` の方針と、現在の `source/bootstrap/openmmd-app.js` の実装を照合した結果として追加する。後方互換よりも、機能拡張の容易性と保守性の改善を優先する。

### 1. Bone Inspector / Child / IK の UI 配線を bootstrap から分離する

この項目は実施済み。

実施内容は次の通り。

- `source/ui/panels/bone-inspector-ui-state.js` で bone tab 専用の DOM 解決を binder に分離した
- `source/ui/panels/bone-inspector-controller.js` で bone tab の event binding と DOM 描画を閉じ込めた
- `source/application/editing/bone-inspector-service.js` で bone info / child / IK の panel state 構築を read-model service に分離した
- `source/application/editing/bone-editing-service.js` に VPD export payload 構築と timeline bone selection 反映を追加し、bone tab mutation command を集約した
- `source/application/scene/inspector-sync-coordinator.js` は `syncBoneInfoHeaderLabels` / `syncBoneInfoUiState` の 2 本をやめ、`syncBoneInspectorUi` 1 本へ依存する形に整理した

この結果、`source/bootstrap/openmmd-app.js` から次の責務を除去できた。

- VPD 保存ボタンの click 処理
- bone position / rotation 入力の解釈
- child / IK の change / click handler
- bone copy / paste / reset / key 登録の event wiring
- timeline からの bone 選択反映

今回さらに、bone inspector 固有の状態は `source/application/editing/bone-inspector-state.js` へ分離し、`selection` から `useWorldCoordinate`、`worldRotationUiState`、`boneInfoUiState`、`prevEuler`、`lastSelectedBoneIndex` を除去した。bone inspector controller / service、gizmo、render loop はこの state を明示的に受け取る。

また、selected bone / rigidbody のラベル更新は `source/application/selection/selection-overlay-port.js` へ寄せ、inspector sync coordinator からは label 更新 port 経由で呼び出す形に整理した。

### 2. Render / Environment / Shadow / Post Effect の設定 UI を panel 群へ再分割する

この項目は一部実施済み。

今回の実施内容は次の通り。

- `source/application/render/display-settings-service.js` を追加し、display preset / view transform / display color space / FPS の state mutation を bootstrap から分離した
- `source/application/render/environment-panel-service.js` を追加し、environment HDR intensity の clamp と適用を service 化した
- `source/application/render/shadow-panel-service.js` を追加し、shadow / ambient occlusion / contact shadow の mutation を service 化した
- `source/application/render/post-effect-panel-service.js` を追加し、post effect state の clamp / fallback / mutation を service 化した
- `source/ui/panels/display-settings-controller.js` を追加し、display preset / FPS / view transform / display color space / AA の event wiring を bootstrap から分離した
- `source/ui/panels/environment-panel-controller.js` を追加し、environment HDR intensity の入力同期と適用を bootstrap から分離した
- `source/ui/panels/light-panel-controller.js` を追加し、light position / rotation / glTF light strength の入力同期と key 状態反映を bootstrap から分離した
- `source/ui/panels/shadow-panel-controller.js` を追加し、shadow bias / strength / edge opacity / cascade debug / ambient occlusion / contact shadow の event wiring を bootstrap から分離した
- `source/ui/panels/post-effect-panel-controller.js` と `source/ui/panels/post-effect-ui-state.js` を追加し、`setupPostEffectUI` は binder + service + controller への薄い委譲口へ置き換えた
- `render-settings-service` は aspect ratio / internal resolution に限定したまま維持し、display 系の責務と分離した
- display preset 適用後の panel 同期は `panelSyncPort.syncRenderPanels` に集約し、display / post effect / shadow / environment / light の更新入口を 1 本にした

まだ bootstrap に残っている部分は次である。

- environment HDR candidate list と model candidate list の描画統合
- light color picker 初期化の完全分離
- post effect controller と display preset / render panel sync の最終的な coordinator 化

この塊は `rendererState` と WebGPU uniform 更新手順の両方を跨ぐため、機能追加時に bootstrap 変更範囲が広くなりやすい。

次の構成へ寄せる。

- `source/application/render/environment-panel-service.js`
- `source/application/render/shadow-panel-service.js`
- `source/application/render/post-effect-panel-service.js`
- `source/ui/panels/environment-panel-controller.js`
- `source/ui/panels/shadow-panel-controller.js`
- `source/ui/panels/post-effect-panel-controller.js`

`render-settings-service` は aspect ratio / resolution に限定し、render tab 全体の façade にはしない。設定群は「environment」「shadow」「post effect」「display preset」のサブパネル単位で分ける。

### 3. Browser 固有 API を platform adapter に集約する

この項目は一部実施済み。

今回、`source/infrastructure/browser/browser-platform-adapter.js` を追加し、次を adapter 経由へ寄せた。

- language の read / write
- dialog (`confirm`, `prompt`)
- timer / clock (`performance.now`)
- binary download
- export canvas 作成
- render-resolution change event 発火
- WebGPU adapter / preferred canvas format 取得

`openmmd-app.js` と `viewer-state-service` / `api-bridge` は、この adapter と port 経由で browser 依存を受け取る形へ寄せ始めている。

今回さらに、`browser-openmmd-app.js` は `appContext.ports.viewer` を優先して参照する形へ寄せ、次を `runtime` 直参照から外した。

- shader 利用状況判定
- animation mapping tab への model / selection 注入
- API bridge への `ports` 注入

次の adapter 境界を追加する。

- fullscreen 周辺の browser shell 側 adapter 統合
- `document` 直参照のさらなる削減
- `applicationCommandDeps` の個別 browser callback 群の port 化

Application / Logic へは browser global を直接渡さず、`platform` port として注入する。`applicationCommandDeps` に個別関数を並べる方式は段階的に廃止する。

### 4. Bootstrap の可変 callback 群を小さな port object へ置き換える

この項目は一部実施済み。

今回、bootstrap 内の遅延配線は registry ではなく小さな mutable port object へ寄せた。

port として整理した入口は次の通り。

- `refreshScene`
- `syncTimelineUi`
- `syncInspectorUi`
- `syncCameraUiState`
- `syncLightTabUi`
- `syncCameraDebugUi`
- `syncEnvironmentHdrUi`
- `syncModelCandidateUi`
- `syncBoneInspectorUi`
- `syncMaterialTabUi`
- `syncTextureTabUi`
- `syncAnimationMappingTabUi`
- `syncRenderPanels`

これにより、controller / coordinator / command への注入は「その時点のローカル変数」を capture する代わりに、`sceneSyncPort` / `panelSyncPort` が持つ最新実装へ委譲する形になった。

さらに、selection overlay は `selectionOverlayPort` として独立させ、export runtime service / inspector sync coordinator / grid overlay 初期化から共有する形へ寄せた。

今回さらに、`uiSync` port は `syncRenderPanels`、`syncBoneInspectorUi`、`syncAnimationMappingTabUi` を公開し、viewer port からは panel 個別同期責務を外し始めている。

残課題は、post effect 側の残存 helper を scene / panel port へさらに寄せることだけである。

### 5. Application Runtime の巨大 bag を use-case 別 port に分解する

この項目は一部実施済み。

今回、`applicationContext` / `applicationFacade` / `viewer-state-service` / `api-bridge` が `ports` を受け取れるようにし、bootstrap で次の port を組み立て始めた。

- `viewer`
- `playback`
- `export`
- `uiSync`
- `shell`

今回さらに、bootstrap 内の `applicationRuntime` bag は廃止し、viewer command / export / browser bootstrap は `ports` を直接受け取る形へ寄せた。返り値の `runtime` も独立 bag ではなく `ports.viewer` をそのまま返す。

`application-commands` も `shell` port を優先して解決する形へ変えたため、browser callback の個別注入はかなり減った。

残課題は、material / texture / render 系の同期 helper で残っている port 直結化の仕上げだけである。

### 6. 「DOM 解決」と「UI 状態オブジェクト組み立て」を binder に寄せる

この項目は一部実施済み。

今回追加した binder は次の通り。

- `source/ui/panels/light-ui-state.js`
- `source/ui/panels/import-candidates-ui-state.js`
- `source/ui/panels/display-settings-ui-state.js`
- `source/ui/panels/shadow-panel-ui-state.js`
- `source/ui/panels/post-effect-ui-state.js`
- `source/ui/panels/camera-editing-ui-state.js`
- `source/ui/panels/debug-panel-ui-state.js`
- `source/ui/panels/selection-overlay-ui-state.js`

これにより、light / import candidates / display settings / shadow / post effect / camera / debug / selection overlay の DOM 解決は `bind*UiState(document)` 側へ寄り、bootstrap は service / controller への受け渡しに集中し始めている。

これを次のように整理する。

- controller は完成済み `uiState` を受け取る
- `bind*UiState(document)` のような binder が DOM 解決だけを行う
- bootstrap は binder を呼んで controller / service に渡すだけにする

この分離により、HTML 構造変更時の修正点を binder に集約できる。

今回さらに、`openmmd-app.js` の次の初期化は binder + port 経由へ移した。

- selected bone / rigidbody label と grid overlay 入力
- bone thickness 入力
- child / IK / useWorldCoordinate を含む bone inspector 周辺の DOM 集約
- camera editor と depth focus picker の DOM 集約
- debug panel の出力先 DOM 集約

また、selection overlay に属する checkbox / label / grid 入力の DOM 参照は `selection` から外し、`selectionOverlayPort` が plain state と DOM の同期を引き受ける形にした。`selection` は overlay 表示フラグと数値 state だけを保持する。

今回さらに、bone inspector 専用の DOM 参照は `selection-overlay-ui-state` から除去し、bone tab と selection overlay の binder 境界を分離した。

残課題は、display preset sync のような bootstrap 内の小さな UI 同期 helper を controller 側へさらに寄せることである。

### 優先度

保守性改善の観点では、次の順で進めるのが妥当である。

1. Bone Inspector / Child / IK の分離
2. Render / Environment / Shadow / Post Effect の再分割
3. Browser platform adapter の導入
4. callback 再代入の registry / port 化
5. runtime bag の分割
6. DOM binder の共通化

## 追加したい観点

将来の再設計では、次の観点をこの文書に追記するとよい。

- どの層が test double を差し替えやすいか
- どの層が headless 実行に向いているか
- どの層が UI 非依存の自動テスト対象か
- どの層が仕様変更の影響を最も受けやすいか
