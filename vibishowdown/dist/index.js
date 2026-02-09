// src/config.ts
var OFFICIAL_VIBINET_WSS = "wss://net.studiovibi.com";
var WS_URL = OFFICIAL_VIBINET_WSS;

// ../VibiNet/src/packer.ts
var MAX_SAFE_BITS = 53;
var text_decoder = new TextDecoder();
var union_cache = /* @__PURE__ */ new WeakMap();
var struct_cache = /* @__PURE__ */ new WeakMap();
var BitWriter = class {
  buf;
  bit_pos;
  constructor(buf) {
    this.buf = buf;
    this.bit_pos = 0;
  }
  write_bit(bit) {
    const byte_index = this.bit_pos >>> 3;
    const bit_index = this.bit_pos & 7;
    if (bit) {
      this.buf[byte_index] |= 1 << bit_index;
    }
    this.bit_pos++;
  }
  write_bitsUnsigned(value, bits) {
    if (bits === 0) return;
    if (typeof value === "number") {
      if (bits <= 32) {
        const aligned = (this.bit_pos & 7) === 0 && (bits & 7) === 0;
        if (aligned) {
          let v2 = value >>> 0;
          let byte_index = this.bit_pos >>> 3;
          for (let i = 0; i < bits; i += 8) {
            this.buf[byte_index++] = v2 & 255;
            v2 >>>= 8;
          }
          this.bit_pos += bits;
          return;
        }
        let v = value >>> 0;
        for (let i = 0; i < bits; i++) {
          this.write_bit(v & 1);
          v >>>= 1;
        }
        return;
      }
      this.write_bitsBigint(BigInt(value), bits);
      return;
    }
    this.write_bitsBigint(value, bits);
  }
  write_bitsBigint(value, bits) {
    if (bits === 0) return;
    const aligned = (this.bit_pos & 7) === 0 && (bits & 7) === 0;
    if (aligned) {
      let v2 = value;
      let byte_index = this.bit_pos >>> 3;
      for (let i = 0; i < bits; i += 8) {
        this.buf[byte_index++] = Number(v2 & 0xffn);
        v2 >>= 8n;
      }
      this.bit_pos += bits;
      return;
    }
    let v = value;
    for (let i = 0; i < bits; i++) {
      this.write_bit((v & 1n) === 0n ? 0 : 1);
      v >>= 1n;
    }
  }
};
var BitReader = class {
  buf;
  bit_pos;
  constructor(buf) {
    this.buf = buf;
    this.bit_pos = 0;
  }
  read_bit() {
    const byte_index = this.bit_pos >>> 3;
    const bit_index = this.bit_pos & 7;
    const bit = this.buf[byte_index] >>> bit_index & 1;
    this.bit_pos++;
    return bit;
  }
  read_bitsUnsigned(bits) {
    if (bits === 0) return 0;
    if (bits <= 32) {
      const aligned = (this.bit_pos & 7) === 0 && (bits & 7) === 0;
      if (aligned) {
        let v2 = 0;
        let shift = 0;
        let byte_index = this.bit_pos >>> 3;
        for (let i = 0; i < bits; i += 8) {
          v2 |= this.buf[byte_index++] << shift;
          shift += 8;
        }
        this.bit_pos += bits;
        return v2 >>> 0;
      }
      let v = 0;
      for (let i = 0; i < bits; i++) {
        if (this.read_bit()) {
          v |= 1 << i;
        }
      }
      return v >>> 0;
    }
    if (bits <= MAX_SAFE_BITS) {
      let v = 0;
      let pow = 1;
      for (let i = 0; i < bits; i++) {
        if (this.read_bit()) {
          v += pow;
        }
        pow *= 2;
      }
      return v;
    }
    return this.read_bitsBigint(bits);
  }
  read_bitsBigint(bits) {
    if (bits === 0) return 0n;
    const aligned = (this.bit_pos & 7) === 0 && (bits & 7) === 0;
    if (aligned) {
      let v2 = 0n;
      let shift = 0n;
      let byte_index = this.bit_pos >>> 3;
      for (let i = 0; i < bits; i += 8) {
        v2 |= BigInt(this.buf[byte_index++]) << shift;
        shift += 8n;
      }
      this.bit_pos += bits;
      return v2;
    }
    let v = 0n;
    let pow = 1n;
    for (let i = 0; i < bits; i++) {
      if (this.read_bit()) {
        v += pow;
      }
      pow <<= 1n;
    }
    return v;
  }
};
function assert_integer(value, name) {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${name} must be an integer`);
  }
}
function assert_size(size) {
  assert_integer(size, "size");
  if (size < 0) throw new RangeError("size must be >= 0");
}
function assert_vector_size(expected, actual) {
  if (actual !== expected) {
    throw new RangeError(`vector size mismatch: expected ${expected}, got ${actual}`);
  }
}
function size_bits(type, val) {
  switch (type.$) {
    case "UInt":
    case "Int":
      assert_size(type.size);
      return type.size;
    case "Nat": {
      if (typeof val === "bigint") {
        if (val < 0n) throw new RangeError("Nat must be >= 0");
        if (val > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new RangeError("Nat too large to size");
        }
        return Number(val) + 1;
      }
      assert_integer(val, "Nat");
      if (val < 0) throw new RangeError("Nat must be >= 0");
      return val + 1;
    }
    case "Tuple": {
      const fields = type.fields;
      const arr = as_array(val, "Tuple");
      let bits = 0;
      for (let i = 0; i < fields.length; i++) {
        bits += size_bits(fields[i], arr[i]);
      }
      return bits;
    }
    case "Vector": {
      assert_size(type.size);
      const arr = as_array(val, "Vector");
      assert_vector_size(type.size, arr.length);
      let bits = 0;
      for (let i = 0; i < type.size; i++) {
        bits += size_bits(type.type, arr[i]);
      }
      return bits;
    }
    case "Struct": {
      let bits = 0;
      const keys = struct_keys(type.fields);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const v = get_struct_field(val, key);
        bits += size_bits(type.fields[key], v);
      }
      return bits;
    }
    case "List": {
      let bits = 1;
      for_each_list(val, (item) => {
        bits += 1;
        bits += size_bits(type.type, item);
      });
      return bits;
    }
    case "Map": {
      let bits = 1;
      for_each_map(val, (k, v) => {
        bits += 1;
        bits += size_bits(type.key, k);
        bits += size_bits(type.value, v);
      });
      return bits;
    }
    case "Union": {
      const info = union_info(type);
      const tag = get_union_tag(val);
      const variant_type = type.variants[tag];
      if (!variant_type) {
        throw new RangeError(`Unknown union variant: ${tag}`);
      }
      const payload = get_union_payload(val, variant_type);
      return info.tag_bits + size_bits(variant_type, payload);
    }
    case "String": {
      const byte_len = utf8_byte_length(val);
      return 1 + byte_len * 9;
    }
  }
}
function encode_into(writer, type, val) {
  switch (type.$) {
    case "UInt": {
      assert_size(type.size);
      if (type.size === 0) {
        if (val === 0 || val === 0n) return;
        throw new RangeError("UInt out of range");
      }
      if (typeof val === "bigint") {
        if (val < 0n) throw new RangeError("UInt must be >= 0");
        const max2 = 1n << BigInt(type.size);
        if (val >= max2) throw new RangeError("UInt out of range");
        writer.write_bitsUnsigned(val, type.size);
        return;
      }
      assert_integer(val, "UInt");
      if (val < 0) throw new RangeError("UInt must be >= 0");
      if (type.size > MAX_SAFE_BITS) {
        throw new RangeError("UInt too large for number; use bigint");
      }
      const max = 2 ** type.size;
      if (val >= max) throw new RangeError("UInt out of range");
      writer.write_bitsUnsigned(val, type.size);
      return;
    }
    case "Int": {
      assert_size(type.size);
      if (type.size === 0) {
        if (val === 0 || val === 0n) return;
        throw new RangeError("Int out of range");
      }
      if (typeof val === "bigint") {
        const size = BigInt(type.size);
        const min2 = -(1n << size - 1n);
        const max2 = (1n << size - 1n) - 1n;
        if (val < min2 || val > max2) throw new RangeError("Int out of range");
        let unsigned2 = val;
        if (val < 0n) unsigned2 = (1n << size) + val;
        writer.write_bitsUnsigned(unsigned2, type.size);
        return;
      }
      assert_integer(val, "Int");
      if (type.size > MAX_SAFE_BITS) {
        throw new RangeError("Int too large for number; use bigint");
      }
      const min = -(2 ** (type.size - 1));
      const max = 2 ** (type.size - 1) - 1;
      if (val < min || val > max) throw new RangeError("Int out of range");
      let unsigned = val;
      if (val < 0) unsigned = 2 ** type.size + val;
      writer.write_bitsUnsigned(unsigned, type.size);
      return;
    }
    case "Nat": {
      if (typeof val === "bigint") {
        if (val < 0n) throw new RangeError("Nat must be >= 0");
        let n = val;
        while (n > 0n) {
          writer.write_bit(1);
          n -= 1n;
        }
        writer.write_bit(0);
        return;
      }
      assert_integer(val, "Nat");
      if (val < 0) throw new RangeError("Nat must be >= 0");
      for (let i = 0; i < val; i++) {
        writer.write_bit(1);
      }
      writer.write_bit(0);
      return;
    }
    case "Tuple": {
      const fields = type.fields;
      const arr = as_array(val, "Tuple");
      for (let i = 0; i < fields.length; i++) {
        encode_into(writer, fields[i], arr[i]);
      }
      return;
    }
    case "Vector": {
      assert_size(type.size);
      const arr = as_array(val, "Vector");
      assert_vector_size(type.size, arr.length);
      for (let i = 0; i < type.size; i++) {
        encode_into(writer, type.type, arr[i]);
      }
      return;
    }
    case "Struct": {
      const keys = struct_keys(type.fields);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        encode_into(writer, type.fields[key], get_struct_field(val, key));
      }
      return;
    }
    case "List": {
      for_each_list(val, (item) => {
        writer.write_bit(1);
        encode_into(writer, type.type, item);
      });
      writer.write_bit(0);
      return;
    }
    case "Map": {
      for_each_map(val, (k, v) => {
        writer.write_bit(1);
        encode_into(writer, type.key, k);
        encode_into(writer, type.value, v);
      });
      writer.write_bit(0);
      return;
    }
    case "Union": {
      const info = union_info(type);
      const tag = get_union_tag(val);
      const index = info.index_by_tag.get(tag);
      if (index === void 0) {
        throw new RangeError(`Unknown union variant: ${tag}`);
      }
      if (info.tag_bits > 0) {
        writer.write_bitsUnsigned(index, info.tag_bits);
      }
      const variant_type = type.variants[tag];
      const payload = get_union_payload(val, variant_type);
      encode_into(writer, variant_type, payload);
      return;
    }
    case "String": {
      write_utf8_list(writer, val);
      return;
    }
  }
}
function decode_from(reader, type) {
  switch (type.$) {
    case "UInt": {
      assert_size(type.size);
      return reader.read_bitsUnsigned(type.size);
    }
    case "Int": {
      assert_size(type.size);
      if (type.size === 0) return 0;
      const unsigned = reader.read_bitsUnsigned(type.size);
      if (typeof unsigned === "bigint") {
        const sign_bit2 = 1n << BigInt(type.size - 1);
        if (unsigned & sign_bit2) {
          return unsigned - (1n << BigInt(type.size));
        }
        return unsigned;
      }
      const sign_bit = 2 ** (type.size - 1);
      if (unsigned >= sign_bit) {
        return unsigned - 2 ** type.size;
      }
      return unsigned;
    }
    case "Nat": {
      let n = 0;
      let big = null;
      while (reader.read_bit()) {
        if (big !== null) {
          big += 1n;
        } else if (n === Number.MAX_SAFE_INTEGER) {
          big = BigInt(n) + 1n;
        } else {
          n++;
        }
      }
      return big ?? n;
    }
    case "Tuple": {
      const out = new Array(type.fields.length);
      for (let i = 0; i < type.fields.length; i++) {
        out[i] = decode_from(reader, type.fields[i]);
      }
      return out;
    }
    case "Vector": {
      const out = new Array(type.size);
      for (let i = 0; i < type.size; i++) {
        out[i] = decode_from(reader, type.type);
      }
      return out;
    }
    case "Struct": {
      const out = {};
      const keys = struct_keys(type.fields);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        out[key] = decode_from(reader, type.fields[key]);
      }
      return out;
    }
    case "List": {
      const out = [];
      while (reader.read_bit()) {
        out.push(decode_from(reader, type.type));
      }
      return out;
    }
    case "Map": {
      const out = /* @__PURE__ */ new Map();
      while (reader.read_bit()) {
        const key = decode_from(reader, type.key);
        const value = decode_from(reader, type.value);
        out.set(key, value);
      }
      return out;
    }
    case "Union": {
      const info = union_info(type);
      let raw_index = 0;
      if (info.tag_bits > 0) {
        raw_index = reader.read_bitsUnsigned(info.tag_bits);
      }
      let index;
      if (typeof raw_index === "bigint") {
        if (raw_index > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new RangeError("Union tag index too large");
        }
        index = Number(raw_index);
      } else {
        index = raw_index;
      }
      if (index < 0 || index >= info.keys.length) {
        throw new RangeError("Union tag index out of range");
      }
      const tag = info.keys[index];
      const variant_type = type.variants[tag];
      const payload = decode_from(reader, variant_type);
      if (variant_type.$ === "Struct") {
        if (payload && typeof payload === "object") {
          payload.$ = tag;
          return payload;
        }
      }
      return { $: tag, value: payload };
    }
    case "String": {
      return read_utf8_list(reader);
    }
  }
}
function as_array(val, label) {
  if (!Array.isArray(val)) {
    throw new TypeError(`${label} value must be an Array`);
  }
  return val;
}
function get_struct_field(val, key) {
  if (val && typeof val === "object") {
    return val[key];
  }
  throw new TypeError("Struct value must be an object");
}
function union_info(type) {
  const cached = union_cache.get(type);
  if (cached) return cached;
  const keys = Object.keys(type.variants).sort();
  if (keys.length === 0) {
    throw new RangeError("Union must have at least one variant");
  }
  const index_by_tag = /* @__PURE__ */ new Map();
  for (let i = 0; i < keys.length; i++) {
    index_by_tag.set(keys[i], i);
  }
  const tag_bits = keys.length <= 1 ? 0 : Math.ceil(Math.log2(keys.length));
  const info = { keys, index_by_tag, tag_bits };
  union_cache.set(type, info);
  return info;
}
function struct_keys(fields) {
  const cached = struct_cache.get(fields);
  if (cached) return cached;
  const keys = Object.keys(fields);
  struct_cache.set(fields, keys);
  return keys;
}
function get_union_tag(val) {
  if (!val || typeof val !== "object") {
    throw new TypeError("Union value must be an object with a $ tag");
  }
  const tag = val.$;
  if (typeof tag !== "string") {
    throw new TypeError("Union value must have a string $ tag");
  }
  return tag;
}
function get_union_payload(val, variant_type) {
  if (variant_type.$ !== "Struct" && val && typeof val === "object" && Object.prototype.hasOwnProperty.call(val, "value")) {
    return val.value;
  }
  return val;
}
function for_each_list(val, fn) {
  if (!Array.isArray(val)) {
    throw new TypeError("List value must be an Array");
  }
  for (let i = 0; i < val.length; i++) {
    fn(val[i]);
  }
}
function for_each_map(val, fn) {
  if (val == null) return;
  if (val instanceof Map) {
    for (const [k, v] of val) {
      fn(k, v);
    }
    return;
  }
  if (typeof val === "object") {
    for (const key of Object.keys(val)) {
      fn(key, val[key]);
    }
    return;
  }
  throw new TypeError("Map value must be a Map or object");
}
function utf8_byte_length(value) {
  if (typeof value !== "string") {
    throw new TypeError("String value must be a string");
  }
  let len = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 128) {
      len += 1;
    } else if (code < 2048) {
      len += 2;
    } else if (code >= 55296 && code <= 56319) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
      if (next >= 56320 && next <= 57343) {
        i++;
        len += 4;
      } else {
        len += 3;
      }
    } else if (code >= 56320 && code <= 57343) {
      len += 3;
    } else {
      len += 3;
    }
  }
  return len;
}
function write_utf8_list(writer, value) {
  if (typeof value !== "string") {
    throw new TypeError("String value must be a string");
  }
  for (let i = 0; i < value.length; i++) {
    let code = value.charCodeAt(i);
    if (code < 128) {
      writer.write_bit(1);
      writer.write_bitsUnsigned(code, 8);
      continue;
    }
    if (code < 2048) {
      writer.write_bit(1);
      writer.write_bitsUnsigned(192 | code >>> 6, 8);
      writer.write_bit(1);
      writer.write_bitsUnsigned(128 | code & 63, 8);
      continue;
    }
    if (code >= 55296 && code <= 56319) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
      if (next >= 56320 && next <= 57343) {
        i++;
        const cp = (code - 55296 << 10) + (next - 56320) + 65536;
        writer.write_bit(1);
        writer.write_bitsUnsigned(240 | cp >>> 18, 8);
        writer.write_bit(1);
        writer.write_bitsUnsigned(128 | cp >>> 12 & 63, 8);
        writer.write_bit(1);
        writer.write_bitsUnsigned(128 | cp >>> 6 & 63, 8);
        writer.write_bit(1);
        writer.write_bitsUnsigned(128 | cp & 63, 8);
        continue;
      }
      code = 65533;
    } else if (code >= 56320 && code <= 57343) {
      code = 65533;
    }
    writer.write_bit(1);
    writer.write_bitsUnsigned(224 | code >>> 12, 8);
    writer.write_bit(1);
    writer.write_bitsUnsigned(128 | code >>> 6 & 63, 8);
    writer.write_bit(1);
    writer.write_bitsUnsigned(128 | code & 63, 8);
  }
  writer.write_bit(0);
}
function read_utf8_list(reader) {
  let bytes = new Uint8Array(16);
  let len = 0;
  while (reader.read_bit()) {
    const byte = reader.read_bitsUnsigned(8);
    if (len === bytes.length) {
      const next = new Uint8Array(bytes.length * 2);
      next.set(bytes);
      bytes = next;
    }
    bytes[len++] = byte;
  }
  return text_decoder.decode(bytes.subarray(0, len));
}
function encode(type, val) {
  const bits = size_bits(type, val);
  const buf = new Uint8Array(bits + 7 >>> 3);
  const writer = new BitWriter(buf);
  encode_into(writer, type, val);
  return buf;
}
function decode(type, buf) {
  const reader = new BitReader(buf);
  return decode_from(reader, type);
}

// ../VibiNet/src/protocol.ts
var TIME_BITS = 53;
var BYTE_LIST_PACKED = { $: "List", type: { $: "UInt", size: 8 } };
var MESSAGE_PACKED = {
  $: "Union",
  variants: {
    get_time: { $: "Struct", fields: {} },
    info_time: {
      $: "Struct",
      fields: {
        time: { $: "UInt", size: TIME_BITS }
      }
    },
    post: {
      $: "Struct",
      fields: {
        room: { $: "String" },
        time: { $: "UInt", size: TIME_BITS },
        name: { $: "String" },
        payload: BYTE_LIST_PACKED
      }
    },
    info_post: {
      $: "Struct",
      fields: {
        room: { $: "String" },
        index: { $: "UInt", size: 32 },
        server_time: { $: "UInt", size: TIME_BITS },
        client_time: { $: "UInt", size: TIME_BITS },
        name: { $: "String" },
        payload: BYTE_LIST_PACKED
      }
    },
    load: {
      $: "Struct",
      fields: {
        room: { $: "String" },
        from: { $: "UInt", size: 32 }
      }
    },
    watch: {
      $: "Struct",
      fields: {
        room: { $: "String" }
      }
    },
    unwatch: {
      $: "Struct",
      fields: {
        room: { $: "String" }
      }
    }
  }
};
function bytes_to_list(bytes) {
  const out = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i];
  }
  return out;
}
function list_to_bytes(list) {
  const out = new Uint8Array(list.length);
  for (let i = 0; i < list.length; i++) {
    out[i] = list[i] & 255;
  }
  return out;
}
function to_wire_message(message) {
  switch (message.$) {
    case "post":
      return {
        $: "post",
        room: message.room,
        time: message.time,
        name: message.name,
        payload: bytes_to_list(message.payload)
      };
    case "info_post":
      return {
        $: "info_post",
        room: message.room,
        index: message.index,
        server_time: message.server_time,
        client_time: message.client_time,
        name: message.name,
        payload: bytes_to_list(message.payload)
      };
    default:
      return message;
  }
}
function from_wire_message(message) {
  switch (message.$) {
    case "post":
      return {
        $: "post",
        room: message.room,
        time: message.time,
        name: message.name,
        payload: list_to_bytes(message.payload)
      };
    case "info_post":
      return {
        $: "info_post",
        room: message.room,
        index: message.index,
        server_time: message.server_time,
        client_time: message.client_time,
        name: message.name,
        payload: list_to_bytes(message.payload)
      };
    default:
      return message;
  }
}
function encode_message(message) {
  return encode(MESSAGE_PACKED, to_wire_message(message));
}
function decode_message(buf) {
  const message = decode(MESSAGE_PACKED, buf);
  return from_wire_message(message);
}

// ../VibiNet/src/server_url.ts
var OFFICIAL_SERVER_URL = "wss://net.studiovibi.com";
function normalize_ws_url(raw_url) {
  let ws_url = raw_url;
  try {
    const url = new URL(raw_url);
    if (url.protocol === "http:") {
      url.protocol = "ws:";
    } else if (url.protocol === "https:") {
      url.protocol = "wss:";
    }
    ws_url = url.toString();
  } catch {
    ws_url = raw_url;
  }
  if (typeof window !== "undefined" && window.location.protocol === "https:" && ws_url.startsWith("ws://")) {
    const upgraded = `wss://${ws_url.slice("ws://".length)}`;
    console.warn(
      `[VibiNet] Upgrading insecure WebSocket URL "${ws_url}" to "${upgraded}" because the page is HTTPS.`
    );
    return upgraded;
  }
  return ws_url;
}

