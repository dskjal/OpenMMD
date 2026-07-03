  # PMX Display Frame ベースのタイムライン折り畳み

  - タイムラインのボーン/モーフ表示を、既存の Bones / Morphs フラット列挙から、PMX の model.displayFrames をそのま
    ま使う1階層グループ表示へ置き換える。
  - 折り畳みは再帰構造にしない。各 Display Frame は単独の親行を持ち、その直下にボーン/モーフ子行を並べるだけにす
    る。
  - 初期状態は全グループ折り畳み。Display Frame 未所属のボーン/モーフは末尾の Other グループへまとめる。
  - 既存のキーフレーム選択、再生位置同期、ボーン選択連携は維持する。選択された子トラックが閉じている場合は、その親
    Display Frame を自動展開して可視化する。

  ## Key Changes

  - source/timeline-data.js
      - TimelineTrack を「描画用フラット配列」前提から、「グループ行 + 子行」を表現できる形に拡張する。
      - 各トラックに少なくとも以下を持たせる。
          - trackType: display-frame / bone / morph / camera / light / shadow
          - parentId: 子行のみ設定
          - itemType: bone / morph を display-frame 子行で区別
          - visible: 折り畳み結果として描画対象かどうか
      - createTracksFromVmd(vmd, model, options) を、PMX displayFrames と VMD キーフレームの両方を使ってトラックを
        構築する形へ変更する。
      - ボーン/モーフのキーフレームを名前単位で先に集約し、その後 displayFrames[].frames[] の順で子トラックへ割り
        当てる。
      - Display Frame 親行の keyframes は、その配下の子行キーフレームを結合した集約表示にする。
      - type === 0 は model.bones[index]、type === 1 は model.morphs[index] を引く。無効 index は無視する。
      - 同じボーン/モーフが複数 Display Frame に入っていても、最初に割り当てたグループだけに表示し、重複描画しな
        い。
      - displayFrames 未所属でキーフレームを持つボーン/モーフは Other 親行配下へ集約する。
      - camera / light / shadow は既存どおり独立トラックのまま残す。
  - source/timeline.js
      - setSource を折り畳み状態付きで再構築できるようにし、内部に collapsedTrackIds などの状態を持つ。
      - updateTrackListUI() を親行/子行対応に変更する。
          - display-frame 親行の先頭に + / - トグルを表示
          - 子行はインデントして表示
          - 折り畳み時は子行 DOM を生成しない
      - クリック処理を分離する。
          - 親行クリック: 折り畳み切り替え
          - 子行クリック: 既存のトラック選択
      - renderGrid() / renderKeyframes() / キーフレーム hit test は、visible なトラックだけを対象にする。
      - 行番号計算を「配列 index」依存から「可視トラック配列 index」依存へ変える。これで折り畳み後もキャンバス描画
        と左カラムが一致する。
      - setSelectedTrackByName(name) は、該当子トラックの親 Display Frame を自動展開してから選択する。
      - resize() の高さ計算も可視トラック数ベースへ変更する。
      - index.html のタイムライン CSS に最小限の追記を入れる。
          - 親行用の見た目
          - 子行インデント
          - トグル記号の固定幅
          - 既存高さ 24px は維持
  - source/timeline-manager.js
      - rebuildTimelineSource() で、タイムライン再構築前の折り畳み状態を取得し、再構築後に復元する。
      - syncViewState() でボーン選択時に setSelectedTrackByName() を呼ぶ既存動作を活かし、必要なら親自動展開だけ追
        加で効くようにする。
      - VMD 再割り当てやキーフレーム登録後も、ユーザーが閉じた/開いた状態を維持する。

  ## Test Plan

  - PMX に Display Frame があるモデルで、各フレーム名の親行が表示され、初期状態が全折り畳みになる。
  - 親行をクリックすると、その配下のボーン/モーフだけが開閉する。再帰展開は起きない。
  - 親行の集約キーフレームは、子行に存在するフレーム位置を反映する。
  - 子行のキーフレーム選択で、既存どおりボーン選択と補間パネル反映が動く。
  - ビューポート側でボーン選択したとき、対応子行の親が自動展開されて選択状態が見える。
  - VMD 追加、削除、再割り当て、ボーン/モーフ key 登録後も折り畳み状態が保持される。
  - Display Frame 未所属のボーン/モーフにキーフレームがある場合、末尾 Other 配下にだけ表示される。
  - displayFrames が空の PMX では、Other に全ボーン/モーフを入れるかたちでタイムラインが壊れず表示される。
  - camera / light / shadow は従来どおり表示・選択・再生できる。

  ## Assumptions

  - 実装対象はユーザー指定の source/timeline.js、source/timeline-data.js、source/timeline-manager.js を中心にし、
    表示用の最小 CSS 追記だけ index.html に入れる。
  - Display Frame.specialFlag は初期展開判定には使わない。全グループ折り畳みで統一する。
  - ボーン/モーフ名ベースの既存選択連携は維持し、同名衝突は現状仕様のまま扱う。
  - Display Frame に存在してもキーフレームが1つもない子項目は表示する。PMX の表示枠をタイムライン構造として優先す
    るため。