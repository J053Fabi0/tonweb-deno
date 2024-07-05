import { BN } from "bn";
import Cell from "../boc/Cell.ts";
import { base64ToBytes } from "../utils/Utils.ts";

interface ErrorWithResult extends Error {
  result: any;
}

export default class HttpProviderUtils {
  static parseObject(x: any): BN | Cell {
    const typeName = x["@type"];
    switch (typeName) {
      case "tvm.list":
      case "tvm.tuple":
        return x.elements.map(HttpProviderUtils.parseObject);
      case "tvm.cell":
        return Cell.oneFromBoc(base64ToBytes(x.bytes));
      case "tvm.stackEntryCell":
        return HttpProviderUtils.parseObject(x.cell);
      case "tvm.stackEntryTuple":
        return HttpProviderUtils.parseObject(x.tuple);
      case "tvm.stackEntryNumber":
        return HttpProviderUtils.parseObject(x.number);
      case "tvm.numberDecimal":
        return new BN(x.number, 10);
      default:
        throw new Error("unknown type " + typeName);
    }
  }

  /**
   * @return {any}
   */
  static parseResponseStack(pair: [string, string | { bytes: string }]): BN | Cell {
    const typeName = pair[0];
    const value = pair[1];

    switch (typeName) {
      case "num":
        if (typeof value === "object") throw new Error("num value is object");
        return new BN(value.replace(/0x/, ""), 16);
      case "list":
      case "tuple":
        return HttpProviderUtils.parseObject(value);
      case "cell":
        if (typeof value === "string") throw new Error("cell value is string");
        return Cell.oneFromBoc(base64ToBytes(value.bytes));
      default:
        throw new Error("unknown type " + typeName);
    }
  }

  static parseResponse(result: any) {
    if (result.exit_code !== 0) {
      const err = new Error("http provider parse response error") as ErrorWithResult;
      err.result = result;
      throw err;
    }

    const arr = result.stack.map(HttpProviderUtils.parseResponseStack);
    return arr.length === 1 ? arr[0] : arr;
  }

  static makeArg(arg: BN | number): ["num", BN | number] {
    if (arg instanceof BN || typeof arg === "number") {
      return ["num", arg];
    } else {
      throw new Error("unknown arg type " + arg);
    }
  }

  static makeArgs(args: (BN | number)[]) {
    return args.map(this.makeArg);
  }
}
