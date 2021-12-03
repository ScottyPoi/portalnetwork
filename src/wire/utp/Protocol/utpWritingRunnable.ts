import { Packet, PacketType, TWO_MINUTES, _UTPSocket } from "..";
import { UtpWriteFuture } from "./UtpWriteFuture";


const MIN_RTO = TWO_MINUTES;
export default class utpWritingRunnable {
  socket: _UTPSocket;
  src: Buffer;
  future: UtpWriteFuture;
  writing: boolean;
  canSendNextPacket: boolean;
  timedoutPackets: Packet[];
  waitingTime: number;
  rto: number;
  constructor(socket: _UTPSocket, src: Buffer, future: UtpWriteFuture) {
    this.socket = socket;
    this.src = src;
    this.future = future;
    this.writing = false;
    this.canSendNextPacket = true;
    this.timedoutPackets = [];
    this.waitingTime = 0;
    this.rto = 0
  }

  start() {

  }

  calculateRTO(p: Packet) {
      this.socket.rtt_var += 0.25 * (Math.abs(this.socket.rtt - p.header.timestampDiff) - this.socket.rtt_var)
      this.socket.rtt += 0.125 * (p.header.timestampDiff - this.socket.rtt)
      this.rto = Math.max(MIN_RTO, this.socket.rtt + this.socket.rtt_var * 4)
  }

  getNextPacket(): Packet {
    return this.timedoutPackets.shift() as Packet;
  }

  sendPacket(p: Packet) {
      this.socket.sendPacket(p, PacketType.ST_DATA)
  }

  markPacketOnFly(p: Packet) {}

  waitAndProcessAcks() {}

  write() {
    while (this.writing) {
      while (this.canSendNextPacket) {
        let p = this.getNextPacket();
        this.sendPacket(p);
        this.markPacketOnFly(p);
      }
      this.waitAndProcessAcks();
      this.timedoutPackets.forEach((p) => {
        this.sendPacket(p);
      });
    }
  }
}
