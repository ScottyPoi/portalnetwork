import { Uint16, Uint32, Uint8 } from "@chainsafe/lodestar-types";
import internal, { Stream, Writable } from "stream";
import {
  protocolVersion,
  PacketType,
  IPacketOptions,
  DEFAULT_WINDOW_SIZE,
  connectionType,
} from "./PacketTyping";
import { getMonoTimeStamp, randUint16, randUint32 } from "../utils/math";
import { PacketHeader } from "./PacketHeader";

export class Packet {
  header: PacketHeader;
  payload: Uint8Array;
  sent: number;
  OutputStream: internal.Duplex;
  constructor(options: IPacketOptions) {
    this.header = options.header;
    this.payload = options.payload;
    this.sent = 0;
    this.OutputStream = new Stream.Duplex()
  }

  encodePacket(): Uint8Array {
    let s = this.OutputStream;
    this.header.encodeHeaderStream();
    if (this.payload.length > 0) {
      s.write(this.payload);
    }
    return s.read();
  }
}

export function createPacket(connection: connectionType, pType: PacketType, data: Uint8Array) {
  return new Packet({
    header:  {
      pType: pType,
      connectionId: connection.Id,
      seqNr: connection.seqNr,
      ackNr: connection.ackNr,
    } as PacketHeader,
    payload: data
  })
}

// # TODO for now we do not handle extensions

export function createSynPacket(
  rcvConnectionId: Uint16,
  seqNr: Uint16,
  ackNr?: number
): Packet {
  let h: PacketHeader = new PacketHeader({
    pType: PacketType.ST_SYN,
    connectionId: rcvConnectionId,
    seqNr: seqNr,
    ackNr: ackNr || 0,
  });

  let packet: Packet = new Packet({ header: h, payload: new Uint8Array() });
  return packet;
}

export function createAckPacket(
  seqNr: Uint16,
  sndConnectionId: Uint16,
  ackNr: Uint16,
): Packet {
  let h: PacketHeader = new PacketHeader({
    pType: PacketType.ST_STATE,
    connectionId: sndConnectionId,
    seqNr: seqNr,
    ackNr: ackNr,
    wndSize: DEFAULT_WINDOW_SIZE,
  });

  const packet: Packet = new Packet({ header: h, payload: new Uint8Array(0) });
  return packet;
}

export function createDataPacket(
  seqNr: Uint16,
  sndConnectionId: Uint16,
  ackNr: Uint16,
  bufferSize: Uint32,
  payload: Uint8Array
): Packet {
  let h: PacketHeader = new PacketHeader({
    pType: PacketType.ST_DATA,
    version: protocolVersion,
    extension: 0,
    connectionId: sndConnectionId,
    timestamp: getMonoTimeStamp(),
    timestampDiff: 0,
    wndSize: bufferSize,
    seqNr: seqNr,
    ackNr: ackNr,
  });
  const packet: Packet = new Packet({ header: h, payload: payload });
  return packet;
}

export function createResetPacket(
  seqNr: Uint16,
  sndConnectionId: Uint16,
  ackNr: Uint16,
  bufferSize: Uint32
): Packet {
  let h = new PacketHeader({
    pType: PacketType.ST_RESET,
    version: protocolVersion,
    extension: 0,
    connectionId: sndConnectionId,
    timestamp: Date.now(),
    timestampDiff: 0,
    wndSize: 0,
    seqNr: seqNr,
    ackNr: ackNr,
  });
  return new Packet({ header: h, payload: new Uint8Array() });
}

export function createFinPacket(
  seqNr: number,
  connectionId: number,
  ackNr: number,
  wndSize?: number, 
): Packet {
  let h = new PacketHeader({
    pType: PacketType.ST_FIN,
    version: protocolVersion,
    extension: 0,
    connectionId: connectionId,
    timestamp: Date.now(),
    timestampDiff: 0,
    wndSize: DEFAULT_WINDOW_SIZE,
    seqNr: seqNr,
    ackNr: ackNr
  })
  return new Packet({header: h, payload: new Uint8Array()})
}




export * from "./PacketTyping";
