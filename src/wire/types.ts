import { ContainerType, ByteVector, BigIntUintType, UnionType, ListType, byteType, NumberUintType, BitListType, ByteVectorType, Union } from "@chainsafe/ssz";
import { NoneType } from '@chainsafe/ssz/lib/types/basic/none'

// Subnetwork IDs
export enum SubNetworkIds {
    StateNetworkId = '0x500a',
    HistoryNetworkId = '0x500b',
    TxGossipNetworkId = '0x500c',
    HeaderGossipNetworkId = '0x500d',
    CanonIndicesNetworkId = '0x500e',
}

// State Network Custom Data type
export const StateNetworkCustomDataType = new ContainerType({
    fields: {
        dataRadius: new BigIntUintType({ byteLength: 32 })
    }
})
// Wire Protocol Message Codes
export enum MessageCodes {
    PING = 0x01,
    PONG = 0x02,
    FINDNODES = 0x03,
    NODES = 0x04,
    FINDCONTENT = 0x05,
    CONTENT = 0x06,
    OFFER = 0x07,
    ACCEPT = 0x08
}

// Type Aliases
export const ByteList = new ListType({ limit: 2048, elementType: byteType })
export const Bytes2 = new ByteVectorType({ length: 2 })
export const ENRs = new ListType({ elementType: ByteList, limit: 32 })
export type PingMessage = {
    enrSeq: bigint
    customPayload: ByteVector
}

export type PongMessage = {
    enrSeq: bigint
    customPayload: ByteVector
}

export const PingMessageType = new ContainerType({
    fields: {
        enrSeq: new BigIntUintType({ byteLength: 8 }),
        customPayload: ByteList
    }
})


export const PongMessageType = new ContainerType({
    fields: {
        enrSeq: new BigIntUintType({ byteLength: 8 }),
        customPayload: ByteList
    }
})

export type FindNodesMessage = {
    distances: Uint16Array
}

export const FindNodesMessageType = new ContainerType({
    fields: {
        distances:
            new ListType({ elementType: new NumberUintType({ byteLength: 2 }), limit: 256 })
    }
})

export type NodesMessage = {
    total: Number,
    enrs: Uint8Array[]
}

export const NodesMessageType = new ContainerType({
    fields: {
        total: byteType,
        enrs: ENRs
    }
})

export type FindContentMessage = {
    contentKey: Uint8Array
}

export const FindContentMessageType = new ContainerType({
    fields: {
        contentKey: ByteList
    }
})

export type ContentMessage = {
    content: Uint8Array | Uint8Array[]
}

export type connectionId = Uint8Array

export type content = Uint8Array

export type enrs = Uint8Array[]

export const ContentMessageType = new UnionType<Union<connectionId | content | enrs>>({
    types: [Bytes2, ByteList, ENRs]
})
export type OfferMessage = {
    contentKeys: Uint8Array[]
}

export const OfferMessageType = new ContainerType({
    fields: {
        contentKeys: new ListType({ elementType: ByteList, limit: 64 })
    }
})

export type AcceptMessage = {
    connectionId: Uint8Array,
    contentKeys: Boolean[]
}

export const AcceptMessageType = new ContainerType({
    fields: {
        connectionId: Bytes2,
        contentKeys: new BitListType({ limit: 64 })
    }
})

export const PortalWireMessageType = new UnionType<Union<NoneType | PingMessage | PongMessage | FindNodesMessage | NodesMessage | FindContentMessage | ContentMessage | OfferMessage | AcceptMessage>>({ types: [new NoneType(), PingMessageType, PongMessageType, FindNodesMessageType, NodesMessageType, FindContentMessageType, ContentMessageType, OfferMessageType, AcceptMessageType] })