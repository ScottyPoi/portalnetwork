import { Uint16 } from "@chainsafe/lodestar-types";
import { none, Option, some } from "./utils/growableBuffer";
import { decodePacketFromBytes, randUint16 } from "./utils/math";
import { Packet, createResetPacket } from "./Packets/Packet";
import { PacketType } from "./Packets/PacketTyping";
import { initIncomingSocket } from "./utp_socket/IncomingSocket";
import { initOutgoingSocket } from "./utp_socket/OutGoingSocket";
import { UtpSocketKey } from "./utp_socket/UtpSocketKey";
import {
  defaultSocketConfig,
  SocketConfig,
  UtpSocket,
} from "./utp_socket/Utp_socket";
import EventEmitter from "events";
import { Multiaddr } from "multiaddr";

export interface IConnection {
  server: UtpServer;
  client: UtpSocket;
}

export type AcceptConnectionCallback = (
  client: UtpSocket
) => Promise<void>;

export interface IUtpServerOptions {
  sockets?: Map<UtpSocketKey, UtpSocket>;
  socketConfig: SocketConfig;
}

export class UtpServer extends EventEmitter {
  sockets: Map<UtpSocketKey, UtpSocket>;
  socketConfig: typeof defaultSocketConfig;
  closed: boolean;
  rng: number[];
  constructor(options: IUtpServerOptions) {
    super()
    this.sockets = options.sockets || new Map();
    this.socketConfig = defaultSocketConfig;
    this.closed = false;
    this.rng = [];
  }

  async acceptConnectionCallback(client: UtpSocket): Promise<void> {
    client.sendAck();
  }

  allSockets(): UtpSocket[] {
    return Array.from(this.sockets.values());
  }

  // let dec = decodePacket(sender, bytes)
  close(): void {
    // # TODO Rething all this when working on FIN and RESET packets and proper handling
    // # of resources
    this.allSockets().forEach((s) => {
      s.close();
    });
  }
  //   # Connect to provided address
  //   # Reference implementation: https://github.com/bittorrent/libutp/blob/master/utp_internal.cpp#L2732
  async connectTo(address: Multiaddr): Promise<UtpSocket> {
    let config = this.socketConfig as SocketConfig;
    let socket = initOutgoingSocket(address, config);
    // this.registerUtpSocket(socket);
    await socket.startOutgoingSocket();
    await socket.waitForSocketToConnect();
    return socket;
  }

  // deRegisterUtpSocket(socket: UtpSocket) {
  //   this.sockets.delete(socket.socketKey as UtpSocketKey);
  // }

  // # There are different possiblites how connection was established, and we need to
  // # check every case

  getSocketOnReset(sender: Multiaddr, id: Uint16): Option<UtpSocket> {
    //   # id is our recv id
    let recvKey = new UtpSocketKey({ remoteAddress: sender, rcvId: id });

    //   # id is our send id, and we did nitiate the connection, our recv id is id - 1
    let sendInitKey = new UtpSocketKey({
      remoteAddress: sender,
      rcvId: id - 1,
    });

    //   # id is our send id, and we did not initiate the connection, so our recv id is id + 1
    let sendNoInitKey = new UtpSocketKey({
      remoteAddress: sender,
      rcvId: id + 1,
    });

    this.getUtpSocket(recvKey);
    return this.orElse(
      this.getUtpSocket(sendInitKey),
      this.getUtpSocket(sendNoInitKey)
    );
  }
  getUtpSocket(k: UtpSocketKey): Option<UtpSocket> {
    let s = this.sockets.get(k);
    if (!s) {
      return none<UtpSocket>();
    } else {
      return some(s);
    }
  }
  len(): number {
    //   ## returns number of active sockets
    return this.sockets.size;
  }
  orElse<T>(a: Option<T>, b: Option<T>): Option<T> {
    if (a.isSome()) {
      return a;
    } else {
      return b;
    }
  }
  async processIncomingBytes(bytes: Uint8Array, sender: Multiaddr) {
    let dec = decodePacketFromBytes(bytes);
    try {
      await this.processPacket(dec, sender);
    } catch {
      console.log(`failed to decode packet from address: ${sender}`);
    }
  }
  async processPacket(p: Packet, sender: Multiaddr) {
    console.log(`Received ${p}`);
    if ((p.header.pType = PacketType.ST_RESET)) {
      let maybeSocket = this.getSocketOnReset(sender, p.header.connectionId);
      if (maybeSocket.isSome()) {
        console.log("Received rst packet on known connection closing");
        let socket = maybeSocket.unsafeGet();
        // # reference implementation acutally changes the socket state to reset state unless
        // # user explicitly closed socket before. The only difference between reset and destroy
        // # state is that socket in destroy state is ultimatly deleted from active connection
        // # list but socket in reset state lingers there until user of library closes it
        // # explictly.
        socket.close();
      } else {
        console.log("Received rst packet for not known connection");
      }
    } else if (p.header.pType == PacketType.ST_SYN) {
      // # Syn packet are special, and we need to add 1 to header connectionId
      let socketKey = new UtpSocketKey({
        remoteAddress: sender,
        rcvId: p.header.connectionId + 1,
      });
      let maybeSocket = this.getUtpSocket(socketKey);
      let socket = this.sockets.get(socketKey) as UtpSocket;
      if (maybeSocket.isSome()) {
        console.log("Ignoring SYN for already existing connection");
      } else {
        console.log(
          "Received SYN for not known connection. Initiating incoming connection"
        );
        // # Initial ackNr is set to incoming packer seqNr
        let incomingSocket = initIncomingSocket(
          sender,

          this.socketConfig as SocketConfig,
          p.header.connectionId,
          p.header.seqNr
        );
        // , this.rng[])
        // this.registerUtpSocket(incomingSocket);
        await incomingSocket.startIncomingSocket();
        // # TODO By default (when we have utp over udp) socket here is passed to upper layer
        // # in SynRecv state, which is not writeable i.e user of socket cannot write
        // # data to it unless some data will be received. This is counter measure to
        // # amplification attacks.
        // # During integration with discovery v5 (i.e utp over discovv5), we must re-think
        // # this.
        // async Spawn
        await this.acceptConnectionCallback(incomingSocket);
      }
    } else {
      let socketKey = new UtpSocketKey({
        remoteAddress: sender,
        rcvId: p.header.connectionId,
      });
      let maybeSocket = this.getUtpSocket(socketKey);
      if (maybeSocket.isSome()) {
        let socket = maybeSocket.unsafeGet();
        await socket.processPacket(p);
      } else {
        // # TODO add keeping track of recently send reset packets and do not send reset
        // # to peers which we recently send reset to.
        console.log("Recevied FIN/DATA/ACK on not known socket sending reset");
        let rstPacket = createResetPacket(
          p.header.seqNr,
          p.header.connectionId,
          p.header.seqNr,
          randUint16()
        );
        await maybeSocket.value?.send(rstPacket.encodePacket());
      }
    }
  }

  async shutdownWait() {
    let activeSockets: UtpSocket[] = [];
    this.closed = true;
    this.allSockets().forEach((s) => {
      activeSockets.push(s);
    });
    activeSockets.forEach((s) => {
      s.closeWait();
    });
  }
}
