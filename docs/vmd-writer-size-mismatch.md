# tests/vmd-roundtrip.test.mjs の読み書きテストでファイルサイズが一致しないことがある現象の原因

原因は VMDWriter が末尾の self-shadow count を常に 4 バイト書くのに対して、元ファイルにはその 4 バイトが無いことです。

- test-data/2分ループステップ1.vmd は 10,054,734 bytes
- writer.write(data) は 10,054,738 bytes
- 先頭 10,054,734 bytes は完全一致
- 余分な 4 bytes は 00 00 00 00

確認した範囲では、読み込み側は元ファイルを最後まで消費していますが、書き込み側が末尾に zero count を追加していま
す。該当箇所は /D:/data/program/openmmd/source/loader/vmd-writer.js:82 の self-shadow count 書き込みです。
VMDLoader 側は self-shadow が無い場合でも空配列に正規化するので、[] と「元ファイルにそのセクションが無い」を区別で
きていません。/D:/data/program/openmmd/source/loader/vmd-loader.js:81

テスト側はサイズ差を最初に弾くので、/D:/data/program/openmmd/tests/vmd-roundtrip.test.mjs:136 では Size mismatch
になります。

要するに、原因は「パース崩れ」ではなく「writer が canonical form として末尾の 0 count を必ず出す」ことです。もし
byte-for-byte の roundtrip を狙うなら、self-shadow セクションの有無を別フラグで保持して、元ファイルに無い場合はそ
の最後の uint32 を書かない必要があります。