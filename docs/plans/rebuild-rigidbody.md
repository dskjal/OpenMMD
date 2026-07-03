# resetModel 維持 + rebuildModel 追加による剛体再構築

## 概要

- source/physics.js の resetModel は現行挙動を維持し、JSDoc コメントで「何を戻す関数か」を明確化する。
- コリジョン解決まで含む新しい再構築処理を rebuildModel として追加し、剛体がコリジョン内に突入したケースでも復帰
できる経路を分離する。
- UI の「Reset Rigidboy」表記を「Rebuild Rigidbody」に変更し、そのボタンから rebuildModel 系の処理を呼ぶように切
り替える。

## 変更内容

- source/physics.js
    - resetModel のコードは基本そのままにし、JSDoc で次を明記する。
        - 現在のシーン姿勢へ剛体を同期する関数であること
        - 線形/角速度、補間変換、力、AABB を更新すること
        - 貫通解消や衝突の押し戻しは行わないこと
    - 新規に rebuildModel(entry) を追加し、resetModel の同期結果を起点に Bullet 側の衝突解決を実行する。
    - 衝突解決後に必要な broadphase / contact / activation 系の再同期も、Ammo の公開 API がある範囲で実施する。
    - 既存の reset() は維持し、全モデルに対する一括処理が必要なら rebuild() 相当のラッパーを追加して
    rebuildModel を回す。
- index.html
    - ボタン表示を Rebuild Rigidbody に変更する。
    - クリックハンドラを resetPhysics ではなく rebuildModel 系の処理へ差し替える。
    - 既存の reset-rigidbody 要素 ID は残してよいが、表示文言と実処理は新挙動に合わせる。
- source/langs/en.json / source/langs/ja.json
    - Reset Rigidbody の文言を Rebuild Rigidbody に更新する。
    - 日本語は Rebuild Rigidbody 相当の自然な訳に合わせる。
- source/api-bridge.js
    - 既存の reset-physics 経路があるため、外部 API 名は変えずに内部処理だけ新しい rebuild 系へ寄せる。
    - これにより UI と API 経路の挙動差をなくす。

## テスト

- tests/animation-loop-physics.test.mjs
    - resetModel の既存テストは維持し、コメント追加後も挙動が変わっていないことを確認する。
    - rebuildModel の新規テストを追加し、次を検証する。
        - 既に貫通している剛体が再構築で押し戻されること
        - resetModel 相当の初期化だけでなく、衝突解決処理が呼ばれること
        - 再構築直後に大きな速度スパイクが残らないこと
- UI 接続の回帰確認
    - Rebuild Rigidbody ボタンが新関数を呼ぶことを確認する。
    - 既存の Reset Rigidbody 文言参照が残らないことを確認する。

## 前提

- resetModel は「同期のみ」の低レベル関数として残し、貫通解消は rebuildModel に分離する。
- rebuildModel はハードリセット系の処理であり、運動量の保持はしない。
- 既存の外部 API 名は維持し、必要なら内部実装だけを新しい再構築処理へ差し替える。
- 追加コメントは JSDoc スタイルで記述する。