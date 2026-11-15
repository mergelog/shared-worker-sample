import { Injectable, OnDestroy, signal } from '@angular/core';
import type {
  ClientMessage,
  Snapshot,
  SocketMessage,
  WorkerMessage,
} from './protocol';

@Injectable({ providedIn: 'root' })
export class SharedWorkerService implements OnDestroy {
  readonly ready = signal(false);
  readonly greeting = signal('SharedWorkerに接続中…');
  readonly tabId = signal('—');
  readonly workerId = signal('—');
  readonly error = signal('');
  readonly snapshot = signal<Snapshot>({
    favorite: false,
    tabs: 0,
    cache: null,
    cacheLoading: false,
    socketStatus: 'disconnected',
  });
  readonly socketMessages = signal<SocketMessage[]>([]);
  readonly cacheSource = signal('まだ取得していません');
  readonly notifications = signal<
    Extract<WorkerMessage, { type: 'notification' }>[]
  >([]);
  private worker?: SharedWorker;

  constructor() {
    this.connect();
    window.addEventListener('pagehide', this.disconnect);
    window.addEventListener('pageshow', this.onPageShow);
  }

  // URL + name をすべてのタブで揃えると、同じ Worker につながる。
  private connect(): void {
    if (this.worker) return;
    if (typeof SharedWorker === 'undefined') {
      this.error.set(
        'このブラウザーはSharedWorkerに対応していません。対応ブラウザーで開いてください。',
      );
      this.greeting.set('SharedWorkerを利用できません');
      return;
    }
    try {
      this.worker = new SharedWorker(
        new URL('shared-worker.js', document.baseURI),
        {
          name: 'shared-product-demo-v1',
        },
      );
      this.worker.port.addEventListener(
        'message',
        (event: MessageEvent<WorkerMessage>) => {
          this.receive(event.data);
        },
      );
      this.worker.port.addEventListener('messageerror', () => {
        this.error.set(
          'Workerからのメッセージを読み取れませんでした。ページを再読み込みしてください。',
        );
      });
      this.worker.addEventListener('error', () => {
        this.ready.set(false);
        this.error.set(
          'SharedWorkerを起動できませんでした。配信URLとブラウザーのコンソールを確認してください。',
        );
      });
      this.worker.port.start();
    } catch (error) {
      this.worker = undefined;
      this.error.set(`SharedWorkerの接続に失敗しました: ${String(error)}`);
    }
  }

  send(message: ClientMessage): void {
    if (!this.ready()) return;
    this.error.set('');
    this.worker?.port.postMessage(message);
  }

  private receive(message: WorkerMessage): void {
    switch (message.type) {
      case 'hello':
        this.tabId.set(message.tabId);
        this.workerId.set(message.workerId);
        this.greeting.set(message.message);
        this.ready.set(true);
        break;
      case 'snapshot':
        this.snapshot.set(message.state);
        break;
      case 'socket:message':
        this.socketMessages.update((items) =>
          [message.message, ...items].slice(0, 20),
        );
        break;
      case 'cache:result':
        this.cacheSource.set(
          {
            network: 'network（APIから取得）',
            cache: 'cache（メモリから取得）',
            'in-flight': 'in-flight（取得中の要求を共有）',
          }[message.source],
        );
        break;
      case 'notification':
        this.notifications.update((items) => [message, ...items].slice(0, 20));
        break;
      case 'error':
        this.error.set(message.message);
        break;
    }
  }

  // pagehide はベストエフォート。BFCache から戻った場合は新しいポートで再接続する。
  private readonly disconnect = (): void => {
    this.worker?.port.postMessage({
      type: 'disconnect',
    } satisfies ClientMessage);
    this.worker?.port.close();
    this.worker = undefined;
    this.ready.set(false);
  };

  private readonly onPageShow = (event: PageTransitionEvent): void => {
    if (event.persisted) this.connect();
  };

  ngOnDestroy(): void {
    window.removeEventListener('pagehide', this.disconnect);
    window.removeEventListener('pageshow', this.onPageShow);
    this.disconnect();
  }
}
