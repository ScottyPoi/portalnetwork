import { _UTPSocket } from "..";
import { UtpReadFuture } from "./UtpReadFuture";

export class utpReadingRunnable {
    socket: _UTPSocket;
    dst: Buffer;
    readFuture: UtpReadFuture;

    constructor(socket: _UTPSocket, dst: Buffer, readFuture: UtpReadFuture) {
        this.socket = socket;
        this.dst = dst;
        this.readFuture = readFuture
    }

    start() {
        
    }
}