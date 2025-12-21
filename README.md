# Logseq Ebbinghaus Created Date Updater

Logseq の **Advanced Query（#+BEGIN_QUERY）内の `:inputs` を自動更新**するプラグインです。  
以下を安定して実現します：

- **エビングハウス復習間隔（offsets）**：1/2/4/7/15/30/90/180 日（デフォルト）
- **日付範囲（RANGE）**：例）20260101〜20260131（ページ内指定 or 設定画面のデフォルト範囲）

> 想定ユースケース：`created:: [[YYYYMMDD]]` のようなページ属性を用意し、「列挙法（文字列 contains）」で確実にヒットさせたい。  
> かつ、**テンプレートページ上の offsets は毎日自動更新**したいが、**テンプレートを呼び出して生成された通常ページ側は“当時の値で固定（更新しない）”**にしたい。

---

## 機能概要

### 1) Offsets（エビングハウス復習日）
- offsets（例：1,2,4,7...）を **YYYYMMDD の日付文字列リスト**に変換
- Advanced Query の `:inputs [[ "YYYYMMDD" ... ]]` を自動で差し替え
- **「テンプレート元ページ」だけを更新**（他ページを勝手に書き換えない＝低結合）

**Marker（目印行）**
- `;; @ebbinghaus-created`

### 2) RANGE（日付範囲）
- **どのページでも** RANGE クエリを挿入可能
- `RANGE:YYYYMMDD-YYYYMMDD` を **日付リストに展開して `:inputs` を更新**
- **ページ単位で完全独立**：Aページ（10日）とBページ（20日）が互いに影響しません

**Marker**
- `;; @ebbinghaus-range`

**RANGE の優先順位**
1. **ページ内 sentinel**（例：`RANGE:20260101-20260131`）
2. **プラグイン設定（Settings）のデフォルト範囲** `rangeStart` / `rangeEnd`（ページ内に sentinel が無い場合のフォールバック）

---

## 依存関係 / 動作環境

- Logseq Desktop
- Node.js（推奨：18 / 20+）
- npm

> Windows の場合、PowerShell / CMD のどちらでもOKです。

---

## インストール（開発 / ローカル）

### 方法A：Load unpacked plugin（推奨）
1. このリポジトリをダウンロード/クローン
2. ルートディレクトリでビルド：

```bash
npm install
npm run build
```

3. Logseq を開く：
   - Settings → Plugins → **Load unpacked plugin**
   - `package.json` があるフォルダを選択
4. Logseq を再起動（またはプラグインを Disable → Enable）

---

## 使い方（普段の利用）

### 1) offsets クエリブロックを挿入する
任意ページで `/` を入力し、以下を選択：
- `Ebbinghaus: Insert created query (offsets)`

挿入される例：

```clojure
#+BEGIN_QUERY
{:title "Ebbinghaus created offsets (exclude today)"
 :query
 [:find (pull ?p [*])
  :in $ [?d ...]
  :where
  [?p :block/properties ?props]
  [(get ?props :created) ?c]
  [(contains? ?c ?d)]]
 :inputs [["20000101"]]}
#+END_QUERY
;; @ebbinghaus-created
```

挿入直後：**現在ページが「テンプレート元ページ」であれば**、すぐに inputs が offsets の日付に更新されます。

✅ **重要**：offsets は **テンプレート元ページのみ自動更新**です。  
テンプレートを呼び出して生成された通常ページ側は「当時の inputs で固定」され、後日プラグインが勝手に書き換えません（仕様）。

---

### 2) RANGE クエリブロックを挿入する（どのページでもOK）
任意ページで `/` を入力し、以下を選択：
- `Ebbinghaus: Insert created query (RANGE)`

挿入される例：

```clojure
#+BEGIN_QUERY
{:title "Created pages in RANGE"
 :query
 [:find (pull ?p [*])
  :in $ [?d ...]
  :where
  [?p :block/properties ?props]
  [(get ?props :created) ?c]
  [(contains? ?c ?d)]]
 :inputs [["RANGE:20260101-20260131"]]}
#+END_QUERY
;; @ebbinghaus-range
```

