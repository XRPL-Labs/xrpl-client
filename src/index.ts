import assert from "assert";
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
} from "./types";

export * from "./types";

const log = Debug("xrplclient");

const logWarning = log.extend("warning");
const logMessage = log.extend("message");
const logNodeInfo = log.extend("node");

const connectAttemptTimeoutSeconds = 4;
const assumeOfflineAfterSeconds = 20;
const maxConnectionAttempts = null;

export class XrplClient extends EventEmitter {
  private connectBackoff: number = 1000 / 1.2;
  private closed: boolean = false;
  private uplinkReady: boolean = false;

  private options: WsClientOptions = {
    connectAttemptTimeoutSeconds,
    assumeOfflineAfterSeconds,
    maxConnectionAttempts,
  };

  private callId: number = 0;
  private endpoint: string;
  private connection: WebSocket;

  private pendingCalls: PendingCall[] = [];
  private subscriptions: PendingCall[] = [];

  private serverInfo?: ServerInfoResponse;
  private serverState: ServerState = {
    validatedLedgers: "",
    reserveBase: null,
    reserveInc: null,
    latency: [],
    fee: [],
    connectAttempts: 0,
  };

  private lastContact?: Date;

  constructor(endpoint = "wss://xrplcluster.com", options?: WsClientOptions) {
    super();

    if (options) {
      Object.assign(this.options, options);
    }

    /**
     * Alive timer
     */
    let livelinessCheck: ReturnType<typeof setTimeout>;
    const alive = (): void => {
      clearTimeout(livelinessCheck);
      const seconds =
        Number(
          this?.options?.assumeOfflineAfterSeconds || assumeOfflineAfterSeconds
        ) * 1_000;
      livelinessCheck = setTimeout(() => {
        logWarning(
          "----- CONNECTION TIMEOUT, NO LEDER INFO RECEIVED FOR ",
          seconds,
          "SECONDS -----"
        );
        try {
          this.connection?.close();
        } catch (e) {
          //
        }
      }, seconds);
    };
    alive();

    // setInterval(() => {
    //   log("» Pending Call Length", this.pendingCalls.length);
    // }, 5000);

    this.endpoint = endpoint.trim();

    log(`Initialized xrpld WebSocket Client`);

    this.on("ledger", () => {
      connectionReady();
      alive();
    });

    /**
     * Important one
     */
    const connectionReady = (): void => {
      if (!this.uplinkReady) {
        this.serverState.connectAttempts = 0;

        logNodeInfo("Connection ready, fire events");

        this.connectBackoff = 1000 / 1.2;
        this.uplinkReady = true;
        this.emit("flush");
        this.emit("state", this.getState());
      }
    };

    /**
     * WebSocket client event handlers
     */
    const WsOpen = (): void => {
      log("Connection opened :)");

      /**
       * We're firing two commands when we're connected
       */
      this.send(
        {
          id: "_WsClient_Internal_Subscription",
          command: "subscribe",
          streams: ["ledger"],
        },
        { sendIfNotReady: true, noReplayAfterReconnect: true }
      );

      this.send(
        {
          id: "_WsClient_Internal_ServerInfo@" + Number(new Date()),
          command: "server_info",
        },
        { sendIfNotReady: true, noReplayAfterReconnect: true }
      ).then(() => {
        connectionReady();
      });

      // setTimeout(() => {
      //   // this.connection.close();
      //   // (this.connection as any).removeEventListener("message", WsMessage);
      // }, 5000);
    };

    const WsClose = (event: ICloseEvent): void => {
      this.emit("close");
      this.emit("state", this.getState());

      this.connectBackoff = Math.min(
        Math.round(this.connectBackoff * 1.2),
        Number(
          this.options?.connectAttemptTimeoutSeconds ||
            connectAttemptTimeoutSeconds
        ) * 1000
      );

      this.uplinkReady = false;
      this.serverInfo = undefined;

      logWarning("Upstream/Websocket closed", event?.code, event?.reason);
      WsCleanup();

      if (!this.closed) {
        this.emit("retry");

        logWarning(
          `Not closed on purpose, reconnecting after ${this.connectBackoff}...`
        );

        setTimeout(() => {
          this.emit("reconnect");
        }, this.connectBackoff);
      } else {
        log("Closed on purpose, not reconnecting");
      }
    };

    const handleServerInfo = (message: CallResponse): void => {
      if (message?.result?.info) {
        const serverInfo = message as ServerInfoResponse;
        if (!this.serverInfo) {
          logNodeInfo("Connected, server_info:", {
            pubkey_node: serverInfo.result.info.pubkey_node,
            build_version: serverInfo.result.info.build_version,
            complete_ledgers: serverInfo.result.info.complete_ledgers,
          });
        }

        const msRoundTrip =
          Number(new Date()) -
          Number(
            String(message?.id || "")
              .split("@")
              .reverse()[0]
          );

        if (msRoundTrip) {
          this.serverState.latency.push({
            moment: new Date(),
            value: msRoundTrip,
          });

          this.serverState.latency.splice(
            0,
            this.serverState.latency.length - 10
          );
        }

        const feeCushion = 1.2;
        const fee =
          serverInfo.result.info.load_factor *
          Number(serverInfo.result.info.validated_ledger?.base_fee_xrp) *
          1_000_000 *
          feeCushion;

        if (fee) {
          this.serverState.fee.push({
            moment: new Date(),
            value: fee,
          });

          this.serverState.fee.splice(0, this.serverState.fee.length - 5);
        }

        this.serverInfo = serverInfo;
      }
    };

    const handleAsyncWsMessage = (message: CallResponse): void => {
      if (message?.id?._Request !== "_WsClient_Internal_Subscription") {
        this.emit("message", message);

        if (message?.type === "ledgerClosed") {
          logMessage("Async", message.type);

          Object.assign(this.serverState, {
            validatedLedgers: message?.validated_ledgers,
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
          });
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
          let matchingSubscription;

          if (message?.id?._WsClient) {
            const _matching = this.subscriptions.filter(
              (s) => s.id === message?.id?._WsClient
            );
            if (_matching.length > 0) {
              matchingSubscription = _matching[0];
            }
          }

          if (matchingSubscription?.request?.command === "path_find") {
            logMessage("Async", matchingSubscription?.request?.command);
            this.emit("path", message);
          } else if (
            matchingSubscription?.request?.command === "subscribe" &&
            Array.isArray(matchingSubscription?.request?.streams) &&
            matchingSubscription?.request?.streams.indexOf("ledger") > -1
          ) {
            logMessage("Async", "subscription:ledger");
            this.emit("ledger", message);
          } else if (matchingSubscription) {
            matchingSubscription.promiseCallables.resolve(
              Object.assign(message, {
                id: message?.id?._Request,
              })
            );
          } else {
            const isInternal =
              message?.id?._Request &&
              String(message.id._Request).match(/^_WsClient_Internal/);
            if (!isInternal) {
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
        this.connection.send(JSON.stringify(call.request));
        if (call?.sendOptions?.timeoutStartsWhenOnline) {
          logWarning("APPLY TIMEOUT ONLY AFTER GOING ONLINE");
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
        logWarning("APPLY TIMEOUT NO MATTER ONLINE/OFFLINE STATE");
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

    const close = (error?: Error): void => {
      this.closed = true;
      log("Closing connection");
      WsCleanup();

      try {
        this.connection.close();
      } catch (e) {
        //
      }

      clearTimeout(livelinessCheck);
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

      this.off("__WsClient_call", call);
      this.off("__WsClient_close", close);
      this.off("flush", flush);
      this.off("reconnect", connect);

      if (error) {
        throw error;
      }
    };

    const WsCleanup = (): void => {
      log("Cleanup");
      (this.connection as any).removeEventListener("open", WsOpen);
      (this.connection as any).removeEventListener("message", WsMessage);
      (this.connection as any).removeEventListener("error", WsError);
      (this.connection as any).removeEventListener("close", WsClose);
    };

    const connect = (): WebSocket => {
      try {
        this.connection.close();
      } catch (e) {
        //
      }

      log("Connecting", this.endpoint);

      this.serverState.connectAttempts++;
      if (
        this.options.maxConnectionAttempts &&
        Number(this.options?.maxConnectionAttempts || 1) > 1 &&
        this.serverState.connectAttempts >
          Number(this.options?.maxConnectionAttempts || 1)
      ) {
        logNodeInfo(
          "Too many connection attempts",
          this.serverState.connectAttempts,
          this.options?.maxConnectionAttempts
        );
        close(new Error("Max. connection attempts exceeded"));
      }

      const connection = new WebSocket(this.endpoint);

      // Prevent possible DNS resolve hang, and a custom
      // resolver sucks
      setTimeout(() => {
        if (connection.readyState !== WebSocket.OPEN) {
          connection.close();
        }
      }, this.connectBackoff * 1.2 - 1);

      (connection as any).addEventListener("open", WsOpen);
      (connection as any).addEventListener("message", WsMessage);
      (connection as any).addEventListener("error", WsError);
      (connection as any).addEventListener("close", WsClose);

      this.connection = connection;

      return connection;
    };

    this.on("__WsClient_call", call);
    this.on("__WsClient_close", close);
    this.on("flush", flush);
    this.on("reconnect", connect);

    // setTimeout(() => {
    this.connection = connect();
    // }, 2000);
    // setInterval(() => {
    //   logNodeInfo("Connection Attempts", this.serverState.connectAttempts);
    // }, 4000);
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
        resolve(this);
      } else {
        this.on("ledger", () => {
          // Let's wait to make sure we're really connected
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

    if (this.closed) {
      promiseCallables.reject(new Error("Client in closed state"));
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

    this.emit("__WsClient_call", pendingCall);

    return promise;
  }

  getState(): ConnectionState {
    const ledgerCount = this.serverState.validatedLedgers
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
        this.connection.readyState === WebSocket.OPEN,
      latencyMs: {
        last:
          this.serverState.latency
            .slice(-1)
            .map((latencyRecord) => latencyRecord.value)[0] || null,
        avg:
          this.serverState.latency
            .map((latencyRecord) => latencyRecord.value)
            .reduce((a, b) => a + b, 0) / this.serverState.latency.length ||
          null,
        secAgo:
          Number(new Date()) / 1000 -
            this.serverState.latency
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
          this.serverState.validatedLedgers
            .split(",")
            .reverse()[0]
            .split("-")
            .reverse()[0]
        ),
        validated: this.serverState.validatedLedgers,
        count: this.serverState.validatedLedgers === "" ? 0 : ledgerCount,
      },
      fee: {
        last:
          this.serverState.fee
            .slice(-1)
            .map((feeRecord) => feeRecord.value)[0] || null,
        avg:
          this.serverState.fee
            .map((feeRecord) => feeRecord.value)
            .reduce((a, b) => a + b, 0) / this.serverState.fee.length || null,
        secAgo:
          Number(new Date()) / 1000 -
            this.serverState.fee
              .slice(-1)
              .map((feeRecord) => Number(feeRecord.moment) / 1000)[0] || null,
      },
      reserve: {
        base: this.serverState.reserveBase,
        owner: this.serverState.reserveInc,
      },
      secLastContact: this.lastContact
        ? Number(new Date()) / 1000 - Number(this.lastContact) / 1000
        : null,
    };
  }

  close(): void {
    assert(!this.closed, "Object already in closed state");
    this.emit("__WsClient_close");
  }
}
