import { Uint16 } from "@chainsafe/lodestar-types";
import { Multiaddr } from "multiaddr";
import { randUint16 } from "../utils/math";
import { SocketConfig, UtpSocket } from "./Utp_socket";
import { ConnectionDirection, ConnectionState, SendCallback} from "./SocketTypes";

export function initIncomingSocket(
    to: Multiaddr,
    cfg: SocketConfig,
    connectionId: Uint16,
    ackNr: Uint16
  ): UtpSocket {
    let initialSeqNr = randUint16();
    return new UtpSocket({
      remoteaddress: to,
      state: ConnectionState.SynRecv,
      socketConfig: cfg,
      direction: ConnectionDirection.Ingoing,
      connectionIdRcv: connectionId,
      connectionIdSnd: connectionId,
      seqNr: initialSeqNr,
      ackNr: ackNr,
    });
  }