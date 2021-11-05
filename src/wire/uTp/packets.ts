import { Uint16, Uint32, Uint8 } from "@chainsafe/lodestar-types";
import { hrtime } from "process";
import { Stream, Writable } from "stream";
import { ok } from "assert";

const minimalHeaderSize = 20;
const protocolVersion = 1;

export enum PacketType {
  ST_DATA = 0,
  ST_FIN = 1,
  ST_STATE = 2,
  ST_RESET = 3,
  ST_SYN = 4,
}

export type MicroSeconds = Uint32;

export type PacketHeaderV1 = {
  pType: PacketType;
  version: Uint8;
  extension: Uint8;
  connectionId: Uint16;
  timestamp: MicroSeconds;
  timestampDiff: MicroSeconds;
  wndSize: Uint32;
  seqNr: Uint16;
  ackNr: Uint16;
};

export type Packet = {
  header: PacketHeaderV1;
  payload: Uint8Array;
};

export function getMonoTimeTimeStamp(): Uint32 {
  let time = hrtime.bigint();
  return Number(time / BigInt(1000)) as Uint32;
}

console.log(getMonoTimeTimeStamp());

export function randUint16(): Uint16 {
  return (Math.random() * 2 ** 16) as Uint16;
}
export function randUint32(): Uint16 {
  return (Math.random() * 2 ** 32) as Uint16;
}

export function encodeTypeVer(h: PacketHeaderV1): Uint8 {
  let typeVer: Uint8 = 0;
  let typeOrd: Uint8 = h.pType;
  typeVer = (typeVer & 0xf0) | (h.version & 0xf);
  typeVer = (typeVer & 0xf) | (typeOrd << 4);
  return typeVer;
}

type OutputStream = typeof Stream.Writable;

export function encodeHeaderStream(s: Writable, h: PacketHeaderV1) {
  try {
    s.write(encodeTypeVer(h));
    s.write(h.extension);
    s.write(h.connectionId.toString(16));
    s.write(h.timestamp.toString(16));
    s.write(h.timestampDiff.toString(16));
    s.write(h.wndSize.toString(16));
    s.write(h.seqNr.toString(16));
    s.write(h.ackNr.toString(16));
  } catch (error) {
    console.error(error);
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

  let packet: Packet = { header: header, payload: payload };

  return packet
}

// # connectionId - should be random not already used number
// # bufferSize - should be pre configured initial buffer size for socket
// # SYN packets are special, and should have the receive ID in the connid field,
// # instead of conn_id_send.

function synPacket(
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
    timestamp: getMonoTimeTimeStamp(),
    timestampDiff: 0,
    wndSize: bufferSize,
    seqNr: seqNr,
    // # Initialy we did not receive any acks
    ackNr: 0,
  };

  let packet: Packet = { header: h, payload: new Uint8Array(0) };
  return packet
}

function ackPacket(
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
        timestamp: getMonoTimeTimeStamp(),
        //     # TODO for not we are using 0, but this value should be calculated on socket
  //  # level
        timestampDiff: 0,
        wndSize: bufferSize,
        seqNr: seqNr,
        ackNr: ackNr
    }


  const packet: Packet = { header: h, payload: new Uint8Array(0) };
  return packet
}

function dataPacket(seqNr: Uint16, sndConnectionId: Uint16, ackNr: Uint16, bufferSize: Uint32, payload: Uint8Array): Packet {
    let h: PacketHeaderV1 = {
        pType: PacketType.ST_DATA,
        version: protocolVersion,
        //     # data packets always have extension field set to 0
        extension: 0,
        connectionId: sndConnectionId,
        timestamp: getMonoTimeTimeStamp(),
        //     # TODO for not we are using 0, but this value should be calculated on socket
    // # level
        timestampDiff: 0,
        wndSize: bufferSize,
        seqNr: seqNr,
        ackNr: ackNr
    }
    const packet: Packet = { header: h, payload: payload};
    return packet
}




console.log(ok);
