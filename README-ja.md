# Check Point MCP Servers

[English](./README.md)

このリポジトリには、Check Pointセキュリティプラットフォーム向けのModel Context Protocol（MCP）サーバー群が含まれています。TypeScriptで実装され、各MCPサーバーはモノレポ内の個別パッケージとして構成されています。

> [!IMPORTANT]
> このフォークには、アップストリームのCheck Point MCPプロジェクトには含まれず、Check Pointの公式製品でもない、コミュニティ開発の実験的な監査コンポーネントが含まれています。元のMCPサーバーには、引き続きリポジトリのMITライセンスおよび著作権表示が適用されます。

## このフォークで追加したもの

アップストリームのMCPサーバーは、AIクライアントにCheck Point製品の幅広い機能を公開します。このフォークでは、無人実行を想定した読み取り専用のセキュリティベースライン監査経路を追加しています。

- **Gaia Read-only Collector MCP** は、DNS、DHCP、日時に加え、バージョン、ユーザー、パスワードポリシー、許可クライアント、SNMP、syslog、BGPの固定されたハードニング観測機能を公開します。厳格なTLS検証、対象機器の完全一致許可リスト、非対話型の認証情報プロファイルを使用します。
- **Security Baseline Audit MCP** は、Baseline Format v1のJSONを検証し、組織独自コントロールを決定論的に評価します。また、レポート、履歴、変更、承認済み例外を管理します。
- **Baseline Audit Runner** は、選択したベースラインを読み込み、再試行、対象ロック、同時実行数の制限、スケジューラー向け終了コード、最小限のWebhook通知、Windowsタスクスケジューラーテンプレートを使用して収集と評価を統合します。

現在の実装は意図的に読み取り専用に制限されています。ポリシーのインストール、Managementの変更公開、汎用的なGaia APIまたはCLI実行ツールは提供しません。

第三者のベンチマーク本文は同梱していません。公開されているCheck Point Gateway and Management Hardening Administration Guideの推奨事項を簡潔に対応付けた、独自作成の監査Profileを含みます。このProfileはCheck Point公式のベースライン、認証、原文書の代替ではありません。取得できない項目は合格とせず、手動確認として扱います。

作成の背景、アーキテクチャ、セキュリティ境界、検証状況、公開・保守方針については、[実験的な読み取り専用監査拡張](./docs/experimental-baseline-audit-extension.md)を参照してください。

## MCPとは

Model Context Protocol（MCP）サーバーは、企業データを構造化された機械可読APIとして公開し、AIによる自動化、コパイロット、意思決定エンジンから利用できるようにします。セキュリティ環境の明確で文脈を備えた情報を提供することで、独自SDKの構築や未加工エクスポートデータの解析を行わずに、複雑なシステムを照会、分析、最適化できます。

## Check Point SecurityでMCPを使用する理由

セキュリティポリシーは、多様な適用ポイントにまたがる数百のルールと数千のオブジェクトで構成される場合があります。このような環境の理解、監査、最適化には時間がかかり、ミスも発生しやすくなります。

MCPは、セキュリティ管理データをモジュール化され文脈を備えた形式で公開し、AIシステムから利用できるようにします。これにより、AIはデータを正確に扱い、実際の運用に関する質問へ構造化された実用的な回答を返せます。

## リポジトリ構成

このモノレポでは、Check Pointの各セキュリティ領域を個別のMCPサーバーとして構成しています。

- **`/packages`** - すべてのMCPサーバー実装と共有ライブラリ
  - **`/management`** - ポリシーおよびオブジェクト管理用Management API MCPサーバー
  - **`/infra`** - 共有インフラストラクチャコンポーネントとユーティリティ
  - **`/management-logs`** - Check Point製品用Management Logs MCPサーバー
  - **`/threat-prevention`** - Threat Preventionポリシー用Management API MCPサーバー
  - **`/https-inspection`** - HTTPS Inspectionポリシー用Management API MCPサーバー
  - **`/harmony-infra`** - Harmony製品用の共有インフラストラクチャコンポーネント
  - **`/harmony-sase`** - SASEポリシー管理用Harmony SASE MCPサーバー
  - **`/mcp-utils`** - MCPサーバー用の共有ユーティリティ
  - **`/reputation-service`** - Reputation MCPサーバー
  - **`/gw-cli-base`** - ゲートウェイスクリプト実行用の基盤
  - **`/gw-cli`** - 情報、性能、診断用Gateway Script MCPサーバー
  - **`/gw-cli-connection-analysis`** - 接続問題分析用Gateway Script MCPサーバー
  - **`/threat-emulation`** - マルウェア分析とファイルスキャン用Threat Emulation MCPサーバー
  - **`/gaia`** - ネットワーク管理とインターフェース設定用GAIA OS MCPサーバー
  - **`/documentation-tool`** - 製品情報、技術仕様、設定ガイダンス、機能文書にアクセスするためのCheck Pointドキュメントアシスタント
  - **`/spark-management`** - Quantum Sparkアプライアンス管理用MCPサーバー
  - **`/cpinfo-analysis`** - Check Pointアプライアンスの診断ファイル分析とトラブルシューティング用MCPサーバー
  - **`/argos-erm`** - 外部リスク管理および脅威インテリジェンス用Argos ERM MCPサーバー
  - **`/policy-insights`** - Policy Insights MCPサーバー
  - **`/checkpoint-waf`** - WebアプリケーションおよびAPIファイアウォールの資産、ポリシー、設定を管理するCheck Point WAF MCPサーバー
  - **`/cpview-history-mcp`** - ゲートウェイ性能データベースを分析するCPView History MCPサーバー
  - **`/workforce-ai`** - AI Access、Chats、Agents、Secure Browsingを対象とするAIおよびブラウズポリシーの管理、展開、ユーザー可視化用Workforce AI MCPサーバー
  - **`/gaia-readonly-collector`** - 厳格なTLS検証と対象機器の完全一致許可リストを備えた、実験的な読み取り専用Gaiaコレクター
  - **`/baseline-audit`** - 組織独自のBaseline Format v1を評価する、コミュニティ開発の汎用監査サーバー
  - **`/baseline-audit-runner`** - ベースラインファイル選択、再試行、対象ロック、通知、スケジューラーテンプレートを備えたコミュニティ開発の無人監査ランナー

