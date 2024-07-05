import {
  crc32c,
  sha256,
  hexToBytes,
  concatBytes,
  compareBytes,
  uint8ArrayToText,
  readNBytesUIntFromArray,
} from "../utils/Utils.ts";
import Slice from "./Slice.ts";
import BitString from "./BitString.ts";

const reachBocMagicPrefix = hexToBytes("B5EE9C72");
const leanBocMagicPrefix = hexToBytes("68ff65f3");
const leanBocMagicPrefixCRC = hexToBytes("acc3a728");

export default class Cell {
  bits: BitString;
  refs: (Cell | number)[];
  isExotic: boolean;

  constructor() {
    this.bits = new BitString(1023);
    this.refs = [];
    this.isExotic = false;
  }

  /**
   * @param serializedBoc hex or bytearray
   * @return root cells
   */
  static fromBoc(serializedBoc: string | Uint8Array): Cell[] {
    return deserializeBoc(serializedBoc);
  }

  /**
   * @param serializedBoc hex or bytearray
   * @return root cell
   */
  static oneFromBoc(serializedBoc: string | Uint8Array): Cell {
    const cells = deserializeBoc(serializedBoc);
    if (cells.length !== 1) throw new Error("expected 1 root cell but have " + cells.length);
    return cells[0];
  }

  /**
   * Write another cell to this cell
   */
  writeCell(anotherCell: Cell) {
    // XXX we do not check that there are anough place in cell
    this.bits.writeBitString(anotherCell.bits);
    this.refs = this.refs.concat(anotherCell.refs);
  }

  getMaxLevel(): number {
    //TODO level calculation differ for exotic cells
    let maxLevel = 0;
    for (const cell of this.refs)
      if (typeof cell !== "number" && cell.getMaxLevel() > maxLevel) maxLevel = cell.getMaxLevel();

    return maxLevel;
  }

  isExplicitlyStoredHashes(): number {
    return 0;
  }

  getMaxDepth(): number {
    let maxDepth = 0;
    if (this.refs.length > 0) {
      for (let k = 0; k < this.refs.length; k++) {
        const child = this.refs[k];
        if (typeof child === "number") continue;
        const childMaxDepth = child.getMaxDepth();
        if (childMaxDepth > maxDepth) maxDepth = childMaxDepth;
      }
      maxDepth = maxDepth + 1;
    }
    return maxDepth;
  }

  /**
   * @private
   */
  getMaxDepthAsArray(): Uint8Array {
    const maxDepth = this.getMaxDepth();
    const d = Uint8Array.from({ length: 2 }, () => 0);
    d[1] = maxDepth % 256;
    d[0] = Math.floor(maxDepth / 256);
    return d;
  }

  getRefsDescriptor(): Uint8Array {
    const d1 = Uint8Array.from({ length: 1 }, () => 0);
    d1[0] = this.refs.length + +this.isExotic * 8 + this.getMaxLevel() * 32;
    return d1;
  }

  getBitsDescriptor(): Uint8Array {
    const d2 = Uint8Array.from({ length: 1 }, () => 0);
    d2[0] = Math.ceil(this.bits.cursor / 8) + Math.floor(this.bits.cursor / 8);
    return d2;
  }

  getDataWithDescriptors(): Uint8Array {
    const d1 = this.getRefsDescriptor();
    const d2 = this.getBitsDescriptor();
    const tuBits = this.bits.getTopUppedArray();
    return concatBytes(concatBytes(d1, d2), tuBits);
  }

  async getRepr(): Promise<Uint8Array> {
    const reprArray: Uint8Array[] = [];

    reprArray.push(this.getDataWithDescriptors());
    for (const cell of this.refs) if (typeof cell !== "number") reprArray.push(cell.getMaxDepthAsArray());

    for (const cell of this.refs) if (typeof cell !== "number") reprArray.push(await cell.hash());

    let x = new Uint8Array();
    for (const cell of reprArray) x = concatBytes(x, cell);

    return x;
  }

  async hash(): Promise<Uint8Array> {
    return new Uint8Array(await sha256(await this.getRepr()));
  }

  beginParse(): Slice {
    const refs = this.refs
      .map((ref) => (typeof ref !== "number" ? ref.beginParse() : undefined))
      .filter((x) => x !== undefined) as Slice[];
    return new Slice(this.bits.array.slice(), this.bits.length, refs);
  }