// ../VibiNet/src/client.ts
function now() {
  return Math.floor(Date.now());
}
function default_ws_url() {
  return OFFICIAL_SERVER_URL;
}
function gen_name() {
  const alphabet = "_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-";
  const bytes = new Uint8Array(8);
  const can_crypto = typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function";
  if (can_crypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 8; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[bytes[i] % 64];
  }
  return out;
}
function create_client(server) {
  const time_sync = {
    clock_offset: Infinity,
    lowest_ping: Infinity,
    request_sent_at: 0,
    last_ping: Infinity
  };
  const room_watchers2 = /* @__PURE__ */ new Map();
  let is_synced = false;
  const sync_listeners = [];
  const ws_url = normalize_ws_url(server ?? default_ws_url());
  const ws = new WebSocket(ws_url);
  ws.binaryType = "arraybuffer";
  function server_time() {
    if (!isFinite(time_sync.clock_offset)) {
      throw new Error("server_time() called before initial sync");
    }
    return Math.floor(now() + time_sync.clock_offset);
  }
  function ensure_open() {
    if (ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not open");
    }
  }
  function send(buf) {
    ensure_open();
    ws.send(buf);
  }
  function register_handler(room2, packer, handler) {
    const existing = room_watchers2.get(room2);
    if (existing) {
      if (existing.packer !== packer) {
        throw new Error(`Packed schema already registered for room: ${room2}`);
      }
      if (handler) {
        existing.handler = handler;
      }
      return;
    }
    room_watchers2.set(room2, { handler, packer });
  }
  ws.addEventListener("open", () => {
    console.log("[WS] Connected");
    time_sync.request_sent_at = now();
    send(encode_message({ $: "get_time" }));
    setInterval(() => {
      time_sync.request_sent_at = now();
      send(encode_message({ $: "get_time" }));
    }, 2e3);
  });
  ws.addEventListener("message", (event) => {
    const data = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : new Uint8Array(event.data);
    const msg = decode_message(data);
    switch (msg.$) {
      case "info_time": {
        const t = now();
        const ping2 = t - time_sync.request_sent_at;
        time_sync.last_ping = ping2;
        if (ping2 < time_sync.lowest_ping) {
          const local_avg = Math.floor((time_sync.request_sent_at + t) / 2);
          time_sync.clock_offset = msg.time - local_avg;
          time_sync.lowest_ping = ping2;
        }
        if (!is_synced) {
          is_synced = true;
          for (const cb of sync_listeners) {
            cb();
          }
          sync_listeners.length = 0;
        }
        break;
      }
      case "info_post": {
        const watcher = room_watchers2.get(msg.room);
        if (watcher && watcher.handler) {
          const data2 = decode(watcher.packer, msg.payload);
          watcher.handler({
            $: "info_post",
            room: msg.room,
            index: msg.index,
            server_time: msg.server_time,
            client_time: msg.client_time,
            name: msg.name,
            data: data2
          });
        }
        break;
      }
    }
  });
  return {
    on_sync: (callback) => {
      if (is_synced) {
        callback();
        return;
      }
      sync_listeners.push(callback);
    },
    watch: (room2, packer, handler) => {
      register_handler(room2, packer, handler);
      send(encode_message({ $: "watch", room: room2 }));
    },
    load: (room2, from, packer) => {
      register_handler(room2, packer);
      send(encode_message({ $: "load", room: room2, from }));
    },
    post: (room2, data, packer) => {
      const name = gen_name();
      const payload = encode(packer, data);
      send(encode_message({ $: "post", room: room2, time: server_time(), name, payload }));
      return name;
    },
    server_time,
    ping: () => time_sync.last_ping,
    close: () => ws.close()
  };
}

