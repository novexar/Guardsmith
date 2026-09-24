# Security Policy

[English](SECURITY.md) | **日本語**

## サポート対象バージョン

| Version | Supported |
| ------- | --------- |
| 0.6.x   | ✅        |

## 脆弱性の報告

セキュリティ脆弱性については、公開 Issue を**立てないでください**。

- GitHub の [Private vulnerability reporting](https://github.com/novexar/Guardsmith/security/advisories/new) を使用してください
- 報告には 7 日以内の一次回答を目標としています

## スコープに関する補足

GuardSmith はリモート tarball(`github:` 参照)をダウンロード・展開します。展開パスは
パストラバーサル(`..` / 絶対パス)とリンク系エントリに対して防御されており、
`//path` サブ参照もキャッシュルート内に制限されます。これらの防御の迂回に関する報告を
特に歓迎します。

`import-budget` check は `CLAUDE.md` の `@path` インポートを辿りますが、**走査ルートの外は
一切読みません**。`..` による脱出・絶対パス・`~/` 始まり・バックスラッシュを含む参照は
ファイルアクセス前に弾き、読み込み直前に `realpath` でルート配下にあることを確認するため、
ルート内から外を指すシンボリックリンクも読まずに報告だけします。これらはいずれも `info`
(`import outside root, not measured`)としてのみ報告されます。

ファイル走査は既定で `.gitignore`(入れ子の `.gitignore` も)に追従し、`.git/` を常に除外
します。これにより `secret-scan` の対象は「**コミットされうるファイル**」に限定され、
`.claude/settings.local.json` のような除外済みファイル内の値は報告されません。これは検知
保証ではなくスコープの設計判断です。除外ファイルも点検したい場合は
`guard lint --no-gitignore` を使ってください。

GuardSmith の secret-scan check は、AI コンテキストファイルへの資格情報コミットを
ベストエフォートで防ぐガードであり、専用のシークレットスキャンツールの代替ではありません。
