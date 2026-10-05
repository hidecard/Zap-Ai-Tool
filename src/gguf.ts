import { open } from 'node:fs/promises';

export interface GgufMetadata {
  version: number;
  tensorCount: number;
  architecture: string;
  name?: string;
  quantization?: string;
  contextLength?: number;
  embeddingLength?: number;
  blockCount?: number;
  expertCount?: number;
  parameterCount?: bigint;
  /** Metadata keys the reader did not interpret, for diagnostics. */
  keys: string[];
}

export interface GgufInspection {
  path: string;
  sizeBytes: number;
  valid: boolean;
  metadata?: GgufMetadata;
  message?: string;
}

/** llama.cpp architecture families that Zap is expected to handle. */
export const KNOWN_ARCHITECTURES = [
  'llama',
  'qwen2',
  'qwen3',
  'qwen2moe',
  'deepseek2',
  'gemma',
  'gemma2',
  'gemma3',
  'phi2',
  'phi3',
  'mistral',
  'mixtral',
  'falcon',
  'starcoder',
  'starcoder2',
  'gptneox',
  'mpt',
  'baichuan',
  'internlm2',
  'minicpm',
  'olmo',
  'command-r',
  'deci',
  'smollm3',
] as const;

/** Model families named in the compatibility matrix that map onto an architecture. */
export const COMPATIBILITY_FAMILIES = [
  {
    family: 'Llama',
    architectures: ['llama', 'gptneox', 'falcon', 'starcoder', 'starcoder2', 'baichuan', 'mpt'],
  },
  { family: 'DeepSeek', architectures: ['llama', 'deepseek2'] },
  { family: 'Qwen', architectures: ['llama', 'qwen2', 'qwen3', 'qwen2moe'] },
] as const;

export function familyForArchitecture(architecture: string): string | undefined {
  const normalized = architecture.toLowerCase();
  return COMPATIBILITY_FAMILIES.find((entry) =>
    (entry.architectures as readonly string[]).includes(normalized),
  )?.family;
}

const GGUF_MAGIC = 0x46554747; // "GGUF" little-endian

type Reader = {
  buffer: Buffer;
  offset: number;
  /** GGUF v1 stored counts and 64-bit values in 32 bits; v2+ uses 8 bytes. */
  sizeBytes: number;
};

function need(reader: Reader, bytes: number): void {
  if (reader.offset + bytes > reader.buffer.length)
    throw new Error('Unexpected end of GGUF metadata.');
}

/** Reads a length or uint64 value; `width` forces a fixed byte width. */
function readLength(reader: Reader, width?: number): bigint {
  const bytes = width ?? reader.sizeBytes;
  if (bytes === 8) {
    need(reader, 8);
    const value = reader.buffer.readBigUInt64LE(reader.offset);
    reader.offset += 8;
    return value;
  }
  need(reader, 4);
  const value = BigInt(reader.buffer.readUInt32LE(reader.offset));
  reader.offset += 4;
  return value;
}

function readString(reader: Reader): string {
  const length = Number(readLength(reader));
  need(reader, length);
  const value = reader.buffer.toString('utf8', reader.offset, reader.offset + length);
  reader.offset += length;
  return value;
}

/** GGUF metadata value types, from the llama.cpp gguf specification. */
const GGUF_TYPE = {
  uint8: 0,
  int8: 1,
  uint16: 2,
  int16: 3,
  uint32: 4,
  int32: 5,
  float32: 6,
  bool: 7,
  string: 8,
  array: 9,
  uint64: 10,
  int64: 11,
  float64: 12,
} as const;

const FIXED_SCALAR_BYTES: Record<number, number> = {
  [GGUF_TYPE.uint8]: 1,
  [GGUF_TYPE.int8]: 1,
  [GGUF_TYPE.uint16]: 2,
  [GGUF_TYPE.int16]: 2,
  [GGUF_TYPE.uint32]: 4,
  [GGUF_TYPE.int32]: 4,
  [GGUF_TYPE.float32]: 4,
};