  /**
   * Recursively prints cell's content like Fift
   */
  print(indent: string = ""): string {
    let s = indent + "x{" + this.bits.toHex() + "}\n";
    for (const cell of this.refs) if (typeof cell !== "number") s += cell.print(indent + " ");

    return s;
  }

  //serialized_boc#b5ee9c72 has_idx:(## 1) has_crc32c:(## 1)
  //  has_cache_bits:(## 1) flags:(## 2) { flags = 0 }
  //  size:(## 3) { size <= 4 }
  //  off_bytes:(## 8) { off_bytes <= 8 }
  //  cells:(##(size * 8))
  //  roots:(##(size * 8)) { roots >= 1 }
  //  absent:(##(size * 8)) { roots + absent <= cells }
  //  tot_cells_size:(##(off_bytes * 8))
  //  root_list:(roots * ##(size * 8))
  //  index:has_idx?(cells * ##(off_bytes * 8))
  //  cell_data:(tot_cells_size * [ uint8 ])
  //  crc32c:has_crc32c?uint32
  // = BagOfCells;
  /**
   * create boc bytearray
   */
  async toBoc(has_idx = true, hash_crc32 = true, has_cache_bits = false, flags = 0): Promise<Uint8Array> {
    const allcells = await this.treeWalk();
    const topologicalOrder = allcells[0];
    const cellsIndex = allcells[1];

    const cells_num = topologicalOrder.length;
    const s = cells_num.toString(2).length; // Minimal number of bits to represent reference (unused?)
    const s_bytes = Math.min(Math.ceil(s / 8), 1);
    let full_size = 0;
    const sizeIndex: number[] = [];
    for (const cell_info of topologicalOrder) {
      //TODO it should be async map or async for
      sizeIndex.push(full_size);
      full_size = full_size + (await cell_info[1].bocSerializationSize(cellsIndex));
    }
    const offset_bits = full_size.toString(2).length; // Minimal number of bits to offset/len (unused?)
    const offset_bytes = Math.max(Math.ceil(offset_bits / 8), 1);

    const serialization = new BitString((1023 + 32 * 4 + 32 * 3) * topologicalOrder.length);
    serialization.writeBytes(reachBocMagicPrefix);
    serialization.writeBitArray([has_idx, hash_crc32, has_cache_bits]);
    serialization.writeUint(flags, 2);
    serialization.writeUint(s_bytes, 3);
    serialization.writeUint8(offset_bytes);
    serialization.writeUint(cells_num, s_bytes * 8);
    serialization.writeUint(1, s_bytes * 8); // One root for now
    serialization.writeUint(0, s_bytes * 8); // Complete BOCs only
    serialization.writeUint(full_size, offset_bytes * 8);
    serialization.writeUint(0, s_bytes * 8); // Root shoulh have index 0
    if (has_idx) {
      topologicalOrder.forEach((_, index) => serialization.writeUint(sizeIndex[index], offset_bytes * 8));
    }
    for (const cell_info of topologicalOrder) {
      //TODO it should be async map or async for
      const refcell_ser = await cell_info[1].serializeForBoc(cellsIndex);
      serialization.writeBytes(refcell_ser);
    }
    let ser_arr = serialization.getTopUppedArray();
    if (hash_crc32) {
      ser_arr = concatBytes(ser_arr, crc32c(ser_arr));
    }

    return ser_arr;
  }

  /**
   * @private
   */
  async serializeForBoc(cellsIndex: IndexHashmap): Promise<Uint8Array> {
    const reprArray = [];

    reprArray.push(this.getDataWithDescriptors());
    if (this.isExplicitlyStoredHashes()) {
      throw new Error("Cell hashes explicit storing is not implemented");
    }
    for (const cell of this.refs) {
      if (typeof cell === "number") continue;
      const refHash = uint8ArrayToText(await cell.hash());
      const refIndexInt = cellsIndex[refHash];
      let refIndexHex = refIndexInt.toString(16);
      if (refIndexHex.length % 2) refIndexHex = "0" + refIndexHex;

      const reference = hexToBytes(refIndexHex);
      reprArray.push(reference);
    }
    let x = new Uint8Array();
    for (const i of reprArray) x = concatBytes(x, i);

    return x;
  }

  /**
   * @private
   */
  async bocSerializationSize(cellsIndex: IndexHashmap): Promise<number> {
    return (await this.serializeForBoc(cellsIndex)).length;
  }

