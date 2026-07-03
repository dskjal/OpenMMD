
# Contact Shadow 可視面判定の空振り修正

## Summary

- 原因は prepassDepth を RGBA16Float に変更したあとも、sample_contact_shadow_for_visible_fragment が「view-space
の線形 depth をほぼ厳密一致で比較する」前提のままだったこと。
- RGBA16Float に線形 depth をそのまま入れると、モデルの実スケールと camera 距離では量子化誤差が大きくなり、
frontDepth と currentDepth が常にずれて可視面判定が落ちやすい。
- 修正は「16bit 向け depth エンコードへ統一し、mask 計算と可視面判定の両方を同じ decode 経路にそろえる」方針で行
う。

## Key Changes

- source/shaders/shaders.wgsl
    - fs_depth_prepass の 2 本目出力は、線形 view depth そのものではなく、16bit 向けの正規化 depth を保存する。
    - encode_contact_shadow_depth(viewDepth) と decode_contact_shadow_depth(encodedDepth) を追加する。
    - 正規化方式は near/far を使った一貫した方式に固定する。実装側で迷わないよう、Contact Shadow の全経路で同じ
    helper を使う。
    - reconstruct_contact_shadow_view_position は decode 後の線形 depth を使うように変更する。
    - sample_contact_shadow_for_visible_fragment は prepassDepthData の raw 値を直接比較せず、decode 後の depth
    同士を比較する。
    - 可視面判定の epsilon は固定値ではなく、decode 後 depth に対する相対項を含める。例: max(thickness * 2.0,
    currentDepth * 0.002) のように深度依存へ統一する。
- Contact Shadow mask shader
    - source/shaders/post-effect/contact-shadow-mask.wgsl
    - source/shaders/post-effect/contact-shadow-mask-msaa.wgsl
    - ここでも t_depth は raw 値のまま扱わず、shared 側と同じ decode 前提へそろえる。
    - calculate_contact_shadow の depth 参照はすべて decode 後の線形 depth を使う。
    - これで mask 生成結果と main shader の可視面判定が同じ深度解釈になる。
- Render/resource wiring
    - RGBA16Float のまま維持する。再度 RGBA32Float へ戻さない。
    - public API や UI の Contact Shadow パラメータ名は変更しない。
    - sample_contact_shadow_for_visible_fragment の返り値仕様も維持し、main shader 側の呼び出しシグネチャは変え
    ない。

## Test Plan

- Contact Shadow 有効時に、前面の可視サーフェスで sample_contact_shadow_for_visible_fragment が常に 1.0 にならな
いこと。
- 足裏、指、髪束、布の近接部で Contact Shadow が再び見えること。
- 背面ポリゴンや隠れた面には Contact Shadow が乗らないこと。
- sampleCount = 1 と sampleCount = 4 の両方で見え方が成立すること。
- カメラ距離を近距離・中距離・遠距離に変えても、可視面判定が全消失しないこと。
- contactShadowThickness を小さくしても、深度量子化だけで全面無効化されないこと。

## Assumptions

- 問題の主因は RGBA16Float 化による線形 depth の量子化誤差であり、mask texture 自体が未更新という問題ではない。
- 修正は「深度の保存形式と比較方式の整合」を優先し、UI や API の追加は行わない。
- 実装では shared helper を 1 箇所に寄せ、mask pass と main shader の depth 解釈差を残さない。



# Shared calculate_contact_shadow With Main-Shader Access（古いプラン）

## Summary

- Move Contact Shadow’s core ray-march logic into a shared function in source/shaders/shaders.wgsl named
calculate_contact_shadow.
- Keep a dedicated Contact Shadow mask pass, but make it call the shared function instead of owning a separate
implementation.
- Replace the final post-effect composite with main-shader consumption of a precomputed Contact Shadow mask.
- Avoid the prior backface/hidden-surface regression by letting the main shader read the mask only when the
fragment matches the frontmost prepass depth at that pixel.

## Key Changes

