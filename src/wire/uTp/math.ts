import { Uint16, Uint32 } from "@chainsafe/lodestar-types";
import { hrtime } from "process";
import { Duration, Miliseconds } from "./utp_socket/utp_socket_typing";
export function getMonoTimeStamp(): Uint32 {
    let time = hrtime.bigint();
    return Number(time / BigInt(1000)) as Uint32;
  }
  
  export function randUint16(): Uint16 {
    return (Math.random() * 2 ** 16) as Uint16;
  }
  export function randUint32(): Uint16 {
    return (Math.random() * 2 ** 32) as Uint16;
  }

  export function bitLength(n: number): number {
    const bitstring = n.toString(2);
    if (bitstring === "0") {
      return 0;
    }
    return bitstring.length;
  }
  
  export function nextPowerOf2(n: number): number {
    return n <= 0 ? 1 : Math.pow(2, bitLength(n - 1));
  }

  export function sleep(ms: Miliseconds) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  export function max(a: number, b: Duration): Duration {
    return a > b ? a : b;
  }

  