import { Uint16, Uint32 } from "@chainsafe/lodestar-types";
import assert from "assert";
import { inspect } from "util";
import { GrowableCircularBuffer, Option, some } from "../utils/growableBuffer";
import {
  MicroSeconds,
  Packet,
  createSynPacket,
  createAckPacket,
  PacketType,
  createDataPacket,
} from "../Packets/Packet";
import { OutgoingPacket } from "../Packets/OutgoingPacket";
import { max, sleep } from "../utils/math";
import {
  Moment,
  ConnectionDirection,
  ConnectionState,
  Duration,
  IUtpSocket,
  checkTimeoutsLoopInterval,
  AckResult,
  reorderBufferMaxSize,
  IBody,
  mtuSize,
  SocketCloseCallBack,
} from "./SocketTypes";
import { UtpSocketKey } from "./UtpSocketKey";
import { Duplex } from "stream";
import dgram from "dgram";
import { Multiaddr } from "multiaddr";

export type SocketConfig = typeof defaultSocketConfig;

export const defaultSocketConfig = {
  buffer: Buffer.alloc(20),
  _checkTimeoutsLoop: Promise.prototype,
  closeCallbacks: [],
  closeEvent: new CloseEvent("close"),
  connectionFuture: Promise.prototype,
  curWindowPackets: 0,
  dataResendsBeforeFailure: 5,
  inBuffer: new GrowableCircularBuffer<Packet>(),
  outBuffer: new GrowableCircularBuffer<OutgoingPacket>(),
  reorderCount: 0,
  retransmitCount: 0,
  retransmitTimeout: 1000,
  rto: 1000,
  rtoTimeout: 0,
  rtt: 0,
  rttVar: 0,
};

export class UtpSocket extends dgram.Socket {
  ackNr: Uint16;
  buffer: Buffer;
  _checkTimeoutsLoop?: Promise<void>;
  closeCallbacks: Promise<void>[];
  closeEvent: CloseEvent;
  connectionFuture: Promise<void>;
  connectionIdRcv: Uint16;
  connectionIdSnd: Uint16;
  curWindowPackets: Uint16;
  dataResendsBeforeFailure: number;
  direction: ConnectionDirection;
  inBuffer: GrowableCircularBuffer<Packet>;
  outBuffer: GrowableCircularBuffer<OutgoingPacket>;
  remoteaddress: Multiaddr;
  reorderCount: Uint16;
  retransmitCount: Uint32;
  retransmitTimeout: Duration;
  rto: Duration;
  rtoTimeout: Moment;
  rtt: Duration;
  rttVar?: Duration;
  seqNr: Uint16;
  state: ConnectionState;
  // socketKey: UtpSocketKey;

  constructor(options: IUtpSocket) {
    super();
    this.ackNr = options.ackNr;
    this.connectionIdRcv = options.connectionIdRcv;
    this.connectionIdSnd = options.connectionIdSnd;
    this.direction = options.direction;
    this.remoteaddress = options.remoteaddress;
    this.seqNr = options.seqNr;
    this.state = options.state;
    this.buffer = defaultSocketConfig.buffer;
    this._checkTimeoutsLoop = defaultSocketConfig._checkTimeoutsLoop;
    this.closeCallbacks = defaultSocketConfig.closeCallbacks;
    this.closeEvent = defaultSocketConfig.closeEvent;
    this.connectionFuture = defaultSocketConfig.connectionFuture;
    this.curWindowPackets = defaultSocketConfig.curWindowPackets;
    this.dataResendsBeforeFailure =
      defaultSocketConfig.dataResendsBeforeFailure;
    this.inBuffer = defaultSocketConfig.inBuffer;
    this.outBuffer = defaultSocketConfig.outBuffer;
    this.reorderCount = defaultSocketConfig.reorderCount;
    this.retransmitCount = defaultSocketConfig.retransmitCount;
    this.retransmitTimeout = defaultSocketConfig.retransmitTimeout;
    this.rto = defaultSocketConfig.rto;
    this.rtoTimeout = defaultSocketConfig.rtoTimeout;
    this.rtt = defaultSocketConfig.rtt;
    this.rttVar = defaultSocketConfig.rttVar;
    // this.socketKey
  }

