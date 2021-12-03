import { _UTPSocket } from "../Socket/_UTPSocket";
import { bufferToPacket, ConnectionState, Packet, randUint16 } from "..";
import { Discv5 } from "@chainsafe/discv5";
import { debug } from "debug";

const log = debug("<uTP>");

export class UtpProtocol {
  sockets: Record<string, _UTPSocket>;
  client: Discv5;
  // payloadChunks: Buffer[];

  constructor(client: Discv5) {
    this.client = client;
    this.sockets = {};
    // this.payloadChunks = [];
  }

  // TODO: Chop up CONTENT into chunks.
  // TODO: Reassemble chunks

  // async processContent(payload: Buffer): Promise<void> {
  //   let packetSize = 1200;
  //   if (payload.length < packetSize) {
  //     this.payloadChunks.push(payload);
  //     console.log(this.payloadChunks);
  //   } else {
  //     for (let i = 0; i < payload.length; i += packetSize) {
  //       this.payloadChunks.push(payload.subarray(i, i + packetSize));
  //     }
  //   }
  // }

  // nextChunk(): Buffer {
  //   return this.payloadChunks.pop() as Buffer;
  // }

  async initiateConnectionRequest(dstId: string): Promise<number> {
    log(`Requesting uTP stream connection with ${dstId}`);
    const socket = new _UTPSocket(this, dstId);
    this.sockets[dstId] = socket;

    await this.sockets[dstId].sendSynPacket();
    return this.sockets[dstId].sndConnectionId;
  }

  async sendData(data: Buffer, dstId: string): Promise<void> {
    this.sockets[dstId].startDataTransfer(data);
  }

  async handleSynAck(ack: Packet, dstId: string): Promise<void> {
    log("Received ST_STATE packet...SYN acked...Connection established.");
    this.sockets[dstId].handleSynAckPacket(ack);
  }

  async handleAck(packet: Packet, dstId: string): Promise<void> {
    log("Received ST_STATE packet from " + dstId);
    this.sockets[dstId].handleStatePacket(packet);
  }
  async handleFin(packet: Packet, dstId: string): Promise<void> {
    log("Received ST_FIN packet from " + dstId + "...uTP stream closing...");
    this.sockets[dstId].handleFinPacket(packet);
  }

  async handleIncomingConnectionRequest(
    packet: Packet,
    dstId: string
  ): Promise<void> {
    log(
      `Received incoming ST_SYN packet...uTP connection requested by ${dstId}`
    );
    let socket = new _UTPSocket(this, dstId);
    this.sockets[dstId] = socket;
    await this.sockets[dstId].handleIncomingConnectionRequest(packet);
    log(`uTP stream opened with ${dstId}`);
  }

  async handleIncomingData(packet: Packet, dstId: string): Promise<void> {
    log(`Receiving Data Packet from ${dstId}`);
    await this.sockets[dstId].handleDataPacket(packet);
    log(`Received Data Packet from ${dstId}`);
  }
}