- source/shaders/shaders.wgsl
    - Add a shared ContactShadowUniforms definition and helper set needed by calculate_contact_shadow: depth
    linearization, view-position reconstruction, projection, normal decode, and screen/depth comparison
    helpers.
    - Add calculate_contact_shadow(coord, size, ...) -> f32 as the canonical raw Contact Shadow evaluator.
    - Add a main-shader-side accessor such as sample_contact_shadow_for_visible_fragment(position, viewPos) ->
        - sample the precomputed Contact Shadow mask texture,
        - sample the prepass depth texture,
        - compare the fragment’s own view depth against the frontmost prepass depth with a small threshold,
        - return 1.0 when the fragment is not the visible front layer for that pixel.
    - Keep the function JSDoc-style comments consistent with repo rules where JS changes are needed; WGSL
    comments should stay concise.
- Contact Shadow resources and bindings
    - Extend the shared/global bind group so main fragment shaders can read:
        - the precomputed Contact Shadow mask texture,
        - the prepass depth texture or an equivalent sampled depth view,
        - Contact Shadow uniforms if the shared WGSL helper needs them at main-shader compile scope.
    - Do not sample the live main-pass depth attachment directly.
    - Use the existing depth+normal prepass output as the sampled source of truth for visibility matching.
- source/shaders/post-effect/contact-shadow-mask.wgsl and MSAA variant
    - Remove the private Contact Shadow math implementation from these files.
    - Convert them into thin wrappers that call shared calculate_contact_shadow.
    - Preserve current mask generation behavior, including MSAA-specific depth loading and current blur behavior
    if blur remains part of the mask stage.
    - If blur is kept, define responsibilities clearly:
        - calculate_contact_shadow returns the raw shadow term,
        - a separate local helper performs bilateral blur over the raw mask result.
- Main shading integration
    - Update the custom material shaders to consume sample_contact_shadow_for_visible_fragment(...) and multiply
    it into the existing lighting/shadow term only for visible front-layer fragments.
    - Apply Contact Shadow to the same lighting components as the prior composite’s perceptual intent:
        - diffuse/toon lighting is affected,
        - emissive stays unaffected,
        - edge rendering stays unaffected.
    - Keep material.receiveShadow as the gate for Contact Shadow use.
- Render flow
    - Keep the order:
        1. depth+normal prepass
        2. Contact Shadow mask pass
        3. main pass
        4. remaining post effects
    - Remove the old Contact Shadow scene-color composite pass from the planner and render loop.
    - The planner should still expose useContactShadow, but Contact Shadow should no longer occupy a post-effect
    scene-color composite slot.
- JS integration points
    - Update resource creation and pipeline wiring in the renderer/GPU setup to provide the new mask/depth
    bindings to the main shaders.
    - Preserve MSAA and non-MSAA paths:
        - MSAA mask generation continues to use the MSAA-aware Contact Shadow mask shader,
        - main shaders read the resolved mask and the sampled prepass depth used for front-layer matching.
- API/docs
    - Update docs/specification/api-specification.md and docs/specification/api-specification-ja.md so Contact
    Shadow is described as:
        - computed from prepass depth/normal,
        - exposed to main shading through a precomputed mask,
        - no longer applied as a final scene-color composite.

## Test Plan

- Visibility correctness
    - Backfaces and hidden polygons must not show Contact Shadow when a front surface occupies the same screen
    pixel.
    - Alpha-cutout geometry must not leak Contact Shadow onto obscured layers.
    - Transparent/no-cull materials should not reproduce the prior “backside shadow” artifact.
- Functional correctness
    - contactShadowEnabled = false must match current disabled behavior.
    - contactShadowEnabled = true must produce visible Contact Shadow on frontmost visible surfaces only.
    - material.receiveShadow = false must suppress Contact Shadow contribution.
- Rendering-path coverage
    - Non-MSAA and MSAA paths must both compile and render.
    - Bloom, DoF, SSS, FXAA, gamma, and chromatic aberration must continue to work with Contact Shadow enabled.
    - Depth+normal prepass output must remain valid for Contact Shadow and any existing normal/depth consumers.
