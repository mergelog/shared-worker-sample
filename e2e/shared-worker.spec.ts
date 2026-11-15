import { expect, test, type BrowserContext, type Page } from '@playwright/test';

async function openScreen(
  context: BrowserContext,
  screen: 'main' | 'product' = 'main',
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(screen === 'product' ? '/?page=product' : '/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    screen === 'product' ? 'これは商品画面です。' : 'これはメイン画面です。',
  );
  await expect(
    page.getByRole('button', { name: '商品を取得', exact: true }),
  ).toBeEnabled();
  return page;
}

async function stats(
  page: Page,
): Promise<{ apiRequests: number; activeConnections: number }> {
  return page.evaluate(async () => (await fetch('/api/stats')).json());
}

test('商品のお気に入りがメイン画面と後から開いた画面にも反映される', async ({
  context,
}) => {
  const main = await openScreen(context);
  const product = await openScreen(context, 'product');
  expect(await main.getByTestId('worker-id').textContent()).toBe(
    await product.getByTestId('worker-id').textContent(),
  );
  expect(await main.getByTestId('tab-id').textContent()).not.toBe(
    await product.getByTestId('tab-id').textContent(),
  );
  await expect(main.getByTestId('tab-count')).toHaveText('2');
  await expect(main.getByTestId('favorite')).toHaveText('未登録');
  await product
    .getByRole('button', { name: 'お気に入りに登録', exact: true })
    .click();
  await expect(main.getByTestId('favorite')).toHaveText('登録済み');
  await expect(product.getByTestId('favorite')).toHaveText('登録済み');
  const later = await openScreen(context);
  await expect(later.getByTestId('favorite')).toHaveText('登録済み');
  await product
    .getByRole('button', { name: 'お気に入りを解除', exact: true })
    .click();
  await expect(main.getByTestId('favorite')).toHaveText('未登録');
  await expect(later.getByTestId('favorite')).toHaveText('未登録');
  await later.close();
  await expect(main.getByTestId('tab-count')).toHaveText('2');
});

test('WebSocketは1接続だけで、両画面に応答し、1画面を閉じても使える', async ({
  context,
}) => {
  const main = await openScreen(context);
  const product = await openScreen(context, 'product');
  await product
    .getByRole('button', { name: 'WebSocketを接続する', exact: true })
    .click();
  await expect(main.getByTestId('socket-status')).toHaveText('connected');
  await expect(product.getByTestId('socket-status')).toHaveText('connected');
  await expect(main.getByTestId('socket-log')).toContainText(
    'Hello from WebSocket!',
  );
  await expect.poll(async () => (await stats(main)).activeConnections).toBe(1);
  // 別のMessagePortから繰り返し接続を要求しても、接続は増えない。
  await main.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const worker = new SharedWorker('/shared-worker.js', {
          name: 'shared-product-demo-v1',
        });
        worker.port.onmessage = ({ data }) => {
          if (data.type !== 'hello') return;
          worker.port.postMessage({ type: 'socket:connect' });
          worker.port.postMessage({ type: 'socket:connect' });
          worker.port.postMessage({ type: 'disconnect' });
          worker.port.close();
          resolve();
        };
      }),
  );
  await product
    .getByRole('button', { name: 'WebSocketでメッセージを送る', exact: true })
    .click();
  await expect(main.getByTestId('socket-log')).toContainText(
    'Echo: 商品画面からこんにちは',
  );
  await expect(product.getByTestId('socket-log')).toContainText(
    'Echo: 商品画面からこんにちは',
  );
  const mainLog = await main.getByTestId('socket-log').innerText();
  const productLog = await product.getByTestId('socket-log').innerText();
  expect(mainLog.match(/接続ID：(\w+)/)?.[1]).toBe(
    productLog.match(/接続ID：(\w+)/)?.[1],
  );
  expect((await stats(product)).activeConnections).toBe(1);
  await main.close();
  await product
    .getByRole('button', { name: 'WebSocketでメッセージを送る', exact: true })
    .click();
  await expect(
    product
      .getByTestId('socket-log')
      .getByRole('listitem')
      .filter({ hasText: 'Echo: 商品画面からこんにちは' }),
  ).toHaveCount(2);
  await product.close();
  await expect
    .poll(
      async () =>
        (await (await context.request.get('/api/stats')).json())
          .activeConnections,
    )
    .toBe(0);
});

test('商品データを両画面で共有し、キャッシュヒットではAPIにアクセスしない', async ({
  context,
}) => {
  const main = await openScreen(context);
  const product = await openScreen(context, 'product');
  const before = await stats(main);
  await product
    .getByRole('button', { name: '商品を取得', exact: true })
    .click();
  await expect(product.getByTestId('cache-source')).toContainText('network');
  await expect(main.getByTestId('cache-result')).toContainText(
    'サンプル商品（1000円）',
  );
  await expect(main.getByTestId('request-id')).toHaveText(
    String(before.apiRequests + 1),
  );
  await main.getByRole('button', { name: '商品を取得', exact: true }).click();
  await expect(main.getByTestId('cache-source')).toContainText(
    'cache（メモリから取得）',
  );
  expect((await stats(main)).apiRequests).toBe(before.apiRequests + 1);
  await product
    .getByRole('button', {
      name: '商品を再取得（キャッシュ更新）',
      exact: true,
    })
    .click();
  await expect(main.getByTestId('request-id')).toHaveText(
    String(before.apiRequests + 2),
  );
  const later = await openScreen(context);
  await expect(later.getByTestId('request-id')).toHaveText(
    String(before.apiRequests + 2),
  );
  expect((await stats(later)).apiRequests).toBe(before.apiRequests + 2);
});

