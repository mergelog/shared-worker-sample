# SharedWorker Hello World × Angular 20

SharedWorkerの使い方を思い出すための、CSSを使わないサンプルです。
ブラウザー標準の見出し・文章・ボタンだけで、メイン画面と商品画面を表示します。

## 起動

Node.js 22.12以降の22系とnpmを使用します。

```bash
npm ci
npm start
```

1. **http://localhost:4200** を開きます。「これはメイン画面です。」と表示されます。
2. 「商品画面を別タブで開く」を押します。「これは商品画面です。」と表示されます。
3. 商品画面のボタンを押し、メイン画面に何が反映されるか確認します。

商品画面のURLは **http://localhost:4200/?page=product** です。
画面の選択はクエリパラメーターだけで行います。ルーターやCSSライブラリは使いません。

Angular開発サーバー（4200）とローカルAPI / WebSocketサーバー（3001）を一緒に起動します。
終了は `Ctrl+C`。外部サービスのアカウントは不要です。

## ボタンを押すとどうなるか

| 用途             | 押すボタン                                                        | メイン画面で確認すること                                                             |
| ---------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 状態共有         | 商品画面の「お気に入りに登録」                                    | お気に入りが「登録済み」になる。「お気に入りを解除」で「未登録」に戻る               |
| WebSocket共有    | 商品画面の「WebSocketを接続する」→「WebSocketでメッセージを送る」 | 両画面に同じ応答が届く。接続IDが同じで、サーバー全体の接続数が1になる                |
| データキャッシュ | 商品画面の「商品を取得」→メイン画面の「商品を取得」               | 同じ商品が表示される。30秒以内なら取得元がcacheになり、APIリクエスト番号は変わらない |
| タブ間通信       | 商品画面の「メイン画面へ通知する」                                | 「商品画面のボタンが押されました。」と表示される                                     |

### 状態共有

お気に入りを保持するのはWorkerです。画面は `favorite:set` で変更を依頼し、
Workerが全画面へ現在の状態を送ります。後から開いた画面にも現在の状態を渡します。
画面の再読み込み後も、ほかの画面が開いていれば同じWorkerの状態を使えます。

### WebSocket共有

WebSocketを作る場所はWorkerの中だけです。
どの画面から接続を要求しても、接続中・接続済みなら追加で作りません。
サーバーからの応答を全画面へ配信します。5秒ごとの定期メッセージも届きます。

- メイン画面と商品画面の接続IDを比較してください。
- サーバー全体の接続数には、別のブラウザー等からの接続も含まれます。
- 1画面を閉じても、残った画面で引き続き利用できます。
- 切断時は画面が残っていれば1秒後に再接続します。送信待ちキューや再送保証はありません。

再接続を試す場合は、別々のターミナルで `npm run server` と `npx ng serve` を起動し、
APIサーバーだけを停止・再起動してください。

### データキャッシュ

`GET /api/product` の結果を、取得成功から30秒間Workerのメモリに保存します。
APIは「サンプル商品（1000円）」と、実際の取得回数を示す番号を返します。

- `network`: APIにアクセス。
- `cache`: メモリ上の結果を再利用。
- `in-flight`: ほかの画面が開始した取得中のPromiseを共有。

商品画面の「商品を再取得（キャッシュ更新）」では、有効期限を待たずに更新できます。
再取得でも進行中の取得があればそのPromiseに合流します。
期限切れは次の要求時に確認し、自動更新はしません。表示済みの商品は期限後も残ります。
失敗時はエラーを表示し、最後に成功した結果を残します。次の要求で再試行できます。
HTTPキャッシュを無効にしているため、再利用はWorkerのメモリによるものです。

### タブ間通信

通知は送信元以外の、現在接続している画面にだけ届けます。
商品画面同士を開いた場合も通知されます。画面種別による送信先の制限はしていません。
送信元と、後から開いた画面には届きません。Workerに通知履歴は保存しません。
各画面は受信した直近20件だけを表示します。WebSocketの受信履歴も同様です。

## 最小コード

画面側：同じスクリプトURLと名前でSharedWorkerに接続します。

```js
const shared = new SharedWorker("/shared-worker.js", {
  name: "shared-product-demo-v1",
});
shared.port.addEventListener("message", ({ data }) => console.log(data));
shared.port.start();
shared.port.postMessage({ type: "favorite:set", favorite: true });
```

