import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SharedWorkerService } from './shared/shared-worker.service';

@Component({
  selector: 'app-root',
  imports: [DatePipe, FormsModule],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  readonly shared = inject(SharedWorkerService);
  socketText = 'Hello, WebSocket!';
  notificationText = 'タブAからこんにちは！';
  readonly sentNotification = signal('');

  sendSocket(): void {
    const text = this.socketText.trim();
    if (text) this.shared.send({ type: 'socket:send', text });
  }

  notify(): void {
    const text = this.notificationText.trim();
    if (!text) return;
    this.shared.send({ type: 'notify', text });
    this.sentNotification.set(`送信しました: ${text}`);
  }
}
