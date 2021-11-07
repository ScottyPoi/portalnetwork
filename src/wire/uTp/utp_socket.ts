import { Uint16, Uint32 } from "@chainsafe/lodestar-types";
import assert from "assert";
import { inspect } from "util";
import { GrowableCircularBuffer, IGCBOptions, init, Option } from "./growableBuffer";
import {
  ackPacket,
  encodePacket,
  MicroSeconds,
  Packet,
  randUint16,
  synPacket,
} from "./packets";

const reorderBufferMaxSize: number = 1024;
//   # Maximal number of payload bytes per packet. Total packet size will be equal to
//   # mtuSize + sizeof(header) = 600 bytes
//   # TODO for now it is just some random value. Ultimatly this value should be dynamically
//   # adjusted based on traffic.
const mtuSize: number = 580;

//   # How often each socket check its different on going timers
const checkTimeoutsLoopInterval: number = 500;

//   # Defualt initial timeout for first Syn packet
const defaultInitialSynTimeout: number = 3000;

//   # Initial timeout to receive first Data data packet after receiving initial Syn
//   # packet. (TODO it should only be set when working over udp)
const initialRcvRetransmitTimeout: number = 10000;

//   # Number of times each data packet will be resend before declaring connection
//   # dead. 4 is taken from reference implementation:
const defaultDataResendsBeforeFailure: Uint16 = 4;
const logScope = {
  topics: "utp_socket",
};

enum ConnectionState {
  SynSent,
  SynRecv,
  Connected,
  ConnectedFull,
  Reset,
  Destroy,
}

enum ConnectionDirection {
  Outgoing,
  Ingoing,
}

export interface IUtpSocketKeyOptions<A> {
  remoteAddress: A;
  rcvId: Uint16;
}

export class UtpSocketKey<A> {
  remoteAddress: A;
  rcvId: Uint16;

  constructor(options: IUtpSocketKeyOptions<A>) {
    (this.remoteAddress = options.remoteAddress), (this.rcvId = options.rcvId);
  }
}

enum AckResult {
  PacketAcked,
  PacketAlreadyAcked,
  PacketNotSentYet,
}

type Miliseconds = Uint32;
type Moment = Miliseconds;
type Duration = Miliseconds;

export interface IOutgoingPacket {
  packetBytes: Uint8Array;
  transmissions: Uint16;
  needResend: boolean;
  timeSent: Moment;
}

export class OutgoingPacket {
  packetBytes: Uint8Array;
  transmissions: Uint16;
  needResend: boolean;
  timeSent: Moment;
  constructor(options: IOutgoingPacket) {
    (this.packetBytes = options.packetBytes),
      (this.transmissions = options.transmissions),
      (this.needResend = options.needResend),
      (this.timeSent = options.timeSent);
  }
  // # Should be called before sending packet
  setSend(): Uint8Array {
    this.transmissions++;
    this.needResend = false;
    this.timeSent = Date.now();
    return this.packetBytes;
  }
}

export type SendCallback<A> = (to: A, data: Uint8Array) => Promise<void>;

export type SocketConfig = {
  initialSynTimeout: Duration;
  dataResendsBeforeFailure: Uint16;
};

export interface IUtpSocket<A> {
  remoteAddress: A;
  state: ConnectionState;
  direction: ConnectionDirection;
  socketConfig: SocketConfig;
  connectionIdRcv: Uint16;
  connectionIdSnd: Uint16;
  seqNr: Uint16;
  ackNr: Uint16;
  connectionFuture?: Promise<void>;
  curWindowPackets?: Uint16;
  outBuffer?: GrowableCircularBuffer<OutgoingPacket>;
  inBuffer?: GrowableCircularBuffer<OutgoingPacket>;
  reorderCount?: Uint16;
  retransmitTimeout?: Duration;
  rtt?: Duration;
  rttVar?: Duration;
  rto?: Duration;
  rtoTimeout?: Moment;
  buffer?: Buffer;
  checkTimeoutsLoop?: Promise<void>;
  retransmitCount?: Uint32;
  closeEvent?: CloseEvent;
  closeCallbacks?: Promise<void>[];
  socketKey?: UtpSocketKey<A>;
  send: SendCallback<A>;
}