  /**
   * @private
   */
  treeWalk(): Promise<[TopologicalOrderArray, IndexHashmap]> {
    return treeWalk(this, [], {});
  }
}

type IndexHashmap = Record<string, number>;
type TopologicalOrderArray = [Uint8Array, Cell][];

async function moveToTheEnd(
  indexHashmap: IndexHashmap,
  topologicalOrderArray: TopologicalOrderArray,
  target: Uint8Array
) {
  const targetString = uint8ArrayToText(target);
  const targetIndex = indexHashmap[targetString];
  for (const h of Object.keys(indexHashmap))
    if (indexHashmap[h] > targetIndex) indexHashmap[h] = indexHashmap[h] - 1;

  indexHashmap[targetString] = topologicalOrderArray.length - 1;
  const data = topologicalOrderArray.splice(targetIndex, 1)[0];
  topologicalOrderArray.push(data);
  for (const subCell of data[1].refs)
    if (typeof subCell !== "number") await moveToTheEnd(indexHashmap, topologicalOrderArray, await subCell.hash());
}

/**
 * @param topologicalOrderArray array of pairs: cellHash: Uint8Array, cell: Cell, ...
 * @param indexHashmap cellHash: Uint8Array -> cellIndex: number
 * @return topologicalOrderArray and indexHashmap
 */
async function treeWalk(
  cell: Cell,
  topologicalOrderArray: TopologicalOrderArray,
  indexHashmap: IndexHashmap,
  parentHash: null | Uint8Array = null
): Promise<[TopologicalOrderArray, IndexHashmap]> {
  const cellHash = await cell.hash();
  const cellHashString = uint8ArrayToText(cellHash);
  if (cellHashString in indexHashmap) {
    // Duplication cell
    //it is possible that already seen cell is a children of more deep cell
    if (parentHash) {
      const parentHashString = uint8ArrayToText(parentHash);
      if (indexHashmap[parentHashString] > indexHashmap[cellHashString])
        await moveToTheEnd(indexHashmap, topologicalOrderArray, cellHash);
    }
    return [topologicalOrderArray, indexHashmap];
  }
  indexHashmap[cellHashString] = topologicalOrderArray.length;
  topologicalOrderArray.push([cellHash, cell]);
  for (const subCell of cell.refs) {
    if (typeof subCell === "number") continue;
    const res = await treeWalk(subCell, topologicalOrderArray, indexHashmap, cellHash);
    topologicalOrderArray = res[0];
    indexHashmap = res[1];
  }

  return [topologicalOrderArray, indexHashmap];
}

