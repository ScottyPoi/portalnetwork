import { Uint16, Uint32, Uint8 } from "@chainsafe/lodestar-types";
import internal, { Stream, Writable } from "stream";
import {minimalHeaderSize, protocolVersion, PacketType, MicroSeconds, PacketHeaderV1, IPacketOptions} from './PacketTyping'
import {getMonoTimeStamp, randUint16, randUint32} from '../math';
import { IOutgoingPacket, Moment } from "../utp_socket/utp_socket_typing";

let OutputStream: internal.Duplex = new Stream.Duplex()
export function encodeTypeVer(h: PacketHeaderV1): Uint8 {
  let typeVer: Uint8 = 0;
  let typeOrd: Uint8 = h.pType;
  typeVer = (typeVer & 0xf0) | (h.version & 0xf);
  typeVer = (typeVer & 0xf) | (typeOrd << 4);
  return typeVer;
}
export function encodeHeaderStream(h: PacketHeaderV1) {
  try {
      OutputStream.write(encodeTypeVer(h));
      OutputStream.write(h.extension);
      
      OutputStream.write(h.connectionId.toString(16));
      OutputStream.write(h.timestamp.toString(16));
      OutputStream.write(h.timestampDiff.toString(16));
      OutputStream.write(h.wndSize.toString(16));
      OutputStream.write(h.seqNr.toString(16));
      OutputStream.write(h.ackNr.toString(16));
    } catch (error) {
      console.error(error);
    }
  }
export class Packet {
  header: PacketHeaderV1;
  payload: Uint8Array;
  constructor(options: IPacketOptions) {
    this.header = options.header;
    this.payload = options.payload;
  }

  encodePacket(): Uint8Array {
    let s = OutputStream
    encodeHeaderStream(this.header)
    if (this.payload.length > 0) {
        s.write(this.payload)
    }
    return s.read()
}
};


export class OutgoingPacket {
  packetBytes: Uint8Array;
  transmissions: Uint16;
  needResend: boolean;
  timeSent: Moment;
  constructor(options: IOutgoingPacket) {
    this.packetBytes = options.packetBytes;
    this.transmissions = options.transmissions;
    this.needResend = options.needResend;
    this.timeSent = options.timeSent;
  }
  // # Should be called before sending packet
  setSend(): Uint8Array {
    this.transmissions++;
    this.needResend = false;
    this.timeSent = Date.now();
    return this.packetBytes;
  }
}
// # TODO for now we do not handle extensions
export function decodePacket(bytes: Uint8Array): Packet {
  if (bytes.length < minimalHeaderSize) {
    console.error("invalid header size");
  }

  let version = bytes[0] & 0xf;
  if (version != protocolVersion) {
    console.error("invalid packet version");
  }

  const kind = bytes[0] >> 4;

  let header: PacketHeaderV1 = {
    pType: kind,
    version: version,
    extension: bytes[1],
    connectionId: Buffer.from(bytes.subarray(2, 3)).readUInt16BE(),
    timestamp: Buffer.from(bytes.subarray(4, 7)).readUInt16BE(),
    timestampDiff: Buffer.from(bytes.subarray(8, 11)).readUInt16BE(),
    wndSize: Buffer.from(bytes.subarray(12, 15)).readUInt16BE(),
    seqNr: Buffer.from(bytes.subarray(16, 17)).readUInt16BE(),
    ackNr: Buffer.from(bytes.subarray(18, 19)).readUInt16BE(),
  };

  let payload = bytes.length == 20 ? new Uint8Array(0) : bytes.subarray(20);

  let packet: Packet = new Packet({ header: header, payload: payload });

  return packet;
}

// # connectionId - should be random not already used number
// # bufferSize - should be pre configured initial buffer size for socket
// # SYN packets are special, and should have the receive ID in the connid field,
// # instead of conn_id_send.

export function synPacket(
  seqNr: Uint16,
  rcvConnectionId: Uint16,
  bufferSize: Uint32
): Packet {
  let h: PacketHeaderV1 = {
    pType: PacketType.ST_SYN,
    version: protocolVersion,
    // # TODO for we do not handle extensions
    extension: 0,
    connectionId: rcvConnectionId,
    timestamp: getMonoTimeStamp(),
    timestampDiff: 0,
    wndSize: bufferSize,
    seqNr: seqNr,
    // # Initialy we did not receive any acks
    ackNr: 0,
  };

  let packet: Packet = new Packet({ header: h, payload: new Uint8Array(0) });
  return packet;
}

export function ackPacket(
  seqNr: Uint16,
  sndConnectionId: Uint16,
  ackNr: Uint16,
  bufferSize: Uint32
): Packet {
  let h: PacketHeaderV1 = {
    pType: PacketType.ST_STATE,
    version: protocolVersion,
    // ack packets always have extension field set to 0
    extension: 0,
    connectionId: sndConnectionId,
    timestamp: getMonoTimeStamp(),
    //     # TODO for not we are using 0, but this value should be calculated on socket
    //  # level
    timestampDiff: 0,
    wndSize: bufferSize,
    seqNr: seqNr,
    ackNr: ackNr,
  };

  const packet: Packet = new Packet({ header: h, payload: new Uint8Array(0) });
  return packet;
}

export function dataPacket(
  seqNr: Uint16,
  sndConnectionId: Uint16,
  ackNr: Uint16,
  bufferSize: Uint32,
  payload: Uint8Array
): Packet {
  let h: PacketHeaderV1 = {
    pType: PacketType.ST_DATA,
    version: protocolVersion,
    extension: 0,
    connectionId: sndConnectionId,
    timestamp: getMonoTimeStamp(),
    timestampDiff: 0,
    wndSize: bufferSize,
    seqNr: seqNr,
    ackNr: ackNr,
  };
  const packet: Packet = new Packet({ header: h, payload: payload });
  return packet;
}



export * from './PacketTyping';