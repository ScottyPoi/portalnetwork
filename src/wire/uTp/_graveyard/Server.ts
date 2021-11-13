import { bufferToPacket } from "../utils/math";
import dgram from 'dgram'
import { EventEmitter } from "stream";
import { Socket } from "./socket";
import { MIN_PACKET_SIZE, PacketType } from "../Packets/PacketTyping";
import { Packet } from "../Packets/Packet";
export class Server extends EventEmitter {
    _socket: dgram.Socket | null;
    _connections: Record<string, Socket>;
    _closed: boolean;
    constructor() {
      super();
      EventEmitter.call(this);
      this._socket = null;
      this._connections = {};
      this._closed = false;
    }
  
    address() {
      return this._socket?.address();
    }
    close(callback?: Function) {
      let self = this;
      let openSockets = 0;
      this._closed = true;
  
      const onClose = () => {
        if (openSockets === 0) {
          if (self._socket) {
            self._socket.close();
            if (callback) {
              callback();
            }
          }
        }
      };
  
      for (let id in this._connections) {
        if (this._connections[id]._closed) {
          continue;
        }
        openSockets++;
        this._connections[id].once("close", onClose);
        this._connections[id].close();
      }
    }
  
    connect(port: number, host: string) {
      let socket = dgram.createSocket("udp4");
      let connection = new Socket({
        port: port,
        host: host || "127.0.0.1",
        socket: socket,
        syn: null,
      });
      socket.on("message", (message) => {
        if (message.length < MIN_PACKET_SIZE) {
          return;
        }
        let packet = bufferToPacket(message);
        if (packet.header.pType === PacketType.ST_SYN) {
          return;
        }
        connection._recvIncoming(packet);
      });
  
      return connection;
    }
    createServer(onConnection?: () => void): Server {
      let server = new Server();
      if (onConnection) {
        server.on("connection", onConnection);
        return server;
      } else {
        return server
      }
    }
    listen(port: dgram.Socket | number, onListening: EventListener) {
      if (typeof port === "object" && typeof port.on === "function") {
        return this.listenSocket(port, onListening);
      }
      let socket = dgram.createSocket("udp4");
      this.listenSocket(socket, onListening);
      socket.bind(port as number);
    }
    listenSocket(socket: dgram.Socket, onListening: EventListener) {
      this._socket = socket;
      let connections: Record<string, Socket> = this._connections;
      let self = this;
      socket.on("message", (message, rinfo) => {
        if (message.length < MIN_PACKET_SIZE) {
          return;
        }
        let packet: Packet = bufferToPacket(message);
        let id =
          rinfo.address +
          ":" +
          (packet.header.pType === PacketType.ST_SYN
            ? packet.header.connectionId + 1
            : packet.header.connectionId);
        if (connections[id]) {
          return connections[id]._recvIncoming(packet);
        }
        //  TODO self._closed does not exist...??
        if (packet.header.pType !== PacketType.ST_SYN || self._closed) {
          return;
        }
        connections[id] = new Socket({
          port: rinfo.port,
          host: rinfo.address,
          socket: socket,
          syn: packet,
        });
        connections[id].on("close", () => {
          delete connections[id];
        });
  
        self.emit("connection", connections[id]);
      });
  
      socket.once("listening", () => {
        self.emit("listening");
      });
  
      if (onListening) {
        self.once("listening", onListening);
      }
    }
  }
  