function parseBocHeader(serializedBoc: Uint8Array) {
  // snake_case is used to match TON docs
  if (serializedBoc.length < 4 + 1) throw "Not enough bytes for magic prefix";
  const inputData = serializedBoc; // Save copy for crc32
  const prefix = serializedBoc.slice(0, 4);
  serializedBoc = serializedBoc.slice(4);
  let has_idx: number | undefined,
    hash_crc32: number | undefined,
    has_cache_bits: number | undefined,
    flags: number | undefined,
    size_bytes: number | undefined;
  if (compareBytes(prefix, reachBocMagicPrefix)) {
    const flags_byte = serializedBoc[0];
    has_idx = flags_byte & 128;
    hash_crc32 = flags_byte & 64;
    has_cache_bits = flags_byte & 32;
    flags = (flags_byte & 16) * 2 + (flags_byte & 8);
    size_bytes = flags_byte % 8;
  } else if (compareBytes(prefix, leanBocMagicPrefix)) {
    has_idx = 1;
    hash_crc32 = 0;
    has_cache_bits = 0;
    flags = 0;
    size_bytes = serializedBoc[0];
  } else if (compareBytes(prefix, leanBocMagicPrefixCRC)) {
    has_idx = 1;
    hash_crc32 = 1;
    has_cache_bits = 0;
    flags = 0;
    size_bytes = serializedBoc[0];
  } else throw new Error("Unknown BoC magic prefix");

  serializedBoc = serializedBoc.slice(1);
  if (serializedBoc.length < 1 + 5 * size_bytes) throw new Error("Not enough bytes for encoding cells counters");
  const offset_bytes = serializedBoc[0];
  serializedBoc = serializedBoc.slice(1);
  const cells_num = readNBytesUIntFromArray(size_bytes, serializedBoc);
  serializedBoc = serializedBoc.slice(size_bytes);
  const roots_num = readNBytesUIntFromArray(size_bytes, serializedBoc);
  serializedBoc = serializedBoc.slice(size_bytes);
  const absent_num = readNBytesUIntFromArray(size_bytes, serializedBoc);
  serializedBoc = serializedBoc.slice(size_bytes);
  const tot_cells_size = readNBytesUIntFromArray(offset_bytes, serializedBoc);
  serializedBoc = serializedBoc.slice(offset_bytes);
  if (serializedBoc.length < roots_num * size_bytes)
    throw new Error("Not enough bytes for encoding root cells hashes");
  const root_list: number[] = [];
  for (let c = 0; c < roots_num; c++) {
    root_list.push(readNBytesUIntFromArray(size_bytes, serializedBoc));
    serializedBoc = serializedBoc.slice(size_bytes);
  }
  let index: false | number[] = false;
  if (has_idx) {
    index = [];
    if (serializedBoc.length < offset_bytes * cells_num) throw new Error("Not enough bytes for index encoding");
    for (let c = 0; c < cells_num; c++) {
      index.push(readNBytesUIntFromArray(offset_bytes, serializedBoc));
      serializedBoc = serializedBoc.slice(offset_bytes);
    }
  }

  if (serializedBoc.length < tot_cells_size) throw new Error("Not enough bytes for cells data");
  const cells_data = serializedBoc.slice(0, tot_cells_size);
  serializedBoc = serializedBoc.slice(tot_cells_size);
  if (hash_crc32) {
    if (serializedBoc.length < 4) throw new Error("Not enough bytes for crc32c hashsum");
    const length = inputData.length;
    if (!compareBytes(crc32c(inputData.slice(0, length - 4)), serializedBoc.slice(0, 4)))
      throw new Error("Crc32c hashsum mismatch");
    serializedBoc = serializedBoc.slice(4);
  }
  if (serializedBoc.length) throw new Error("Too much bytes in BoC serialization");

  return {
    index,
    cells_num,
    roots_num,
    root_list,
    size_bytes,
    absent_num,
    cells_data,
    tot_cells_size,
    flags: flags ?? null,
    off_bytes: offset_bytes,
    has_idx: has_idx ?? null,
    hash_crc32: hash_crc32 ?? null,
    has_cache_bits: has_cache_bits ?? null,
  };
}

function deserializeCellData(cellData: Uint8Array, referenceIndexSize: number) {
  if (cellData.length < 2) throw new Error("Not enough bytes to encode cell descriptors");
  const d1 = cellData[0],
    d2 = cellData[1];
  cellData = cellData.slice(2);
  const refNum = d1 % 8;
  const dataBytesize = Math.ceil(d2 / 2);
  const fullfilledBytes = !(d2 % 2);
  const cell = new Cell();
  cell.isExotic = Boolean(d1 & 8);
  if (cellData.length < dataBytesize + referenceIndexSize * refNum)
    throw new Error("Not enough bytes to encode cell data");
  cell.bits.setTopUppedArray(cellData.slice(0, dataBytesize), fullfilledBytes);
  cellData = cellData.slice(dataBytesize);
  for (let r = 0; r < refNum; r++) {
    cell.refs.push(readNBytesUIntFromArray(referenceIndexSize, cellData));
    cellData = cellData.slice(referenceIndexSize);
  }
  return { cell: cell, residue: cellData };
}

/**
 * @param serializedBoc hex or bytearray
 * @return root cells
 */
function deserializeBoc(serializedBoc: string | Uint8Array): Cell[] {
  if (typeof serializedBoc == "string") {
    serializedBoc = hexToBytes(serializedBoc);
  }
  const header = parseBocHeader(serializedBoc);
  let cells_data = header.cells_data;
  const cells_array: Cell[] = [];
  for (let ci = 0; ci < header.cells_num; ci++) {
    const dd = deserializeCellData(cells_data, header.size_bytes);
    cells_data = dd.residue;
    cells_array.push(dd.cell);
  }
  for (let ci = header.cells_num - 1; ci >= 0; ci--) {
    const cell = cells_array[ci];
    for (let ri = 0; ri < cell.refs.length; ri++) {
      const r = cell.refs[ri];
      if (typeof r !== "number") continue;
      if (r < ci) throw new Error("Topological order is broken");
      cell.refs[ri] = cells_array[r];
    }
  }
  const root_cells: Cell[] = [];
  for (const rootCell of header.root_list) root_cells.push(cells_array[rootCell]);

  return root_cells;
}
