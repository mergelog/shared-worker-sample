# SharedWorker Hello World × Angular 20

「SharedWorkerってどうやって使うんだっけ？」というときに読む、小さな実行可能サンプルです。
Angular 20のスタンドアロンコンポーネントとSignalsを使い、次の4つを同じWorkerで試せます。
外部APIのアカウントやWebSocketサービスは不要です。

| 用途             | このサンプルで試すこと                          | Workerが共有するもの |
| ---------------- | ----------------------------------------------- | -------------------- |
| 状態共有         | タブAでカウンターを加算するとタブBにも反映      | `counter`            |
| WebSocket共有    | 複数タブで同じ接続を使い、応答を全タブで受信    | `socket`             |
| データキャッシュ | API結果を30秒間再利用し、同時取得も1回に集約    | `cache` / `inFlight` |
| タブ間通信       | タブAから、その時点で開いているほかのタブに通知 | `ports`              |

## 起動

Node.js **22.12以降の22系**を推奨します（`.nvmrc`は22）。npmを使用します。

```bash
npm ci
npm start
```

**http://localhost:4200** を開き、「もう1タブ開く」を押します。
Angular開発サーバー（4200）とローカルAPI / WebSocketサーバー（3001）が一緒に起動します。
終了は `Ctrl+C`。両方のポートを空けてから起動してください。

SharedWorker対応ブラウザーで試してください。非対応の場合は画面に理由を表示し、操作を無効にします。

## 2タブで試す

### 1. 状態共有

1. 両タブの **Worker IDが同じ**、**タブIDが異なる**ことを確認。
2. タブAで「+1 加算」。タブBも同じ数になります。
3. タブBで「リセット」。タブAも0になります。
4. さらにタブCを開くと、現在の値から始まります。

加算は「タブで現在値を読んで送る」のではなく、`counter:increment`という操作を送ります。
Workerが順に処理するので、複数タブからの加算で古い値を上書きしません。

### 2. WebSocket共有

1. どちらかで「接続する」。両方の状態が `connected` になります。
2. メッセージを送ると、両タブに `Echo: ...` が届きます。5秒ごとの定期メッセージも届きます。
3. 両タブのログで **接続IDが同じ**、**サーバー全体の接続数が1**であることを確認。
4. 接続を開始したタブを閉じても、残ったタブから送信できます。

WebSocketを作る場所はWorkerの中だけです。すでに接続中・接続済みなら追加で作りません。
切断時はタブが残っていれば1秒後に再接続します。送信待ちキューや再送保証は実装していません。
再接続を試す場合は、2つのターミナルで `npm run server` と `npx ng serve` を起動し、
サーバーだけを停止・再起動してください。復帰後は接続IDが変わります。

※「サーバー全体の接続数」は別のブラウザープロファイル等からの接続も含みます。

### 3. データキャッシュ

1. タブAで「データを取得」。`Hello from API!` とAPIリクエスト番号が両タブに表示されます。
2. 30秒以内にタブBで「データを取得」。取得元が `cache` となり、番号は変わりません。
3. 「再取得（キャッシュ更新）」では新しい番号になります。
4. 30秒を過ぎてから「データを取得」しても新しい番号になります。

- `network`: APIにアクセスして取得。
- `cache`: 有効期限内のメモリ上の結果を再利用。
- `in-flight`: ほかのタブが開始した取得中のPromiseに相乗り。

TTLは**取得成功から30秒**。期限切れを確認するのは次の取得要求時で、自動更新はしません。
表示済みの結果は期限が切れても残ります。再取得でも、進行中の取得があればそのPromiseに合流します。
失敗時はエラーを表示し、最後に成功した結果を残します。次の要求で再試行できます。
APIのHTTPキャッシュは無効にしているため、この再利用はWorkerのメモリによるものです。

### 4. タブ間通信

1. タブAで文面を入力して「通知する」。
2. タブBの受信欄に文面と送信元IDが表示されます。
3. タブAの受信欄には表示されません（送信済み表示は別に出ます）。
4. 後から開いたタブCには過去の通知は届きません。

カウンターやキャッシュと違い、通知の履歴をWorkerには保存しません。
各タブの画面には、受信した直近20件だけを残します。WebSocketログも直近20件です。

## まず覚えるコード

タブ側は、同じURLと名前でSharedWorkerを作り、その `port` で通信します。
次はAngularの外でも使える最小例です。実装全体は後述のサービスを参照してください。

```js
const shared = new SharedWorker("/shared-worker.js", {
  name: "angular20-shared-worker-hello",
});
shared.port.addEventListener("message", ({ data }) => console.log(data));
shared.port.start();
shared.port.postMessage({ type: "counter:increment" });
```

Worker側は、接続ごとに渡されるポートを覚え、必要な相手に `postMessage` します。
以下は動きの骨格です。本体ではメッセージ型・切断・初期状態の送信も扱っています。

```js
const ports = new Set();
let counter = 0; // タブごとではなくWorkerに1つ

self.addEventListener("connect", (event) => {
  const port = event.ports[0];
  ports.add(port);
  port.addEventListener("message", ({ data }) => {
    if (data.type === "counter:increment") {
      counter++;
      for (const target of ports) {
        target.postMessage({ type: "counter", value: counter });
      }
    }
  });
  port.start();
});
```