// export type UtpSocketType<A> = IUtpSocket<A>

export class UtpSocket<A> {
  remoteAddress: A;
  state: ConnectionState;
  direction: ConnectionDirection;
  socketConfig: SocketConfig;
  connectionIdRcv: Uint16;
  connectionIdSnd: Uint16;
  seqNr: Uint16;
  ackNr: Uint16;
  connectionFuture?: Promise<void>;
  curWindowPackets: Uint16;
  outBuffer: GrowableCircularBuffer<OutgoingPacket>;
  inBuffer: GrowableCircularBuffer<OutgoingPacket>;
  reorderCount: Uint16;
  retransmitTimeout: Duration;
  rtt: Duration;
  rttVar?: Duration;
  rto?: Duration;
  rtoTimeout: Moment;
  buffer?: Buffer;
  checkTimeoutsLoop?: Promise<void>;
  retransmitCount: Uint32;
  closeEvent: CloseEvent;
  closeCallbacks?: Promise<void>[];
  socketKey?: UtpSocketKey<A>;
  send: SendCallback<A>;

  constructor(options: IUtpSocket<A>) {
    this.remoteAddress = options.remoteAddress;
    this.state = options.state;
    this.direction = options.direction;
    this.socketConfig = options.socketConfig;
    this.connectionIdRcv = options.connectionIdRcv;
    this.connectionIdSnd = options.connectionIdSnd;
    this.seqNr = options.seqNr;
    this.ackNr = options.ackNr;
    this.connectionFuture = options.connectionFuture;
    this.curWindowPackets = options.curWindowPackets || 0;
    this.outBuffer = options.outBuffer || new GrowableCircularBuffer({items: new Array<Option<OutgoingPacket>>(), mask: 0});
    this.inBuffer = options.inBuffer || new GrowableCircularBuffer()
    this.reorderCount = options.reorderCount || 0;
    this.retransmitTimeout = options.retransmitTimeout || 1000;
    this.rtt = options.rtt || 0;
    this.rttVar = options.rttVar;
    this.rto = options.rto;
    this.rtoTimeout = options.rtoTimeout || 0;
    this.buffer = options.buffer;
    this.checkTimeoutsLoop = options.checkTimeoutsLoop;
    this.retransmitCount = options.retransmitCount || 0;
    this.closeEvent = options.closeEvent || new CloseEvent("close");
    this.closeCallbacks = options.closeCallbacks;
    this.socketKey = options.socketKey;
    this.send = options.send;
  }
  isOpened(): boolean {
    return (
      this.state == ConnectionState.SynSent ||
      this.state == ConnectionState.SynRecv ||
      this.state == ConnectionState.Connected ||
      this.state == ConnectionState.ConnectedFull
    );
  }

  registerOutgoingPacket<A>(oPacket: OutgoingPacket): void {
    //   ## Adds packet to outgoing buffer and updates all related fields
    this.outBuffer?.ensureSize(this.seqNr, this.curWindowPackets as number);
    this.outBuffer?.put(this.seqNr, oPacket);
    this.seqNr++;
    this.curWindowPackets++;
  }

  sendData(data: Uint8Array): Promise<void> {
    return this.send(this.remoteAddress, data);
  }

  sendAck(): Promise<void> {
    //   ## Creates and sends ack, based on current socket state. Acks are different from
    //   ## other packets as we do not track them in outgoing buffet
    let _ackPacket = ackPacket(
      this.seqNr,
      this.connectionIdSnd,
      this.ackNr,
      1048576
    );
    return this.sendData(encodePacket(_ackPacket));
  }

