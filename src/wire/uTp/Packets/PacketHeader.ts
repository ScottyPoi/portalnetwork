import { Uint16, Uint32, Uint8 } from "@chainsafe/lodestar-types";
import { Stream} from "stream";
import internal = require("stream");
import { VERSION } from "../utils/constants";
import { DEFAULT_WINDOW_SIZE, IPacketHeader, MicroSeconds, PacketHeaderType, PacketType } from "./PacketTyping";



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
  
    constructor(options: IPacketHeader) {
        this.pType = options.pType;
        this.version = options.version || VERSION;
        this.extension = 0
        this.connectionId = options.connectionId
        this.timestamp = options.timestamp || Date.now()
        this.timestampDiff = options.timestampDiff || 0
        this.wndSize = options.wndSize || DEFAULT_WINDOW_SIZE
        this.seqNr = options.seqNr
        this.ackNr = options.ackNr;
    } 
    OutputStream: internal.Duplex = new Stream.Duplex()
encodeTypeVer(): Uint8 {
    let typeVer: Uint8 = 0;
    let typeOrd: Uint8 = this.pType;
    typeVer = (typeVer & 0xf0) | (this.version & 0xf);
    typeVer = (typeVer & 0xf) | (typeOrd << 4);
    return typeVer;
  }
encodeHeaderStream() {
    try {
        this.OutputStream.write(this.encodeTypeVer);
        this.OutputStream.write(this.extension);
        this.OutputStream.write(this.connectionId.toString(16));
        this.OutputStream.write(this.timestamp.toString(16));
        this.OutputStream.write(this.timestampDiff.toString(16));
        this.OutputStream.write(this.wndSize.toString(16));
        this.OutputStream.write(this.seqNr.toString(16));
        this.OutputStream.write(this.ackNr.toString(16));
      } catch (error) {
        console.error(error);
      }
    }

}