  ackPackets(nrPacketsToAck: Uint16): void {
    // ## Ack packets in outgoing buffer based on ack number in the received packet
    var i = 0;
    while (i < nrPacketsToAck) {
      let result = this.ackPacketResult(this.seqNr - this.curWindowPackets);
      result == AckResult.PacketAcked
        ? this.curWindowPackets
        : result == AckResult.PacketAlreadyAcked
        ? this.curWindowPackets
        : console.log("Tried to ack packet which was not sent yet");
      i++;
    }
  }
  ackPacketResult(seqNr: Uint16): AckResult {
    let packetOpt = this.outBuffer.get(seqNr);
    if (packetOpt.isSome()) {
      let packet = packetOpt.get();

      if (packet.transmissions == 0) {
        //   # according to reference impl it can happen when we get an ack_nr that
        //   # does not exceed what we have stuffed into the outgoing buffer,
        //   # but does exceed what we have sent
        //   # TODO analyze if this case can happen with our impl
        return AckResult.PacketNotSentYet;
      }
      let currentTime = Date.now();

      this.outBuffer.delete(seqNr);

      // # from spec: The rtt and rtt_var is only updated for packets that were sent only once.
      // # This avoids problems with figuring out which packet was acked, the first or the second one.
      // # it is standard solution to retransmission ambiguity problem
      if (packet.transmissions == 1) {
        this.updateTimeouts(packet.timeSent, currentTime);
      }
      this.retransmitTimeout = this.rto;
      this.rtoTimeout = currentTime + this.rto;

      // # TODO Add handlig of decreasing bytes window, whenadding handling of congestion control

      this.retransmitCount = 0;
      return AckResult.PacketAcked;
    } else {
      // # the packet has already been acked (or not sent)
      return AckResult.PacketAlreadyAcked;
    }
  }
  async checkTimeouts() {
    let currentTime = Date.now();
    //   # flush all packets which needs to be re-send
    if (this.state != ConnectionState.Destroy) {
      await this.flushPackets();
    }

    if (this.isOpened())
      if (currentTime > this.rtoTimeout) {
        //   # TODO add handling of probe time outs. Reference implemenation has mechanism
        //   # of sending probes to determine mtu size. Probe timeouts do not count to standard
        //   # timeouts calculations

        //   # client initiated connections, but did not send following data packet in rto
        //   # time. TODO this should be configurable
        if (this.state == ConnectionState.SynRecv) {
          this.close();
          return;
        }

        if (this.shouldDisconnectFromFailedRemote()) {
          if (
            this.state == ConnectionState.SynSent &&
            inspect(this.connectionFuture).includes("pending")
          )
            //   # TODO standard stream interface result in failed future in case of failed connections,
            //   # but maybe it would be more clean to use result
            this.connectionFuture = Promise.reject(
              "Connection to Peer timed out"
            );
          this.close();
          return;
        }

        let newTimeout = this.retransmitTimeout * 2;
        this.retransmitTimeout = newTimeout;
        this.rtoTimeout = currentTime + newTimeout;

        //   # TODO Add handling of congestion control

        //   # This will have much more sense when we will add handling of selective acks
        //   # as then every selecivly acked packet restes timeout timer and removes packet
        //   # from out buffer.
        this.markAllPacketAsLost();

        //   # resend oldest packet if there are some packets in flight

        if (this.curWindowPackets > 0) {
          console.log("resending oldest packet in outBuffer");
          this.retransmitCount++;
          let oldestPacketSeqNr = this.seqNr - this.curWindowPackets;
          // # TODO add handling of fast timeout

          assert(
            this.outBuffer.get(oldestPacketSeqNr).isSome(),
            "oldest packet should always be available when there is data in flight"
          );
          let dataToSend = this.outBuffer
            .get(oldestPacketSeqNr)
            .get()
            .setSend();
          await this.sendData(this.connectionIdRcv, dataToSend);
        }
      }
  }
  _close() {
    this.state = ConnectionState.Destroy;
    this._checkTimeoutsLoop = Promise.reject<void>();
    this.closeEvent.stopPropagation();
  }

  async closeWait(): Promise<void> {
    // # TODO Rething all this when working on FIN packets and proper handling
    // # of resources
    this.close();
    await Promise.allSettled(this.closeCallbacks);
  }

  // destroy() {
  //   this.state = ConnectionState.Destroy;
  //   this.checkTimeoutsLoop.cancel();
  //   this.closeEvent.fire()

  // }

  // async destroyWait() {
  //   this.destroy()
  //   await this.closeEvent.wait()
  //   await Promise.allSettled(this.closeCallbacks)
  // }
  async flushPackets(): Promise<void> {
    var i: Uint16 = this.seqNr - this.curWindowPackets;
    while (i != this.seqNr) {
      // # sending only packet which were not transmitted yet or need a resend
      let shouldSendPacket = this.outBuffer?.exists(
        i,
        (p: OutgoingPacket) => p.transmissions == 0 || p.needResend == true
      );
      if (shouldSendPacket) {
        let toSend = this.outBuffer.get(i).get().setSend();
        await this.sendData(this.connectionIdRcv, toSend);
      }
      i++;
    }
  }
  getPacketSize(): number {
    //   # TODO currently returning constant, ultimatly it should be bases on mtu estimates
    return mtuSize;
  }