- Regression checks
    - Compare against the previous composite look on typical cases: feet-to-floor contact, fingers, hair clumps,
    close cloth overlaps.
    - Confirm the new main-shader application does not darken emissive contributions.

## Assumptions

- calculate_contact_shadow refers to the raw Contact Shadow evaluator, not the blurred/final accessor.
- The visible-surface-safe main-shader accessor will be separate from calculate_contact_shadow to keep the
shared function reusable by both mask pass and main shaders.
- A small configurable or hardcoded depth-match epsilon is acceptable to reject hidden/back-layer fragments.
- Existing Contact Shadow UI/state names remain unchanged.

# Contact Shadow を depth+normal prepass -> mask pass -> main pass へ移行する計画（古いプラン）

## Summary

- Contact Shadow を post-effect の generate + composite 方式から外し、depth+normal prepass の結果を使って
contact shadow mask を先に生成し、main pass 側でその mask を直接ライティングへ反映する構成へ移行する。
- main pass 中に depth attachment を直接読むことはしない。Contact Shadow 計算は prepass 後の独立 pass で完了させ
る。
- blurAmount UI は維持し、mask pass 内で近傍サンプルを使う現行相当の blur を残す。
- MSAA は対応対象に含める。depth は既存の MSAA / non-MSAA 分岐を維持し、normal は prepass で resolve 済み
texture を生成して Contact Shadow mask pass から読む。

## Key Changes

- source/render-loop.js
    - フローを depth+normal prepass -> contact shadow mask pass -> main pass -> 残りの post effects に変更する。
    - 既存の CONTACT_SHADOW_COMPOSITE 実行を削除する。
    - CONTACT_SHADOW_GENERATE は post-effect planner の後段 pass としてではなく、main pass 前の固定段として実行
    する。
    - mainPass の前に contactShadowMaskBindGroup を生成し、prepass で確定した depth / normal を使って mask を作
    る。
    - mainPass は prepass depth を depthLoadOp: 'load' で使い回す。
- source/post-effect-planner.js
    - CONTACT_SHADOW_COMPOSITE を削除する。
    - CONTACT_SHADOW_GENERATE も post-effect pass list から外し、planner 上は useContactShadow の有無だけを返す
    形に縮小する。
    - needsSceneResolve / needsDepthSampling から Contact Shadow 起因の条件を外す。
    - Contact Shadow は post-effect の最終色ソース計算に関与させない。
- source/model-manager-pipelines.js
    - 既存の depth prepass パイプラインに加え、depth+normal prepass 用 pipeline を追加する。
    - fragment 出力は normal MRT 1 枚に限定し、depth は depthStencilAttachment に書く。
    - MSAA / non-MSAA 両方の prepass pipeline set を持つ。
- source/model-manager.js
    - drawDepthPrepass(...) を drawDepthNormalPrepass(...) 相当へ拡張するか、既存 API を残して内部実装を
    depth+normal 前提へ置き換える。
    - depth prepass と同じ material 可視条件、alpha cutout 条件、cull 条件を normal prepass にも適用する。
    - main pass と prepass で対象 material がずれないようにする。
- source/shaders/shaders.wgsl
    - global bind group に contactShadowMaskTexture と sampler、Contact Shadow uniforms を追加する。
    - calculate_contact_shadow(...) は shaders.wgsl に追加しない。計算本体は mask pass 側で完結させ、main shader
    側は mask を読むだけにする。
    - main shader 共通部に sample_contact_shadow(...) のような参照関数を追加し、custom shader から統一的に使える
    ようにする。
- source/shaders/custom-shaders/mmd-shader.wgsl
    - source/shaders/custom-shaders/cell-shader.wgsl
    - source/shaders/custom-shaders/gltf-shader.wgsl
    - 既存の shadowFactor 計算へ Contact Shadow mask を乗算または mix で合成する。
    - 適用規則は directional shadow の後段で material.receiveShadow > 0.5 のときのみ有効にする。
    - contact shadow は現在の用途に合わせて「暗化係数」として扱い、最終 diffuse / toon lighting に掛ける。
    emissive には適用しない。
