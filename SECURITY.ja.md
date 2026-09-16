# Security Policy

[English](SECURITY.md) | **日本語**

## サポート対象バージョン

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅        |

## 脆弱性の報告

セキュリティ脆弱性については、公開 Issue を**立てないでください**。

- GitHub の [Private vulnerability reporting](https://github.com/novexar/Guardsmith/security/advisories/new) を使用してください
- 報告には 7 日以内の一次回答を目標としています

## スコープに関する補足

GuardSmith はリモート tarball(`github:` 参照)をダウンロード・展開します。展開パスは
パストラバーサル(`..` / 絶対パス)とリンク系エントリに対して防御されており、
`//path` サブ参照もキャッシュルート内に制限されます。これらの防御の迂回に関する報告を
特に歓迎します。

GuardSmith の secret-scan check は、AI コンテキストファイルへの資格情報コミットを
ベストエフォートで防ぐガードであり、専用のシークレットスキャンツールの代替ではありません。
