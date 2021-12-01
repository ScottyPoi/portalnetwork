import { Uint16, Uint32, Uint8 } from '..' 
import { VERSION } from "../Utils/constants";
import { DEFAULT_WINDOW_SIZE, IPacketHeader, MicroSeconds, PacketType } from "./PacketTyping";

export class Extension {
  type: number;
  len: number;
  bitmask: Uint32Array;

  constructor(type: number, bitmask: Uint32Array) {
    this.type = type;
    this.bitmask = bitmask;
    this.len = this.bitmask.length
  }
}

export class SelectiveAckExtension extends Extension {
  constructor(bitmask: Uint32Array) {
    super(1, bitmask)
  }
}



export class PacketHeader {
  pType: PacketType;
  version: Uint8;
  extension: Uint8;
  connectionId: Uint16;
  timestamp: MicroSeconds;
  timestampDiff: MicroSeconds;
  wndSize: Uint32;
  seqNr: Uint16;
  ackNr: Uint16;
  length: number;

  constructor(options: IPacketHeader) {
    this.pType = options.pType;
    this.version = options.version || VERSION;
    this.extension = options.extension || 0
    this.connectionId = options.connectionId
    this.timestamp = performance.now()
    this.timestampDiff = options.timestampDiff || 0
    this.wndSize = DEFAULT_WINDOW_SIZE
    this.seqNr = options.seqNr
    this.ackNr = options.ackNr;
    this.length = 20
  } 
  encodeTypeVer(): Uint8 {
    let typeVer: Uint8 = 0;
    let typeOrd: Uint8 = this.pType;
    typeVer = (typeVer & 0xf0) | (this.version & 0xf);
    typeVer = (typeVer & 0xf) | (typeOrd << 4);
    return typeVer;
  }
  encodeHeaderStream(): Buffer {
    let buffer = Buffer.alloc(20)
    buffer[0] = 1
    buffer[1] = 0
    buffer.writeUInt16BE(this.connectionId, 2);
    buffer.writeUInt32BE(this.timestamp, 4);
    buffer.writeUInt32BE(this.timestampDiff as number, 8);
    buffer.writeUInt32BE(this.wndSize as number, 12);
    buffer.writeUInt16BE(this.seqNr, 16);
    buffer.writeUInt16BE(this.seqNr, 18);
  return buffer
  
}
}

export class SelectiveAckHeader extends PacketHeader {
  selectiveAckExtension: SelectiveAckExtension;
  constructor(options: IPacketHeader, bitmask: Uint32Array) {
    super(options);
    this.extension = 1;
    this.length = this.encodeHeaderStream().length
    this.selectiveAckExtension = new SelectiveAckExtension(bitmask)
  }

  encodeHeaderStream(): Buffer {
    let buffer = Buffer.alloc(20 + this.selectiveAckExtension.len + 2)
    buffer[0] = 1
    buffer[1] = 0
    buffer.writeUInt16BE(this.connectionId, 2);
    buffer.writeUInt32BE(this.timestamp, 4);
    buffer.writeUInt32BE(this.timestampDiff as number, 8);
    buffer.writeUInt32BE(this.wndSize as number, 12);
    buffer.writeUInt16BE(this.seqNr, 16);
    buffer.writeUInt16BE(this.seqNr, 18);
    buffer.writeUInt8(this.selectiveAckExtension.type)
    buffer.writeUInt8(this.selectiveAckExtension.len)
    Array.from([...this.selectiveAckExtension.bitmask.values()]).forEach((value) => {
      buffer.writeUInt32BE(value)
    })
    
  return buffer
  }


}