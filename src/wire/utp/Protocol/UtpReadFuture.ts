import { UtpReadListener } from "./UtpReadListener";


export class UtpReadFuture {
    buffer: Buffer | null
    listener: UtpReadListener | null;
    
    constructor(buffer: Buffer) {
        this.buffer = null 
        this.listener = null
    }

    setListener(listener: UtpReadListener) {
        this.listener = listener
    }

    getBytesRead() {
        if (this.buffer != null) {
            return this.buffer.length
        }
    }
}