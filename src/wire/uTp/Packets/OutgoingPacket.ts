import { Uint16 } from "@chainsafe/lodestar-types";
import { IOutgoingPacket, Moment } from "../utp_socket/SocketTypes";

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