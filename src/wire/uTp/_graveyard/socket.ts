import { Uint16, Uint32 } from "@chainsafe/lodestar-types";
import { Duplex, EventEmitter, Stream } from "stream";
import { MTU } from "../utils/constants";
import { bufferToPacket, packetToBuffer } from "../utils/math";
import { createAckPacket, createPacket, createSynPacket, Packet } from "../Packets/Packet";
import {
  BUFFER_SIZE,
  CLOSE_GRACE,
  MIN_PACKET_SIZE,
  PacketType,
} from "../Packets/PacketTyping";
import dgram from "dgram";
import { ISocketOptions } from "../utp_socket/SocketTypes";
const cyclist = require("cyclist");
export function timestamp() {
  var offset = process.hrtime();
  var then = Date.now() * 1000;
  var diff = process.hrtime(offset);

  return (then + 1000000 * diff[0] + ((diff[1] / 1000) | 0)) as Uint32;
}



export class Socket extends dgram.Socket {
  _ackNr: number;
  _alive: boolean;
  _closed: boolean;
  _connecting: boolean;
  _incomingBuffer;
  _inflightPackets: number;
  _outgoingBuffer;
  _recvId: number;
  _sendId: number;
  _seq: number;
  _synack: Packet | null;
  host: string;
  keepAlive: NodeJS.Timeout;
  port: number;
  resend: NodeJS.Timeout;
  sendFin;
  socket: dgram.Socket;
  syn: Packet | null;
  tick: number;
  constructor(options: ISocketOptions) {
    super();
    this.host = options.host;
    this.port = options.port;
    this.socket = options.socket;
    this.syn = options.syn;
    const self = this;
    this._alive = false;
    this._closed = false;
    this._incomingBuffer = cyclist(BUFFER_SIZE);
    this._inflightPackets = 0;
    this._outgoingBuffer = cyclist(BUFFER_SIZE);

    if (this.syn) {
      this._ackNr = this.syn.header.seqNr;
      this._connecting = false;
      this._recvId = this.syn.header.connectionId + 1;
      this._sendId = this.syn.header.connectionId;
      this._seq = Math.random() * 0xffff;
      this._synack = createAckPacket(this._sendId, this._seq, this._ackNr);
    } else {
      this._ackNr = 0;
      this._connecting = true;
      this._recvId = 0;
      this._sendId = 0;
      this._seq = Math.random() * 0xffff;
      this._synack = null;

      this.socket.on("listening", function () {
        self._recvId = options.socket.address().port;
        self._sendId = self._recvId + 1;
        self._sendOutgoing(
          createSynPacket(
              self._recvId,
              self._ackNr,
              self._seq,
            
          )
        );
      });
      this.socket.on("error", function (err) {
        self.emit("error", err);
      });
        this.socket.bind();
    }

    this.resend = setInterval(this._resend.bind(this), 500);
    this.keepAlive = setInterval(this._keepAlive.bind(this), 10 * 1000);
    this.tick = 0;

    const closed = () => {
      if (this.tick + 1 === 2) {
        self._closing();
      }
    };
    this.sendFin = () => {
      if (self._connecting) {
        return self.once("connect", this.sendFin);
      }
      self._sendOutgoing(
        createPacket(
          {
            Id: this._recvId,
            seqNr: this._seq,
            ackNr: this._ackNr,
          },
          PacketType.ST_FIN,
          new Uint8Array()
        )
      );
      self.once("flush", closed);
    };
    this.once("finish", this.sendFin);
    this.once("close", () => {
      if (!this.syn) {
        setTimeout(this.socket.close.bind(this), CLOSE_GRACE);
      }
      clearInterval(this.resend);
      clearInterval(this.keepAlive);
    });
  }

  _address() {
    return { port: this.port, address: this.host };
  }

  destroy() {
    this.close();
  }
  _closing() {
    if (this._closed) {
      return;
    }
    this._closed = true;
    process.nextTick(() => this.close());
  }

  _keepAlive() {
    if (this._alive) {
      return (this._alive = false);
    }
    this._sendAck();
  }

