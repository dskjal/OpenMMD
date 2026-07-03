# Overlay Refactor To ui-overlay

## Summary

現状レビューの結論:

- GPU overlay は source/model-debug-draw.js、source/model-manager.js、source/model-manager-pipelines.js に責務が
分散している。
- ボーン表示、IK/カスタムリグのインジケーター、ギズモ、物理ワイヤーフレームが同じ overlay pipeline を共有してい
る。
- 描画順は mainPass 内でモデル本体と一緒に overlay を描いた後に post effect へ入っており、overlay が FXAA /
gamma / bloom / DoF の対象になっている。
- 将来の床グリッド追加を考えると、overlay の追加単位と描画順の拡張点が不足している。

このため、GPU overlay 群を ui-overlay サブシステムに集約し、post effect 完了後に最終出力へ重ねる構成へ変更する。
対象は GPU overlay のみとし、camera-range-zoom-overlay や動画書き出し overlay など DOM overlay は今回の整理対象
外とする。物理ワイヤーフレームは同じ描画経路を共有しているため ui-overlay に含める。

## Key Changes

### 1. ui-overlay へ責務集約

- 新規 source/ui-overlay.js を導入し、以下を集約する。
- overlay の draw 呼び出し
- 将来の overlay 拡張点管理
- source/model-debug-draw.js の責務は ui-overlay へ移す。
- source/gizmo.js は gizmo の状態・頂点生成・ピック/ドラッグ計算に集中させ、描画 orchestration は持たせない。
- モデルごとの overlay バッファは scene 直下のバラ置きではなく、scene.uiOverlay のような専用コンテナへまとめる。

### 2. 描画順の変更

- render-loop では mainPass から overlay 描画を外し、モデル本体と G-buffer / depth / normal だけを描画する。
- post effect chain、gamma-only path、FXAA を完了した後、最終出力先テクスチャへ uiOverlay.draw(...) を別 render
pass で実行する。
- これによりボーン表示、ギズモ、物理ワイヤーフレームは post effect の影響を受けず、常に最終画として重ね描きされ
る。

### 3. ModelManager と pipeline の整理

- ModelManager.drawInstance() から overlay draw を除去し、モデル本体描画だけに責務を絞る。
- overlay pipeline は model-manager-pipelines 管轄から外し、ui-overlay 側で所有する。
- refreshScene() / モデル更新フェーズでは ui-overlay 更新 API を呼び、各 instance の overlay バッファ更新を集中
管理する。
- renderer-interaction が使う getBoneDebugLists / getCustomRigCircleTargets は ui-overlay から提供するように寄せ
る。必要なら互換 export を短期的に残す。

### 4. 将来の床グリッド追加を見据えた構造

- ui-overlay は overlay 項目ごとに builder / visibility / draw order を持てる構造にする。
- 既存 4 種類を layer 扱いに揃える。
- bone lines
- indicators
- gizmo
- physics wireframe
- 各 layer は今は always-on-top 前提でよいが、将来の床グリッド向けに depthMode を持てる設計にする。
- 今回は床グリッド自体は実装しない。追加しやすい拡張点だけを確定する。

### 5. ドキュメント更新

- AGENTS.md の「ファイル」欄を更新する。
- source/model-debug-draw.js の説明を削除または ui-overlay へ置換する。
- source/ui-overlay.js を追加し、ボーン表示・ギズモ・物理ワイヤーフレーム・将来の床グリッドの GPU overlay 統括と
明記する。
- source/model-manager.js の説明は「モデル描画の統括」に寄せ、overlay 統括の記述を外す。
- source/render-loop.js の説明は「ポストエフェクト後に UI overlay を最終合成する」点を反映する。
- 外部 API 追加がなければ docs/specification/api-specification.md は更新しない。
- もし ui-overlay を renderer 全体の公開 API として露出させる設計に変えるなら、その時点で更新対象に含める。

## Test Plan

- 既存の gizmo テストは維持し、render 依存を増やさないことを確認する。
- getBoneDebugLists / getCustomRigCircleTargets の既存テストは ui-overlay 側へ移設または import 先を更新する。
- overlay buffer 更新の単体テストを追加する。
- ボーン表示オン/オフ
- IK 非表示オン/オフ
- アクティブモデル時のみ gizmo 更新
- 物理表示オン/オフ
- render-loop の描画順テストを追加する。
- modelManager.draw() が main scene pass だけを描くこと
- post effect 完了後に uiOverlay.draw() が呼ばれること
- FXAA 有効時でも overlay が最後に描かれること
- post effect 無効時でも overlay が scene pass 直後ではなく final present 側で描かれること
- 回帰確認項目:
- ボーン表示の見た目が現状と変わらない
- ギズモの選択とドラッグが維持される
- custom rig circle のピックが維持される
- 物理ワイヤーフレーム表示が維持される

## Assumptions

- ui-overlay の対象は GPU overlay のみで、DOM overlay は対象外。
- 物理ワイヤーフレームは ui-overlay に含める。
- 今回はリファクタリングと描画順変更が目的で、床グリッド自体は未実装。
- overlay は現行挙動を優先し、既存要素は post effect 後でも基本的に常時前面表示のままとする。
- source/model-debug-draw.js は最終的に削除または薄い互換ラッパーへ縮退させ、実体は source/ui-overlay.js に集約
する。