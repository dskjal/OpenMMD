# Local Express Control Bridge for OpenMMD

## Summary

index.html を操作するためのローカル Express サーバーを追加し、同一オリジン上でビューと API を提供します。ブラウ
ザ側は window.postMessage を受けるブリッジを持ち、外部のコントローラページまたは API クライアントから OpenMMD を
遠隔操作できるようにします。

## Implementation

- package.json に express ベースの起動スクリプトを追加し、ローカル開発は node でサーバーを立ち上げる形に寄せま
す。
- Express は index.html と静的アセットを配信し、/api/* を制御用エンドポイントとして公開します。
- index.html 側に message イベントの受信口を追加し、受け取ったコマンドを既存の公開 API に橋渡しします。
- source/renderer.js で既に公開済みの window.loadZipModel、window.loadVmd、window.modelManager、
window.physicsEngine を優先的に使い、追加の大きな内部 API は作らずに済ませます。
- コマンドは最初は小さく固定し、load-model、load-vmd、play/pause、step、seek、fullscreen、reset-physics などの主
要操作に絞ります。
- 必要ならコントローラ用の簡易ページを同一サーバーで用意し、postMessage でビューウィンドウへ命令を送れるようにし
ます。

## Test Plan

- サーバー起動後に index.html が通常表示できることを確認する。
- postMessage で主要コマンドを送って、モデル読込・VMD 読込・再生制御・全画面切り替えが動くことを確認する。
- 不正コマンドや未知の type を送ったときに、無視またはエラー応答になることを確認する。
- 既存の手動操作やドラッグ&ドロップが壊れていないことを確認する。

## Assumptions

- 配信は npx serve . から Express ベースのローカルサーバーへ置き換える前提です。
- 操作対象はまず「主要操作のみ」で開始します。
- 既存の window.loadZipModel / window.loadVmd を再利用するため、内部リファクタリングは最小限に抑えます。
- 仕様メモは /D:/data/program/openmmd/plan.md の「ローカルの場合、Node.js で API サーバーを動作させて、
window.postMessage で通信」に沿って進めます。