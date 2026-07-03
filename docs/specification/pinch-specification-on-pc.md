# Chrome on PC におけるピンチ仕様メモ

この文書は、OpenMMD を **PC 上の Chrome で検証する場合**に、ピンチ操作がどう扱われるかを整理したメモです。

前提として、ここでいう「ピンチ」には 2 種類あります。

1. **ブラウザのページズーム**
   - Chrome 自体が表示倍率を変える操作。
   - DevTools の Device Mode では、`Shift + drag` や `Shift + scroll` がこの挙動の模擬として案内されています。
2. **アプリ側が拾うピンチ入力**
   - `pointerdown` / `pointermove` / `pointerup` などで 2 本指の距離変化を見て、アプリ独自のズームに変換する方式。
   - これはブラウザのページズームとは別です。

## 結論

- OpenMMD は **ページズームを無効化したまま**、アプリ側でピンチ相当の入力を処理する方針です。
- そのため、**実機のタッチ入力**なら「2 本指ピンチ」をアプリが拾ってズームできます。
- ただし **Chrome DevTools の `Shift + drag`** は、ページの JS へそのまま `pointer` / `touch` として届かないことがあります。
  - DevTools 側の「ピンチ zoom 模擬」は、ページイベントというよりブラウザ側の emulation に寄るためです。

## このリポジトリの設定

OpenMMD の `index.html` では、ページズームとブラウザ既定ジェスチャーを抑止しています。

- `meta viewport` に `maximum-scale=1.0, user-scalable=no`
- `body { touch-action: none; }`
- `canvas { touch-action: none; }`

この構成だと、Chrome は既定のパン/ピンチ処理をページに任せず、Pointer Events ベースの独自処理に寄せます。

## Chrome / DevTools 側の仕様

### Device Mode は実機の完全再現ではない

Chrome DevTools の Device Mode は、モバイル表示や touch イベントをある程度模擬できますが、**実機と完全一致ではありません**。

- 公式ドキュメントでも、Device Mode は「モバイル体験の近似」であると説明されています。
- そのため、DevTools 上で見えている挙動が、実機のタブレットやスマホでそのまま起きるとは限りません。

### `Shift + drag` は pinch zoom の模擬として案内されている

Chrome のモバイル emulation の古い公式案内では、`Shift + drag` あるいは `Shift + scroll` で pinch zoom を模擬できると説明されています。

ただし、この操作は **ページの JS が受け取る touch/pointer イベントを必ず発生させるものではありません**。

ここが重要です。

- `Shift + drag` が **ブラウザ表示の zoom** として処理されると、ページ側の `pointerdown` には入らないことがあります。
- つまり、`console.log` を `pointerdown` 内に置いても、`Shift + drag` では出ないケースがあります。

今回のセッションで観測した「`Shift + drag` でログが出ない」は、この挙動と整合的です。

## Pointer Events の考え方

MDN の Pointer Events 解説では、2 本のポインターの距離変化で pinch/zoom を検出する例が示されています。

要点は次の通りです。

- `pointerdown` でポインターを記録する
- `pointermove` で 2 本の距離差を見る
- `touch-action` を適切に設定して、ブラウザの既定ジェスチャーを抑止する

この方式なら、アプリはブラウザのページズームに依存せず、独自のズーム動作を実装できます。

## OpenMMD での実装方針

OpenMMD では、次の順序で扱うのが正しいです。

1. `touch-action: none` でブラウザ既定のパン/ピンチを止める
2. Pointer Events でポインターを記録する
3. 2 本のポインター距離差からカメラ距離を更新する
4. 必要に応じて、ログを出して検証する

この方針の利点は、ページズームとアプリズームを分離できることです。

## 実務上の注意

### 1 本指ドラッグと 2 本指ピンチは別物

- 1 本指ドラッグは回転
- 2 本指ピンチはズーム

に分けて実装すると、検証しやすくなります。

### DevTools だけで完全検証できない場合がある

DevTools の Device Mode は便利ですが、**実機のタッチハードウェアと同じではありません**。

そのため、次の使い分けが安全です。

- **DevTools**
  - レイアウト
  - touch/pointer 処理の大枠確認
  - ログ確認
- **実機**
  - 2 本指ピンチの最終確認
  - OS / GPU / タッチドライバ込みの挙動確認

## 参考リンク

### Chrome DevTools

- [Simulate mobile devices with device mode](https://developer.chrome.com/docs/devtools/device-mode)
- [Chrome DevTools for mobile](https://developer.chrome.com/blog/devtools-mobile)

### Pointer Events / touch-action

- [MDN: touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action)
- [MDN: Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)
- [MDN: Pinch zoom gestures](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Pinch_zoom_gestures)

## このセッションでの結論

- `index.html` はページズームを無効化している。
- その状態で `Shift + drag` は、DevTools の pinch zoom 模擬として案内されていても、ページ JS にイベントが届かない場合がある。
- OpenMMD のピンチ検出を確認したいなら、`pointer` ベースの 2 本指処理をログ付きで確認し、最終確認は実機で行うのが確実。
