# シェーダビルダーは必要か？

結論として、現時点では「on/off のたびに動的にシェーダ文字列を生成するシェーダビルダー」は不要です。先に入れるべきなのは、render-loop の分岐を「パス計画」に置き換える薄い post effect pass planner です。

理由は3点です。

1. 今の仕様は「効果ごとに独立パスへ分けやすい」
    docs/post-effect-specification.md では、bloom、dof、最終 composite のように段階を分ける前提です。docs/post-effect-specification.md:108 docs/post-effect-specification.md:189
    この構成なら、各エフェクトは「固定シェーダ + 必要時だけ実行」で足ります。on/off のたびに WGSL を組み立てる必要はありません。
2. 現在の複雑さは「シェーダ不足」ではなく「制御フローの肥大化」
    source/render-loop.js はすでに useBloom、useGammaOnly、useFxaa で経路分岐しています。source/render-loop.js:162
    問題はここが今後 dof、grain、vignette、chromaticAberration でさらに増えることです。解くべきなのは「どのパスをどの順で流すか」の整理であって、「毎回シェーダを生成すること」ではありません。
3. 動的生成は WebGPU ではコストと不安定さを増やしやすい
    エフェクト切替時に ShaderModule / RenderPipeline を新規作成すると、初回コンパイルやパイプライン生成の揺れが出ます。リアルタイム UI で on/off する用途とは相性がよくありません。やるなら「事前生成した少数バリアントのキャッシュ」が先です。

おすすめの設計はこれです。

1. render-loop から buildPostEffectPlan(state) を切り出す
2. 返り値は [{ id: 'bloomExtract' }, { id: 'bloomBlurH' }, ...] の配列にする
3. 各パスは固定 pipeline を持つ
4. on/off は「plan に入れるかどうか」だけで制御する
5. 最終 composite だけは 1 本に寄せる
    色温度、ガンマ、グレイン、周辺減光、色収差は最終合成にまとめやすいです。docs/post-effect-specification.md:113

シェーダビルダーを検討してよい条件は限定的です。

- 最終合成だけで #ifdef 相当の分岐が増えすぎる
- 効果の組み合わせ数が多く、固定 pipeline の数が爆発する
- 実測で「分岐あり 1 本の composite」が明確に遅い

ただしその場合でも、最初から自由生成ビルダーではなく、「機能フラグからキーを作って、少数の shader variant をキャッシュする」方式で十分です。

要するにこうです。

- 今やるべき: パスグラフ化、実行計画化、固定 pipeline 化
- まだ不要: on/off ごとの動的シェーダ生成
- 将来必要なら: 完全なビルダーではなく variant cache

必要なら次に、source/render-loop.js をどう分割するとこの方針に乗せやすいか、具体的な関数単位まで落として提案できます。