## 利用可能なMCPサーバー

このリポジトリでは、次のMCPサーバーを利用できます。

| MCPサーバー                                                          | パッケージ名                                            | 説明                                                                                                                                        |
| -------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [Management](./packages/management/)                                 | `@chkp/quantum-management-mcp`                          | ポリシー、ルール、オブジェクト、ネットワークトポロジーの照会                                                                                |
| [Management Logs](./packages/management-logs/)                       | `@chkp/management-logs-mcp`                             | 接続ログおよび監査ログの照会と分析                                                                                                          |
| [Threat-Prevention](./packages/threat-prevention/)                   | `@chkp/threat-prevention-mcp`                           | Threat Preventionポリシー、プロファイル、インジケーター、IPS更新、IOCフィードの照会                                                         |
| [HTTPS-Inspection](./packages/https-inspection/)                     | `@chkp/https-inspection-mcp`                            | HTTPS Inspectionポリシー、ルール、例外の照会                                                                                                |
| [Check Point SASE](./packages/harmony-sase/)                         | `@chkp/harmony-sase-mcp`                                | Check Point SASEのリージョン、ネットワーク、アプリケーション、設定の照会と管理                                                              |
| [Reputation Service](./packages/reputation-service/)                 | `@chkp/reputation-service-mcp`                          | URL、IP、ファイルのレピュテーション照会                                                                                                     |
| [GW CLI](./packages/gw-cli/)                                         | `@chkp/quantum-gw-cli-mcp`                              | ハードウェア、ネットワーク設定、高可用性、性能、セキュリティ、リアルタイム接続デバッグに関する診断と分析                                    |
| [GW CLI Connection Analysis](./packages/gw-cli-connection-analysis/) | `@chkp/quantum-gw-connection-analysis-mcp`              | 接続問題を分析するためのデバッグログ取得                                                                                                    |
| [Threat Emulation](./packages/threat-emulation/)                     | `@chkp/threat-emulation-mcp`                            | Check Pointクラウドサービスによるファイルのマルウェアおよび脅威分析                                                                         |
| [Gaia](./packages/gaia/)                                             | `@chkp/quantum-gaia-mcp`                                | GAIA OSのネットワーク管理とインターフェース設定                                                                                             |
| [Documentation Tool](./packages/documentation-tool/)                 | `@chkp/documentation-mcp`                               | Check Point製品の情報、技術仕様、設定ガイダンス、機能文書へのアクセス                                                                       |
| [Check Point Spark Firewall](./packages/spark-management/)           | `@chkp/spark-management-mcp`                            | MSPおよび分散ネットワーク向けCheck Point Spark Firewallアプライアンスの管理と監視                                                           |
| [CPInfo Analysis](./packages/cpinfo-analysis/)                       | `@chkp/cpinfo-analysis-mcp`                             | システム正常性、性能指標、ネットワーク設定、トラブルシューティングに関するCPInfo診断ファイルの分析                                          |
| [Exposure Management](./packages/argos-erm/)                         | `@chkp/argos-erm-mcp`                                   | アラート、IOC、資産、脆弱性、認証情報漏えい、脅威インテリジェンス、組織リスクの監視、調査、修復                                             |
| [Policy Insights](./packages/policy-insights/)                       | `@chkp/policy-insights-mcp`                             | Access Controlポリシーを強化するためのインサイト照会                                                                                        |
| [Check Point WAF](./packages/checkpoint-waf/)                        | `@chkp/checkpoint-waf-mcp`                              | Check Point WAFの資産、プラクティス、プロファイル、ゾーン、動作の照会と管理、および適用変更の公開                                           |
| [CPView History](./packages/cpview-history-mcp/)                     | `@chkp/cpview-history-mcp`                              | ゲートウェイの性能、リソース使用率、ホットスポット、インシデント調査に関するCPView履歴データベースの分析                                    |
| [Workforce AI](./packages/workforce-ai/)                             | `@chkp/workforce-ai-mcp`                                | AI Access、Chats、Agents、Secure Browsingを対象とするAIおよびブラウズポリシーの照会と管理、展開、ユーザー可視化                             |
| [Gaia Read-only Collector](./packages/gaia-readonly-collector/)      | `@focuslight-nr/checkpoint-gaia-readonly-collector-mcp` | 厳格な読み取り専用Gaia APIを通じたDNS、DHCP、日時、ハードニング状態の固定観測                                                               |
| [Security Baseline Audit](./packages/baseline-audit/)                | `@focuslight-nr/checkpoint-baseline-audit-mcp`          | Baseline Format v1を検証し、組織独自コントロールを決定論的に評価して、レポート、履歴、変更、承認済み例外を保持                              |
| [Baseline Audit Runner](./packages/baseline-audit-runner/)           | `@focuslight-nr/checkpoint-baseline-audit-runner`       | 選択したベースラインについて、再試行、ロック、同時実行数の制限、通知、Windowsタスクスケジューラーテンプレートを使用した無人収集・評価を実行 |

