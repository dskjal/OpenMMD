# Remove glTF Bloom Debug Branching

  ## Summary

  source/shaders/custom-shaders/gltf-shader.wgsl に残っている bloomShadowDebugMode / bloomShadowDebugValue の一時的
  な分岐を削除し、out.mask.b は通常の bloomShadowFactor を固定で出すように戻す。
  これで glTF 側の debug 用表示切り替えをなくし、bloom の表示内容は本来のマスク値に統一する。

  ## Key Changes

  - source/shaders/custom-shaders/gltf-shader.wgsl
      - bloomShadowDebugMode と bloomShadowDebugValue の全分岐を削除する。
      - out.mask.b は clamp(bloomShadowFactor, 0.0, 1.0) を固定で出す。
      - bloomViewNormal / bloomViewLightDir / bloomNdotL は不要なら整理して削除する。

  - source/shaders/custom-shaders/mmd-shader.wgsl
      - 既存どおり bloomShadowFactor をそのまま mask.b に出す。
      - glTF だけにあった debug 特有の挙動をなくして、MMD と同じ思想に揃える。

  - source/renderer.js / source/render-loop.js
      - shadowPowerParams.w を bloom debug mode として流し込んでいる経路を削除する。
      - showBloomShadowDebug が glTF shader の表示切り替えに使われている箇所を外す。

  - index.html
      - Bloom Shadow Debug Mode のうち、glTF shader の debug 表示切り替えに依存している文言や制御があれば整理する。
      - bloom の overlay 表示そのものは残し、shader 内の debug 分岐だけを消す。

  - tests/custom-shader-manager.test.mjs
      - bloomShadowDebugMode / bloomShadowDebugValue を期待する assert を削除し、mask.b が bloomShadowFactor 固定で
        あることを確認する。

  - tests/renderer-helpers.test.mjs
      - shadowPowerParams.w を debug mode に使う前提の assert を削除する。
      - bloom の debug UI が shader の分岐に依存しないことを固定する。

  ## Test Plan

  - node --test tests/custom-shader-manager.test.mjs
  - node --test tests/renderer-helpers.test.mjs
  - node --test tests/post-effect-bloom.test.mjs
  - 必要なら node --test tests/post-effect-ui-markup.test.mjs
  - 手動確認:
      - glTF モデルで bloom を有効化し、mask.b が bloomShadowFactor 固定になっていること
      - bloom の debug overlay が引き続き表示されること
      - debug mode を切り替えなくても通常描画に影響がないこと

  ## Assumptions

  - mask.b の表示内容は bloomShadowFactor に統一する。
  - Show Bloom Shadow 系の UI は残してよいが、glTF shader の debug 分岐には使わない。
  - bloom の overlay / デバッグ表示は別経路で維持するため、今回削除するのは glTF shader 内の debug 用切り替えだけに
    する。