  _payload(data: Uint8Array) {
    if (data.length > MTU) {
      return data;
    }
  }

  _read() {}

  _recvAck(ackNr: number) {
    var offset = this._seq - this._inflightPackets;
    var acked = ackNr - offset + 1;

    if (acked >= BUFFER_SIZE) return; // sanity check

    for (var i = 0; i < acked; i++) {
      this._outgoingBuffer.del(offset + i);
      this._inflightPackets--;
    }

    if (!this._inflightPackets) this.emit("flush");
  }

  _recvIncoming(packet: Packet) {
    if (this._closed) {
      return;
    }
    if (packet.header.pType === PacketType.ST_SYN && this._connecting) {
      this._transmit(this._synack as Packet);
      return;
    }
    if (packet.header.pType === PacketType.ST_RESET) {
      this.send(new Uint8Array())
      this.close();
      this._closing();
      return;
    }
    if (this._connecting) {
      if (packet.header.pType === PacketType.ST_STATE) {
        return this._incomingBuffer.put(packet.header.seqNr, packet);
      }
      this._ackNr = (packet.header.seqNr - 1) as Uint16;
      this._recvAck(packet.header.ackNr);
      this._connecting = false;
      this.emit("connect");
      packet = this._incomingBuffer.readDoubleLE(packet.header.seqNr);
      if (!packet) {
        return;
      }
      if (packet.header.seqNr - this._ackNr >= BUFFER_SIZE) {
        return this._sendAck();
      }

      this._recvAck(packet.header.ackNr);

      if (packet.header.pType === PacketType.ST_STATE) {
        return;
      }

      this._incomingBuffer.put(packet.header.seqNr, packet);
    }

    while ((packet = this._incomingBuffer.readDoubleLE(this._ackNr + 1))) {
      this._ackNr = (this._ackNr + 1) as Uint16;
      if (packet.header.pType === PacketType.ST_DATA) {
        this.send(packet.payload);
      }
      if (packet.header.pType === PacketType.ST_FIN) {
        this.send(new Uint8Array())      }
    }
    this._sendAck();
  }

  _resend() {
    let offset = this._seq - this._inflightPackets;
    let first = this._outgoingBuffer.get(offset);
    if (!first) {
      return;
    }
    let timeout = 50 * 1000;
    let now = timestamp();

    if (first.sent - now < timeout) {
      return;
    }

    for (let i = 0; i < this._inflightPackets; i++) {
      let packet = this._outgoingBuffer.get(offset + i);
      if (packet.sent - now >= timeout) {
        this._transmit(packet);
      }
    }
  }

  _sendAck() {
    this._transmit(
      createPacket(
        {
          Id: this._recvId,
          seqNr: this._seq,
          ackNr: this._ackNr,
        },
        PacketType.ST_STATE,
        new Uint8Array()
      )
    );
  }

  _sendOutgoing(packet: Packet) {
    this._outgoingBuffer.put(packet.header.seqNr, packet);
    this._seq++;
    this._inflightPackets++;
    this._transmit(packet);
  }

  _transmit(packet: Packet) {
    packet.sent = packet.sent === 0 ? packet.header.timestamp : timestamp();
    let message = packetToBuffer(packet);
    this._alive = true;
    this.socket.send(message, 0, message.length, this.port, this.host);
  }

  _writable(): boolean {
    return this._inflightPackets < BUFFER_SIZE - 1;
  }

  _write(data: Uint8Array, enc: BufferEncoding, callback: Function) {
    if (this._connecting) {
      return this._writeOnce("connect", data, enc, callback);
    }
    while (this._writable()) {
      let payload = this._payload(data);
      this._sendOutgoing(
        createPacket(
          {
            Id: this._sendId,
            ackNr: this._ackNr,
            seqNr: this._seq,
          },
          PacketType.ST_DATA,
          payload as Uint8Array
        )
      );
    }
    this._writeOnce("flush", data, enc, callback);
  }

  _writeOnce(
    event: string,
    data: Uint8Array,
    enc: BufferEncoding,
    callback: Function
  ) {
    this.once(event, () => {
      this._write(data, enc, callback);
    });
  }
}