  initializeAckNr(packetSeqNr: Uint16): void {
    if (this.state == ConnectionState.SynSent) {
      this.ackNr = packetSeqNr - 1;
    }
  }
  isConnected(): boolean {
    return (
      this.state == ConnectionState.Connected ||
      this.state == ConnectionState.ConnectedFull
    );
  }
  isOpened(): boolean {
    return (
      this.state == ConnectionState.SynSent ||
      this.state == ConnectionState.SynRecv ||
      this.state == ConnectionState.Connected ||
      this.state == ConnectionState.ConnectedFull
    );
  }
  markAllPacketAsLost(): void {
    var i = 0 as Uint16;
    while (i < this.curWindowPackets) {
      let packetSeqNr = this.seqNr - 1 - i;
      if (
        this.outBuffer.exists(
          packetSeqNr,
          (p: OutgoingPacket) => p.transmissions > 0 && p.needResend == false
        )
      ) {
        this.outBuffer.get(packetSeqNr).get().needResend = true;
        //   # TODO here we should also decrease number of bytes in flight. This should be
        //   # done when working on congestion control
      }
      i++;
    }
  }
  // # Check how many packets are still in the out going buffer, usefull for tests or
  // # debugging.
  // # It throws assertion error when number of elements in buffer do not equal kept counter
  numPacketsInOutGoingBuffer(): number {
    var num = 0;
    for (let e = 0; e < this.outBuffer.items.length; e++) {
      if (this.outBuffer.items[e].isSome()) {
        num++;
      }
    }
    assert(num == this.curWindowPackets);
    return num;
  }
  // # Check how many packets are still in the reorder buffer, usefull for tests or
  // # debugging.
  // # It throws assertion error when number of elements in buffer do not equal kept counter
  numPacketsInReordedBuffer(): number | undefined {
    var num = 0;
    for (let e = 0; e < this.outBuffer.items.length; e++) {
      if (this.outBuffer.items[e].isSome()) {
        num++;
      }
      assert(num == this.reorderCount);
      return num;
    }
  }

  registerOutgoingPacket(oPacket: OutgoingPacket): void {
    //   ## Adds packet to outgoing buffer and updates all related fields
    this.outBuffer?.ensureSize(this.seqNr, this.curWindowPackets as number);
    this.outBuffer?.put(this.seqNr, oPacket);
    this.seqNr++;
    this.curWindowPackets++;
  }
  sendAck(): void {
    let ack = createAckPacket(this.seqNr, this.connectionIdSnd, this.ackNr);
    return this.sendData(this.connectionIdSnd, ack.encodePacket());
  }
  sendData(connectionId: number, data: Uint8Array): void {
    return this.send(data, connectionId, data.length);
  }

  async startIncomingSocket() {
    assert(this.state == ConnectionState.SynRecv);
    //   # Make sure ack was flushed before movig forward
    await this.sendAck();
    this.startTimeoutLoop();
  }

  sendSyn(): void {
    assert(
      this.state == ConnectionState.SynSent,
      "syn can only be send when in SynSent state"
    );
    let packet = createSynPacket(this.seqNr, this.connectionIdRcv, 1048576);
    console.log(`Sending syn packet ${packet}`);
    //   # set number of transmissions to 1 as syn packet will be send just after
    //   # initiliazation
    let outgoingPacket = new OutgoingPacket({
      packetBytes: packet.encodePacket(),
      transmissions: 1,
      needResend: false,
      timeSent: Date.now(),
    });
    this.registerOutgoingPacket(outgoingPacket);
    return this.sendData(this.connectionIdRcv, outgoingPacket.packetBytes);
  }

  shouldDisconnectFromFailedRemote(): boolean {
    return (
      (this.state == ConnectionState.SynSent && this.retransmitCount >= 2) ||
      this.retransmitCount >= this.dataResendsBeforeFailure
    );
  }