`addEventListener('message', ...)` を使う場合は `port.start()` が必要です。
`port.onmessage = ...` の場合は暗黙に開始されます。
タブの配列を直接共有するのではなく、各タブとWorkerの間でメッセージをコピーして送ります。

## コードを読む順番

| ファイル                                                            | 役割                                                              |
| ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [protocol.ts](src/app/shared/protocol.ts)                           | タブ → Worker / Worker → タブのメッセージ型                       |
| [shared-worker.js](public/shared-worker.js)                         | 共有データ・接続・キャッシュ・通知の本体。4用途ごとにコメント付き |
| [shared-worker.service.ts](src/app/shared/shared-worker.service.ts) | Workerを生成し、受信結果をAngularのSignalに反映                   |
| [app.ts](src/app/app.ts) / [app.html](src/app/app.html)             | 操作を送るボタンと各デモの表示                                    |
| [server/index.mjs](server/index.mjs)                                | ローカルAPI、Echo / 定期配信WebSocket、本番ビルドのプレビュー     |
| [shared-worker.spec.ts](e2e/shared-worker.spec.ts)                  | 実ブラウザーの複数タブで共有動作を検証                            |

Workerは学習時にブラウザーからもそのまま読めるよう、`public/` のプレーンなJavaScriptにしています。
Angular CLIのassets設定で開発時・ビルド時とも同じファイルを配信します。
WorkerのJSDocから `protocol.ts` の型を参照し、`tsconfig.worker.json` で型チェックします。
AngularとWorkerの実行環境（DOM / WebWorker）の型定義は分離しています。

Angular側は `providedIn: 'root'` のサービスを1つ用意し、タブごとにポートを1本だけ開きます。
Zoneless構成なので、Workerからの受信時にSignalを書き換えると表示が更新されます。
コンポーネントはWorkerやWebSocketを直接管理しません。

## 共有される範囲と寿命

- 同じスキーム・ホスト・ポート、同じWorkerスクリプトURLと `name` を使います。
  `localhost` と `127.0.0.1`、4200と別ポート、HTTPとHTTPSはそれぞれ別オリジンです。
- 別ブラウザー、別プロファイル、通常ウィンドウとプライベートウィンドウの間では共有されません。
  埋め込みiframe等ではブラウザーのストレージ分離ポリシーによっても範囲が変わります。
- WorkerはDOMに触れません。`fetch` や `WebSocket` はWorker内から使えます。
- `pagehide` で切断通知を送り、Worker側でポートを取り除きます。
  BFCacheからの `pageshow` ではポートを作り直します。
- 最後の切断通知を受け取るとWebSocketと再接続タイマーを閉じます。
  クラッシュや強制終了では `pagehide` の実行は保証されず、接続タブ数の厳密な管理には別途ハートビート等が必要です。
- **メモリ上の状態であり永続化ではありません。** Workerが終了すればカウンターとキャッシュは消えます。
  最後のタブを閉じた直後に必ず初期化されるとは限りません（Workerの終了タイミングはブラウザー依存）。
- SharedWorkerとService Workerは別のAPIです。このサンプルにはオフライン対応やバックグラウンド常駐はありません。

## 開発・検証

```bash
npm run typecheck:worker   # WorkerのJavaScriptと共通メッセージ型をチェック
npm run build              # Worker型チェック + Angularのproduction build
npm run preview            # ビルド結果 + API + WebSocketを4200で配信
```

`npm start` と `npm run preview` は同じポートを使うため、同時には起動しないでください。
開発時は [proxy.conf.json](proxy.conf.json) が `/api/**` と `/socket` を3001へ転送します。
プレビュー時は同じNodeサーバーが静的ファイルとAPI / WebSocketを配信します。
実際のデプロイ先でも `/api/hello` と `/socket` を用意する必要があります。

Workerを編集した後は、関連タブをすべて閉じてから開き直すと確認しやすくなります。
通常のAngularのHMRでは、既存のSharedWorkerの入れ替えは保証されません。
Chromeでは `chrome://inspect/#workers` からWorkerのコンソールを確認できます。

### ブラウザーテスト

```bash
npx playwright install chromium
npm test
```

本番ビルドのプレビューを自動起動し、同じBrowserContext内の複数ページで以下を確認します。

- Worker ID、タブごとのID、カウンターの加算・リセット・遅れて接続したタブへの反映
- WebSocketが1接続であること、Echoの全タブ配信、接続元タブを閉じた後の送信
- キャッシュ共有・再取得・同時要求の集約・TTL経過後の再取得
- 通知が送信元や後から開いたタブには届かないこと
- 別タブを開いたままのリロード、非対応ブラウザーの表示、モバイル幅でのレイアウト

ローカルの既存Chromeを使う場合は次のように実行できます（macOSの例）。

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm test
```

GitHub Actionsでも `npm ci` → Chromiumインストール → `npm test` を実行します。

## 参考

- [MDN: SharedWorker](https://developer.mozilla.org/en-US/docs/Web/API/SharedWorker)
- [MDN: SharedWorker()](https://developer.mozilla.org/en-US/docs/Web/API/SharedWorker/SharedWorker)
- [MDN: MessagePort](https://developer.mozilla.org/en-US/docs/Web/API/MessagePort)
- [Angular 20: Web workers](https://v20.angular.dev/ecosystem/web-workers)（Dedicated Workerの説明。SharedWorkerとは接続APIが異なります）
