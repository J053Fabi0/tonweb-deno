import Cell from "../boc/Cell.ts";
import Slice from "../boc/Slice.ts";
import { base64ToBytes } from "../utils/Utils.ts";
import HttpProviderUtils from "./HttpProviderUtils.ts";

const SHARD_ID_ALL = "-9223372036854775808"; // 0x8000000000000000

interface Request {
  id: number;
  jsonrpc: string;
  method: string;
  params: unknown;
}

export default class HttpProvider {
  host: string;
  options: { apiKey?: string };
  static SHARD_ID_ALL: string;

  constructor(host: string, options: { apiKey?: string }) {
    this.host = host || "https://toncenter.com/api/v2/jsonRPC";
    this.options = options || {};
  }

  /**
   * @private
   */
  sendImpl(apiUrl: string, request: Request): unknown {
    const headers: { "Content-Type": string; "X-API-Key"?: string } = { "Content-Type": "application/json" };
    if (this.options.apiKey) headers["X-API-Key"] = this.options.apiKey;

    return fetch(apiUrl, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(request),
    })
      .then((response) => response.json())
      .then(({ result, error }) => result || Promise.reject(error));
  }

  send(method: string, params: unknown): unknown {
    return this.sendImpl(this.host, { id: 1, jsonrpc: "2.0", method: method, params: params });
  }

  /**
   * Use this method to get information about address: balance, code, data, last_transaction_id.
   */
  getAddressInfo(address: string) {
    return this.send("getAddressInformation", { address: address });
  }

  /**
   * Similar to previous one but tries to parse additional information for known contract types. This method is based on generic.getAccountState thus number of recognizable contracts may grow. For wallets we recommend to use getWalletInformation.
   */
  getExtendedAddressInfo(address: string) {
    return this.send("getExtendedAddressInformation", { address: address });
  }

  /**
   * Use this method to retrieve wallet information, this method parse contract state and currently supports more wallet types than getExtendedAddressInformation: simple wallet, stadart wallet and v3 wallet.
   */
  getWalletInfo(address: string) {
    return this.send("getWalletInformation", { address: address });
  }

  /**
   * Use this method to get transaction history of a given address.
   * @return array of transaction object
   */
  getTransactions(
    address: string,
    limit: number | string = 20,
    lt = undefined,
    hash?: string,
    to_lt?: number | string,
    archival?: boolean
  ) {
    return this.send("getTransactions", { address, limit, lt, hash, to_lt, archival });
  }

  /**
   * Use this method to get balance (in nanograms) of a given address.
   */
  getBalance(address: string) {
    return this.send("getAddressBalance", { address: address });
  }

  /**
   * Use this method to send serialized boc file: fully packed and serialized external message.
   * @param base64 base64 of boc bytes Cell.toBoc
   */
  sendBoc(base64: string) {
    return this.send("sendBoc", { boc: base64 });
  }

  /**
   * @deprecated
   * Send external message
   * @param query object as described https://toncenter.com/api/test/v2/#sendQuerySimple
   */
  sendQuery(query: unknown) {
    return this.send("sendQuerySimple", query);
  }

  /**
   * @param query object as described https://toncenter.com/api/test/v2/#estimateFee
   * @return fees object
   */
  getEstimateFee(query: unknown) {
    return this.send("estimateFee", query);
  }

  /**
   * Invoke get-method of smart contract
   * todo: think about throw error if result.exit_code !== 0 (the change breaks backward compatibility)
   * @param address contract address
   * @param method method name or method id
   * @param params Array of stack elements
   */
  call(
    address: string,
    method: string | number,
    params: (["num", number] | ["cell", Cell] | ["slice", Slice])[] = []
  ) {
    return this.send("runGetMethod", { address: address, method: method, stack: params });
  }

  /**
   * Invoke get-method of smart contract
   * @param address contract address
   * @param method method name or method id
   * @param params Array of stack elements
   */
  async call2(
    address: string,
    method: string | number,
    params: (["num", number] | ["cell", Cell] | ["slice", Slice])[] = []
  ) {
    const result = await this.send("runGetMethod", {
      address: address,
      method: method,
      stack: params,
    });
    return HttpProviderUtils.parseResponse(result);
  }

  /**
   * Returns network config param
   */
  async getConfigParam(configParamId: number): Promise<Cell> {
    const rawResult = await this.send("getConfigParam", {
      config_id: configParamId,
    });
    if (typeof rawResult !== "object" || rawResult === null) throw new Error("getConfigParam expected object");

    if ("@type" in rawResult && rawResult["@type"] !== "configInfo")
      throw new Error("getConfigParam expected type configInfo");

    if (
      !("config" in rawResult) ||
      !rawResult.config ||
      typeof rawResult.config !== "object" ||
      rawResult.config === null ||
      !("@type" in rawResult.config) ||
      !("bytes" in rawResult.config)
    )
      throw new Error("getConfigParam expected config");

    if (rawResult.config["@type"] !== "tvm.cell") throw new Error("getConfigParam expected type tvm.cell");
    if (typeof rawResult.config.bytes !== "string" || !rawResult.config.bytes)
      throw new Error("getConfigParam expected bytes");

    return Cell.oneFromBoc(base64ToBytes(rawResult.config.bytes));
  }

  /**
   * Returns ID's of last and init block of masterchain
   */
  getMasterchainInfo() {
    return this.send("getMasterchainInfo", {});
  }

  /**
   * Returns ID's of shardchain blocks included in this masterchain block
   */
  getBlockShards(masterchainBlockNumber: number) {
    return this.send("shards", { seqno: masterchainBlockNumber });
  }

  /**
   * Returns transactions hashes included in this block
   * @param afterLt pivot transaction LT to start with
   * @param addressHash take the account address where the pivot transaction took place, convert it to raw format and take the part of the address without the workchain (address hash)
   */
  getBlockTransactions(
    workchain: number,
    shardId: string,
    shardBlockNumber: number,
    limit?: number,
    afterLt?: number | string,
    addressHash?: string
  ) {
    return this.send("getBlockTransactions", {
      count: limit,
      shard: shardId,
      after_lt: afterLt,
      workchain: workchain,
      seqno: shardBlockNumber,
      after_hash: addressHash,
    });
  }

  /**
   * Returns transactions hashes included in this masterhcain block
   * @param afterLt pivot transaction LT to start with
   * @param addressHash take the account address where the pivot transaction took place, convert it to raw format and take the part of the address without the workchain (address hash)
   */
  getMasterchainBlockTransactions(
    masterchainBlockNumber: number,
    limit: number,
    afterLt: number | string,
    addressHash: string
  ) {
    return this.getBlockTransactions(-1, SHARD_ID_ALL, masterchainBlockNumber, limit, afterLt, addressHash);
  }

  /**
   * Returns block header and his previous blocks ID's
   */
  getBlockHeader(workchain: number, shardId: string, shardBlockNumber: number) {
    return this.send("getBlockHeader", {
      workchain: workchain,
      shard: shardId,
      seqno: shardBlockNumber,
    });
  }

  /**
   * Returns masterchain block header and his previous block ID
   */
  getMasterchainBlockHeader(masterchainBlockNumber: number) {
    return this.getBlockHeader(-1, SHARD_ID_ALL, masterchainBlockNumber);
  }
}

HttpProvider.SHARD_ID_ALL = SHARD_ID_ALL;
