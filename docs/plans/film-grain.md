# Film Grain 追加計画

## Summary

- Post Effects タブに film grain を追加し、ノイズ量 と ノイズ変動モード を設定できるようにする。
- 既定値は filmGrainAmount = 0.0、filmGrainAnimationMode = 'timeline' とする。
- film grain は postEffects.enabled と独立に動作させる。ノイズ量 > 0 なら master off でも有効。
- ノイズ更新は always では毎フレーム変化、timeline では currentFrame が変わるときだけ変化させる。これにより再
## Key Changes

- 状態と UI
    - source/post-effect-planner.js の既定値に filmGrainAmount と filmGrainAnimationMode を追加する。
    - source/renderer-ui.js の DEFAULT_POST_EFFECT_UI_VALUES、readPostEffectUIInitialValues()、
    setupPostEffectUI() に同フィールドを追加する。
    - index.html の tab-post-effect に Film Grain セクションを追加する。
    - UI は以下で固定する。
        - film-grain-amount の range + number
        - film-grain-animation-mode の radio 2 個
        - 値は 'always' / 'timeline'
    - source/langs/en.json と source/langs/ja.json に Film Grain、Noise Amount、Always Animate、Animate While
    Timeline Moves 相当の文言を追加する。
- planner と最終合成経路
    - buildPostEffectPlan() に filmGrainActive = filmGrainAmount > EPSILON を追加する。
    - FXAA 無効時に film grain が有効なら、既存の gammaOnly 最終 pass を使って最終合成を強制する。
    - 変数名は既存互換のため useGammaOnly を維持してよいが、役割は「最終合成 pass が必要か」に広げる。
    - film grain 単独有効時でも needsSceneResolve = true にする。
    - Chromatic Aberration あり・FXAA なしでは、色収差の後段で既存 gamma pass により film grain を最終適用する。
    - FXAA ありでは専用 pass を増やさず、fs_fxaa 内で最終適用する。
- GPU / shader
    - source/renderer-gpu.js の gammaSettingsBuffer を拡張し、最低限以下を持たせる。
        - filmGrainAmount
        - filmGrainSeed
    - source/renderer.js の syncPostEffectParametersFromState() と source/render-loop.js の毎フレーム更新で、
    gamma/fxaa 共用 uniform に film grain 値と seed を詰める。
    - seed 生成ルールは以下で固定する。
        - always: requestAnimationFrame の時刻か内部 frame counter 由来
        - timeline: アクティブ instance の animationController.currentFrame 由来
        - instance 不在時は 0
    - source/shaders/post-effect/gamma.wgsl と source/shaders/post-effect/fxaa.wgsl に同じ grain 関数を追加す
    る。
    - grain は最終表示にだけ乗せる。bloom.wgsl や dof.wgsl には入れない。
    - 実装は UV と seed から deterministic な疑似乱数を作り、color += centeredNoise * filmGrainAmount の形で適用
    する。出力は 0..1 に clamp する。
- ドキュメント
    - docs/post-effect-specification.md に Film Grain を追加する。
    - UI 配置、状態オブジェクト、planner の有効化条件、最終合成経路、手動確認項目を更新する。
    - ローカル API 仕様は今回の変更範囲外。source/api-state.js は postEffects を外部公開していないため、docs/
    specification/api-specification*.md は更新しない。

## Test Plan

- tests/post-effect-planner.test.mjs
    - film grain 単独有効時に useGammaOnly 相当の最終 pass が有効になること
    - film grain + FXAA で追加 pass は増えず、needsSceneResolve が有効になること
    - film grain + chromatic aberration で最終色 source が崩れないこと
    - 中立値 filmGrainAmount = 0 では既存プランが変わらないこと
- 手動確認
    - ノイズ量 = 0 で見た目が完全に現状一致
    - ノイズ量 > 0、always で停止中も毎フレーム変化
    - ノイズ量 > 0、timeline で停止中は固定、再生・スクラブ・動画書き出しでは変化
    - FXAA on/off、Chromatic Aberration on/off、postEffects.enabled on/off の各組み合わせで適用位置が破綻しない
    - Bloom/DoF 併用時に grain が blur されず最終画に乗る

## Assumptions

- フィールド名は filmGrainAmount と filmGrainAnimationMode を採用する。
- animation mode の列挙値は 'always' | 'timeline' とする。
- timeline の意味は「再生中だけ」ではなく「currentFrame が変わる間だけ」で固定する。これはスクラブと動画 export
を自然に含めるため。
- 既存 gammaOnly pass 名はそのまま使い、内部的に最終合成 pass として拡張する。大きな pass 名変更や全面リファクタ
は今回の範囲に含めない。