  sendSyn(): Promise<void> {
    assert(
      this.state == ConnectionState.SynSent,
      "syn can only be send when in SynSent state"
    );
    let packet = synPacket(this.seqNr, this.connectionIdRcv, 1048576);
    console.log(`Sending syn packet ${packet}`);
    //   # set number of transmissions to 1 as syn packet will be send just after
    //   # initiliazation
    let outgoingPacket = init_OutgoingPacket(encodePacket(packet), 1, false);
    this.registerOutgoingPacket(outgoingPacket);
    return this.sendData(outgoingPacket.packetBytes);
  }

  async flushPackets() {
    var i: Uint16 = this.seqNr - this.curWindowPackets;
    while (i != this.seqNr) {
      // # sending only packet which were not transmitted yet or need a resend
      let shouldSendPacket = this.outBuffer?.exists(
        i,
        (p: OutgoingPacket) => p.transmissions == 0 || p.needResend == true
      );
      if (shouldSendPacket) {
        let toSend = this.outBuffer.get(i).get().setSend();
        await this.sendData(toSend);
      }
      i++;
    }
  }
  markAllPacketAsLost() {
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

  shouldDisconnectFromFailedRemote(): boolean {
    return (
      (this.state == ConnectionState.SynSent && this.retransmitCount >= 2) ||
      this.retransmitCount >= this.socketConfig.dataResendsBeforeFailure
    );
  }

  // close() {
  // //   # TODO Rething all this when working on FIN packets and proper handling
  // //   # of resources
  //   this.state = ConnectionState.Destroy
  //   this.checkTimeoutsLoop.cancel()
  //   this.closeEvent.fire()
  // }

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
        //   if (this.state == ConnectionState.SynRecv) {
        //     this.close()
        //     return }

        //   if (this.shouldDisconnectFromFailedRemote()) {
        //     if (this.state == ConnectionState.SynSent && (inspect(this.connectionFuture).includes('pending')))

        //     //   # TODO standard stream interface result in failed future in case of failed connections,
        //     //   # but maybe it would be more clean to use result
        //       this.connectionFuture.fail(newException(ConnectionError, "Connection to peer timed out"))

        //     this.close()
        //     return}

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
          await this.sendData(dataToSend);
        }
      }
  }
}

