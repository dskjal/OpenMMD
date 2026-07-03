# Material Tab PBR Controls

## Summary

Material タブに metallic、roughness、emissive、emissive strength を追加し、複数選択対応のまま編集可能にする。
UI は全材質で表示するが、値が揃っていない複数選択時は Mixed 状態を表示し、ユーザーが値を入力した時点で選択中の全

## Key Changes

- UI
    - Material タブに以下を追加する。
    - metallic: 0..1、スライダー + 数値入力、step は既存 UI と揃えて 0.01 か 0.001 のどちらかに統一して実装。
    - roughness: 0..1、スライダー + 数値入力。
    - emissive: 既存 color-picker-ui を再利用した色入力。
    - emissive strength: 0 以上、数値入力のみ。
    - 既存の複数選択集約ロジックに、数値用・色用の集約関数を追加する。
    - mixed 時は数値欄を空欄または Mixed プレースホルダ、色は専用 mixed 表示にして、入力確定で全選択へ反映する。
    - UI 文言とラベルを ja/en の i18n に追加する。
- Material state / data flow
    - glTF ローダーの材質データに emissiveStrength を追加する。
    - 既存の metalic という内部キーは互換維持のためそのまま使う。今回の変更でリネームはしない。
    - デフォルト値を統一する。
    - metallic: 0
    - roughness: 0.5
    - emissive: [0, 0, 0]
    - emissiveStrength: 0
    - material-resources と ModelManager.writeMaterialBuffer() の両方で同じ既定値を使うように揃える。
    - 現状 roughness の一部フォールバックが 1.0 になっているため、今回 0.5 に修正して経路差をなくす。
    - Material タブでの編集は model.materials[index] に反映し、必要な材質バッファ更新を即時実行する。
- Shader / buffer layout
    - 共通 material uniform/storage レイアウトに emissiveStrength を追加する。
    - source/shaders/shaders.wgsl の Material struct と、それに対応する CPU 側 Float32Array の詰め位置を更新す
    る。
    - gltf-shader.wgsl では let emissiveTerm = material.emissive * material.emissiveStrength; を使い、既存の
    finalColor += emissive; を置き換える。
    - 他シェーダはレイアウト追従のみ行い、挙動は変えない。
    - docs/custom-shader.md の material struct 説明も更新し、emissiveStrength を追記する。

## Public Interfaces / Types

- 材質オブジェクトに内部プロパティ emissiveStrength: number を追加する。
- シェーダ material レイアウトに emissiveStrength: f32 を追加する。
- 外部 API 追加はないため docs/specification/api-specification*.md は更新対象外とする。

## Test Plan

- glTF ローダーテスト
    - glTF 材質の既定値が metallic=0、roughness=0.5、emissive=[0,0,0]、emissiveStrength=0 になること。
    - emissiveIntensity を持つ glTF を読んだとき、emissive と emissiveStrength の分離方針どおりに値が入ること。
- material buffer テスト
    - createMaterialResources が新レイアウトへ正しい値を書き込むこと。
    - ModelManager.writeMaterialBuffer() が state 値優先、未設定時はモデル既定値へフォールバックすること。
    - roughness 未設定時のフォールバックが 0.5 で統一されていること。
- UI ロジックテスト
    - 単一選択時に各入力へ材質値が反映されること。
    - 複数選択で値不一致時に mixed になること。
    - mixed 状態から値を入力すると、選択中全材質へ同値適用され、バッファ更新が呼ばれること。
- shader 影響確認
    - emissiveStrength=0 で発光が乗らないこと。
    - emissive=[r,g,b]、emissiveStrength=s で発光項が [r*s,g*s,b*s] になること。
    - 既存の MMD 系シェーダがレイアウト変更後も壊れないこと。

## Assumptions

- UI は全材質で表示するが、実質的に意味があるのは gltf-shader.wgsl と custom shader 側の参照時のみとする。
- 複数選択時の編集 UX は checkbox/select と同じく集約表示を維持し、数値・色は mixed 表示で統一する。
- emissive は色そのもの、emissiveStrength は倍率として別保持する。既存の「色に intensity を焼き込む」表現には戻
さない。
- 既存の内部名 metalic は今回据え置く。別タスクでの typo 修正はスコープ外。