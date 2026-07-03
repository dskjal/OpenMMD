# glTF HDR IBL Support

## Summary

test-data/sundowner_deck_1k.hdr を初期値にした設定可能な HDR 環境マップ入力を追加し、gltf-shader.wgsl で roughness 対応の本格 IBL を使えるようにする。
実装は「HDR デコードと GPU アップロード」「環境マップ用 bind group の追加」「glTF 用 WGSL の PBR/IBL 拡張」「検証テスト」の4点で進める。

## Key Changes

- HDR 読み込み基盤
    - source/material-resources.js とは分離した専用 HDR ローダーを追加する。
    - Three.js の RGBELoader を使って .hdr を float データとして読み込み、WebGPU 用 rgba16float か rgba32float テクスチャへアップロードする。
    - 入力は「設定可能パス」にし、既定値を test-data/sundowner_deck_1k.hdr にする。
    - 初期段階では 1 枚の共有環境マップを全 glTF マテリアルで使う。
- 描画パイプライン
    - source/shaders/shaders.wgsl の共通 bind group に環境マップ用 sampler / texture と、IBL パラメータ uniform を追加する。
    - source/model-manager-pipelines.js の pipeline layout を更新し、全 glTF 描画で同じ追加 bind group を使えるようにする。
    - 共有環境マップ bind group は global 側で1回だけ生成し、glTF 描画時に bind する。
    - MMD 用シェーダは新 binding を未使用のまま通す。互換性維持のため、共通レイアウトは全シェーダで一致させる。
- シェーダ実装
    - source/shaders/custom-shaders/gltf-shader.wgsl を簡易 PBR から IBL 対応へ拡張する。
    - diffuse IBL は法線方向ベースの equirectangular サンプルではなく、環境マップからの半球寄与近似を行う。
    - specular IBL は反射ベクトルと roughness を使い、prefiltered mip を参照する設計にする。
    - BRDF は LUT テクスチャ追加までは行わず、Schlick Fresnel + roughness ベースの近似式を WGSL 内で計算する。
    - metallic / roughness / emissive の既存 glTF material uniform は継続利用する。
    - direct light と shadow は残し、最終色を direct + indirectDiffuse + indirectSpecular + emissive で合成する。
    - HDR の高輝度は shader 内で 0..1 clamp しない。既存の後段 HDR/LDR 変換へ流す。
- 状態と設定
    - 既定 HDR パスを renderer 初期化設定として持たせる。
    - 将来差し替え可能な形にするが、今回追加する公開インターフェースは「環境マップパス 1 個」のみとする。
    - 既存 API からこの設定を触れる設計にする場合は、docs/specification/api-specification.md と docs/specification/api-specification-ja.md を更新する。
    - API 追加を行わない場合はドキュメント更新対象外とする。

## Public Interfaces

- 新規 renderer 設定値
    - environmentHdrPath: string
    - 既定値: test-data/sundowner_deck_1k.hdr
- shader 共通インターフェース
    - IBL パラメータ uniform 1 個
- glTF マテリアル構造体の既存フィールドは維持し、material 単位の HDR 設定は追加しない。

## Test Plan

- 単体テスト
    - HDR ローダーが .hdr を読み込み、float テクスチャ作成用データを返すこと。
    - HDR パス未解決時にフォールバック用の黒または無効環境マップを返し、描画初期化が落ちないこと。
    - pipeline layout / bind group 追加後も既存 gltf-shader.wgsl と mmd-shader.wgsl の shader module 生成が通ること。
    - glTF pipeline 作成テストで新 bind group layout を含んでも既存の depth prepass / edge pipeline 条件が維持されること。
- シェーダ検証
    - metallic=0 / roughness=1 の材質で diffuse 環境光が見えること。
    - metallic=1 / roughness 低値の材質で HDR ハイライトが反射として強く出ること。
    - roughness を上げると specular 反射が広がり、mip 選択が変化すること。
    - emissive を持つ材質で環境反射と加算されること。
    - 影ありの direct light と IBL が共存し、shadow が indirect 成分まで不自然に潰さないこと。
- 実データ確認
    - test-data/alicia.glb か test-data/sphere.glb を使い、test-data/sundowner_deck_1k.hdr で視覚確認する。
    - 法線反転や equirectangular の左右反転がないことを確認する。
    - glTF 以外の MMD モデル描画が回帰しないことを確認する。

## Assumptions

- 対象は glTF 既定シェーダ gltf-shader.wgsl のみで、MMD 用の見た目調整は今回対象外。
- HDR 環境マップは共有 1 枚で十分とし、モデル単位の切り替えは実装しない。
- 本格 IBL だが、初回は BRDF LUT 追加までは行わず、WGSL 近似でまとめる。
- 既存レンダーパスは HDR 値を保持できる前提で、gltf-shader.wgsl 内の clamp(..., 0..1) は除去する。
- JSDoc スタイルを維持し、新規 JS モジュールにも JSDoc を付ける。