async function checkTimeoutsLoop<A>(socket: UtpSocket<A>) {
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

function sleep(ms: Miliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export type SocketCloseCallBack = () => void;

export type ConnectionError = Error;

export function init_UtpSocketKey<A>(
  remoteAddress: A,
  rcvId: Uint16
): UtpSocketKey<A> {
  return new UtpSocketKey({ remoteAddress: remoteAddress, rcvId: rcvId });
}

function init_OutgoingPacket(
  packetBytes: Uint8Array,
  transmissions: Uint16,
  needResend: boolean,
  timeSent: Moment = Date.now()
): OutgoingPacket {
  return new OutgoingPacket({
    packetBytes: packetBytes,
    transmissions: transmissions,
    needResend: needResend,
    timeSent: timeSent,
  });
}

export function init_SocketConfig(
  initialSynTimeout: Duration = defaultInitialSynTimeout,
  dataResendsBeforeFailure: Uint16 = defaultDataResendsBeforeFailure
): SocketConfig {
  return {
    initialSynTimeout: initialSynTimeout,
    dataResendsBeforeFailure: dataResendsBeforeFailure,
  };
}

function startTimeoutLoop<A>(s: UtpSocket<A>): void {
  s.checkTimeoutsLoop = checkTimeoutsLoop(s);
}

// function makeNew<A>(
//   T: UtpSocket<A>,
//   to: A,
//   snd: SendCallback<A>,
//   state: ConnectionState,
//   cfg: SocketConfig,
//   direction: ConnectionDirection,
//   rcvId: Uint16,
//   sndId: Uint16,
//   initialSeqNr: Uint16,
//   initialAckNr: Uint16
// ): UtpSocket<A> {
//   let initialTimeout = direction == ConnectionDirection.Outgoing
//   ? cfg.initialSynTimeout
//   : initialRcvRetransmitTimeout

//   return new UtpSocket<A>(
//     {remoteAddress: to,
//     state: state,
//     direction: direction,
//     socketConfig: cfg,
//     connectionIdRcv: rcvId,
//     connectionIdSnd: sndId,
//     seqNr: initialSeqNr,
//     ackNr: initialAckNr,
//     connectionFuture: new Promise<void>((resolve, reject) => {}),
//     curWindowPackets: 0,
//     outBuffer: init<OutgoingPacket>(),
//     inBuffer: init<OutgoingPacket>(),
//     reorderCount: 0,
//     retransmitTimeout: initialTimeout,
//     rtt: 0,
//     rttVar: 800,
//     rto: 3000,
//     rtoTimeout: Date.now() + initialTimeout,
//     buffer: Buffer.alloc(1024 * 1024),
//     checkTimeoutsLoop: new Promise<void>((res, rej) => {}),
//     retransmitCount: 0,
//     closeEvent: new Event("Close"),
//     closeCallbacks: new Array<Promise<void>>(),
//     socketKey: init_UtpSocketKey(to, rcvId),
//     send: snd}
//   )

// }

function initOutgoingSocket<A>(
  to: A,
  snd: SendCallback<A>,
  cfg: SocketConfig
  //   rng: BrHmacDrbgContext
): UtpSocket<A> {
  //   # TODO handle possible clashes and overflows
  let rcvConnectionId = randUint16();
  let sndConnectionId = rcvConnectionId + 1;
  let initialSeqNr = randUint16();

  return new UtpSocket<A>({
    remoteAddress: to,
    send: snd,
    state: ConnectionState.SynSent,
    socketConfig: cfg,
    direction: ConnectionDirection.Outgoing,
    connectionIdRcv: rcvConnectionId,
    connectionIdSnd: sndConnectionId,
    seqNr: initialSeqNr,
    // # Initialy ack nr is 0, as we do not know remote inital seqnr
    ackNr: 0,
  });
}

function initIncomingSocket<A>(
  to: A,
  snd: SendCallback<A>,
  cfg: SocketConfig,
  connectionId: Uint16,
  ackNr: Uint16,
//   rng: var BrHmacDrbgContext
): UtpSocket<A> {
  let initialSeqNr = randUint16()
  return new UtpSocket<A>({
    remoteAddress: to,
    send: snd,
    state: ConnectionState.SynRecv,
    socketConfig: cfg,
    direction: ConnectionDirection.Ingoing,
    connectionIdRcv: connectionId,
    connectionIdSnd: connectionId,
    seqNr: initialSeqNr,
    ackNr: ackNr
  })}

async function startOutgoingSocket<A>(socket: UtpSocket<A>): Promise<void>  {
  assert(socket.state == ConnectionState.SynSent)
//   # TODO add callback to handle errors and cancellation i.e unregister socket on
//   # send error and finish connection future with failure
//   # sending should be done from UtpSocketContext
  await socket.sendSyn()
  startTimeoutLoop(socket)
}
async function waitFotSocketToConnect<A>(socket: UtpSocket<A>): Promise<void> { 
  await socket.connectionFuture}

async function startIncomingSocket<A>(socket: UtpSocket<A>) {
  assert(socket.state == ConnectionState.SynRecv)
//   # Make sure ack was flushed before movig forward
  await socket.sendAck()
  startTimeoutLoop(socket)}

function isConnected<A>(socket: UtpSocket<A>): boolean {
  return socket.state == ConnectionState.Connected || socket.state == ConnectionState.ConnectedFull

}

// function close<A>(s: UtpSocket<A>) {
// //   # TODO Rething all this when working on FIN packets and proper handling
// //   # of resources
//   s.state = ConnectionState.Destroy
//   s.checkTimeoutsLoop.
//   s.closeEvent.fire()
// }

// proc closeWait*(s: UtpSocket) {.async.} =
//   # TODO Rething all this when working on FIN packets and proper handling
//   # of resources
//   s.close()
//   await allFutures(s.closeCallbacks)

// proc setCloseCallback(s: UtpSocket, cb: SocketCloseCallback) {.async.} =
//   ## Set callback which will be called whenever the socket is permanently closed
//   try:
//     await s.closeEvent.wait()
//     cb()
//   except CancelledError:
//     trace "closeCallback cancelled"

// proc registerCloseCallback*(s: UtpSocket, cb: SocketCloseCallback) =
//   s.closeCallbacks.add(s.setCloseCallback(cb))

function max(a: number, b: Duration): Duration {
  return a > b ?
    a :
    b
}

function updateTimeouts<A>(socket: UtpSocket<A>, timeSent: Moment, currentTime: Moment): void {
//   ## Update timeouts according to spec:
//   ## delta = rtt - packet_rtt
//   ## rtt_var += (abs(delta) - rtt_var) / 4;
//   ## rtt += (packet_rtt - rtt) / 8;

  let packetRtt = currentTime - timeSent

  if (socket.rtt == 0) {
    socket.rtt = packetRtt
    socket.rttVar = packetRtt / 2}
  else {
    let packetRttMicro = packetRtt as MicroSeconds
    let rttVarMicro = socket.rttVar as MicroSeconds
    let rttMicro = socket.rtt as MicroSeconds

    let delta = rttMicro - packetRttMicro

    let newVar = (rttVarMicro + (Math.abs(delta) - rttVarMicro) / 4) as MicroSeconds
    let newRtt = socket.rtt - (socket.rtt / 8) + (packetRtt / 8)

    socket.rttVar = newVar
    socket.rtt = newRtt
}
//   # according to spec it should be: timeout = max(rtt + rtt_var * 4, 500)
//   # but usually spec lags after implementation so milliseconds(1000) is used
  socket.rto = max(socket.rtt + (socket.rttVar * 4), 1000 as MicroSeconds)
}
// proc ackPacket(socket: UtpSocket, seqNr: uint16): AckResult =
//   let packetOpt = socket.outBuffer.get(seqNr)
//   if packetOpt.isSome():
//     let packet = packetOpt.get()

//     if packet.transmissions == 0:
//       # according to reference impl it can happen when we get an ack_nr that
//       # does not exceed what we have stuffed into the outgoing buffer,
//       # but does exceed what we have sent
//       # TODO analyze if this case can happen with our impl
//       return PacketNotSentYet

//     let currentTime = Moment.now()

//     socket.outBuffer.delete(seqNr)

//     # from spec: The rtt and rtt_var is only updated for packets that were sent only once.
//     # This avoids problems with figuring out which packet was acked, the first or the second one.
//     # it is standard solution to retransmission ambiguity problem
//     if packet.transmissions == 1:
//       socket.updateTimeouts(packet.timeSent, currentTime)

//     socket.retransmitTimeout = socket.rto
//     socket.rtoTimeout = currentTime + socket.rto

//     # TODO Add handlig of decreasing bytes window, whenadding handling of congestion control

//     socket.retransmitCount = 0
//     PacketAcked
//   else:
//     # the packet has already been acked (or not sent)
//     PacketAlreadyAcked

// proc ackPackets(socket: UtpSocket, nrPacketsToAck: uint16) =
//   ## Ack packets in outgoing buffer based on ack number in the received packet
//   var i = 0
//   while i < int(nrPacketsToack):
//     let result = socket.ackPacket(socket.seqNr - socket.curWindowPackets)
//     case result
//     of PacketAcked:
//       dec socket.curWindowPackets
//     of PacketAlreadyAcked:
//       dec socket.curWindowPackets
//     of PacketNotSentYet:
//       debug "Tried to ack packed which was not sent yet"
//       break

//     inc i

// proc initializeAckNr(socket: UtpSocket, packetSeqNr: uint16) =
//   if (socket.state == SynSent):
//     socket.ackNr = packetSeqNr - 1

// # TODO at socket level we should handle only FIN/DATA/ACK packets. Refactor to make
// # it enforcable by type system
// # TODO re-think synchronization of this procedure, as each await inside gives control
// # to scheduler which means there could be potentialy several processPacket procs
// # running
// proc processPacket*(socket: UtpSocket, p: Packet) {.async.} =
//   ## Updates socket state based on received packet, and sends ack when necessary.
//   ## Shoyuld be called in main packet receiving loop
//   let pkSeqNr = p.header.seqNr
//   let pkAckNr = p.header.ackNr

//   socket.initializeAckNr(pkSeqNr)

//   # number of packets past the expected
//   # ack_nr is the last acked, seq_nr is the
//   # current. Subtracring 1 makes 0 mean "this is the next expected packet"
//   let pastExpected = pkSeqNr - socket.ackNr - 1

//   # acks is the number of packets that was acked, in normal case - no selective
//   # acks, no losses, no resends, it will usually be equal to 1
//   # we can calculate it here and not only for ST_STATE packet, as each utp
//   # packet has info about remote side last acked packet.
//   var acks = pkAckNr - (socket.seqNr - 1 - socket.curWindowPackets)

//   if acks > socket.curWindowPackets:
//     # this case happens if the we already received this ack nr
//     acks = 0

//   # If packet is totally of the mark short circout the processing
//   if pastExpected >= reorderBufferMaxSize:
//     notice "Received packet is totally of the mark"
//     return

//   socket.ackPackets(acks)

//   case p.header.pType
//     of ST_DATA:
//       # To avoid amplification attacks, server socket is in SynRecv state until
//       # it receices first data transfer
//       # https://www.usenix.org/system/files/conference/woot15/woot15-paper-adamsky.pdf
//       # TODO when intgrating with discv5 this need to be configurable
//       if (socket.state == SynRecv):
//         socket.state = Connected

//       notice "Received ST_DATA on known socket"

//       if (pastExpected == 0):
//         # we are getting in order data packet, we can flush data directly to the incoming buffer
//         await upload(addr socket.buffer, unsafeAddr p.payload[0], p.payload.len())

//         # Bytes have been passed to upper layer, we can increase number of last
//         # acked packet
//         inc socket.ackNr

//         # check if the following packets are in reorder buffer
//         while true:
//           if socket.reorderCount == 0:
//             break

//           # TODO Handle case when we have reached eof becouse of fin packet
//           let nextPacketNum = socket.ackNr + 1
//           let maybePacket = socket.inBuffer.get(nextPacketNum)

//           if maybePacket.isNone():
//             break

//           let packet = maybePacket.unsafeGet()

//           await upload(addr socket.buffer, unsafeAddr packet.payload[0], packet.payload.len())

//           socket.inBuffer.delete(nextPacketNum)

//           inc socket.ackNr
//           dec socket.reorderCount

//         # TODO for now we just schedule concurrent task with ack sending. It may
//         # need improvement, as with this approach there is no direct control over
//         # how many concurrent tasks there are and how to cancel them when socket
//         # is closed
//         asyncSpawn socket.sendAck()
//       else:
//         # TODO Handle case when out of order is out of eof range
//         notice "Got out of order packet"

//         # growing buffer before checking the packet is already there to avoid
//         # looking at older packet due to indices wrap aroud
//         socket.inBuffer.ensureSize(pkSeqNr + 1, pastExpected + 1)

//         if (socket.inBuffer.get(pkSeqNr).isSome()):
//           notice "packet already received"
//         else:
//           socket.inBuffer.put(pkSeqNr, p)
//           inc socket.reorderCount
//           notice "added out of order packet in reorder buffer"
//           # TODO for now we do not sent any ack as we do not handle selective acks
//           # add sending of selective acks
//     of ST_FIN:
//       # TODO not implemented
//       notice "Received ST_FIN on known socket"
//     of ST_STATE:
//       notice "Received ST_STATE on known socket"

//       if (socket.state == SynSent and (not socket.connectionFuture.finished())):
//         socket.state = Connected
//         # TODO reference implementation sets ackNr (p.header.seqNr - 1), although
//         # spec mention that it should be equal p.header.seqNr. For now follow the
//         # reference impl to be compatible with it. Later investigate trin compatibility.
//         socket.ackNr = p.header.seqNr - 1
//         # In case of SynSent complate the future as last thing to make sure user of libray will
//         # receive socket in correct state
//         socket.connectionFuture.complete()
//         # TODO to finish handhske we should respond with ST_DATA packet, without it
//         # socket is left in half-open state.
//         # Actual reference implementation waits for user to send data, as it assumes
//         # existence of application level handshake over utp. We may need to modify this
//         # to automaticly send ST_DATA .
//     of ST_RESET:
//       # TODO not implemented
//       notice "Received ST_RESET on known socket"
//     of ST_SYN:
//       # TODO not implemented
//       notice "Received ST_SYN on known socket"

// template readLoop(body: untyped): untyped =
//   while true:
//     # TODO error handling
//     let (consumed, done) = body
//     socket.buffer.shift(consumed)
//     if done:
//       break
//     else:
//       # TODO add condition to handle socket closing
//       await socket.buffer.wait()

// proc getPacketSize(socket: UtpSocket): int =
//   # TODO currently returning constant, ultimatly it should be bases on mtu estimates
//   mtuSize

// proc resetSendTimeout(socket: UtpSocket) =
//   socket.retransmitTimeout = socket.rto
//   socket.rtoTimeout = Moment.now() + socket.retransmitTimeout

// proc write*(socket: UtpSocket, data: seq[byte]): Future[int] {.async.} =
//   var bytesWritten = 0
//   # TODO
//   # Handle different socket state i.e do not write when socket is full or not
//   # connected
//   # Handle growing of send window

//   if len(data) == 0:
//     return bytesWritten

//   if socket.curWindowPackets == 0:
//     socket.resetSendTimeout()

//   let pSize = socket.getPacketSize()
//   let endIndex = data.high()
//   var i = 0
//   while i <= data.high:
//     let lastIndex = i + pSize - 1
//     let lastOrEnd = min(lastIndex, endIndex)
//     let dataSlice = data[i..lastOrEnd]
//     let dataPacket = dataPacket(socket.seqNr, socket.connectionIdSnd, socket.ackNr, 1048576, dataSlice)
//     socket.registerOutgoingPacket(OutgoingPacket.init(encodePacket(dataPacket), 0, false))
//     bytesWritten = bytesWritten + len(dataSlice)
//     i = lastOrEnd + 1
//   await socket.flushPackets()
//   return bytesWritten

// proc read*(socket: UtpSocket, n: Natural): Future[seq[byte]] {.async.}=
//   ## Read all bytes `n` bytes from socket ``socket``.
//   ##
//   ## This procedure allocates buffer seq[byte] and return it as result.
//   var bytes = newSeq[byte]()

//   if n == 0:
//     return bytes

//   readLoop():
//     # TODO Add handling of socket closing
//     let count = min(socket.buffer.dataLen(), n - len(bytes))
//     bytes.add(socket.buffer.buffer.toOpenArray(0, count - 1))
//     (count, len(bytes) == n)

//   return bytes

// # Check how many packets are still in the out going buffer, usefull for tests or
// # debugging.
// # It throws assertion error when number of elements in buffer do not equal kept counter
// proc numPacketsInOutGoingBuffer*(socket: UtpSocket): int =
//   var num = 0
//   for e in socket.outBuffer.items():
//     if e.isSome():
//       inc num
//   doAssert(num == int(socket.curWindowPackets))
//   num

// # Check how many packets are still in the reorder buffer, usefull for tests or
// # debugging.
// # It throws assertion error when number of elements in buffer do not equal kept counter
// proc numPacketsInReordedBuffer*(socket: UtpSocket): int =
//   var num = 0
//   for e in socket.inBUffer.items():
//     if e.isSome():
//       inc num
//   doAssert(num == int(socket.reorderCount))
//   num

//     © 2021 GitHub, Inc.
//     Terms
//     Privacy
//     Security
//     Status
//     Docs

//     Contact GitHub
//     Pricing
//     API
//     Training
//     Blog
//     About
