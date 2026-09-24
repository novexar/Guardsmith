# 人間の判断が必要な事項

判断が済んだ項目は結論を追記したうえで、実装 PR と同じタイミングで削除する。

## D-002: `with` の未知キーが strict で拒否されない(全 check 横断)

- **発見**: `feature/import-budget`(import-budget 実装中)
- **事象**: `Rule` は `z.discriminatedUnion("check", [...]).and(RuleBase)` で構成しているが、
  zod 4 の intersection を通すと branch 側 `z.object({...}).strict()` の未知キー拒否が失われ、
  `with` の未知キーは**エラーにならず黙って捨てられる**。トップレベル
  (`PolicyDocument.strict()`)の未知キー拒否は効いている。
  - 実測: `check: max-lines` / `with: { path, limit, bogus }` → `ok: true`(`bogus` は削除)
  - 既存 8 check すべてに該当する既存挙動であり、import-budget 固有の問題ではない
- **なぜ問題か**: schema.ts の設計方針「未知キーは strict() で拒否(タイポをエラーにする=
  ガバナンスツールの信頼性)」および README の "unknown keys are rejected; typos become errors"
  と食い違う。`max_chars` を `maxChars` と書いたポリシーが無警告で通り、上限が効かない。

### 選択肢

1. **`Rule` の合成方法を変える**(推奨)。各 branch に `RuleBase` のキーを直接持たせて
   `discriminatedUnion` 1 段にする(`.and()` をやめる)。strict が branch まで効く。
   - 影響: 既存ポリシーで未知キーを書いていた利用者が新たに error になる(= 意図どおりだが
     破壊的変更。次期メジャー/マイナータグでの配布と CHANGELOG 明記が必要)
2. **`.and()` のまま `superRefine` で `with` のキーを検証する**。合成は変えず、branch ごとの
   許可キー一覧と突き合わせる。影響範囲は 1 と同じだが実装が二重管理になる。
3. **現状維持**。README / schema.ts のコメントから「未知キーは拒否」の記述を外し、
   「未知キーは無視される」と正しく書き直す。

### 推奨

選択肢 1。ガバナンスツールとしてタイポを黙認しないことが本来の設計意図であり、
リリース単位(次期タグ)で配布すれば影響は制御できる。本 PR は import-budget の範囲に留め、
schema 合成の変更は別 PR とする。
