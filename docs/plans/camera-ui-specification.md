 # カメラショートカット追加

  ## Summary

  - ショートカットパネルに camera 用の縦積みセクションを追加し、FOV を即時に viewport カメラへ反映する。
  - model / bone の select で look-at 対象を選び、選択中ボーンの world position を追従するカメラにする。
  - FOV 行と bone 行の右端にキーアイコンを置き、どちらも現在フレームの VMD camera keyframe を upsert する。

  ## Implementation Changes

  - camera state に fovY を追加し、UI は度数で表示・入力、内部ではラジアンで保持する。
  - createViewProjection は固定 45° をやめ、camera.fovY を使うようにする。
  - camera follow は camera.center を対象ボーンの world position に毎フレーム同期する方式にする。対象は
    modelManager.instances から選ぶ別系統の camera UI state として持つ。
  - model select を変更したら、そのモデルの model.bones を bone select に再構築する。直前の bone 名が残っていれば
    維持し、なければ先頭骨を選ぶ。
  - bone 選択の変更で look-at 対象を即時切り替える。対象が無効になった場合は追従を解除する。
  - camera keyframe 登録は共通の upsert 処理にまとめ、distance / target / rotation / fov / perspective /
    interpolation を現在フレームへ保存する。
  - rotation は既存の camera orbit 規約に合わせて現在の viewport camera から変換する。target は追従中なら選択ボー
    ンの world position、非追従なら現在の camera.center を使う。
  - FOV のキーアイコンと bone のキーアイコンは同じ camera keyframe 登録処理を呼ぶ。入力値が float でも、保存時は
    rounded integer にする。
  - VMDWriter で camera fov を Math.round してから uint32 として書き出す。これを最終防御線にする。
  - camera 追従とキー登録の状態更新は refreshScene() に載せ、毎フレームの再描画でも追従が維持されるようにする。
  - UI 文言は ja/en に追加し、camera セクションは 3 行を縦に積むレイアウトにする。

  ## Test Plan

  - createCameraState に fovY が入ること、createViewProjection が可変 FOV を使うことをユニットテストで確認する。
  - camera keyframe upsert のテストで、選択ボーンの world position が target になること、同一フレームは更新扱いに
    なることを確認する。
  - VMDWriter のテストで、fov: 44.5 が書き出し時に 45 へ丸められることを確認する。
  - 手動確認として、複数モデルを読み込み、camera UI で model/bone を切り替えたときに viewport が追従し、キーアイコ
    ンで保存した VMD に camera keyframe が入ることを確認する。

  ## Assumptions

  - FOV UI は degrees 表示、内部の camera state は radians で扱う。
  - キーアイコンは「現在フレームに対する camera keyframe の upsert」であり、camera playback 機能そのものは今回の対
    象外にする。
  - camera follow は「指定ボーンを見続ける」挙動で、オフセット付きの自由追従は入れない。