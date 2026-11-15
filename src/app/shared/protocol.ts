// Angular と Worker が共有する「メッセージの約束」。ランタイム依存は置かない。
export interface ApiData {
  product: { id: number; name: string; price: number };
  requestId: number;
  fetchedAt: string;
}

export type SocketStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

export interface Snapshot {
  favorite: boolean;
  tabs: number;
  cache: ApiData | null;
  cacheLoading: boolean;
  socketStatus: SocketStatus;
}

export interface SocketMessage {
  kind: 'connected' | 'echo' | 'tick';
  connectionId: string;
  activeConnections: number;
  text: string;
  timestamp: string;
}

export type ClientMessage =
  | { type: 'favorite:set'; favorite: boolean }
  | { type: 'socket:connect' }
  | { type: 'socket:send'; text: string }
  | { type: 'cache:get'; refresh: boolean }
  | { type: 'notify'; text: string }
  | { type: 'disconnect' };

export type WorkerMessage =
  | {
      type: 'hello';
      tabId: string;
      workerId: string;
      message: string;
    }
  | { type: 'snapshot'; state: Snapshot }
  | { type: 'socket:message'; message: SocketMessage }
  | {
      type: 'cache:result';
      source: 'network' | 'cache' | 'in-flight';
      requestedBy: string;
    }
  | { type: 'notification'; from: string; text: string; timestamp: string }
  | { type: 'error'; message: string };