## MCPサーバーの設定例

Management MCPサーバーをMCPクライアントに設定する例を次に示します。

```json
{
  "MCP-NAME": {
    "command": "npx",
    "args": ["@chkp/MCP_NPM_PACKAGE"],
    "env": {
      // MCPサーバー固有の設定
    }
  }
}
```

**MCPサーバーごとに必要な設定が異なります。詳しい設定手順については、各パッケージのREADMEを参照してください。**

## 開発を始める

MCPサーバーを利用するだけの場合、この手順は不要です。このリポジトリで開発する場合は、次のコマンドを実行します。

```bash
# リポジトリをクローン
git clone [repository-url]

# 依存関係をインストール
npm install

# すべてのパッケージをビルド
npm run build
```

## Nxワークスペースコマンド

このプロジェクトはモノレポ管理にNxを使用しています。Nxコマンドを使用して、パッケージごとのタスクを実行できます。

**パッケージのビルド方法:**

- **エイリアス:** `npm run nx:build:<folder-name>`（例: `management`、`harmony-sase`、`infra`）
- **Nxを直接実行:** `npx nx build <full-package-name>`（例: `@chkp/quantum-management-mcp`）

### 開発モードの実行

```bash
# @chkp/managementを開発モードで実行
npx nx run @chkp/quantum-management-mcp:dev
# エイリアスを使用する場合
npm run nx:dev:management

# https-inspectionを開発モードで実行
npx nx run @chkp/https-inspection-mcp:dev
# エイリアスを使用する場合
npm run nx:dev:management
```

### 特定パッケージのビルド

```bash
# https-inspectionサーバーをビルド
npx nx build @chkp/https-inspection-mcp
# エイリアスを使用する場合
npm run nx:build:https-inspection

# threat-preventionサーバーをビルド
npx nx build @chkp/threat-prevention-mcp
# エイリアスを使用する場合
npm run nx:build:threat-prevention
```

### テストの実行

```bash
# 特定のパッケージをテスト
npx nx run @chkp/quantum-infra:test

# すべてのパッケージをテスト
npx nx run-many --target=test
```

### その他の便利なNxコマンド

```bash
# プロジェクトグラフを表示
npx nx graph

# 利用可能なプロジェクトを一覧表示
npx nx show projects

# すべてのパッケージをビルド
npx nx run-many --target=build

# すべてのパッケージをlint
npx nx run-many --target=lint
```

---

## セキュリティに関する注意

1. **認証キーや認証情報がモデルへ共有されることはありません。** これらは、MCPサーバーがCheck Point管理システムへ認証する場合にのみ使用されます。
2. **信頼できるクライアント実装だけを使用してください。** 悪意のある、または信頼できないクライアントは、認証情報を不正利用したり、不適切にデータへアクセスしたりする可能性があります。
3. **照会したデータはモデルに公開されます。** 機密データや個人識別情報（PII）の取り扱いについて、組織のポリシーに準拠したモデルおよびプロバイダーだけを使用してください。

## テレメトリとプライバシー

Check Pointは、MCPサーバーの改善を目的として匿名の利用統計を収集します。収集対象はツールの利用パターンと匿名識別子だけで、認証情報、ポリシー、機密データは含まれません。

**オプトアウト:** 環境変数 `TELEMETRY_DISABLED=true` を設定するか、`--no-telemetry` フラグを使用すると、テレメトリ収集を無効化できます。
