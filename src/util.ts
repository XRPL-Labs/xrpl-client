import { PendingCall } from "./types";

export default function addSubscription(subscriptions: PendingCall[], pendingCall: PendingCall): PendingCall[] {
  // https://xrpl.org/path_find.html
  // A client can only have one pathfinding request open at a time. 
  // If another pathfinding request is already open on the same connection, the old request is automatically closed and replaced with the new request.
  if ((pendingCall.request.command === "path_find" && pendingCall.request.subcommand !== "status")) {
    const find = subscriptions.findIndex(({ request }) => request.command == "path_find");
    if (find > -1) subscriptions.splice(find, 1);
  };
  if (pendingCall.request.command !== "path_find" || (pendingCall.request.command === "path_find" && pendingCall.request.subcommand !== "status"))
    subscriptions.push(pendingCall)
  return subscriptions;
}
  