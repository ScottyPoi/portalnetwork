import { Uint16 } from "@chainsafe/lodestar-types";
import { randUint16 } from "../math";
import { UtpSocket } from "./utp_socket";
import { ConnectionDirection, ConnectionState, SendCallback, SocketConfig } from "./utp_socket_typing";

export function initIncomingSocket<A>(
    to: A,
    snd: SendCallback<A>,
    cfg: SocketConfig,
    connectionId: Uint16,
    ackNr: Uint16
    //   rng: var BrHmacDrbgContext
  ): UtpSocket<A> {
    let initialSeqNr = randUint16();
    return new UtpSocket<A>({
      remoteAddress: to,
      send: snd,
      state: ConnectionState.SynRecv,
      socketConfig: cfg,
      direction: ConnectionDirection.Ingoing,
      connectionIdRcv: connectionId,
      connectionIdSnd: connectionId,
      seqNr: initialSeqNr,
      ackNr: ackNr,
    });
  }