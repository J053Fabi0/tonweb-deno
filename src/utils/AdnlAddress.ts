import { hexToBytes, bytesToHex } from "./Utils.ts";

export default class AdnlAddress {
  bytes: Uint8Array;

  static isValid(anyForm: string | Uint8Array | AdnlAddress) {
    try {
      new AdnlAddress(anyForm);
      return true;
    } catch {
      return false;
    }
  }

  constructor(anyForm: string | Uint8Array | AdnlAddress) {
    if (anyForm == null) {
      throw "Invalid address";
    }

    if (anyForm instanceof AdnlAddress) {
      this.bytes = anyForm.bytes;
    } else if (anyForm instanceof Uint8Array) {
      if (anyForm.length !== 32) {
        throw new Error("invalid adnl bytes length");
      }
      this.bytes = anyForm;
    } else if (typeof anyForm === "string") {
      if (anyForm.length !== 64) {
        throw new Error("invalid adnl hex length");
      }
      this.bytes = hexToBytes(anyForm);
    } else {
      throw new Error("unsupported type");
    }
  }

  toHex() {
    let hex = bytesToHex(this.bytes);
    while (hex.length < 64) {
      hex = "0" + hex;
    }
    return hex;
  }
}
