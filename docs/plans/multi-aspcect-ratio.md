  # アスペクト比切り替え対応プラン

  ## Summary

  描画設定タブに Aspect Ratio セレクタを追加し、その選択に応じて Internal Resolution の候補と viewport の CSS アスペクト比を動的に切り替える。縦長比率では現在下部の #shortcut-panel を左側へ移動するレイアウトに変え、index.html の固定 CSS だけでは足りない部分は JS からクラス/カスタムプロパティを切り替えて反映する。解像度プリセットは source/ 配下の新規定義ファイルに集約し、将来の比率追加をデータ追加だけで済む構造にする。

  ## Key Changes

  - 新規 source/render-aspect-presets.js を追加する。
      - JSDoc 付きでアスペクト比定義を 1 箇所に集約する。
      - 各項目は id、表示ラベル、cssAspectRatio、縦長かどうか、既定解像度、解像度候補配列を持つ。
      - 16:9 / 9:16 をデフォルトにし、既定解像度は 1920x1080。
      - 解像度候補はこの定義から UI を生成する。2:1 / 1:2、16:9 / 9:16、3:2 / 2:3、4:3 / 3:4、5:4 / 4:5
      - Rendering FPS の下、Internal Resolution の上に aspect-ratio-selector を追加する。
      - resolution-selector の <option> ハードコードは縮小し、初期描画後に JS でプリセット定義から再構築する前提にpanel を左固定、通常時は現状どおり下配置にする。
      - resizer 周辺はそのまま活かしつつ、縦長時にも左右サイドバーのドラッグリサイズが壊れない前提で CSS を組む。
  - source/renderer-ui.js を拡張する。
      - readRenderUIInitialValues() の返り値に aspectRatio を追加する。
      - 既定値に aspectRatio: '16:9' を追加する。
      - アスペクト比と内部解像度の DOM 値を読む小さなヘルパーを持たせる。
      - 動画書き出し UI のサイズ同期は、従来どおり rendererState.internalResolution を基準にしつつ、auto 時は現在の canvas 実サイズを使う。
  - source/renderer.js で描画状態とイベント配線を拡張する。
      - rendererState に aspectRatio を追加する。
      - 起動時にプリセット定義から aspect-ratio-selector と resolution-selector を初期化する。
      - アスペクト比変更時は:
          - rendererState.aspectRatio を更新
          - 利用可能な内部解像度候補を再生成
          - 現在解像度が候補外ならその比率の既定解像度へ切り替え
          - viewport 用 CSS 変数と body/class を更新
          - rendererState.needsResize = true
      - 内部解像度変更時は現状どおり rendererState.internalResolution を更新して resize を要求する。
      - Auto は残し、選択中アスペクト比の CSS 比率を維持したまま、内部解像度だけ canvas.clientWidth/clientHeight に追従させる。
  - 必要なら index.html のインラインスクリプトからレイアウト責務を切り出して source/viewport-layout.js を新設する。
      - fullscreen 状態とアスペクト比状態を見て body class を同期する。
      - is-portrait-render-layout のようなクラスを一元管理し、index.html 側に散らばる DOM 直接操作を増やしすぎないようにする。
  - source/renderer-resources.js は大きく変えない。
      - internalResolution === 'auto' の既存分岐を維持する。
      - CSS で変わった canvas.clientWidth/clientHeight がそのまま GPU target サイズへ反映される前提で動かす。

  ## Public Interfaces / Types

  - readRenderUIInitialValues() の返り値に aspectRatio: string を追加する。
  - rendererState に aspectRatio: string を追加する。
  - 新規プリセット定義モジュールは、少なくとも以下を export する前提にする。
      - RENDER_ASPECT_PRESETS
      - DEFAULT_RENDER_ASPECT_RATIO
      - findAspectPreset(aspectRatioId)
      - getResolutionOptionsForAspect(aspectRatioId)

  ## Test Plan

  - 描画設定タブ初期表示で 16:9 / 9:16 が選択され、解像度候補がデフォルト群になること。
  - アスペクト比を 2:1、3:2、4:3、5:4、に切り替えると、Internal Resolution 候補がその群へ差し替わること。
  - 縦長比率 1:2、9:16、2:3、3:4、4:5 に切り替えると、ショートカットパネルが下ではなく左に移動すること。
  - 横長比率へ戻すと、ショートカットパネルが現状どおり下配置へ戻ること。
  - Auto 選択中に比率変更しても、canvas の CSS 見た目比率は新しい比率へ変わり、内部解像度は表示領域追従のまま維持されること。
  - 固定解像度選択時は canvas.width/height と GPU target が選択解像度へ更新されること。
  - 動画書き出し UI の width/height 初期値が、固定解像度では選択値、Auto では現在 canvas 実サイズを反映すること。
  - fullscreen 切り替え後もアスペクト比クラス適用とショートカットパネル位置が破綻しないこと。

  ## Assumptions

  - 既存 API ドキュメント更新は不要。
      - 今回は外部公開 API 追加ではなく、ローカル UI 状態とレイアウト制御の変更として扱う。
  - 解像度データの追加容易性を優先し、index.html に option 群を増やし続ける構成にはしない。

## 解像度リスト

- 2:1, 1:2
  - 1440 x 720
  - 2160 × 1080
  - 2880 × 1440
  - 4000 × 2040
  - 5120 × 2560
- 16:9, 9:16 （デフォルト）
  - 960 x 540
  - 1280 x 720
  - 1920 x 1080
  - 2560 x 1440
  - 3840 x 2160
  - 5760 x 3240 
- 3:2, 2:3
  - 960 x 640
  - 1440 x 960
  - 1920 x 1280
  - 3840 x 2560
  - 4800 x 3200
- 4:3, 3:4
  - 800 x 600
  - 1024 x 768
  - 1600 x 1200
  - 2048 x 1536
  - 4096 x 3072
  - 4800 x 3600
- 5:4, 4:5
  - 1280 x 1024
  - 2560 x 2048
  - 3840 x 3072
  - 5120 x 4096