type MetadataValue = number | bigint | string | boolean | undefined;

/** Reads one scalar value and returns it; arrays report only their length. */
function readScalar(reader: Reader, type: number): MetadataValue {
  const fixed = FIXED_SCALAR_BYTES[type];
  if (fixed !== undefined) {
    need(reader, fixed);
    const view = reader.buffer.subarray(reader.offset, reader.offset + fixed);
    reader.offset += fixed;
    switch (type) {
      case GGUF_TYPE.uint8:
        return view.readUInt8(0);
      case GGUF_TYPE.int8:
        return view.readInt8(0);
      case GGUF_TYPE.uint16:
        return view.readUInt16LE(0);
      case GGUF_TYPE.int16:
        return view.readInt16LE(0);
      case GGUF_TYPE.uint32:
        return view.readUInt32LE(0);
      case GGUF_TYPE.int32:
        return view.readInt32LE(0);
      default:
        return view.readFloatLE(0);
    }
  }
  if (type === GGUF_TYPE.bool) {
    need(reader, 1);
    return reader.buffer.readUInt8(reader.offset++) !== 0;
  }
  if (type === GGUF_TYPE.string) return readString(reader);
  if (type === GGUF_TYPE.uint64) return readLength(reader);
  if (type === GGUF_TYPE.int64) {
    if (reader.sizeBytes === 8) {
      need(reader, 8);
      const value = reader.buffer.readBigInt64LE(reader.offset);
      reader.offset += 8;
      return value;
    }
    need(reader, 4);
    const value = BigInt(reader.buffer.readInt32LE(reader.offset));
    reader.offset += 4;
    return value;
  }
  if (type === GGUF_TYPE.float64) {
    need(reader, 8);
    const value = reader.buffer.readDoubleLE(reader.offset);
    reader.offset += 8;
    return value;
  }
  throw new Error(`Unsupported GGUF value type: ${type}`);
}

const ARRAY_ELEMENT_BYTES: Record<number, number> = {
  ...FIXED_SCALAR_BYTES,
  [GGUF_TYPE.bool]: 1,
};

/** Skips an array value without buffering its contents. */
function skipArray(reader: Reader): number {
  need(reader, 8);
  const elementType = reader.buffer.readUInt32LE(reader.offset);
  reader.offset += 4;
  const count = Number(readLength(reader));
  if (elementType === GGUF_TYPE.string) {
    for (let index = 0; index < count; index += 1) readString(reader);
    return count;
  }
  const elementBytes =
    ARRAY_ELEMENT_BYTES[elementType] ??
    (elementType === GGUF_TYPE.uint64 ||
    elementType === GGUF_TYPE.int64 ||
    elementType === GGUF_TYPE.float64
      ? reader.sizeBytes === 8
        ? 8
        : 4
      : undefined);
  if (elementBytes === undefined) throw new Error(`Unsupported GGUF array type: ${elementType}`);
  need(reader, elementBytes * count);
  reader.offset += elementBytes * count;
  return count;
}

function readValue(reader: Reader, type: number): MetadataValue {
  return type === GGUF_TYPE.array ? skipArray(reader) : readScalar(reader, type);
}

function asNumber(value: MetadataValue): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
    return Number(value);
  return undefined;
}

const HEADER_BYTES = 8 * 1024 * 1024;

/**
 * Reads GGUF header metadata without loading the model, so a user can confirm
 * the architecture, quantization, and family of a downloaded file before
 * pointing Zap at it. Token arrays and tensors are skipped, never buffered.
 */
