export type AnyJson = Record<string, unknown>;

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

export interface WsClientOptions {
  connectAttemptTimeoutSeconds?: number;
  assumeOfflineAfterSeconds?: number;
  // maxPendingCalls: number;
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
