import { Uint16, Uint32, Uint8 } from "@chainsafe/lodestar-types";
import { PacketHeader } from "./PacketHeader";

export const minimalHeaderSize = 20;
export const protocolVersion = 1;

export enum PacketType {
  ST_DATA = 0,
  ST_FIN = 1,
  ST_STATE = 2,
  ST_RESET = 3,
  ST_SYN = 4,
}
export type MicroSeconds = Uint32;

export type PacketHeaderType = {
  pType: PacketType;
  version: Uint8;
  extension: Uint8;
  connectionId: Uint16;
  timestamp: MicroSeconds;
  timestampDiff: MicroSeconds;
  wndSize: Uint32;
  seqNr: Uint16;
  ackNr: Uint16;
}
export interface IPacketHeader {
  pType: PacketType;
  version: Uint8;
  extension: Uint8;
  connectionId: Uint16;
  timestamp: MicroSeconds;
  timestampDiff: MicroSeconds;
  wndSize: Uint32;
  seqNr: Uint16;
  ackNr: Uint16;
}



export interface IPacketOptions {
    header: PacketHeader,
    payload: Uint8Array,
  }

export interface IDecodePacketOptions extends IPacketOptions {
    bytes: Uint8Array
}