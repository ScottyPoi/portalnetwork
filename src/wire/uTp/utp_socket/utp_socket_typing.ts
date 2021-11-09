import { Uint16, Uint32 } from "@chainsafe/lodestar-types";
import { GrowableCircularBuffer } from "../growableBuffer";
import { Packet } from "../Packets/packets";
import { OutgoingPacket } from "../Packets/OutgoingPacket";
import { UtpSocketKey } from "./UtpSocketKey";

export const reorderBufferMaxSize: number = 1024;
//   # Maximal number of payload bytes per packet. Total packet size will be equal to
//   # mtuSize + sizeof(header) = 600 bytes
//   # TODO for now it is just some random value. Ultimatly this value should be dynamically
//   # adjusted based on traffic.
export const mtuSize: number = 580;
//   # How often each socket check its different on going timers
export const checkTimeoutsLoopInterval: number = 500;
//   # Defualt initial timeout for first Syn packet
export const defaultInitialSynTimeout: number = 3000;
//   # Initial timeout to receive first Data data packet after receiving initial Syn
//   # packet. (TODO it should only be set when working over udp)
export const initialRcvRetransmitTimeout: number = 10000;
//   # Number of times each data packet will be resend before declaring connection
//   # dead. 4 is taken from reference implementation:
export const defaultDataResendsBeforeFailure: Uint16 = 4;
export const logScope = {
  topics: "utp_socket",
};
export enum ConnectionState {
  SynSent,
  SynRecv,
  Connected,
  ConnectedFull,
  Reset,
  Destroy,
}

export enum ConnectionDirection {
  Outgoing,
  Ingoing,
}

export interface IUtpSocketKeyOptions<A> {
  remoteAddress?: A;
  rcvId?: Uint16;
}

export enum AckResult {
  PacketAcked,
  PacketAlreadyAcked,
  PacketNotSentYet,
}

export type SendCallback<A> = (to: A, data: Uint8Array) => Promise<void>;

export type SocketConfig = {
  initialSynTimeout: Duration;
  dataResendsBeforeFailure: Uint16;
};

export type Miliseconds = Uint32;
export type Moment = Miliseconds;
export type Duration = Miliseconds;

export interface IOutgoingPacket {
  packetBytes: Uint8Array;
  transmissions: Uint16;
  needResend: boolean;
  timeSent: Moment;
}

export interface IBody {
  consumed: string;
  done: boolean;
}

export interface IUtpSocket<A> {
  remoteAddress: A;
  state: ConnectionState;
  direction: ConnectionDirection;
  socketConfig: SocketConfig;
  connectionIdRcv: Uint16;
  connectionIdSnd: Uint16;
  seqNr: Uint16;
  ackNr: Uint16;
  connectionFuture?: Promise<void>;
  curWindowPackets?: Uint16;
  outBuffer?: GrowableCircularBuffer<OutgoingPacket>;
  inBuffer?: GrowableCircularBuffer<Packet>;
  reorderCount?: Uint16;
  retransmitTimeout?: Duration;
  rtt?: Duration;
  rttVar?: Duration;
  rto?: Duration;
  rtoTimeout?: Moment;
  buffer?: Buffer;
  checkTimeoutsLoop?: Promise<void>;
  retransmitCount?: Uint32;
  closeEvent?: CloseEvent;
  closeCallbacks?: Promise<void>[];
  socketKey?: UtpSocketKey<A>;
  send: SendCallback<A>;
}

// export type UtpSocketType<A> = IUtpSocket<A>

export type SocketCloseCallBack = () => void;

export type ConnectionError = Error;