- source/renderer-gpu.js
    - createGlobalResources(...) の global bind group layout を拡張し、Contact Shadow 用 uniform buffer、mask
    texture、sampler を追加する。
    - global bind group の再構築処理に Contact Shadow リソースを含める。
    - createContactShadowResources(...) は mask pass 用の pipeline / bind group 作成だけを残し、composite
    pipeline / bind group を削除する。
    - Contact Shadow 用 sampler は mask 読み取り専用として filtering sampler を使う。
- source/renderer-resources.js
    - prepass normal 用 render target は既存 scene normal 系 texture を main pass 前に使える前提へ整理する。
    - 既存 sceneNormalRenderTexture / normalResolveTexture は prepass 生成物として使い、main pass の MRT からは
    外す。
    - contactShadowMaskTexture は継続使用する。
    - 深度 texture は既存の getDepthView(msaaSampleCount) を継続利用する。
- source/shaders/post-effect/contact-shadow-mask.wgsl
    - source/shaders/post-effect/contact-shadow-mask-msaa.wgsl
    - compute_contact_shadow_raw を calculate_contact_shadow に改名し、mask 生成の中心関数として整理する。
    - blur を含む最終出力関数は別名で分離し、calculate_contact_shadow は 1 ピクセルの基本 shadow 値を返す責務に
    限定する。
    - non-MSAA / MSAA の両方で関数名と責務を揃える。
- source/shaders/post-effect/contact-shadow.wgsl
    - source/shaders/post-effect/contact-shadow-msaa.wgsl
    - composite 用 shader として不要になるため削除対象にするか、未使用化してロード停止する。
    - 実装ではまずロード停止・pipeline 削除を行い、ファイル削除は同一変更に含めてよい。
- source/renderer.js
    - Contact Shadow shader module のロードから composite 用 shader を外す。
    - createContactShadowResources(...) 呼び出し引数を mask pass 専用に更新する。
- docs/specification/api-specification.md
    - docs/specification/api-specification-ja.md
    - 外部 API 上で Contact Shadow 設定項目の名称は維持しつつ、「post-effect compositing」ではなく「main shading
    に適用される mask ベース影」へ説明を更新する。
    - UI / API の公開パラメータ名は変更しない。

## Test Plan

- contactShadowEnabled = false
    - main shading の見た目が現状の Contact Shadow 無効時と一致すること。
    - post-effect planner から Contact Shadow pass が消えても他の post effects が壊れないこと。
- contactShadowEnabled = true
    - 足裏、指、髪束など接近部にのみ Contact Shadow が出ること。
    - emissive が Contact Shadow で暗くならないこと。
    - receiveShadow = false material に Contact Shadow が掛からないこと。
- blurAmount
    - 0 でシャープな mask になること。
    - > 0 で現行に近いぼかしが掛かること。
    - blur により silhouette 越しの不自然なにじみが大きく増えないこと。
- alpha cutout / no-cull
    - cutout 材質で prepass と main pass の可視結果がずれないこと。
    - 髪や板ポリで Contact Shadow が過剰に残留しないこと。
- MSAA / non-MSAA
    - sampleCount = 1 と > 1 の両方で Contact Shadow が出ること。
    - MSAA 有効時も validation error が出ないこと。
    - prepass depth を main pass で load しても破綻しないこと。
- 他機能回帰
    - Bloom / DoF / SSS / FXAA / gamma / chromatic aberration との併用で描画順が崩れないこと。
    - scene normal を prepass 生成へ移した影響で SSS と Contact Shadow の両方が期待通り動くこと。

## Assumptions

- Contact Shadow の公開 UI / state 名は維持する。
- Contact Shadow の main shader 反映先は base lighting の暗化のみとし、emissive や post-effect 最終合成には使わ
ない。
- calculate_contact_shadow は mask pass 用 shader 内の正式関数名として追加し、main shader 側は mask texture を読
む方式を採用する。
- prepass normal は view-space normal を既存 encode_view_normal(...) 形式で格納する。
- main pass の normal MRT 出力は不要になるため削除方向とする。ただし SSS などが同じ normal texture を読む前提は
維持する。