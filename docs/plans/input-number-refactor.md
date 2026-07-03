# Numeric Input Blur Sanitization

  ## Summary

  input 編集中は raw 値を保持する現在の挙動は維持し、blur でフォーカスが外れた瞬間に sanitize して canonical 表示
  へ戻す。
  これにより、範囲外の数値を入力したままフォーカスを失ったときに、input に範囲外値が残らないようにする。

  ## Implementation Changes

  - 共通 numeric input helper の blur ハンドラを修正する。
      - blur 時は現在の文字列を再 parse して sanitize する
      - 範囲外なら clamp 済み値を input に書き戻す
      - parse 不能なら fallback もしくは直前の state 値へ戻す
  - 既存の input 中の挙動は維持する。
      - 入力中は表示値を書き戻さない
      - 内部 state は有効な数値として parse できた時点で即時更新する
  - range + number のペアは、blur 時に両方を canonical 値へ揃える。
  - renderer-ui.js / renderer.js / bgm-manager.js / color-picker-ui.js は共通 helper の blur commit に乗るので、個
    別実装の重複は増やさない。

  ## Test Plan

  - 新規または既存の helper テストで以下を確認する。
      - 1.5 のような範囲外値を number input に入力したあと blur すると、max に clamp されて input に戻る
      - 0. のような途中入力は input 中は維持され、blur で canonical 値へ戻る
      - parse 不能値は blur で fallback に戻る
  - 既存の post-effect / BGM / color picker のテストは、blur 後に表示が正規化されることを追加確認する。

  ## Assumptions

  - 対象は UI の数値 input に限定し、API payload や loader の数値変換は変更しない。
  - change と blur の両方で commit してよいが、今回の必須要件は blur での sanitize 書き戻し。
  - 範囲外値の表示を残す意図はないため、blur 後は canonical 表示に統一する。


# Numeric Input Editing Refactor

## Summary

UI の数値入力を「編集中の表示文字列」と「内部で使うサニタイズ済み数値」に分離する。
入力中は毎回 parse/sanitize して内部 state には即時反映するが、<input> の value は編集中に書き戻さない。
change または blur で確定した時だけ、無効値や範囲外値をサニタイズ済み表示へ正規化する。

## Key Changes

- source/ に共通の内部ヘルパーを新設する。
    - 仮名: source/ui-number-input.js
    - 役割:
        - 文字列 input を parse する
        - sanitize(number) で clamp / round / integer 化を行う
        - 入力途中の不完全値を許容する
            - 例: '', '-', '.', '0.', '-0.'
        - 不完全値のときは state 更新をスキップし、input 表示も変更しない
        - 有効数値になったら onInputValue(sanitized) を即時実行
        - blur/change/Enter の確定時にだけ format(sanitized) を input に書き戻す
        - range と number のペア同期を扱う
            - range 側操作時は peer number に即時反映してよい
            - number 側編集中は peer range のみ更新し、編集中の number 自身は上書きしない
        - 外部 state から UI へ再同期する syncDisplay(value, { force }) を返す
            - 対象 input が編集中なら force !== true の限り上書きしない
- 共通ヘルパーの公開インターフェースは次で固定する。
    - bindNumericInput(options)
        - input: 対象 HTMLInputElement
        - peerInput?: range/number の相方
        - parse?: 既定は Number.parseFloat
        - fallbackValue: parse 不能時の確定用既定値
        - isIntermediateText?: 既定の途中入力判定を必要なら上書き
        - onInputValue?: 有効数値入力時の即時反映
        - onCommitValue?: 確定時の反映が別処理なら使用
        - onInvalidCommit?: 無効入力確定時の処理が必要なら使用
    - bindLinkedNumericInputs(options)
        - rangeInput?
        - valueInput?
        - sanitize
        - format
        - fallbackValue
        - onValueChanged
        - disableSyncWhileEditing: 既定 true
    - syncNumericInputValue(input, value, options)
        - 外部 state からの通常再描画用
        - フォーカス中は上書きしない
    - commitNumericInputValue(binding)
        - テストや明示確定用
- 既存 UI を上記ヘルパーへ寄せる。
    - source/renderer-ui.js
        - setupPostEffectUI
        - setupGridOverlayUI
        - setupVideoExportUI の width/height
        - playback range
    - source/renderer.js
        - light position / rotation
        - camera position / rotation / target / fov
        - environment HDR intensity
        - shadow / AO / contact shadow / edge opacity / child influence などの数値 UI
    - source/bgm-manager.js
        - volume の range + number
    - source/color-picker-ui.js
        - RGB / HSV / alpha / strength の数値入力
- 既存の重複実装は削除または縮小する。
    - parseClampedValue
    - syncLinkedInputs
    - syncShadowValuePair
    - syncContactShadowValuePair
    - 各所の input ハンドラ内の parseFloat + clamp + value 再代入
- 表示同期ルールを統一する。
    - state 変更起点が UI 以外のとき:
        - フォーカス中でなければ表示更新
        - フォーカス中なら編集中 input は保持、相方や他 UI は更新可
    - UI 確定時:
        - 有効数値なら sanitize 後の canonical 表示へ揃える
        - 無効文字列なら fallback/state 現在値へ戻す

## Test Plan

- tests/post-effect-ui.test.mjs
    - number input に 0. を入力して input 発火時、state は 0 または sanitize 値へ更新されても、number input 表示
    は 0. のまま
    - 0.1 完成まで入力できる
    - 範囲外値を入力中は表示維持、change で clamp 済み表示へ戻る
    - range 操作時は paired number が同期される
- tests/bgm-manager.test.mjs
    - volume number に 0. 入力中、表示維持・内部 volume は更新可能
    - blur/change で canonical 表示へ正規化
- tests/color-picker-ui.test.mjs
    - strength / RGB / HSV / alpha の number input が途中入力を保持する
    - 範囲外確定時に clamp 表示へ戻る
- 新規 tests/ui-number-input.test.mjs
    - 途中入力判定
    - 即時 sanitize と commit 時書き戻しの分離
    - peer 同期
    - focus 中の外部 sync 抑止
    - invalid commit 時 fallback 復元
- 必要なら tests/renderer-helpers.test.mjs か新規 UI helper test で camera/light 用の単独 number binding も追加
する

## Assumptions

- 対象は viewer 本体の UI 数値入力であり、API payload や loader の数値 coercion は対象外。
- input 中の内部利用は「有効数値に parse できた時だけ」更新する。'-' や '0.' のような途中文字列は state を壊さず
表示だけ保持する。
- 確定イベントは change と blur の両方を扱い、Enter は必要なら blur 相当として処理する。
- 表示フォーマットは各 UI 既存仕様を維持する。toFixed 桁数や整数表示は各 call site から format で渡す。
- 外部向け API は増やさないため、docs/specification/api-specification*.md の更新は不要。