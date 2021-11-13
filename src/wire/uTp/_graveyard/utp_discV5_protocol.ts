import { Discv5, Discv5Discovery, ENR, IDiscv5CreateOptions, NodeId } from "@chainsafe/discv5";
import { Multiaddr } from "multiaddr";
import PeerId from "peer-id";
import { MessageCodes, SubNetworkIds } from "../..";
import { PortalNetwork } from "../../..";
import { AcceptConnectionCallback, IUtpServerOptions, UtpServer } from "../utp_server";
import { defaultSocketConfig, SocketConfig } from "../utp_socket/Utp_socket";
import { IUtpSocketKeyOptions, SendCallback } from "../utp_socket/SocketTypes";
import dgram from 'dgram'
import EventEmitter from "events";
import { Duplex, Stream } from "stream";
import { IUtpProtocolOptions, UtpProtocol } from "../utp_protocol";

export interface IUtpDiscv5ProtocolOptions extends IUtpProtocolOptions {
    subNetworkId: SubNetworkIds
    config: IDiscv5CreateOptions
    routerconfig: IUtpServerOptions
    socketConfig: SocketConfig
}

export class UtpDiscv5Protocol extends UtpProtocol {
    protocol: Discv5
    router: UtpServer
    subNetworkId: SubNetworkIds
    socketConfig: SocketConfig

    constructor(options: IUtpDiscv5ProtocolOptions) {
        super(options)
        this.protocol = Discv5.create(options.config)
        this.router = new UtpServer(options.routerconfig)
        this.subNetworkId = options.subNetworkId;
        this.socketConfig = defaultSocketConfig 
    }

    async init() {
        const id = await PeerId.create({ keyType: "secp256k1"});
        const enr = ENR.createFromPeerId(id);
        enr.setLocationMultiaddr(new Multiaddr("/ip4/127.0.0.1/udp/0"));
        const portal = new PortalNetwork({
            enr: enr,
            peerId: id,
            multiaddr: new Multiaddr("/ip4/127.0.0.1/udp/0"),
            transport: "udp",
            proxyAddress: "ws://127.0.0.1:5050"
        })
        this.protocol = portal.client
        const r = new UtpServer({socketConfig: this.socketConfig})
    }

    _initSendCallback(subProtocolName: Uint8Array) {
        return (to: string, data: Uint8Array) => {
            this.protocol.sendTalkReq(to, Buffer.from(data), subProtocolName)
        }
    }

    // messageHandler(request: Uint8Array, srcId: NodeId, srcUdpAddress: Multiaddr): Uint8Array {
    //     let p = 
    
    // }

}

