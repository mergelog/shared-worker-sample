import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { SharedWorkerService } from './shared/shared-worker.service';

@Component({
  selector: 'app-root',
  imports: [DatePipe],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  readonly shared = inject(SharedWorkerService);
  // 画面を選ぶだけなので、ルーターを使わずクエリパラメーターで分ける。
  readonly isProduct =
    new URLSearchParams(location.search).get('page') === 'product';
  readonly sentNotification = signal(false);

  constructor() {
    document.title = this.isProduct ? '商品画面' : 'メイン画面';
  }

  notifyMain(): void {
    this.shared.send({
      type: 'notify',
      text: '商品画面のボタンが押されました。',
    });
    this.sentNotification.set(true);
  }
}
