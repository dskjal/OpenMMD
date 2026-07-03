# Rendering Tab: View Transform / Display

## Summary

- Rendering Settings に color management 用の 2 セレクトを追加する。
- View Transform: Standard / ACES 2.0、既定は Standard
- Display: sRGB / Display P3、既定は sRGB
- Standard + sRGB は現在の見た目を維持する。
- ACES 2.0 は Blender 基準の互換性を優先し、近似式ではなく precomputed LUT で実装する。

## Key Changes

- UI / state
    - index.html の tab-render に新しい Color Management セクションを追加する。
    - source/renderer-ui.js の DEFAULT_RENDER_UI_VALUES と readRenderUIInitialValues() に viewTransform と displayColorSpace を追加する。
    - source/renderer.js の rendererState に同設定を保持し、render tab の change event を配線する。
    - i18n は source/langs/en.json / source/langs/ja.json に追加する。
    - 英語ラベルは typo ではなく Display を採用する。
- Canvas / runtime
    - GPUCanvasContext.configure() に colorSpace を渡す。
    - displayColorSpace === 'display-p3' のときは colorSpace: 'display-p3'、それ以外は srgb。
    - display-p3 の再 configure が失敗した場合は srgb にフォールバックし、state と select を戻して console.warn を出す。
    - 動画書き出しや resize 後も同じ display 設定で再 configure される前提にそろえる。
- Final composite
    - 既存の最終 1 パス構造は維持し、gamma パスを実質的な display transform パスへ拡張する。
    - source/renderer-gpu.js の createGammaResources() と source/shaders/post-effect/gamma.wgsl に viewTransform / displayColorSpace / LUT binding を追加する。
    - 適用順は固定する。
        1. chromatic aberration を scene-linear でサンプル
        2. color temperature を scene-linear で乗算
        3. Standard: linear sRGB から選択 display の linear へ変換し、display transfer を適用。tone map はしない
        4. ACES 2.0: 選択 display 向け LUT を適用
        5. 既存 gamma slider は display-referred の追加調整として最後段で適用
        6. film grain を最後に適用
    - これで Standard は現行挙動互換、ACES 2.0 は Blender 互換寄り、既存 post effect UI も壊さない。
- LUT resources
        - ACES 2.0 -> sRGB
        - ACES 2.0 -> Display P3
    - 公開 API は増やさない。api-state / bridge snapshot も今回は変更しない。

## Public Interfaces

- 追加 UI state
    - rendererState.viewTransform: 'standard' | 'aces-2.0'
    - rendererState.displayColorSpace: 'srgb' | 'display-p3'
- 外部 API / message schema / docs API specification は変更しない。

## Test Plan

- tests/renderer-gpu.test.mjs
    - display transform uniform の初期化
    - ACES LUT resource の bind group / cache / lazy load 分岐
- 新規 pure test
    - Standard の display conversion helper が sRGB / Display P3 を正しく正規化すること
    - display-p3 非対応時の fallback 分岐
- 回帰確認
    - Standard + sRGB で既存見た目が変わらないこと
    - ACES 2.0 + sRGB / ACES 2.0 + Display P3 で最終パスが成立すること
    - bloom / DOF / FXAA / UI overlay / video export の後段でも最終 composite が壊れないこと

## Assumptions

- Blender 互換は「browser 内で live OCIO を回す」のではなく、「Blender standard OCIO config を基準に offline 生成した LUT で再現する」方針に固定する。
- 現在の working space は変更しない。内部 shading は現状どおりの linear sRGB 系のままにする。
- Display P3 は WebGPU canvas の colorSpace 切替で扱う。
- 参考:
    - Blender Displays and Views: https://docs.blender.org/manual/en/dev/render/color_management/displays_views.html
    - Blender OpenColorIO: https://docs.blender.org/manual/en/5.0/render/color_management/opencolorio.html
    - MDN GPUCanvasContext.configure(): https://developer.mozilla.org/en-US/docs/Web/API/GPUCanvasContext/configure
    - OpenColorIO ACES 2.0 optimization notes: https://github.com/AcademySoftwareFoundation/OpenColorIO/wiki/ACES-2.0-optimization