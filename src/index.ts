const version = "0.0.66";

import Cell from "./boc/Cell.ts";
import Slice from "./boc/Slice.ts";
import Address from "./utils/Address.ts";
import * as utils from "./utils/index.ts";
import BitString from "./boc/BitString.ts";
import HttpProvider from "./providers/index.ts";

// const { Contract } = require("./contract");
// const NFT = require("./contract/token/nft").default;
// const Wallets = require("./contract/wallet").default;
// const JETTON = require("./contract/token/ft").default;
// const LockupWallets = require("./contract/lockup").default;
// const HighloadWallets = require("./contract/highloadWallet").default;
// const TransportWebUSB = require("@ledgerhq/hw-transport-webusb").default;
// const TransportWebHID = require("@ledgerhq/hw-transport-webhid").default;
// const { SubscriptionContract } = require("./contract/subscription/index");
// const { Payments, PaymentChannel } = require("./contract/payments/index");
// const { Dns, DnsCollection, DnsItem } = require("./contract/dns").default;
// const BluetoothTransport = require("@ledgerhq/hw-transport-web-ble").default;
// const { BlockSubscription, InMemoryBlockStorage } = require("./providers/blockSubscription");

export class TonWeb {
  version: string;
  utils: typeof utils;
  Address: typeof Address;
  boc: { Slice: typeof Slice; Cell: typeof Cell; BitString: typeof BitString };
  // Contract: typeof Contract;
  // BlockSubscription: typeof BlockSubscription;
  // InMemoryBlockStorage: typeof InMemoryBlockStorage;
  provider: HttpProvider;
  // dns: Dns;
  // wallet: Wallets;
  // payments: Payments;
  // lockupWallet: typeof LockupWallets;

  constructor(provider: HttpProvider) {
    this.version = version;
    this.utils = utils;
    this.Address = Address;
    this.boc = { Slice, Cell, BitString };
    // this.Contract = Contract;
    // this.BlockSubscription = BlockSubscription;
    // this.InMemoryBlockStorage = InMemoryBlockStorage;

    this.provider = provider ?? new HttpProvider();
    // this.dns = new Dns(this.provider);
    // this.wallet = new Wallets(this.provider);
    // this.payments = new Payments(this.provider);
    // this.lockupWallet = LockupWallets;
  }

  /**
   * Use this method to get transaction history of a given address.
   * @param txhash in HEX
   * @return array of transaction objects
   */
  getTransactions(address: Address | string, limit = 20, lt?: number, txhash?: string, to_lt?: number): unknown {
    return this.provider.getTransactions(address.toString(), limit, lt, txhash, to_lt);
  }

  /**
   * @return The current balance for the given address in nanograms.
   */
  getBalance(address: Address | string): Promise<string> {
    return this.provider.getBalance(address.toString());
  }

  /**
   * Use this method to send serialized boc file: fully packed and serialized external message.
   */
  sendBoc(bytes: Uint8Array): unknown {
    return this.provider.sendBoc(utils.bytesToBase64(bytes));
  }

  /**
   * Invoke get-method of smart contract
   * @param address contract address
   * @param method method name or method id
   * @param params Array of stack elements
   */
  call(
    address: Address | string,
    method: string | number,
    params: (["num", number] | ["cell", Cell] | ["slice", Slice])[] = []
  ): unknown {
    return this.provider.call(address.toString(), method, params);
  }

  static version: string;
  static utils: typeof utils;
  static Address: typeof Address;
  static boc: { Slice: typeof Slice; Cell: typeof Cell; BitString: typeof BitString };
  static HttpProvider: typeof HttpProvider;
  // static Contract: typeof Contract;
  // static Wallets: typeof Wallets;
  // static LockupWallets: typeof LockupWallets;
  // static SubscriptionContract: typeof SubscriptionContract;
  // static BlockSubscription: typeof BlockSubscription;
  // static InMemoryBlockStorage: typeof InMemoryBlockStorage;
  // static ledger: {
  //   TransportWebUSB: typeof TransportWebUSB;
  //   TransportWebHID: typeof TransportWebHID;
  //   BluetoothTransport: typeof BluetoothTransport;
  // };
  // static token: {
  //   nft: typeof NFT;
  //   ft: typeof JETTON;
  //   jetton: typeof JETTON;
  // };
  // static HighloadWallets: typeof HighloadWallets;
  // static dns: typeof Dns;
  // static payments: typeof Payments;
}

TonWeb.version = version;
TonWeb.utils = utils;
TonWeb.Address = Address;
TonWeb.boc = { Slice, Cell, BitString };
TonWeb.HttpProvider = HttpProvider;
// TonWeb.Contract = Contract;
// TonWeb.Wallets = Wallets;
// TonWeb.LockupWallets = LockupWallets;
// TonWeb.SubscriptionContract = SubscriptionContract;
// TonWeb.BlockSubscription = BlockSubscription;
// TonWeb.InMemoryBlockStorage = InMemoryBlockStorage;
// TonWeb.ledger = {
//   TransportWebUSB,
//   TransportWebHID,
//   BluetoothTransport,
// };
// TonWeb.token = {
//   nft: NFT,
//   ft: JETTON,
//   jetton: JETTON,
// };
// TonWeb.HighloadWallets = HighloadWallets;
// TonWeb.dns = Dns;
// TonWeb.dns.DnsCollection = DnsCollection;
// TonWeb.dns.DnsItem = DnsItem;
// TonWeb.payments = Payments;
// TonWeb.payments.PaymentChannel = PaymentChannel;
