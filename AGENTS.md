# OpenMMD Workspace Rules

## 作業ルール

- ソースコードは JSDoc スタイルで書く。
- この workspace で `pwsh` を起動する場合は、初回から `sandbox_permissions=require_escalated` を付ける。
- `Get-ChildItem` や `git status --short` などのコマンドは直接実行する。
- `pwsh -Command ""` は直接実行が失敗した場合だけ使う。
- `Select-Object` で一部を読む場合は、まず `-Skip` / `-First` を試し、失敗したら `-Index` を使う。
- `docs/plans/` は古いので参考程度にする。ユーザーが明示したときだけ信用する。
- `source/` を変更したら `tests/` をすべて実行し、失敗したテストを報告する。
- テストは `node --test .\tests\*.test.mjs` で実行する。
- 変更は `apply_patch` を使う。

## 参照先

- ファイルフォーマットの仕様は `docs/` にある。
- UI コンポーネントの仕様は `docs/specification/ui-components-specification.md` を参照する。
- API を追加したら `docs/specification/api-specification.md` と `docs/specification/api-specification-ja.md` も更新する。
- VRM-1.0 の仕様は `docs/vrm-1.0/` にある。
- VRM の重要情報は `docs/important-vrm-info.md` にある。
- 全体像は `docs/openmmd-architecture.md`、詳細仕様は `docs/openmmd-specification.md` と `docs/specification/openmmd-internal-model-animation-format.md` を参照する。

## ドメイン前提

- `source/defaults/defaults.json` が優先で、`index.html` は UI 初期値の補助として扱う。
- MMD / VRM / OpenMMD の座標系、handedness 変換、内部単位は仕様書を優先する。
- Physics の剛体・ジョイントの Euler 回転は `YXZ` 順で扱う。
- `model.materials` を変更したら `morphController.materialStates` も同時に更新し、必要なら `morphController.dirty = true` を立てる。
- Model JSON の UI 要素を追加したら、ローダー・ライター・`test-data/model.json` を同時に更新する。
- WGSL の三項演算子は `select` を使う。
