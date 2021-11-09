import { Uint16 } from "@chainsafe/lodestar-types";
import { IUtpSocketKeyOptions } from "./utp_socket_typing";

export class UtpSocketKey<A> {
    remoteAddress: A;
    rcvId: Uint16;
  
    constructor(options: IUtpSocketKeyOptions<A>) {
      this.remoteAddress = options.remoteAddress as A;
      this.rcvId = options.rcvId || 0;
    }
  }