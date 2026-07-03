この手の「DCCツール風タイムライン」は、単純なDOMテーブルで作るとすぐ破綻します。要件的に **仮想化・分離・低レベル描画** を前提に設計した方がいいです。結論から言うと、以下のアーキテクチャが実務的に安定します。

---

## 1. レイヤ分離（必須）

UIを3層に分けます：

### (A) ヘッダ（時間軸）

* フレーム番号（0,5,10…）
* ズーム対応（スケール変更）

👉 DOM or CanvasどちらでもOK（軽い）

### (B) トラック名カラム（左）

* カメラ / 照明 / セルフ影 / 重力…
* 固定スクロール（横に動かない）

👉 DOM推奨（選択・編集しやすい）

### (C) タイムライングリッド（本体）

* キーフレーム
* 補間表示
* 選択範囲

👉 **Canvas or WebGL一択**
（DOMで数万セルは無理）

---

## 2. スクロール設計

スクロールは2軸で同期：

* 横スクロール → ヘッダ + グリッド
* 縦スクロール → トラック名 + グリッド

```text
[ header ]  ← 横同期
[ names ][ timeline ] ← 縦・横同期
```

👉 `scrollLeft / scrollTop` を手動同期

---

## 3. 描画方式（重要）

### ❌ NG

* divをグリッド状に並べる
* keyframeごとにDOM

→ 数千要素で詰む

---

### ✅ 推奨：Canvasベース

#### 描画対象

* 背景グリッド
* キーフレーム（◇）
* 補間線

#### メリット

* 数万フレームでも軽い
* ピクセル単位制御
* 拡大縮小が簡単

---

## 4. 仮想化（Virtualization）

全部描画しないのが重要

```js
visibleFrameStart = scrollX / scale
visibleFrameEnd   = visibleFrameStart + viewportWidth / scale

visibleTrackStart = scrollY / rowHeight
visibleTrackEnd   = visibleTrackStart + viewportHeight / rowHeight
```

👉 この範囲だけ描画

---

## 5. データ構造

典型的には：

```ts
type Keyframe = {
  frame: number
  value: number
}

type Track = {
  name: string
  keyframes: Keyframe[]
}
```

補間がある場合：

```ts
type Keyframe = {
  frame: number
  value: number
  interp: "linear" | "bezier" | "step"
}
```

---

## 6. インタラクション設計

### ヒットテスト（重要）

Canvasなので自前実装：

```js
function hitTest(mouseX, mouseY) {
  const frame = (mouseX + scrollX) / scale
  const track = Math.floor((mouseY + scrollY) / rowHeight)

  // 近いキーフレームを探索
}
```

---

### ドラッグ操作

* mousedown → 対象取得
* mousemove → frame更新
* mouseup → commit

👉 フレームはスナップ（整数化）

---

## 7. ズーム設計

```js
scale = pixelsPerFrame
```

* ホイールで変更
* 中心位置を維持

```js
const before = mouseX / scale
scale *= 1.1
scrollX = before * scale - mouseX
```

---

## 8. グリッド描画最適化

```js
for (let f = start; f < end; f++) {
  if (f % 5 === 0) 太線
  else 細線
}
```

👉 画像のような5フレーム単位の強調

---

## 9. 技術スタック

### 軽量構成

* Canvas 2D + Vanilla JS

### 中規模

* React + Canvas（描画は分離）

### 高性能

* WebGL（PixiJS など）

---

## 10. よくある落とし穴

### ❌ DOMベースで作る

→ 即パフォーマンス死

### ❌ 全描画

→ フレーム数増加で死

### ❌ スクロールをCSS任せ

→ 同期ズレ

---

## まとめ（設計指針）

* UIは「ヘッダ / 左 / 本体」に分離
* 本体はCanvas描画
* 仮想化必須
* 座標→フレーム変換を中核に設計
