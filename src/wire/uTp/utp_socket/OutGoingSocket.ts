import { randUint16 } from "../math";
import { UtpSocket } from "./utp_socket";
import { ConnectionDirection, ConnectionState, SendCallback, SocketConfig } from "./utp_socket_typing";

export function initOutgoingSocket<A>(
    to: A,
    cfg: SocketConfig,
    snd: SendCallback<A> = (to, data) => Promise.resolve(),
  ): UtpSocket<A> {
    //   # TODO handle possible clashes and overflows
    let rcvConnectionId = randUint16();
    let sndConnectionId = rcvConnectionId + 1;
    let initialSeqNr = randUint16();
  
    return new UtpSocket<A>({
      remoteAddress: to,
      send: snd,
      state: ConnectionState.SynSent,
      socketConfig: cfg,
      direction: ConnectionDirection.Outgoing,
      connectionIdRcv: rcvConnectionId,
      connectionIdSnd: sndConnectionId,
      seqNr: initialSeqNr,
      ackNr: 0,
    });
  }