  updateTimeouts(timeSent: Moment, currentTime: Moment): void {
    let packetRtt = currentTime - timeSent;

    if (this.rtt == 0) {
      this.rtt = packetRtt;
      this.rttVar = packetRtt / 2;
    } else {
      let packetRttMicro = packetRtt as MicroSeconds;
      let rttVarMicro = this.rttVar as MicroSeconds;
      let rttMicro = this.rtt as MicroSeconds;
      let delta = rttMicro - packetRttMicro;
      let newVar = (rttVarMicro +
        (Math.abs(delta) - rttVarMicro) / 4) as MicroSeconds;
      let newRtt = this.rtt - this.rtt / 8 + packetRtt / 8;
      this.rttVar = newVar;
      this.rtt = newRtt;
    }
    //   # according to spec it should be: timeout = max(rtt + rtt_var * 4, 500)
    //   # but usually spec lags after implementation so milliseconds(1000) is used
    this.rto = max(this.rtt + this.rttVar * 4, 1000);
  }
  readLoop(body: IBody): void {
    while (true) {
      // # TODO error handling
      const consumed: string = body.consumed;
      const done: boolean = body.done;
      this.buffer?.write(consumed as string, this.buffer?.byteLength);
      if (done) {
        break;
      } else {
        // # TODO add condition to handle socket closing
        this.buffer?.readUInt32BE();
      }
    }
  }
  resetSendTimeout() {
    this.retransmitTimeout = this.rto;
    this.rtoTimeout = Date.now() + this.retransmitTimeout;
  }

  async read(n: number): Promise<Uint8Array | undefined> {
    // ## Read all bytes `n` bytes from socket ``socket``.
    // ##
    // ## This procedure allocates buffer seq[byte] and return it as result.
    var bytes = new Uint8Array();

    if (n == 0) {
      return bytes;
    }

    // readLoop():
    // # TODO Add handling of socket closing
    let count = Math.min(this.buffer.byteLength, n - bytes.length);

    bytes.set(this.buffer.subarray(0, count - 1));

    // (count, len(bytes) == n)

    return bytes;
  }