// src/client.ts
var ROOM_POST_PACKER = { $: "String" };
var client = create_client(WS_URL);
var room_watchers = /* @__PURE__ */ new Map();
function decode_room_post(raw) {
  if (typeof raw !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || typeof parsed.$ !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
function emit_if_valid(room2, message) {
  if (!message || message.$ !== "info_post") {
    return;
  }
  const data = decode_room_post(message.data);
  if (!data) {
    return;
  }
  const handler = room_watchers.get(room2);
  if (!handler) {
    return;
  }
  handler({
    $: "info_post",
    room: message.room,
    index: message.index,
    server_time: message.server_time,
    client_time: message.client_time,
    name: message.name,
    data
  });
}
function post(room2, data) {
  return client.post(room2, JSON.stringify(data), ROOM_POST_PACKER);
}
function load(room2, from = 0, handler) {
  if (handler) {
    room_watchers.set(room2, handler);
  }
  client.load(room2, from, ROOM_POST_PACKER);
}
function watch(room2, handler) {
  if (handler) {
    room_watchers.set(room2, handler);
  }
  client.watch(room2, ROOM_POST_PACKER, (message) => {
    emit_if_valid(room2, message);
  });
}
function on_sync(callback) {
  client.on_sync(callback);
}
function on_open(callback) {
  client.on_sync(callback);
}
function ping() {
  return client.ping();
}

// vibishowdown/index.ts
var PLAYER_SLOTS = ["player1", "player2"];
var MOVE_OPTIONS = ["basic_attack", "quick_attack", "agility", "return", "double_edge", "seismic_toss", "screech", "endure", "protect", "none"];
var PASSIVE_OPTIONS = ["none", "leftovers", "choice_band"];
var MOVE_LABELS = {
  basic_attack: "Basic Attack",
  quick_attack: "Quick Attack",
  agility: "Agility",
  return: "Return",
  double_edge: "Double-Edge",
  seismic_toss: "Seismic Toss",
  screech: "Screech",
  endure: "Endure",
  protect: "Protect",
  none: "none"
};
var PASSIVE_LABELS = {
  none: "none",
  leftovers: "Leftovers",
  choice_band: "Choice Band",
  // Legacy alias for older saved configs.
  regen_5pct: "Leftovers"
};
var roster = [
  {
    id: "babydragon",
    name: "Baby Dragon TR",
    role: "Return Tester",
    stats: { level: 7, maxHp: 100, attack: 100, defense: 10, speed: 20 },
    possibleMoves: MOVE_OPTIONS.slice(),
    possiblePassives: PASSIVE_OPTIONS.slice(),
    defaultMoves: ["return", "none", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "croni",
    name: "Croni DR",
    role: "Return Dummy",
    stats: { level: 7, maxHp: 100, attack: 10, defense: 10, speed: 10 },
    possibleMoves: MOVE_OPTIONS.slice(),
    possiblePassives: PASSIVE_OPTIONS.slice(),
    defaultMoves: ["none", "none", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "harpy",
    name: "Harpy TD",
    role: "Double-Edge Tester",
    stats: { level: 7, maxHp: 100, attack: 100, defense: 10, speed: 20 },
    possibleMoves: MOVE_OPTIONS.slice(),
    possiblePassives: PASSIVE_OPTIONS.slice(),
    defaultMoves: ["double_edge", "none", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "hoof",
    name: "Hoof DD",
    role: "Double-Edge Dummy",
    stats: { level: 7, maxHp: 100, attack: 10, defense: 10, speed: 10 },
    possibleMoves: MOVE_OPTIONS.slice(),
    possiblePassives: PASSIVE_OPTIONS.slice(),
    defaultMoves: ["none", "none", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "knight",
    name: "Knight TR",
    role: "Return Tester",
    stats: { level: 7, maxHp: 100, attack: 100, defense: 10, speed: 20 },
    possibleMoves: MOVE_OPTIONS.slice(),
    possiblePassives: PASSIVE_OPTIONS.slice(),
    defaultMoves: ["return", "none", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "miren",
    name: "Miren DS",
    role: "Seismic Toss Dummy",
    stats: { level: 7, maxHp: 100, attack: 10, defense: 10, speed: 10 },
    possibleMoves: MOVE_OPTIONS.slice(),
    possiblePassives: PASSIVE_OPTIONS.slice(),
    defaultMoves: ["none", "none", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "panda",
    name: "Panda TS",
    role: "Seismic Toss Tester",
    stats: { level: 7, maxHp: 100, attack: 100, defense: 10, speed: 20 },
    possibleMoves: MOVE_OPTIONS.slice(),
    possiblePassives: PASSIVE_OPTIONS.slice(),
    defaultMoves: ["seismic_toss", "none", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "valkyria",
    name: "Valkyria DR",
    role: "Return Dummy",
    stats: { level: 7, maxHp: 100, attack: 10, defense: 10, speed: 10 },
    possibleMoves: MOVE_OPTIONS.slice(),
    possiblePassives: PASSIVE_OPTIONS.slice(),
    defaultMoves: ["none", "none", "none", "none"],
    defaultPassive: "none"
  }
];
var roster_by_id = new Map(roster.map((entry) => [entry.id, entry]));
var room = prompt("Room name?") || gen_name();
var player_name = prompt("Your name?") || gen_name();
var token_key = `vibi_showdown_token:${room}:${player_name}`;
var stored_token = localStorage.getItem(token_key) || void 0;
var profile_key = `vibi_showdown_profile:${player_name}`;
var team_key = `vibi_showdown_team:${room}:${player_name}`;
var status_room = document.getElementById("status-room");
var status_name = document.getElementById("status-name");
var status_slot = document.getElementById("status-slot");
var status_conn = document.getElementById("status-conn");
var status_ping = document.getElementById("status-ping");
var status_turn = document.getElementById("status-turn");
var status_deadline = document.getElementById("status-deadline");
var status_ready = document.getElementById("status-ready");
var status_opponent = document.getElementById("status-opponent");
var log_list = document.getElementById("log-list");
var chat_messages = document.getElementById("chat-messages");
var chat_input = document.getElementById("chat-input");
var chat_send = document.getElementById("chat-send");
var participants_list = document.getElementById("participants-list");
var player_title = document.getElementById("player-name");
var player_meta = document.getElementById("player-meta");
var enemy_title = document.getElementById("enemy-name");
var enemy_meta = document.getElementById("enemy-meta");
var enemy_hp = document.getElementById("enemy-hp");
var player_hp = document.getElementById("player-hp");
var player_sprite = document.getElementById("player-sprite");
var enemy_sprite = document.getElementById("enemy-sprite");
var player_sprite_wrap = document.getElementById("player-sprite-wrap");
var enemy_sprite_wrap = document.getElementById("enemy-sprite-wrap");
var prematch = document.getElementById("prematch");
var prematch_hint = document.getElementById("prematch-hint");
var ready_btn = document.getElementById("ready-btn");
var move_buttons = [
  document.getElementById("move-btn-0"),
  document.getElementById("move-btn-1"),
  document.getElementById("move-btn-2"),
  document.getElementById("move-btn-3")
];
var switch_btn = document.getElementById("switch-btn");
var surrender_btn = document.getElementById("surrender-btn");
var switch_modal = document.getElementById("switch-modal");
var switch_options = document.getElementById("switch-options");
var switch_close = document.getElementById("switch-close");
var roster_count = document.getElementById("roster-count");
var slot_active = document.getElementById("slot-active");
var slot_bench_a = document.getElementById("slot-bench-a");
var slot_bench_b = document.getElementById("slot-bench-b");
var slot_active_name = document.getElementById("slot-active-name");
var slot_bench_a_name = document.getElementById("slot-bench-a-name");
var slot_bench_b_name = document.getElementById("slot-bench-b-name");
var slot_active_img = document.getElementById("slot-active-img");
var slot_bench_a_img = document.getElementById("slot-bench-a-img");
var slot_bench_b_img = document.getElementById("slot-bench-b-img");
var monster_tabs = document.getElementById("monster-tabs");
var moves_grid = document.getElementById("moves-grid");
var passive_grid = document.getElementById("passive-grid");
var stats_grid = document.getElementById("stats-grid");
var config_warning = document.getElementById("config-warning");
var player_bench_slots = [
  {
    btn: document.getElementById("player-bench-0"),
    img: document.getElementById("player-bench-0-img")
  },
  {
    btn: document.getElementById("player-bench-1"),
    img: document.getElementById("player-bench-1-img")
  }
];
var enemy_bench_slots = [
  {
    btn: document.getElementById("enemy-bench-0"),
    img: document.getElementById("enemy-bench-0-img")
  },
  {
    btn: document.getElementById("enemy-bench-1"),
    img: document.getElementById("enemy-bench-1-img")
  }
];
var match_end = document.getElementById("match-end");
var match_end_title = document.getElementById("match-end-title");
var match_end_sub = document.getElementById("match-end-sub");
var match_end_btn = document.getElementById("match-end-btn");
status_room.textContent = room;
status_name.textContent = player_name;
player_title.textContent = player_name;
enemy_title.textContent = "Opponent";
document.body.classList.add("prematch-open");
var current_turn = 0;
var deadline_at = 0;
var slot = null;
var is_ready = false;
var match_started = false;
var latest_state = null;
var opponent_ready = false;
var opponent_name = null;
var is_spectator = false;
var last_ready_snapshot = null;
var participants = null;
var ready_order = [];
var intent_locked = false;
var hp_animation = {};
var animation_timers = [];
var sprite_fx_classes = ["jump", "hit", "heal", "shield-on", "shield-hit"];
var selected = [];
var active_tab = null;
function icon_path(id) {
  return `./icons/unit_${id}.png`;
}
function monster_label(id, fallback = "mon") {
  if (!id) return fallback;
  return roster_by_id.get(id)?.name ?? id;
}
function append_log(line) {
  append_line(log_list, line);
}
function append_chat(line) {
  append_line(chat_messages, line);
}
function send_chat_message(message) {
  const trimmed = message.trim();
  if (!trimmed) return;
  post(room, { $: "chat", message: trimmed.slice(0, 200), from: player_name });
}
function setup_chat_input(input, button) {
  if (!input || !button) return;
  input.disabled = false;
  button.disabled = false;
  input.placeholder = "Type message...";
  const handler = () => {
    send_chat_message(input.value);
    input.value = "";
  };
  button.addEventListener("click", handler);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      handler();
    }
  });
}
function append_line(container, line) {
  if (!container) return;
  const p = document.createElement("p");
  p.textContent = line;
  container.appendChild(p);
  container.scrollTop = container.scrollHeight;
}
function render_participants() {
  participants_list.innerHTML = "";
  if (!participants) {
    return;
  }
  for (const slot_id of PLAYER_SLOTS) {
    const name = participants.players[slot_id];
    if (!name) continue;
    const item = document.createElement("div");
    item.className = "participant";
    const meta = slot_id === "player1" ? "P1" : "P2";
    item.innerHTML = `<span>${name}</span><span class="participant-meta">${meta}</span>`;
    participants_list.appendChild(item);
  }
  const spectators = participants.spectators.slice().sort((a, b) => a.localeCompare(b, void 0, { sensitivity: "base" }));
  for (const name of spectators) {
    const item = document.createElement("div");
    item.className = "participant";
    item.innerHTML = `<span>${name}</span><span class="participant-meta">spec</span>`;
    participants_list.appendChild(item);
  }
}
function update_deadline() {
  if (deadline_at <= 0) {
    status_deadline.textContent = "--:--";
    return;
  }
  const remaining = Math.max(0, deadline_at - Date.now());
  const minutes = Math.floor(remaining / 6e4);
  const seconds = Math.floor(remaining % 6e4 / 1e3);
  status_deadline.textContent = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}
function show_warning(message) {
  config_warning.textContent = message;
}
function clear_warning() {
  config_warning.textContent = "";
}
function load_json(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function save_json(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
  }
}
function load_profile() {
  const parsed = load_json(profile_key, null);
  if (parsed && typeof parsed === "object" && parsed.monsters) {
    return { monsters: parsed.monsters };
  }
  return { monsters: {} };
}
var profile = load_profile();
function save_profile() {
  save_json(profile_key, profile);
}
function load_team_selection() {
  const parsed = load_json(team_key, null);
  if (parsed && Array.isArray(parsed.selected)) {
    selected.splice(0, selected.length, ...parsed.selected.filter((id) => roster_by_id.has(id)));
  }
}
function save_team_selection() {
  save_json(team_key, { selected: selected.slice() });
}
function normalize_passive_id(passive) {
  return passive === "regen_5pct" ? "leftovers" : passive;
}
function coerce_config(spec, value) {
  const base = {
    moves: spec.defaultMoves.slice(0, 4),
    passive: spec.defaultPassive,
    stats: { ...spec.stats }
  };
  if (!value) {
    return base;
  }
  const moves = Array.isArray(value.moves) ? value.moves.slice(0, 4) : base.moves.slice();
  while (moves.length < 4) {
    moves.push("none");
  }
  const allowed = new Set(spec.possibleMoves);
  for (let i = 0; i < moves.length; i++) {
    if (!allowed.has(moves[i])) {
      moves[i] = "none";
    }
  }
  const allowed_passives = new Set(spec.possiblePassives.map(normalize_passive_id));
  let passive = normalize_passive_id(value.passive || base.passive);
  const fallback_passive = normalize_passive_id(base.passive);
  if (!allowed_passives.has(passive)) {
    passive = allowed_passives.has(fallback_passive) ? fallback_passive : "none";
  }
  return {
    moves,
    passive,
    stats: { ...base.stats, ...value.stats || {} }
  };
}
function get_config(monster_id) {
  const spec = roster_by_id.get(monster_id);
  if (!spec) {
    throw new Error(`Missing monster spec: ${monster_id}`);
  }
  const config = coerce_config(spec, profile.monsters[monster_id]);
  profile.monsters[monster_id] = config;
  save_profile();
  return config;
}
function update_roster_count() {
  roster_count.textContent = `${selected.length}/3`;
}
function set_slot_card(index, card, img, name_el) {
  const id = selected[index];
  card.classList.toggle("show-badge", index === 0);
  if (!id) {
    card.classList.add("empty");
    card.classList.remove("active");
    img.classList.add("hidden");
    img.removeAttribute("src");
    img.alt = "";
    name_el.textContent = "empty";
    return;
  }
  card.classList.remove("empty");
  card.classList.toggle("active", id === active_tab);
  img.classList.remove("hidden");
  img.src = icon_path(id);
  img.alt = monster_label(id);
  name_el.textContent = monster_label(id);
}
function update_slots() {
  set_slot_card(0, slot_active, slot_active_img, slot_active_name);
  set_slot_card(1, slot_bench_a, slot_bench_a_img, slot_bench_a_name);
  set_slot_card(2, slot_bench_b, slot_bench_b_img, slot_bench_b_name);
}
function render_tabs() {
  if (monster_tabs) {
    monster_tabs.innerHTML = "";
  }
  if (selected.length === 0) {
    active_tab = null;
    render_config();
    return;
  }
  if (!active_tab || !selected.includes(active_tab)) {
    active_tab = selected[0];
  }
  render_config();
}
function render_config() {
  moves_grid.innerHTML = "";
  passive_grid.innerHTML = "";
  stats_grid.innerHTML = "";
  if (!active_tab) {
    show_warning("Select 3 monsters to configure.");
    return;
  }
  clear_warning();
  const spec = roster_by_id.get(active_tab);
  if (!spec) {
    show_warning("Unknown monster.");
    return;
  }
  const config = get_config(active_tab);
  for (let i = 0; i < 4; i++) {
    const label = document.createElement("label");
    label.textContent = `Move ${i + 1}`;
    const select = document.createElement("select");
    select.dataset.index = `${i}`;
    for (const move of spec.possibleMoves) {
      const option = document.createElement("option");
      option.value = move;
      option.textContent = MOVE_LABELS[move] || move;
      select.appendChild(option);
    }
    select.value = config.moves[i] ?? "none";
    select.dataset.prev = select.value;
    select.disabled = is_ready && !match_started;
    select.addEventListener("change", () => {
      if (is_ready && !match_started) {
        select.value = select.dataset.prev || "none";
        return;
      }
      const idx = Number(select.dataset.index);
      const next = select.value;
      const prev = select.dataset.prev || "none";
      if (next !== "none") {
        const duplicate = config.moves.some((value, other) => other !== idx && value === next);
        if (duplicate) {
          select.value = prev;
          show_warning("Moves cannot repeat (except 'none').");
          return;
        }
      }
      config.moves[idx] = next;
      select.dataset.prev = next;
      clear_warning();
      save_profile();
      update_action_controls();
    });
    label.appendChild(select);
    moves_grid.appendChild(label);
  }
  const passive_label = document.createElement("label");
  passive_label.textContent = "Passive";
  const passive_select = document.createElement("select");
  for (const passive of spec.possiblePassives) {
    const option = document.createElement("option");
    option.value = passive;
    option.textContent = PASSIVE_LABELS[passive] || passive;
    passive_select.appendChild(option);
  }
  passive_select.value = config.passive;
  passive_select.disabled = is_ready && !match_started;
  passive_select.addEventListener("change", () => {
    if (is_ready && !match_started) return;
    config.passive = passive_select.value;
    save_profile();
  });
  passive_label.appendChild(passive_select);
  passive_grid.appendChild(passive_label);
  const stat_fields = [
    ["level", "Level"],
    ["maxHp", "Max HP"],
    ["attack", "Attack"],
    ["defense", "Defense"],
    ["speed", "Speed"]
  ];
  for (const [key, label_text] of stat_fields) {
    const label = document.createElement("label");
    label.textContent = label_text;
    const input = document.createElement("input");
    input.type = "number";
    input.value = `${config.stats[key]}`;
    input.disabled = is_ready && !match_started;
    input.addEventListener("change", () => {
      if (is_ready && !match_started) return;
      const value = Number(input.value);
      if (!Number.isFinite(value)) {
        return;
      }
      config.stats[key] = value;
      save_profile();
    });
    label.appendChild(input);
    stats_grid.appendChild(label);
  }
}
function set_edit_target(index) {
  if (is_ready && !match_started) {
    return;
  }
  const id = selected[index];
  if (!id) {
    return;
  }
  active_tab = id;
  update_slots();
  render_config();
}
function toggle_selection(id) {
  if (is_ready && !match_started) {
    return;
  }
  const index = selected.indexOf(id);
  if (index >= 0) {
    selected.splice(index, 1);
    if (active_tab === id) {
      active_tab = selected[0] || null;
    }
    save_team_selection();
    update_roster_count();
    update_slots();
    render_tabs();
    render_config();
    render_roster();
    update_action_controls();
    return;
  }
  if (selected.length >= 3) {
    show_warning("Choose exactly 3 monsters.");
    return;
  }
  selected.push(id);
  active_tab = id;
  save_team_selection();
  update_roster_count();
  update_slots();
  render_tabs();
  render_config();
  render_roster();
  update_action_controls();
}
function render_roster() {
  const list = document.getElementById("roster-list");
  list.innerHTML = "";
  for (const entry of roster) {
    const card = document.createElement("div");
    const is_selected = selected.includes(entry.id);
    const is_disabled = !is_selected && selected.length >= 3 || is_ready && !match_started;
    card.className = `roster-card${is_selected ? " active" : ""}${is_disabled ? " disabled" : ""}`;
    card.innerHTML = `
      <div class="sprite" style="width:24px;height:24px;">
        <img src="${icon_path(entry.id)}" alt="${entry.name}" />
      </div>
      <div>
        <h4>${entry.name}</h4>
        <p>${entry.role}</p>
      </div>
    `;
    card.addEventListener("click", () => {
      if (is_disabled) return;
      toggle_selection(entry.id);
    });
    list.appendChild(card);
  }
}
function set_bench_slot(slot2, mon, index, enabled) {
  if (!mon || index === null || index < 0) {
    slot2.btn.classList.add("empty");
    slot2.btn.disabled = true;
    slot2.btn.removeAttribute("data-index");
    slot2.btn.title = "";
    slot2.img.removeAttribute("src");
    slot2.img.alt = "";
    slot2.img.style.display = "none";
    return;
  }
  slot2.btn.classList.remove("empty");
  slot2.btn.dataset.index = `${index}`;
  slot2.btn.title = monster_label(mon.id);
  slot2.btn.disabled = !enabled || mon.hp <= 0;
  slot2.img.src = icon_path(mon.id);
  slot2.img.alt = monster_label(mon.id);
  slot2.img.style.display = "";
}
function update_bench(state, viewer_slot) {
  const me = state.players[viewer_slot];
  const opp = state.players[viewer_slot === "player1" ? "player2" : "player1"];
  const my_bench = me.team.map((_, idx) => idx).filter((idx) => idx !== me.activeIndex);
  const opp_bench = opp.team.map((_, idx) => idx).filter((idx) => idx !== opp.activeIndex);
  const can_switch = !!slot && slot === viewer_slot && match_started && !is_spectator && (!!has_pending_switch() || !intent_locked && current_turn > 0);
  player_bench_slots.forEach((slot_el, i) => {
    const idx = my_bench[i] ?? null;
    const mon = idx !== null ? me.team[idx] : null;
    set_bench_slot(slot_el, mon, idx, can_switch);
  });
  enemy_bench_slots.forEach((slot_el, i) => {
    const idx = opp_bench[i] ?? null;
    const mon = idx !== null ? opp.team[idx] : null;
    set_bench_slot(slot_el, mon, idx, false);
  });
}
function update_action_controls() {
  const has_team = selected.length === 3;
  const pending_switch = has_pending_switch();
  const controls_disabled = !match_started || !slot || is_spectator || intent_locked || current_turn <= 0 || pending_switch;
  if (!has_team) {
    move_buttons.forEach((btn, index) => {
      btn.textContent = `Move ${index + 1}`;
      btn.disabled = true;
    });
    if (switch_btn) switch_btn.disabled = true;
    return;
  }
  const active_id = selected[0];
  const config = get_config(active_id);
  let protect_on_cooldown = false;
  let choice_band_locked_move = null;
  let active_moves = config.moves;
  if (latest_state && slot) {
    const active_state = latest_state.players[slot].team[latest_state.players[slot].activeIndex];
    protect_on_cooldown = active_state.protectCooldownTurns > 0;
    active_moves = active_state.chosenMoves;
    if (active_state.chosenPassive === "choice_band") {
      choice_band_locked_move = typeof active_state.choiceBandLockedMoveIndex === "number" ? active_state.choiceBandLockedMoveIndex : null;
    }
  }
  move_buttons.forEach((btn, index) => {
    const move = active_moves[index] ?? "none";
    const label = MOVE_LABELS[move] || move;
    const locked_by_choice_band = choice_band_locked_move !== null && index !== choice_band_locked_move;
    const is_locked_slot = choice_band_locked_move !== null && index === choice_band_locked_move;
    if (locked_by_choice_band) {
      btn.textContent = `${index + 1}. ${label} (Choice Band lock)`;
      btn.disabled = true;
    } else if (move === "protect" && protect_on_cooldown) {
      btn.textContent = is_locked_slot ? `${index + 1}. Protect (cooldown, locked)` : `${index + 1}. Protect (cooldown)`;
      btn.disabled = true;
    } else {
      btn.textContent = is_locked_slot ? `${index + 1}. ${label} (locked)` : `${index + 1}. ${label}`;
      btn.disabled = controls_disabled;
    }
  });
  if (switch_btn) {
    const switch_disabled = !match_started || !slot || is_spectator || !pending_switch && intent_locked || !pending_switch && current_turn <= 0;
    switch_btn.disabled = switch_disabled;
  }
  const show_surrender = match_started && !!slot && !is_spectator;
  surrender_btn.classList.toggle("hidden", !show_surrender);
  surrender_btn.disabled = !show_surrender;
  if (latest_state) {
    const viewer_slot = slot ?? (is_spectator ? "player1" : null);
    if (viewer_slot) {
      update_bench(latest_state, viewer_slot);
    }
  }
}
function has_pending_switch() {
  return !!(latest_state && slot && latest_state.pendingSwitch?.[slot]);
}
function can_send_intent() {
  if (current_turn <= 0) {
    append_log("turn not active yet");
    return false;
  }
  if (!slot) {
    append_log("slot not assigned");
    return false;
  }
  if (is_spectator) {
    return false;
  }
  if (intent_locked) {
    append_log("intent already locked");
    return false;
  }
  if (has_pending_switch()) {
    append_log("pending switch");
    return false;
  }
  return true;
}
function send_move_intent(moveIndex) {
  if (!can_send_intent()) return;
  post(room, { $: "intent", turn: current_turn, intent: { action: "use_move", moveIndex } });
  intent_locked = true;
  update_action_controls();
  append_log("intent sent");
}
function send_switch_intent(targetIndex) {
  if (has_pending_switch()) {
    post(room, { $: "forced_switch", targetIndex });
    close_switch_modal();
    return;
  }
  if (!can_send_intent()) return;
  post(room, { $: "intent", turn: current_turn, intent: { action: "switch", targetIndex } });
  intent_locked = true;
  update_action_controls();
  append_log("intent sent");
}
function send_surrender() {
  if (!match_started || is_spectator || !slot) return;
  post(room, { $: "surrender" });
}
function close_switch_modal() {
  switch_modal.classList.remove("open");
}
function open_switch_modal(mode = "intent") {
  if (!latest_state || !slot) return;
  if (mode === "intent" && !can_send_intent()) return;
  switch_options.innerHTML = "";
  const player = latest_state.players[slot];
  const active_index = player.activeIndex;
  const options = player.team.map((mon, index) => ({ mon, index })).filter((entry) => entry.index !== active_index);
  if (options.length === 0) {
    const msg = document.createElement("div");
    msg.textContent = "No available swaps";
    msg.style.fontSize = "11px";
    msg.style.color = "#9aa5b1";
    switch_options.appendChild(msg);
  } else {
    for (const entry of options) {
      const button = document.createElement("button");
      const is_alive = entry.mon.hp > 0;
      button.disabled = !is_alive;
      button.textContent = `${entry.mon.name}${is_alive ? "" : " (fainted)"}`;
      button.addEventListener("click", () => {
        if (mode === "intent") {
          if (!can_send_intent()) return;
          post(room, { $: "intent", turn: current_turn, intent: { action: "switch", targetIndex: entry.index } });
          intent_locked = true;
          update_action_controls();
          append_log("intent sent");
          close_switch_modal();
          return;
        }
        post(room, { $: "forced_switch", targetIndex: entry.index });
        close_switch_modal();
      });
      switch_options.appendChild(button);
    }
  }
  switch_modal.classList.add("open");
}
function build_team_selection() {
  if (selected.length !== 3) {
    show_warning("Select exactly 3 monsters before ready.");
    return null;
  }
  const monsters = selected.map((id) => {
    const config = get_config(id);
    return {
      id,
      moves: config.moves.slice(0, 4),
      passive: config.passive,
      stats: { ...config.stats }
    };
  });
  return { monsters, activeIndex: 0 };
}
function send_ready(next_ready) {
  if (match_started) {
    return;
  }
  if (next_ready) {
    const team = build_team_selection();
    if (!team) {
      return;
    }
    post(room, { $: "ready", ready: true, team });
  } else {
    if (!slot) {
      return;
    }
    post(room, { $: "ready", ready: false });
  }
}
function update_ready_ui() {
  if (status_ready) {
    status_ready.textContent = is_ready ? "ready" : "not ready";
    status_ready.className = `status-pill ${is_ready ? "ok" : "off"}`;
  }
  ready_btn.textContent = is_ready ? "Unready" : "Ready";
  ready_btn.disabled = match_started;
  if (match_started) {
    prematch_hint.textContent = "Match started.";
    return;
  }
  let hint = "Select 3 monsters, configure, then Ready.";
  if (is_ready) {
    hint = "Waiting for opponent...";
  } else if (opponent_ready) {
    hint = "Opponent is ready. Configure and click Ready.";
  } else if (is_spectator && !slot) {
    hint = "Spectator mode. Select 3 monsters and click Ready to join.";
  }
  prematch_hint.textContent = hint;
  render_roster();
  render_tabs();
  render_config();
}
function update_opponent_ui(opponent_ready2, opponent_name2) {
  if (!status_opponent) return;
  status_opponent.textContent = opponent_ready2 ? "ready" : opponent_name2 ? "waiting" : "offline";
  status_opponent.className = `status-pill ${opponent_ready2 ? "ok" : opponent_name2 ? "warn" : "off"}`;
}
function show_match_end(winner) {
  if (!match_end) return;
  const is_winner = winner && slot === winner;
  match_end_title.textContent = is_winner ? "Victory" : "Defeat";
  if (!winner) {
    match_end_title.textContent = "Match ended";
  }
  match_end_sub.textContent = winner ? `${winner} wins the match.` : "Match finished.";
  match_end.classList.add("open");
}
function handle_turn_start(data) {
  current_turn = data.turn;
  deadline_at = data.deadline_at;
  intent_locked = false;
  status_turn.textContent = `${current_turn}`;
  update_deadline();
  append_log(`turn ${current_turn} started`);
  close_switch_modal();
  if (!match_started) {
    match_started = true;
    prematch.style.display = "none";
    document.body.classList.remove("prematch-open");
  }
  update_action_controls();
}
function log_events(log) {
  for (const entry of log) {
    if (entry.type === "damage") {
      const data = entry.data;
      const attacker_slot = data?.slot;
      const damage = data?.damage;
      if (attacker_slot && typeof damage === "number") {
        const attacker_id = latest_state?.players[attacker_slot]?.team[latest_state.players[attacker_slot].activeIndex]?.id;
        const attacker_name = monster_label(attacker_id);
        const defender_name = monster_label(data?.target);
        append_chat(`${attacker_name} deu ${damage} de dano em ${defender_name}`);
        continue;
      }
    }
    append_log(entry.summary);
  }
}
function update_panels(state, opts) {
  const viewer_slot = slot ?? (is_spectator ? "player1" : null);
  if (!viewer_slot) return;
  const me = state.players[viewer_slot];
  const opp = state.players[viewer_slot === "player1" ? "player2" : "player1"];
  const my_active = me.team[me.activeIndex];
  const opp_active = opp.team[opp.activeIndex];
  player_title.textContent = me.name || player_name;
  if (!opts?.skipMeta?.player) {
    player_meta.textContent = `Lv ${my_active.level} \xB7 HP ${my_active.hp}/${my_active.maxHp}`;
  }
  if (!opts?.skipBar?.player) {
    player_hp.style.width = `${Math.max(0, Math.min(1, my_active.hp / my_active.maxHp)) * 100}%`;
  }
  player_sprite.src = icon_path(my_active.id);
  player_sprite.alt = monster_label(my_active.id);
  player_sprite.title = monster_label(my_active.id);
  enemy_title.textContent = opp.name || "Opponent";
  if (!opts?.skipMeta?.enemy) {
    enemy_meta.textContent = `Lv ${opp_active.level} \xB7 HP ${opp_active.hp}/${opp_active.maxHp}`;
  }
  if (!opts?.skipBar?.enemy) {
    enemy_hp.style.width = `${Math.max(0, Math.min(1, opp_active.hp / opp_active.maxHp)) * 100}%`;
  }
  enemy_sprite.src = icon_path(opp_active.id);
  enemy_sprite.alt = monster_label(opp_active.id);
  enemy_sprite.title = monster_label(opp_active.id);
  update_bench(state, viewer_slot);
}
function animate_hp_text(side, level, from, to, maxHp, delay = 180) {
  const target = side === "player" ? player_meta : enemy_meta;
  const start = performance.now();
  const duration = 260;
  const raf_key = side;
  if (hp_animation[raf_key]) {
    cancelAnimationFrame(hp_animation[raf_key]);
  }
  const tick = (now2) => {
    const elapsed = now2 - start;
    if (elapsed < delay) {
      hp_animation[raf_key] = requestAnimationFrame(tick);
      return;
    }
    const t = Math.min(1, (elapsed - delay) / duration);
    const value = Math.round(from + (to - from) * t);
    target.textContent = `Lv ${level} \xB7 HP ${value}/${maxHp}`;
    if (t < 1) {
      hp_animation[raf_key] = requestAnimationFrame(tick);
    }
  };
  hp_animation[raf_key] = requestAnimationFrame(tick);
}
function clear_animation_timers() {
  while (animation_timers.length) {
    const id = animation_timers.pop();
    if (id !== void 0) {
      clearTimeout(id);
    }
  }
  reset_sprite_fx();
}
function schedule_animation(fn, delay) {
  const id = window.setTimeout(fn, delay);
  animation_timers.push(id);
}
function side_from_slot(viewer_slot, slot_id) {
  if (!viewer_slot) {
    return slot_id === "player1" ? "player" : "enemy";
  }
  return slot_id === viewer_slot ? "player" : "enemy";
}
function build_visual_steps(prev_state, log, viewer_slot) {
  const temp = JSON.parse(JSON.stringify(prev_state));
  const steps = [];
  for (const entry of log) {
    if (entry.type === "switch" || entry.type === "forced_switch") {
      const data = entry.data;
      if (!data || !data.slot || typeof data.to !== "number") continue;
      temp.players[data.slot].activeIndex = data.to;
      continue;
    }
    if (entry.type === "protect") {
      const data = entry.data;
      if (!data?.slot) continue;
      const side = side_from_slot(viewer_slot, data.slot);
      steps.push({ kind: "shield_on", side });
      continue;
    }
    if (entry.type === "damage_blocked") {
      const data = entry.data;
      if (!data?.slot) continue;
      const defenderSide2 = side_from_slot(viewer_slot, data.slot);
      const attackerSide2 = defenderSide2 === "player" ? "enemy" : "player";
      steps.push({ kind: "shield_hit", attackerSide: attackerSide2, defenderSide: defenderSide2 });
      continue;
    }
    if (entry.type === "passive_heal") {
      const data = entry.data;
      if (!data?.slot) continue;
      const side = side_from_slot(viewer_slot, data.slot);
      steps.push({ kind: "heal", side });
      continue;
    }
    if (entry.type !== "damage" && entry.type !== "recoil") continue;
    const payload = entry.data;
    if (!payload || typeof payload.damage !== "number" || payload.damage <= 0 || !payload.slot) {
      continue;
    }
    const defender_slot = entry.type === "recoil" ? payload.slot : payload.slot === "player1" ? "player2" : "player1";
    const defender_player = temp.players[defender_slot];
    const defender = defender_player.team[defender_player.activeIndex];
    const from = defender.hp;
    const to = Math.max(0, from - payload.damage);
    defender.hp = to;
    const defenderSide = side_from_slot(viewer_slot, defender_slot);
    const attackerSide = entry.type === "recoil" ? defenderSide : defenderSide === "player" ? "enemy" : "player";
    steps.push({
      kind: "damage",
      attackerSide,
      defenderSide,
      from,
      to,
      level: defender.level,
      maxHp: defender.maxHp
    });
  }
  return steps;
}
function animate_hp_bar(bar, from, to) {
  bar.classList.remove("hp-anim");
  bar.style.transition = "none";
  bar.style.width = `${from}%`;
  void bar.offsetWidth;
  bar.style.transition = "";
  bar.classList.add("hp-anim");
  bar.style.width = `${to}%`;
  window.setTimeout(() => {
    bar.classList.remove("hp-anim");
  }, 450);
}
function sprite_wrap(side) {
  return side === "player" ? player_sprite_wrap : enemy_sprite_wrap;
}
function reset_sprite_fx() {
  [player_sprite_wrap, enemy_sprite_wrap].forEach((wrap) => {
    sprite_fx_classes.forEach((fx) => wrap.classList.remove(fx));
    wrap.style.transform = "";
  });
}
function trigger_class(el, className, duration) {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
  window.setTimeout(() => {
    el.classList.remove(className);
  }, duration);
}
function handle_state(data) {
  const prev_state = latest_state;
  clear_animation_timers();
  const viewer_slot = slot ?? (is_spectator ? "player1" : null);
  const steps = prev_state ? build_visual_steps(prev_state, data.log, viewer_slot) : [];
  const hit_sides = new Set(
    steps.filter((step) => step.kind === "damage").map((step) => step.defenderSide)
  );
  latest_state = data.state;
  if (!match_started && data.state.status === "running") {
    match_started = true;
    prematch.style.display = "none";
    document.body.classList.remove("prematch-open");
  }
  update_panels(data.state, {
    skipMeta: {
      player: hit_sides.has("player"),
      enemy: hit_sides.has("enemy")
    },
    skipBar: {
      player: hit_sides.has("player"),
      enemy: hit_sides.has("enemy")
    }
  });
  if (steps.length > 0) {
    let cursor = 0;
    for (const step of steps) {
      const duration = step.kind === "damage" ? 650 : step.kind === "shield_hit" ? 420 : step.kind === "shield_on" ? 360 : 320;
      schedule_animation(() => {
        if (step.kind === "damage") {
          const attacker_wrap = sprite_wrap(step.attackerSide);
          const defender_wrap = sprite_wrap(step.defenderSide);
          trigger_class(attacker_wrap, "jump", 300);
          trigger_class(defender_wrap, "hit", 420);
          const bar = step.defenderSide === "player" ? player_hp : enemy_hp;
          const from_percent = Math.max(0, Math.min(1, step.from / step.maxHp)) * 100;
          const to_percent = Math.max(0, Math.min(1, step.to / step.maxHp)) * 100;
          animate_hp_bar(bar, from_percent, to_percent);
          animate_hp_text(step.defenderSide, step.level, step.from, step.to, step.maxHp, 180);
          return;
        }
        if (step.kind === "shield_on") {
          const wrap = sprite_wrap(step.side);
          trigger_class(wrap, "shield-on", 400);
          return;
        }
        if (step.kind === "shield_hit") {
          const attacker_wrap = sprite_wrap(step.attackerSide);
          const defender_wrap = sprite_wrap(step.defenderSide);
          trigger_class(attacker_wrap, "jump", 300);
          trigger_class(defender_wrap, "shield-hit", 450);
          return;
        }
        if (step.kind === "heal") {
          const wrap = sprite_wrap(step.side);
          trigger_class(wrap, "heal", 360);
        }
      }, cursor);
      cursor += duration;
    }
    schedule_animation(() => {
      update_panels(data.state);
    }, cursor + 50);
  } else {
    update_panels(data.state);
  }
  close_switch_modal();
  if (data.log.length) {
    log_events(data.log);
  }
  update_action_controls();
  if (data.state.status === "ended") {
    show_match_end(data.state.winner);
  }
  if (slot && data.state.pendingSwitch?.[slot] && !switch_modal.classList.contains("open")) {
    open_switch_modal("forced");
  }
}
function handle_post(message) {
  const data = message.data;
  switch (data.$) {
    case "assign":
      slot = data.slot;
      is_spectator = false;
      if (status_slot) status_slot.textContent = data.slot;
      if (status_conn) status_conn.textContent = "synced";
      player_meta.textContent = `Slot ${data.slot}`;
      if (data.token) {
        localStorage.setItem(token_key, data.token);
        stored_token = data.token;
      }
      append_log(`assigned ${data.slot}`);
      append_chat(`${data.name} assigned to ${data.slot}`);
      return;
    case "ready_state": {
      const previous = last_ready_snapshot ?? { player1: false, player2: false };
      last_ready_snapshot = { ...data.ready };
      participants = {
        players: { ...data.names },
        spectators: participants ? participants.spectators.slice() : []
      };
      if (Array.isArray(data.order)) {
        ready_order = data.order.slice();
      } else {
        PLAYER_SLOTS.forEach((slot_id) => {
          const is_ready_now = data.ready[slot_id];
          const idx = ready_order.indexOf(slot_id);
          if (is_ready_now && idx === -1) {
            ready_order.push(slot_id);
          } else if (!is_ready_now && idx !== -1) {
            ready_order.splice(idx, 1);
          }
        });
      }
      PLAYER_SLOTS.forEach((slot_id) => {
        if (previous[slot_id] !== data.ready[slot_id]) {
          const name = data.names[slot_id];
          if (name) {
            append_chat(data.ready[slot_id] ? `${name} is ready` : `${name} is waiting`);
          }
        }
      });
      if (slot) {
        const opponent_slot = slot === "player1" ? "player2" : "player1";
        is_ready = data.ready[slot];
        opponent_ready = data.ready[opponent_slot];
        opponent_name = data.names[opponent_slot];
        update_opponent_ui(opponent_ready, opponent_name);
      }
      update_ready_ui();
      render_participants();
      return;
    }
    case "turn_start":
      handle_turn_start(data);
      return;
    case "intent_locked":
      append_log(`${data.slot} locked intent for turn ${data.turn}`);
      if (slot && data.slot === slot) {
        intent_locked = true;
        update_action_controls();
      }
      return;
    case "state":
      handle_state(data);
      return;
    case "surrender":
      if ("loser" in data) {
        append_log(`surrender: ${data.loser}`);
        append_chat(`${data.loser} surrendered`);
      } else {
        append_log("surrender");
      }
      return;
    case "error":
      append_log(`error: ${data.message}`);
      show_warning(data.message);
      append_chat(`error: ${data.message}`);
      return;
    case "join":
      append_log(`join: ${data.name}`);
      append_chat(`${data.name} joined the room`);
      return;
    case "spectator":
      is_spectator = true;
      if (status_slot) status_slot.textContent = "spectator";
      update_ready_ui();
      return;
    case "chat":
      append_chat(`${data.from}: ${data.message}`);
      return;
    case "participants":
      participants = { players: data.players, spectators: data.spectators.slice() };
      render_participants();
      return;
    case "intent":
      append_log(`intent received for turn ${data.turn}`);
      return;
  }
}
move_buttons.forEach((btn, index) => {
  btn.addEventListener("click", () => {
    send_move_intent(index);
  });
});
if (switch_btn) {
  switch_btn.addEventListener("click", () => {
    open_switch_modal(has_pending_switch() ? "forced" : "intent");
  });
}
surrender_btn.addEventListener("click", () => {
  send_surrender();
});
switch_close.addEventListener("click", () => {
  close_switch_modal();
});
switch_modal.addEventListener("click", (event) => {
  if (event.target === switch_modal) {
    close_switch_modal();
  }
});
ready_btn.addEventListener("click", () => {
  if (match_started) {
    return;
  }
  if (is_ready) {
    send_ready(false);
  } else {
    send_ready(true);
  }
});
match_end_btn.addEventListener("click", () => {
  window.location.reload();
});
slot_active.addEventListener("click", () => {
  set_edit_target(0);
});
slot_bench_a.addEventListener("click", () => {
  set_edit_target(1);
});
slot_bench_b.addEventListener("click", () => {
  set_edit_target(2);
});
player_bench_slots.forEach((slot_el) => {
  slot_el.btn.addEventListener("click", () => {
    const index = Number(slot_el.btn.dataset.index);
    if (!Number.isFinite(index)) return;
    send_switch_intent(index);
  });
});
setInterval(update_deadline, 1e3);
setInterval(() => {
  const rtt = ping();
  if (isFinite(rtt)) {
    status_ping.textContent = `${Math.round(rtt)} ms`;
  } else {
    status_ping.textContent = "--";
  }
}, 1e3);
load_team_selection();
render_roster();
render_tabs();
render_config();
update_roster_count();
update_slots();
update_action_controls();
on_open(() => {
  if (status_conn) status_conn.textContent = "connected";
  watch(room, handle_post);
  load(room, 0);
  post(room, { $: "join", name: player_name, token: stored_token });
  setup_chat_input(chat_input, chat_send);
});
on_sync(() => {
  if (status_conn) status_conn.textContent = "synced";
});
