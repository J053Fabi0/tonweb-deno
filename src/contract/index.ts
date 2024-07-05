import { BN } from "bn";
import Cell from "../boc/Cell.ts";
import Address from "../utils/Address.ts";
import HttpProvider from "../providers/index.ts";
import { bytesToBase64, bytesToHex } from "../utils/Utils.ts";
import HttpProviderUtils from "../providers/HttpProviderUtils.ts";

interface ContractOptions {
  code?: Cell;
  wc?: number;
  address?: Address | string;
}

export default class Contract {
  provider: HttpProviderUtils;
  options: ContractOptions;
  address: Address | null;
  methods: Record<string, string>;

  constructor(provider: HttpProviderUtils, options: ContractOptions) {
    this.provider = provider;
    this.options = options;
    this.address = options.address ? new Address(options.address) : null;
    if (!options.wc) options.wc = this.address ? this.address.wc : 0;
    this.methods = {};
  }

  async getAddress(): Promise<Address> {
    if (!this.address) this.address = (await this.createStateInit()).address;
    return this.address;
  }

  /**
   * @private
   * @return cell contains contact code
   */
  createCodeCell(): Cell {
    if (!this.options.code) throw new Error("Contract: options.code is not defined");
    return this.options.code;
  }

  /**
   * Method to override
   * @protected
   * @return cell contains contract data
   */
  createDataCell() {
    return new Cell();
  }

  /**
   * @protected
   */
  async createStateInit(): Promise<{ stateInit: Cell; address: Address; code: Cell; data: Cell }> {
    const codeCell = this.createCodeCell();
    const dataCell = this.createDataCell();
    const stateInit = Contract.createStateInit(codeCell, dataCell);
    const stateInitHash = await stateInit.hash();
    const address = new Address(this.options.wc + ":" + bytesToHex(stateInitHash));
    return {
      stateInit: stateInit,
      address: address,
      code: codeCell,
      data: dataCell,
    };
  }

  // _ split_depth:(Maybe (## 5)) special:(Maybe TickTock)
  // code:(Maybe ^Cell) data:(Maybe ^Cell)
  // library:(Maybe ^Cell) = StateInit;
  /**
   * @param library Not implemented
   * @param splitDepth Not implemented
   * @param ticktock Not implemented
   */
  static createStateInit(code: Cell, data: Cell, library = null, splitDepth = null, ticktock = null): Cell {
    if (library) throw new Error("Library in state init is not implemented");
    if (splitDepth) throw new Error("Split depth in state init is not implemented");
    if (ticktock) throw new Error("Ticktock in state init is not implemented");

    const stateInit = new Cell();

    stateInit.bits.writeBitArray([
      Boolean(splitDepth),
      Boolean(ticktock),
      Boolean(code),
      Boolean(data),
      Boolean(library),
    ]);
    if (code) stateInit.refs.push(code);
    if (data) stateInit.refs.push(data);
    if (library) stateInit.refs.push(library);
    return stateInit;
  }

  // extra_currencies$_ dict:(HashmapE 32 (VarUInteger 32))
  // = ExtraCurrencyCollection;
  // currencies$_ grams:Grams other:ExtraCurrencyCollection
  // = CurrencyCollection;

  //int_msg_info$0 ihr_disabled:Bool bounce:Bool
  //src:MsgAddressInt dest:MsgAddressInt
  //value:CurrencyCollection ihr_fee:Grams fwd_fee:Grams
  //created_lt:uint64 created_at:uint32 = CommonMsgInfo;
  /**
   * @param currencyCollection Not implemented
   */
  static createInternalMessageHeader(
    dest: Address | string,
    gramValue: BN | number = 0,
    ihrDisabled = true,
    bounce: null | boolean = null,
    bounced = false,
    src: Address | string | null = null,
    currencyCollection = null,
    ihrFees: BN | number = 0,
    fwdFees: BN | number = 0,
    createdLt: BN | number = 0,
    createdAt: BN | number = 0
  ): Cell {
    const message = new Cell();
    message.bits.writeBit(false);
    message.bits.writeBit(ihrDisabled);
    if (!(bounce === null)) message.bits.writeBit(bounce);
    else message.bits.writeBit(new Address(dest).isBounceable);

    message.bits.writeBit(bounced);
    message.bits.writeAddress(src ? new Address(src) : null);
    message.bits.writeAddress(new Address(dest));
    message.bits.writeGrams(gramValue);
    if (currencyCollection) throw new Error("Currency collections are not implemented yet");

    message.bits.writeBit(Boolean(currencyCollection));
    message.bits.writeGrams(ihrFees);
    message.bits.writeGrams(fwdFees);
    message.bits.writeUint(createdLt, 64);
    message.bits.writeUint(createdAt, 32);
    return message;
  }