test('2画面から同時にAPIを要求しても取得中のPromiseが共有される', async ({
  context,
}) => {
  const main = await openScreen(context);
  const product = await openScreen(context, 'product');
  const before = await stats(main);
  const getProduct = (page: Page) =>
    page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const worker = new SharedWorker('/shared-worker.js', {
            name: 'shared-product-demo-v1',
          });
          let tabId = '';
          worker.port.onmessage = ({ data }) => {
            if (data.type === 'hello') {
              tabId = data.tabId;
              worker.port.postMessage({ type: 'cache:get', refresh: false });
            }
            if (data.type === 'cache:result' && data.requestedBy === tabId) {
              worker.port.postMessage({ type: 'disconnect' });
              worker.port.close();
              resolve(data.source);
            }
          };
        }),
    );
  const sources = await Promise.all([getProduct(main), getProduct(product)]);
  expect(sources.sort()).toEqual(['in-flight', 'network']);
  expect((await stats(main)).apiRequests).toBe(before.apiRequests + 1);
  await expect(main.getByTestId('request-id')).toHaveText(
    String(before.apiRequests + 1),
  );
  await expect(product.getByTestId('request-id')).toHaveText(
    String(before.apiRequests + 1),
  );
});

test('商品画面の通知はメイン画面に届き、送信元や後から開いた画面には届かない', async ({
  context,
}) => {
  const main = await openScreen(context);
  const product = await openScreen(context, 'product');
  await product
    .getByRole('button', { name: 'メイン画面へ通知する', exact: true })
    .click();
  await expect(main.getByTestId('notification-log')).toContainText(
    '商品画面のボタンが押されました。',
  );
  await expect(product.getByTestId('notification-log')).not.toContainText(
    '商品画面のボタンが押されました。',
  );
  await expect(product.getByRole('status')).toHaveText('通知を送信しました。');
  const later = await openScreen(context);
  await expect(later.getByTestId('notification-log')).not.toContainText(
    '商品画面のボタンが押されました。',
  );
});

test('リロード後も別画面があれば同じWorkerの状態を使う', async ({
  context,
}) => {
  const main = await openScreen(context);
  const product = await openScreen(context, 'product');
  await product
    .getByRole('button', { name: 'お気に入りに登録', exact: true })
    .click();
  await expect(main.getByTestId('favorite')).toHaveText('登録済み');
  const workerId = await product.getByTestId('worker-id').textContent();
  await main.reload();
  await expect(main.getByTestId('favorite')).toHaveText('登録済み');
  await expect(main.getByTestId('worker-id')).toHaveText(workerId!);
  await expect(product.getByTestId('tab-count')).toHaveText('2');
});

test('SharedWorker非対応なら理由を表示して操作を無効にする', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'SharedWorker', { value: undefined });
  });
  await page.goto('/?page=product');
  await expect(page.getByRole('alert')).toContainText('対応していません');
  await expect(
    page.getByRole('button', { name: 'お気に入りに登録', exact: true }),
  ).toBeDisabled();
});

test('TTL経過後の商品取得はAPIに再アクセスする', async ({ context }) => {
  test.setTimeout(45_000);
  const main = await openScreen(context);
  const product = await openScreen(context, 'product');
  const before = await stats(main);
  await product
    .getByRole('button', { name: '商品を取得', exact: true })
    .click();
  await expect(main.getByTestId('request-id')).toHaveText(
    String(before.apiRequests + 1),
  );
  await main.waitForTimeout(30_100);
  await main.getByRole('button', { name: '商品を取得', exact: true }).click();
  await expect(product.getByTestId('request-id')).toHaveText(
    String(before.apiRequests + 2),
  );
  await expect(main.getByTestId('cache-source')).toContainText('network');
});

test('メイン画面のリンクから商品画面を別タブで開ける', async ({ context }) => {
  const main = await openScreen(context);
  const nextPage = context.waitForEvent('page');
  await main
    .getByRole('link', { name: '商品画面を別タブで開く', exact: true })
    .click();
  const product = await nextPage;
  await expect(product.getByRole('heading', { level: 1 })).toHaveText(
    'これは商品画面です。',
  );
  await expect(main).toHaveTitle('メイン画面');
  await expect(product).toHaveTitle('商品画面');
  await product
    .getByRole('button', { name: 'お気に入りに登録', exact: true })
    .click();
  await expect(main.getByTestId('favorite')).toHaveText('登録済み');
});
