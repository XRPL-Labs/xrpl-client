import { default as assert } from "assert";
import { EventEmitter } from "events";
import { debug as Debug } from "debug";
import {
  ICloseEvent,
  IMessageEvent,
  w3cwebsocket as WebSocket,
} from "websocket";

import {
  WsClientOptions,
  PendingCall,
  CallResponse,
  Call,
  AnyJson,
  ServerInfoResponse,
  ConnectionState,
  ServerState,
  SendOptions,
  EventBus,
  XrplClientEvents,
  ClusterInfo,
  ConnectReinstateOptions,
  serverInfoAndState,
} from "./types";
import { isContext } from "vm";

export * from "./types";

const log = Debug("xrplclient");

const logWarning = log.extend("warning");
const logMessage = log.extend("message");
const logNodeInfo = log.extend("node");

const connectAttemptTimeoutSeconds = 3;
const assumeOfflineAfterSeconds = 15;
const maxConnectionAttempts = null;
const feeCushion = 1.2;
const feeDropsDefault = 12;
const feeDropsMax = 3600;
const tryAllNodes = false;

export declare interface XrplClient {
  on<U extends keyof XrplClientEvents>(
    event: U,
    listener: XrplClientEvents[U]
  ): this;
}

const endpointParser = (endpoint?: string | string[]): string[] => {
  let endpoints: string[] = [];

  if (endpoint) {
    endpoints = [
      ...new Set<string>(Array.isArray(endpoint) ? endpoint : [endpoint]),
    ]
      .map((uplink) => uplink.trim())
      .filter((uplink) => uplink.match(/^ws[s]{0,1}:\/\//));
  }

  if (endpoints.length < 1) {
    endpoints = [
      "wss://xrplcluster.com",
      "wss://xrpl.link",
      "wss://s2.ripple.com",
    ];
    logWarning(
      "No valid WebSocket endpoint(s) specified, falling back to defaults",
      endpoints
    );
  }

  return endpoints;
};

export class XrplClient extends EventEmitter {
  private eventBus: EventBus = new EventEmitter();

  private closed: boolean = false;
  private destroyed: boolean = false;
  private uplinkReady: boolean = false;

  private options: WsClientOptions = {
    connectAttemptTimeoutSeconds,
    assumeOfflineAfterSeconds,
    maxConnectionAttempts,
    feeDropsDefault,
    feeDropsMax,
    tryAllNodes,
  };

  private callId: number = 0;
  private endpoints: string[];
  private endpoint: string;
  private connection?: WebSocket;

  private pendingCalls: PendingCall[] = [];
  private subscriptions: PendingCall[] = [];

  private clusterInfo_?: ClusterInfo;
  private serverInfo?: ServerInfoResponse;
  private serverState: ServerState = {
    validatedLedgers: "",
    reserveBase: null,
    reserveInc: null,
    latency: [],
    fee: [],
    connectAttempts: -1,
  };

  private lastContact?: Date;

  constructor(endpoint?: string | string[], options?: WsClientOptions) {
    super();

    if (options) {
      Object.assign(this.options, options);
    }

    this.endpoints = endpointParser(endpoint);

    /**
     * Alive timer
     */
    let livelinessCheck: ReturnType<typeof setTimeout>;

    const alive = (): void => {
      // log('Start alive timer')
      clearTimeout(livelinessCheck);
      const seconds =
        Number(
          this?.options?.assumeOfflineAfterSeconds || assumeOfflineAfterSeconds
        ) * 1_000;
      livelinessCheck = setTimeout(() => {
        // Only if the connection ever was online to begin with
        if (this.uplinkReady) {
          logWarning(`Conn. TIMEOUT, no ledger for ${seconds} sec.`);
          try {
            log("Close #6");
            this?.connection?.close();
          } catch (e) {}
        }
      }, seconds);
    };
    alive();

    const reconnectTime = (): number => {
      let factor = 1;

      const attempts =
        this.options?.maxConnectionAttempts || maxConnectionAttempts;

      if (attempts) {
        factor =
          ((this.options?.connectAttemptTimeoutSeconds ||
            connectAttemptTimeoutSeconds) -
            1) /
          (attempts - 1);
      }

      const reconnectSeconds = Math.max(
        1.5,
        (this.serverState.connectAttempts + 1) * factor
      );

      return reconnectSeconds;
    };

    this.endpoint = this.endpoints[0].trim();

    if (this.endpoints.length > 1 && !this.options?.maxConnectionAttempts) {
      log(
        `Multiple endpoints (${this.endpoints.length}) and no maxConnection attempts, set (3)`
      );
      Object.assign(this.options, { maxConnectionAttempts: 3 });
    }

    log(`Initialized xrpld WebSocket Client`);

    this.on("ledger", () => {
      connectionReady();
      alive();
    });

    const ignore = (): void => {};

    /**
     * Important one
     */
    const connectionReady = (): void => {
      if (!this.uplinkReady) {
        this.serverState.connectAttempts = 0;

        logNodeInfo("Connection ready, fire events");

        this.uplinkReady = true;
        this.eventBus.emit("flush");
        this.emit("online");
        this.emit("state", this.getState());
      }
    };

    /**
     * WebSocket client event handlers
     */
    const WsOpen = (): void => {
      /**
       * We're firing two commands when we're connected
       */
      if (!this.closed && this?.connection?.readyState === WebSocket.OPEN) {
        log("Connection opened :)");

        /**
         * XRPL Cluster state
         */
        if (
          this.endpoint.match(/^wss:\/\/(xrplcluster\.com|xrpl\.link|xrpl\.ws)/)
        ) {
          try {
            this?.connection?.send(
              JSON.stringify({ __api: "state", origin: "xrpl-client@js/ts" })
            );
          } catch (e) {}
        }

        /**
         * Mandatory messages on connect
         */
        this.send(
          {
            id: "_WsClient_Internal_Subscription",
            command: "subscribe",
            streams: ["ledger"],
          },
          { sendIfNotReady: true, noReplayAfterReconnect: true }
        ).then(ignore, ignore);

        this.send(
          {
            id: "_WsClient_Internal_ServerInfo@" + Number(new Date()),
            command: "server_info",
          },
          { sendIfNotReady: true, noReplayAfterReconnect: true }
        ).then(() => {
          connectionReady();
        }, ignore);
      } else {
        try {
          log("Close #1");
          this?.connection?.close();
        } catch (e) {
          // If timing: came online after close: kill
        }
      }
    };

    const WsClose = (event: ICloseEvent): void => {
      this.emit("close");
      this.emit("state", this.getState());

      if (this.uplinkReady) {
        // Was online
        this.emit("offline");
        // Was online, so start a new cycle instead of trying the next node
        this.endpoint = this.endpoints[0];
      }
      this.uplinkReady = false;
      this.serverInfo = undefined;

      logWarning("Upstream/Websocket closed", event?.code, event?.reason);
      WsCleanup();

      if (!this.closed) {
        this.emit("retry");

        logWarning(
          `Not closed on purpose, reconnecting after ${reconnectTime()}...`
        );

        setTimeout(() => {
          this.eventBus.emit("reconnect");
        }, reconnectTime() * 1000);
      } else {
        log("Closed on purpose, not reconnecting");
      }
    };

    const handleServerInfo = (
      message: CallResponse,
      returnOnly = false
    ): void | serverInfoAndState => {
      if (message?.result?.info) {
        const serverState = returnOnly
          ? Object.assign({}, this.serverState)
          : this.serverState;

        const serverInfo = message as ServerInfoResponse;

        if (!this.serverInfo) {
          if (!returnOnly) {
            logNodeInfo("Connected, server_info:", {
              pubkey_node: serverInfo.result.info.pubkey_node,
              build_version: serverInfo.result.info.build_version,
              complete_ledgers: serverInfo.result.info.complete_ledgers,
            });
          }
        }

        if (serverInfo?.result?.info?.validated_ledger?.reserve_base_xrp) {
          serverState.reserveBase =
            Number(serverInfo.result.info.validated_ledger.reserve_base_xrp) ||
            null;
        }

        if (serverInfo?.result?.info?.validated_ledger?.reserve_inc_xrp) {
          serverState.reserveInc =
            Number(serverInfo.result.info.validated_ledger.reserve_inc_xrp) ||
            null;
        }

        if (serverInfo?.result?.info?.complete_ledgers) {
          serverState.validatedLedgers =
            serverInfo.result.info.complete_ledgers;
        }

        const msRoundTrip =
          Number(new Date()) -
          Number(
            String(message?.id || "")
              .split("@")
              .reverse()[0]
          );

        if (msRoundTrip) {
          serverState.latency.push({
            moment: new Date(),
            value: msRoundTrip,
          });

          serverState.latency.splice(0, serverState.latency.length - 10);
        }

        const fee =
          Number(
            serverInfo.result.info?.validated_ledger?.base_fee_xrp ||
              (this.options.feeDropsDefault || feeDropsDefault) / 1_000_000
          ) *
          1_000_000 *
          feeCushion;

        if (fee && fee <= (this.options.feeDropsMax || feeDropsMax)) {
          serverState.fee.push({
            moment: new Date(),
            value: fee,
          });

          serverState.fee.splice(0, serverState.fee.length - 5);
        }

        if (!returnOnly) {
          this.serverInfo = serverInfo;
        } else {
          return { serverInfo, serverState };
        }
      }
    };

    const handleAsyncWsMessage = (message: CallResponse): void => {
      if (message?.id?._Request !== "_WsClient_Internal_Subscription") {
        let matchingSubscription;

        if (message?.id?._WsClient) {
          const _matching = this.subscriptions.filter(
            (s) => s.id === message?.id?._WsClient
          );
          if (_matching.length > 0) {
            matchingSubscription = _matching[0];
            matchingSubscription.promiseCallables.resolve(
              Object.assign(message, {
                id: message?.id?._Request,
              })
            );
          }
        }

        this.emit("message", message);

        if (
          message?.type === "ledgerClosed" &&
          typeof message?.validated_ledgers === "string"
        ) {
          logMessage("Async", message.type);

          Object.assign(this.serverState, {
            validatedLedgers: message.validated_ledgers,
            reserveBase: Number(message?.reserve_base) / 1_000_000 || null,
            reserveInc: Number(message?.reserve_inc) / 1_000_000 || null,
          });

          this.emit("ledger", message);

          /**
           * Always request a server_info for a received ledger as well
           */
          this.send({
            id: "_WsClient_Internal_ServerInfo@" + Number(new Date()),
            command: "server_info",
          }).then(ignore, ignore);
        } else if (message?.type === "path_find") {
          logMessage("Async", message.type);
          this.emit("path", message);
        } else if (message?.type === "transaction") {
          logMessage("Async", message.type);
          this.emit("transaction", message);
        } else if (message?.validation_public_key) {
          logMessage("Async", "validation");
          this.emit("validation", message);
        } else {
          if (matchingSubscription?.request?.command === "path_find") {
            logMessage("Async", matchingSubscription?.request?.command);
            this.emit("path", message);
          } else if (
            matchingSubscription?.request?.command === "subscribe" &&
            Array.isArray(matchingSubscription?.request?.streams) &&
            matchingSubscription?.request?.streams.indexOf("ledger") > -1
          ) {
            logMessage("Async", "subscription:ledger");
            this.emit("ledger", message?.result ? message.result : message);
          } else if (matchingSubscription) {
            // Don't log `Unknown` as we know this
          } else {
            const isInternal =
              message?.id?._Request &&
              String(message.id._Request).match(/^_WsClient_Internal/);

            if (!isInternal) {
              try {
                const clusterInfo = message as ClusterInfo;
                if (clusterInfo?.type === "PROXY") {
                  this.clusterInfo_ = clusterInfo;
                  this.emit("clusterinfo", this.clusterInfo_);
                  return;
                }
              } catch (e) {}
              logMessage(`Handle <UNKNOWN> Async Message`, {
                internalId: message?.id?._WsClient,
                matchingSubscription,
                type: message?.type,
                message,
              });
            }
          }
        }
      }
    };

    const WsMessage = (message: IMessageEvent): void => {
      try {
        assert(
          typeof message.data === "string",
          "Unexpected incoming WebSocket message data type"
        );

        const messageJson: CallResponse = JSON.parse(message.data);

        this.lastContact = new Date();

        if (messageJson?.id?._WsClient) {
          // Got response on a command, process accordingly
          const matchingSubscription = this.subscriptions.filter((call) => {
            return call.id === messageJson?.id?._WsClient;
          });

          const matchingCall = this.pendingCalls.filter((call) => {
            return call.id === messageJson?.id?._WsClient;
          });

          if (matchingSubscription.length === 1) {
            handleAsyncWsMessage(messageJson);
          } else if (matchingCall.length === 1) {
            const internalServerInfoCall =
              String(matchingCall[0]?.request?.id?._Request || "").split(
                "@"
              )[0] === "_WsClient_Internal_ServerInfo";

            Object.assign(messageJson, {
              id: messageJson?.id?._Request,
            });

            if (
              matchingCall[0].sendOptions?.timeoutSeconds &&
              matchingCall[0].timeout
            ) {
              clearTimeout(matchingCall[0].timeout);
            }

            matchingCall[0].promiseCallables.resolve(
              messageJson?.result || messageJson
            );

            this.pendingCalls.splice(
              this.pendingCalls.indexOf(matchingCall[0]),
              1
            );

            if (!internalServerInfoCall) {
              log("» Pending Call Length", this.pendingCalls.length);
            } else {
              handleServerInfo(messageJson);
            }
          } else {
            // Subscription/path finding ack
            handleAsyncWsMessage(messageJson);
          }
        } else {
          // Subscription/path finding followup
          handleAsyncWsMessage(messageJson);
        }
      } catch (e) {
        logWarning("Uplink response: parse error", e.message);
      }
    };

    const WsError = (error: Error): void => {
      logWarning("Upstream/Websocket error");
    };

    const applyCallTimeout = (call: PendingCall): void => {
      if (call?.sendOptions?.timeoutSeconds && !call?.timeout) {
        Object.assign(call, {
          timeout: setTimeout(async () => {
            const didTimeout =
              (await Promise.race([
                call.promise,
                Promise.resolve("_WsClient_Internal_CallResolved"),
              ])) === "_WsClient_Internal_CallResolved";

            if (didTimeout) {
              call.promiseCallables.reject(
                new Error(
                  `Call timeout after ${call.sendOptions?.timeoutSeconds} seconds`
                )
              );
            }
          }, Number(call.sendOptions.timeoutSeconds) * 1_000),
        });
      }
    };

    const process = (call: PendingCall): void => {
      // const isSubscription = call.request.command === "subscribe";
      if (
        String(call?.request?.id?._Request || "").split("@")[0] !==
        "_WsClient_Internal_ServerInfo"
      ) {
        log("  > Process call", call.id, call.request.command);
      }
      try {
        // log(call.request);
        this?.connection?.send(JSON.stringify(call.request));
        if (call?.sendOptions?.timeoutStartsWhenOnline) {
          // logWarning("APPLY TIMEOUT ONLY AFTER GOING ONLINE");
          applyCallTimeout(call);
        }
      } catch (e) {
        logWarning("Process (send to uplink) error", e.message);
      }
    };

    const call = (call: PendingCall): void => {
      if (
        String(call?.request?.id?._Request || "").split("@")[0] !==
        "_WsClient_Internal_ServerInfo"
      ) {
        log(
          `Call ${call.id}: ${call.request.command}\n   > `,
          this.uplinkReady
            ? "Uplink ready, pass immediately"
            : call?.sendOptions?.sendIfNotReady
            ? "Uplink not flagged as ready yet, but `sendIfNotReady` = true, so go ahead"
            : "Uplink not ready, wait for flush"
        );
      }

      if (!call?.sendOptions?.timeoutStartsWhenOnline) {
        // logWarning("APPLY TIMEOUT NO MATTER ONLINE/OFFLINE STATE");
        applyCallTimeout(call);
      }

      if (this.uplinkReady || call?.sendOptions?.sendIfNotReady) {
        process(call);
      }
    };

    const flush = (): void => {
      /**
       * Flush all pending calls & subscriptions
       * to new uplink.
       */
      log("Connected, flushing pending calls & subscriptions");
      this.pendingCalls.forEach((call: PendingCall): void => {
        process(call);
      });
      this.subscriptions.forEach((call: PendingCall): void => {
        process(call);
      });
    };

    const reinstate = (options?: ConnectReinstateOptions): void => {
      assert(!this.destroyed, "Object is in destroyed state");

      log("Reinstating..., options:", options || {});

      if (options?.forceNextUplink) {
        this.uplinkReady = false; // Prevents going back to endpoint[0]
        clearTimeout(livelinessCheck);
        selectNextUplink();
      } else {
        this.closed = false;
        alive();
      }

      connect();
    };

    const close = (error?: Error): void => {
      log("Closing connection");
      this.emit("close");

      this.closed = true;

      try {
        log("Close #2");
        this?.connection?.close();
      } catch (e) {
        //
      }

      clearTimeout(livelinessCheck);

      if (error) {
        this.emit("error", error);
      }
    };

    const destroy = (error?: Error): void => {
      this.destroyed = true;

      close(error);

      WsCleanup();

      this.subscriptions.forEach((subscription) => {
        subscription.promiseCallables.reject(
          new Error("Class (connection) hard close requested")
        );
      });
      this.pendingCalls.forEach((call) => {
        call.promiseCallables.reject(
          new Error("Class (connection) hard close requested")
        );
      });

      this.eventBus.off("__WsClient_call", call);
      this.eventBus.off("__WsClient_destroy", destroy);
      this.eventBus.off("__WsClient_close", close);
      this.eventBus.off("__WsClient_reinstate", reinstate);
      this.eventBus.off("flush", flush);
      this.eventBus.off("reconnect", connect);
    };

    const WsCleanup = (): void => {
      log("Cleanup");
      (this?.connection as any).removeEventListener("open", WsOpen);
      (this?.connection as any).removeEventListener("message", WsMessage);
      (this?.connection as any).removeEventListener("error", WsError);
      (this?.connection as any).removeEventListener("close", WsClose);
    };

    const selectNextUplink = () => {
      const nextEndpointIndex = this.endpoints.indexOf(this.endpoint) + 1;
      logWarning("--- Current endpoint", this.endpoint);
      this.endpoint =
        this.endpoints[
          nextEndpointIndex >= this.endpoints.length ? 0 : nextEndpointIndex
        ];
      logWarning("--- New endpoint", this.endpoint);
      this.serverState.connectAttempts = 0;
      this.emit("nodeswitch", this.endpoint);
      if (nextEndpointIndex >= this.endpoints.length) {
        this.emit("round");
      }
    };

    const connect = (): WebSocket | undefined => {
      try {
        log("Close #3");
        WsCleanup();
        this?.connection?.close();
      } catch (e) {
        //
      }

      log("connect()", this.endpoint);

      this.serverState.connectAttempts++;

      if (
        this.options.maxConnectionAttempts &&
        Number(this.options?.maxConnectionAttempts || 1) > 1 &&
        this.serverState.connectAttempts >=
          Number(this.options?.maxConnectionAttempts || 1)
      ) {
        logNodeInfo(
          "Too many connection attempts",
          this.serverState.connectAttempts,
          this.options?.maxConnectionAttempts
        );

        log(
          this.endpoint,
          this.endpoints,
          this.endpoints.length,
          this.endpoints.indexOf(this.endpoint)
        );
        if (
          this.endpoints.length > 1 &&
          this.endpoints.indexOf(this.endpoint) > -1
        ) {
          logWarning(
            "Multiple endpoints, max. connection attempts exceeded. Switch endpoint."
          );
          selectNextUplink();
        } else {
          logWarning(
            "Only one valid endpoint, after the max. connection attempts: game over"
          );
          close(new Error("Max. connection attempts exceeded"));
        }
      }

      if (!this.closed) {
        if (this.options.tryAllNodes) {
          logWarning(
            "!!!".repeat(30) +
              "\n!!!\n!!!    Trying all nodes. WARNING! IF YOU DO NOT EXPLICITLY NEED THIS,\n!!!    DO NOT USE THE `tryAllNodes` OPTION (to prevent wasting resources)\n!!!\n" +
              "!!!".repeat(30) +
              "\n"
          );
        }

        const allEndpoints = (
          this.options.tryAllNodes ? this.endpoints : [this.endpoint]
        ).map((endpoint) => {
          log("Connecting", endpoint);
          const connection = new WebSocket(
            endpoint, // url
            undefined, // protocols
            undefined, // origin
            Object.assign(this.options?.httpHeaders || {}, {
              "user-agent": "xrpl-client@js/ts",
            }), // headers
            this.options?.httpRequestOptions || {}, // requestOptions
            {
              maxReceivedFrameSize: 0x80000000, // 2GB
              maxReceivedMessageSize: 0x200000000, // 8GB
            } // IClientConfig
          );

          // Prevent possible DNS resolve hang, and a custom
          // resolver sucks
          setTimeout(() => {
            if (
              connection.readyState !== WebSocket.OPEN &&
              this.connection?.readyState !== WebSocket.OPEN
            ) {
              log("Close #4 -- FORCED, inner connection timeout");
              connection.close();
              if (!this.options.tryAllNodes) {
                this.eventBus.emit("reconnect");
              }
            }
          }, reconnectTime() * 1000 - 1);

          const raceOpenHandler = () => {
            log("OPEN", endpoint);
            connection.send(JSON.stringify({ command: "server_info" }));
          };

          const raceMessageHandler = (message: IMessageEvent): void => {
            assert(
              typeof message.data === "string",
              "Unexpected incoming WebSocket message data type"
            );

            const messageJson: CallResponse = JSON.parse(message.data);
            const handledServerInfo = handleServerInfo(messageJson, true);

            if (handledServerInfo) {
              const serverState = this.getState(handledServerInfo.serverState);
              if (
                typeof serverState.ledger.last === "number" &&
                (Number(serverState.ledger.count || 0) || 0) > 0
              ) {
                // This one is first & sane
                logNodeInfo("Race won by endpoint:", {
                  endpoint,
                  build_version:
                    handledServerInfo.serverInfo.result.info.build_version,
                  complete_ledgers:
                    handledServerInfo.serverInfo.result.info.complete_ledgers,
                  pubkey_node:
                    handledServerInfo.serverInfo.result.info.pubkey_node,
                });

                // this.options.tryAllNodes = false;
                this.connection = connection;
                this.endpoint = endpoint;

                WsOpen();
                WsMessage(message);

                allEndpoints.forEach((iConnection) => {
                  (iConnection as any).removeEventListener(
                    "open",
                    raceOpenHandler
                  );
                  (iConnection as any).removeEventListener(
                    "message",
                    raceMessageHandler
                  );

                  if (iConnection != connection) {
                    log("Close #5");
                    iConnection.close();
                    logNodeInfo(
                      "Cleanup: closing connection & clearing event listeners for lost race connection",
                      iConnection.url
                    );
                  } else {
                    logNodeInfo(
                      "Cleanup: cleared event listeners for winning node",
                      iConnection.url
                    );
                  }
                });

                (connection as any).addEventListener("open", WsOpen);
                (connection as any).addEventListener("message", WsMessage);
                (connection as any).addEventListener("error", WsError);
                (connection as any).addEventListener("close", WsClose);
              }
            }
          };

          (connection as any).addEventListener("open", raceOpenHandler);
          (connection as any).addEventListener("message", raceMessageHandler);

          return connection;
        });
      }

      return this?.connection;
    };

    this.eventBus.on("__WsClient_call", call);
    this.eventBus.on("__WsClient_destroy", destroy);
    this.eventBus.on("__WsClient_close", close);
    this.eventBus.on("__WsClient_reinstate", reinstate);
    this.eventBus.on("flush", flush);
    this.eventBus.on("reconnect", connect);

    connect();
  }

  ready(): Promise<XrplClient> {
    return new Promise((resolve, reject) => {
      const state = this.getState();
      if (
        state.online &&
        state.secLastContact &&
        state.secLastContact < 10 &&
        state.ledger.last
      ) {
        // We're good
        return resolve(this);
      } else {
        // Let's wait to make sure we're really connected
        this.on("ledger", () => {
          resolve(this);
        });
      }
    });
  }

  send(call: Call, sendOptions: SendOptions = {}): Promise<AnyJson> {
    assert(
      typeof call === "object" && call,
      "`send()`: expecting object containing `command`"
    );
    assert(typeof call.command === "string", "`command` must be typeof string");

    this.callId++;

    const promiseCallables = {
      resolve: (arg: AnyJson): void => {},
      reject: (arg: Error): void => {},
    };

    const promise = new Promise<AnyJson>((resolve, reject): void => {
      Object.assign(promiseCallables, { resolve, reject });
    });

    const pendingCall: PendingCall = {
      id: this.callId,
      request: Object.assign(call, {
        id: {
          _WsClient: this.callId,
          _Request: call?.id,
        },
        command: call.command.toLowerCase().trim(),
      }),
      promise,
      promiseCallables,
      sendOptions,
    };

    if (this.destroyed) {
      promiseCallables.reject(new Error("Client in destroyed state"));
      return promise;
    }

    const isSubscription =
      (pendingCall.request.command === "subscribe" ||
        pendingCall.request.command === "unsubscribe" ||
        pendingCall.request.command === "path_find") &&
      !sendOptions?.noReplayAfterReconnect;

    if (
      pendingCall.request?.command === "unsubscribe" &&
      Array.isArray(pendingCall.request?.streams) &&
      pendingCall.request?.streams.indexOf("ledger") > -1
    ) {
      pendingCall.request.streams.splice(
        pendingCall.request.streams.indexOf("ledger"),
        1
      );

      if (
        pendingCall.request.streams.length === 0 &&
        Object.keys(pendingCall.request).filter(
          (key) => key !== "id" && key !== "streams" && key !== "command"
        ).length === 0
      ) {
        // Unsubscribing (just) streams
        return Promise.reject(
          new Error(
            "Unsubscribing from (just) the ledger stream is not allowed"
          )
        );
      }
    }

    if (
      String(call?.id || "").split("@")[0] !== "_WsClient_Internal_ServerInfo"
    ) {
      this[isSubscription ? "subscriptions" : "pendingCalls"].push(pendingCall);
    }

    this.eventBus.emit("__WsClient_call", pendingCall);

    return promise;
  }

  getState(forcedServerState?: ServerState): ConnectionState {
    const serverState = forcedServerState
      ? forcedServerState
      : this.serverState;

    const ledgerCount = serverState.validatedLedgers
      .split(",")
      .map((m: string) => {
        const Range = m.split("-");
        return Range.length > 1 ? parseInt(Range[1]) - parseInt(Range[0]) : 1;
      })
      .reduce((a, b) => a + b, 0);

    return {
      online:
        this.uplinkReady &&
        !this.closed &&
        this?.connection?.readyState === WebSocket.OPEN,
      latencyMs: {
        last:
          serverState.latency
            .slice(-1)
            .map((latencyRecord) => latencyRecord.value)[0] || null,
        avg:
          serverState.latency
            .map((latencyRecord) => latencyRecord.value)
            .reduce((a, b) => a + b, 0) / serverState.latency.length || null,
        secAgo:
          Number(new Date()) / 1000 -
            serverState.latency
              .slice(-1)
              .map((latencyRecord) => Number(latencyRecord.moment) / 1000)[0] ||
          null,
      },
      server: {
        version: this.serverInfo?.result?.info?.build_version || "",
        uptime: this.serverInfo?.result?.info?.uptime || 0,
        publicKey: this.serverInfo?.result?.info?.pubkey_node || "",
        uri: this.endpoint,
      },
      ledger: {
        last: Number(
          serverState.validatedLedgers
            .split(",")
            .reverse()[0]
            .split("-")
            .reverse()[0]
        ),
        validated: serverState.validatedLedgers,
        count: serverState.validatedLedgers === "" ? 0 : ledgerCount,
      },
      fee: {
        last:
          serverState.fee.slice(-1).map((feeRecord) => feeRecord.value)[0] ||
          this.options.feeDropsDefault ||
          feeDropsDefault,
        avg:
          serverState.fee
            .map((feeRecord) => feeRecord.value)
            .reduce((a, b) => a + b, 0) / serverState.fee.length ||
          this.options.feeDropsDefault ||
          feeDropsDefault,
        secAgo:
          Number(new Date()) / 1000 -
            serverState.fee
              .slice(-1)
              .map((feeRecord) => Number(feeRecord.moment) / 1000)[0] || null,
      },
      reserve: {
        base: serverState.reserveBase,
        owner: serverState.reserveInc,
      },
      secLastContact: this.lastContact
        ? Number(new Date()) / 1000 - Number(this.lastContact) / 1000
        : null,
    };
  }

  close(): void {
    // assert(!this.closed, "Object already in closed state");
    log(`> CLOSE`);
    this.eventBus.emit("__WsClient_close");
  }

  reinstate(options?: ConnectReinstateOptions): void {
    // assert(!this.closed, "Object already reinstated state");
    log(`> REINSTATE`);
    this.eventBus.emit("__WsClient_reinstate", options);
  }

  destroy(): void {
    // assert(!this.closed, "Object already in destroyed state");
    log(`> DESTROY`);
    this.eventBus.emit("__WsClient_destroy");
  }

  clusterInfo(): Promise<ClusterInfo | false> {
    return new Promise((resolve, reject) => {
      if (this.clusterInfo_) {
        // We're good
        return resolve(this.clusterInfo_);
      } else {
        // Let's wait to make sure we're really connected
        this.on("clusterinfo", (info) => {
          resolve(info);
        });
      }
    });
  }
}