  async startOutgoingSocket(): Promise<void> {
    assert(this.state == ConnectionState.SynSent);
    //   # TODO add callback to handle errors and cancellation i.e unregister socket on
    //   # send error and finish connection future with failure
    //   # sending should be done from UtpSocketContext
    await this.sendSyn();
    this.startTimeoutLoop();
  }
  async processPacket(p: Packet) {
    // ## Updates socket state based on received packet, and sends ack when necessary.
    let pkSeqNr = p.header.seqNr;
    let pkAckNr = p.header.ackNr;
    this.initializeAckNr(pkSeqNr);
    // # number of packets past the expected
    // # ack_nr is the last acked, seq_nr is the
    // # current. Subtracring 1 makes 0 mean "this is the next expected packet"
    let pastExpected = pkSeqNr - this.ackNr - 1;
    // # acks is the number of packets that was acked, in normal case - no selective
    // # acks, no losses, no resends, it will usually be equal to 1
    // # we can calculate it here and not only for ST_STATE packet, as each utp
    // # packet has info about remote side last acked packet.
    var acks = pkAckNr - (this.seqNr - 1 - this.curWindowPackets);
    if (acks > this.curWindowPackets) {
      // # this case happens if the we already received this ack nr
      acks = 0;
    }
    // # If packet is totally off the mark short circout the processing
    if (pastExpected >= reorderBufferMaxSize) {
      console.log("Received packet is totally off the mark");
      return;
    }
    this.ackPackets(acks);
    if (p.header.pType == PacketType.ST_DATA) {
      // # To avoid amplification attacks, server socket is in SynRecv state until
      // # it receices first data transfer
      // # https://www.usenix.org/system/files/conference/woot15/woot15-paper-adamsky.pdf
      // # TODO when intgrating with discv5 this need to be configurable
      if (this.state == ConnectionState.SynRecv) {
        this.state = ConnectionState.Connected;
        console.log("Received ST_DATA on known socket");
        if (pastExpected == 0) {
          // # we are getting in order data packet, we can flush data directly to the incoming buffer
          this.buffer?.write(p.payload[0].toString(16));
          // # Bytes have been passed to upper layer, we can increase number of last
          // # acked packet
          this.ackNr++;
          // # check if the following packets are in reorder buffer
          while (true) {
            if (this.reorderCount == 0) {
              break;
            }
            // # TODO Handle case when we have reached eof becouse of fin packet
            let nextPacketNum = this.ackNr + 1;
            let maybePacket = this.inBuffer.get(nextPacketNum);
            if (maybePacket.isNone()) {
              break;
            }
            let packet = maybePacket.unsafeGet();
            this.buffer?.write(p.payload[0].toString(16));

            this.inBuffer.delete(nextPacketNum);

            this.ackNr++;
            this.reorderCount--;

            // # TODO for now we just schedule concurrent task with ack sending. It may
            // # need improvement, as with this approach there is no direct control over
            // # how many concurrent tasks there are and how to cancel them when socket
            // # is closed
            this.sendAck();
          }
        } else {
          // # TODO Handle case when out of order is out of eof range
          console.log("Got out of order packet");

          // # growing buffer before checking the packet is already there to avoid
          // # looking at older packet due to indices wrap aroud
          this.inBuffer.ensureSize(pkSeqNr + 1, pastExpected + 1);

          if (this.inBuffer.get(pkSeqNr).isSome()) {
            console.log("packet already received");
          } else {
            this.inBuffer.put(pkSeqNr, p);
            this.reorderCount++;
            console.log("added out of order packet in reorder buffer");
            // # TODO for now we do not sent any ack as we do not handle selective acks
            // # add sending of selective acks
          }
        }
      }
    } else if (p.header.pType == PacketType.ST_FIN) {
      // # TODO not implemented
      console.log("Received ST_FIN on known socket");
    } else if (p.header.pType == PacketType.ST_STATE) {
      console.log("Received ST_STATE on known socket");

      if (
        this.state == ConnectionState.SynSent &&
        inspect(this.connectionFuture).includes("pending")
      ) {
        this.state = ConnectionState.Connected;
        // # TODO reference implementation sets ackNr (p.header.seqNr - 1), although
        // # spec mention that it should be equal p.header.seqNr. For now follow the
        // # reference impl to be compatible with it. Later investigate trin compatibility.
        this.ackNr = p.header.seqNr - 1;
        // # In case of SynSent complate the future as last thing to make sure user of libray will
        // # receive socket in correct state
        Promise.resolve(this.connectionFuture);
        // # TODO to finish handhske we should respond with ST_DATA packet, without it
        // # socket is left in half-open state.
        // # Actual reference implementation waits for user to send data, as it assumes
        // # existence of application level handshake over utp. We may need to modify this
        // # to automaticly send ST_DATA .
      }
    } else if ((p.header.pType = PacketType.ST_RESET)) {
      // # TODO not implemented
      console.log("Received ST_RESET on known socket");
    } else if ((p.header.pType = PacketType.ST_SYN)) {
      // # TODO not implemented
      console.log("Received ST_SYN on known socket");
    }
  }
  registerCloseCallback(cb: SocketCloseCallBack) {
    this.closeCallbacks.push(this.setCloseCallback(cb));
  }
  async setCloseCallback(cb: SocketCloseCallBack): Promise<void> {
    // ## Set callback which will be called whenever the socket is permanently closed
    try {
      assert(this.closeEvent);
      cb();
    } catch (CancelledError) {
      console.log("closeCallback cancelled");
    }
  }

  async startTimeoutLoop(): Promise<void> {
    this._checkTimeoutsLoop = this.checkTimeoutsLoop(this);
  }
  async waitForSocketToConnect(): Promise<void> {
    await this.connectionFuture;
  }
  async _write(data: Uint8Array): Promise<number> {
    var bytesWritten = 0;
    // # TODO
    // # Handle different socket state i.e do not write when socket is full or not
    // # connected
    // # Handle growing of send window

    if (data.length == 0) {
      return bytesWritten;
    }
    if (this.curWindowPackets == 0) {
      this.resetSendTimeout();
    }

    let pSize = this.getPacketSize();
    let endIndex = data.byteLength;
    var i = 0;
    while (i <= endIndex) {
      let lastIndex = i + pSize - 1;
      let lastOrEnd = Math.min(lastIndex, endIndex);
      let dataSlice = data.subarray(i);
      let _dataPacket = createDataPacket(
        this.seqNr,
        this.connectionIdSnd,
        this.ackNr,
        1048576,
        dataSlice
      );
      this.registerOutgoingPacket(
        new OutgoingPacket({
          packetBytes: _dataPacket.encodePacket(),
          transmissions: 0,
          needResend: false,
          timeSent: Date.now(),
        })
      );
      bytesWritten = bytesWritten + dataSlice.length;
      i = lastOrEnd + 1;
    }
    await this.flushPackets();
    return bytesWritten;
  }
  async checkTimeoutsLoop(socket: UtpSocket): Promise<void> {
  //   ## Loop that check timeoutsin the socket.
  try {
    while (true) {
      await sleep(checkTimeoutsLoopInterval);
      await socket.checkTimeouts();
    }
  } catch (error) {
    console.log("checkTimeoutsLoop canceled");
  }
}
}
