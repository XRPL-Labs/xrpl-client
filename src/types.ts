import http = require("http");

export type AnyJson = Record<string, any>;

export interface EventBusEvents {
  __WsClient_call: (call: PendingCall) => void;
  __WsClient_close: () => void;
  reconnect: () => void;
  flush: () => void;
}

export declare interface EventBus {
  on<U extends keyof EventBusEvents>(
    event: U,
    listener: EventBusEvents[U]
  ): this;

  off<U extends keyof EventBusEvents>(
    event: U,
    listener: EventBusEvents[U]
  ): this;

  emit<U extends keyof EventBusEvents>(
    event: U,
    ...args: Parameters<EventBusEvents[U]>
  ): boolean;
}

export interface XrplClientEvents {
  close: () => void;
  retry: () => void;
  online: () => void;
  offline: () => void;
  round: () => void;

  nodeswitch: (endpoint: string) => void;

  state: (state: ConnectionState) => void;
  clusterinfo: (info: ClusterInfo) => void;

  message: (message: CallResponse | AnyJson) => void;
  transaction: (transaction: CallResponse | AnyJson) => void;
  validation: (validation: CallResponse | AnyJson) => void;
  path: (path: CallResponse | AnyJson) => void;
  ledger: (ledger: CallResponse | AnyJson) => void;
  error: (e: Error) => void;
}

export interface WsClientOptions {
  connectAttemptTimeoutSeconds?: number;
  maxConnectionAttempts?: number | null;
  assumeOfflineAfterSeconds?: number;
  httpHeaders?: http.OutgoingHttpHeaders;
  httpRequestOptions?: http.RequestOptions;
  // maxPendingCalls: number;
}

export type SendOptions = {
  sendIfNotReady?: boolean;
  noReplayAfterReconnect?: boolean;
  timeoutSeconds?: number;
  timeoutStartsWhenOnline?: boolean;
};

export interface Call extends AnyJson {
  id?: string | number;
  command: string;
}

export interface InternalCall extends AnyJson {
  id: PseudoId;
  command: string;
}

export type PseudoId = {
  _WsClient: number;
  _Request?: number | string;
};

export interface CallResponse extends AnyJson {
  id?: PseudoId;
  result?: AnyJson;
  status?: string;
  type?: string;
}

export interface PendingCall {
  id: number;
  request: InternalCall;
  promise: Promise<AnyJson>;
  promiseCallables: {
    resolve: CallableFunction;
    reject: CallableFunction;
  };
  sendOptions?: SendOptions;
  timeout?: ReturnType<typeof setTimeout>;
}

export interface ServerInfoResponse extends AnyJson {
  id?: string | number;
  result: {
    info: {
      build_version: string;
      complete_ledgers: string;
      hostid: string;
      io_latency_ms: number;
      jq_trans_overflow: string;
      last_close: AnyJson;
      load_factor: number;
      peer_disconnects: string;
      peer_disconnects_resources: string;
      peers: number;
      pubkey_node: string;
      server_state: string;
      server_state_duration_us: string;
      state_accounting: AnyJson;
      time: string;
      uptime: number;
      validated_ledger: AnyJson;
      validation_quorum: number;
    };
  };
}

export type ServerStateStatistic = {
  value: number;
  moment: Date;
};

export type ServerState = {
  validatedLedgers: string;
  reserveBase: number | null;
  reserveInc: number | null;
  fee: ServerStateStatistic[];
  latency: ServerStateStatistic[];
  connectAttempts: number;
};

export interface ConnectionState {
  online: boolean;
  latencyMs: {
    last: number | null;
    avg: number | null;
    secAgo: number | null;
  };
  server: {
    version: string;
    uptime: number;
    publicKey: string;
    uri: string;
  };
  ledger: {
    last: number;
    validated: string;
    count: number;
  };
  fee: {
    last: number | null;
    avg: number | null;
    secAgo: number | null;
  };
  reserve: {
    base: number | null;
    owner: number | null;
  };
  secLastContact: number | null;
}

export interface ClusterInfo extends AnyJson {
  status: string;
  type: string;
  uplinkCount: number;
  connectMoment: string;
  uplinkType: string;
  endpoint: string | null;
  preferredServer: string;
  counters: {
    rxCount: number;
    txCount: number;
    rxSize: number;
    txSize: number;
    uplinkReconnects: number;
  };
  headers: {
    origin: string;
    userAgent: string;
    acceptLanguage: string;
    xForwardedFor: string;
    requestUrl: string;
  };
}
