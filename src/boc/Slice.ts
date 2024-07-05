import { BN } from "https://deno.land/x/bn_deno@1.0.0/lib/bn.js";
import BitString from "./BitString.ts";
import Address from "../utils/Address.ts";
import { bytesToHex } from "../utils/Utils.ts";

/**
 * A partial view of a TVM cell, used for parsing data from Cells.
 */
export default class Slice {
  array: Uint8Array;
  length: number;
  readCursor: number;
  refs: Slice[];
  refCursor: number;

  /**
   * @param length length in bits
   * @param refs child cells
   */
  constructor(array: Uint8Array, length: number, refs: Slice[]) {
    this.array = array;
    this.length = length;
    this.readCursor = 0;

    this.refs = refs;
    this.refCursor = 0;
  }

  getFreeBits(): number {
    return this.length - this.readCursor;
  }

  /**
   * @private
   */
  checkRange(n: number) {
    if (n > this.length) {
      throw Error("BitString overflow");
    }
  }

  /**
   * @private
   * @return bit value at position `n`
   */
  get(n: number): boolean {
    this.checkRange(n);
    return (this.array[(n / 8) | 0] & (1 << (7 - (n % 8)))) > 0;
  }

  /**
   * @return read bit
   */
  loadBit(): boolean {
    const result = this.get(this.readCursor);
    this.readCursor++;
    return result;
  }

  loadBits(bitLength: number): Uint8Array {
    const result = new BitString(bitLength);
    for (let i = 0; i < bitLength; i++) {
      result.writeBit(this.loadBit());
    }
    return result.array;
  }

  /**
   * Reads unsigned int
   *
   * @param bitLength Size of uint in bits
   * @returns number
   */
  loadUint(bitLength: number): BN {
    if (bitLength < 1) {
      throw "Incorrect bitLength";
    }
    let s = "";
    for (let i = 0; i < bitLength; i++) {
      s += this.loadBit() ? "1" : "0";
    }
    return new BN(s, 2);
  }

  /**
   * Reads signed int
   *
   * @param bitLength Size of uint in bits
   * @returns number
   */
  loadInt(bitLength: number): BN {
    if (bitLength < 1) {
      throw "Incorrect bitLength";
    }
    const sign = this.loadBit();
    if (bitLength === 1) {
      return sign ? new BN(-1) : new BN(0);
    }
    let number = this.loadUint(bitLength - 1);
    if (sign) {
      const b = new BN(2);
      const nb = b.pow(new BN(bitLength - 1));
      number = number.sub(nb);
    }
    return number;
  }

  loadVarUint(bitLength: number): BN {
    const len = this.loadUint(new BN(bitLength).toString(2)!.length - 1);
    if (len.toNumber() === 0) {
      return new BN(0);
    } else {
      return this.loadUint(len.toNumber() * 8);
    }
  }

  loadCoins(): BN {
    return this.loadVarUint(16);
  }

  loadAddress(): Address | null {
    const b: number = this.loadUint(2).toNumber();
    if (b === 0) return null; // null address
    if (b !== 2) throw new Error("unsupported address type " + b);
    if (this.loadBit()) throw new Error("unsupported address type " + b);
    const wc = this.loadInt(8).toNumber();
    const hashPart = this.loadBits(256);
    return new Address(wc + ":" + bytesToHex(hashPart));
  }

  loadRef(): Slice | undefined {
    if (this.refCursor >= 4) throw new Error("refs overflow");
    const result = this.refs.at(this.refCursor);
    this.refCursor++;
    return result;
  }
}
