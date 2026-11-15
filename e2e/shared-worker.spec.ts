import { expect, test, type BrowserContext, type Page } from '@playwright/test';

async function openTab(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto('/');
  await expect(
    page.getByText('Hello from SharedWorker!', { exact: true }),
  ).toBeVisible();
  return page;
}

async function stats(
  page: Page,
): Promise<{ apiRequests: number; activeConnections: number }> {
  return page.evaluate(async () => (await fetch('/api/stats')).json());
}

test('同じWorkerに接続し、加算・リセット・後から開いたタブの状態が同期する', async ({
  context,
}) => {
  const a = await openTab(context);
  const b = await openTab(context);
  expect(await a.getByTestId('worker-id').textContent()).toBe(
    await b.getByTestId('worker-id').textContent(),
  );
  expect(await a.getByTestId('tab-id').textContent()).not.toBe(
    await b.getByTestId('tab-id').textContent(),
  );
  await expect(a.getByTestId('tab-count')).toHaveText('2');
  await Promise.all([
    a.getByRole('button', { name: '+1 加算', exact: true }).click(),
    b.getByRole('button', { name: '+1 加算', exact: true }).click(),
  ]);
  await expect(a.getByTestId('counter')).toHaveText('2');
  await expect(b.getByTestId('counter')).toHaveText('2');
  const c = await openTab(context);
  await expect(c.getByTestId('counter')).toHaveText('2');
  await expect(a.getByTestId('tab-count')).toHaveText('3');
  await c.getByRole('button', { name: 'リセット', exact: true }).click();
  await expect(a.getByTestId('counter')).toHaveText('0');
  await expect(b.getByTestId('counter')).toHaveText('0');
  await c.close();
  await expect(a.getByTestId('tab-count')).toHaveText('2');
});

test('WebSocketは1接続だけで、全タブに応答し、1タブを閉じても使える', async ({
  context,
}) => {
  const a = await openTab(context);
  const b = await openTab(context);
  await a.getByRole('button', { name: '接続する', exact: true }).click();
  await expect(a.getByTestId('socket-status')).toHaveText('connected');
  await expect(b.getByTestId('socket-status')).toHaveText('connected');
  await expect(b.getByTestId('socket-log')).toContainText(
    'Hello from WebSocket!',
  );
  await expect.poll(async () => (await stats(a)).activeConnections).toBe(1);

  // 別のMessagePortから何度接続を要求しても、Worker内の接続は増えない。
  await b.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const worker = new SharedWorker('/shared-worker.js', {
        name: 'angular20-shared-worker-hello-v2',
      });
      worker.port.onmessage = ({ data }) => {
        if (data.type !== 'hello') return;
        worker.port.postMessage({ type: 'socket:connect' });
        worker.port.postMessage({ type: 'socket:connect' });
        worker.port.postMessage({ type: 'disconnect' });
        worker.port.close();
        resolve();
      };
    });
  });
  await b.getByLabel('WebSocketメッセージ').fill('from tab B');
  await b.getByRole('button', { name: '送信', exact: true }).click();
  await expect(a.getByTestId('socket-log')).toContainText('Echo: from tab B');
  await expect(b.getByTestId('socket-log')).toContainText('Echo: from tab B');
  const logA = await a.getByTestId('socket-log').innerText();
  const logB = await b.getByTestId('socket-log').innerText();
  expect(logA.match(/接続ID: (\w+)/)?.[1]).toBe(
    logB.match(/接続ID: (\w+)/)?.[1],
  );
  expect((await stats(b)).activeConnections).toBe(1);
  await a.close();
  await b.getByLabel('WebSocketメッセージ').fill('still connected');
  await b.getByRole('button', { name: '送信', exact: true }).click();
  await expect(b.getByTestId('socket-log')).toContainText(
    'Echo: still connected',
  );
  await b.close();
  await expect
    .poll(
      async () =>
        (await (await context.request.get('/api/stats')).json())
          .activeConnections,
    )
    .toBe(0);
});

