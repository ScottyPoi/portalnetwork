export class UtpWriteFuture {
    buffer: Buffer | null
    listener: UtpReadListener;
    
    constructor(buffer: Buffer) {
        this.buffer = null 
    }

    getBytesRead() {
        if (this.buffer != null) {
            return this.buffer.position
        }
    }

}
