import { Uint16, Uint32 } from "@chainsafe/lodestar-types";
import { GrowableCircularBuffer } from "./growableBuffer";

const logScope = {
  topics: "utp_socket",
};

enum ConnectionState {
  SynSent,
  SynRecv,
  Coneected,
  ConnectedFull,
  Reset,
  Destroy,
}

enum ConnectionDirection {
  Outgoing,
  Ingoing,
}

export type UtpSocketKey<A> = {
  remoteAddress: A;
  rcvId: Uint16;
};

enum AckResult {
  PacketAcked,
  PacketAlreadyAcked,
  PacketNotSentYet,
}

type Moment = Uint32;
type Duration = Uint32;

export type OutGoingPacket = {
  packetBytes: Uint8Array;
  transmissions: Uint16;
  needResend: boolean;
  timeSent: Moment;
};

export type SendCallback<A> = (to: A, data: Uint8Array) => Promise<void>;

export type SocketConfig = {
  initialSynTimeout: Duration;
  dataResendsBeforeFailure: Uint16;
};

export type UtpSocket<A> = {
  remoteAddress: A;
  state: ConnectionState;
  direction: ConnectionDirection;
  socketConfig: SocketConfig;
  connectionIdRcv: Uint16;
  connectionIdSnd: Uint16;
  seqNr: Uint16;
  ackNr: Uint16;
  connectionFuture: Promise<void>;
  curWindowPackets: Uint16;
  outBuffer: GrowableCircularBuffer<OutGoingPacket>;
  inBuffer: GrowableCircularBuffer<OutGoingPacket>;
  reorderCount: Uint16;
  retransmitTimeout: Duration;
  rtt: Duration;
  rttVar: Duration;
  rto: Duration;
  rtoTimeout: Moment;
  buffer: Buffer;
  checkTimeoutsLoop: Promise<void>;
    retransmitCount: Uint32;
    closeEvent: Event;
    closeCallbacks: Promise<void>[];
    socketKey: UtpSocketKey<A>;
    send: SendCallback<A>;
};

export type SocketCloseCallBack = () => void;

export type ConnectionError = Error;