test('API結果はタブ間で共有され、キャッシュヒットでは取得せず、再取得で更新する', async ({
  context,
}) => {
  const a = await openTab(context);
  const b = await openTab(context);
  const before = await stats(a);
  await a.getByRole('button', { name: 'データを取得', exact: true }).click();
  await expect(a.getByTestId('cache-source')).toContainText('network');
  await expect(b.getByTestId('request-id')).toHaveText(
    String(before.apiRequests + 1),
  );
  await b.getByRole('button', { name: 'データを取得', exact: true }).click();
  await expect(b.getByTestId('cache-source')).toContainText('cache /');
  expect((await stats(a)).apiRequests).toBe(before.apiRequests + 1);
  await b
    .getByRole('button', { name: '再取得（キャッシュ更新）', exact: true })
    .click();
  await expect(a.getByTestId('request-id')).toHaveText(
    String(before.apiRequests + 2),
  );
  const c = await openTab(context);
  await expect(c.getByTestId('request-id')).toHaveText(
    String(before.apiRequests + 2),
  );
  expect((await stats(c)).apiRequests).toBe(before.apiRequests + 2);
});

test('2タブから同時にAPIを要求しても取得中のPromiseが共有される', async ({
  context,
}) => {
  const a = await openTab(context);
  const b = await openTab(context);
  const before = await stats(a);
  const fetchFromWorker = (page: Page) =>
    page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const worker = new SharedWorker('/shared-worker.js', {
            name: 'angular20-shared-worker-hello-v2',
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
  const sources = await Promise.all([fetchFromWorker(a), fetchFromWorker(b)]);
  expect(sources.sort()).toEqual(['in-flight', 'network']);
  expect((await stats(a)).apiRequests).toBe(before.apiRequests + 1);
  await expect(a.getByTestId('request-id')).toHaveText(
    String(before.apiRequests + 1),
  );
  await expect(b.getByTestId('request-id')).toHaveText(
    String(before.apiRequests + 1),
  );
});

test('通知は送信元以外に届き、後から開いたタブには再送しない', async ({
  context,
}) => {
  const a = await openTab(context);
  const b = await openTab(context);
  await a.getByLabel('タブ間通知メッセージ').fill('タブAで保存しました');
  await a.getByRole('button', { name: '通知する', exact: true }).click();
  await expect(b.getByTestId('notification-log')).toContainText(
    'タブAで保存しました',
  );
  await expect(a.getByTestId('notification-log')).not.toContainText(
    'タブAで保存しました',
  );
  const c = await openTab(context);
  await expect(c.getByTestId('notification-log')).not.toContainText(
    'タブAで保存しました',
  );
});

test('リロード後も、別タブがあれば同じWorkerの状態を使う', async ({
  context,
}) => {
  const a = await openTab(context);
  const b = await openTab(context);
  await a.getByRole('button', { name: '+1 加算', exact: true }).click();
  await expect(b.getByTestId('counter')).toHaveText('1');
  const workerId = await b.getByTestId('worker-id').textContent();
  await a.reload();
  await expect(a.getByTestId('counter')).toHaveText('1');
  await expect(a.getByTestId('worker-id')).toHaveText(workerId!);
  await expect(b.getByTestId('tab-count')).toHaveText('2');
});

test('SharedWorker非対応なら理由を表示して操作を無効にする', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'SharedWorker', { value: undefined });
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('対応していません');
  await expect(
    page.getByRole('button', { name: '+1 加算', exact: true }),
  ).toBeDisabled();
});

test('TTL経過後の取得はAPIに再アクセスする', async ({ context }) => {
  test.setTimeout(45_000);
  const a = await openTab(context);
  const b = await openTab(context);
  const before = await stats(a);
  await a.getByRole('button', { name: 'データを取得', exact: true }).click();
  await expect(a.getByTestId('request-id')).toHaveText(
    String(before.apiRequests + 1),
  );
  // TTL境界を実際のSharedWorker内の時計で検証する。
  await a.waitForTimeout(30_100);
  await b.getByRole('button', { name: 'データを取得', exact: true }).click();
  await expect(a.getByTestId('request-id')).toHaveText(
    String(before.apiRequests + 2),
  );
  await expect(b.getByTestId('cache-source')).toContainText('network');
});

test('モバイル幅でも横にはみ出さず操作できる', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(
    page.getByText('Hello from SharedWorker!', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '+1 加算', exact: true }).click();
  await expect(page.getByTestId('counter')).toHaveText('1');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});
