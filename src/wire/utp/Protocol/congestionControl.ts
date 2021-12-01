import { DELAY_TARGET } from "..";

export class CongestionControl {
    baseDelay: number
    ourDelay: number
    sendRate: number
    CCONTROL_TARGET: number
    offTarget: number
    maxWindow: number
    outstandingPacket: number
    MAX_CWND_INCREASE_PACKETS_PER_RTT: number
    constructor() {
        this.baseDelay=0;
        this.ourDelay=0;
        this.sendRate=0;
        this.CCONTROL_TARGET=DELAY_TARGET;
        this.offTarget=0;
        this.maxWindow=1280;
        this.outstandingPacket=0;
        this.MAX_CWND_INCREASE_PACKETS_PER_RTT= 3
    }

    delayFactor() {
        return this.offTarget / this.CCONTROL_TARGET
    }

    windowFactor() {
        return 
    }

}