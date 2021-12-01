import { Packet, _UTPSocket } from "..";
import { Duplex } from "stream";

export default class BlockingQueue {
  socket: _UTPSocket;
  queue: Packet[];
  inBuffer: Packet[];
  expected: number;
  currentAckNumber: number;
  receiving: boolean;
  byteBuffer: Duplex;

  constructor(socket: _UTPSocket) {
    this.socket = socket
    this.queue = [];
    this.inBuffer = [];
    this.expected = 1;
    this.currentAckNumber = 1;
    this.receiving = true;
    this.byteBuffer = new Duplex();
  }
  enqueue(item: Packet): void {
    this.queue.push(item);
    this.expected++;
  }
  dequeue(): Packet | false {
    let p = this.queue.shift();
    return typeof p == "undefined" ? false : p
     
  }
  getItems(): Packet[] {
    return this.inBuffer;
  }
  isExpected(p: Packet): boolean {
    return p.header.seqNr === this.currentAckNumber + 1;
  }

  ack(ack_nr: number) {
    this.socket.sendAck(this.socket.seqNr, this.socket.sndConnectionId, ack_nr)
  }
  
  selectiveAck(ack_nr: number) {}
  
  alreadyAcked(p: Packet): boolean {
    return true;
  }

  getAllCorrectlySequencedPackets(): Packet[] {
    let packets = []
    let ack_nr = this.currentAckNumber;
    let packet = this.inBuffer.shift()
    while (packet?.header.seqNr == ack_nr) {
      packets.push(packet);
      ack_nr ++
      packet = this.inBuffer.shift()
    }
    return packets
  }

  receive(p: Packet) {
    if (this.isExpected(p)) {
      this.byteBuffer.push(p.payload);
      if (this.inBuffer.length == 0) {
        this.currentAckNumber = p.header.seqNr;
        this.ack(this.currentAckNumber);
      } else {
        let packets = this.getAllCorrectlySequencedPackets();
        packets.forEach((p) => {
          this.currentAckNumber = p.header.seqNr;
          this.byteBuffer.push(p.payload);
        });
        if (this.inBuffer.length == 0) {
          this.ack(this.currentAckNumber);
        } else {
          this.selectiveAck(this.currentAckNumber);
        }
      }
    } else {
      if (this.alreadyAcked(p)) {
        this.ack(this.currentAckNumber);
      } else {
        this.inBuffer.push(p);
        this.selectiveAck(this.currentAckNumber);
      }
    }
  }

  start() {
    while (this.receiving) {
     this.dequeue() && this.receive(this.dequeue() as Packet);
    }
  }
}
