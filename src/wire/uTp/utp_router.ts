import { Uint16 } from "@chainsafe/lodestar-types";
import assert from "assert";
import { none, Option, some } from "./growableBuffer";
import { randUint16 } from "./math";
import { decodePacket, Packet, resetPacket } from "./Packets/packets";
import { PacketType } from "./Packets/PacketTyping";
import { initIncomingSocket } from "./utp_socket/IncomingSocket";
import { initOutgoingSocket } from "./utp_socket/OutGoingSocket";
import { UtpSocketKey } from "./utp_socket/UtpSocketKey";
import { UtpSocket } from "./utp_socket/utp_socket";
import { SocketConfig } from "./utp_socket/utp_socket_typing";

const logScope = {
  topics: "utp_router",
};

//   # ``server`` - UtpProtocol object.
//   # ``client`` - accepted client utp socket.
type AcceptConnectionCallback<A> = (
  server: UtpRouter<A>,
  client: UtpSocket<A>
) => Promise<void>;


export interface IUtpRouterOptions<A> {
  acceptConnectionCb: AcceptConnectionCallback<A>;
  socketConfig: SocketConfig;
}

export class UtpRouter<A> {
  acceptConnection: AcceptConnectionCallback<A>;
  socketConfig: SocketConfig;
  rng: unknown;
  constructor(options: IUtpRouterOptions<A>) {
    this.acceptConnection = options.acceptConnectionCb;
    this.socketConfig = options.socketConfig;
  }

  sockets = new Map<UtpSocketKey<A>, UtpSocket<A>>();
  orElse<A>(a: Option<A>, b: Option<A>): Option<A> {
    if (a.isSome()) {
      return a;
    } else {
      return b;
    }
  }

  len(): number {
    //   ## returns number of active sockets
    return this.sockets.size;
  }
  registerUtpSocket(s: UtpSocket<A>) {
    //   # TODO Handle duplicates
    this.sockets.set(s.socketKey, s);
    //   # Install deregister handler, so when socket will get closed, in will be promptly
    //   # removed from open sockets table
    s.registerCloseCallback(() => this.deRegisterUtpSocket(s));
  }
  deRegisterUtpSocket(socket: UtpSocket<A>) {
    this.sockets.delete(socket.socketKey as UtpSocketKey<A>);
  }

  allSockets() {
    return Array.from(this.sockets.values());
  }

  getUtpSocket(k: UtpSocketKey<A>): Option<UtpSocket<A>> {
    let s = this.sockets.get(k);
    if (!s) {
      return none<UtpSocket<A>>();
    } else {
      return some(s);
    }
  }
  // # There are different possiblites how connection was established, and we need to
  // # check every case

  getSocketOnReset(sender: A, id: Uint16): Option<UtpSocket<A>> {
    //   # id is our recv id
    let recvKey = new UtpSocketKey<A>({ remoteAddress: sender, rcvId: id });

    //   # id is our send id, and we did nitiate the connection, our recv id is id - 1
    let sendInitKey = new UtpSocketKey<A>({
      remoteAddress: sender,
      rcvId: id - 1,
    });

    //   # id is our send id, and we did not initiate the connection, so our recv id is id + 1
    let sendNoInitKey = new UtpSocketKey<A>({
      remoteAddress: sender,
      rcvId: id + 1,
    });

    this.getUtpSocket(recvKey);
    return this.orElse(
      this.getUtpSocket(sendInitKey),
      this.getUtpSocket(sendNoInitKey)
    );
  }

  async processPacket(p: Packet, sender: A) {
    console.log(`Received ${p}`);
    //   case p.header.pType
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
      let socketKey = new UtpSocketKey<A>({
        remoteAddress: sender,
        rcvId: p.header.connectionId + 1,
      });
      let maybeSocket = this.getUtpSocket(socketKey);
      let socket = this.sockets.get(socketKey) as UtpSocket<A>;
      if (maybeSocket.isSome()) {
        console.log("Ignoring SYN for already existing connection");
      } else {
        console.log(
          "Received SYN for not known connection. Initiating incoming connection"
        );
        // # Initial ackNr is set to incoming packer seqNr
        let incomingSocket = initIncomingSocket<A>(
          sender,
          socket.send,
          this.socketConfig,
          p.header.connectionId,
          p.header.seqNr
        );
        // , this.rng[])
        this.registerUtpSocket(incomingSocket);
        await incomingSocket.startIncomingSocket();
        // # TODO By default (when we have utp over udp) socket here is passed to upper layer
        // # in SynRecv state, which is not writeable i.e user of socket cannot write
        // # data to it unless some data will be received. This is counter measure to
        // # amplification attacks.
        // # During integration with discovery v5 (i.e utp over discovv5), we must re-think
        // # this.
        // async Spawn
        this.acceptConnection(this, incomingSocket);
      }
    } else {
      let socketKey = new UtpSocketKey<A>({
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
        let rstPacket = resetPacket(
          p.header.seqNr,
          p.header.connectionId,
          p.header.seqNr,
          randUint16()
        );
        await maybeSocket.value?.send(sender, rstPacket.encodePacket());
      }
    }
  }
  async processIncomingBytes(bytes: Uint8Array, sender: A) {
    // let dec = decodePacket(sender, bytes)
    let dec = decodePacket(bytes);
    try {
      await this.processPacket(dec, sender);
    } catch {
      console.log(`failed to decode packet from address: ${sender}`);
    }
  }
  //   # Connect to provided address
  //   # Reference implementation: https://github.com/bittorrent/libutp/blob/master/utp_internal.cpp#L2732
  async connectTo(address: A): Promise<UtpSocket<A>> {
    let socket = initOutgoingSocket<A>(address, this.socketConfig);
    this.registerUtpSocket(socket);
    await socket.startOutgoingSocket();
    await socket.waitForSocketToConnect();
    return socket;
  }

  close<A>() {
    // # TODO Rething all this when working on FIN and RESET packets and proper handling
    // # of resources
    this.allSockets().forEach((s) => {
      s.close();
    });
  }
}