  //ext_in_msg_info$10 src:MsgAddressExt dest:MsgAddressInt
  //import_fee:Grams = CommonMsgInfo;
  static createExternalMessageHeader(
    dest: Address | string,
    src: Address | string | null = null,
    importFee: BN | number = 0
  ): Cell {
    const message = new Cell();
    message.bits.writeUint(2, 2);
    message.bits.writeAddress(src ? new Address(src) : null);
    message.bits.writeAddress(new Address(dest));
    message.bits.writeGrams(importFee);
    return message;
  }

  static createOutMsg(
    address: Address | string,
    amount: BN,
    payload: string | Uint8Array | Cell,
    stateInit: Cell | null = null
  ): Cell {
    let payloadCell = new Cell();
    if (payload) {
      if (typeof payload === "string") {
        if (payload.length > 0) {
          payloadCell.bits.writeUint(0, 32);
          payloadCell.bits.writeString(payload);
        }
      } else if ("refs" in payload && payload.refs) {
        payloadCell = payload;
      } else {
        payloadCell.bits.writeBytes(payload as Uint8Array);
      }
    }

    const orderHeader = Contract.createInternalMessageHeader(new Address(address), new BN(amount));
    const order = Contract.createCommonMsgInfo(orderHeader, stateInit, payloadCell);
    return order;
  }

  //tblkch.pdf, page 57
  /**
   * Create CommonMsgInfo contains header, stateInit, body
   */
  static createCommonMsgInfo(header: Cell, stateInit: Cell | null = null, body: Cell | null = null): Cell {
    const commonMsgInfo = new Cell();
    commonMsgInfo.writeCell(header);

    if (stateInit) {
      commonMsgInfo.bits.writeBit(true);
      //-1:  need at least one bit for body
      // TODO we also should check for free refs here
      // TODO: temporary always push in ref because WalletQueryParser can parse only ref
      // if (false && commonMsgInfo.bits.getFreeBits() - 1 >= stateInit.bits.getUsedBits()) {
      //   commonMsgInfo.bits.writeBit(false);
      //   commonMsgInfo.writeCell(stateInit);
      // } else {
      commonMsgInfo.bits.writeBit(true);
      commonMsgInfo.refs.push(stateInit);
      // }
    } else {
      commonMsgInfo.bits.writeBit(false);
    }
    // TODO we also should check for free refs here
    if (body) {
      if (
        commonMsgInfo.bits.getFreeBits() >= body.bits.getUsedBits() &&
        commonMsgInfo.refs.length + body.refs.length <= 4
      ) {
        commonMsgInfo.bits.writeBit(false);
        commonMsgInfo.writeCell(body);
      } else {
        commonMsgInfo.bits.writeBit(true);
        commonMsgInfo.refs.push(body);
      }
    } else {
      commonMsgInfo.bits.writeBit(false);
    }
    return commonMsgInfo;
  }

  static createMethod(
    provider: HttpProvider,
    queryPromise: Promise<{ body: Cell; message: Cell; code: Cell; data: Cell; address: Address }>
  ) {
    return {
      getBody: async (): Promise<Cell> => (await queryPromise).body,
      getQuery: async () => (await queryPromise).message,
      send: async () => {
        const query = await queryPromise;
        const boc = bytesToBase64(await query.message.toBoc(false));
        return provider.sendBoc(boc);
      },
      estimateFee: async () => {
        const query = await queryPromise;
        const serialized = query.code // deploy
          ? {
              address: query.address.toString(true, true, false),
              body: bytesToBase64(await query.body.toBoc(false)),
              init_code: bytesToBase64(await query.code.toBoc(false)),
              init_data: bytesToBase64(await query.data.toBoc(false)),
            }
          : {
              address: query.address.toString(true, true, true),
              body: bytesToBase64(await query.body.toBoc(false)),
            };

        return provider.getEstimateFee(serialized);
      },
    };
  }
}
