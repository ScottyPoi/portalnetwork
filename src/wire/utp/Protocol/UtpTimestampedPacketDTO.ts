import { Packet } from "..";

export class UtpTimestampedPacketDTO {
    packet: Packet
    timestamp: number
    utpTimestamp: number
    ackedAfterMeCounter: number
    isPacketAcked: boolean
    reduceWindow: boolean
    resendBecauseSkipped: boolean
    resendCounter: number
    constructor(packet: Packet, timestamp: number, utpStamp: number) {
        this.timestamp = timestamp;
        this.packet = packet;
        this.utpTimestamp = utpStamp
        this.ackedAfterMeCounter = 0
        this.isPacketAcked = false
        this.resendCounter = 0
        this.reduceWindow = false
        this.resendBecauseSkipped = false
    }


}