export async function inspectGguf(path: string): Promise<GgufInspection> {
  const handle = await open(path, 'r');
  let sizeBytes = 0;
  try {
    const stats = await handle.stat();
    sizeBytes = stats.size;
    const length = Math.min(HEADER_BYTES, stats.size);
    const buffer = Buffer.alloc(length);
    // A single read can return short, so fill the header window before parsing.
    let filled = 0;
    while (filled < length) {
      const { bytesRead } = await handle.read(buffer, filled, length - filled, filled);
      if (bytesRead <= 0) break;
      filled += bytesRead;
    }
    const reader: Reader = { buffer, offset: 0, sizeBytes: 8 };
    if (filled < 16 || reader.buffer.readUInt32LE(0) !== GGUF_MAGIC)
      return {
        path,
        sizeBytes: stats.size,
        valid: false,
        message: 'Not a GGUF file (missing GGUF magic).',
      };
    const version = reader.buffer.readUInt32LE(4);
    if (version < 1 || version > 3)
      return {
        path,
        sizeBytes: stats.size,
        valid: false,
        message: `Unsupported GGUF version ${version}; this build reads versions 1 to 3.`,
      };
    reader.sizeBytes = version >= 2 ? 8 : 4;
    const countsWidth = version >= 2 ? 8 : 4;
    reader.offset = 8;
    const tensorCount = Number(readLength(reader, countsWidth));
    const keyCount = Number(readLength(reader, countsWidth));
    reader.offset = version >= 2 ? 24 : 16;

    const values = new Map<string, MetadataValue>();
    for (let index = 0; index < keyCount; index += 1) {
      const key = readString(reader);
      need(reader, 4);
      const type = reader.buffer.readUInt32LE(reader.offset);
      reader.offset += 4;
      values.set(key, readValue(reader, type));
    }

    const architecture = values.get('general.architecture');
    const metadata: GgufMetadata = {
      version,
      tensorCount,
      architecture: typeof architecture === 'string' ? architecture : 'unknown',
      keys: [...values.keys()],
    };
    const name = values.get('general.name');
    if (typeof name === 'string') metadata.name = name;
    const quantization = values.get('general.file_type');
    const quantizationName = typeof values.get('general.quantization_version') === 'number';
    if (quantization !== undefined && typeof quantization === 'number')
      metadata.quantization = `type ${quantization}`;
    else if (quantizationName) metadata.quantization = 'type unknown';
    const contextLength = asNumber(values.get(`${metadata.architecture}.context_length`));
    if (contextLength !== undefined) metadata.contextLength = contextLength;
    const embeddingLength = asNumber(values.get(`${metadata.architecture}.embedding_length`));
    if (embeddingLength !== undefined) metadata.embeddingLength = embeddingLength;
    const blockCount = asNumber(values.get(`${metadata.architecture}.block_count`));
    if (blockCount !== undefined) metadata.blockCount = blockCount;
    const expertCount = asNumber(values.get(`${metadata.architecture}.expert_count`));
    if (expertCount !== undefined) metadata.expertCount = expertCount;
    const parameterCount = asNumber(values.get('general.parameter_count'));
    if (parameterCount !== undefined) metadata.parameterCount = BigInt(parameterCount);

    return { path, sizeBytes: stats.size, valid: true, metadata };
  } catch (error) {
    return {
      path,
      sizeBytes,
      valid: false,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await handle.close();
  }
}

export function formatGgufReport(inspection: GgufInspection): string {
  if (!inspection.valid || !inspection.metadata)
    return `${inspection.path}: ${inspection.message ?? 'unreadable GGUF file'}`;
  const metadata = inspection.metadata;
  const family = familyForArchitecture(metadata.architecture);
  const known = (KNOWN_ARCHITECTURES as readonly string[]).includes(
    metadata.architecture.toLowerCase(),
  );
  const details = [
    `architecture=${metadata.architecture}${known ? '' : ' (not in the known list)'}`,
    family ? `family=${family}` : undefined,
    metadata.name ? `name=${metadata.name}` : undefined,
    metadata.quantization ? `quant=${metadata.quantization}` : undefined,
    metadata.contextLength ? `context=${metadata.contextLength}` : undefined,
    metadata.blockCount ? `layers=${metadata.blockCount}` : undefined,
    `tensors=${metadata.tensorCount}`,
    `ggufVersion=${metadata.version}`,
  ].filter(Boolean);
  return `${inspection.path}: ${details.join(' ')}`;
}