Worker側の骨格：接続ごとのポートを覚え、状態が変わったら全画面に送ります。

```js
const ports = new Set();
let favorite = false;

self.addEventListener("connect", (event) => {
  const port = event.ports[0];
  ports.add(port);
  port.addEventListener("message", ({ data }) => {
    if (data.type === "favorite:set") {
      favorite = data.favorite;
      for (const target of ports) {
        target.postMessage({ type: "favorite", favorite });
      }
    }
  });
  port.start();
});
```

上記は骨格だけです。実装では初期状態の送信と、切断時の後片付けも行います。
`addEventListener('message', ...)` を使う場合は `port.start()` が必要です。
画面とWorkerはメッセージをコピーしてやり取りします。

## コードを読む順番

| ファイル                                                            | 役割                                              |
| ------------------------------------------------------------------- | ------------------------------------------------- |
| [protocol.ts](src/app/shared/protocol.ts)                           | 画面とWorkerのメッセージ型                        |
| [shared-worker.js](public/shared-worker.js)                         | 状態・WebSocket・キャッシュ・通知の本体           |
| [shared-worker.service.ts](src/app/shared/shared-worker.service.ts) | 接続・送受信・AngularのSignalへの反映             |
| [app.ts](src/app/app.ts) / [app.html](src/app/app.html)             | 画面の選択・ボタン・結果表示                      |
| [server/index.mjs](server/index.mjs)                                | 商品API・Echo / 定期配信WebSocket・プレビュー配信 |
| [shared-worker.spec.ts](e2e/shared-worker.spec.ts)                  | 実ブラウザーで2画面の動作を検証                   |

Workerは `public/` からそのまま配信するJavaScriptです。
JSDocで共通のメッセージ型を参照し、`tsconfig.worker.json` で型チェックします。
AngularとWorkerの型定義（DOM / WebWorker）は分離しています。
Angularはスタンドアロン・Signals・Zoneless構成です。

## 共有範囲と寿命

- 同じブラウザープロファイル・同じオリジン・同じWorkerのURLと名前で共有します。
  `localhost` と `127.0.0.1`、異なるポート、HTTPとHTTPSはそれぞれ別オリジンです。
- 別ブラウザーやプライベートウィンドウとは共有されません。埋め込みではブラウザーの分離ポリシーにも依存します。
- WorkerはDOMに触れません。`fetch` や `WebSocket` は使えます。
- `pagehide` で切断を通知します。BFCacheから戻った場合は再接続します。
- 最後の切断通知を受け取るとWebSocketと再接続タイマーを閉じます。
  クラッシュ等では切断通知が保証されないため、画面数の厳密な管理にはハートビート等が必要です。
- Workerが終了すると、メモリ上の状態とキャッシュは失われます。終了タイミングはブラウザー依存です。
- SharedWorker非対応の場合は画面に理由を表示し、操作を無効にします。

## ビルド・検証

```bash
npm run typecheck:worker
npm run build
npm run preview
```

プレビューは本番ビルドとAPI / WebSocketを4200で配信します。`npm start` と同時には起動しないでください。
開発時は [proxy.conf.json](proxy.conf.json) で `/api/**` と `/socket` を3001へ転送します。
実際のデプロイ先でも `/api/product` と `/socket` を用意してください。
Worker編集後は関連画面をすべて閉じて開き直すと確実です。Chromeでは `chrome://inspect/#workers` で調べられます。

```bash
npx playwright install chromium
npm test
```

本番ビルドのプレビューを自動起動し、状態共有・1本の接続・APIキャッシュ・同時取得・TTL・通知・
リロード・非対応環境・別タブで商品画面を開く操作を検証します。GitHub Actionsでも実行します。

既存のChromeを使う場合（macOS）：

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm test
```

## 参考

- [MDN: SharedWorker](https://developer.mozilla.org/en-US/docs/Web/API/SharedWorker)
- [MDN: MessagePort](https://developer.mozilla.org/en-US/docs/Web/API/MessagePort)
- [Angular 20: Web workers](https://v20.angular.dev/ecosystem/web-workers)（Dedicated Workerの説明。接続APIはSharedWorkerと異なります）
