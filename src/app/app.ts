import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SharedWorkerService } from './shared/shared-worker.service';

// 番号だけをWorkerから受け取り、配色はタブ内で決める。
const TAB_THEMES = [
  {
    name: 'GREEN',
    background: '#e4f2e9',
    accent: '#176e4f',
    soft: '#d1e8d9',
    border: '#b5d5c1',
  },
  {
    name: 'BLUE',
    background: '#e2edfc',
    accent: '#245caa',
    soft: '#d0e0f7',
    border: '#b6cce9',
  },
  {
    name: 'ROSE',
    background: '#fbe6eb',
    accent: '#a33257',
    soft: '#f5d3de',
    border: '#e7b7c6',
  },
  {
    name: 'AMBER',
    background: '#fbefd8',
    accent: '#885608',
    soft: '#f3e1b9',
    border: '#deca9e',
  },
  {
    name: 'VIOLET',
    background: '#eee5fc',
    accent: '#7241a6',
    soft: '#e1d3f4',
    border: '#cdb7e7',
  },
  {
    name: 'TEAL',
    background: '#ddf2f3',
    accent: '#146c76',
    soft: '#c8e6e9',
    border: '#a8d0d5',
  },
] as const;

@Component({
  selector: 'app-root',
  imports: [DatePipe, FormsModule],
  templateUrl: './app.html',
  host: {
    '[style.--tab-background]': 'tabTheme().background',
    '[style.--tab-accent]': 'tabTheme().accent',
    '[style.--tab-soft]': 'tabTheme().soft',
    '[style.--tab-border]': 'tabTheme().border',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  readonly shared = inject(SharedWorkerService);
  readonly tabTheme = computed(
    () =>
      TAB_THEMES[Math.max(0, this.shared.tabNumber() - 1) % TAB_THEMES.length],
  );
  readonly tabLabel = computed(() =>
    this.shared.tabNumber()
      ? `TAB ${String(this.shared.tabNumber()).padStart(2, '0')}`
      : '接続中…',
  );
  socketText = 'Hello, WebSocket!';
  notificationText = 'こんにちは！';
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
