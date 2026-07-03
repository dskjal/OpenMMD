コンタクトシャドウのポリゴン感が強かった原因は深度から再構成した法線を使ったことが原因。モデル法線を使うことでこの問題は解消された。

1. 法線がフラットになっている

コンタクトシャドウの計算に 頂点法線 / 法線マップ / GBuffer normal を使っている場合、法線が面単位だと影も三角形単位で変化します。

対策：

// フラットな face normal ではなく、補間された normal を使う
> vec3 N = normalize(vNormal);

モデル側でも、

- Smooth Shading を有効にする
- 頂点法線を正しく出力する
- 法線マップを使う場合は TBN が正しいか確認する
- flat 修飾子を使っていないか確認する

を確認してください。

2. コンタクトシャドウを頂点シェーダで計算している

影の濃さを頂点ごとに計算してフラグメントへ補間していると、三角形の形が出ます。

悪い例：

// vertex shader 側で shadow を計算
> vContactShadow = calcContactShadow(...);

対策は、フラグメントシェーダでピクセルごとに計算することです。

// fragment shader
> float contactShadow = calcContactShadow(worldPos, normal, lightDir);

3. 深度や位置の復元精度が低い

Screen Space Contact Shadow の場合、深度バッファからワールド位置やビュー空間位置を復元します。

この精度が低いと、三角形の境界や面の傾きが影に出やすいです。

対策：

- depth buffer を 24bit / 32bit にする
- linear depth を使う
- near / far の範囲を詰める
- view-space position を GBuffer に持つ
- depth の比較に適切な bias を入れる

例：

```
float bias = 0.002;
if (sampleDepth < rayDepth - bias) {
    shadow += 1.0;
}
```

bias が小さすぎるとポリゴン境界が出やすく、
大きすぎると影が浮きます。