その後、プラグインが RANGE を日付リストに展開し、`inputs` を自動更新します。

✅ RANGE は **ページごとに独立**して動作します。Bページの範囲がAページに影響することはありません。

---

## 手動コマンド（Command Palette）

コマンドパレットを開く（例：`Ctrl+K` / `Cmd+K`）：

- `Ebbinghaus: Update template query inputs NOW`
  - テンプレート元ページにある offsets の inputs を手動更新
  - 実行結果（marked/inputsFound/inputsUpdated）がトースト表示されます

- `Ebbinghaus: Update RANGE inputs NOW (current page)`
  - **現在ページ**の RANGE inputs を手動更新

---

## Settings（プラグイン設定画面）

Logseq → Plugins → 本プラグイン → Settings

### Offsets（テンプレート元ページ更新）
- `Template source page(s) (offsets only)`  
  例：`Templates, note templates`
- `Marker (offsets)`：デフォルト `@ebbinghaus-created`
- `Ebbinghaus offsets (days)`：デフォルト `1,2,4,7,15,30,90,180`
- `Exclude today`：true の場合 offset=1 は「昨日」
- `Auto update template pages (offsets)`：起動時 + 日付跨ぎで自動更新（Logseq が開いている場合）
- `Update offsets when opening template page`：テンプレート元ページを開いたタイミングで更新

### RANGE（どのページでも利用）
- `Marker (RANGE)`：デフォルト `@ebbinghaus-range`
- `RANGE start (YYYYMMDD)` / `RANGE end (YYYYMMDD)`  
  - **デフォルト範囲**として利用  
  - `/Insert created query (RANGE)` の挿入時にも、この設定値が使われます（有効な場合）
- `Auto update RANGE on open page`：ページを開いたときに RANGE を更新
- `Auto update RANGE on edit`：編集時に自動更新（デバウンスあり）
- `Max days for RANGE expansion`：範囲が大きすぎる場合の安全制限（デフォルト 400）

---

## データ形式要件（重要）

本プラグインのクエリは基本的に **contains マッチ**です：

```clojure
[(contains? ?c ?d)]
```

したがって、ページ属性が以下のように **YYYYMMDD を含む**形式であればヒットします：

- `created:: [[20251217]]`
- `created:: "20251217"`
- その他（文字列中に `20251217` が含まれる）

---

## よくある問題 / トラブルシューティング

### 1) 実行したのに更新されない（inputsUpdated=0）
確認ポイント：
- クエリブロックに marker 行があるか  
  - `;; @ebbinghaus-created` または `;; @ebbinghaus-range`
- `:inputs [[ ... ]]` が存在するか
- marker と inputs が **同じブロックツリー**内にあるか  
  （プラグインは marker を含むブロックの「親（root）」配下をスキャンします）

### 2) offsets が通常ページで更新されない
仕様です。offsets は **テンプレート元ページのみ**自動更新します。  
テンプレートから生成された通常ページは「当時の inputs に固定」されます。

### 3) 次の日に自動更新される条件は？
次のいずれかで更新されます：
- 次の日に Logseq を起動した（起動時更新）
- Logseq を開いたまま日付を跨いだ（タイマー更新）
- 次の日にテンプレート元ページを開いた（ページオープン時更新）

※ Logseq が完全に終了している間はバックグラウンド更新できません。

### 4) Windows で npm 実行時に ExecutionPolicy エラーが出る
PowerShell で以下を実行（CurrentUser 推奨）：

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

---

## 開発・ビルド

```bash
npm install
npm run build
```

出力：
- `dist/index.js`

---

## Logseq プラグインマーケットへの公開（推奨フロー）
1. GitHub で tag を切る（例：`v0.1.11`）
2. GitHub Actions で zip を生成（workflow で `plugin.zip` 等）
3. マーケット要件に従い登録（repo / manifest / release asset 等）

> 公開する場合は追加推奨：LICENSE / CHANGELOG / 改良した icon など。

---

## License
MIT（必要なら標準の MIT LICENSE ファイルも追加できます）
