// node_modules/vibinet/dist/index.js
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => (key in obj) ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var MAX_SAFE_BITS = 53;
var text_decoder = new TextDecoder;
var union_cache = /* @__PURE__ */ new WeakMap;
var struct_cache = /* @__PURE__ */ new WeakMap;
var BitWriter = class {
  constructor(buf) {
    __publicField(this, "buf");
    __publicField(this, "bit_pos");
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
    if (bits === 0)
      return;
    if (typeof value === "number") {
      if (bits <= 32) {
        const aligned = (this.bit_pos & 7) === 0 && (bits & 7) === 0;
        if (aligned) {
          let v2 = value >>> 0;
          let byte_index = this.bit_pos >>> 3;
          for (let i = 0;i < bits; i += 8) {
            this.buf[byte_index++] = v2 & 255;
            v2 >>>= 8;
          }
          this.bit_pos += bits;
          return;
        }
        let v = value >>> 0;
        for (let i = 0;i < bits; i++) {
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
    if (bits === 0)
      return;
    const aligned = (this.bit_pos & 7) === 0 && (bits & 7) === 0;
    if (aligned) {
      let v2 = value;
      let byte_index = this.bit_pos >>> 3;
      for (let i = 0;i < bits; i += 8) {
        this.buf[byte_index++] = Number(v2 & 0xffn);
        v2 >>= 8n;
      }
      this.bit_pos += bits;
      return;
    }
    let v = value;
    for (let i = 0;i < bits; i++) {
      this.write_bit((v & 1n) === 0n ? 0 : 1);
      v >>= 1n;
    }
  }
};
var BitReader = class {
  constructor(buf) {
    __publicField(this, "buf");
    __publicField(this, "bit_pos");
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
    if (bits === 0)
      return 0;
    if (bits <= 32) {
      const aligned = (this.bit_pos & 7) === 0 && (bits & 7) === 0;
      if (aligned) {
        let v2 = 0;
        let shift = 0;
        let byte_index = this.bit_pos >>> 3;
        for (let i = 0;i < bits; i += 8) {
          v2 |= this.buf[byte_index++] << shift;
          shift += 8;
        }
        this.bit_pos += bits;
        return v2 >>> 0;
      }
      let v = 0;
      for (let i = 0;i < bits; i++) {
        if (this.read_bit()) {
          v |= 1 << i;
        }
      }
      return v >>> 0;
    }
    if (bits <= MAX_SAFE_BITS) {
      let v = 0;
      let pow = 1;
      for (let i = 0;i < bits; i++) {
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
    if (bits === 0)
      return 0n;
    const aligned = (this.bit_pos & 7) === 0 && (bits & 7) === 0;
    if (aligned) {
      let v2 = 0n;
      let shift = 0n;
      let byte_index = this.bit_pos >>> 3;
      for (let i = 0;i < bits; i += 8) {
        v2 |= BigInt(this.buf[byte_index++]) << shift;
        shift += 8n;
      }
      this.bit_pos += bits;
      return v2;
    }
    let v = 0n;
    let pow = 1n;
    for (let i = 0;i < bits; i++) {
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
  if (size < 0)
    throw new RangeError("size must be >= 0");
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
        if (val < 0n)
          throw new RangeError("Nat must be >= 0");
        if (val > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new RangeError("Nat too large to size");
        }
        return Number(val) + 1;
      }
      assert_integer(val, "Nat");
      if (val < 0)
        throw new RangeError("Nat must be >= 0");
      return val + 1;
    }
    case "Tuple": {
      const fields = type.fields;
      const arr = as_array(val, "Tuple");
      let bits = 0;
      for (let i = 0;i < fields.length; i++) {
        bits += size_bits(fields[i], arr[i]);
      }
      return bits;
    }
    case "Vector": {
      assert_size(type.size);
      const arr = as_array(val, "Vector");
      assert_vector_size(type.size, arr.length);
      let bits = 0;
      for (let i = 0;i < type.size; i++) {
        bits += size_bits(type.type, arr[i]);
      }
      return bits;
    }
    case "Struct": {
      let bits = 0;
      const keys = struct_keys(type.fields);
      for (let i = 0;i < keys.length; i++) {
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
        if (val === 0 || val === 0n)
          return;
        throw new RangeError("UInt out of range");
      }
      if (typeof val === "bigint") {
        if (val < 0n)
          throw new RangeError("UInt must be >= 0");
        const max2 = 1n << BigInt(type.size);
        if (val >= max2)
          throw new RangeError("UInt out of range");
        writer.write_bitsUnsigned(val, type.size);
        return;
      }
      assert_integer(val, "UInt");
      if (val < 0)
        throw new RangeError("UInt must be >= 0");
      if (type.size > MAX_SAFE_BITS) {
        throw new RangeError("UInt too large for number; use bigint");
      }
      const max = 2 ** type.size;
      if (val >= max)
        throw new RangeError("UInt out of range");
      writer.write_bitsUnsigned(val, type.size);
      return;
    }
    case "Int": {
      assert_size(type.size);
      if (type.size === 0) {
        if (val === 0 || val === 0n)
          return;
        throw new RangeError("Int out of range");
      }
      if (typeof val === "bigint") {
        const size = BigInt(type.size);
        const min2 = -(1n << size - 1n);
        const max2 = (1n << size - 1n) - 1n;
        if (val < min2 || val > max2)
          throw new RangeError("Int out of range");
        let unsigned2 = val;
        if (val < 0n)
          unsigned2 = (1n << size) + val;
        writer.write_bitsUnsigned(unsigned2, type.size);
        return;
      }
      assert_integer(val, "Int");
      if (type.size > MAX_SAFE_BITS) {
        throw new RangeError("Int too large for number; use bigint");
      }
      const min = -(2 ** (type.size - 1));
      const max = 2 ** (type.size - 1) - 1;
      if (val < min || val > max)
        throw new RangeError("Int out of range");
      let unsigned = val;
      if (val < 0)
        unsigned = 2 ** type.size + val;
      writer.write_bitsUnsigned(unsigned, type.size);
      return;
    }
    case "Nat": {
      if (typeof val === "bigint") {
        if (val < 0n)
          throw new RangeError("Nat must be >= 0");
        let n = val;
        while (n > 0n) {
          writer.write_bit(1);
          n -= 1n;
        }
        writer.write_bit(0);
        return;
      }
      assert_integer(val, "Nat");
      if (val < 0)
        throw new RangeError("Nat must be >= 0");
      for (let i = 0;i < val; i++) {
        writer.write_bit(1);
      }
      writer.write_bit(0);
      return;
    }
    case "Tuple": {
      const fields = type.fields;
      const arr = as_array(val, "Tuple");
      for (let i = 0;i < fields.length; i++) {
        encode_into(writer, fields[i], arr[i]);
      }
      return;
    }
    case "Vector": {
      assert_size(type.size);
      const arr = as_array(val, "Vector");
      assert_vector_size(type.size, arr.length);
      for (let i = 0;i < type.size; i++) {
        encode_into(writer, type.type, arr[i]);
      }
      return;
    }
    case "Struct": {
      const keys = struct_keys(type.fields);
      for (let i = 0;i < keys.length; i++) {
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
      if (index === undefined) {
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
      if (type.size === 0)
        return 0;
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
      for (let i = 0;i < type.fields.length; i++) {
        out[i] = decode_from(reader, type.fields[i]);
      }
      return out;
    }
    case "Vector": {
      const out = new Array(type.size);
      for (let i = 0;i < type.size; i++) {
        out[i] = decode_from(reader, type.type);
      }
      return out;
    }
    case "Struct": {
      const out = {};
      const keys = struct_keys(type.fields);
      for (let i = 0;i < keys.length; i++) {
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
      const out = /* @__PURE__ */ new Map;
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
  if (cached)
    return cached;
  const keys = Object.keys(type.variants).sort();
  if (keys.length === 0) {
    throw new RangeError("Union must have at least one variant");
  }
  const index_by_tag = /* @__PURE__ */ new Map;
  for (let i = 0;i < keys.length; i++) {
    index_by_tag.set(keys[i], i);
  }
  const tag_bits = keys.length <= 1 ? 0 : Math.ceil(Math.log2(keys.length));
  const info = { keys, index_by_tag, tag_bits };
  union_cache.set(type, info);
  return info;
}
function struct_keys(fields) {
  const cached = struct_cache.get(fields);
  if (cached)
    return cached;
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
  for (let i = 0;i < val.length; i++) {
    fn(val[i]);
  }
}
function for_each_map(val, fn) {
  if (val == null)
    return;
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
  for (let i = 0;i < value.length; i++) {
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
  for (let i = 0;i < value.length; i++) {
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
    },
    get_latest_post_index: {
      $: "Struct",
      fields: {
        room: { $: "String" }
      }
    },
    info_latest_post_index: {
      $: "Struct",
      fields: {
        room: { $: "String" },
        latest_index: { $: "Int", size: 32 },
        server_time: { $: "UInt", size: TIME_BITS }
      }
    }
  }
};
function bytes_to_list(bytes) {
  const out = new Array(bytes.length);
  for (let i = 0;i < bytes.length; i++) {
    out[i] = bytes[i];
  }
  return out;
}
function list_to_bytes(list) {
  const out = new Uint8Array(list.length);
  for (let i = 0;i < list.length; i++) {
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
    console.warn(`[VibiNet] Upgrading insecure WebSocket URL "${ws_url}" to "${upgraded}" because the page is HTTPS.`);
    return upgraded;
  }
  return ws_url;
}
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
    for (let i = 0;i < 8; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let out = "";
  for (let i = 0;i < 8; i++) {
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
  const room_watchers = /* @__PURE__ */ new Map;
  const watched_rooms = /* @__PURE__ */ new Set;
  const latest_post_index_listeners = [];
  let is_synced = false;
  const sync_listeners = [];
  let heartbeat_id = null;
  let reconnect_timer_id = null;
  let reconnect_attempt = 0;
  let manual_close = false;
  let ws = null;
  const pending_posts = [];
  const ws_url = normalize_ws_url(server ?? default_ws_url());
  function server_time() {
    if (!isFinite(time_sync.clock_offset)) {
      throw new Error("server_time() called before initial sync");
    }
    return Math.floor(now() + time_sync.clock_offset);
  }
  function clear_heartbeat() {
    if (heartbeat_id !== null) {
      clearInterval(heartbeat_id);
      heartbeat_id = null;
    }
  }
  function clear_reconnect_timer() {
    if (reconnect_timer_id !== null) {
      clearTimeout(reconnect_timer_id);
      reconnect_timer_id = null;
    }
  }
  function reconnect_delay_ms() {
    const base = 500;
    const cap = 8000;
    const expo = Math.min(cap, base * Math.pow(2, reconnect_attempt));
    const jitter = Math.floor(Math.random() * 250);
    return expo + jitter;
  }
  function flush_pending_posts_if_open() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    while (pending_posts.length > 0) {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return;
      }
      const next = pending_posts[0];
      try {
        ws.send(next);
        pending_posts.shift();
      } catch {
        connect();
        return;
      }
    }
  }
  function send_time_request_if_open() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    time_sync.request_sent_at = now();
    ws.send(encode_message({ $: "get_time" }));
  }
  function try_send(buf) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      ws.send(buf);
      return true;
    } catch {
      return false;
    }
  }
  function send_or_reconnect(buf) {
    if (try_send(buf)) {
      return;
    }
    connect();
  }
  function queue_post(buf) {
    pending_posts.push(buf);
    connect();
  }
  function register_handler(room, packer, handler) {
    const existing = room_watchers.get(room);
    if (existing) {
      if (existing.packer !== packer) {
        throw new Error(`Packed schema already registered for room: ${room}`);
      }
      if (handler) {
        existing.handler = handler;
      }
      return;
    }
    room_watchers.set(room, { handler, packer });
  }
  function schedule_reconnect() {
    if (manual_close || reconnect_timer_id !== null) {
      return;
    }
    const delay = reconnect_delay_ms();
    reconnect_timer_id = setTimeout(() => {
      reconnect_timer_id = null;
      reconnect_attempt += 1;
      connect();
    }, delay);
  }
  function connect() {
    if (manual_close) {
      return;
    }
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    clear_reconnect_timer();
    const socket = new WebSocket(ws_url);
    ws = socket;
    socket.binaryType = "arraybuffer";
    socket.addEventListener("open", () => {
      if (ws !== socket) {
        return;
      }
      reconnect_attempt = 0;
      console.log("[WS] Connected");
      send_time_request_if_open();
      clear_heartbeat();
      for (const room of watched_rooms.values()) {
        socket.send(encode_message({ $: "watch", room }));
      }
      flush_pending_posts_if_open();
      heartbeat_id = setInterval(send_time_request_if_open, 2000);
    });
    socket.addEventListener("message", (event) => {
      const data = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : new Uint8Array(event.data);
      const msg = decode_message(data);
      switch (msg.$) {
        case "info_time": {
          const t = now();
          const ping = t - time_sync.request_sent_at;
          time_sync.last_ping = ping;
          if (ping < time_sync.lowest_ping) {
            const local_avg = Math.floor((time_sync.request_sent_at + t) / 2);
            time_sync.clock_offset = msg.time - local_avg;
            time_sync.lowest_ping = ping;
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
          const watcher = room_watchers.get(msg.room);
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
        case "info_latest_post_index": {
          for (const cb of latest_post_index_listeners) {
            cb({
              room: msg.room,
              latest_index: msg.latest_index,
              server_time: msg.server_time
            });
          }
          break;
        }
      }
    });
    socket.addEventListener("close", (event) => {
      if (ws !== socket) {
        return;
      }
      clear_heartbeat();
      ws = null;
      if (manual_close) {
        return;
      }
      console.warn(`[WS] Disconnected (code=${event.code}); reconnecting...`);
      schedule_reconnect();
    });
    socket.addEventListener("error", () => {});
  }
  connect();
  return {
    on_sync: (callback) => {
      if (is_synced) {
        callback();
        return;
      }
      sync_listeners.push(callback);
    },
    watch: (room, packer, handler) => {
      register_handler(room, packer, handler);
      watched_rooms.add(room);
      send_or_reconnect(encode_message({ $: "watch", room }));
    },
    load: (room, from, packer, handler) => {
      register_handler(room, packer, handler);
      send_or_reconnect(encode_message({ $: "load", room, from }));
    },
    get_latest_post_index: (room) => {
      send_or_reconnect(encode_message({ $: "get_latest_post_index", room }));
    },
    on_latest_post_index: (callback) => {
      latest_post_index_listeners.push(callback);
    },
    post: (room, data, packer) => {
      const name = gen_name();
      const payload = encode(packer, data);
      const message = encode_message({ $: "post", room, time: server_time(), name, payload });
      if (pending_posts.length > 0) {
        flush_pending_posts_if_open();
      }
      if (!try_send(message)) {
        queue_post(message);
      }
      return name;
    },
    server_time,
    ping: () => time_sync.last_ping,
    close: () => {
      manual_close = true;
      clear_reconnect_timer();
      clear_heartbeat();
      if (ws && ws.readyState === WebSocket.OPEN) {
        for (const room of watched_rooms.values()) {
          try {
            ws.send(encode_message({ $: "unwatch", room }));
          } catch {
            break;
          }
        }
      }
      if (ws) {
        ws.close();
      }
      ws = null;
    },
    debug_dump: () => ({
      ws_url,
      ws_ready_state: ws ? ws.readyState : WebSocket.CLOSED,
      is_synced,
      reconnect_attempt,
      reconnect_scheduled: reconnect_timer_id !== null,
      pending_post_count: pending_posts.length,
      watched_rooms: Array.from(watched_rooms.values()),
      room_watchers: Array.from(room_watchers.keys()),
      room_watcher_count: room_watchers.size,
      latest_post_index_listener_count: latest_post_index_listeners.length,
      sync_listener_count: sync_listeners.length,
      time_sync: {
        clock_offset: time_sync.clock_offset,
        lowest_ping: time_sync.lowest_ping,
        request_sent_at: time_sync.request_sent_at,
        last_ping: time_sync.last_ping
      }
    })
  };
}
var _VibiNet = class _VibiNet2 {
  constructor(options) {
    __publicField(this, "room");
    __publicField(this, "init");
    __publicField(this, "on_tick");
    __publicField(this, "on_post");
    __publicField(this, "packer");
    __publicField(this, "smooth");
    __publicField(this, "tick_rate");
    __publicField(this, "tolerance");
    __publicField(this, "client_api");
    __publicField(this, "remote_posts");
    __publicField(this, "local_posts");
    __publicField(this, "timeline");
    __publicField(this, "cache_enabled");
    __publicField(this, "snapshot_stride");
    __publicField(this, "snapshot_count");
    __publicField(this, "snapshots");
    __publicField(this, "snapshot_start_tick");
    __publicField(this, "initial_time_value");
    __publicField(this, "initial_tick_value");
    __publicField(this, "no_pending_posts_before_ms");
    __publicField(this, "max_contiguous_remote_index");
    __publicField(this, "cache_drop_guard_hits");
    __publicField(this, "latest_index_poll_interval_id");
    __publicField(this, "max_remote_index");
    const default_smooth = (remote, _local) => remote;
    const smooth = options.smooth ?? default_smooth;
    const cache = options.cache ?? true;
    const snapshot_stride = options.snapshot_stride ?? 8;
    const snapshot_count = options.snapshot_count ?? 256;
    const client_api = options.client ?? create_client(options.server);
    this.room = options.room;
    this.init = options.initial;
    this.on_tick = options.on_tick;
    this.on_post = options.on_post;
    this.packer = options.packer;
    this.smooth = smooth;
    this.tick_rate = options.tick_rate;
    this.tolerance = options.tolerance;
    this.client_api = client_api;
    this.remote_posts = /* @__PURE__ */ new Map;
    this.local_posts = /* @__PURE__ */ new Map;
    this.timeline = /* @__PURE__ */ new Map;
    this.cache_enabled = cache;
    this.snapshot_stride = Math.max(1, Math.floor(snapshot_stride));
    this.snapshot_count = Math.max(1, Math.floor(snapshot_count));
    this.snapshots = /* @__PURE__ */ new Map;
    this.snapshot_start_tick = null;
    this.initial_time_value = null;
    this.initial_tick_value = null;
    this.no_pending_posts_before_ms = null;
    this.max_contiguous_remote_index = -1;
    this.cache_drop_guard_hits = 0;
    this.latest_index_poll_interval_id = null;
    this.max_remote_index = -1;
    if (this.client_api.on_latest_post_index) {
      this.client_api.on_latest_post_index((info) => {
        this.on_latest_post_index_info(info);
      });
    }
    this.client_api.on_sync(() => {
      console.log(`[VIBI] synced; loading+watching room=${this.room}`);
      const on_info_post = (post) => {
        if (post.name) {
          this.remove_local_post(post.name);
        }
        this.add_remote_post(post);
      };
      this.client_api.load(this.room, 0, this.packer, on_info_post);
      this.client_api.watch(this.room, this.packer, on_info_post);
      this.request_latest_post_index();
      if (this.latest_index_poll_interval_id !== null) {
        clearInterval(this.latest_index_poll_interval_id);
      }
      this.latest_index_poll_interval_id = setInterval(() => {
        this.request_latest_post_index();
      }, 2000);
    });
  }
  official_time(post) {
    if (post.client_time <= post.server_time - this.tolerance) {
      return post.server_time - this.tolerance;
    } else {
      return post.client_time;
    }
  }
  official_tick(post) {
    return this.time_to_tick(this.official_time(post));
  }
  get_bucket(tick) {
    let bucket = this.timeline.get(tick);
    if (!bucket) {
      bucket = { remote: [], local: [] };
      this.timeline.set(tick, bucket);
    }
    return bucket;
  }
  insert_remote_post(post, tick) {
    const bucket = this.get_bucket(tick);
    bucket.remote.push(post);
    bucket.remote.sort((a, b) => a.index - b.index);
  }
  invalidate_from_tick(tick) {
    if (!this.cache_enabled) {
      return;
    }
    const start_tick = this.snapshot_start_tick;
    if (start_tick !== null && tick < start_tick) {
      return;
    }
    if (start_tick === null || this.snapshots.size === 0) {
      return;
    }
    const stride = this.snapshot_stride;
    const end_tick = start_tick + (this.snapshots.size - 1) * stride;
    if (tick > end_tick) {
      return;
    }
    if (tick <= start_tick) {
      this.snapshots.clear();
      return;
    }
    for (let t = end_tick;t >= tick; t -= stride) {
      this.snapshots.delete(t);
    }
  }
  advance_state(state, from_tick, to_tick) {
    let next = state;
    for (let tick = from_tick + 1;tick <= to_tick; tick++) {
      next = this.apply_tick(next, tick);
    }
    return next;
  }
  prune_before_tick(prune_tick) {
    if (!this.cache_enabled) {
      return;
    }
    const safe_prune_tick = this.safe_prune_tick();
    if (safe_prune_tick !== null && prune_tick > safe_prune_tick) {
      this.cache_drop_guard_hits += 1;
      prune_tick = safe_prune_tick;
    }
    for (const tick of this.timeline.keys()) {
      if (tick < prune_tick) {
        this.timeline.delete(tick);
      }
    }
    for (const [index, post] of this.remote_posts.entries()) {
      if (this.official_tick(post) < prune_tick) {
        this.remote_posts.delete(index);
      }
    }
    for (const [name, post] of this.local_posts.entries()) {
      if (this.official_tick(post) < prune_tick) {
        this.local_posts.delete(name);
      }
    }
  }
  tick_ms() {
    return 1000 / this.tick_rate;
  }
  cache_window_ticks() {
    return this.snapshot_stride * Math.max(0, this.snapshot_count - 1);
  }
  safe_prune_tick() {
    if (this.no_pending_posts_before_ms === null) {
      return null;
    }
    return this.time_to_tick(this.no_pending_posts_before_ms);
  }
  safe_compute_tick(requested_tick) {
    if (!this.cache_enabled) {
      return requested_tick;
    }
    const safe_prune_tick = this.safe_prune_tick();
    if (safe_prune_tick === null) {
      return requested_tick;
    }
    const safe_tick = safe_prune_tick + this.cache_window_ticks();
    return Math.min(requested_tick, safe_tick);
  }
  advance_no_pending_posts_before_ms(candidate) {
    const bounded = Math.max(0, Math.floor(candidate));
    if (this.no_pending_posts_before_ms === null || bounded > this.no_pending_posts_before_ms) {
      this.no_pending_posts_before_ms = bounded;
    }
  }
  advance_contiguous_remote_frontier() {
    for (;; ) {
      const next_index = this.max_contiguous_remote_index + 1;
      const post = this.remote_posts.get(next_index);
      if (!post) {
        break;
      }
      this.max_contiguous_remote_index = next_index;
      this.advance_no_pending_posts_before_ms(this.official_time(post));
    }
  }
  on_latest_post_index_info(info) {
    if (info.room !== this.room) {
      return;
    }
    if (info.latest_index > this.max_contiguous_remote_index) {
      return;
    }
    const conservative_margin = this.tick_ms();
    const candidate = info.server_time - this.tolerance - conservative_margin;
    this.advance_no_pending_posts_before_ms(candidate);
  }
  request_latest_post_index() {
    if (!this.client_api.get_latest_post_index) {
      return;
    }
    try {
      this.client_api.get_latest_post_index(this.room);
    } catch {}
  }
  ensure_snapshots(at_tick, initial_tick) {
    if (!this.cache_enabled) {
      return;
    }
    if (this.snapshot_start_tick === null) {
      this.snapshot_start_tick = initial_tick;
    }
    let start_tick = this.snapshot_start_tick;
    if (start_tick === null) {
      return;
    }
    if (at_tick < start_tick) {
      return;
    }
    const stride = this.snapshot_stride;
    const target_tick = start_tick + Math.floor((at_tick - start_tick) / stride) * stride;
    let state;
    let current_tick;
    if (this.snapshots.size === 0) {
      state = this.init;
      current_tick = start_tick - 1;
    } else {
      const end_tick = start_tick + (this.snapshots.size - 1) * stride;
      state = this.snapshots.get(end_tick);
      current_tick = end_tick;
    }
    let next_tick = current_tick + stride;
    if (this.snapshots.size === 0) {
      next_tick = start_tick;
    }
    for (;next_tick <= target_tick; next_tick += stride) {
      state = this.advance_state(state, current_tick, next_tick);
      this.snapshots.set(next_tick, state);
      current_tick = next_tick;
    }
    const count = this.snapshots.size;
    if (count > this.snapshot_count) {
      const overflow = count - this.snapshot_count;
      const drop_until = start_tick + overflow * stride;
      for (let t = start_tick;t < drop_until; t += stride) {
        this.snapshots.delete(t);
      }
      start_tick = drop_until;
      this.snapshot_start_tick = start_tick;
    }
    this.prune_before_tick(start_tick);
  }
  add_remote_post(post) {
    const tick = this.official_tick(post);
    if (post.index === 0 && this.initial_time_value === null) {
      const t = this.official_time(post);
      this.initial_time_value = t;
      this.initial_tick_value = this.time_to_tick(t);
    }
    if (this.remote_posts.has(post.index)) {
      return;
    }
    const before_window = this.cache_enabled && this.snapshot_start_tick !== null && tick < this.snapshot_start_tick;
    if (before_window) {
      this.cache_drop_guard_hits += 1;
      this.snapshots.clear();
      this.snapshot_start_tick = null;
    }
    this.remote_posts.set(post.index, post);
    if (post.index > this.max_remote_index) {
      this.max_remote_index = post.index;
    }
    this.advance_contiguous_remote_frontier();
    this.insert_remote_post(post, tick);
    this.invalidate_from_tick(tick);
  }
  add_local_post(name, post) {
    if (this.local_posts.has(name)) {
      this.remove_local_post(name);
    }
    const tick = this.official_tick(post);
    const before_window = this.cache_enabled && this.snapshot_start_tick !== null && tick < this.snapshot_start_tick;
    if (before_window) {
      this.cache_drop_guard_hits += 1;
      this.snapshots.clear();
      this.snapshot_start_tick = null;
    }
    this.local_posts.set(name, post);
    this.get_bucket(tick).local.push(post);
    this.invalidate_from_tick(tick);
  }
  remove_local_post(name) {
    const post = this.local_posts.get(name);
    if (!post) {
      return;
    }
    this.local_posts.delete(name);
    const tick = this.official_tick(post);
    const bucket = this.timeline.get(tick);
    if (bucket) {
      const index = bucket.local.indexOf(post);
      if (index !== -1) {
        bucket.local.splice(index, 1);
      } else {
        const by_name = bucket.local.findIndex((p) => p.name === name);
        if (by_name !== -1) {
          bucket.local.splice(by_name, 1);
        }
      }
      if (bucket.remote.length === 0 && bucket.local.length === 0) {
        this.timeline.delete(tick);
      }
    }
    this.invalidate_from_tick(tick);
  }
  apply_tick(state, tick) {
    let next = this.on_tick(state);
    const bucket = this.timeline.get(tick);
    if (bucket) {
      for (const post of bucket.remote) {
        next = this.on_post(post.data, next);
      }
      for (const post of bucket.local) {
        next = this.on_post(post.data, next);
      }
    }
    return next;
  }
  compute_state_at_uncached(initial_tick, at_tick) {
    let state = this.init;
    for (let tick = initial_tick;tick <= at_tick; tick++) {
      state = this.apply_tick(state, tick);
    }
    return state;
  }
  post_to_debug_dump(post) {
    return {
      room: post.room,
      index: post.index,
      server_time: post.server_time,
      client_time: post.client_time,
      name: post.name,
      official_time: this.official_time(post),
      official_tick: this.official_tick(post),
      data: post.data
    };
  }
  timeline_tick_bounds() {
    let min = null;
    let max = null;
    for (const tick of this.timeline.keys()) {
      if (min === null || tick < min) {
        min = tick;
      }
      if (max === null || tick > max) {
        max = tick;
      }
    }
    return { min, max };
  }
  snapshot_tick_bounds() {
    let min = null;
    let max = null;
    for (const tick of this.snapshots.keys()) {
      if (min === null || tick < min) {
        min = tick;
      }
      if (max === null || tick > max) {
        max = tick;
      }
    }
    return { min, max };
  }
  time_to_tick(server_time) {
    return Math.floor(server_time * this.tick_rate / 1000);
  }
  server_time() {
    return this.client_api.server_time();
  }
  server_tick() {
    return this.time_to_tick(this.server_time());
  }
  post_count() {
    return this.max_remote_index + 1;
  }
  compute_render_state() {
    const curr_tick = this.server_tick();
    const tick_ms = 1000 / this.tick_rate;
    const tol_ticks = Math.ceil(this.tolerance / tick_ms);
    const rtt_ms = this.client_api.ping();
    const half_rtt = isFinite(rtt_ms) ? Math.ceil(rtt_ms / 2 / tick_ms) : 0;
    const remote_lag = Math.max(tol_ticks, half_rtt + 1);
    const remote_tick = Math.max(0, curr_tick - remote_lag);
    const remote_state = this.compute_state_at(remote_tick);
    const local_state = this.compute_state_at(curr_tick);
    return this.smooth(remote_state, local_state);
  }
  initial_time() {
    if (this.initial_time_value !== null) {
      return this.initial_time_value;
    }
    const post = this.remote_posts.get(0);
    if (!post) {
      return null;
    }
    const t = this.official_time(post);
    this.initial_time_value = t;
    this.initial_tick_value = this.time_to_tick(t);
    return t;
  }
  initial_tick() {
    if (this.initial_tick_value !== null) {
      return this.initial_tick_value;
    }
    const t = this.initial_time();
    if (t === null) {
      return null;
    }
    this.initial_tick_value = this.time_to_tick(t);
    return this.initial_tick_value;
  }
  compute_state_at(at_tick) {
    at_tick = this.safe_compute_tick(at_tick);
    const initial_tick = this.initial_tick();
    if (initial_tick === null) {
      return this.init;
    }
    if (at_tick < initial_tick) {
      return this.init;
    }
    if (!this.cache_enabled) {
      return this.compute_state_at_uncached(initial_tick, at_tick);
    }
    this.ensure_snapshots(at_tick, initial_tick);
    const start_tick = this.snapshot_start_tick;
    if (start_tick === null || this.snapshots.size === 0) {
      return this.init;
    }
    if (at_tick < start_tick) {
      return this.snapshots.get(start_tick) ?? this.init;
    }
    const stride = this.snapshot_stride;
    const end_tick = start_tick + (this.snapshots.size - 1) * stride;
    const max_index = Math.floor((end_tick - start_tick) / stride);
    const snap_index = Math.floor((at_tick - start_tick) / stride);
    const index = Math.min(snap_index, max_index);
    const snap_tick = start_tick + index * stride;
    const base_state = this.snapshots.get(snap_tick) ?? this.init;
    return this.advance_state(base_state, snap_tick, at_tick);
  }
  debug_dump() {
    const remote_posts = Array.from(this.remote_posts.values()).sort((a, b) => a.index - b.index).map((post) => this.post_to_debug_dump(post));
    const local_posts = Array.from(this.local_posts.values()).sort((a, b) => {
      const ta = this.official_tick(a);
      const tb = this.official_tick(b);
      if (ta !== tb) {
        return ta - tb;
      }
      const na = a.name ?? "";
      const nb = b.name ?? "";
      return na.localeCompare(nb);
    }).map((post) => this.post_to_debug_dump(post));
    const timeline = Array.from(this.timeline.entries()).sort((a, b) => a[0] - b[0]).map(([tick, bucket]) => ({
      tick,
      remote_count: bucket.remote.length,
      local_count: bucket.local.length,
      remote_posts: bucket.remote.map((post) => this.post_to_debug_dump(post)),
      local_posts: bucket.local.map((post) => this.post_to_debug_dump(post))
    }));
    const snapshots = Array.from(this.snapshots.entries()).sort((a, b) => a[0] - b[0]).map(([tick, state]) => ({ tick, state }));
    const initial_time = this.initial_time();
    const initial_tick = this.initial_tick();
    const timeline_bounds = this.timeline_tick_bounds();
    const snapshot_bounds = this.snapshot_tick_bounds();
    const history_truncated = initial_tick !== null && timeline_bounds.min !== null && timeline_bounds.min > initial_tick;
    let server_time = null;
    let server_tick = null;
    try {
      server_time = this.server_time();
      server_tick = this.server_tick();
    } catch {
      server_time = null;
      server_tick = null;
    }
    let min_remote_index = null;
    let max_remote_index = null;
    for (const index of this.remote_posts.keys()) {
      if (min_remote_index === null || index < min_remote_index) {
        min_remote_index = index;
      }
      if (max_remote_index === null || index > max_remote_index) {
        max_remote_index = index;
      }
    }
    const client_debug = typeof this.client_api.debug_dump === "function" ? this.client_api.debug_dump() : null;
    return {
      room: this.room,
      tick_rate: this.tick_rate,
      tolerance: this.tolerance,
      cache_enabled: this.cache_enabled,
      snapshot_stride: this.snapshot_stride,
      snapshot_count: this.snapshot_count,
      snapshot_start_tick: this.snapshot_start_tick,
      no_pending_posts_before_ms: this.no_pending_posts_before_ms,
      max_contiguous_remote_index: this.max_contiguous_remote_index,
      initial_time,
      initial_tick,
      max_remote_index: this.max_remote_index,
      post_count: this.post_count(),
      server_time,
      server_tick,
      ping: this.ping(),
      history_truncated,
      cache_drop_guard_hits: this.cache_drop_guard_hits,
      counts: {
        remote_posts: this.remote_posts.size,
        local_posts: this.local_posts.size,
        timeline_ticks: this.timeline.size,
        snapshots: this.snapshots.size
      },
      ranges: {
        timeline_min_tick: timeline_bounds.min,
        timeline_max_tick: timeline_bounds.max,
        snapshot_min_tick: snapshot_bounds.min,
        snapshot_max_tick: snapshot_bounds.max,
        min_remote_index,
        max_remote_index
      },
      remote_posts,
      local_posts,
      timeline,
      snapshots,
      client_debug
    };
  }
  debug_recompute(at_tick) {
    const initial_tick = this.initial_tick();
    const timeline_bounds = this.timeline_tick_bounds();
    const history_truncated = initial_tick !== null && timeline_bounds.min !== null && timeline_bounds.min > initial_tick;
    let target_tick = at_tick;
    if (target_tick === undefined) {
      try {
        target_tick = this.server_tick();
      } catch {
        target_tick = undefined;
      }
    }
    if (target_tick === undefined) {
      target_tick = initial_tick ?? 0;
    }
    const invalidated_snapshot_count = this.snapshots.size;
    this.snapshots.clear();
    this.snapshot_start_tick = null;
    const notes = [];
    if (history_truncated) {
      notes.push("Local history before timeline_min_tick was pruned; full room replay may be impossible without reloading posts.");
    }
    if (initial_tick === null || target_tick < initial_tick) {
      notes.push("No replayable post range available at target tick.");
      return {
        target_tick,
        initial_tick,
        cache_invalidated: true,
        invalidated_snapshot_count,
        history_truncated,
        state: this.init,
        notes
      };
    }
    const state = this.compute_state_at_uncached(initial_tick, target_tick);
    return {
      target_tick,
      initial_tick,
      cache_invalidated: true,
      invalidated_snapshot_count,
      history_truncated,
      state,
      notes
    };
  }
  post(data) {
    const name = this.client_api.post(this.room, data, this.packer);
    const t = this.server_time();
    const local_post = {
      room: this.room,
      index: -1,
      server_time: t,
      client_time: t,
      name,
      data
    };
    this.add_local_post(name, local_post);
  }
  compute_current_state() {
    return this.compute_state_at(this.server_tick());
  }
  on_sync(callback) {
    this.client_api.on_sync(callback);
  }
  ping() {
    return this.client_api.ping();
  }
  close() {
    if (this.latest_index_poll_interval_id !== null) {
      clearInterval(this.latest_index_poll_interval_id);
      this.latest_index_poll_interval_id = null;
    }
    this.client_api.close();
  }
  static gen_name() {
    return gen_name();
  }
};
__publicField(_VibiNet, "game", _VibiNet);

// src/room_post_guards.ts
function is_record(value) {
  return typeof value === "object" && value !== null;
}
function is_string(value) {
  return typeof value === "string";
}
function is_number(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function is_integer(value) {
  return Number.isInteger(value);
}
function is_non_negative_integer(value) {
  return is_integer(value) && value >= 0;
}
function is_player_slot(value) {
  return value === "player1" || value === "player2";
}
function is_monster_type(value) {
  return value === "buf" || value === "def" || value === "atk";
}
function is_string_array(value) {
  return Array.isArray(value) && value.every(is_string);
}
function optional_string(value) {
  return value === undefined || is_string(value);
}
function optional_non_negative_integer(value) {
  return value === undefined || is_non_negative_integer(value);
}
function is_stats(value) {
  if (!is_record(value))
    return false;
  return is_number(value.level) && is_number(value.maxHp) && is_number(value.attack) && is_number(value.defense) && is_number(value.speed);
}
function is_ev_spread(value) {
  if (!is_record(value))
    return false;
  return is_number(value.hp) && is_number(value.atk) && is_number(value.def) && is_number(value.spe);
}
function is_monster_config(value) {
  if (!is_record(value))
    return false;
  return is_string(value.id) && is_string_array(value.moves) && is_string(value.passive) && is_monster_type(value.type) && is_stats(value.stats) && is_ev_spread(value.ev);
}
function is_team_selection(value) {
  if (!is_record(value))
    return false;
  if (!Array.isArray(value.monsters) || !value.monsters.every(is_monster_config))
    return false;
  return is_non_negative_integer(value.activeIndex);
}
function is_player_intent(value) {
  if (!is_record(value) || !is_string(value.action)) {
    return false;
  }
  if (value.action === "switch") {
    return is_non_negative_integer(value.targetIndex);
  }
  if (value.action === "run") {
    return true;
  }
  if (value.action === "use_move") {
    if (!is_non_negative_integer(value.moveIndex)) {
      return false;
    }
    return optional_non_negative_integer(value.selfSwitchTargetIndex);
  }
  return false;
}
function is_join_post(value) {
  if (!is_record(value) || value.$ !== "join")
    return false;
  return is_string(value.name) && optional_string(value.player_id) && optional_string(value.token);
}
function is_assign_post(value) {
  if (!is_record(value) || value.$ !== "assign")
    return false;
  return is_player_slot(value.slot) && is_string(value.token) && is_string(value.name);
}
function is_spectator_post(value) {
  if (!is_record(value) || value.$ !== "spectator")
    return false;
  return is_string(value.name);
}
function is_chat_post(value) {
  if (!is_record(value) || value.$ !== "chat")
    return false;
  return is_string(value.message) && is_string(value.from) && optional_string(value.player_id);
}
function is_players_record(value) {
  if (!is_record(value))
    return false;
  const p1 = value.player1;
  const p2 = value.player2;
  const p1_ok = p1 === null || is_string(p1);
  const p2_ok = p2 === null || is_string(p2);
  return p1_ok && p2_ok;
}
function is_participants_post(value) {
  if (!is_record(value) || value.$ !== "participants")
    return false;
  return is_players_record(value.players) && is_string_array(value.spectators);
}
function is_ready_post(value) {
  if (!is_record(value) || value.$ !== "ready")
    return false;
  if (typeof value.ready !== "boolean")
    return false;
  if (!optional_string(value.player_id))
    return false;
  if (value.team === undefined)
    return true;
  return is_team_selection(value.team);
}
function is_ready_record(value) {
  if (!is_record(value))
    return false;
  return typeof value.player1 === "boolean" && typeof value.player2 === "boolean";
}
function is_ready_state_post(value) {
  if (!is_record(value) || value.$ !== "ready_state")
    return false;
  if (!is_ready_record(value.ready) || !is_players_record(value.names)) {
    return false;
  }
  if (value.order === undefined) {
    return true;
  }
  return Array.isArray(value.order) && value.order.every(is_player_slot);
}
function is_intent_post(value) {
  if (!is_record(value) || value.$ !== "intent")
    return false;
  return is_non_negative_integer(value.turn) && is_player_intent(value.intent) && optional_non_negative_integer(value.forcedSwitchTargetIndex) && optional_string(value.player_id);
}
function is_forced_switch_post(value) {
  if (!is_record(value) || value.$ !== "forced_switch")
    return false;
  return is_non_negative_integer(value.targetIndex) && optional_string(value.player_id);
}
function is_intent_locked_post(value) {
  if (!is_record(value) || value.$ !== "intent_locked")
    return false;
  return is_player_slot(value.slot) && is_non_negative_integer(value.turn);
}
function is_intents_record(value) {
  if (!is_record(value))
    return false;
  return typeof value.player1 === "boolean" && typeof value.player2 === "boolean";
}
function is_turn_start_post(value) {
  if (!is_record(value) || value.$ !== "turn_start")
    return false;
  return is_non_negative_integer(value.turn) && is_number(value.deadline_at) && is_intents_record(value.intents);
}
function is_turn_config_post(value) {
  if (!is_record(value) || value.$ !== "turn_config")
    return false;
  return is_number(value.turnDurationSeconds) && optional_string(value.player_id);
}
function is_monster_state(value) {
  if (!is_record(value))
    return false;
  return is_string(value.id) && is_string(value.name) && is_monster_type(value.type) && is_number(value.hp) && is_number(value.maxHp) && is_number(value.mSPE) && is_number(value.level) && is_number(value.baseAttack) && is_number(value.baseDefense) && is_number(value.baseSpeed) && is_number(value.attack) && is_number(value.attackStage) && is_number(value.defense) && is_number(value.defenseStage) && is_number(value.speed) && is_number(value.speedStage) && typeof value.agilityBoostActive === "boolean" && typeof value.endureSpeedBoostActive === "boolean" && typeof value.bellyDrumActive === "boolean" && typeof value.screechDebuffActive === "boolean" && is_string_array(value.possibleMoves) && is_string_array(value.possiblePassives) && is_string_array(value.chosenMoves) && is_string(value.chosenPassive) && typeof value.protectActiveThisTurn === "boolean" && typeof value.endureActiveThisTurn === "boolean" && typeof value.baitActiveThisTurn === "boolean" && is_number(value.protectCooldownTurns) && is_number(value.endureCooldownTurns);
}
function is_player_state(value) {
  if (!is_record(value))
    return false;
  if (!is_player_slot(value.slot))
    return false;
  if (!is_string(value.name))
    return false;
  if (!is_number(value.sharedHp) || !is_number(value.sharedHpMax) || !is_number(value.sharedMSPE))
    return false;
  if (!Array.isArray(value.team) || value.team.length === 0 || !value.team.every(is_monster_state))
    return false;
  if (!is_non_negative_integer(value.activeIndex))
    return false;
  return value.activeIndex < value.team.length;
}
function is_players_state(value) {
  if (!is_record(value))
    return false;
  return is_player_state(value.player1) && is_player_state(value.player2);
}
function is_game_state_status(value) {
  return value === "setup" || value === "running" || value === "ended";
}
function is_event_log(value) {
  if (!is_record(value))
    return false;
  if (!is_string(value.type) || !is_integer(value.turn) || !is_string(value.summary))
    return false;
  if (value.phase !== undefined && !is_string(value.phase))
    return false;
  if (value.data !== undefined && !is_record(value.data))
    return false;
  return true;
}
function is_state_post(value) {
  if (!is_record(value) || value.$ !== "state")
    return false;
  if (!is_non_negative_integer(value.turn))
    return false;
  if (!is_record(value.state))
    return false;
  if (!is_integer(value.state.turn))
    return false;
  if (!is_game_state_status(value.state.status))
    return false;
  if (!is_players_state(value.state.players))
    return false;
  if (!Array.isArray(value.log) || !value.log.every(is_event_log))
    return false;
  return true;
}
function is_surrender_post(value) {
  if (!is_record(value) || value.$ !== "surrender")
    return false;
  return is_non_negative_integer(value.turn) && is_player_slot(value.loser) && is_player_slot(value.winner);
}
function is_surrender_request_post(value) {
  if (!is_record(value) || value.$ !== "surrender")
    return false;
  return optional_string(value.player_id);
}
function is_error_post(value) {
  if (!is_record(value) || value.$ !== "error")
    return false;
  return is_string(value.message) && optional_string(value.code);
}
function is_room_post(value) {
  if (!is_record(value) || !is_string(value.$)) {
    return false;
  }
  switch (value.$) {
    case "join":
      return is_join_post(value);
    case "assign":
      return is_assign_post(value);
    case "spectator":
      return is_spectator_post(value);
    case "chat":
      return is_chat_post(value);
    case "participants":
      return is_participants_post(value);
    case "ready":
      return is_ready_post(value);
    case "ready_state":
      return is_ready_state_post(value);
    case "intent":
      return is_intent_post(value);
    case "forced_switch":
      return is_forced_switch_post(value);
    case "intent_locked":
      return is_intent_locked_post(value);
    case "turn_start":
      return is_turn_start_post(value);
    case "turn_config":
      return is_turn_config_post(value);
    case "state":
      return is_state_post(value);
    case "surrender":
      return is_surrender_post(value) || is_surrender_request_post(value);
    case "error":
      return is_error_post(value);
    default:
      return false;
  }
}
function parse_room_post_json(raw) {
  if (!is_string(raw)) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return is_room_post(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function is_raw_info_post_envelope(value) {
  if (!is_record(value) || value.$ !== "info_post") {
    return false;
  }
  if (!is_string(value.room))
    return false;
  if (!is_integer(value.index))
    return false;
  if (!is_number(value.server_time) || !is_number(value.client_time))
    return false;
  if (!optional_string(value.name))
    return false;
  return "data" in value;
}
function is_room_info_post_envelope(value) {
  if (!is_raw_info_post_envelope(value)) {
    return false;
  }
  return is_room_post(value.data);
}

// src/client.ts
var ROOM_POST_PACKER = { $: "String" };
var client = create_client();
var room_watchers = new Map;
function emit_if_valid(room, message) {
  if (!is_raw_info_post_envelope(message)) {
    return;
  }
  const data = parse_room_post_json(message.data);
  if (!data) {
    return;
  }
  const handler = room_watchers.get(room);
  if (!handler) {
    return;
  }
  handler({
    $: "info_post",
    room: message.room,
    index: message.index,
    server_time: message.server_time,
    client_time: message.client_time,
    ...typeof message.name === "string" ? { name: message.name } : {},
    data
  });
}
function post(room, data) {
  return client.post(room, JSON.stringify(data), ROOM_POST_PACKER);
}
function load(room, from = 0, handler) {
  if (handler) {
    room_watchers.set(room, handler);
  }
  client.load(room, from, ROOM_POST_PACKER);
}
function watch(room, handler) {
  if (handler) {
    room_watchers.set(room, handler);
  }
  client.watch(room, ROOM_POST_PACKER, (message) => {
    emit_if_valid(room, message);
  });
}
function on_sync(callback) {
  client.on_sync(callback);
}
function ping() {
  return client.ping();
}

// src/data/moves.ts
var MOVE_CATALOG = [
  { id: "quick_attack", label: "Quick Attack", phaseId: "attack_01", attackMultiplier100: 66 },
  { id: "punch", label: "Punch", phaseId: "attack_01", attackMultiplier100: 93 },
  { id: "power", label: "Power", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "hook", label: "Hook", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "kick", label: "Kick", phaseId: "attack_01", attackMultiplier100: 120 },
  { id: "throw", label: "Throw", phaseId: "attack_01", attackMultiplier100: 100 },
  { id: "agility", label: "Agility", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "run", label: "Run", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "wish", label: "Wish", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "rejuvenation", label: "Rejuvenation", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "switch_sovietico", label: "Switch Sovietico", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "team_cure", label: "Team Cure", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "bait", label: "Bait", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "belly_drum", label: "Belly Drum", phaseId: "attack_01", attackMultiplier100: 0 },
  {
    id: "return",
    label: "Return",
    phaseId: "attack_01",
    attackMultiplier100: 72,
    attackMultiplierPerLevel100: 4
  },
  {
    id: "double_edge",
    label: "Double-Edge",
    phaseId: "attack_01",
    attackMultiplier100: 120,
    recoilNumerator: 1,
    recoilDenominator: 3
  },
  {
    id: "seismic_toss",
    label: "Seismic Toss",
    phaseId: "attack_01",
    attackMultiplier100: 100,
    damageType: "flat",
    flatDamage: 50
  },
  {
    id: "leech_life",
    label: "Leech Life",
    phaseId: "attack_01",
    attackMultiplier100: 0,
    components: [{ kind: "curse", id: "leech_seed", clearsOnSwitch: true }]
  },
  {
    id: "sekyps",
    label: "Sekyps",
    phaseId: "attack_01",
    attackMultiplier100: 0,
    components: [{ kind: "curse", id: "sekyps", clearsOnSwitch: true }]
  },
  { id: "focus_punch", label: "Focus Punch", phaseId: "attack_01", attackMultiplier100: 150 },
  { id: "pain_split", label: "Pain Split", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "screech", label: "Screech", phaseId: "attack_01", attackMultiplier100: 0 },
  {
    id: "taunt",
    label: "Taunt",
    phaseId: "attack_01",
    attackMultiplier100: 0,
    components: [{ kind: "effect", id: "taunt", maxDurationTurns: 2 }]
  },
  { id: "spikes", label: "Spikes", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "recover", label: "Recover", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "heal", label: "Heal", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "mega_punch", label: "Mega Punch", phaseId: "attack_01", attackMultiplier100: 100, damageType: "flat", flatDamage: 20 },
  { id: "meditate", label: "Meditate", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "ki_blast", label: "Ki Blast", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "endure", label: "Endure", phaseId: "guard", attackMultiplier100: 0 },
  { id: "protect", label: "Protect", phaseId: "guard", attackMultiplier100: 100 },
  { id: "none", label: "none", phaseId: "attack_01", attackMultiplier100: 100 }
];
var MOVE_OPTIONS = MOVE_CATALOG.map((entry) => entry.id);
var MOVE_ALIASES = {
  bells_drum: "belly_drum",
  cast: "throw"
};
var MOVE_LABELS = Object.fromEntries(MOVE_CATALOG.map((entry) => [entry.id, entry.label]));
MOVE_LABELS.bells_drum = "Belly Drum";
MOVE_LABELS.cast = "Throw";
var MOVE_BY_ID_INTERNAL = new Map(MOVE_CATALOG.map((entry) => [entry.id, entry]));
for (const [legacy_id, canonical_id] of Object.entries(MOVE_ALIASES)) {
  const canonical = MOVE_BY_ID_INTERNAL.get(canonical_id);
  if (canonical) {
    MOVE_BY_ID_INTERNAL.set(legacy_id, canonical);
  }
}
var MOVE_BY_ID = MOVE_BY_ID_INTERNAL;
function move_spec(move_id) {
  return MOVE_BY_ID_INTERNAL.get(move_id) ?? MOVE_BY_ID_INTERNAL.get("none");
}

// src/data/passives.ts
var PASSIVE_CATALOG = [
  { id: "none", label: "none", kind: "none", components: [] },
  {
    id: "clear_body",
    label: "Clear Body [Instant]",
    kind: "instant",
    components: [{ kind: "instant", id: "clear_body", target: "self" }]
  }
];
var PASSIVE_OPTIONS = PASSIVE_CATALOG.map((entry) => entry.id);
var PASSIVE_LABELS = Object.fromEntries(PASSIVE_CATALOG.flatMap((entry) => {
  const rows = [[entry.id, entry.label]];
  for (const alias of entry.aliases ?? []) {
    rows.push([alias, entry.label]);
  }
  return rows;
}));
var PASSIVE_BY_ID_INTERNAL = new Map;
for (const entry of PASSIVE_CATALOG) {
  PASSIVE_BY_ID_INTERNAL.set(entry.id, entry);
  for (const alias of entry.aliases ?? []) {
    PASSIVE_BY_ID_INTERNAL.set(alias, entry);
  }
}
var PASSIVE_BY_ID = PASSIVE_BY_ID_INTERNAL;

// src/data/mon.ts
function all_move_options() {
  return MOVE_OPTIONS.slice();
}
function type_for_index(index) {
  const order = ["buf", "def", "atk"];
  return order[index % order.length];
}
var MONSTER_ROSTER = [
  {
    id: "babydragon",
    name: "mon1",
    role: "Snorlax",
    type: type_for_index(0),
    stats: { level: 12, maxHp: 100, attack: 100, defense: 100, speed: 100 },
    possibleMoves: all_move_options(),
    possiblePassives: ["none"],
    defaultMoves: ["return", "seismic_toss", "none", "run"],
    defaultPassive: "none"
  },
  {
    id: "croni",
    name: "mon2",
    role: "Ninjask",
    type: type_for_index(1),
    stats: { level: 12, maxHp: 100, attack: 35, defense: 60, speed: 160 },
    possibleMoves: all_move_options(),
    possiblePassives: ["none"],
    defaultMoves: ["return", "seismic_toss", "none", "run"],
    defaultPassive: "none"
  },
  {
    id: "harpy",
    name: "mon3",
    role: "Absol",
    type: type_for_index(2),
    stats: { level: 12, maxHp: 180, attack: 521, defense: 230, speed: 292 },
    possibleMoves: all_move_options(),
    possiblePassives: ["none"],
    defaultMoves: ["return", "seismic_toss", "none", "run"],
    defaultPassive: "none"
  },
  {
    id: "hoof",
    name: "mon4",
    role: "Chansey",
    type: type_for_index(3),
    stats: { level: 12, maxHp: 950, attack: 0, defense: 0, speed: 188 },
    possibleMoves: all_move_options(),
    possiblePassives: ["none"],
    defaultMoves: ["return", "seismic_toss", "none", "run"],
    defaultPassive: "none"
  },
  {
    id: "knight",
    name: "Knight",
    role: "Metagross",
    type: "def",
    stats: { level: 12, maxHp: 242, attack: 80, defense: 160, speed: 65 },
    possibleMoves: all_move_options(),
    possiblePassives: ["none"],
    defaultMoves: ["sekyps", "rejuvenation", "none", "run"],
    defaultPassive: "none"
  },
  {
    id: "night_sekyps",
    name: "Mon1",
    role: "Metagross Sekyps",
    type: "atk",
    stats: { level: 12, maxHp: 242, attack: 115, defense: 75, speed: 75 },
    possibleMoves: ["sekyps", "kick", "run", "none"],
    possiblePassives: ["none"],
    defaultMoves: ["sekyps", "kick", "none", "run"],
    defaultPassive: "none"
  },
  {
    id: "miren",
    name: "mon6",
    role: "Celebi",
    type: type_for_index(5),
    stats: { level: 12, maxHp: 325, attack: 396, defense: 396, speed: 396 },
    possibleMoves: all_move_options(),
    possiblePassives: ["none"],
    defaultMoves: ["return", "seismic_toss", "none", "run"],
    defaultPassive: "none"
  },
  {
    id: "panda",
    name: "mon7",
    role: "Cloyster",
    type: type_for_index(6),
    stats: { level: 12, maxHp: 117, attack: 375, defense: 730, speed: 271 },
    possibleMoves: all_move_options(),
    possiblePassives: ["none"],
    defaultMoves: ["return", "seismic_toss", "none", "run"],
    defaultPassive: "none"
  },
  {
    id: "valkyria",
    name: "mon8",
    role: "Aerodactyl",
    type: type_for_index(7),
    stats: { level: 12, maxHp: 242, attack: 100, defense: 100, speed: 100 },
    possibleMoves: all_move_options(),
    possiblePassives: ["none"],
    defaultMoves: ["return", "seismic_toss", "none", "run"],
    defaultPassive: "none"
  },
  {
    id: "vealkiria",
    name: "Vealkiria",
    role: "Valkyria ATK Template",
    type: "atk",
    stats: { level: 12, maxHp: 242, attack: 115, defense: 75, speed: 75 },
    possibleMoves: all_move_options(),
    possiblePassives: ["none"],
    defaultMoves: ["punch", "heal", "none", "run"],
    defaultPassive: "none"
  },
  {
    id: "babydragonbuf",
    name: "Baby Dragon",
    role: "Baby Dragon BUF Template",
    type: "buf",
    stats: { level: 12, maxHp: 85, attack: 85, defense: 85, speed: 85 },
    possibleMoves: all_move_options(),
    possiblePassives: ["none"],
    defaultMoves: ["power", "ki_blast", "none", "run"],
    defaultPassive: "none"
  },
  {
    id: "armoth",
    name: "Armoth",
    role: "Cloyster Template",
    type: "def",
    stats: { level: 12, maxHp: 117, attack: 50, defense: 160, speed: 70 },
    possibleMoves: all_move_options(),
    possiblePassives: ["none"],
    defaultMoves: ["bait", "seismic_toss", "none", "run"],
    defaultPassive: "none"
  },
  {
    id: "kairus",
    name: "Kairus",
    role: "Absol Template",
    type: "atk",
    stats: { level: 12, maxHp: 180, attack: 115, defense: 75, speed: 130 },
    possibleMoves: all_move_options(),
    possiblePassives: ["none"],
    defaultMoves: ["kick", "throw", "none", "run"],
    defaultPassive: "none"
  },
  {
    id: "farien",
    name: "Farien",
    role: "Celebi Template",
    type: "buf",
    stats: { level: 12, maxHp: 325, attack: 100, defense: 100, speed: 100 },
    possibleMoves: all_move_options(),
    possiblePassives: ["none"],
    defaultMoves: ["switch_sovietico", "team_cure", "none", "run"],
    defaultPassive: "none"
  }
];
var MONSTER_BY_ID = new Map(MONSTER_ROSTER.map((entry) => [entry.id, entry]));

// src/stats_calc.ts
var EV_PER_STAT_MAX = 252;
var EV_TOTAL_MAX = 508;
var LEVEL_MIN = 1;
var LEVEL_MAX = 12;
function empty_ev_spread() {
  return { hp: 0, atk: 0, def: 0, spe: 0 };
}
function empty_iv_spread() {
  return { hp: 0, atk: 0, def: 0, spe: 0 };
}
function neutral_nature() {
  return { atk: 1, def: 1, spe: 1 };
}
function ev_bonus(ev) {
  return Math.floor(ev / 4);
}
function clamp_input_level(level) {
  if (!Number.isFinite(level)) {
    return LEVEL_MIN;
  }
  const normalized = Math.trunc(level);
  return Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, normalized));
}
function scaled_level_for_formula(level) {
  return clamp_input_level(level);
}
function validate_ev_spread(ev) {
  const values = [
    ["hp", ev.hp],
    ["atk", ev.atk],
    ["def", ev.def],
    ["spe", ev.spe]
  ];
  for (const [key, value] of values) {
    if (!Number.isInteger(value)) {
      return `EV ${key} must be integer`;
    }
    if (value < 0 || value > EV_PER_STAT_MAX) {
      return `EV ${key} must be between 0 and ${EV_PER_STAT_MAX}`;
    }
  }
  const total = values.reduce((sum, [, value]) => sum + value, 0);
  if (total > EV_TOTAL_MAX) {
    return `EV total must be <= ${EV_TOTAL_MAX} (got ${total})`;
  }
  return null;
}
function calc_hp_max(base_hp, level, ev_hp, iv_hp) {
  const effective_level = scaled_level_for_formula(level);
  return Math.floor((2 * base_hp + iv_hp + ev_bonus(ev_hp)) * effective_level / 100) + effective_level + 10;
}
function calc_non_hp_stat(base, level, ev, iv, nature) {
  const effective_level = scaled_level_for_formula(level);
  const ev_flat = Math.floor(base * ev_bonus(ev) * effective_level / 2400);
  const ev_mult = ev_flat / base;
  const term = base + ev_flat;
  return Math.floor(term * nature);
}
function calc_final_stats(base, level, ev, iv = empty_iv_spread(), nature = neutral_nature()) {
  return {
    hpMax: calc_hp_max(base.hp, level, ev.hp, iv.hp),
    atk: calc_non_hp_stat(base.atk, level, ev.atk, iv.atk, nature.atk),
    def: calc_non_hp_stat(base.def, level, ev.def, iv.def, nature.def),
    spe: calc_non_hp_stat(base.spe, level, ev.spe, iv.spe, nature.spe)
  };
}

// src/data/integrity.ts
function ensure(condition, message) {
  if (!condition) {
    throw new Error(`[data] ${message}`);
  }
}
function ensure_int(value, message) {
  ensure(Number.isInteger(value), message);
}
function ensure_valid_type(monster) {
  ensure(monster.type === "buf" || monster.type === "def" || monster.type === "atk", `${monster.id}: invalid type ${monster.type}`);
}
var DEFAULT_MOVE_SLOTS = 4;
var ACTIVE_MOVE_SLOTS = 3;
function assert_monster_integrity(monsters) {
  for (const move of MOVE_CATALOG) {
    const components = move.components ?? move.collateral ?? [];
    if (components.length === 0) {
      continue;
    }
    for (const collateral of components) {
      if (collateral.kind === "effect") {
        ensure_int(collateral.maxDurationTurns, `${move.id}: effect ${collateral.id} duration must be integer`);
        ensure(collateral.maxDurationTurns > 0, `${move.id}: effect ${collateral.id} duration must be > 0`);
        continue;
      }
      if (collateral.kind === "curse") {
        ensure(collateral.clearsOnSwitch === true, `${move.id}: curse ${collateral.id} must clear on switch`);
        continue;
      }
      if (collateral.kind === "buff_debuff") {
        ensure(collateral.id.trim().length > 0, `${move.id}: buff_debuff id is required`);
        ensure_int(collateral.deltaPercent, `${move.id}: buff_debuff ${collateral.id} deltaPercent must be integer`);
        ensure(collateral.clearsOnSwitch === true, `${move.id}: buff_debuff ${collateral.id} must clear on switch`);
        continue;
      }
      if (collateral.kind === "instant") {
        ensure(collateral.id.trim().length > 0, `${move.id}: instant id is required`);
        continue;
      }
    }
  }
  const monster_ids = new Set;
  for (const monster of monsters) {
    ensure(monster.id.length > 0, "monster id is required");
    ensure(!monster_ids.has(monster.id), `duplicate monster id: ${monster.id}`);
    monster_ids.add(monster.id);
    ensure(monster.defaultMoves.length === DEFAULT_MOVE_SLOTS, `${monster.id}: defaultMoves must contain exactly ${DEFAULT_MOVE_SLOTS} entries`);
    ensure_valid_type(monster);
    const possible_moves = new Set(monster.possibleMoves);
    ensure(possible_moves.size > 0, `${monster.id}: possibleMoves cannot be empty`);
    ensure(possible_moves.has("run"), `${monster.id}: possibleMoves must include run`);
    for (const move_id of monster.possibleMoves) {
      ensure(MOVE_BY_ID.has(move_id), `${monster.id}: unknown move in possibleMoves: ${move_id}`);
    }
    const move_dedup = new Set;
    for (let i = 0;i < monster.defaultMoves.length; i++) {
      const move_id = monster.defaultMoves[i];
      ensure(MOVE_BY_ID.has(move_id), `${monster.id}: unknown move in defaultMoves: ${move_id}`);
      ensure(possible_moves.has(move_id), `${monster.id}: default move not allowed: ${move_id}`);
      if (i === DEFAULT_MOVE_SLOTS - 1) {
        ensure(move_id === "run", `${monster.id}: last default move must be run`);
        continue;
      }
      ensure(move_id !== "run", `${monster.id}: run is only allowed in last default move slot`);
      if (move_id !== "none") {
        ensure(!move_dedup.has(move_id), `${monster.id}: duplicate default move: ${move_id}`);
        move_dedup.add(move_id);
      }
    }
    const active_default_moves = monster.defaultMoves.slice(0, ACTIVE_MOVE_SLOTS).filter((move_id) => move_id !== "none");
    ensure(active_default_moves.length === 2, `${monster.id}: defaultMoves must contain exactly 2 active abilities in first ${ACTIVE_MOVE_SLOTS} slots`);
    ensure(monster.possiblePassives.length > 0, `${monster.id}: possiblePassives cannot be empty`);
    const possible_passives = new Set;
    for (const passive_id of monster.possiblePassives) {
      ensure(PASSIVE_BY_ID.has(passive_id), `${monster.id}: unknown passive in possiblePassives: ${passive_id}`);
      possible_passives.add(passive_id);
    }
    ensure(PASSIVE_BY_ID.has(monster.defaultPassive), `${monster.id}: unknown default passive: ${monster.defaultPassive}`);
    ensure(possible_passives.has(monster.defaultPassive), `${monster.id}: default passive not allowed: ${monster.defaultPassive}`);
    ensure_int(monster.stats.level, `${monster.id}: level must be integer`);
    ensure_int(monster.stats.maxHp, `${monster.id}: maxHp must be integer`);
    ensure_int(monster.stats.attack, `${monster.id}: attack must be integer`);
    ensure_int(monster.stats.defense, `${monster.id}: defense must be integer`);
    ensure_int(monster.stats.speed, `${monster.id}: speed must be integer`);
    ensure(monster.stats.level > 0, `${monster.id}: level must be > 0`);
    ensure(monster.stats.level >= LEVEL_MIN && monster.stats.level <= LEVEL_MAX, `${monster.id}: level must be between ${LEVEL_MIN} and ${LEVEL_MAX}`);
    ensure(monster.stats.maxHp > 0, `${monster.id}: maxHp must be > 0`);
    ensure(monster.stats.attack >= 0, `${monster.id}: attack must be >= 0`);
    ensure(monster.stats.defense >= 0, `${monster.id}: defense must be >= 0`);
    ensure(monster.stats.speed >= 0, `${monster.id}: speed must be >= 0`);
  }
}
function is_integrity_entrypoint() {
  if (typeof process === "undefined" || !Array.isArray(process.argv)) {
    return false;
  }
  const entry = process.argv[1];
  if (typeof entry !== "string" || entry.length === 0) {
    return false;
  }
  const normalized = entry.replace(/\\/g, "/");
  return normalized.endsWith("/src/data/integrity.ts") || normalized.endsWith("src/data/integrity.ts");
}
if (is_integrity_entrypoint()) {
  assert_monster_integrity(MONSTER_ROSTER);
  console.log(`[integrity] ok (${MONSTER_ROSTER.length} monsters)`);
}

// src/data/exports.ts
assert_monster_integrity(MONSTER_ROSTER);

// src/shared.ts
var SHARED_HP_START = 600;
var SHARED_MSPE_START = 100;
var TURN_DURATION_MS = 50000;
var BASE_TURN_LIMIT = 12;

// src/int_math.ts
var MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
function to_bigint_trunc(value) {
  if (!Number.isFinite(value)) {
    return 0n;
  }
  return BigInt(Math.trunc(value));
}
function clamp_bigint_to_safe(value) {
  if (value > MAX_SAFE_BIGINT) {
    return MAX_SAFE_BIGINT;
  }
  if (value < -MAX_SAFE_BIGINT) {
    return -MAX_SAFE_BIGINT;
  }
  return value;
}
function to_safe_number(value) {
  return Number(clamp_bigint_to_safe(value));
}
function floor_div(numerator, denominator) {
  if (denominator === 0n) {
    return 0n;
  }
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder !== 0n && remainder > 0n !== denominator > 0n) {
    quotient -= 1n;
  }
  return quotient;
}
function ceil_div(numerator, denominator) {
  if (denominator === 0n) {
    return 0n;
  }
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder !== 0n && remainder > 0n === denominator > 0n) {
    quotient += 1n;
  }
  return quotient;
}
function normalize_int(value, fallback, min = Number.MIN_SAFE_INTEGER) {
  const base = Number.isFinite(value) ? Math.round(value) : Math.round(fallback);
  return Math.max(min, base);
}
function mul_div_floor(a, b, d) {
  const numerator = to_bigint_trunc(a) * to_bigint_trunc(b);
  const denominator = to_bigint_trunc(d);
  return to_safe_number(floor_div(numerator, denominator));
}
function mul_div_ceil(a, b, d) {
  const numerator = to_bigint_trunc(a) * to_bigint_trunc(b);
  const denominator = to_bigint_trunc(d);
  return to_safe_number(ceil_div(numerator, denominator));
}
function mul_div_round(a, b, d) {
  const numerator = to_bigint_trunc(a) * to_bigint_trunc(b);
  const denominator = to_bigint_trunc(d);
  if (denominator === 0n) {
    return 0;
  }
  const negative = numerator < 0n !== denominator < 0n;
  const abs_num = numerator < 0n ? -numerator : numerator;
  const abs_den = denominator < 0n ? -denominator : denominator;
  const rounded = (abs_num + abs_den / 2n) / abs_den;
  return to_safe_number(negative ? -rounded : rounded);
}

// src/engine.ts
var INITIATIVE_DEFAULT = ["speed", "attack", "hp", "defense"];
var INITIATIVE_NONE = [];
var PHASES = [
  { id: "switch", name: "Switch", order: 0, initiative: INITIATIVE_DEFAULT },
  { id: "guard", name: "Guard", order: 1, initiative: INITIATIVE_DEFAULT },
  { id: "attack_01", name: "Attack 01", order: 2, initiative: INITIATIVE_DEFAULT },
  { id: "run", name: "Run", order: 3, initiative: INITIATIVE_NONE }
];
var END_PHASE_ID = "ending_turn";
var SLOT_ORDER = ["player1", "player2"];
var END_TURN_EFFECT_ORDER = [
  "focus_punch",
  "rejuvenation_reactive",
  "wish",
  "leech_life",
  "rejuvenation_regen",
  "type_regen"
];
var TAUNT_BLOCKED_MOVE_IDS = new Set([
  "none",
  "agility",
  "run",
  "switch_sovietico",
  "team_cure",
  "bait",
  "wish",
  "rejuvenation",
  "power",
  "spikes",
  "recover",
  "heal",
  "meditate",
  "belly_drum",
  "screech",
  "taunt",
  "pain_split",
  "leech_life",
  "sekyps",
  "hook"
]);
function is_attack_damage_phase(phase) {
  return phase === "attack_01" || phase === "attack_02";
}
var INITIATIVE_WITHOUT_SPEED = ["attack", "hp", "defense"];
var STAT_STAGE_MIN = -6;
var STAT_STAGE_MAX = 6;
var POWER_ATTACK_STAGE_PER_CAST = 1;
var MEDITATE_ATTACK_STAGE_PER_CAST = 2;
var TYPE_PASSIVE_ATK_TRUE_DAMAGE = 50;
var THROW_FIXED_OFFENSE_TERM = 90 * 90;
var TYPE_PASSIVE_DEF_ARMOR_STACK_MAX = 5;
var TYPE_PASSIVE_DEF_ARMOR_REDUCTION_PER_STACK_PERCENT = 10;
var TYPE_PASSIVE_BUF_REGEN_PER_STACK = 5;
var STAT_MULTIPLIER_MIN_PERCENT = 25;
var STAT_MULTIPLIER_MAX_PERCENT = 400;
var MSPE_VALUE_GOAL = 500;
var MSPE_GAP_GOAL_PERCENT = 33;
var RUN_MSPE_GAIN_PERCENT = 10;
var HOOK_RUN_MSPE_REDUCTION_PERCENT = 20;
var HOOK_EXPOSURE_INCOMING_DAMAGE_MULTIPLIER_PERCENT = 166;
var HOOK_SELF_MSPE_REDUCTION_PERCENT = 10;
var SEKYPS_DAMAGE_PER_STACK = 24;
var REJUVENATION_REGEN_FLAT_PER_STACK = 30;
var REJUVENATION_REGEN_STACK_MAX = 3;
var REJUVENATION_REGEN_FLAT_MAX = REJUVENATION_REGEN_FLAT_PER_STACK * REJUVENATION_REGEN_STACK_MAX;
var TYPE_BUF_REGEN_HEAL_BUFF_ID = "type_buf_regen";
var REJUVENATION_REGEN_HEAL_BUFF_ID = "rejuvenation_regen";
var HEAL_MOVE_HEAL_BUFF_ID = "heal_move";
var RECOVER_MOVE_HEAL_BUFF_ID = "recover_move";
var EFFECT_IDS = [
  "confuse",
  "sleep",
  "stun",
  "happiness",
  "taunt",
  "frustration",
  "nocaute",
  "immobilize",
  "weakness",
  "deterioration",
  "paralyse",
  "silence",
  "rejuvenation"
];
var EFFECT_ID_SET = new Set(EFFECT_IDS);
var CURSE_IDS = [
  "madness",
  "leech_seed",
  "sekyps",
  "destiny_bond",
  "endure"
];
var CURSE_ID_SET = new Set(CURSE_IDS);
var EFFECT_LABELS = {
  confuse: "Confuse",
  sleep: "Sleep",
  stun: "Stun",
  happiness: "Happiness",
  taunt: "Taunt",
  frustration: "Frustration",
  nocaute: "Nocaute",
  immobilize: "Immobilize",
  weakness: "Weakness",
  deterioration: "Deterioration",
  paralyse: "Paralyse",
  silence: "Silence",
  rejuvenation: "Rejuvenation"
};
var CURSE_LABELS = {
  madness: "Madness",
  leech_seed: "Leech Seed",
  sekyps: "Sekyps",
  destiny_bond: "Destiny Bond",
  endure: "Endure"
};
var NEGATIVE_STAT_EFFECT_ID_SET = new Set(["weakness", "deterioration", "paralyse"]);
var ATTACK_STAGE_BUFF_IDS = new Set([
  "power_attack_up",
  "power_attack_stage_up",
  "meditate_attack_up",
  "belly_drum_attack_up"
]);
var POWER_ATTACK_STAGE_BUFF_IDS = new Set(["power_attack_up", "power_attack_stage_up"]);
function clamp_stat_stage(value) {
  return Math.max(STAT_STAGE_MIN, Math.min(STAT_STAGE_MAX, value));
}
function normalize_stat_stage(value, fallback) {
  const raw = typeof value === "number" ? value : fallback;
  return clamp_stat_stage(normalize_int(raw, fallback, STAT_STAGE_MIN));
}
function stage_ratio(stage) {
  const normalized = clamp_stat_stage(stage);
  if (normalized >= 0) {
    return { numerator: 2 + normalized, denominator: 2 };
  }
  return { numerator: 2, denominator: 2 - normalized };
}
function infer_stage_from_attack(current_attack, base_attack) {
  if (!Number.isFinite(current_attack) || !Number.isFinite(base_attack) || base_attack <= 0) {
    return 0;
  }
  const inferred = Math.round(current_attack * 2 / base_attack - 2);
  return clamp_stat_stage(inferred);
}
function stat_value_from_stage(base_value, stage) {
  const ratio = stage_ratio(stage);
  return Math.max(0, mul_div_round(base_value, ratio.numerator, ratio.denominator));
}
function attack_from_stage(base_attack, stage) {
  return stat_value_from_stage(base_attack, stage);
}
function clamp_stat_multiplier_percent(total_percent) {
  return Math.max(STAT_MULTIPLIER_MIN_PERCENT, Math.min(STAT_MULTIPLIER_MAX_PERCENT, total_percent));
}
function stat_multiplier_percent_from_delta(delta_percent) {
  return clamp_stat_multiplier_percent(100 + delta_percent);
}
function stat_value_from_delta_percent(base_value, delta_percent) {
  return Math.max(0, mul_div_round(base_value, stat_multiplier_percent_from_delta(delta_percent), 100));
}
function stat_value_from_delta_percent_and_stage(base_value, delta_percent, stage) {
  const value_after_percent = stat_value_from_delta_percent(base_value, delta_percent);
  return stat_value_from_stage(value_after_percent, stage);
}
function entry_targets_monster(entry, monster_id) {
  return typeof entry.targetMonsterId !== "string" || entry.targetMonsterId.length === 0 || entry.targetMonsterId === monster_id;
}
function buff_debuff_entries_for_monster(state, slot, monster_id) {
  return buff_debuff_list(state, slot).filter((entry) => entry_targets_monster(entry, monster_id));
}
function power_attack_stage_bonus_from_entries(entries) {
  let bonus = 0;
  for (const entry of entries) {
    if (entry.stat !== "attack") {
      continue;
    }
    if (!POWER_ATTACK_STAGE_BUFF_IDS.has(entry.id)) {
      continue;
    }
    bonus += POWER_ATTACK_STAGE_PER_CAST;
  }
  return bonus;
}
function effective_attack_stage_for_monster(state, slot, monster) {
  const attack_delta = total_delta_percent_from_buff_debuffs(state, slot, "attack", monster.id);
  const attack_base_after_percent = stat_value_from_delta_percent(monster.baseAttack, attack_delta);
  const attack_stage_fallback = infer_stage_from_attack(monster.attack, attack_base_after_percent);
  const attack_stage = normalize_stat_stage(monster.attackStage, attack_stage_fallback);
  const power_bonus = power_attack_stage_bonus_from_entries(buff_debuff_entries_for_monster(state, slot, monster.id));
  return clamp_stat_stage(attack_stage + power_bonus);
}
function total_delta_percent_from_buff_debuffs(state, slot, stat, monster_id) {
  const resolved_monster_id = monster_id ?? active_monster(state.players[slot]).id;
  let total = 0;
  for (const entry of buff_debuff_entries_for_monster(state, slot, resolved_monster_id)) {
    if (entry.stat !== stat) {
      continue;
    }
    if (stat === "attack" && ATTACK_STAGE_BUFF_IDS.has(entry.id)) {
      continue;
    }
    total += entry.deltaPercent;
  }
  return total;
}
function refresh_active_monster_stats_for_slot(state, slot) {
  const monster = active_monster(state.players[slot]);
  const entries = buff_debuff_entries_for_monster(state, slot, monster.id);
  const attack_delta = total_delta_percent_from_buff_debuffs(state, slot, "attack", monster.id);
  const defense_delta = total_delta_percent_from_buff_debuffs(state, slot, "defense", monster.id);
  const speed_delta = total_delta_percent_from_buff_debuffs(state, slot, "speed", monster.id);
  const attack_base_after_percent = stat_value_from_delta_percent(monster.baseAttack, attack_delta);
  const attack_stage_fallback = infer_stage_from_attack(monster.attack, attack_base_after_percent);
  const attack_stage = normalize_stat_stage(monster.attackStage, attack_stage_fallback);
  const power_attack_stage_bonus = power_attack_stage_bonus_from_entries(entries);
  const effective_attack_stage = clamp_stat_stage(attack_stage + power_attack_stage_bonus);
  const defense_stage = normalize_stat_stage(monster.defenseStage, 0);
  const speed_stage = normalize_stat_stage(monster.speedStage, 0);
  monster.attackStage = attack_stage;
  monster.defenseStage = defense_stage;
  monster.speedStage = speed_stage;
  monster.attack = stat_value_from_delta_percent_and_stage(monster.baseAttack, attack_delta, effective_attack_stage);
  monster.defense = stat_value_from_delta_percent_and_stage(monster.baseDefense, defense_delta, defense_stage);
  monster.speed = stat_value_from_delta_percent_and_stage(monster.baseSpeed, speed_delta, speed_stage);
  monster.agilityBoostActive = entries.some((entry) => entry.id === "agility_speed_up");
  monster.endureSpeedBoostActive = entries.some((entry) => entry.id === "endure_speed_up");
  monster.bellyDrumActive = effective_attack_stage >= STAT_STAGE_MAX || entries.some((entry) => entry.id === "belly_drum_attack_up");
  monster.screechDebuffActive = entries.some((entry) => entry.id === "screech_def_down");
}
function refresh_active_monster_stats(state) {
  refresh_active_monster_stats_for_slot(state, "player1");
  refresh_active_monster_stats_for_slot(state, "player2");
}
function compare_action_initiative(state, phase, a, b) {
  const a_slot = a.player;
  const b_slot = b.player;
  const a_active = active_monster(state.players[a.player]);
  const b_active = active_monster(state.players[b.player]);
  if (a.type === "move" && b.type === "move") {
    const a_quick = a.moveId === "quick_attack";
    const b_quick = b.moveId === "quick_attack";
    if (a_quick !== b_quick) {
      return a_quick ? 1 : -1;
    }
    if (a_quick && b_quick) {
      return compare_initiative(state, a_slot, b_slot, a_active, b_active, INITIATIVE_WITHOUT_SPEED);
    }
  }
  return compare_initiative(state, a_slot, b_slot, a_active, b_active, phase.initiative);
}
function action_type_order(action) {
  if (action.type === "move")
    return 0;
  if (action.type === "run")
    return 1;
  return 2;
}
function compare_actions_for_phase(state, phase, a, b) {
  const cmp = compare_action_initiative(state, phase, a, b);
  if (cmp !== 0) {
    return -cmp;
  }
  if (a.player !== b.player) {
    return a.player === "player1" ? -1 : 1;
  }
  const type_cmp = action_type_order(a) - action_type_order(b);
  if (type_cmp !== 0) {
    return type_cmp;
  }
  if (a.type === "move" && b.type === "move") {
    return a.moveIndex - b.moveIndex;
  }
  if (a.type === "switch" && b.type === "switch") {
    return a.targetIndex - b.targetIndex;
  }
  return 0;
}
function clone_monster(monster) {
  const base_attack = Number.isFinite(monster.baseAttack) ? monster.baseAttack : monster.attack;
  const base_defense = Number.isFinite(monster.baseDefense) ? monster.baseDefense : monster.defense;
  const base_speed = Number.isFinite(monster.baseSpeed) ? monster.baseSpeed : monster.speed;
  const attack_stage = normalize_stat_stage(monster.attackStage, infer_stage_from_attack(monster.attack, base_attack));
  const defense_stage = normalize_stat_stage(monster.defenseStage, 0);
  const speed_stage = normalize_stat_stage(monster.speedStage, 0);
  const attack_value = Number.isFinite(monster.attack) ? normalize_int(monster.attack, base_attack, 0) : base_attack;
  const defense_value = Number.isFinite(monster.defense) ? normalize_int(monster.defense, base_defense, 0) : base_defense;
  const speed_value = Number.isFinite(monster.speed) ? normalize_int(monster.speed, base_speed, 0) : base_speed;
  return {
    id: monster.id,
    name: monster.name,
    type: monster.type,
    hp: monster.hp,
    maxHp: monster.maxHp,
    mSPE: Math.max(0, normalize_int(monster.mSPE, SHARED_MSPE_START, 0)),
    level: monster.level,
    baseAttack: base_attack,
    baseDefense: base_defense,
    baseSpeed: base_speed,
    attack: attack_value,
    attackStage: attack_stage,
    defense: defense_value,
    defenseStage: defense_stage,
    speed: speed_value,
    speedStage: speed_stage,
    agilityBoostActive: !!monster.agilityBoostActive,
    endureSpeedBoostActive: !!monster.endureSpeedBoostActive,
    bellyDrumActive: !!monster.bellyDrumActive,
    screechDebuffActive: !!monster.screechDebuffActive,
    possibleMoves: monster.possibleMoves.slice(),
    possiblePassives: monster.possiblePassives.slice(),
    chosenMoves: monster.chosenMoves.slice(),
    chosenPassive: monster.chosenPassive,
    protectActiveThisTurn: monster.protectActiveThisTurn,
    endureActiveThisTurn: monster.endureActiveThisTurn,
    baitActiveThisTurn: !!monster.baitActiveThisTurn,
    protectCooldownTurns: monster.protectCooldownTurns,
    endureCooldownTurns: monster.endureCooldownTurns
  };
}
function empty_slot_record(player1, player2) {
  return { player1, player2 };
}
function empty_pending() {
  return empty_slot_record(false, false);
}
function empty_pending_switch_reason() {
  return empty_slot_record("none", "none");
}
function empty_pending_switch_resolved_this_turn() {
  return empty_slot_record(false, false);
}
function empty_rps_score() {
  return empty_slot_record(0, 0);
}
function empty_type_passive_armor_stacks() {
  return empty_slot_record(0, 0);
}
function empty_type_passive_regen_stacks() {
  return empty_slot_record(0, 0);
}
function empty_rejuvenation_stacks() {
  return empty_slot_record(0, 0);
}
function empty_rejuvenation_start_turn() {
  return empty_slot_record(0, 0);
}
function empty_pending_wish() {
  return empty_slot_record(null, null);
}
function empty_taunt_until_turn() {
  return empty_slot_record(0, 0);
}
function empty_active_effects() {
  return empty_slot_record([], []);
}
function empty_active_buff_debuffs() {
  return empty_slot_record([], []);
}
function empty_active_heal_buffs() {
  return empty_slot_record([], []);
}
function empty_last_move_index() {
  return empty_slot_record(null, null);
}
function empty_mSPE_telemetry() {
  const empty_entry = () => ({
    effectiveMSPE: SHARED_MSPE_START,
    mSPEGoal: MSPE_VALUE_GOAL,
    mSPEReady: false,
    gapPercent: 0,
    gapGoalPercent: MSPE_GAP_GOAL_PERCENT,
    gapReady: false,
    canMSPE: false
  });
  return empty_slot_record(empty_entry(), empty_entry());
}
function empty_active_curses() {
  return empty_slot_record([], []);
}
function empty_arena_trap_until_turn() {
  return empty_slot_record(0, 0);
}
function empty_spikes_armed_by_target() {
  return empty_slot_record(false, false);
}
function effect_label(effect_id) {
  if (effect_id in EFFECT_LABELS) {
    return EFFECT_LABELS[effect_id];
  }
  return effect_id;
}
function curse_label(curse_id) {
  if (curse_id in CURSE_LABELS) {
    return CURSE_LABELS[curse_id];
  }
  return curse_id;
}
function normalize_active_effects(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  const normalized = [];
  for (const item of input) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item;
    if (typeof row.id !== "string" || !EFFECT_ID_SET.has(row.id)) {
      continue;
    }
    const remaining_raw = typeof row.remainingTurns === "number" ? row.remainingTurns : 1;
    const remaining = Math.max(1, normalize_int(remaining_raw, 1, 1));
    const applied_turn = typeof row.appliedTurn === "number" && Number.isFinite(row.appliedTurn) ? normalize_int(row.appliedTurn, 0, -1e6) : undefined;
    normalized.push({ id: row.id, remainingTurns: remaining, appliedTurn: applied_turn });
  }
  return normalized;
}
function normalize_active_curses(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  const normalized = [];
  for (const item of input) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item;
    if (typeof row.id !== "string" || !CURSE_ID_SET.has(row.id)) {
      continue;
    }
    const source_slot = row.sourceSlot === "player1" || row.sourceSlot === "player2" ? row.sourceSlot : null;
    const raw_stacks = typeof row.stacks === "number" ? row.stacks : 1;
    const stacks = Math.max(1, normalize_int(raw_stacks, 1, 1));
    const applied_turn = typeof row.appliedTurn === "number" && Number.isFinite(row.appliedTurn) ? normalize_int(row.appliedTurn, 0, -1e6) : undefined;
    normalized.push({ id: row.id, sourceSlot: source_slot, stacks, appliedTurn: applied_turn });
  }
  return normalized;
}
function is_buff_debuff_stat(value) {
  return value === "attack" || value === "defense" || value === "speed";
}
function normalize_active_buff_debuffs(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  const normalized = [];
  for (const item of input) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item;
    if (typeof row.id !== "string" || row.id.trim().length === 0) {
      continue;
    }
    if (!is_buff_debuff_stat(row.stat)) {
      continue;
    }
    const source_slot = row.sourceSlot === "player1" || row.sourceSlot === "player2" ? row.sourceSlot : null;
    const source = typeof row.source === "string" && row.source.trim().length > 0 ? row.source : "unknown";
    const raw_delta = typeof row.deltaPercent === "number" ? row.deltaPercent : 0;
    const delta = normalize_int(raw_delta, 0, -1e6);
    const clears_on_switch = row.clearsOnSwitch === true;
    const target_monster_id = typeof row.targetMonsterId === "string" && row.targetMonsterId.trim().length > 0 ? row.targetMonsterId : undefined;
    normalized.push({
      id: row.id,
      sourceSlot: source_slot,
      source,
      stat: row.stat,
      deltaPercent: delta,
      clearsOnSwitch: clears_on_switch,
      ...target_monster_id ? { targetMonsterId: target_monster_id } : {}
    });
  }
  return normalized;
}
function normalize_active_heal_buffs(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  const normalized = [];
  for (const item of input) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item;
    if (typeof row.id !== "string" || row.id.trim().length === 0) {
      continue;
    }
    const source_slot = row.sourceSlot === "player1" || row.sourceSlot === "player2" ? row.sourceSlot : null;
    const source = typeof row.source === "string" && row.source.trim().length > 0 ? row.source : "unknown";
    const heal_per_turn = Math.max(0, normalize_int(typeof row.healPerTurn === "number" ? row.healPerTurn : 0, 0, 0));
    const growth_per_turn = normalize_int(typeof row.growthPerTurn === "number" ? row.growthPerTurn : 0, 0, -1e6);
    const start_turn = Math.max(0, normalize_int(typeof row.startTurn === "number" ? row.startTurn : 0, 0, 0));
    const remaining_ticks_raw = row.remainingTicks;
    const remaining_ticks = typeof remaining_ticks_raw === "number" && Number.isFinite(remaining_ticks_raw) ? Math.max(1, normalize_int(remaining_ticks_raw, 1, 1)) : null;
    const clears_on_switch = row.clearsOnSwitch === true;
    normalized.push({
      id: row.id,
      sourceSlot: source_slot,
      source,
      healPerTurn: heal_per_turn,
      growthPerTurn: growth_per_turn,
      startTurn: start_turn,
      remainingTicks: remaining_ticks,
      clearsOnSwitch: clears_on_switch
    });
  }
  return normalized;
}
function effect_list(state, slot) {
  return state.activeEffectsBySlot?.[slot] ?? [];
}
function curse_list(state, slot) {
  return state.activeCursesBySlot?.[slot] ?? [];
}
function buff_debuff_list(state, slot) {
  return state.activeBuffDebuffsBySlot?.[slot] ?? [];
}
function heal_buff_list(state, slot) {
  return state.activeHealBuffsBySlot?.[slot] ?? [];
}
function effect_state(state, slot, effect_id) {
  for (const effect of effect_list(state, slot)) {
    if (effect.id === effect_id) {
      return effect;
    }
  }
  return null;
}
function curse_state(state, slot, curse_id) {
  for (const curse of curse_list(state, slot)) {
    if (curse.id === curse_id) {
      return curse;
    }
  }
  return null;
}
function heal_buff_state(state, slot, heal_buff_id) {
  for (const buff of heal_buff_list(state, slot)) {
    if (buff.id === heal_buff_id) {
      return buff;
    }
  }
  return null;
}
function has_effect(state, slot, effect_id) {
  return !!effect_state(state, slot, effect_id);
}
function curse_stacks(state, slot, curse_id) {
  return curse_state(state, slot, curse_id)?.stacks ?? 0;
}
function effect_turns_remaining(state, slot, effect_id) {
  return effect_state(state, slot, effect_id)?.remainingTurns ?? 0;
}
function is_negative_stat_effect_id(effect_id) {
  return NEGATIVE_STAT_EFFECT_ID_SET.has(effect_id);
}
function is_negative_stat_buff_debuff(entry) {
  return (entry.stat === "attack" || entry.stat === "defense" || entry.stat === "speed") && normalize_int(entry.deltaPercent, 0, -99999) < 0;
}
function upsert_effect(state, log, target_slot, effect_id, duration_turns, source_slot, source_move_id) {
  ensure_state_runtime_defaults(state);
  const duration = Math.max(1, normalize_int(duration_turns, 1, 1));
  const effects = state.activeEffectsBySlot[target_slot];
  const existing = effects.find((entry) => entry.id === effect_id) ?? null;
  const before_remaining = existing?.remainingTurns ?? 0;
  if (existing) {
    existing.remainingTurns = Math.max(existing.remainingTurns, duration);
    existing.appliedTurn = state.turn;
  } else {
    effects.push({ id: effect_id, remainingTurns: duration, appliedTurn: state.turn });
  }
  const after_remaining = existing?.remainingTurns ?? duration;
  log.push({
    type: "effect_apply",
    turn: state.turn,
    summary: `${effect_label(effect_id)} applied on ${target_slot} (${after_remaining} turn${after_remaining === 1 ? "" : "s"})`,
    data: {
      slot: source_slot,
      targetSlot: target_slot,
      move: source_move_id,
      effect: effect_id,
      beforeTurns: before_remaining,
      afterTurns: after_remaining
    }
  });
}
function apply_move_effects_from_collateral(state, log, source_slot, collaterals, source_move_id) {
  if (collaterals.length === 0) {
    return;
  }
  for (const collateral of collaterals) {
    const target_slot = collateral.target === "self" ? source_slot : other_slot(source_slot);
    upsert_effect(state, log, target_slot, collateral.id, collateral.maxDurationTurns, source_slot, source_move_id);
  }
}
function upsert_curse(state, log, target_slot, curse_id, source_slot, source_move_id) {
  ensure_state_runtime_defaults(state);
  const curses = state.activeCursesBySlot[target_slot];
  const existing = curses.find((entry) => entry.id === curse_id) ?? null;
  if (existing) {
    if (curse_id === "sekyps") {
      const before_stack = Math.max(1, normalize_int(existing.stacks, 1, 1));
      const after_stack = before_stack + 1;
      existing.stacks = after_stack;
      existing.appliedTurn = state.turn;
      log.push({
        type: "curse_apply",
        turn: state.turn,
        summary: `Sekyps stacked on ${target_slot} (${before_stack} -> ${after_stack})`,
        data: {
          slot: source_slot,
          targetSlot: target_slot,
          move: source_move_id,
          curse: curse_id,
          alreadyActive: true,
          stackBefore: before_stack,
          stackAfter: after_stack
        }
      });
      return;
    }
    log.push({
      type: "curse_apply",
      turn: state.turn,
      summary: `${curse_label(curse_id)} already active on ${target_slot} (no stack)`,
      data: {
        slot: source_slot,
        targetSlot: target_slot,
        move: source_move_id,
        curse: curse_id,
        alreadyActive: true
      }
    });
    return;
  }
  curses.push({
    id: curse_id,
    sourceSlot: source_slot,
    stacks: 1,
    appliedTurn: state.turn
  });
  log.push({
    type: "curse_apply",
    turn: state.turn,
    summary: `${curse_label(curse_id)} cursed ${target_slot}`,
    data: {
      slot: source_slot,
      targetSlot: target_slot,
      move: source_move_id,
      curse: curse_id,
      alreadyActive: false
    }
  });
}
function upsert_heal_buff(state, log, target_slot, source_slot, source_move_id, options) {
  ensure_state_runtime_defaults(state);
  const heal_per_turn = Math.max(0, normalize_int(options.healPerTurn, 0, 0));
  const growth_per_turn = normalize_int(options.growthPerTurn ?? 0, 0, -1e6);
  const start_turn = Math.max(0, normalize_int(options.startTurn ?? state.turn, state.turn, 0));
  const remaining_ticks = typeof options.remainingTicks === "number" && Number.isFinite(options.remainingTicks) ? Math.max(1, normalize_int(options.remainingTicks, 1, 1)) : null;
  const clears_on_switch = options.clearsOnSwitch === true;
  const buffs = state.activeHealBuffsBySlot[target_slot];
  const existing = buffs.find((entry) => entry.id === options.id) ?? null;
  if (existing) {
    const before_heal_per_turn = existing.healPerTurn;
    const before_growth_per_turn = existing.growthPerTurn;
    existing.healPerTurn = Math.max(0, existing.healPerTurn + heal_per_turn);
    existing.growthPerTurn = normalize_int(existing.growthPerTurn + growth_per_turn, existing.growthPerTurn, -1e6);
    existing.startTurn = Math.min(existing.startTurn, start_turn);
    if (existing.remainingTicks === null || remaining_ticks === null) {
      existing.remainingTicks = null;
    } else {
      existing.remainingTicks = Math.max(existing.remainingTicks, remaining_ticks);
    }
    existing.clearsOnSwitch = existing.clearsOnSwitch || clears_on_switch;
    existing.source = options.source;
    existing.sourceSlot = source_slot;
    log.push({
      type: "heal_buff_apply",
      turn: state.turn,
      summary: `Heal buff ${options.id} updated on ${target_slot} (${before_heal_per_turn} -> ${existing.healPerTurn}/turn)`,
      data: {
        slot: source_slot,
        targetSlot: target_slot,
        move: source_move_id,
        buff: options.id,
        source: options.source,
        healPerTurnBefore: before_heal_per_turn,
        healPerTurnAfter: existing.healPerTurn,
        growthPerTurnBefore: before_growth_per_turn,
        growthPerTurnAfter: existing.growthPerTurn,
        startTurn: existing.startTurn,
        remainingTicks: existing.remainingTicks,
        clearsOnSwitch: existing.clearsOnSwitch
      }
    });
    return existing;
  }
  const created = {
    id: options.id,
    sourceSlot: source_slot,
    source: options.source,
    healPerTurn: heal_per_turn,
    growthPerTurn: growth_per_turn,
    startTurn: start_turn,
    remainingTicks: remaining_ticks,
    clearsOnSwitch: clears_on_switch
  };
  buffs.push(created);
  log.push({
    type: "heal_buff_apply",
    turn: state.turn,
    summary: `Heal buff ${options.id} applied on ${target_slot} (+${heal_per_turn}/turn)`,
    data: {
      slot: source_slot,
      targetSlot: target_slot,
      move: source_move_id,
      buff: options.id,
      source: options.source,
      healPerTurn: created.healPerTurn,
      growthPerTurn: created.growthPerTurn,
      startTurn: created.startTurn,
      remainingTicks: created.remainingTicks,
      clearsOnSwitch: created.clearsOnSwitch
    }
  });
  return created;
}
function apply_heal_amount(state, slot, hp_changed, heal_amount) {
  const player = state.players[slot];
  const target = active_monster(player);
  const before_hp = player.sharedHp;
  const heal_attempt = Math.max(0, normalize_int(heal_amount, 0, 0));
  const after_hp = Math.min(player.sharedHpMax, before_hp + heal_attempt);
  const healed = Math.max(0, after_hp - before_hp);
  if (healed > 0) {
    sync_player_shared_hp(state, slot, after_hp);
    hp_changed.add(target);
  }
  return { before: before_hp, after: after_hp, healed };
}
function apply_heal_buff_tick(state, log, slot, hp_changed, buff, phase = END_PHASE_ID) {
  const player = state.players[slot];
  const target = active_monster(player);
  const heal_per_turn = Math.max(0, normalize_int(buff.healPerTurn, 0, 0));
  let next_heal_per_turn = Math.max(0, normalize_int(buff.healPerTurn + buff.growthPerTurn, buff.healPerTurn, 0));
  let heal_attempt = heal_per_turn;
  if (buff.id === REJUVENATION_REGEN_HEAL_BUFF_ID) {
    const base_regen = REJUVENATION_REGEN_FLAT_PER_STACK;
    const max_regen_per_turn = base_regen * REJUVENATION_REGEN_STACK_MAX;
    heal_attempt = Math.min(max_regen_per_turn, heal_per_turn);
    next_heal_per_turn = Math.min(max_regen_per_turn, next_heal_per_turn);
  }
  const result = apply_heal_amount(state, slot, hp_changed, heal_attempt);
  if (buff.id === TYPE_BUF_REGEN_HEAL_BUFF_ID) {
    const regen_stack = Math.max(0, Math.floor(heal_per_turn / TYPE_PASSIVE_BUF_REGEN_PER_STACK));
    state.typePassiveRegenStacks[slot] = regen_stack;
    log.push({
      type: "type_passive_regen",
      turn: state.turn,
      phase,
      summary: `${target.name} healed ${result.healed} from BUF passive (${regen_stack} stack)`,
      data: {
        slot,
        target: target.id,
        regenStack: regen_stack,
        healPerStack: TYPE_PASSIVE_BUF_REGEN_PER_STACK,
        healAttempted: heal_per_turn,
        healApplied: result.healed,
        before: result.before,
        after: result.after
      }
    });
  } else if (buff.id === REJUVENATION_REGEN_HEAL_BUFF_ID) {
    const base_regen = REJUVENATION_REGEN_FLAT_PER_STACK;
    const stack = Math.min(REJUVENATION_REGEN_STACK_MAX, Math.max(1, Math.floor(Math.max(1, heal_attempt) / base_regen)));
    const next_stack = Math.min(REJUVENATION_REGEN_STACK_MAX, Math.max(1, Math.floor(Math.max(1, next_heal_per_turn) / base_regen)));
    state.rejuvenationStacks[slot] = next_stack;
    state.rejuvenationStartTurn[slot] = buff.startTurn;
    log.push({
      type: "rejuvenation_regen",
      turn: state.turn,
      phase,
      summary: `${target.name} healed ${result.healed} from Rejuvenation regen (stack ${stack}: +${heal_attempt}/turn)`,
      data: {
        slot,
        target: target.id,
        stack,
        nextStack: next_stack,
        healPerTurn: heal_attempt,
        nextHealPerTurn: next_heal_per_turn,
        healAttempted: heal_attempt,
        healApplied: result.healed,
        before: result.before,
        after: result.after
      }
    });
  } else if (buff.id === HEAL_MOVE_HEAL_BUFF_ID) {
    log.push({
      type: "passive_heal",
      turn: state.turn,
      phase,
      summary: `${target.name} healed ${result.healed} with Heal`,
      data: {
        slot,
        source: target.id,
        target: target.id,
        amount: result.healed,
        before: result.before,
        after: result.after
      }
    });
  } else if (buff.id === RECOVER_MOVE_HEAL_BUFF_ID) {
    log.push({
      type: "passive_heal",
      turn: state.turn,
      phase,
      summary: `${target.name} healed ${result.healed} with Recover`,
      data: {
        slot,
        source: target.id,
        target: target.id,
        amount: result.healed,
        before: result.before,
        after: result.after
      }
    });
  } else {
    log.push({
      type: "heal_buff_tick",
      turn: state.turn,
      phase,
      summary: `${target.name} healed ${result.healed} from ${buff.source}`,
      data: {
        slot,
        sourceSlot: buff.sourceSlot,
        source: buff.source,
        buff: buff.id,
        healAttempted: heal_attempt,
        healApplied: result.healed,
        before: result.before,
        after: result.after
      }
    });
  }
  buff.healPerTurn = next_heal_per_turn;
  if (buff.id === REJUVENATION_REGEN_HEAL_BUFF_ID) {
    buff.growthPerTurn = 0;
  }
  if (buff.remainingTicks !== null) {
    buff.remainingTicks = Math.max(0, buff.remainingTicks - 1);
  }
  return buff.remainingTicks === null || buff.remainingTicks > 0;
}
function apply_heal_buffs_end_turn_by_id(state, log, slot, hp_changed, heal_buff_id) {
  ensure_state_runtime_defaults(state);
  const buffs = state.activeHealBuffsBySlot[slot];
  if (!Array.isArray(buffs) || buffs.length === 0) {
    return;
  }
  const next = [];
  for (const buff of buffs) {
    if (buff.id !== heal_buff_id) {
      next.push(buff);
      continue;
    }
    if (state.turn < buff.startTurn) {
      next.push(buff);
      continue;
    }
    const keep = apply_heal_buff_tick(state, log, slot, hp_changed, buff, END_PHASE_ID);
    if (keep) {
      next.push(buff);
      continue;
    }
    log.push({
      type: "heal_buff_end",
      turn: state.turn,
      phase: END_PHASE_ID,
      summary: `Heal buff ${buff.id} ended on ${slot}`,
      data: { targetSlot: slot, buff: buff.id, source: buff.source, sourceSlot: buff.sourceSlot }
    });
  }
  state.activeHealBuffsBySlot[slot] = next;
  if (heal_buff_id === TYPE_BUF_REGEN_HEAL_BUFF_ID && !next.some((entry) => entry.id === TYPE_BUF_REGEN_HEAL_BUFF_ID)) {
    state.typePassiveRegenStacks[slot] = 0;
  }
  if (heal_buff_id === REJUVENATION_REGEN_HEAL_BUFF_ID && !next.some((entry) => entry.id === REJUVENATION_REGEN_HEAL_BUFF_ID)) {
    state.rejuvenationStacks[slot] = 0;
    state.rejuvenationStartTurn[slot] = 0;
  }
}
function apply_move_curses_from_collateral(state, log, source_slot, collaterals, source_move_id) {
  if (collaterals.length === 0) {
    return;
  }
  for (const collateral of collaterals) {
    const target_slot = source_slot === "player1" ? "player2" : "player1";
    upsert_curse(state, log, target_slot, collateral.id, source_slot, source_move_id);
  }
}
function stat_label_for_buff(stat) {
  if (stat === "attack")
    return "ATK";
  if (stat === "defense")
    return "DEF";
  return "DEX";
}
function stat_value_for_active_monster(monster, stat) {
  if (stat === "attack")
    return monster.attack;
  if (stat === "defense")
    return monster.defense;
  return monster.speed;
}
function apply_buff_debuff_component(state, log, target_slot, collateral, source_slot, source_move_id, options) {
  ensure_state_runtime_defaults(state);
  const target = active_monster(state.players[target_slot]);
  refresh_active_monster_stats_for_slot(state, target_slot);
  const before = stat_value_for_active_monster(target, collateral.stat);
  const clears_on_switch = collateral.clearsOnSwitch === true;
  const target_monster_id = typeof options?.targetMonsterId === "string" ? options.targetMonsterId : undefined;
  state.activeBuffDebuffsBySlot[target_slot].push({
    id: collateral.id,
    sourceSlot: source_slot,
    source: source_move_id,
    stat: collateral.stat,
    deltaPercent: collateral.deltaPercent,
    clearsOnSwitch: clears_on_switch,
    ...target_monster_id ? { targetMonsterId: target_monster_id } : {}
  });
  refresh_active_monster_stats_for_slot(state, target_slot);
  const after = stat_value_for_active_monster(target, collateral.stat);
  const total_delta = total_delta_percent_from_buff_debuffs(state, target_slot, collateral.stat);
  const total_percent = stat_multiplier_percent_from_delta(total_delta);
  log.push({
    type: "buff_debuff_apply",
    turn: state.turn,
    summary: `${target.name} ${stat_label_for_buff(collateral.stat)} ${(collateral.deltaPercent >= 0 ? "+" : "") + collateral.deltaPercent}%`,
    data: {
      slot: source_slot,
      targetSlot: target_slot,
      move: source_move_id,
      componentId: collateral.id,
      stat: collateral.stat,
      deltaPercent: collateral.deltaPercent,
      totalDeltaPercent: total_delta,
      totalPercent: total_percent,
      before,
      after
    }
  });
}
function apply_move_buff_debuffs_from_collateral(state, log, source_slot, collaterals, source_move_id) {
  if (collaterals.length === 0) {
    return;
  }
  for (const collateral of collaterals) {
    const target_slot = collateral.target === "self" ? source_slot : other_slot(source_slot);
    apply_buff_debuff_component(state, log, target_slot, collateral, source_slot, source_move_id);
  }
}
function apply_move_instants_from_collateral(state, log, source_slot, collaterals, source_move_id) {
  if (collaterals.length === 0) {
    return;
  }
  for (const collateral of collaterals) {
    const target_slot = collateral.target === "self" ? source_slot : other_slot(source_slot);
    log.push({
      type: "instant_trigger",
      turn: state.turn,
      summary: `Instant ${collateral.id} triggered by ${source_move_id}`,
      data: {
        slot: source_slot,
        targetSlot: target_slot,
        move: source_move_id,
        instant: collateral.id
      }
    });
  }
}
function decay_effects_end_turn(state, log) {
  ensure_state_runtime_defaults(state);
  for (const slot of SLOT_ORDER) {
    const current = state.activeEffectsBySlot[slot];
    if (!Array.isArray(current) || current.length === 0) {
      state.activeEffectsBySlot[slot] = [];
      continue;
    }
    const next = [];
    for (const effect of current) {
      if ((effect.appliedTurn ?? -1) === state.turn) {
        next.push({ id: effect.id, remainingTurns: Math.max(1, normalize_int(effect.remainingTurns, 1, 1)) });
        continue;
      }
      const remaining = Math.max(0, normalize_int(effect.remainingTurns, 1, 0) - 1);
      if (remaining > 0) {
        next.push({ id: effect.id, remainingTurns: remaining });
        continue;
      }
      log.push({
        type: "effect_end",
        turn: state.turn,
        summary: `${effect_label(effect.id)} ended on ${slot}`,
        data: { targetSlot: slot, effect: effect.id }
      });
    }
    state.activeEffectsBySlot[slot] = next;
  }
}
function is_slot_taunted(state, slot) {
  return (state.tauntUntilTurn?.[slot] ?? 0) >= state.turn || has_effect(state, slot, "taunt");
}
function normalize_type_passive_stack(value, fallback, min, max) {
  const raw = typeof value === "number" ? value : fallback;
  return Math.max(min, Math.min(max, normalize_int(raw, fallback, min)));
}
function is_slot_arena_trapped(state, slot) {
  const trapped_until = state.arenaTrapUntilTurn?.[slot] ?? 0;
  return trapped_until > 0 && trapped_until >= state.turn;
}
function type_passive_armor_stack(state, slot) {
  return normalize_type_passive_stack(state.typePassiveArmorStacks?.[slot], 0, 0, TYPE_PASSIVE_DEF_ARMOR_STACK_MAX);
}
function is_slot_clear_body_active(state, slot) {
  return type_passive_armor_stack(state, slot) > 0;
}
function is_attack_move(spec) {
  if (spec.phaseId !== "attack_01") {
    return false;
  }
  return !TAUNT_BLOCKED_MOVE_IDS.has(spec.id);
}
function is_skill_move(spec) {
  return !is_attack_move(spec);
}
function has_available_switch_target(player) {
  return first_available_switch_target(player) !== null;
}
function first_available_switch_target(player) {
  for (let index = 0;index < player.team.length; index++) {
    if (index === player.activeIndex) {
      continue;
    }
    if (is_alive(player.team[index])) {
      return index;
    }
  }
  return null;
}
function switch_block_reason(state, slot) {
  if (is_slot_arena_trapped(state, slot)) {
    return "arena trapped";
  }
  if (is_slot_taunted(state, slot)) {
    return "taunt";
  }
  if (has_effect(state, slot, "confuse")) {
    return "confuse";
  }
  if (has_effect(state, slot, "immobilize")) {
    return "immobilize";
  }
  return null;
}
function move_block_reason(state, slot, move_index, spec) {
  const player = state.players[slot];
  const attack_move = is_attack_move(spec);
  const skill_move = is_skill_move(spec);
  const has_switch_target = has_available_switch_target(player);
  if (has_switch_target && has_effect(state, slot, "nocaute")) {
    return "nocaute";
  }
  if (has_effect(state, slot, "sleep")) {
    return "sleep";
  }
  if (attack_move && has_effect(state, slot, "stun")) {
    return "stun";
  }
  if (attack_move && has_effect(state, slot, "confuse")) {
    return "confuse";
  }
  if (skill_move && has_effect(state, slot, "silence")) {
    return "silence";
  }
  if (skill_move && is_slot_taunted(state, slot)) {
    return "taunt";
  }
  const last_move = state.lastMoveIndexBySlot?.[slot] ?? null;
  if (typeof last_move === "number" && has_effect(state, slot, "frustration") && move_index === last_move) {
    return "frustration";
  }
  if (typeof last_move === "number" && has_effect(state, slot, "happiness") && move_index !== last_move) {
    return "happiness";
  }
  return null;
}
function run_block_reason(state, slot) {
  const player = state.players[slot];
  if (has_available_switch_target(player) && has_effect(state, slot, "nocaute")) {
    return "nocaute";
  }
  if (has_effect(state, slot, "sleep")) {
    return "sleep";
  }
  if (has_effect(state, slot, "silence")) {
    return "silence";
  }
  if (is_slot_taunted(state, slot)) {
    return "taunt";
  }
  return null;
}
function move_block_summary(slot, reason, spec_label) {
  if (reason === "nocaute") {
    return `${slot} cannot use ${spec_label} (Nocaute forces switch)`;
  }
  if (reason === "sleep") {
    return `${slot} cannot use ${spec_label} (Sleep)`;
  }
  if (reason === "stun") {
    return `${slot} cannot use ${spec_label} (Stun blocks moves)`;
  }
  if (reason === "silence") {
    return `${slot} cannot use ${spec_label} (Silence blocks skills)`;
  }
  if (reason === "taunt") {
    return `${slot} cannot use ${spec_label} (Taunt forces attack moves)`;
  }
  if (reason === "happiness") {
    return `${slot} cannot use ${spec_label} (Happiness allows only last move)`;
  }
  if (reason === "frustration") {
    return `${slot} cannot use ${spec_label} (Frustration blocks last move)`;
  }
  return `${slot} cannot use ${spec_label} (${effect_label(reason)})`;
}
function mark_last_move_used(state, slot, move_id, move_index) {
  ensure_state_runtime_defaults(state);
  if (move_id === "none") {
    return;
  }
  state.lastMoveIndexBySlot[slot] = move_index;
}
function clone_player(player) {
  const active = player.team[player.activeIndex] ?? player.team[0];
  const fallback_max_hp = active ? normalize_int(active.maxHp, SHARED_HP_START, 1) : SHARED_HP_START;
  const shared_hp_max = Math.max(1, normalize_int(player.sharedHpMax, fallback_max_hp, 1));
  const fallback_shared_hp = active ? normalize_int(active.hp, shared_hp_max, 0) : shared_hp_max;
  const shared_hp = Math.max(0, Math.min(shared_hp_max, normalize_int(player.sharedHp, fallback_shared_hp, 0)));
  const fallback_shared_mSPE = active ? normalize_int(active.mSPE, SHARED_MSPE_START, 0) : SHARED_MSPE_START;
  const shared_mSPE = Math.max(0, normalize_int(player.sharedMSPE, fallback_shared_mSPE, 0));
  return {
    slot: player.slot,
    name: player.name,
    sharedHp: shared_hp,
    sharedHpMax: shared_hp_max,
    sharedMSPE: shared_mSPE,
    team: player.team.map(clone_monster),
    activeIndex: player.activeIndex
  };
}
function clone_state(state) {
  const cloned = {
    turn: state.turn,
    status: state.status,
    winner: state.winner,
    endReason: state.endReason,
    mSPESlots: Array.isArray(state.mSPESlots) ? state.mSPESlots.slice() : undefined,
    baseTurnLimit: Math.max(1, normalize_int(state.baseTurnLimit, BASE_TURN_LIMIT, 1)),
    rpsScore: empty_rps_score(),
    mSPETelemetry: empty_mSPE_telemetry(),
    typePassiveArmorStacks: empty_type_passive_armor_stacks(),
    typePassiveRegenStacks: empty_type_passive_regen_stacks(),
    rejuvenationStacks: empty_rejuvenation_stacks(),
    rejuvenationStartTurn: empty_rejuvenation_start_turn(),
    arenaTrapUntilTurn: empty_arena_trap_until_turn(),
    spikesArmedByTarget: empty_spikes_armed_by_target(),
    players: {
      player1: clone_player(state.players.player1),
      player2: clone_player(state.players.player2)
    },
    pendingSwitch: empty_pending(),
    pendingSwitchReason: empty_pending_switch_reason(),
    pendingSwitchResolvedThisTurn: empty_pending_switch_resolved_this_turn(),
    pendingWish: empty_pending_wish(),
    tauntUntilTurn: empty_taunt_until_turn(),
    activeEffectsBySlot: empty_active_effects(),
    activeCursesBySlot: empty_active_curses(),
    activeBuffDebuffsBySlot: empty_active_buff_debuffs(),
    activeHealBuffsBySlot: empty_active_heal_buffs(),
    lastMoveIndexBySlot: empty_last_move_index()
  };
  cloned.rpsScore.player1 = normalize_int(state.rpsScore?.player1, 0, -99999);
  cloned.rpsScore.player2 = normalize_int(state.rpsScore?.player2, 0, -99999);
  cloned.typePassiveArmorStacks.player1 = normalize_type_passive_stack(state.typePassiveArmorStacks?.player1, 0, 0, TYPE_PASSIVE_DEF_ARMOR_STACK_MAX);
  cloned.typePassiveArmorStacks.player2 = normalize_type_passive_stack(state.typePassiveArmorStacks?.player2, 0, 0, TYPE_PASSIVE_DEF_ARMOR_STACK_MAX);
  cloned.typePassiveRegenStacks.player1 = normalize_type_passive_stack(state.typePassiveRegenStacks?.player1, 0, 0, 9999);
  cloned.typePassiveRegenStacks.player2 = normalize_type_passive_stack(state.typePassiveRegenStacks?.player2, 0, 0, 9999);
  cloned.rejuvenationStacks.player1 = normalize_type_passive_stack(state.rejuvenationStacks?.player1, 0, 0, REJUVENATION_REGEN_STACK_MAX);
  cloned.rejuvenationStacks.player2 = normalize_type_passive_stack(state.rejuvenationStacks?.player2, 0, 0, REJUVENATION_REGEN_STACK_MAX);
  cloned.rejuvenationStartTurn.player1 = normalize_int(state.rejuvenationStartTurn?.player1, 0, 0);
  cloned.rejuvenationStartTurn.player2 = normalize_int(state.rejuvenationStartTurn?.player2, 0, 0);
  cloned.arenaTrapUntilTurn.player1 = normalize_int(state.arenaTrapUntilTurn?.player1, 0, 0);
  cloned.arenaTrapUntilTurn.player2 = normalize_int(state.arenaTrapUntilTurn?.player2, 0, 0);
  cloned.spikesArmedByTarget.player1 = !!state.spikesArmedByTarget?.player1;
  cloned.spikesArmedByTarget.player2 = !!state.spikesArmedByTarget?.player2;
  cloned.pendingSwitch.player1 = !!state.pendingSwitch?.player1;
  cloned.pendingSwitch.player2 = !!state.pendingSwitch?.player2;
  cloned.pendingSwitchReason.player1 = state.pendingSwitchReason?.player1 ?? "none";
  cloned.pendingSwitchReason.player2 = state.pendingSwitchReason?.player2 ?? "none";
  cloned.pendingSwitchResolvedThisTurn.player1 = !!state.pendingSwitchResolvedThisTurn?.player1;
  cloned.pendingSwitchResolvedThisTurn.player2 = !!state.pendingSwitchResolvedThisTurn?.player2;
  cloned.pendingWish.player1 = state.pendingWish?.player1 ?? null;
  cloned.pendingWish.player2 = state.pendingWish?.player2 ?? null;
  cloned.tauntUntilTurn.player1 = state.tauntUntilTurn?.player1 ?? 0;
  cloned.tauntUntilTurn.player2 = state.tauntUntilTurn?.player2 ?? 0;
  cloned.activeEffectsBySlot.player1 = normalize_active_effects(state.activeEffectsBySlot?.player1);
  cloned.activeEffectsBySlot.player2 = normalize_active_effects(state.activeEffectsBySlot?.player2);
  cloned.activeCursesBySlot.player1 = normalize_active_curses(state.activeCursesBySlot?.player1);
  cloned.activeCursesBySlot.player2 = normalize_active_curses(state.activeCursesBySlot?.player2);
  cloned.activeBuffDebuffsBySlot.player1 = normalize_active_buff_debuffs(state.activeBuffDebuffsBySlot?.player1);
  cloned.activeBuffDebuffsBySlot.player2 = normalize_active_buff_debuffs(state.activeBuffDebuffsBySlot?.player2);
  cloned.activeHealBuffsBySlot.player1 = normalize_active_heal_buffs(state.activeHealBuffsBySlot?.player1);
  cloned.activeHealBuffsBySlot.player2 = normalize_active_heal_buffs(state.activeHealBuffsBySlot?.player2);
  const last_move_p1 = state.lastMoveIndexBySlot?.player1;
  const last_move_p2 = state.lastMoveIndexBySlot?.player2;
  cloned.lastMoveIndexBySlot.player1 = typeof last_move_p1 === "number" && Number.isInteger(last_move_p1) ? Math.max(0, last_move_p1) : null;
  cloned.lastMoveIndexBySlot.player2 = typeof last_move_p2 === "number" && Number.isInteger(last_move_p2) ? Math.max(0, last_move_p2) : null;
  sync_all_players_shared_hp(cloned);
  sync_all_players_shared_mSPE(cloned);
  refresh_active_monster_stats(cloned);
  refresh_mSPE_telemetry(cloned);
  return cloned;
}
function active_monster(player) {
  return player.team[player.activeIndex];
}
function other_slot(slot) {
  return slot === "player1" ? "player2" : "player1";
}
function sync_player_shared_hp(state, slot, next_hp) {
  const player = state.players[slot];
  const max_hp = Math.max(1, normalize_int(player.sharedHpMax, SHARED_HP_START, 1));
  const clamped = Math.max(0, Math.min(max_hp, normalize_int(next_hp, max_hp, 0)));
  player.sharedHpMax = max_hp;
  player.sharedHp = clamped;
  for (const monster of player.team) {
    monster.maxHp = max_hp;
    monster.hp = clamped;
  }
  return clamped;
}
function sync_player_shared_mSPE(state, slot, next_mSPE) {
  const player = state.players[slot];
  const clamped = Math.max(0, normalize_int(next_mSPE, SHARED_MSPE_START, 0));
  player.sharedMSPE = clamped;
  for (const monster of player.team) {
    monster.mSPE = clamped;
  }
  return clamped;
}
function sync_all_players_shared_hp(state) {
  for (const slot of SLOT_ORDER) {
    const player = state.players[slot];
    const active = player.team[player.activeIndex] ?? player.team[0];
    const fallback_max_hp = active ? normalize_int(active.maxHp, SHARED_HP_START, 1) : SHARED_HP_START;
    const shared_hp_max = Math.max(1, normalize_int(player.sharedHpMax, fallback_max_hp, 1));
    player.sharedHpMax = shared_hp_max;
    const fallback_shared_hp = active ? normalize_int(active.hp, shared_hp_max, 0) : shared_hp_max;
    const shared_hp = Math.max(0, Math.min(shared_hp_max, normalize_int(player.sharedHp, fallback_shared_hp, 0)));
    sync_player_shared_hp(state, slot, shared_hp);
  }
}
function sync_all_players_shared_mSPE(state) {
  for (const slot of SLOT_ORDER) {
    const player = state.players[slot];
    const active = player.team[player.activeIndex] ?? player.team[0];
    const fallback_shared_mSPE = active ? normalize_int(active.mSPE, SHARED_MSPE_START, 0) : SHARED_MSPE_START;
    const shared_mSPE = Math.max(0, normalize_int(player.sharedMSPE, fallback_shared_mSPE, 0));
    sync_player_shared_mSPE(state, slot, shared_mSPE);
  }
}
function ensure_state_runtime_defaults(state) {
  if (!state.pendingSwitch) {
    state.pendingSwitch = empty_pending();
  }
  if (!state.pendingSwitchReason) {
    state.pendingSwitchReason = empty_pending_switch_reason();
  }
  if (!state.pendingSwitchResolvedThisTurn) {
    state.pendingSwitchResolvedThisTurn = empty_pending_switch_resolved_this_turn();
  }
  if (!state.pendingWish) {
    state.pendingWish = empty_pending_wish();
  }
  if (!state.tauntUntilTurn) {
    state.tauntUntilTurn = empty_taunt_until_turn();
  }
  if (!state.activeEffectsBySlot) {
    state.activeEffectsBySlot = empty_active_effects();
  }
  if (!state.activeCursesBySlot) {
    state.activeCursesBySlot = empty_active_curses();
  }
  if (!state.activeBuffDebuffsBySlot) {
    state.activeBuffDebuffsBySlot = empty_active_buff_debuffs();
  }
  if (!state.activeHealBuffsBySlot) {
    state.activeHealBuffsBySlot = empty_active_heal_buffs();
  }
  if (!state.lastMoveIndexBySlot) {
    state.lastMoveIndexBySlot = empty_last_move_index();
  }
  if (!state.rpsScore) {
    state.rpsScore = empty_rps_score();
  }
  if (!state.mSPETelemetry) {
    state.mSPETelemetry = empty_mSPE_telemetry();
  }
  if (!state.typePassiveArmorStacks) {
    state.typePassiveArmorStacks = empty_type_passive_armor_stacks();
  }
  if (!state.typePassiveRegenStacks) {
    state.typePassiveRegenStacks = empty_type_passive_regen_stacks();
  }
  if (!state.rejuvenationStacks) {
    state.rejuvenationStacks = empty_rejuvenation_stacks();
  }
  if (!state.rejuvenationStartTurn) {
    state.rejuvenationStartTurn = empty_rejuvenation_start_turn();
  }
  if (!state.arenaTrapUntilTurn) {
    state.arenaTrapUntilTurn = empty_arena_trap_until_turn();
  }
  if (!state.spikesArmedByTarget) {
    state.spikesArmedByTarget = empty_spikes_armed_by_target();
  }
  for (const slot of SLOT_ORDER) {
    const buffs = state.activeHealBuffsBySlot[slot];
    if (!Array.isArray(buffs)) {
      state.activeHealBuffsBySlot[slot] = [];
      continue;
    }
    if (!buffs.some((entry) => entry.id === TYPE_BUF_REGEN_HEAL_BUFF_ID)) {
      const regen_stack = Math.max(0, normalize_int(state.typePassiveRegenStacks?.[slot], 0, 0));
      if (regen_stack > 0) {
        buffs.push({
          id: TYPE_BUF_REGEN_HEAL_BUFF_ID,
          sourceSlot: slot,
          source: "type_buf_passive",
          healPerTurn: regen_stack * TYPE_PASSIVE_BUF_REGEN_PER_STACK,
          growthPerTurn: 0,
          startTurn: state.turn,
          remainingTicks: null,
          clearsOnSwitch: false
        });
      }
    }
    if (!buffs.some((entry) => entry.id === REJUVENATION_REGEN_HEAL_BUFF_ID)) {
      const stack = Math.min(REJUVENATION_REGEN_STACK_MAX, Math.max(0, normalize_int(state.rejuvenationStacks?.[slot], 0, 0)));
      const start_turn = Math.max(0, normalize_int(state.rejuvenationStartTurn?.[slot], 0, 0));
      if (stack > 0 && start_turn > 0) {
        const base_regen = REJUVENATION_REGEN_FLAT_PER_STACK;
        buffs.push({
          id: REJUVENATION_REGEN_HEAL_BUFF_ID,
          sourceSlot: slot,
          source: "rejuvenation",
          healPerTurn: base_regen * stack,
          growthPerTurn: 0,
          startTurn: start_turn,
          remainingTicks: null,
          clearsOnSwitch: false
        });
      }
    }
  }
  sync_all_players_shared_mSPE(state);
  refresh_active_monster_stats(state);
}
function compare_monster_type(left, right) {
  if (left === right) {
    return 0;
  }
  if (left === "buf" && right === "def" || left === "def" && right === "atk" || left === "atk" && right === "buf") {
    return 1;
  }
  return -1;
}
function action_kind_for_slot(actions, slot) {
  const action = actions.find((entry) => entry.player === slot);
  if (!action) {
    return "none";
  }
  if (action.type === "switch") {
    return "switch";
  }
  if (action.type === "run") {
    return "none";
  }
  return "attack";
}
function switch_target_type_for_slot(state, actions, slot) {
  const action = actions.find((entry) => entry.player === slot);
  if (!action || action.type !== "switch") {
    return active_monster(state.players[slot]).type;
  }
  const team = state.players[slot].team;
  if (action.targetIndex < 0 || action.targetIndex >= team.length) {
    return active_monster(state.players[slot]).type;
  }
  return team[action.targetIndex].type;
}
function award_mindgame_point(state, log, winner, loser, reason, context, score_delta = 1) {
  if (!state.rpsScore) {
    state.rpsScore = empty_rps_score();
  }
  const normalized_delta = Math.max(1, normalize_int(score_delta, 1, 1));
  const player1_before = state.rpsScore.player1 ?? 0;
  const player2_before = state.rpsScore.player2 ?? 0;
  state.rpsScore[winner] = (state.rpsScore[winner] ?? 0) + normalized_delta;
  state.rpsScore[loser] = (state.rpsScore[loser] ?? 0) - normalized_delta;
  log.push({
    type: "mindgame_bonus_ready",
    turn: state.turn,
    summary: `${winner} won mindgame (${reason}${normalized_delta > 1 ? ` x${normalized_delta}` : ""})`,
    data: {
      winner,
      loser,
      reason,
      scoreDelta: normalized_delta,
      ...context
    }
  });
  log.push({
    type: "rps_score_update",
    turn: state.turn,
    summary: `rps score updated (${winner} +${normalized_delta}, ${loser} -${normalized_delta})`,
    data: {
      winner,
      loser,
      player1Before: player1_before,
      player1After: state.rpsScore.player1,
      player2Before: player2_before,
      player2After: state.rpsScore.player2
    }
  });
}
function apply_mindgame_bonus_event(state, log, actions) {
  const p1_kind = action_kind_for_slot(actions, "player1");
  const p2_kind = action_kind_for_slot(actions, "player2");
  if (p1_kind === "none" || p2_kind === "none") {
    return;
  }
  if (p1_kind === "switch" && p2_kind === "switch") {
    const p1_type2 = switch_target_type_for_slot(state, actions, "player1");
    const p2_type2 = switch_target_type_for_slot(state, actions, "player2");
    const type_cmp2 = compare_monster_type(p1_type2, p2_type2);
    if (type_cmp2 === 0) {
      return;
    }
    const winner2 = type_cmp2 > 0 ? "player1" : "player2";
    const loser2 = winner2 === "player1" ? "player2" : "player1";
    award_mindgame_point(state, log, winner2, loser2, "switch_vs_switch", {
      player1Type: p1_type2,
      player2Type: p2_type2
    });
    return;
  }
  if (p1_kind !== p2_kind) {
    const winner2 = p1_kind === "attack" ? "player1" : "player2";
    const loser2 = winner2 === "player1" ? "player2" : "player1";
    award_mindgame_point(state, log, winner2, loser2, "attack_vs_switch", {
      player1Action: p1_kind,
      player2Action: p2_kind
    });
    return;
  }
  const p1_type = active_monster(state.players.player1).type;
  const p2_type = active_monster(state.players.player2).type;
  const type_cmp = compare_monster_type(p1_type, p2_type);
  if (type_cmp === 0) {
    return;
  }
  const winner = type_cmp > 0 ? "player1" : "player2";
  const loser = winner === "player1" ? "player2" : "player1";
  award_mindgame_point(state, log, winner, loser, "attack_vs_attack", {
    player1Type: p1_type,
    player2Type: p2_type
  });
}
function apply_switch_sovietico_predict_bonus(state, log, resolved_this_turn, hp_changed, took_damage_this_turn, damage_taken_this_turn, incoming_damage_multiplier_percent) {
  if (!resolved_this_turn.player1 || !resolved_this_turn.player2) {
    return false;
  }
  const p1_type = active_monster(state.players.player1).type;
  const p2_type = active_monster(state.players.player2).type;
  const type_cmp = compare_monster_type(p1_type, p2_type);
  if (type_cmp === 0) {
    log.push({
      type: "mindgame_bonus_ready",
      turn: state.turn,
      summary: "Switch Sovietico predict resolved in tie (no score/passive bonus)",
      data: {
        reason: "switch_sovietico",
        player1Type: p1_type,
        player2Type: p2_type,
        scoreDelta: 0
      }
    });
    return true;
  }
  const winner = type_cmp > 0 ? "player1" : "player2";
  const loser = winner === "player1" ? "player2" : "player1";
  award_mindgame_point(state, log, winner, loser, "switch_sovietico", { player1Type: p1_type, player2Type: p2_type, passiveRepeats: 2 }, 2);
  const switched = { player1: true, player2: true };
  apply_simultaneous_switch_passives(state, log, switched, hp_changed, took_damage_this_turn, damage_taken_this_turn, incoming_damage_multiplier_percent, 2);
  return true;
}
function apply_spikes_on_switch(state, log, slot, hp_changed, took_damage_this_turn, damage_taken_this_turn, incoming_damage_multiplier_percent) {
  if (!(state.spikesArmedByTarget?.[slot] ?? false)) {
    return;
  }
  state.spikesArmedByTarget[slot] = false;
  const hp_changed_ref = hp_changed ?? new WeakSet;
  const took_damage_ref = took_damage_this_turn ?? { player1: false, player2: false };
  const damage_taken_ref = damage_taken_this_turn ?? { player1: 0, player2: 0 };
  const target_player = state.players[slot];
  const target = active_monster(target_player);
  const damage_attempt = Math.max(0, mul_div_round(target_player.sharedHpMax, 1, 20));
  const result = apply_damage_with_endure(state, log, "switch", slot, target, damage_attempt, hp_changed_ref, took_damage_ref, undefined, damage_taken_ref, incoming_damage_multiplier_percent);
  log.push({
    type: "spikes_trigger",
    turn: state.turn,
    phase: "switch",
    summary: result.applied > 0 ? `${target.name} took ${result.applied} from Spikes on switch` : `${target.name} triggered Spikes on switch (no damage)`,
    data: {
      slot: other_slot(slot),
      targetSlot: slot,
      target: target.id,
      damage: result.applied,
      before: result.before,
      after: result.after
    }
  });
}
function apply_simultaneous_switch_passives(state, log, switched_this_turn, hp_changed, took_damage_this_turn, damage_taken_this_turn, incoming_damage_multiplier_percent, passive_multiplier = 1) {
  if (!switched_this_turn.player1 || !switched_this_turn.player2) {
    return;
  }
  const passive_mult = Math.max(1, normalize_int(passive_multiplier, 1, 1));
  const p1_type = active_monster(state.players.player1).type;
  const p2_type = active_monster(state.players.player2).type;
  const type_cmp = compare_monster_type(p1_type, p2_type);
  if (type_cmp === 0) {
    return;
  }
  const winner = type_cmp > 0 ? "player1" : "player2";
  const loser = winner === "player1" ? "player2" : "player1";
  const winner_player = state.players[winner];
  const loser_player = state.players[loser];
  if (winner_player.sharedHp <= 0 || loser_player.sharedHp <= 0) {
    return;
  }
  const winner_mon = active_monster(winner_player);
  const loser_mon = active_monster(loser_player);
  if (winner_mon.type === "atk") {
    const true_damage = TYPE_PASSIVE_ATK_TRUE_DAMAGE * passive_mult;
    const damage_result = apply_damage_with_endure(state, log, "switch", loser, loser_mon, true_damage, hp_changed, took_damage_this_turn, { ignoreArmor: true, source: "type_passive_atk" }, damage_taken_this_turn, incoming_damage_multiplier_percent);
    log.push({
      type: "passive_trigger",
      turn: state.turn,
      phase: "switch",
      summary: `${winner_mon.name} activated ATK passive (true damage ${damage_result.applied}${passive_mult > 1 ? `, x${passive_mult}` : ""})`,
      data: {
        slot: winner,
        targetSlot: loser,
        source: winner_mon.id,
        target: loser_mon.id,
        passive: "type_atk_true_damage",
        damage: damage_result.applied,
        passiveMultiplier: passive_mult
      }
    });
    log.push({
      type: "damage",
      turn: state.turn,
      phase: "switch",
      summary: `${winner} dealt ${damage_result.applied} to ${loser_mon.name}`,
      data: {
        slot: winner,
        targetSlot: loser,
        source: winner_mon.id,
        target: loser_mon.id,
        damage: damage_result.applied,
        before: damage_result.before,
        after: damage_result.after,
        damageType: "true"
      }
    });
    return;
  }
  if (winner_mon.type === "def") {
    const before_stack2 = type_passive_armor_stack(state, winner);
    const after_stack2 = Math.min(TYPE_PASSIVE_DEF_ARMOR_STACK_MAX, before_stack2 + passive_mult);
    state.typePassiveArmorStacks[winner] = after_stack2;
    log.push({
      type: "passive_trigger",
      turn: state.turn,
      phase: "switch",
      summary: `${winner_mon.name} activated DEF passive (Clear Body [Instant] + Armor ${after_stack2 * TYPE_PASSIVE_DEF_ARMOR_REDUCTION_PER_STACK_PERCENT}%${passive_mult > 1 ? `, x${passive_mult} stack gain` : ""})`,
      data: {
        slot: winner,
        source: winner_mon.id,
        passive: "type_def_armor_stack",
        stackBefore: before_stack2,
        stackAfter: after_stack2,
        armorReductionPercent: after_stack2 * TYPE_PASSIVE_DEF_ARMOR_REDUCTION_PER_STACK_PERCENT,
        passiveMultiplier: passive_mult
      }
    });
    return;
  }
  const existing_regen = heal_buff_state(state, winner, TYPE_BUF_REGEN_HEAL_BUFF_ID);
  const before_heal_per_turn = existing_regen?.healPerTurn ?? 0;
  const added_heal_per_turn = TYPE_PASSIVE_BUF_REGEN_PER_STACK * passive_mult;
  const regen_buff = upsert_heal_buff(state, log, winner, winner, "type_buf_passive", {
    id: TYPE_BUF_REGEN_HEAL_BUFF_ID,
    source: "type_buf_passive",
    healPerTurn: added_heal_per_turn,
    growthPerTurn: 0,
    startTurn: state.turn,
    remainingTicks: null,
    clearsOnSwitch: false
  });
  const after_heal_per_turn = regen_buff.healPerTurn;
  const before_stack = Math.max(0, Math.floor(before_heal_per_turn / TYPE_PASSIVE_BUF_REGEN_PER_STACK));
  const after_stack = Math.max(0, Math.floor(after_heal_per_turn / TYPE_PASSIVE_BUF_REGEN_PER_STACK));
  state.typePassiveRegenStacks[winner] = after_stack;
  log.push({
    type: "passive_trigger",
    turn: state.turn,
    phase: "switch",
    summary: `${winner_mon.name} activated BUF passive (regen stack ${after_stack}${passive_mult > 1 ? `, x${passive_mult} stack gain` : ""})`,
    data: {
      slot: winner,
      source: winner_mon.id,
      passive: "type_buf_regen_stack",
      stackBefore: before_stack,
      stackAfter: after_stack,
      healPerTurnBefore: before_heal_per_turn,
      healPerTurnAfter: after_heal_per_turn,
      healPerTurnDelta: added_heal_per_turn,
      passiveMultiplier: passive_mult
    }
  });
}
function end_match_with_winner(state, log, winner, summary, data, end_reason) {
  state.status = "ended";
  state.winner = winner;
  if (end_reason) {
    state.endReason = end_reason;
  }
  delete state.mSPESlots;
  log.push({
    type: "match_end",
    turn: state.turn,
    summary,
    data: { winner, ...data ?? {} }
  });
}
function end_match_draw(state, log, summary, data, end_reason) {
  state.status = "ended";
  delete state.winner;
  if (end_reason) {
    state.endReason = end_reason;
  }
  delete state.mSPESlots;
  log.push({
    type: "match_end",
    turn: state.turn,
    summary,
    data: { ...data ?? {} }
  });
}
function check_zero_hp_match_result(state, log) {
  const p1_hp = state.players.player1.sharedHp;
  const p2_hp = state.players.player2.sharedHp;
  if (p1_hp > 0 && p2_hp > 0) {
    return "continue";
  }
  if (p1_hp <= 0 && p2_hp > 0) {
    end_match_with_winner(state, log, "player2", "player2 wins (enemy shared HP reached 0)", {
      player1Hp: p1_hp,
      player2Hp: p2_hp
    }, "hp_zero");
    return "ended";
  }
  if (p2_hp <= 0 && p1_hp > 0) {
    end_match_with_winner(state, log, "player1", "player1 wins (enemy shared HP reached 0)", {
      player1Hp: p1_hp,
      player2Hp: p2_hp
    }, "hp_zero");
    return "ended";
  }
  end_match_draw(state, log, "draw (both sides reached 0 HP)", {
    player1Hp: p1_hp,
    player2Hp: p2_hp
  }, "hp_zero");
  return "ended";
}
function effective_attack_for_slot(state, slot, monster) {
  refresh_active_monster_stats_for_slot(state, slot);
  const effective_stage = effective_attack_stage_for_monster(state, slot, monster);
  if (has_effect(state, slot, "weakness")) {
    const weakened_stage = clamp_stat_stage(effective_stage - 2);
    const attack_delta = total_delta_percent_from_buff_debuffs(state, slot, "attack", monster.id);
    const attack_base_after_percent = stat_value_from_delta_percent(monster.baseAttack, attack_delta);
    return attack_from_stage(attack_base_after_percent, weakened_stage);
  }
  return monster.attack;
}
function effective_defense_for_slot(state, slot, monster) {
  refresh_active_monster_stats_for_slot(state, slot);
  if (has_effect(state, slot, "deterioration")) {
    return 0;
  }
  return monster.defense;
}
function effective_speed_for_slot(state, slot, monster) {
  refresh_active_monster_stats_for_slot(state, slot);
  if (has_effect(state, slot, "paralyse")) {
    return 0;
  }
  return monster.speed;
}
function build_mSPE_telemetry_entry(state, slot) {
  const enemy_slot = other_slot(slot);
  const effective_mSPE = Math.max(0, normalize_int(state.players[slot].sharedMSPE, SHARED_MSPE_START, 0));
  const enemy_effective_mSPE = Math.max(0, normalize_int(state.players[enemy_slot].sharedMSPE, SHARED_MSPE_START, 0));
  const divisor = Math.max(1, enemy_effective_mSPE);
  const gap_percent = mul_div_round(effective_mSPE - enemy_effective_mSPE, 100, divisor);
  const evade_ready = effective_mSPE >= MSPE_VALUE_GOAL;
  const gap_ready = gap_percent >= MSPE_GAP_GOAL_PERCENT;
  return {
    effectiveMSPE: effective_mSPE,
    mSPEGoal: MSPE_VALUE_GOAL,
    mSPEReady: evade_ready,
    gapPercent: gap_percent,
    gapGoalPercent: MSPE_GAP_GOAL_PERCENT,
    gapReady: gap_ready,
    canMSPE: evade_ready || gap_ready
  };
}
function refresh_mSPE_telemetry(state) {
  ensure_state_runtime_defaults(state);
  state.mSPETelemetry.player1 = build_mSPE_telemetry_entry(state, "player1");
  state.mSPETelemetry.player2 = build_mSPE_telemetry_entry(state, "player2");
}
function check_mSPE_match_result(state, log) {
  refresh_mSPE_telemetry(state);
  if (state.status !== "running") {
    return state.status === "ended" ? "ended" : "continue";
  }
  const mSPE_slots = SLOT_ORDER.filter((slot) => state.mSPETelemetry[slot].canMSPE);
  if (mSPE_slots.length === 0) {
    return "continue";
  }
  state.status = "ended";
  state.endReason = "mSPE_escape";
  state.mSPESlots = mSPE_slots.slice();
  delete state.winner;
  const summary = mSPE_slots.length >= 2 ? "double technical escape (both players satisfied mSPE condition)" : `${mSPE_slots[0]} escaped technically (mSPE condition met)`;
  log.push({
    type: "match_end",
    turn: state.turn,
    summary,
    data: {
      reason: "mSPE_escape",
      mSPESlots: mSPE_slots.slice(),
      telemetry: {
        player1: { ...state.mSPETelemetry.player1 },
        player2: { ...state.mSPETelemetry.player2 }
      }
    }
  });
  return "ended";
}
function initiative_stat_value(state, slot, monster, key) {
  if (key === "speed") {
    return effective_speed_for_slot(state, slot, monster);
  }
  if (key === "attack") {
    return effective_attack_for_slot(state, slot, monster);
  }
  if (key === "defense") {
    return effective_defense_for_slot(state, slot, monster);
  }
  return monster.hp;
}
function compare_initiative(state, a_slot, b_slot, a, b, stats) {
  for (const key of stats) {
    const diff = initiative_stat_value(state, a_slot, a, key) - initiative_stat_value(state, b_slot, b, key);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}
function is_alive(monster) {
  return monster.maxHp > 0;
}
function for_each_player(state, fn) {
  for (const slot of SLOT_ORDER) {
    fn(state.players[slot]);
  }
}
function reset_protect_flags(state) {
  for_each_player(state, (player) => {
    for (const monster of player.team) {
      monster.protectActiveThisTurn = false;
      monster.endureActiveThisTurn = false;
      monster.baitActiveThisTurn = false;
    }
  });
}
function decrement_cooldowns(state) {
  for_each_player(state, (player) => {
    for (const monster of player.team) {
      const guard_cooldown = Math.max(monster.protectCooldownTurns, monster.endureCooldownTurns);
      if (guard_cooldown > 0) {
        const next_guard_cooldown = guard_cooldown - 1;
        monster.protectCooldownTurns = next_guard_cooldown;
        monster.endureCooldownTurns = next_guard_cooldown;
      }
    }
  });
}
function apply_pending_wish(state, log, slot, hp_changed) {
  if ((state.pendingWish?.[slot] ?? null) !== state.turn) {
    return;
  }
  const player = state.players[slot];
  const target = active_monster(player);
  const before_hp = player.sharedHp;
  const wish_heal = Math.max(0, mul_div_round(player.sharedHpMax, 1, 2));
  const after_hp = Math.min(player.sharedHpMax, Math.max(0, before_hp + wish_heal));
  state.pendingWish[slot] = null;
  if (after_hp !== before_hp) {
    sync_player_shared_hp(state, slot, after_hp);
    hp_changed.add(target);
    log.push({
      type: "wish_heal",
      turn: state.turn,
      phase: END_PHASE_ID,
      summary: `${target.name} recebeu Wish (+${wish_heal} por maxHp: ${before_hp} -> ${after_hp})`,
      data: { slot, target: target.id, before: before_hp, after: after_hp, amount: wish_heal, basedOn: "maxHp" }
    });
  } else {
    log.push({
      type: "wish_heal",
      turn: state.turn,
      phase: END_PHASE_ID,
      summary: `${target.name} recebeu Wish (sem efeito: +${wish_heal} por maxHp, ${before_hp} -> ${after_hp})`,
      data: { slot, target: target.id, before: before_hp, after: after_hp, amount: wish_heal, basedOn: "maxHp" }
    });
  }
}
function apply_rejuvenation_reactive_heal_end_turn(state, log, slot, hp_changed, rejuvenation_used_this_turn, damage_taken_this_turn) {
  if (!rejuvenation_used_this_turn[slot]) {
    return;
  }
  const player = state.players[slot];
  const target = active_monster(player);
  const damage_taken = Math.max(0, normalize_int(damage_taken_this_turn[slot], 0, 0));
  if (damage_taken <= 0) {
    log.push({
      type: "rejuvenation_reactive_heal",
      turn: state.turn,
      phase: END_PHASE_ID,
      summary: `${target.name} used Rejuvenation but took no damage this turn`,
      data: { slot, target: target.id, damageTaken: 0, healApplied: 0 }
    });
    return;
  }
  const heal_attempt = Math.max(0, mul_div_floor(damage_taken, 1, 2));
  const result = apply_heal_amount(state, slot, hp_changed, heal_attempt);
  log.push({
    type: "rejuvenation_reactive_heal",
    turn: state.turn,
    phase: END_PHASE_ID,
    summary: `${target.name} healed ${result.healed} from Rejuvenation (50% of damage taken)`,
    data: {
      slot,
      target: target.id,
      damageTaken: damage_taken,
      healAttempted: heal_attempt,
      healApplied: result.healed,
      before: result.before,
      after: result.after
    }
  });
}
function apply_rejuvenation_regen_end_turn(state, log, slot, hp_changed) {
  apply_heal_buffs_end_turn_by_id(state, log, slot, hp_changed, REJUVENATION_REGEN_HEAL_BUFF_ID);
}
function apply_type_passive_regen_end_turn(state, log, slot, hp_changed) {
  apply_heal_buffs_end_turn_by_id(state, log, slot, hp_changed, TYPE_BUF_REGEN_HEAL_BUFF_ID);
}
function clear_curses_on_target_switch(state, log, target_slot) {
  ensure_state_runtime_defaults(state);
  const active_curses = state.activeCursesBySlot[target_slot];
  if (!Array.isArray(active_curses) || active_curses.length === 0) {
    return;
  }
  const kept = [];
  for (const curse of active_curses) {
    if (curse.id === "sekyps") {
      kept.push(curse);
      continue;
    }
    const ended_type = curse.id === "leech_seed" ? "leech_end" : "curse_end";
    log.push({
      type: ended_type,
      turn: state.turn,
      summary: curse.id === "leech_seed" ? `Leech Seed ended on ${target_slot} after switch` : `${curse_label(curse.id)} ended on ${target_slot} after switch`,
      data: { slot: target_slot, source: curse.sourceSlot, curse: curse.id, stacks: curse.stacks, reason: "switch" }
    });
  }
  state.activeCursesBySlot[target_slot] = kept;
}
function clear_buff_debuffs_on_target_switch(state, log, target_slot) {
  ensure_state_runtime_defaults(state);
  const active = state.activeBuffDebuffsBySlot[target_slot];
  if (!Array.isArray(active) || active.length === 0) {
    return;
  }
  const kept = active.filter((entry) => entry.clearsOnSwitch !== true);
  const removed = active.length - kept.length;
  if (removed <= 0) {
    return;
  }
  state.activeBuffDebuffsBySlot[target_slot] = kept;
  refresh_active_monster_stats_for_slot(state, target_slot);
  log.push({
    type: "buff_debuff_end",
    turn: state.turn,
    summary: `${target_slot} cleared ${removed} buff/debuff modifier${removed === 1 ? "" : "s"} on switch`,
    data: { slot: target_slot, removed, reason: "switch" }
  });
}
function clear_heal_buffs_on_target_switch(state, log, target_slot) {
  ensure_state_runtime_defaults(state);
  const active = state.activeHealBuffsBySlot[target_slot];
  if (!Array.isArray(active) || active.length === 0) {
    return;
  }
  const kept = active.filter((entry) => entry.clearsOnSwitch !== true);
  const removed = active.length - kept.length;
  if (removed <= 0) {
    return;
  }
  state.activeHealBuffsBySlot[target_slot] = kept;
  log.push({
    type: "heal_buff_end",
    turn: state.turn,
    summary: `${target_slot} cleared ${removed} heal buff${removed === 1 ? "" : "s"} on switch`,
    data: { slot: target_slot, removed, reason: "switch" }
  });
}
function clear_buff_debuffs_for_stat(state, slot, stat) {
  ensure_state_runtime_defaults(state);
  const before = state.activeBuffDebuffsBySlot[slot];
  if (!Array.isArray(before) || before.length === 0) {
    return 0;
  }
  const filtered = before.filter((entry) => entry.stat !== stat || entry.clearsOnSwitch !== true);
  const removed = before.length - filtered.length;
  if (removed > 0) {
    state.activeBuffDebuffsBySlot[slot] = filtered;
    refresh_active_monster_stats_for_slot(state, slot);
  }
  return removed;
}
function apply_curse_end_turn(state, log, hp_changed, switched_this_turn) {
  ensure_state_runtime_defaults(state);
  for (const target_slot of SLOT_ORDER) {
    const curses = state.activeCursesBySlot[target_slot];
    if (!Array.isArray(curses) || curses.length === 0) {
      continue;
    }
    const target_player = state.players[target_slot];
    const target = active_monster(target_player);
    if (!is_alive(target)) {
      continue;
    }
    for (const curse of curses) {
      if (curse.id === "leech_seed") {
        const source_slot = curse.sourceSlot ?? other_slot(target_slot);
        const target_before = target_player.sharedHp;
        const drained_base = mul_div_floor(target_player.sharedHpMax, 1, 8);
        const drained_attempt = Math.max(0, drained_base * Math.max(1, curse.stacks));
        const drained = Math.min(target_before, drained_attempt);
        const target_after = target_before - drained;
        if (drained <= 0) {
          continue;
        }
        sync_player_shared_hp(state, target_slot, target_after);
        hp_changed.add(target);
        log.push({
          type: "leech_drain",
          turn: state.turn,
          phase: END_PHASE_ID,
          summary: `${target.name} lost ${drained} HP from Leech Seed`,
          data: {
            slot: source_slot,
            targetSlot: target_slot,
            source: source_slot,
            target: target.id,
            damage: drained,
            stacks: curse.stacks,
            before: target_before,
            after: target_after
          }
        });
        const source_player = state.players[source_slot];
        const receiver = active_monster(source_player);
        if (is_alive(receiver)) {
          const heal_before = source_player.sharedHp;
          const heal_after = Math.min(source_player.sharedHpMax, source_player.sharedHp + drained);
          const healed = Math.max(0, heal_after - heal_before);
          if (healed > 0) {
            sync_player_shared_hp(state, source_slot, heal_after);
            hp_changed.add(receiver);
            log.push({
              type: "leech_heal",
              turn: state.turn,
              phase: END_PHASE_ID,
              summary: `${receiver.name} healed ${healed} HP from Leech Seed`,
              data: {
                slot: source_slot,
                source: source_slot,
                targetSlot: target_slot,
                target: target.id,
                heal: healed,
                stacks: curse.stacks,
                before: heal_before,
                after: heal_after
              }
            });
          }
        }
        continue;
      }
      if (curse.id === "sekyps") {
        if (switched_this_turn[target_slot]) {
          continue;
        }
        const current_stack = Math.max(1, normalize_int(curse.stacks, 1, 1));
        const applied_this_turn = typeof curse.appliedTurn === "number" && curse.appliedTurn === state.turn;
        const ticking_stack = applied_this_turn ? current_stack - 1 : current_stack;
        if (ticking_stack <= 0) {
          continue;
        }
        const source_slot = curse.sourceSlot ?? other_slot(target_slot);
        const damage_amount = ticking_stack * SEKYPS_DAMAGE_PER_STACK;
        const target_before = target_player.sharedHp;
        const damage = Math.min(target_before, Math.max(0, damage_amount));
        const target_after = target_before - damage;
        if (damage <= 0) {
          continue;
        }
        sync_player_shared_hp(state, target_slot, target_after);
        hp_changed.add(target);
        log.push({
          type: "sekyps_tick",
          turn: state.turn,
          phase: END_PHASE_ID,
          summary: `${target.name} lost ${damage} HP from Sekyps (stack ${ticking_stack})`,
          data: {
            slot: source_slot,
            targetSlot: target_slot,
            source: source_slot,
            target: target.id,
            damage,
            damageAmount: damage_amount,
            stack: ticking_stack,
            totalStack: current_stack,
            nextStack: current_stack,
            nextDamageAmount: current_stack * SEKYPS_DAMAGE_PER_STACK,
            appliedThisTurn: applied_this_turn,
            before: target_before,
            after: target_after
          }
        });
        continue;
      }
      continue;
    }
  }
}
function maybe_end_match_by_turn_limit(state, log) {
  if (state.status === "ended") {
    return;
  }
  const base_turn_limit = Math.max(1, normalize_int(state.baseTurnLimit, BASE_TURN_LIMIT, 1));
  state.baseTurnLimit = base_turn_limit;
  if (state.turn < base_turn_limit) {
    return;
  }
  const p1_hp = state.players.player1.sharedHp;
  const p2_hp = state.players.player2.sharedHp;
  if (p1_hp !== p2_hp) {
    const winner = p1_hp > p2_hp ? "player1" : "player2";
    end_match_with_winner(state, log, winner, `${winner} wins (higher shared HP after ${base_turn_limit} turns)`, { player1Hp: p1_hp, player2Hp: p2_hp }, "turn_limit");
    return;
  }
  end_match_draw(state, log, `draw after ${base_turn_limit} turns (equal shared HP)`, {
    player1Hp: p1_hp,
    player2Hp: p2_hp
  }, "turn_limit");
}
function apply_focus_punch_end_turn(state, log, hp_changed, focus_punch_pending, took_damage_this_turn, damage_taken_this_turn, incoming_damage_multiplier_percent) {
  const spec = move_spec("focus_punch");
  for (const slot of SLOT_ORDER) {
    if (!focus_punch_pending[slot]) {
      continue;
    }
    const attacker = active_monster(state.players[slot]);
    if (!is_alive(attacker)) {
      log.push({
        type: "focus_punch_fail",
        turn: state.turn,
        phase: END_PHASE_ID,
        summary: `${slot} lost focus (fainted before Focus Punch)`,
        data: { slot, reason: "fainted" }
      });
      continue;
    }
    if (took_damage_this_turn[slot]) {
      log.push({
        type: "focus_punch_fail",
        turn: state.turn,
        phase: END_PHASE_ID,
        summary: `${attacker.name} lost focus and Focus Punch failed`,
        data: { slot, reason: "took_damage_before_attack" }
      });
      continue;
    }
    apply_damage_move(state, log, slot, spec, hp_changed, END_PHASE_ID, took_damage_this_turn, damage_taken_this_turn, incoming_damage_multiplier_percent);
  }
}
function apply_end_turn_effect(state, log, hp_changed, effect_id, focus_punch_pending, took_damage_this_turn, switched_this_turn, rejuvenation_used_this_turn, damage_taken_this_turn, incoming_damage_multiplier_percent) {
  if (effect_id === "focus_punch") {
    apply_focus_punch_end_turn(state, log, hp_changed, focus_punch_pending, took_damage_this_turn, damage_taken_this_turn, incoming_damage_multiplier_percent);
    return;
  }
  if (effect_id === "rejuvenation_reactive") {
    for (const slot of SLOT_ORDER) {
      apply_rejuvenation_reactive_heal_end_turn(state, log, slot, hp_changed, rejuvenation_used_this_turn, damage_taken_this_turn);
    }
    return;
  }
  if (effect_id === "wish") {
    for (const slot of SLOT_ORDER) {
      apply_pending_wish(state, log, slot, hp_changed);
    }
    return;
  }
  if (effect_id === "leech_life") {
    apply_curse_end_turn(state, log, hp_changed, switched_this_turn);
    return;
  }
  if (effect_id === "rejuvenation_regen") {
    for (const slot of SLOT_ORDER) {
      apply_rejuvenation_regen_end_turn(state, log, slot, hp_changed);
    }
    return;
  }
  for (const slot of SLOT_ORDER) {
    apply_type_passive_regen_end_turn(state, log, slot, hp_changed);
  }
}
function apply_end_turn_phase(state, log, hp_changed, focus_punch_pending, took_damage_this_turn, switched_this_turn, rejuvenation_used_this_turn, damage_taken_this_turn, incoming_damage_multiplier_percent) {
  for (const effect_id of END_TURN_EFFECT_ORDER) {
    apply_end_turn_effect(state, log, hp_changed, effect_id, focus_punch_pending, took_damage_this_turn, switched_this_turn, rejuvenation_used_this_turn, damage_taken_this_turn, incoming_damage_multiplier_percent);
    const progress = check_zero_hp_match_result(state, log);
    if (progress !== "continue") {
      return progress;
    }
  }
  return "continue";
}
function minimum_endure_hp(monster) {
  return Math.max(1, mul_div_ceil(monster.maxHp, 1, 100));
}
function apply_damage_with_endure(state, log, phase, slot, monster, attempted_damage, hp_changed, took_damage_this_turn, options, damage_taken_this_turn, incoming_damage_multiplier_percent) {
  const before = state.players[slot].sharedHp;
  if (before <= 0 || attempted_damage <= 0) {
    return { before, after: before, applied: 0 };
  }
  const incoming_multiplier_raw = incoming_damage_multiplier_percent ? incoming_damage_multiplier_percent[slot] : 100;
  const incoming_multiplier = is_attack_damage_phase(phase) ? Math.max(0, normalize_int(incoming_multiplier_raw, 100, 0)) : 100;
  const adjusted_attempted_damage = incoming_multiplier === 100 ? attempted_damage : Math.max(0, mul_div_floor(attempted_damage, incoming_multiplier, 100));
  const ignore_armor = !!options?.ignoreArmor;
  const armor_stack = ignore_armor ? 0 : type_passive_armor_stack(state, slot);
  const armor_reduction_percent = Math.max(0, Math.min(99, armor_stack * TYPE_PASSIVE_DEF_ARMOR_REDUCTION_PER_STACK_PERCENT));
  let damage_after_armor = adjusted_attempted_damage;
  if (!ignore_armor && armor_reduction_percent > 0) {
    damage_after_armor = Math.max(0, mul_div_floor(adjusted_attempted_damage, 100 - armor_reduction_percent, 100));
    const mitigated = Math.max(0, adjusted_attempted_damage - damage_after_armor);
    if (mitigated > 0) {
      log.push({
        type: "armor_block",
        turn: state.turn,
        phase,
        summary: `${monster.name} armor mitigated ${mitigated} damage`,
        data: {
          slot,
          target: monster.id,
          source: options?.source ?? null,
          armorStack: armor_stack,
          armorReductionPercent: armor_reduction_percent,
          damageBeforeArmor: adjusted_attempted_damage,
          damageAfterArmor: damage_after_armor,
          mitigated
        }
      });
    }
  }
  let after = Math.max(0, before - damage_after_armor);
  if (monster.endureActiveThisTurn) {
    const survive_hp = Math.min(before, minimum_endure_hp(monster));
    if (after < survive_hp) {
      const capped_damage = Math.max(0, before - survive_hp);
      after = survive_hp;
      monster.endureActiveThisTurn = false;
      refresh_active_monster_stats_for_slot(state, slot);
      const speed_before = monster.speed;
      apply_buff_debuff_component(state, log, slot, {
        kind: "buff_debuff",
        id: "endure_speed_up",
        target: "self",
        stat: "speed",
        deltaPercent: 50,
        clearsOnSwitch: true
      }, slot, "endure");
      const speed_after = monster.speed;
      monster.endureSpeedBoostActive = true;
      log.push({
        type: "endure_trigger",
        turn: state.turn,
        phase,
        summary: `${monster.name} endured the hit (${before} -> ${after})`,
        data: {
          slot,
          target: monster.id,
          before,
          after,
          attemptedDamage: adjusted_attempted_damage,
          postArmorDamage: damage_after_armor,
          appliedDamage: capped_damage
        }
      });
      log.push({
        type: "stat_mod",
        turn: state.turn,
        phase,
        summary: `${monster.name} gained speed from Endure (${speed_before} -> ${speed_after})`,
        data: { slot, target: monster.id, stat: "speed", multiplier: 1.5, before: speed_before, after: speed_after }
      });
      log.push({
        type: "move_detail",
        turn: state.turn,
        phase,
        summary: `Endure: immortal trigger (HP floor 1% => ${after}); dmg capped ${adjusted_attempted_damage} -> ${capped_damage}; DEX x1.5 (${speed_before} -> ${speed_after})`,
        data: {
          move: "endure",
          slot,
          target: monster.id,
          hpBefore: before,
          hpAfter: after,
          damageAttempted: adjusted_attempted_damage,
          damageAfterArmor: damage_after_armor,
          damageApplied: capped_damage,
          speedBefore: speed_before,
          speedAfter: speed_after
        }
      });
    }
  }
  const final_after = sync_player_shared_hp(state, slot, after);
  const applied = before - final_after;
  if (applied > 0) {
    hp_changed.add(monster);
    took_damage_this_turn[slot] = true;
    if (damage_taken_this_turn) {
      const current = normalize_int(damage_taken_this_turn[slot], 0, 0);
      damage_taken_this_turn[slot] = current + applied;
    }
  }
  return { before, after: final_after, applied };
}
function apply_damage_move(state, log, player_slot, spec, hp_changed, phase_id, took_damage_this_turn, damage_taken_this_turn, incoming_damage_multiplier_percent) {
  const player = state.players[player_slot];
  const opponent_slot = other_slot(player_slot);
  const opponent = state.players[opponent_slot];
  const attacker = active_monster(player);
  const defender = active_monster(opponent);
  if (!is_alive(attacker)) {
    log.push({
      type: "action_skipped",
      turn: state.turn,
      phase: phase_id,
      summary: `${player_slot} action skipped (fainted)`,
      data: { slot: player_slot, move: spec.id }
    });
    return;
  }
  if (!is_alive(defender)) {
    log.push({
      type: "no_target",
      turn: state.turn,
      phase: phase_id,
      summary: `${player_slot} has no target`,
      data: { slot: player_slot, move: spec.id }
    });
    return;
  }
  const effective_attack = effective_attack_for_slot(state, player_slot, attacker);
  const formula_level = scaled_level_for_formula(attacker.level);
  const multiplier100 = spec.attackMultiplier100 + (spec.attackMultiplierPerLevel100 ?? 0) * formula_level;
  const damage_type = spec.damageType ?? "scaled";
  const effective_defense_base = effective_defense_for_slot(state, opponent_slot, defender);
  const effective_defense = effective_defense_base <= 0 ? 1 : effective_defense_base;
  const level_term = mul_div_floor(1, formula_level, 1) + 30;
  let raw_damage = 0;
  if (spec.id === "ki_blast") {
    raw_damage = Math.max(0, mul_div_floor(effective_attack, 75, 100));
  } else if (spec.id === "throw") {
    const scaled_by_defense = mul_div_floor(level_term * THROW_FIXED_OFFENSE_TERM, 1, effective_defense);
    raw_damage = mul_div_floor(scaled_by_defense, 1, 50) + 2;
  } else if (damage_type === "flat") {
    raw_damage = spec.flatDamage ?? 0;
  } else {
    if (multiplier100 > 0 && effective_attack > 0) {
      const offense_term = level_term * multiplier100 * effective_attack;
      if (damage_type === "true") {
        raw_damage = mul_div_floor(offense_term, 1, 50) + 2;
      } else {
        const scaled_by_defense = mul_div_floor(offense_term, 1, effective_defense);
        raw_damage = mul_div_floor(scaled_by_defense, 1, 50) + 2;
      }
    }
  }
  let damage = Math.max(0, raw_damage);
  const was_blocked = defender.protectActiveThisTurn;
  if (was_blocked) {
    damage = 0;
    log.push({
      type: "damage_blocked",
      turn: state.turn,
      phase: phase_id,
      summary: `${defender.name} blocked the attack`,
      data: { slot: opponent_slot }
    });
  }
  const defender_result = apply_damage_with_endure(state, log, phase_id, opponent_slot, defender, damage, hp_changed, took_damage_this_turn, { source: spec.id, ignoreArmor: spec.id === "seismic_toss" || spec.id === "ki_blast" }, damage_taken_this_turn, incoming_damage_multiplier_percent);
  const final_damage = defender_result.applied;
  log.push({
    type: "damage",
    turn: state.turn,
    phase: phase_id,
    summary: `${player_slot} dealt ${final_damage} to ${defender.name}`,
    data: {
      slot: player_slot,
      damage: final_damage,
      target: defender.id,
      before: defender_result.before,
      after: defender_result.after
    }
  });
  const recoil_num = spec.recoilNumerator ?? 0;
  const recoil_den = spec.recoilDenominator ?? 1;
  let recoil_damage = 0;
  let recoil_before = attacker.hp;
  if (recoil_num > 0 && recoil_den > 0 && final_damage > 0) {
    const recoil_attempt = Math.max(0, mul_div_round(final_damage, recoil_num, recoil_den));
    recoil_damage = recoil_attempt;
    if (recoil_damage > 0) {
      const recoil_result = apply_damage_with_endure(state, log, phase_id, player_slot, attacker, recoil_damage, hp_changed, took_damage_this_turn, { ignoreArmor: true, source: "recoil" }, damage_taken_this_turn, incoming_damage_multiplier_percent);
      recoil_before = recoil_result.before;
      recoil_damage = recoil_result.applied;
      log.push({
        type: "recoil",
        turn: state.turn,
        phase: phase_id,
        summary: `${attacker.name} took ${recoil_damage} recoil`,
        data: {
          slot: player_slot,
          damage: recoil_damage,
          target: attacker.id,
          before: recoil_result.before,
          after: recoil_result.after
        }
      });
    }
  }
  if (spec.id === "return") {
    const detail = `Return: dmg = floor(((((2*L)/5)+2)*P*A/D)/50)+2 = floor(((${level_term}*${multiplier100}*${effective_attack}/${effective_defense})/50))+2 = ${raw_damage}; final=${final_damage}${was_blocked ? " (blocked by Protect)" : ""}`;
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: phase_id,
      summary: detail,
      data: { move: spec.id, damage: final_damage, blocked: was_blocked }
    });
  } else if (spec.id === "double_edge") {
    const detail = `Double-Edge: dmg = floor(((((2*L)/5)+2)*P*A/D)/50)+2 = floor(((${level_term}*120*${effective_attack}/${effective_defense})/50))+2 = ${raw_damage}; final=${final_damage}${was_blocked ? " (blocked by Protect)" : ""}; recoil = round(final/3) = ${recoil_damage} (${recoil_before} -> ${attacker.hp})`;
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: phase_id,
      summary: detail,
      data: { move: spec.id, damage: final_damage, recoil: recoil_damage, blocked: was_blocked }
    });
  } else if (spec.id === "seismic_toss") {
    const detail = `Seismic Toss: dmg = flat ${spec.flatDamage ?? 0} (ignores defense); final=${final_damage}${was_blocked ? " (blocked by Protect)" : ""}`;
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: phase_id,
      summary: detail,
      data: { move: spec.id, damage: final_damage, blocked: was_blocked }
    });
  } else if (spec.id === "punch") {
    const detail = `Punch: dmg = floor(((((2*L)/5)+2)*93*A/D)/50)+2 = floor(((${level_term}*93*${effective_attack}/${effective_defense})/50))+2 = ${raw_damage}; final=${final_damage}${was_blocked ? " (blocked by Protect)" : ""}`;
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: phase_id,
      summary: detail,
      data: { move: spec.id, damage: final_damage, blocked: was_blocked }
    });
  } else if (spec.id === "ki_blast") {
    const detail = `Ki Blast: true dmg = floor(75% STR) = floor(0.75*${effective_attack}) = ${raw_damage}; final=${final_damage}${was_blocked ? " (blocked by Protect)" : ""}`;
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: phase_id,
      summary: detail,
      data: { move: spec.id, damage: final_damage, blocked: was_blocked }
    });
  } else if (spec.id === "throw") {
    const detail = `Throw: dmg = floor(((((2*L)/5)+2)*(90*90)/D)/50)+2 = floor(((${level_term}*8100/${effective_defense})/50))+2 = ${raw_damage}; final=${final_damage}${was_blocked ? " (blocked by Protect)" : ""}`;
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: phase_id,
      summary: detail,
      data: { move: spec.id, damage: final_damage, blocked: was_blocked }
    });
  } else if (spec.id === "quick_attack") {
    const detail = `Quick Attack: dmg = floor(((((2*L)/5)+2)*P*A/D)/50)+2 = floor(((${level_term}*66*${effective_attack}/${effective_defense})/50))+2 = ${raw_damage}; final=${final_damage}${was_blocked ? " (blocked by Protect)" : ""}; speed check ignored`;
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: phase_id,
      summary: detail,
      data: { move: spec.id, damage: final_damage, blocked: was_blocked }
    });
  } else if (spec.id === "focus_punch") {
    const detail = `Focus Punch: dmg = floor(((((2*L)/5)+2)*P*A/D)/50)+2 = floor(((${level_term}*150*${effective_attack}/${effective_defense})/50))+2 = ${raw_damage}; final=${final_damage}${was_blocked ? " (blocked by Protect)" : ""}`;
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: phase_id,
      summary: detail,
      data: { move: spec.id, damage: final_damage, blocked: was_blocked }
    });
  }
}
function apply_run_action(state, log, player_slot, blocked_by_hook_this_turn = false) {
  const player = state.players[player_slot];
  const actor = active_monster(player);
  if (!is_alive(actor)) {
    log.push({
      type: "action_skipped",
      turn: state.turn,
      phase: "run",
      summary: `${player_slot} run skipped (fainted)`,
      data: { slot: player_slot, action: "run" }
    });
    return;
  }
  if (blocked_by_hook_this_turn) {
    const before_mSPE2 = Math.max(0, player.sharedMSPE);
    const reduction = before_mSPE2 > 0 ? Math.max(1, mul_div_floor(before_mSPE2, HOOK_RUN_MSPE_REDUCTION_PERCENT, 100)) : 0;
    const after_mSPE2 = sync_player_shared_mSPE(state, player_slot, before_mSPE2 - reduction);
    log.push({
      type: "stat_mod",
      turn: state.turn,
      phase: "run",
      summary: `${player_slot} mSPE reduced by Hook (${before_mSPE2} -> ${after_mSPE2})`,
      data: {
        slot: player_slot,
        target: actor.id,
        stat: "mSPE",
        amountPercent: -HOOK_RUN_MSPE_REDUCTION_PERCENT,
        amount: reduction,
        before: before_mSPE2,
        after: after_mSPE2
      }
    });
    log.push({
      type: "action_skipped",
      turn: state.turn,
      phase: "run",
      summary: `${player_slot} run failed (Hook)`,
      data: { slot: player_slot, action: "run", reason: "hook", mSPEBefore: before_mSPE2, mSPEAfter: after_mSPE2 }
    });
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: "run",
      summary: `Hook penalty on Run attempt: -${HOOK_RUN_MSPE_REDUCTION_PERCENT}% mSPE (${before_mSPE2} -> ${after_mSPE2})`,
      data: {
        action: "run",
        slot: player_slot,
        target: actor.id,
        reason: "hook",
        amountPercent: -HOOK_RUN_MSPE_REDUCTION_PERCENT,
        amount: reduction,
        before: before_mSPE2,
        after: after_mSPE2
      }
    });
    return;
  }
  const before_mSPE = Math.max(0, player.sharedMSPE);
  const gain = Math.max(1, mul_div_round(before_mSPE, RUN_MSPE_GAIN_PERCENT, 100));
  const after_mSPE = sync_player_shared_mSPE(state, player_slot, before_mSPE + gain);
  log.push({
    type: "stat_mod",
    turn: state.turn,
    phase: "run",
    summary: `${player_slot} used Run (+${RUN_MSPE_GAIN_PERCENT}% M.SPE: ${before_mSPE} -> ${after_mSPE})`,
    data: {
      slot: player_slot,
      target: actor.id,
      stat: "mSPE",
      amountPercent: RUN_MSPE_GAIN_PERCENT,
      amount: gain,
      before: before_mSPE,
      after: after_mSPE
    }
  });
  log.push({
    type: "move_detail",
    turn: state.turn,
    phase: "run",
    summary: `Run(+${RUN_MSPE_GAIN_PERCENT}% M.SPE): +${gain} (${before_mSPE} -> ${after_mSPE})`,
    data: {
      action: "run",
      slot: player_slot,
      target: actor.id,
      amountPercent: RUN_MSPE_GAIN_PERCENT,
      amount: gain,
      before: before_mSPE,
      after: after_mSPE
    }
  });
}
function apply_move(state, log, player_slot, move_id, move_index, hp_changed, focus_punch_pending, took_damage_this_turn, damage_taken_this_turn, rejuvenation_used_this_turn, hook_run_blocked_this_turn, incoming_damage_multiplier_percent) {
  const player = state.players[player_slot];
  const opponent = state.players[other_slot(player_slot)];
  const attacker = active_monster(player);
  const defender = active_monster(opponent);
  if (!is_alive(attacker)) {
    log.push({
      type: "action_skipped",
      turn: state.turn,
      summary: `${player_slot} action skipped (fainted)`,
      data: { slot: player_slot }
    });
    return;
  }
  const spec = move_spec(move_id);
  const components = spec.components ?? spec.collateral ?? [];
  const effect_collaterals = components.filter((entry) => entry.kind === "effect");
  const curse_collaterals = components.filter((entry) => entry.kind === "curse");
  const buff_debuff_collaterals = components.filter((entry) => entry.kind === "buff_debuff");
  const instant_collaterals = components.filter((entry) => entry.kind === "instant");
  const finalize_move_success = () => {
    mark_last_move_used(state, player_slot, move_id, move_index);
    apply_move_effects_from_collateral(state, log, player_slot, effect_collaterals, spec.id);
    apply_move_curses_from_collateral(state, log, player_slot, curse_collaterals, spec.id);
    apply_move_buff_debuffs_from_collateral(state, log, player_slot, buff_debuff_collaterals, spec.id);
    apply_move_instants_from_collateral(state, log, player_slot, instant_collaterals, spec.id);
  };
  const blocked_by = move_block_reason(state, player_slot, move_index, spec);
  if (blocked_by) {
    const type = blocked_by === "taunt" ? "taunt_blocked" : "effect_blocked";
    const turns_remaining = EFFECT_ID_SET.has(blocked_by) ? effect_turns_remaining(state, player_slot, blocked_by) : 0;
    log.push({
      type,
      turn: state.turn,
      phase: spec.phaseId,
      summary: move_block_summary(player_slot, blocked_by, spec.label),
      data: {
        slot: player_slot,
        move: spec.id,
        reason: blocked_by,
        turnsRemaining: turns_remaining
      }
    });
    return;
  }
  if (spec.id === "none") {
    finalize_move_success();
    log.push({
      type: "move_none",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} waits`,
      data: { slot: player_slot, moveIndex: move_index }
    });
    return;
  }
  if (spec.id === "protect") {
    const guard_cooldown = Math.max(attacker.protectCooldownTurns, attacker.endureCooldownTurns);
    if (guard_cooldown > 0) {
      log.push({
        type: "protect_blocked",
        turn: state.turn,
        phase: spec.phaseId,
        summary: `${player_slot} tried Protect but is on cooldown`,
        data: { slot: player_slot }
      });
      return;
    }
    attacker.protectActiveThisTurn = true;
    attacker.protectCooldownTurns = 2;
    attacker.endureCooldownTurns = 2;
    log.push({
      type: "protect",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} used Protect`,
      data: { slot: player_slot }
    });
    finalize_move_success();
    return;
  }
  if (spec.id === "endure") {
    const guard_cooldown = Math.max(attacker.protectCooldownTurns, attacker.endureCooldownTurns);
    if (guard_cooldown > 0) {
      log.push({
        type: "endure_blocked",
        turn: state.turn,
        phase: spec.phaseId,
        summary: `${player_slot} tried Endure but is on cooldown`,
        data: { slot: player_slot }
      });
      return;
    }
    const floor_hp = minimum_endure_hp(attacker);
    attacker.endureActiveThisTurn = true;
    attacker.protectCooldownTurns = 2;
    attacker.endureCooldownTurns = 2;
    log.push({
      type: "endure",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} used Endure`,
      data: { slot: player_slot, target: attacker.id }
    });
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `Endure: HP floor this turn = ${floor_hp} (1% do maxHp); on trigger gain DEX x1.5`,
      data: { move: spec.id, slot: player_slot, target: attacker.id, floorHp: floor_hp }
    });
    finalize_move_success();
    return;
  }
  if (spec.id === "bait") {
    const opponent_slot = other_slot(player_slot);
    const took_damage_before_bait = !!took_damage_this_turn[player_slot];
    if (!took_damage_before_bait) {
      log.push({
        type: "bait_failed",
        turn: state.turn,
        phase: spec.phaseId,
        summary: `${player_slot} used Bait but failed (no prior damage this turn)`,
        data: { slot: player_slot, target: attacker.id, move: spec.id, reason: "no_prior_damage" }
      });
      finalize_move_success();
      return;
    }
    upsert_effect(state, log, opponent_slot, "weakness", 2, player_slot, spec.id);
    log.push({
      type: "bait_trigger",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${attacker.name} triggered Bait on ${defender.name} (Weakness 2 turns)`,
      data: {
        slot: player_slot,
        targetSlot: opponent_slot,
        source: attacker.id,
        target: defender.id,
        effect: "weakness",
        duration: 2
      }
    });
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: "Bait: success after taking damage earlier this turn (applies Weakness for 2 turns)",
      data: { move: spec.id, slot: player_slot, target: defender.id, effect: "weakness", duration: 2 }
    });
    finalize_move_success();
    return;
  }
  if (spec.id === "agility") {
    refresh_active_monster_stats_for_slot(state, player_slot);
    const before_speed = attacker.speed;
    apply_buff_debuff_component(state, log, player_slot, {
      kind: "buff_debuff",
      id: "agility_speed_up",
      target: "self",
      stat: "speed",
      deltaPercent: 100,
      clearsOnSwitch: true
    }, player_slot, spec.id);
    const after_speed = attacker.speed;
    log.push({
      type: "stat_mod",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} Agility success on ${attacker.name} (DEX ${before_speed} -> ${after_speed})`,
      data: {
        slot: player_slot,
        target: attacker.id,
        stat: "speed",
        multiplier: 2,
        before: before_speed,
        after: after_speed
      }
    });
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `Agility: user DEX x2 (${before_speed} -> ${after_speed})`,
      data: { move: spec.id, slot: player_slot, target: attacker.id, before: before_speed, after: after_speed }
    });
    finalize_move_success();
    return;
  }
  if (spec.id === "power") {
    ensure_state_runtime_defaults(state);
    refresh_active_monster_stats_for_slot(state, player_slot);
    const before_stage = effective_attack_stage_for_monster(state, player_slot, attacker);
    const before_attack = attacker.attack;
    const before_speed = attacker.speed;
    if (before_stage < STAT_STAGE_MAX) {
      state.activeBuffDebuffsBySlot[player_slot].push({
        id: "power_attack_stage_up",
        sourceSlot: player_slot,
        source: spec.id,
        stat: "attack",
        deltaPercent: 0,
        clearsOnSwitch: false,
        targetMonsterId: attacker.id
      });
    }
    apply_buff_debuff_component(state, log, player_slot, {
      kind: "buff_debuff",
      id: "power_speed_down",
      target: "self",
      stat: "speed",
      deltaPercent: -10,
      clearsOnSwitch: false
    }, player_slot, spec.id, { targetMonsterId: attacker.id });
    refresh_active_monster_stats_for_slot(state, player_slot);
    const after_stage = effective_attack_stage_for_monster(state, player_slot, attacker);
    const after_attack = attacker.attack;
    const after_speed = attacker.speed;
    if (after_stage !== before_stage || after_attack !== before_attack) {
      log.push({
        type: "stat_mod",
        turn: state.turn,
        phase: spec.phaseId,
        summary: `${attacker.name} ATK stage ${before_stage} -> ${after_stage}`,
        data: {
          slot: player_slot,
          target: attacker.id,
          stat: "attack",
          stageBefore: before_stage,
          stageAfter: after_stage,
          before: before_attack,
          after: after_attack
        }
      });
    }
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `Power: ATK stage ${before_stage} -> ${after_stage} (${before_attack} -> ${after_attack}) e DEX -10% do base (${before_speed} -> ${after_speed})`,
      data: {
        move: spec.id,
        slot: player_slot,
        target: attacker.id,
        stageBefore: before_stage,
        stageAfter: after_stage,
        attackBefore: before_attack,
        attackAfter: after_attack,
        speedBefore: before_speed,
        speedAfter: after_speed
      }
    });
    finalize_move_success();
    return;
  }
  if (spec.id === "switch_sovietico") {
    ensure_state_runtime_defaults(state);
    const queued_slots = [];
    for (const slot_id of SLOT_ORDER) {
      const switch_player = state.players[slot_id];
      if (first_available_switch_target(switch_player) === null) {
        state.pendingSwitch[slot_id] = false;
        state.pendingSwitchReason[slot_id] = "none";
        state.pendingSwitchResolvedThisTurn[slot_id] = false;
        log.push({
          type: "switch_invalid",
          turn: state.turn,
          phase: spec.phaseId,
          summary: `${slot_id} could not switch (no available target)`,
          data: {
            slot: slot_id,
            move: spec.id,
            reason: "no_available_target"
          }
        });
        continue;
      }
      state.pendingSwitch[slot_id] = true;
      state.pendingSwitchReason[slot_id] = "switch_sovietico";
      state.pendingSwitchResolvedThisTurn[slot_id] = false;
      queued_slots.push(slot_id);
    }
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: queued_slots.length === 2 ? "Switch Sovietico armed: both players must choose switch at next turn start" : queued_slots.length === 1 ? `Switch Sovietico armed: ${queued_slots[0]} must choose switch at next turn start` : "Switch Sovietico armed: no available switch targets",
      data: {
        move: spec.id,
        pendingSwitchPlayer1: !!state.pendingSwitch.player1,
        pendingSwitchPlayer2: !!state.pendingSwitch.player2
      }
    });
    finalize_move_success();
    return;
  }
  if (spec.id === "team_cure") {
    ensure_state_runtime_defaults(state);
    const effects_before = state.activeEffectsBySlot[player_slot];
    const buff_debuffs_before = state.activeBuffDebuffsBySlot[player_slot].length;
    state.activeEffectsBySlot[player_slot] = effects_before.filter((entry) => !is_negative_stat_effect_id(entry.id));
    const effects_removed = Math.max(0, effects_before.length - state.activeEffectsBySlot[player_slot].length);
    state.activeBuffDebuffsBySlot[player_slot] = state.activeBuffDebuffsBySlot[player_slot].filter((entry) => !(entry.clearsOnSwitch === true && is_negative_stat_buff_debuff(entry)));
    const buff_debuffs_removed = Math.max(0, buff_debuffs_before - state.activeBuffDebuffsBySlot[player_slot].length);
    refresh_active_monster_stats_for_slot(state, player_slot);
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `Team Cure: removed ${effects_removed} negative effects and ${buff_debuffs_removed} negative buff/debuffs from team`,
      data: {
        move: spec.id,
        slot: player_slot,
        effectsRemoved: effects_removed,
        buffDebuffsRemoved: buff_debuffs_removed
      }
    });
    finalize_move_success();
    return;
  }
  if (spec.id === "run") {
    apply_run_action(state, log, player_slot, hook_run_blocked_this_turn[player_slot]);
    finalize_move_success();
    return;
  }
  if (spec.id === "hook") {
    const target_slot = other_slot(player_slot);
    const target_player = state.players[target_slot];
    const target = active_monster(target_player);
    const self_player = state.players[player_slot];
    hook_run_blocked_this_turn[target_slot] = true;
    incoming_damage_multiplier_percent[player_slot] = Math.max(HOOK_EXPOSURE_INCOMING_DAMAGE_MULTIPLIER_PERCENT, normalize_int(incoming_damage_multiplier_percent[player_slot], 100, 0));
    const before_self_mSPE = Math.max(0, normalize_int(self_player.sharedMSPE, SHARED_MSPE_START, 0));
    const self_mSPE_reduction = before_self_mSPE > 0 ? Math.max(1, mul_div_floor(before_self_mSPE, HOOK_SELF_MSPE_REDUCTION_PERCENT, 100)) : 0;
    const after_self_mSPE = sync_player_shared_mSPE(state, player_slot, before_self_mSPE - self_mSPE_reduction);
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `Hook: blocks enemy Run; if target attempts Run then mSPE -${HOOK_RUN_MSPE_REDUCTION_PERCENT}% | ` + `self gains Exposicao (+66% incoming damage in attack phases) and mSPE -${HOOK_SELF_MSPE_REDUCTION_PERCENT}%`,
      data: {
        move: spec.id,
        slot: player_slot,
        targetSlot: target_slot,
        source: attacker.id,
        target: target.id,
        blocksRunThisTurn: true,
        runMSPEReductionPercentOnAttempt: HOOK_RUN_MSPE_REDUCTION_PERCENT,
        selfIncomingDamagePercentInAttackPhases: incoming_damage_multiplier_percent[player_slot],
        selfMSPEBefore: before_self_mSPE,
        selfMSPEAfter: after_self_mSPE,
        selfMSPEDeltaPercent: -HOOK_SELF_MSPE_REDUCTION_PERCENT
      }
    });
    finalize_move_success();
    return;
  }
  if (spec.id === "rejuvenation") {
    ensure_state_runtime_defaults(state);
    rejuvenation_used_this_turn[player_slot] = true;
    const existing_regen = heal_buff_state(state, player_slot, REJUVENATION_REGEN_HEAL_BUFF_ID);
    const regen_value_per_turn = REJUVENATION_REGEN_FLAT_PER_STACK;
    const starts_next_turn = state.turn + 1;
    const stack_before = existing_regen ? Math.min(REJUVENATION_REGEN_STACK_MAX, Math.max(1, normalize_int(state.rejuvenationStacks?.[player_slot] ?? 1, 1, 1))) : 0;
    if (!existing_regen) {
      upsert_heal_buff(state, log, player_slot, player_slot, spec.id, {
        id: REJUVENATION_REGEN_HEAL_BUFF_ID,
        source: spec.id,
        healPerTurn: regen_value_per_turn,
        growthPerTurn: 0,
        startTurn: starts_next_turn,
        remainingTicks: null,
        clearsOnSwitch: false
      });
      state.rejuvenationStacks[player_slot] = 1;
      state.rejuvenationStartTurn[player_slot] = starts_next_turn;
    } else {
      if (stack_before < REJUVENATION_REGEN_STACK_MAX) {
        const pending_growth = Math.max(0, normalize_int(existing_regen.growthPerTurn, 0, 0));
        existing_regen.growthPerTurn = Math.min(regen_value_per_turn, pending_growth + regen_value_per_turn);
      } else {
        existing_regen.growthPerTurn = 0;
      }
      state.rejuvenationStacks[player_slot] = Math.min(REJUVENATION_REGEN_STACK_MAX, stack_before + (stack_before < REJUVENATION_REGEN_STACK_MAX ? 1 : 0));
      if ((state.rejuvenationStartTurn?.[player_slot] ?? 0) <= 0) {
        state.rejuvenationStartTurn[player_slot] = starts_next_turn;
      }
    }
    upsert_effect(state, log, player_slot, "rejuvenation", 999, player_slot, spec.id);
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: stack_before <= 0 ? `Rejuvenation: cura 50% do dano sofrido neste turno; regen ativo a partir do turno ${starts_next_turn} (+${REJUVENATION_REGEN_FLAT_PER_STACK} por turno)` : stack_before >= REJUVENATION_REGEN_STACK_MAX ? `Rejuvenation: cura 50% do dano sofrido neste turno; regen ja esta no maximo (+${REJUVENATION_REGEN_FLAT_MAX} por turno)` : `Rejuvenation: cura 50% do dano sofrido neste turno; regen +${REJUVENATION_REGEN_FLAT_PER_STACK} no proximo turno`,
      data: {
        move: spec.id,
        slot: player_slot,
        target: attacker.id,
        reactiveHealPercentOfDamageTaken: 50,
        regenStartTurn: state.rejuvenationStartTurn[player_slot],
        regenStackBefore: stack_before,
        regenStackAfter: state.rejuvenationStacks[player_slot],
        regenValuePerTurn: regen_value_per_turn
      }
    });
    finalize_move_success();
    return;
  }
  if (spec.id === "wish") {
    const trigger_turn = state.turn + 1;
    if (!state.pendingWish) {
      state.pendingWish = empty_pending_wish();
    }
    state.pendingWish[player_slot] = trigger_turn;
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `Wish: no turno ${trigger_turn}, no inicio do ending_turn, o ativo de ${player_slot} cura +50% do maxHp (clamp no max)`,
      data: { move: spec.id, slot: player_slot, triggerTurn: trigger_turn }
    });
    finalize_move_success();
    return;
  }
  if (spec.id === "spikes") {
    const target_slot = other_slot(player_slot);
    state.spikesArmedByTarget[target_slot] = true;
    log.push({
      type: "spikes_set",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} armed Spikes on ${target_slot}`,
      data: { slot: player_slot, targetSlot: target_slot, target: defender.id }
    });
    finalize_move_success();
    return;
  }
  if (spec.id === "recover") {
    const heal_per_turn = Math.max(0, mul_div_round(player.sharedHpMax, 1, 5));
    const recover_buff = {
      id: RECOVER_MOVE_HEAL_BUFF_ID,
      sourceSlot: player_slot,
      source: spec.id,
      healPerTurn: heal_per_turn,
      growthPerTurn: 0,
      startTurn: state.turn,
      remainingTicks: 1,
      clearsOnSwitch: false
    };
    apply_heal_buff_tick(state, log, player_slot, hp_changed, recover_buff, spec.phaseId);
    finalize_move_success();
    return;
  }
  if (spec.id === "heal") {
    const heal_per_turn = Math.max(0, mul_div_round(player.sharedHpMax, 1, 5));
    const heal_buff = {
      id: HEAL_MOVE_HEAL_BUFF_ID,
      sourceSlot: player_slot,
      source: spec.id,
      healPerTurn: heal_per_turn,
      growthPerTurn: 0,
      startTurn: state.turn,
      remainingTicks: 1,
      clearsOnSwitch: false
    };
    apply_heal_buff_tick(state, log, player_slot, hp_changed, heal_buff, spec.phaseId);
    finalize_move_success();
    return;
  }
  if (spec.id === "meditate") {
    ensure_state_runtime_defaults(state);
    state.activeBuffDebuffsBySlot[player_slot] = state.activeBuffDebuffsBySlot[player_slot].filter((entry) => !(entry.id === "meditate_attack_up" && entry.stat === "attack"));
    refresh_active_monster_stats_for_slot(state, player_slot);
    const before_stage = attacker.attackStage;
    const before_attack = attacker.attack;
    attacker.attackStage = clamp_stat_stage(before_stage + MEDITATE_ATTACK_STAGE_PER_CAST);
    refresh_active_monster_stats_for_slot(state, player_slot);
    const after_stage = attacker.attackStage;
    const after_attack = attacker.attack;
    const ratio = stage_ratio(after_stage);
    log.push({
      type: "stat_mod",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} used Meditate on ${attacker.name} (ATK ${before_attack} -> ${after_attack}, stage ${before_stage} -> ${after_stage})`,
      data: {
        slot: player_slot,
        target: attacker.id,
        stat: "attack",
        stageBefore: before_stage,
        stageAfter: after_stage,
        multiplierNumerator: ratio.numerator,
        multiplierDenominator: ratio.denominator,
        before: before_attack,
        after: after_attack
      }
    });
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `Meditate: ATK stage ${before_stage} -> ${after_stage} (x${ratio.numerator}/${ratio.denominator})`,
      data: {
        move: spec.id,
        slot: player_slot,
        target: attacker.id,
        stageBefore: before_stage,
        stageAfter: after_stage,
        attackBefore: before_attack,
        attackAfter: after_attack
      }
    });
    finalize_move_success();
    return;
  }
  if (spec.id === "belly_drum") {
    refresh_active_monster_stats_for_slot(state, player_slot);
    const before_hp = player.sharedHp;
    if (before_hp * 2 <= attacker.maxHp) {
      log.push({
        type: "belly_drum_failed",
        turn: state.turn,
        phase: spec.phaseId,
        summary: `${player_slot} used Belly Drum but failed (${attacker.name} HP ${before_hp}/${attacker.maxHp})`,
        data: { slot: player_slot, target: attacker.id, move: spec.id, hp: before_hp, maxHp: attacker.maxHp, reason: "hp_not_above_half" }
      });
      return;
    }
    const before_stage = attacker.attackStage;
    const before_attack = attacker.attack;
    const hp_cost = mul_div_floor(before_hp, 1, 2);
    const after_hp = Math.max(0, before_hp - hp_cost);
    sync_player_shared_hp(state, player_slot, after_hp);
    clear_buff_debuffs_for_stat(state, player_slot, "attack");
    attacker.attackStage = STAT_STAGE_MAX;
    refresh_active_monster_stats_for_slot(state, player_slot);
    const after_stage = attacker.attackStage;
    const after_attack = attacker.attack;
    const hp_spent = Math.max(0, before_hp - after_hp);
    if (hp_spent > 0) {
      hp_changed.add(attacker);
      log.push({
        type: "recoil",
        turn: state.turn,
        phase: spec.phaseId,
        summary: `${attacker.name} paid ${hp_spent} HP for Belly Drum`,
        data: { slot: player_slot, damage: hp_spent, target: attacker.id, move: spec.id }
      });
    }
    log.push({
      type: "stat_mod",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} used Belly Drum on ${attacker.name} (ATK ${before_attack} -> ${after_attack})`,
      data: {
        slot: player_slot,
        target: attacker.id,
        stat: "attack",
        stageBefore: before_stage,
        stageAfter: after_stage,
        before: before_attack,
        after: after_attack
      }
    });
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `Belly Drum: user paga floor(HP atual/2) (${before_hp} -> ${after_hp}); ATK stage ${before_stage} -> ${after_stage} (${before_attack} -> ${after_attack})`,
      data: {
        move: spec.id,
        slot: player_slot,
        target: attacker.id,
        hpBefore: before_hp,
        hpAfter: after_hp,
        hpCost: hp_cost,
        hpCostBasedOn: "currentHp",
        stageBefore: before_stage,
        stageAfter: after_stage,
        attackBefore: before_attack,
        attackAfter: after_attack
      }
    });
    finalize_move_success();
    return;
  }
  if (!is_alive(defender)) {
    log.push({
      type: "no_target",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} has no target`,
      data: { slot: player_slot }
    });
    return;
  }
  if (spec.id === "leech_life") {
    const target_slot = other_slot(player_slot);
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: "Leech Seed (curse): drains at ending_turn and ends when the target switches",
      data: { move: spec.id, slot: player_slot, target: defender.id, targetSlot: target_slot }
    });
    finalize_move_success();
    return;
  }
  if (spec.id === "sekyps") {
    const target_slot = other_slot(player_slot);
    const existing_stack = Math.max(0, curse_stacks(state, target_slot, "sekyps"));
    const after_stack = Math.max(1, existing_stack + 1);
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: "Sekyps (curse): no ending_turn causa dano flat por stack (24/48/72/...), stacka ao reaplicar, nao remove no switch, cada stack novo so entra no dano no turno seguinte e nao causa dano no turno em que o alvo troca",
      data: {
        move: spec.id,
        slot: player_slot,
        target: defender.id,
        targetSlot: target_slot,
        baseDamage: SEKYPS_DAMAGE_PER_STACK,
        stackAfterApply: after_stack
      }
    });
    finalize_move_success();
    return;
  }
  if (spec.id === "focus_punch") {
    focus_punch_pending[player_slot] = true;
    log.push({
      type: "focus_punch_charge",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} is tightening focus for Focus Punch`,
      data: { slot: player_slot, target: defender.id }
    });
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: "Focus Punch: resolves at start of ending_turn; fails if user took real damage before executing",
      data: { move: spec.id, slot: player_slot, target: defender.id }
    });
    finalize_move_success();
    return;
  }
  if (spec.id === "screech") {
    const defender_slot = other_slot(player_slot);
    if (is_slot_clear_body_active(state, defender_slot)) {
      const armor_stack = type_passive_armor_stack(state, defender_slot);
      log.push({
        type: "clear_body_blocked",
        turn: state.turn,
        phase: spec.phaseId,
        summary: `${defender.name} blocked Screech with Clear Body [Instant]`,
        data: {
          slot: defender_slot,
          target: defender.id,
          sourceSlot: player_slot,
          source: attacker.id,
          move: spec.id,
          armorStack: armor_stack
        }
      });
      log.push({
        type: "move_detail",
        turn: state.turn,
        phase: spec.phaseId,
        summary: `Screech blocked by Clear Body [Instant] (armor stack ${armor_stack})`,
        data: { move: spec.id, target: defender.id, blockedBy: "clear_body", armorStack: armor_stack }
      });
      finalize_move_success();
      return;
    }
    refresh_active_monster_stats_for_slot(state, defender_slot);
    const before_defense = defender.defense;
    apply_buff_debuff_component(state, log, defender_slot, {
      kind: "buff_debuff",
      id: "screech_def_down",
      target: "opponent",
      stat: "defense",
      deltaPercent: -50,
      clearsOnSwitch: true
    }, player_slot, spec.id);
    const after_defense = defender.defense;
    log.push({
      type: "stat_mod",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} used Screech on ${defender.name} (DEF ${before_defense} -> ${after_defense})`,
      data: {
        slot: player_slot,
        target: defender.id,
        stat: "defense",
        multiplier: 0.5,
        before: before_defense,
        after: after_defense
      }
    });
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `Screech: target DEF x0.5 (${before_defense} -> ${after_defense})`,
      data: { move: spec.id, target: defender.id, before: before_defense, after: after_defense }
    });
    finalize_move_success();
    return;
  }
  if (spec.id === "taunt") {
    const taunt_duration = effect_collaterals.find((entry) => entry.id === "taunt")?.maxDurationTurns ?? 0;
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `Taunt: target forced to attack moves for ${Math.max(1, taunt_duration)} turn(s)`,
      data: {
        move: spec.id,
        slot: player_slot,
        target: defender.id,
        targetSlot: other_slot(player_slot),
        duration: Math.max(1, taunt_duration)
      }
    });
    finalize_move_success();
    return;
  }
  if (spec.id === "pain_split") {
    const before_user_hp = player.sharedHp;
    const before_target_hp = opponent.sharedHp;
    const shared_hp = Math.max(1, mul_div_floor(before_user_hp + before_target_hp, 1, 2));
    const after_user_hp = Math.min(attacker.maxHp, shared_hp);
    const after_target_hp = Math.min(defender.maxHp, shared_hp);
    sync_player_shared_hp(state, player_slot, after_user_hp);
    sync_player_shared_hp(state, other_slot(player_slot), after_target_hp);
    if (after_user_hp !== before_user_hp) {
      hp_changed.add(attacker);
    }
    if (after_target_hp !== before_target_hp) {
      hp_changed.add(defender);
    }
    log.push({
      type: "pain_split",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} used Pain Split (${attacker.name}: ${before_user_hp} -> ${after_user_hp}; ${defender.name}: ${before_target_hp} -> ${after_target_hp})`,
      data: {
        slot: player_slot,
        user: attacker.id,
        target: defender.id,
        userBefore: before_user_hp,
        userAfter: after_user_hp,
        targetBefore: before_target_hp,
        targetAfter: after_target_hp
      }
    });
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `Pain Split: both HP set to floor((userHP + targetHP)/2) = ${shared_hp}`,
      data: {
        move: spec.id,
        slot: player_slot,
        user: attacker.id,
        target: defender.id,
        sharedHp: shared_hp,
        userBefore: before_user_hp,
        userAfter: after_user_hp,
        targetBefore: before_target_hp,
        targetAfter: after_target_hp
      }
    });
    finalize_move_success();
    return;
  }
  apply_damage_move(state, log, player_slot, spec, hp_changed, spec.phaseId, took_damage_this_turn, damage_taken_this_turn, incoming_damage_multiplier_percent);
  finalize_move_success();
}
function validate_switch_target(player, target_index) {
  if (target_index < 0 || target_index >= player.team.length) {
    return "invalid switch target";
  }
  if (target_index === player.activeIndex) {
    return "already active";
  }
  if (!is_alive(player.team[target_index])) {
    return "target fainted";
  }
  return null;
}
function reset_monster_on_switch_out(monster) {
  monster.attack = monster.baseAttack;
  monster.attackStage = 0;
  monster.defense = monster.baseDefense;
  monster.defenseStage = 0;
  monster.speed = monster.baseSpeed;
  monster.speedStage = 0;
  monster.agilityBoostActive = false;
  monster.endureSpeedBoostActive = false;
  monster.baitActiveThisTurn = false;
  monster.bellyDrumActive = false;
  monster.screechDebuffActive = false;
}
function perform_switch(state, log, slot, target_index, event_type, hp_changed, took_damage_this_turn, damage_taken_this_turn, incoming_damage_multiplier_percent) {
  const player = state.players[slot];
  const from = player.activeIndex;
  const outgoing = player.team[from];
  reset_monster_on_switch_out(outgoing);
  clear_curses_on_target_switch(state, log, slot);
  clear_buff_debuffs_on_target_switch(state, log, slot);
  clear_heal_buffs_on_target_switch(state, log, slot);
  player.activeIndex = target_index;
  sync_player_shared_hp(state, slot, player.sharedHp);
  sync_player_shared_mSPE(state, slot, player.sharedMSPE);
  refresh_active_monster_stats_for_slot(state, slot);
  apply_spikes_on_switch(state, log, slot, hp_changed, took_damage_this_turn, damage_taken_this_turn, incoming_damage_multiplier_percent);
  log.push({
    type: event_type,
    turn: state.turn,
    summary: `${slot} switched to ${player.team[target_index].name}`,
    data: { slot, from, to: target_index }
  });
}
function apply_switch(state, log, player_slot, targetIndex, hp_changed, took_damage_this_turn, damage_taken_this_turn, incoming_damage_multiplier_percent) {
  const player = state.players[player_slot];
  const error = validate_switch_target(player, targetIndex);
  if (error) {
    const summary = error === "invalid switch target" ? `${player_slot} invalid switch` : error === "already active" ? `${player_slot} already active` : `${player_slot} cannot switch to fainted`;
    log.push({
      type: "switch_invalid",
      turn: state.turn,
      summary,
      data: { slot: player_slot, targetIndex, error }
    });
    return false;
  }
  perform_switch(state, log, player_slot, targetIndex, "switch", hp_changed, took_damage_this_turn, damage_taken_this_turn, incoming_damage_multiplier_percent);
  return true;
}
function build_actions(intents, state) {
  const actions = [];
  for (const slot of SLOT_ORDER) {
    const intent = intents[slot];
    if (!intent)
      continue;
    if (intent.action === "switch") {
      actions.push({ player: slot, type: "switch", phase: "switch", targetIndex: intent.targetIndex });
    } else if (intent.action === "run") {
      actions.push({ player: slot, type: "run", phase: "run" });
    } else {
      const player = state.players[slot];
      const active = active_monster(player);
      const moveId = active.chosenMoves[intent.moveIndex] ?? "none";
      if (moveId === "run") {
        actions.push({ player: slot, type: "run", phase: "run" });
        continue;
      }
      const spec = move_spec(moveId);
      actions.push({
        player: slot,
        type: "move",
        phase: spec.phaseId,
        moveId,
        moveIndex: intent.moveIndex
      });
    }
  }
  return actions;
}
function create_initial_state(teams, names) {
  const read_ev_component = (source, key) => {
    const raw = source[key];
    if (raw === undefined) {
      return 0;
    }
    return typeof raw === "number" ? raw : Number.NaN;
  };
  const normalize_ev = (value) => {
    const source = typeof value === "object" && value !== null ? value : {};
    return {
      hp: read_ev_component(source, "hp"),
      atk: read_ev_component(source, "atk"),
      def: read_ev_component(source, "def"),
      spe: read_ev_component(source, "spe")
    };
  };
  const build_player = (slot) => {
    const selection = teams[slot];
    const shared_hp = SHARED_HP_START;
    const shared_mSPE = SHARED_MSPE_START;
    const team = selection.monsters.map((monster) => {
      const spec = MONSTER_BY_ID.get(monster.id);
      if (!spec) {
        throw new Error(`team invalid: unknown monster id ${monster.id}`);
      }
      const level_input = typeof monster.stats?.level === "number" ? monster.stats.level : spec.stats.level;
      const normalized_level = normalize_int(level_input, spec.stats.level, LEVEL_MIN);
      const level = Math.min(LEVEL_MAX, normalized_level);
      const ev = normalize_ev(monster.ev);
      const ev_error = validate_ev_spread(ev);
      if (ev_error) {
        throw new Error(`team invalid (${monster.id}): ${ev_error}`);
      }
      const final_stats = calc_final_stats({
        hp: spec.stats.maxHp,
        atk: spec.stats.attack,
        def: spec.stats.defense,
        spe: spec.stats.speed
      }, level, ev);
      const resolved_type = monster.type === "buf" || monster.type === "def" || monster.type === "atk" ? monster.type : spec.type;
      return {
        id: monster.id,
        name: monster.id,
        type: resolved_type,
        hp: shared_hp,
        maxHp: shared_hp,
        mSPE: shared_mSPE,
        level,
        baseAttack: final_stats.atk,
        baseDefense: final_stats.def,
        baseSpeed: final_stats.spe,
        attack: final_stats.atk,
        attackStage: 0,
        defense: final_stats.def,
        defenseStage: 0,
        speed: final_stats.spe,
        speedStage: 0,
        agilityBoostActive: false,
        endureSpeedBoostActive: false,
        bellyDrumActive: false,
        screechDebuffActive: false,
        possibleMoves: monster.moves.slice(),
        possiblePassives: [monster.passive],
        chosenMoves: monster.moves.slice(0, 3),
        chosenPassive: monster.passive,
        protectActiveThisTurn: false,
        endureActiveThisTurn: false,
        baitActiveThisTurn: false,
        protectCooldownTurns: 0,
        endureCooldownTurns: 0
      };
    });
    return {
      slot,
      name: names[slot],
      sharedHp: shared_hp,
      sharedHpMax: shared_hp,
      sharedMSPE: shared_mSPE,
      team,
      activeIndex: Math.min(Math.max(selection.activeIndex, 0), team.length - 1)
    };
  };
  const initial_state = {
    turn: 0,
    status: "setup",
    endReason: undefined,
    mSPESlots: undefined,
    baseTurnLimit: BASE_TURN_LIMIT,
    rpsScore: empty_rps_score(),
    mSPETelemetry: empty_mSPE_telemetry(),
    typePassiveArmorStacks: empty_type_passive_armor_stacks(),
    typePassiveRegenStacks: empty_type_passive_regen_stacks(),
    rejuvenationStacks: empty_rejuvenation_stacks(),
    rejuvenationStartTurn: empty_rejuvenation_start_turn(),
    arenaTrapUntilTurn: empty_arena_trap_until_turn(),
    spikesArmedByTarget: empty_spikes_armed_by_target(),
    players: {
      player1: build_player("player1"),
      player2: build_player("player2")
    },
    pendingSwitch: empty_pending(),
    pendingSwitchReason: empty_pending_switch_reason(),
    pendingSwitchResolvedThisTurn: empty_pending_switch_resolved_this_turn(),
    pendingWish: empty_pending_wish(),
    tauntUntilTurn: empty_taunt_until_turn(),
    activeEffectsBySlot: empty_active_effects(),
    activeCursesBySlot: empty_active_curses(),
    activeBuffDebuffsBySlot: empty_active_buff_debuffs(),
    activeHealBuffsBySlot: empty_active_heal_buffs(),
    lastMoveIndexBySlot: empty_last_move_index()
  };
  sync_all_players_shared_hp(initial_state);
  sync_all_players_shared_mSPE(initial_state);
  refresh_active_monster_stats(initial_state);
  refresh_mSPE_telemetry(initial_state);
  return initial_state;
}
function resolve_turn(state, intents) {
  const next = clone_state(state);
  const log = [];
  const hp_changed_this_turn = new WeakSet;
  const focus_punch_pending = { player1: false, player2: false };
  const took_damage_this_turn = { player1: false, player2: false };
  const damage_taken_this_turn = { player1: 0, player2: 0 };
  const hook_run_blocked_this_turn = { player1: false, player2: false };
  const incoming_damage_multiplier_percent = { player1: 100, player2: 100 };
  const rejuvenation_used_this_turn = { player1: false, player2: false };
  sync_all_players_shared_hp(next);
  sync_all_players_shared_mSPE(next);
  refresh_active_monster_stats(next);
  next.baseTurnLimit = Math.max(1, normalize_int(next.baseTurnLimit, BASE_TURN_LIMIT, 1));
  if (next.status !== "running") {
    return { state: next, log };
  }
  ensure_state_runtime_defaults(next);
  const switch_sovietico_resolved_this_turn = {
    player1: !!next.pendingSwitchResolvedThisTurn.player1,
    player2: !!next.pendingSwitchResolvedThisTurn.player2
  };
  const switched_this_turn = {
    player1: switch_sovietico_resolved_this_turn.player1,
    player2: switch_sovietico_resolved_this_turn.player2
  };
  next.pendingSwitch = empty_pending();
  next.pendingSwitchReason = empty_pending_switch_reason();
  next.pendingSwitchResolvedThisTurn = empty_pending_switch_resolved_this_turn();
  const intents_after_forced_switch = {
    player1: intents.player1,
    player2: intents.player2
  };
  for (const slot_id of SLOT_ORDER) {
    if (!switch_sovietico_resolved_this_turn[slot_id]) {
      continue;
    }
    if (intents_after_forced_switch[slot_id] !== null) {
      log.push({
        type: "action_skipped",
        turn: next.turn,
        phase: "switch",
        summary: `${slot_id} cannot act this turn after Switch Sovietico forced switch`,
        data: { slot: slot_id, reason: "switch_sovietico_forced_switch" }
      });
    }
    intents_after_forced_switch[slot_id] = null;
  }
  const actions = build_actions(intents_after_forced_switch, next);
  reset_protect_flags(next);
  let progress = check_zero_hp_match_result(next, log);
  const phases = [...PHASES].sort((a, b) => a.order - b.order);
  let mindgame_checked = false;
  for (const phase of phases) {
    if (progress !== "continue") {
      break;
    }
    if (phase.id === "switch" && !mindgame_checked) {
      progress = check_mSPE_match_result(next, log);
      if (progress !== "continue") {
        break;
      }
      const sovietico_bonus_applied = apply_switch_sovietico_predict_bonus(next, log, switch_sovietico_resolved_this_turn, hp_changed_this_turn, took_damage_this_turn, damage_taken_this_turn, incoming_damage_multiplier_percent);
      if (!sovietico_bonus_applied) {
        apply_mindgame_bonus_event(next, log, actions);
      }
      mindgame_checked = true;
      progress = check_zero_hp_match_result(next, log);
      if (progress !== "continue") {
        break;
      }
    }
    const phase_actions = actions.filter((action) => action.phase === phase.id);
    if (phase_actions.length === 0) {
      continue;
    }
    if (phase_actions.length >= 2) {
      phase_actions.sort((a, b) => compare_actions_for_phase(next, phase, a, b));
      const first = phase_actions[0];
      log.push({
        type: "initiative",
        turn: next.turn,
        phase: phase.id,
        summary: `${first.player} acts first in ${phase.name}`,
        data: { phase: phase.id }
      });
    }
    for (const action of phase_actions) {
      if (action.type === "switch") {
        const blocked_switch_reason = switch_block_reason(next, action.player);
        if (!blocked_switch_reason) {
          const switched = apply_switch(next, log, action.player, action.targetIndex, hp_changed_this_turn, took_damage_this_turn, damage_taken_this_turn, incoming_damage_multiplier_percent);
          if (switched) {
            switched_this_turn[action.player] = true;
          }
        } else {
          const blocked_type = blocked_switch_reason === "taunt" ? "taunt_blocked" : "switch_blocked";
          const summary = blocked_switch_reason === "arena trapped" ? `${action.player} cannot switch (arena trapped)` : blocked_switch_reason === "taunt" ? `${action.player} is taunted and cannot switch` : `${action.player} cannot switch (${effect_label(blocked_switch_reason)})`;
          log.push({
            type: blocked_type,
            turn: next.turn,
            phase: phase.id,
            summary,
            data: {
              slot: action.player,
              targetIndex: action.targetIndex,
              reason: blocked_switch_reason,
              turnsRemaining: blocked_switch_reason === "arena trapped" ? Math.max(0, (next.arenaTrapUntilTurn?.[action.player] ?? 0) - next.turn + 1) : EFFECT_ID_SET.has(blocked_switch_reason) ? effect_turns_remaining(next, action.player, blocked_switch_reason) : 0
            }
          });
        }
      } else if (action.type === "move") {
        apply_move(next, log, action.player, action.moveId, action.moveIndex, hp_changed_this_turn, focus_punch_pending, took_damage_this_turn, damage_taken_this_turn, rejuvenation_used_this_turn, hook_run_blocked_this_turn, incoming_damage_multiplier_percent);
      } else {
        apply_run_action(next, log, action.player, hook_run_blocked_this_turn[action.player]);
      }
      progress = check_zero_hp_match_result(next, log);
      if (progress !== "continue") {
        break;
      }
    }
    if (phase.id === "switch" && progress === "continue") {
      apply_simultaneous_switch_passives(next, log, switched_this_turn, hp_changed_this_turn, took_damage_this_turn, damage_taken_this_turn, incoming_damage_multiplier_percent);
      progress = check_zero_hp_match_result(next, log);
    } else if (phase.id === "run" && progress === "continue") {
      progress = check_mSPE_match_result(next, log);
    }
  }
  if (progress === "continue") {
    progress = apply_end_turn_phase(next, log, hp_changed_this_turn, focus_punch_pending, took_damage_this_turn, switched_this_turn, rejuvenation_used_this_turn, damage_taken_this_turn, incoming_damage_multiplier_percent);
  }
  decrement_cooldowns(next);
  if (next.status === "running") {
    decay_effects_end_turn(next, log);
  }
  refresh_active_monster_stats(next);
  reset_protect_flags(next);
  if (next.status === "running") {
    maybe_end_match_by_turn_limit(next, log);
  }
  refresh_mSPE_telemetry(next);
  return { state: next, log };
}
function apply_forced_switch(state, slot, targetIndex) {
  const next = clone_state(state);
  const log = [];
  ensure_state_runtime_defaults(next);
  const player = next.players[slot];
  if (!next.pendingSwitch[slot]) {
    return { state: next, log, error: "no pending switch" };
  }
  const error = validate_switch_target(player, targetIndex);
  if (error) {
    return { state: next, log, error };
  }
  const switch_reason = next.pendingSwitchReason?.[slot] ?? "none";
  perform_switch(next, log, slot, targetIndex, "forced_switch");
  next.pendingSwitch[slot] = false;
  next.pendingSwitchReason[slot] = "none";
  next.pendingSwitchResolvedThisTurn[slot] = switch_reason === "switch_sovietico";
  refresh_mSPE_telemetry(next);
  return { state: next, log };
}
function validate_intent(state, slot, intent) {
  const player = state.players[slot];
  if (!player) {
    return "unknown player";
  }
  if (state.pendingSwitch?.[slot]) {
    return "pending switch";
  }
  if (intent.action === "switch") {
    const blocked_switch = switch_block_reason(state, slot);
    if (blocked_switch === "taunt") {
      return "taunted: must use attack";
    }
    if (blocked_switch) {
      return blocked_switch;
    }
    const switch_error = validate_switch_target(player, intent.targetIndex);
    if (switch_error) {
      return switch_error;
    }
    return null;
  }
  if (intent.action === "run") {
    const blocked_run = run_block_reason(state, slot);
    if (blocked_run === "nocaute") {
      return "nocaute: must switch";
    }
    if (blocked_run === "taunt") {
      return "taunted: must use attack";
    }
    if (blocked_run) {
      return blocked_run;
    }
    return null;
  }
  const active = active_monster(player);
  if (intent.moveIndex < 0 || intent.moveIndex >= active.chosenMoves.length) {
    return "invalid move index";
  }
  const moveId = active.chosenMoves[intent.moveIndex] ?? "none";
  if (moveId === "run") {
    const blocked_run = run_block_reason(state, slot);
    if (blocked_run === "nocaute") {
      return "nocaute: must switch";
    }
    if (blocked_run === "taunt") {
      return "taunted: must use attack";
    }
    if (blocked_run) {
      return blocked_run;
    }
    return null;
  }
  const spec = move_spec(moveId);
  const blocked_move = move_block_reason(state, slot, intent.moveIndex, spec);
  if (blocked_move === "nocaute") {
    return "nocaute: must switch";
  }
  if (blocked_move === "taunt") {
    return "taunted: must use attack";
  }
  if (blocked_move) {
    return blocked_move;
  }
  const guard_cooldown = Math.max(active.protectCooldownTurns, active.endureCooldownTurns);
  if (moveId === "protect" && guard_cooldown > 0) {
    return "protect on cooldown";
  }
  if (moveId === "endure" && guard_cooldown > 0) {
    return "endure on cooldown";
  }
  if (moveId === "switch_sovietico") {
    if (!has_available_switch_target(player)) {
      return "switch sovietico requires available switch target";
    }
  }
  return null;
}

// vibishowdown/lobby_render.ts
function move_display_label(move_id, move_labels) {
  return move_labels[move_id] || move_id;
}
function compare_move_ids(left_id, right_id, move_labels) {
  const left = move_display_label(left_id, move_labels);
  const right = move_display_label(right_id, move_labels);
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}
function ordered_move_options(possible_moves, move_labels, priority_move_ids) {
  const unique = [];
  const seen = new Set;
  for (const move of possible_moves) {
    if (move === "run") {
      continue;
    }
    if (seen.has(move)) {
      continue;
    }
    seen.add(move);
    unique.push(move);
  }
  const has_none = unique.includes("none");
  const non_none_moves = unique.filter((move) => move !== "none");
  const priority_set = new Set(priority_move_ids.filter((move) => move !== "none" && move !== "run"));
  const priority = non_none_moves.filter((move) => priority_set.has(move)).sort((left, right) => compare_move_ids(left, right, move_labels));
  const others = non_none_moves.filter((move) => !priority_set.has(move)).sort((left, right) => compare_move_ids(left, right, move_labels));
  const ordered = [...priority, ...others];
  if (has_none) {
    ordered.push("none");
  }
  return ordered;
}
function render_lobby_config(ctx) {
  ctx.moves_grid.innerHTML = "";
  ctx.stats_grid.innerHTML = "";
  if (!ctx.active_tab) {
    ctx.show_warning("Select 3 monsters to configure.");
    return;
  }
  ctx.clear_warning();
  const spec = ctx.roster_by_id.get(ctx.active_tab);
  if (!spec) {
    ctx.show_warning("Unknown monster.");
    return;
  }
  const config = ctx.get_config(ctx.active_tab);
  const base_stats = ctx.base_stats_from_spec(spec);
  config.stats = ctx.stats_from_base_level_ev(base_stats, config.stats.level, config.ev);
  let changed = false;
  const unique_moves = new Set;
  for (let i = 0;i < ctx.lobby_move_slots; i++) {
    const move = config.moves[i] ?? "none";
    if (move === "none") {
      if (config.moves[i] !== "none") {
        config.moves[i] = "none";
        changed = true;
      }
      continue;
    }
    if (move === "run") {
      config.moves[i] = "none";
      changed = true;
      continue;
    }
    if (unique_moves.has(move)) {
      config.moves[i] = "none";
      changed = true;
      continue;
    }
    unique_moves.add(move);
  }
  while (config.moves.length < ctx.lobby_move_slots) {
    config.moves.push("none");
    changed = true;
  }
  if (config.moves.length > ctx.lobby_move_slots) {
    config.moves = config.moves.slice(0, ctx.lobby_move_slots);
    changed = true;
  }
  if (changed) {
    ctx.save_profile();
  }
  for (let i = 0;i < ctx.lobby_move_slots; i++) {
    const label = document.createElement("label");
    label.textContent = `Move ${i + 1}`;
    const select = document.createElement("select");
    select.dataset.index = `${i}`;
    const current_move = config.moves[i] ?? "none";
    const used_by_others = new Set(config.moves.filter((move, idx) => idx !== i && move !== "none"));
    const sorted_move_options = ordered_move_options(spec.possibleMoves, ctx.move_labels, ctx.priority_move_ids);
    for (const move of sorted_move_options) {
      if (move !== "none" && move !== current_move && used_by_others.has(move)) {
        continue;
      }
      const option = document.createElement("option");
      option.value = move;
      option.textContent = move_display_label(move, ctx.move_labels);
      select.appendChild(option);
    }
    const has_current = Array.from(select.options).some((option) => option.value === current_move);
    select.value = has_current ? current_move : "none";
    if (!has_current) {
      config.moves[i] = "none";
      ctx.save_profile();
    }
    select.dataset.prev = select.value;
    select.disabled = ctx.is_ready && !ctx.match_started;
    const apply_move_value = (next_value) => {
      const idx = Number(select.dataset.index);
      if (!Number.isInteger(idx)) {
        return;
      }
      select.dataset.prev = next_value;
      if (config.moves[idx] === next_value) {
        return;
      }
      config.moves[idx] = next_value;
      ctx.save_profile();
    };
    select.addEventListener("input", () => {
      if (ctx.is_ready && !ctx.match_started) {
        select.value = select.dataset.prev || "none";
        return;
      }
      apply_move_value(select.value);
      ctx.clear_warning();
      ctx.update_action_controls();
    });
    select.addEventListener("change", () => {
      if (ctx.is_ready && !ctx.match_started) {
        select.value = select.dataset.prev || "none";
        return;
      }
      apply_move_value(select.value);
      ctx.clear_warning();
      ctx.rerender();
      ctx.update_action_controls();
    });
    label.appendChild(select);
    ctx.moves_grid.appendChild(label);
  }
  const level_label = document.createElement("label");
  level_label.textContent = "Lv";
  const level_input = document.createElement("input");
  level_input.type = "number";
  level_input.min = `${ctx.level_min}`;
  level_input.max = `${ctx.level_max}`;
  level_input.value = `${config.stats.level}`;
  level_input.disabled = ctx.is_ready && !ctx.match_started;
  const read_level_input_value = () => {
    const raw = level_input.value.trim();
    if (!raw) {
      return null;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return parsed;
  };
  const apply_level_value = (next_value) => {
    const normalized = Math.min(ctx.level_max, Math.max(ctx.level_min, Math.round(next_value)));
    if (normalized !== config.stats.level) {
      config.stats = ctx.stats_from_base_level_ev(base_stats, normalized, config.ev);
      ctx.save_profile();
      ctx.refresh_lobby_tooltips();
    }
    return normalized;
  };
  level_input.addEventListener("input", () => {
    if (ctx.is_ready && !ctx.match_started)
      return;
    const value = read_level_input_value();
    if (value === null) {
      return;
    }
    apply_level_value(value);
    ctx.clear_warning();
  });
  const commit_level_input = () => {
    if (ctx.is_ready && !ctx.match_started)
      return;
    const value = read_level_input_value();
    if (value === null) {
      level_input.value = `${config.stats.level}`;
      return;
    }
    const normalized = apply_level_value(value);
    level_input.value = `${normalized}`;
    ctx.clear_warning();
    ctx.rerender();
  };
  level_input.addEventListener("change", commit_level_input);
  level_input.addEventListener("blur", commit_level_input);
  level_label.appendChild(level_input);
  ctx.moves_grid.appendChild(level_label);
  const points_summary = document.createElement("div");
  points_summary.className = "stat-points-summary";
  ctx.stats_grid.appendChild(points_summary);
  const column_header = document.createElement("div");
  column_header.className = "stat-alloc-header";
  for (const heading of ["", "Base", "EV's", "", "Total"]) {
    const header_cell = document.createElement("span");
    header_cell.className = "stat-alloc-header-cell";
    if (heading.length === 0) {
      header_cell.classList.add("is-empty");
      header_cell.textContent = " ";
    } else {
      header_cell.textContent = heading;
    }
    column_header.appendChild(header_cell);
  }
  ctx.stats_grid.appendChild(column_header);
  const update_points_summary = () => {
    const used = ctx.ev_total(config.ev);
    const remaining = ctx.ev_total_max - used;
    points_summary.textContent = `EVs: ${used}/${ctx.ev_total_max} (restante: ${Math.max(0, remaining)})`;
  };
  const stat_rows = [
    ["atk", "ATK"],
    ["def", "DEF"],
    ["spe", "DEX"]
  ];
  const stat_key_by_ev = {
    atk: "attack",
    def: "defense",
    spe: "speed"
  };
  const calc_total_stat = (key) => {
    const base = base_stats[stat_key_by_ev[key]];
    const level = config.stats.level;
    return ctx.calc_non_hp_stat(base, level, config.ev[key], 0, 1);
  };
  for (const [key, label_text] of stat_rows) {
    const row = document.createElement("div");
    row.className = "stat-alloc-row";
    const stat_name = document.createElement("span");
    stat_name.className = "stat-alloc-name";
    stat_name.textContent = label_text;
    const base_value = document.createElement("span");
    base_value.className = "stat-static-value";
    base_value.textContent = `${base_stats[stat_key_by_ev[key]]}`;
    const alloc_input = document.createElement("input");
    alloc_input.type = "number";
    alloc_input.className = "stat-alloc-input";
    alloc_input.min = "0";
    alloc_input.max = `${ctx.ev_per_stat_max}`;
    alloc_input.step = "1";
    alloc_input.value = `${config.ev[key]}`;
    alloc_input.disabled = ctx.is_ready && !ctx.match_started;
    const alloc_slider = document.createElement("input");
    alloc_slider.type = "range";
    alloc_slider.className = "stat-alloc-slider";
    alloc_slider.min = "0";
    alloc_slider.max = `${ctx.ev_per_stat_max}`;
    alloc_slider.value = `${config.ev[key]}`;
    alloc_slider.disabled = ctx.is_ready && !ctx.match_started;
    const result_value = document.createElement("span");
    result_value.className = "stat-result-value";
    result_value.textContent = `${calc_total_stat(key)}`;
    const max_ev_for_key = () => {
      const used_without_current = ctx.ev_total(config.ev) - config.ev[key];
      return Math.min(ctx.ev_per_stat_max, Math.max(0, ctx.ev_total_max - used_without_current));
    };
    const apply_allocation_value = (next_raw, source) => {
      const current = config.ev[key];
      if (!Number.isFinite(next_raw)) {
        alloc_input.value = `${current}`;
        alloc_slider.value = `${current}`;
        return;
      }
      if (source === "slider") {
        const clamped = Math.max(0, Math.min(max_ev_for_key(), Math.floor(next_raw)));
        const candidate2 = { ...config.ev, [key]: clamped };
        config.ev = candidate2;
        config.stats = ctx.stats_from_base_level_ev(base_stats, config.stats.level, config.ev);
        alloc_input.value = `${clamped}`;
        alloc_slider.value = `${clamped}`;
        result_value.textContent = `${calc_total_stat(key)}`;
        ctx.clear_warning();
        update_points_summary();
        ctx.save_profile();
        ctx.refresh_lobby_tooltips();
        return;
      }
      if (!Number.isInteger(next_raw)) {
        ctx.show_warning(`EV ${key} must be integer.`);
        alloc_input.value = `${current}`;
        alloc_slider.value = `${current}`;
        return;
      }
      const candidate = { ...config.ev, [key]: next_raw };
      const ev_error = ctx.validate_ev_spread(candidate);
      if (ev_error) {
        ctx.show_warning(ev_error);
        alloc_input.value = `${current}`;
        alloc_slider.value = `${current}`;
        return;
      }
      config.ev = candidate;
      config.stats = ctx.stats_from_base_level_ev(base_stats, config.stats.level, config.ev);
      alloc_input.value = `${next_raw}`;
      alloc_slider.value = `${next_raw}`;
      result_value.textContent = `${calc_total_stat(key)}`;
      ctx.clear_warning();
      update_points_summary();
      ctx.save_profile();
      ctx.refresh_lobby_tooltips();
    };
    alloc_input.addEventListener("change", () => {
      if (ctx.is_ready && !ctx.match_started)
        return;
      const value = Number(alloc_input.value);
      if (!Number.isFinite(value)) {
        alloc_input.value = `${config.ev[key]}`;
        return;
      }
      apply_allocation_value(value, "input");
    });
    alloc_slider.addEventListener("input", () => {
      if (ctx.is_ready && !ctx.match_started)
        return;
      apply_allocation_value(Number(alloc_slider.value), "slider");
    });
    row.appendChild(stat_name);
    row.appendChild(base_value);
    row.appendChild(alloc_input);
    row.appendChild(alloc_slider);
    row.appendChild(result_value);
    ctx.stats_grid.appendChild(row);
  }
  update_points_summary();
}

// vibishowdown/lobby_state.ts
var EV_KEYS = ["hp", "atk", "def", "spe"];
var LEGACY_MONSTER_ID_ALIASES = {
  night: "night_sekyps"
};
var TEAM_SELECTION_SIZE = 3;
function load_json(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw)
      return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function save_json(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
function canonical_monster_id(id) {
  return LEGACY_MONSTER_ID_ALIASES[id] ?? id;
}
function normalize_stats(value, fallback) {
  const source = value ?? {};
  return {
    level: normalize_stat_value("level", source.level, fallback.level),
    maxHp: normalize_stat_value("maxHp", source.maxHp, fallback.maxHp),
    attack: normalize_stat_value("attack", source.attack, fallback.attack),
    defense: normalize_stat_value("defense", source.defense, fallback.defense),
    speed: normalize_stat_value("speed", source.speed, fallback.speed)
  };
}
function normalize_legacy_ev_from_stat_alloc(value) {
  const source = typeof value === "object" && value !== null ? value : null;
  if (!source)
    return null;
  return {
    hp: read_ev_value(source.maxHp, 0),
    atk: read_ev_value(source.attack, 0),
    def: read_ev_value(source.defense, 0),
    spe: read_ev_value(source.speed, 0)
  };
}
function stats_equal(left, right) {
  return left.level === right.level && left.maxHp === right.maxHp && left.attack === right.attack && left.defense === right.defense && left.speed === right.speed;
}
function ev_equal(left, right) {
  return left.hp === right.hp && left.atk === right.atk && left.def === right.def && left.spe === right.spe;
}
function read_ev_value(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function normalize_stat_value(key, value, fallback) {
  const candidate = typeof value === "number" ? value : fallback;
  if (key === "level") {
    return Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, normalize_int(candidate, fallback, LEVEL_MIN)));
  }
  if (key === "maxHp") {
    return normalize_int(candidate, fallback, 1);
  }
  return normalize_int(candidate, fallback, 0);
}
function ev_total(ev) {
  return EV_KEYS.reduce((sum, key) => sum + ev[key], 0);
}
function normalize_ev_spread(value, fallback = empty_ev_spread()) {
  const source = typeof value === "object" && value !== null ? value : {};
  return {
    hp: read_ev_value(source.hp, fallback.hp),
    atk: read_ev_value(source.atk, fallback.atk),
    def: read_ev_value(source.def, fallback.def),
    spe: read_ev_value(source.spe, fallback.spe)
  };
}
function stats_from_base_level_ev(base, level, ev) {
  const final = calc_final_stats({
    hp: base.maxHp,
    atk: base.attack,
    def: base.defense,
    spe: base.speed
  }, level, ev);
  return {
    level,
    maxHp: final.hpMax,
    attack: final.atk,
    defense: final.def,
    speed: final.spe
  };
}
function default_lobby_moves_for_spec(spec, lobby_move_slots) {
  const default_moves = spec.defaultMoves.slice(0, lobby_move_slots).map((move_id) => move_id === "run" ? "none" : move_id);
  while (default_moves.length < lobby_move_slots) {
    default_moves.push("none");
  }
  return default_moves;
}
function base_stats_from_spec(spec) {
  return normalize_stats(spec.stats, spec.stats);
}
function load_profile(profile_key, roster_by_id) {
  const parsed = load_json(profile_key, null);
  if (parsed && typeof parsed === "object" && parsed.monsters) {
    const source = parsed.monsters;
    const migrated = {};
    let changed = false;
    for (const [raw_id, config] of Object.entries(source)) {
      const id = canonical_monster_id(raw_id);
      if (id !== raw_id) {
        changed = true;
      }
      if (!roster_by_id.has(id)) {
        changed = true;
        continue;
      }
      if (migrated[id]) {
        changed = true;
        continue;
      }
      migrated[id] = config;
    }
    if (changed) {
      save_json(profile_key, { monsters: migrated });
    }
    return { monsters: migrated };
  }
  return { monsters: {} };
}
function save_profile(profile_key, profile) {
  save_json(profile_key, profile);
}
function load_team_selection(team_key, roster_by_id, is_lobby_enabled_monster, max_selection) {
  const parsed = load_json(team_key, null);
  if (!parsed || !Array.isArray(parsed.selected)) {
    return [];
  }
  const filtered = parsed.selected.map((id) => canonical_monster_id(id)).filter((id) => roster_by_id.has(id) && is_lobby_enabled_monster(id)).slice(0, max_selection);
  const changed = filtered.length !== parsed.selected.length || filtered.some((id, index) => id !== parsed.selected?.[index]);
  if (changed) {
    save_team_selection(team_key, filtered);
  }
  return filtered;
}
function save_team_selection(team_key, selected) {
  save_json(team_key, { selected: selected.slice() });
}
function coerce_config(spec, value, lobby_move_slots) {
  const base_stats = base_stats_from_spec(spec);
  const base_level = normalize_stat_value("level", base_stats.level, 1);
  const base_ev = empty_ev_spread();
  const default_moves = default_lobby_moves_for_spec(spec, lobby_move_slots);
  const base = {
    moves: default_moves,
    passive: "none",
    stats: stats_from_base_level_ev(base_stats, base_level, base_ev),
    ev: base_ev
  };
  if (!value) {
    return base;
  }
  const moves = Array.isArray(value.moves) ? value.moves.slice(0, lobby_move_slots) : base.moves.slice();
  while (moves.length < lobby_move_slots) {
    moves.push("none");
  }
  const allowed = new Set(spec.possibleMoves);
  allowed.delete("run");
  let had_disallowed_move = false;
  for (let i = 0;i < moves.length; i++) {
    if (moves[i] === "bells_drum") {
      moves[i] = "belly_drum";
    }
    if (moves[i] === "cast") {
      moves[i] = "throw";
    }
    if (!allowed.has(moves[i])) {
      had_disallowed_move = true;
      moves[i] = "none";
    }
  }
  if (had_disallowed_move) {
    const used_moves = new Set(moves.filter((move_id) => move_id !== "none"));
    for (let i = 0;i < moves.length; i++) {
      if (moves[i] !== "none") {
        continue;
      }
      const fallback_move = default_moves[i] ?? "none";
      if (fallback_move === "none") {
        continue;
      }
      if (!allowed.has(fallback_move)) {
        continue;
      }
      if (used_moves.has(fallback_move)) {
        continue;
      }
      moves[i] = fallback_move;
      used_moves.add(fallback_move);
    }
  }
  const level = normalize_stat_value("level", value.stats?.level, base.stats.level);
  const legacy_ev = normalize_legacy_ev_from_stat_alloc(value.statAlloc);
  const ev = { ...normalize_ev_spread(value.ev ?? legacy_ev ?? base.ev, base.ev), hp: 0 };
  const stats = stats_from_base_level_ev(base_stats, level, ev);
  return {
    moves,
    passive: "none",
    stats,
    ev
  };
}
function get_config(opts) {
  const spec = opts.roster_by_id.get(opts.monster_id);
  if (!spec) {
    throw new Error(`Missing monster spec: ${opts.monster_id}`);
  }
  const existing = opts.profile.monsters[opts.monster_id];
  const coerced = coerce_config(spec, existing, opts.lobby_move_slots);
  if (!existing) {
    opts.profile.monsters[opts.monster_id] = coerced;
    save_profile(opts.profile_key, opts.profile);
    return coerced;
  }
  const has_existing_shape = Array.isArray(existing.moves) && typeof existing.passive === "string" && typeof existing.stats === "object" && existing.stats !== null && typeof existing.ev === "object" && existing.ev !== null;
  if (!has_existing_shape) {
    opts.profile.monsters[opts.monster_id] = coerced;
    save_profile(opts.profile_key, opts.profile);
    return coerced;
  }
  let changed = false;
  if (existing.passive !== coerced.passive) {
    existing.passive = coerced.passive;
    changed = true;
  }
  if (!stats_equal(existing.stats, coerced.stats)) {
    existing.stats = coerced.stats;
    changed = true;
  }
  if (!ev_equal(existing.ev, coerced.ev)) {
    existing.ev = coerced.ev;
    changed = true;
  }
  const existing_moves = existing.moves.slice(0, opts.lobby_move_slots);
  const coerced_moves = coerced.moves.slice(0, opts.lobby_move_slots);
  if (existing_moves.length !== coerced_moves.length || existing_moves.some((move, idx) => move !== coerced_moves[idx])) {
    existing.moves = coerced_moves;
    changed = true;
  }
  if (changed) {
    save_profile(opts.profile_key, opts.profile);
  }
  return existing;
}
function reset_profile_stats_to_defaults(opts) {
  let changed = false;
  for (const spec of opts.roster) {
    const config = coerce_config(spec, opts.profile.monsters[spec.id], opts.lobby_move_slots);
    const base_stats = base_stats_from_spec(spec);
    const default_ev = empty_ev_spread();
    const default_moves = default_lobby_moves_for_spec(spec, opts.lobby_move_slots);
    const default_stats = stats_from_base_level_ev(base_stats, base_stats.level, default_ev);
    if (config.moves.some((move, index) => move !== default_moves[index])) {
      changed = true;
    }
    if (config.passive !== "none") {
      changed = true;
    }
    if (!stats_equal(config.stats, default_stats)) {
      changed = true;
    }
    if (!ev_equal(config.ev, default_ev)) {
      changed = true;
    }
    opts.profile.monsters[spec.id] = {
      moves: default_moves,
      passive: "none",
      stats: default_stats,
      ev: default_ev
    };
  }
  save_profile(opts.profile_key, opts.profile);
  return changed;
}
function build_team_selection(opts) {
  if (opts.selected.length !== TEAM_SELECTION_SIZE) {
    return { team: null, warning: "Select exactly 3 monsters before ready." };
  }
  const monsters = [];
  for (const id of opts.selected) {
    if (!opts.is_lobby_enabled_monster(id)) {
      return { team: null, warning: `${opts.monster_label(id)} is disabled.` };
    }
    const spec = opts.roster_by_id.get(id);
    if (!spec) {
      return { team: null, warning: `Unknown monster: ${id}` };
    }
    const base_stats = base_stats_from_spec(spec);
    const config = opts.get_config(id);
    const ev_error = validate_ev_spread(config.ev);
    if (ev_error) {
      return { team: null, warning: `${opts.monster_label(id)}: ${ev_error}` };
    }
    const level = normalize_stat_value("level", config.stats.level, base_stats.level);
    const stats = stats_from_base_level_ev(base_stats, level, config.ev);
    config.stats = stats;
    monsters.push({
      id,
      type: spec.type,
      moves: config.moves.slice(0, opts.lobby_move_slots),
      passive: "none",
      stats: { ...stats },
      ev: { ...config.ev }
    });
  }
  return {
    team: { monsters, activeIndex: 0 },
    warning: null
  };
}

// vibishowdown/relay_runtime.ts
var PLAYER_SLOTS = ["player1", "player2"];
function is_server_managed_post(data) {
  return data.$ === "assign" || data.$ === "spectator" || data.$ === "participants" || data.$ === "ready_state" || data.$ === "turn_start" || data.$ === "state" || data.$ === "intent_locked";
}
function legacy_player_id(name) {
  return `legacy:${name}`;
}
function relay_identity(data) {
  const candidate = data.player_id;
  if (typeof candidate === "string" && candidate.length > 0) {
    return candidate;
  }
  if (data.$ === "join") {
    return legacy_player_id(data.name);
  }
  if (data.$ === "chat") {
    return legacy_player_id(data.from);
  }
  return null;
}

class RelayRuntime {
  options;
  relay_server_managed = false;
  relay_ended = false;
  relay_turn = 0;
  relay_state = null;
  relay_turn_timeout_id = null;
  relay_turn_duration_ms;
  relay_local_role = null;
  relay_seen_indexes = new Set;
  relay_names_by_id = new Map;
  relay_last_seen_at = new Map;
  relay_slot_by_id = new Map;
  relay_ids_by_slot = { player1: null, player2: null };
  relay_join_order = [];
  relay_ready_order_ids = [];
  relay_team_by_id = new Map;
  relay_intents = { player1: null, player2: null };
  relay_forced_switch_intents = { player1: null, player2: null };
  constructor(options) {
    this.options = options;
    this.relay_turn_duration_ms = Math.max(1000, Math.floor(options.turn_duration_ms));
  }
  set_turn_duration_ms(next_ms) {
    this.relay_turn_duration_ms = Math.max(1000, Math.floor(next_ms));
  }
  is_server_managed() {
    return this.relay_server_managed;
  }
  default_intent(state, slot_id) {
    return this.relay_default_intent(state, slot_id);
  }
  consume_network_message(message) {
    if (!is_room_info_post_envelope(message)) {
      return;
    }
    if (this.relay_seen_indexes.has(message.index)) {
      return;
    }
    this.relay_seen_indexes.add(message.index);
    const seen_at = message.server_time;
    const data = message.data;
    if (is_server_managed_post(data)) {
      this.relay_server_managed = true;
      this.emit_local_post(data);
      return;
    }
    if (this.relay_server_managed) {
      this.emit_local_post(data);
      return;
    }
    this.relay_consume_post(data, seen_at);
    this.relay_prune_inactive(seen_at);
  }
  prune_inactive(now_ms) {
    this.relay_prune_inactive(now_ms);
  }
  emit_local_post(data) {
    this.options.emit_local_post(data);
  }
  relay_name(id) {
    return this.relay_names_by_id.get(id) ?? id;
  }
  relay_names_by_slot() {
    const p1 = this.relay_ids_by_slot.player1;
    const p2 = this.relay_ids_by_slot.player2;
    return {
      player1: p1 ? this.relay_name(p1) : null,
      player2: p2 ? this.relay_name(p2) : null
    };
  }
  relay_spectator_names() {
    return this.relay_join_order.filter((id) => !this.relay_slot_by_id.has(id)).map((id) => this.relay_name(id));
  }
  relay_emit_snapshots() {
    const names = this.relay_names_by_slot();
    const ready = {
      player1: !!this.relay_ids_by_slot.player1,
      player2: !!this.relay_ids_by_slot.player2
    };
    const order = [];
    if (ready.player1) {
      order.push("player1");
    }
    if (ready.player2) {
      order.push("player2");
    }
    this.emit_local_post({
      $: "ready_state",
      ready,
      names,
      order
    });
    this.emit_local_post({
      $: "participants",
      players: names,
      spectators: this.relay_spectator_names()
    });
  }
  relay_emit_local_role() {
    const local_slot = this.relay_slot_by_id.get(this.options.player_id);
    if (local_slot) {
      if (this.relay_local_role === local_slot) {
        return;
      }
      this.relay_local_role = local_slot;
      this.emit_local_post({
        $: "assign",
        slot: local_slot,
        token: this.options.player_id,
        name: this.relay_name(this.options.player_id)
      });
      return;
    }
    if (this.relay_join_order.includes(this.options.player_id)) {
      if (this.relay_local_role === "spectator") {
        return;
      }
      this.relay_local_role = "spectator";
      this.emit_local_post({ $: "spectator", name: this.relay_name(this.options.player_id) });
      return;
    }
    this.relay_local_role = null;
  }
  relay_recompute_slots_from_ready_order() {
    this.relay_slot_by_id.clear();
    const p1 = this.relay_ready_order_ids[0] ?? null;
    const p2 = this.relay_ready_order_ids[1] ?? null;
    this.relay_ids_by_slot.player1 = p1;
    this.relay_ids_by_slot.player2 = p2;
    if (p1) {
      this.relay_slot_by_id.set(p1, "player1");
    }
    if (p2) {
      this.relay_slot_by_id.set(p2, "player2");
    }
  }
  relay_reset_match_to_lobby() {
    this.relay_clear_turn_timer();
    this.relay_state = null;
    this.relay_ended = false;
    this.relay_turn = 0;
    this.relay_intents.player1 = null;
    this.relay_intents.player2 = null;
    this.relay_forced_switch_intents.player1 = null;
    this.relay_forced_switch_intents.player2 = null;
    this.relay_team_by_id.clear();
    this.relay_ready_order_ids.length = 0;
    this.relay_recompute_slots_from_ready_order();
    this.relay_emit_local_role();
    this.relay_emit_snapshots();
  }
  relay_remove_participant(id) {
    const join_idx = this.relay_join_order.indexOf(id);
    if (join_idx >= 0) {
      this.relay_join_order.splice(join_idx, 1);
    }
    this.relay_last_seen_at.delete(id);
    this.relay_names_by_id.delete(id);
    this.relay_team_by_id.delete(id);
    const ready_idx = this.relay_ready_order_ids.indexOf(id);
    if (ready_idx >= 0) {
      this.relay_ready_order_ids.splice(ready_idx, 1);
    }
    this.relay_recompute_slots_from_ready_order();
    this.relay_intents.player1 = null;
    this.relay_intents.player2 = null;
    this.relay_forced_switch_intents.player1 = null;
    this.relay_forced_switch_intents.player2 = null;
  }
  relay_prune_inactive(now_ms) {
    let changed = false;
    for (let i = this.relay_join_order.length - 1;i >= 0; i--) {
      const id = this.relay_join_order[i];
      const seen_at = this.relay_last_seen_at.get(id);
      if (typeof seen_at !== "number") {
        this.relay_remove_participant(id);
        changed = true;
        continue;
      }
      if (now_ms - seen_at <= this.options.relay_watcher_ttl_ms) {
        continue;
      }
      const slot_id = this.relay_slot_by_id.get(id);
      if (slot_id && this.relay_state?.status === "running") {
        continue;
      }
      this.relay_remove_participant(id);
      changed = true;
    }
    if (!changed) {
      return;
    }
    this.relay_emit_local_role();
    this.relay_emit_snapshots();
  }
  relay_clear_turn_timer() {
    if (this.relay_turn_timeout_id === null) {
      return;
    }
    window.clearTimeout(this.relay_turn_timeout_id);
    this.relay_turn_timeout_id = null;
  }
  relay_default_forced_switch_target(state, slot_id) {
    const player = state.players[slot_id];
    for (let index = 0;index < player.team.length; index++) {
      if (index === player.activeIndex) {
        continue;
      }
      if (player.team[index].hp <= 0) {
        continue;
      }
      return index;
    }
    return null;
  }
  relay_default_switch_target(state, slot_id) {
    const player = state.players[slot_id];
    for (let index = 0;index < player.team.length; index++) {
      if (index === player.activeIndex) {
        continue;
      }
      if (player.team[index].hp <= 0) {
        continue;
      }
      return index;
    }
    return null;
  }
  relay_default_intent(state, slot_id) {
    const player = state.players[slot_id];
    const active = player.team[player.activeIndex];
    const none_index = active.chosenMoves.findIndex((move_id) => move_id === "none");
    if (none_index >= 0) {
      const none_intent = { action: "use_move", moveIndex: none_index };
      if (!validate_intent(state, slot_id, none_intent)) {
        return none_intent;
      }
    }
    for (let index = 0;index < active.chosenMoves.length; index++) {
      const candidate = { action: "use_move", moveIndex: index };
      if (!validate_intent(state, slot_id, candidate)) {
        return candidate;
      }
    }
    const run_intent = { action: "run" };
    if (!validate_intent(state, slot_id, run_intent)) {
      return run_intent;
    }
    return { action: "use_move", moveIndex: 0 };
  }
  relay_try_resolve_turn(trigger) {
    if (!this.relay_state || this.relay_ended) {
      return;
    }
    if (trigger === "timeout") {
      for (const slot_id of PLAYER_SLOTS) {
        if (this.relay_intents[slot_id]) {
          continue;
        }
        let validation_state = this.relay_state;
        if (this.relay_state.pendingSwitch[slot_id]) {
          const forced_target = this.relay_forced_switch_intents[slot_id] ?? this.relay_default_forced_switch_target(this.relay_state, slot_id);
          if (typeof forced_target === "number") {
            const forced_preview = apply_forced_switch(this.relay_state, slot_id, forced_target);
            if (!forced_preview.error) {
              this.relay_forced_switch_intents[slot_id] = forced_target;
              validation_state = forced_preview.state;
            }
          }
        }
        this.relay_intents[slot_id] = this.relay_default_intent(validation_state, slot_id);
        this.emit_local_post({ $: "intent_locked", slot: slot_id, turn: this.relay_turn });
      }
    }
    if (!this.relay_intents.player1 || !this.relay_intents.player2) {
      return;
    }
    for (const slot_check of PLAYER_SLOTS) {
      if (this.relay_state.pendingSwitch[slot_check] && !Number.isInteger(this.relay_forced_switch_intents[slot_check])) {
        return;
      }
    }
    let turn_state = this.relay_state;
    const pre_turn_log = [];
    for (const slot_apply of PLAYER_SLOTS) {
      if (!turn_state.pendingSwitch[slot_apply]) {
        continue;
      }
      const target_candidate = this.relay_forced_switch_intents[slot_apply];
      if (typeof target_candidate !== "number" || !Number.isInteger(target_candidate)) {
        return;
      }
      const switch_result = apply_forced_switch(turn_state, slot_apply, target_candidate);
      if (switch_result.error) {
        return;
      }
      turn_state = switch_result.state;
      pre_turn_log.push(...switch_result.log);
    }
    const { state, log } = resolve_turn(turn_state, {
      player1: this.relay_intents.player1,
      player2: this.relay_intents.player2
    });
    this.relay_state = state;
    this.emit_local_post({ $: "state", turn: this.relay_turn, state: this.relay_state, log: [...pre_turn_log, ...log] });
    if (this.relay_state.status === "ended") {
      this.relay_ended = true;
      this.relay_reset_match_to_lobby();
      return;
    }
    this.relay_start_turn();
  }
  relay_on_turn_timeout(expected_turn) {
    if (expected_turn !== this.relay_turn) {
      return;
    }
    this.relay_try_resolve_turn("timeout");
  }
  relay_start_turn() {
    if (!this.relay_state || this.relay_ended) {
      return;
    }
    this.relay_clear_turn_timer();
    this.relay_turn += 1;
    this.relay_state.turn = this.relay_turn;
    this.relay_intents.player1 = null;
    this.relay_intents.player2 = null;
    this.relay_forced_switch_intents.player1 = null;
    this.relay_forced_switch_intents.player2 = null;
    const turn_duration_ms = Math.max(1000, this.relay_turn_duration_ms);
    const deadline_at = Date.now() + turn_duration_ms;
    const scheduled_turn = this.relay_turn;
    this.relay_turn_timeout_id = window.setTimeout(() => this.relay_on_turn_timeout(scheduled_turn), turn_duration_ms);
    this.emit_local_post({
      $: "turn_start",
      turn: this.relay_turn,
      deadline_at,
      intents: { player1: false, player2: false }
    });
  }
  relay_start_match_if_ready() {
    if (this.relay_state || this.relay_ended) {
      return;
    }
    const p1 = this.relay_ids_by_slot.player1;
    const p2 = this.relay_ids_by_slot.player2;
    if (!p1 || !p2) {
      return;
    }
    const p1_team = this.relay_team_by_id.get(p1);
    const p2_team = this.relay_team_by_id.get(p2);
    if (!p1_team || !p2_team) {
      return;
    }
    const names = this.relay_names_by_slot();
    try {
      this.relay_state = create_initial_state({
        player1: p1_team,
        player2: p2_team
      }, {
        player1: names.player1 || "player1",
        player2: names.player2 || "player2"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid team";
      this.options.append_chat(`team error: ${message}`);
      return;
    }
    this.relay_state.status = "running";
    this.relay_turn = 0;
    this.emit_local_post({ $: "state", turn: 0, state: this.relay_state, log: [] });
    this.relay_start_turn();
  }
  relay_handle_join(data) {
    const id = relay_identity(data);
    if (!id) {
      return;
    }
    const is_first_join = !this.relay_join_order.includes(id);
    this.relay_names_by_id.set(id, data.name);
    if (is_first_join) {
      this.relay_join_order.push(id);
      this.emit_local_post({ $: "join", name: data.name });
    }
    this.relay_emit_local_role();
    this.relay_emit_snapshots();
  }
  relay_handle_ready(data) {
    if (this.relay_state?.status === "running") {
      return;
    }
    const id = relay_identity(data);
    if (!id) {
      return;
    }
    if (!data.ready) {
      this.relay_team_by_id.delete(id);
      const idx = this.relay_ready_order_ids.indexOf(id);
      if (idx >= 0) {
        this.relay_ready_order_ids.splice(idx, 1);
      }
      this.relay_recompute_slots_from_ready_order();
      this.relay_emit_local_role();
      this.relay_emit_snapshots();
      return;
    }
    if (!data.team) {
      return;
    }
    this.relay_team_by_id.set(id, data.team);
    if (!this.relay_ready_order_ids.includes(id)) {
      this.relay_ready_order_ids.push(id);
    }
    this.relay_recompute_slots_from_ready_order();
    this.relay_emit_local_role();
    this.relay_emit_snapshots();
    this.relay_start_match_if_ready();
  }
  relay_handle_intent(data) {
    if (!this.relay_state || this.relay_ended) {
      return;
    }
    const id = relay_identity(data);
    if (!id) {
      return;
    }
    const slot_id = this.relay_slot_by_id.get(id);
    if (!slot_id) {
      return;
    }
    if (data.turn !== this.relay_turn) {
      return;
    }
    let validation_state = this.relay_state;
    if (this.relay_state.pendingSwitch[slot_id]) {
      const forced_target_candidate = Number.isInteger(data.forcedSwitchTargetIndex) ? data.forcedSwitchTargetIndex : this.relay_forced_switch_intents[slot_id];
      if (typeof forced_target_candidate !== "number" || !Number.isInteger(forced_target_candidate)) {
        return;
      }
      const forced_target = forced_target_candidate;
      const forced_preview = apply_forced_switch(this.relay_state, slot_id, forced_target);
      if (forced_preview.error) {
        return;
      }
      validation_state = forced_preview.state;
      this.relay_forced_switch_intents[slot_id] = forced_target;
    } else {
      this.relay_forced_switch_intents[slot_id] = null;
    }
    const validation = validate_intent(validation_state, slot_id, data.intent);
    if (validation) {
      return;
    }
    this.relay_intents[slot_id] = data.intent;
    this.relay_try_resolve_turn("intent");
  }
  relay_handle_forced_switch(data) {
    if (!this.relay_state || this.relay_ended) {
      return;
    }
    const id = relay_identity(data);
    if (!id) {
      return;
    }
    const slot_id = this.relay_slot_by_id.get(id);
    if (!slot_id) {
      return;
    }
    if (!this.relay_state.pendingSwitch[slot_id]) {
      return;
    }
    const forced_preview = apply_forced_switch(this.relay_state, slot_id, data.targetIndex);
    if (forced_preview.error) {
      return;
    }
    this.relay_forced_switch_intents[slot_id] = data.targetIndex;
  }
  relay_handle_surrender(data) {
    if (!this.relay_state || this.relay_ended || "loser" in data) {
      return;
    }
    const id = relay_identity(data);
    if (!id) {
      return;
    }
    const loser = this.relay_slot_by_id.get(id);
    if (!loser) {
      return;
    }
    const winner = loser === "player1" ? "player2" : "player1";
    this.relay_state.status = "ended";
    this.relay_state.winner = winner;
    this.relay_state.endReason = "surrender";
    delete this.relay_state.mSPESlots;
    this.relay_ended = true;
    const log = [
      {
        type: "match_end",
        turn: this.relay_turn,
        summary: `${winner} wins (surrender)`,
        data: { winner, reason: "surrender" }
      }
    ];
    this.emit_local_post({ $: "state", turn: this.relay_turn, state: this.relay_state, log });
    this.emit_local_post({ $: "surrender", turn: this.relay_turn, loser, winner });
    this.relay_reset_match_to_lobby();
  }
  relay_consume_post(data, seen_at) {
    const id = relay_identity(data);
    if (id) {
      this.relay_last_seen_at.set(id, seen_at);
    }
    switch (data.$) {
      case "join":
        this.relay_handle_join(data);
        return;
      case "chat":
        this.emit_local_post(data);
        return;
      case "turn_config":
        this.emit_local_post(data);
        return;
      case "ready":
        this.relay_handle_ready(data);
        return;
      case "intent":
        this.relay_handle_intent(data);
        return;
      case "forced_switch":
        this.relay_handle_forced_switch(data);
        return;
      case "surrender":
        this.relay_handle_surrender(data);
        return;
      case "error":
        this.emit_local_post(data);
        return;
      default:
        return;
    }
  }
}

// vibishowdown/index.ts
var STAT_STAGE_MIN2 = -6;
var STAT_STAGE_MAX2 = 6;
var TURN_DURATION_SECONDS_DEFAULT = Math.max(1, Math.floor(TURN_DURATION_MS / 1000));
var TURN_DURATION_SECONDS_MIN = 5;
var TURN_DURATION_SECONDS_MAX = 300;
var LOBBY_MOVE_SLOTS = 3;
var STARTER_MONSTER_IDS = new Set(["armoth", "kairus", "farien", "knight", "vealkiria", "babydragonbuf"]);
var STARTER_DEFAULT_PRIORITY_MOVE_IDS = (() => {
  const move_ids = new Set;
  for (const monster_id of STARTER_MONSTER_IDS) {
    const spec = MONSTER_BY_ID.get(monster_id);
    if (!spec) {
      continue;
    }
    for (const move_id of spec.defaultMoves) {
      if (move_id === "none" || move_id === "run") {
        continue;
      }
      move_ids.add(move_id);
    }
  }
  return Array.from(move_ids).sort((left, right) => (MOVE_LABELS[left] || left).localeCompare(MOVE_LABELS[right] || right, undefined, { sensitivity: "base" }));
})();
var MOVE_TOOLTIP_DELAY_MS = 2000;
var MOVE_TOOLTIP_DESCRIPTIONS = {
  quick_attack: "Golpe rapido com prioridade de fase, ignorando comparacao de DEX.",
  punch: "Golpe fisico com multiplicador 93 (passa por DEF e armadura).",
  power: "Aumenta ATK em +1 stage e reduz DEX em 10% do base.",
  hook: "Impede o Run do adversario neste turno; se ele tentar Run, recebe -20% de mSPE. Aplica Exposicao no usuario (+66% dano recebido em fases de ataque) e auto-aplica -10% de mSPE.",
  kick: "Golpe fisico forte de dano escalado.",
  throw: "Golpe com formula fixa (90x90) escalada pelo nivel de formula.",
  agility: "Buff de DEX (x2) ate trocar.",
  run: "Acao da fase Run (ultima): +10% de M.SPE sem reset por switch.",
  wish: "No proximo turno, no comeco do ending_turn, cura 50% do HP maximo do ativo.",
  rejuvenation: "Cura 50% do dano sofrido no turno (se houver), ativa regen de +30 por turno e cada recast adiciona +30 no proximo turno ate o maximo de +90.",
  switch_sovietico: "Arma switch obrigatorio para ambos no proximo turno.",
  team_cure: "Remove efeitos negativos e debuffs negativos do seu lado.",
  bait: "So funciona se tomou dano antes no turno; aplica Weakness por 2 turnos.",
  belly_drum: "Se HP atual > 50%, paga metade do HP atual e aumenta muito o ATK.",
  return: "Dano escalado; o poder sobe com o nivel atual da mutacao.",
  double_edge: "Golpe forte com recoil de 1/3 do dano final causado.",
  seismic_toss: "Dano flat fixo de 50, ignorando DEF.",
  leech_life: "Aplica Leech Seed (dreno no ending_turn) ate o alvo trocar.",
  sekyps: "Aplica o debuff Sekyps: no ending_turn causa dano flat 24 por stack (24/48/72/...), stacka ao reaplicar, nao remove no switch, cada stack novo so entra no dano no turno seguinte e nao causa dano no turno em que o alvo troca.",
  focus_punch: "Carrega e resolve no inicio do ending_turn; falha se tomar dano real antes.",
  pain_split: "Ambos ficam com floor((HP_user + HP_target)/2), respeitando clamp de HP.",
  screech: "Reduz DEF do alvo em 50% ate trocar.",
  taunt: "Forca o alvo a usar moves de ataque por 2 turnos.",
  spikes: "Arma Spikes no lado inimigo para causar dano em switches futuros.",
  recover: "Cura 20% do HP compartilhado maximo.",
  heal: "Cura 20% do HP compartilhado maximo.",
  mega_punch: "Golpe de dano flat 20.",
  meditate: "Aumenta o ATK por estagios (stackavel).",
  ki_blast: "Dano verdadeiro baseado na STR efetiva: 75% da STR (ignora DEF/armor).",
  endure: "Sobrevive ao dano letal no turno (minimo 1% HP) e ganha DEX ao ativar.",
  protect: "Bloqueia dano no turno. Compartilha cooldown com Endure.",
  none: "Nao faz acao neste turno."
};
var PLAYER_SLOTS2 = ["player1", "player2"];
var LAST_ROOM_KEY = "vibi_showdown_last_room";
var LAST_PLAYER_NAME_KEY = "vibi_showdown_last_player_name";
function normalize_identity_value(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
function read_saved_identity_value(key) {
  try {
    return normalize_identity_value(localStorage.getItem(key));
  } catch {
    return null;
  }
}
function save_identity_value(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}
function prompt_identity(label, fallback) {
  const next = normalize_identity_value(prompt(label, fallback));
  return next ?? fallback;
}
function resolve_session_identity() {
  const params = new URLSearchParams(window.location.search);
  const room_param = normalize_identity_value(params.get("room"));
  const name_param = normalize_identity_value(params.get("name"));
  const default_room = room_param ?? read_saved_identity_value(LAST_ROOM_KEY) ?? gen_name();
  const default_name = name_param ?? read_saved_identity_value(LAST_PLAYER_NAME_KEY) ?? gen_name();
  const resolved_room = prompt_identity("Room name?", default_room);
  const resolved_name = prompt_identity("Your name?", default_name);
  save_identity_value(LAST_ROOM_KEY, resolved_room);
  save_identity_value(LAST_PLAYER_NAME_KEY, resolved_name);
  return { room: resolved_room, player_name: resolved_name };
}
var { room, player_name } = resolve_session_identity();
function stable_player_id_from_name(name) {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, " ");
  return `name:${encodeURIComponent(normalized)}`;
}
var player_id = stable_player_id_from_name(player_name);
var profile_key = `vibi_showdown_profile:${player_name}`;
var team_key = `vibi_showdown_team:${room}:${player_name}`;
var status_room = document.getElementById("status-room");
var status_name = document.getElementById("status-name");
var status_slot = document.getElementById("status-slot");
var status_conn = document.getElementById("status-conn");
var status_ping = document.getElementById("status-ping");
var status_turn = document.getElementById("status-turn");
var status_deadline = document.getElementById("status-deadline");
var status_rps = document.getElementById("status-rps");
var status_evade = document.getElementById("status-mSPE");
var spec_view = document.getElementById("spec-view");
var spec_view_p1 = document.getElementById("spec-view-p1");
var spec_view_p2 = document.getElementById("spec-view-p2");
var status_ready = document.getElementById("status-ready");
var status_opponent = document.getElementById("status-opponent");
var chat_messages = document.getElementById("chat-messages");
var log_list = document.getElementById("log-list") ?? chat_messages;
var chat_input = document.getElementById("chat-input");
var chat_send = document.getElementById("chat-send");
var participants_list = document.getElementById("participants-list");
var stat_tooltip = document.getElementById("stat-tooltip");
var move_tooltip = document.getElementById("move-tooltip");
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
var player_effects = document.getElementById("player-effects");
var enemy_effects = document.getElementById("enemy-effects");
var prematch = document.getElementById("prematch");
var prematch_hint = document.getElementById("prematch-hint");
var ready_btn = document.getElementById("ready-btn");
var reset_status_btn = document.getElementById("reset-status-btn");
var turn_seconds_input = document.getElementById("turn-seconds-input");
var move_buttons = [
  document.getElementById("move-btn-0"),
  document.getElementById("move-btn-1"),
  document.getElementById("move-btn-2")
];
var run_btn = document.getElementById("run-btn");
var surrender_btn = document.getElementById("surrender-btn");
var switch_modal = document.getElementById("switch-modal");
var switch_title = switch_modal.querySelector(".switch-title");
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
var lobby_turn_duration_seconds = TURN_DURATION_SECONDS_DEFAULT;
var slot = null;
var is_ready = false;
var match_started = false;
var latest_state = null;
var opponent_ready = false;
var opponent_name = null;
var is_spectator = false;
var spectator_viewer_slot = "player1";
var last_ready_snapshot = null;
var participants = null;
var ready_order = [];
var selected_intent = null;
var selected_intent_turn = 0;
var hp_animation = {};
var animation_timers = [];
var sprite_fx_classes = ["jump", "hit", "heal", "shield-on", "shield-hit"];
var selected = [];
var active_tab = null;
var tooltip_payload_by_element = new WeakMap;
var active_tooltip_target = null;
var move_tooltip_target = null;
var move_tooltip_pending_target = null;
var move_tooltip_delay_timer = null;
var move_tooltip_mouse_x = 0;
var move_tooltip_mouse_y = 0;
var RELAY_WATCHER_TTL_MS = 90000;
var RELAY_JOIN_HEARTBEAT_MS = 25000;
var relay_runtime;
var join_sent = false;
var room_feed_started = false;
var chat_ready = false;
var forced_switch_target_index = null;
var forced_switch_target_turn = 0;
var switch_modal_mode = "intent";
var room_game_count = 0;
var ICON_ALIASES = {
  armoth: "panda",
  kairus: "harpy",
  farien: "miren",
  night_sekyps: "knight",
  vealkiria: "valkyria",
  babydragonbuf: "babydragon"
};
function icon_path(id) {
  const resolved = ICON_ALIASES[id] ?? id;
  return `./icons/unit_${resolved}.png`;
}
function is_lobby_enabled_monster(id) {
  return STARTER_MONSTER_IDS.has(id);
}
function monster_type_description(type) {
  if (type === "def")
    return "DEF";
  if (type === "atk")
    return "ATK";
  return "BUF";
}
function default_evade_telemetry() {
  return {
    effectiveMSPE: SHARED_MSPE_START,
    mSPEGoal: 500,
    mSPEReady: false,
    gapPercent: 0,
    gapGoalPercent: 33,
    gapReady: false,
    canMSPE: false
  };
}
function normalize_turn_duration_seconds(value, fallback = TURN_DURATION_SECONDS_DEFAULT) {
  const raw = typeof value === "number" ? value : typeof value === "string" && value.trim().length > 0 ? Number(value) : fallback;
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  const normalized = normalize_int(raw, fallback, TURN_DURATION_SECONDS_MIN);
  return Math.max(TURN_DURATION_SECONDS_MIN, Math.min(TURN_DURATION_SECONDS_MAX, normalized));
}
function apply_turn_duration_seconds(next_seconds) {
  const normalized = normalize_turn_duration_seconds(next_seconds, lobby_turn_duration_seconds);
  lobby_turn_duration_seconds = normalized;
  relay_runtime.set_turn_duration_ms(normalized * 1000);
  update_turn_duration_input();
}
function update_turn_duration_input() {
  if (!turn_seconds_input) {
    return;
  }
  turn_seconds_input.value = `${lobby_turn_duration_seconds}`;
  turn_seconds_input.disabled = match_started || is_ready;
}
function send_turn_duration_config(next_seconds) {
  const normalized = normalize_turn_duration_seconds(next_seconds, lobby_turn_duration_seconds);
  const changed = normalized !== lobby_turn_duration_seconds;
  apply_turn_duration_seconds(normalized);
  if (!changed || match_started) {
    return;
  }
  try_post({ $: "turn_config", turnDurationSeconds: normalized, player_id });
}
function read_evade_telemetry(state, slot_id) {
  const input = state.mSPETelemetry?.[slot_id];
  if (!input) {
    return default_evade_telemetry();
  }
  const evade_goal_raw = Number.isFinite(input.mSPEGoal) && input.mSPEGoal > 0 ? input.mSPEGoal : Number.isFinite(input.speedGoal) && input.speedGoal > 0 ? input.speedGoal : 500;
  const evade_goal = Math.floor(evade_goal_raw);
  const gap_goal_raw = typeof input.gapGoalPercent === "number" ? input.gapGoalPercent : 33;
  const gap_goal = Number.isFinite(gap_goal_raw) && gap_goal_raw > 0 ? Math.floor(gap_goal_raw) : 33;
  const evade_raw = Number.isFinite(input.effectiveMSPE) ? input.effectiveMSPE : Number.isFinite(input.effectiveSpeed) ? input.effectiveSpeed : SHARED_MSPE_START;
  const mSPE = Math.max(0, Math.floor(evade_raw));
  const gap = typeof input.gapPercent === "number" && Number.isFinite(input.gapPercent) ? Math.round(input.gapPercent) : 0;
  const evade_ready = !!input.mSPEReady || !!input.speedReady || mSPE >= evade_goal;
  const gap_ready = !!input.gapReady || gap >= gap_goal;
  return {
    effectiveMSPE: mSPE,
    mSPEGoal: evade_goal,
    mSPEReady: evade_ready,
    gapPercent: gap,
    gapGoalPercent: gap_goal,
    gapReady: gap_ready,
    canMSPE: !!input.canMSPE || evade_ready || gap_ready
  };
}
function signed_percent(value) {
  if (!Number.isFinite(value)) {
    return "0%";
  }
  const rounded = Math.round(value);
  return `${rounded >= 0 ? "+" : ""}${rounded}%`;
}
function current_viewer_slot() {
  if (slot) {
    return slot;
  }
  if (is_spectator) {
    return spectator_viewer_slot;
  }
  return null;
}
function update_spec_view_controls() {
  if (!spec_view || !spec_view_p1 || !spec_view_p2) {
    return;
  }
  const visible = is_spectator && !slot;
  spec_view.hidden = !visible;
  spec_view_p1.classList.toggle("active", spectator_viewer_slot === "player1");
  spec_view_p2.classList.toggle("active", spectator_viewer_slot === "player2");
  spec_view_p1.disabled = spectator_viewer_slot === "player1";
  spec_view_p2.disabled = spectator_viewer_slot === "player2";
}
function set_spectator_viewer_slot(next_slot) {
  spectator_viewer_slot = next_slot;
  update_spec_view_controls();
  if (!latest_state) {
    return;
  }
  update_panels(latest_state);
  update_action_controls();
}
function update_evade_status(state) {
  if (!status_evade) {
    return;
  }
  status_evade.classList.remove("ready");
  if (!state) {
    status_evade.textContent = "mSPE --";
    return;
  }
  const p1 = read_evade_telemetry(state, "player1");
  const p2 = read_evade_telemetry(state, "player2");
  if (!slot) {
    status_evade.textContent = `mSPE P1 ${p1.effectiveMSPE}/${p1.mSPEGoal} ${signed_percent(p1.gapPercent)}/${p1.gapGoalPercent}% | P2 ${p2.effectiveMSPE}/${p2.mSPEGoal} ${signed_percent(p2.gapPercent)}/${p2.gapGoalPercent}%`;
    if (p1.canMSPE || p2.canMSPE) {
      status_evade.classList.add("ready");
    }
    return;
  }
  const enemy_slot = slot === "player1" ? "player2" : "player1";
  const mine = read_evade_telemetry(state, slot);
  const enemy = read_evade_telemetry(state, enemy_slot);
  status_evade.textContent = `mSPE ME ${mine.effectiveMSPE}/${mine.mSPEGoal} ${signed_percent(mine.gapPercent)}/${mine.gapGoalPercent}% | EN ${enemy.effectiveMSPE}/${enemy.mSPEGoal} ${signed_percent(enemy.gapPercent)}/${enemy.gapGoalPercent}%`;
  if (mine.canMSPE) {
    status_evade.classList.add("ready");
  }
}
function update_rps_status(state) {
  if (status_rps) {
    if (!state) {
      status_rps.textContent = "PTS -- | --";
    } else {
      const p1 = state.rpsScore?.player1 ?? 0;
      const p2 = state.rpsScore?.player2 ?? 0;
      if (!slot) {
        status_rps.textContent = `PTS P1 ${p1} | P2 ${p2}`;
      } else {
        const enemy_slot = slot === "player1" ? "player2" : "player1";
        const my_score = state.rpsScore?.[slot] ?? 0;
        const enemy_score = state.rpsScore?.[enemy_slot] ?? 0;
        status_rps.textContent = `PTS ${my_score} x ${enemy_score}`;
      }
    }
  }
  update_evade_status(state);
}
function emit_local_post(data) {
  handle_post({ data });
}
relay_runtime = new RelayRuntime({
  player_id,
  relay_watcher_ttl_ms: RELAY_WATCHER_TTL_MS,
  turn_duration_ms: TURN_DURATION_MS,
  emit_local_post,
  append_chat
});
function consume_network_message(message) {
  relay_runtime.consume_network_message(message);
}
function ensure_participants_state() {
  if (!participants) {
    participants = {
      players: { player1: null, player2: null },
      spectators: []
    };
  }
  return participants;
}
function add_spectator(name) {
  if (!name)
    return;
  const state = ensure_participants_state();
  if (state.players.player1 === name || state.players.player2 === name) {
    return;
  }
  if (!state.spectators.includes(name)) {
    state.spectators.push(name);
  }
}
function set_player_name(slot_id, name) {
  const state = ensure_participants_state();
  state.players[slot_id] = name;
  state.spectators = state.spectators.filter((value) => value !== name);
}
function ensure_local_participant_visible() {
  const state = ensure_participants_state();
  const in_player_slot = state.players.player1 === player_name || state.players.player2 === player_name;
  if (!in_player_slot && !state.spectators.includes(player_name)) {
    state.spectators.push(player_name);
  }
}
function monster_label(id, fallback = "mon") {
  if (!id)
    return fallback;
  return MONSTER_BY_ID.get(id)?.name ?? id;
}
function move_label(id) {
  return MOVE_LABELS[id] || id;
}
function stat_label(value) {
  if (value === "attack")
    return "ATK";
  if (value === "defense")
    return "DEF";
  if (value === "speed")
    return "DEX";
  if (value === "hp" || value === "maxHp")
    return "HP";
  if (typeof value === "string" && value.trim())
    return value.trim().toUpperCase();
  return "STAT";
}
function format_multiplier(value) {
  if (!Number.isFinite(value))
    return "x?";
  if (Number.isInteger(value))
    return `x${value}`;
  return `x${value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}`;
}
function stat_mod_feedback(entry) {
  if (entry.type !== "stat_mod") {
    return null;
  }
  const data = entry.data;
  if (!data) {
    return null;
  }
  const before = typeof data.before === "number" ? data.before : null;
  const after = typeof data.after === "number" ? data.after : null;
  if (before === null || after === null) {
    return null;
  }
  const target_name = typeof data.target === "string" ? monster_label(data.target) : "alvo";
  const label = stat_label(data.stat);
  const multiplier_text = typeof data.multiplier === "number" && Number.isFinite(data.multiplier) ? ` ${format_multiplier(data.multiplier)}` : "";
  if (before === after) {
    return `modificador sem efeito: ${target_name} ${label}${multiplier_text} (${before} -> ${after})`;
  }
  return `modificador aplicado: ${target_name} ${label}${multiplier_text} (${before} -> ${after})`;
}
function base_stats_for(monster_id, level, ev) {
  const spec = MONSTER_BY_ID.get(monster_id);
  if (!spec) {
    return { attack: 0, defense: 0, speed: 0 };
  }
  const base_stats = base_stats_from_spec(spec);
  const resolved_level = normalize_stat_value("level", level, base_stats.level);
  const resolved_ev = normalize_ev_spread(ev);
  const baseline = stats_from_base_level_ev(base_stats, resolved_level, resolved_ev);
  return {
    attack: baseline.attack,
    defense: baseline.defense,
    speed: baseline.speed
  };
}
var TOOLTIP_ARMOR_STACK_MAX = 5;
var TOOLTIP_ARMOR_BONUS_PERCENT_PER_STACK = 10;
var TOOLTIP_STAT_MULTIPLIER_MIN_PERCENT = 25;
var TOOLTIP_STAT_MULTIPLIER_MAX_PERCENT = 400;
var REJUVENATION_REGEN_PER_STACK = 30;
var LEECH_SEED_HP_DIVISOR = 8;
var SEKYPS_DAMAGE_PER_STACK_UI = 24;
var POWER_ATTACK_STAGE_UI_IDS = new Set(["power_attack_up", "power_attack_stage_up"]);
function armor_stacks_for_slot(state, slot_id) {
  const raw = state.typePassiveArmorStacks?.[slot_id] ?? 0;
  if (!Number.isFinite(raw)) {
    return 0;
  }
  return Math.max(0, Math.min(TOOLTIP_ARMOR_STACK_MAX, Math.floor(raw)));
}
function clamp_tooltip_total_percent(total_percent) {
  return Math.max(TOOLTIP_STAT_MULTIPLIER_MIN_PERCENT, Math.min(TOOLTIP_STAT_MULTIPLIER_MAX_PERCENT, total_percent));
}
function tooltip_stat_delta_sum(entries, stat) {
  let total = 0;
  for (const entry of entries) {
    if (entry.stat !== stat) {
      continue;
    }
    total += entry.deltaPercent;
  }
  return total;
}
function stage_delta_from_buff_entry(entry) {
  if (entry.stat === "attack" && POWER_ATTACK_STAGE_UI_IDS.has(entry.id)) {
    return 1;
  }
  return 0;
}
function stat_aggregates_from_entries(entries) {
  const by_stat = {
    attack: { stat: "attack", totalDeltaPercent: 0, totalStageDelta: 0 },
    defense: { stat: "defense", totalDeltaPercent: 0, totalStageDelta: 0 },
    speed: { stat: "speed", totalDeltaPercent: 0, totalStageDelta: 0 }
  };
  for (const entry of entries) {
    by_stat[entry.stat].totalDeltaPercent += entry.deltaPercent;
    by_stat[entry.stat].totalStageDelta += stage_delta_from_buff_entry(entry);
  }
  return [by_stat.attack, by_stat.defense, by_stat.speed];
}
function stat_aggregate_for(entries, stat) {
  return stat_aggregates_from_entries(entries).find((entry) => entry.stat === stat) ?? {
    stat,
    totalDeltaPercent: 0,
    totalStageDelta: 0
  };
}
function active_buff_debuffs_for_slot(state, slot_id, options) {
  const raw = state.activeBuffDebuffsBySlot?.[slot_id];
  if (!Array.isArray(raw)) {
    return [];
  }
  const player = state.players[slot_id];
  const selected_monster_id = typeof options?.monsterId === "string" && options.monsterId.trim().length > 0 ? options.monsterId : player.team[player.activeIndex]?.id ?? null;
  const clear_on_switch_preview = options?.clearOnSwitchPreview === true;
  const normalized = [];
  for (const row of raw) {
    if (clear_on_switch_preview && row.clearsOnSwitch === true) {
      continue;
    }
    const target_monster_id = typeof row.targetMonsterId === "string" && row.targetMonsterId.trim().length > 0 ? row.targetMonsterId : null;
    if (target_monster_id && selected_monster_id && target_monster_id !== selected_monster_id) {
      continue;
    }
    if (target_monster_id && !selected_monster_id) {
      continue;
    }
    const id = typeof row.id === "string" && row.id.trim().length > 0 ? row.id : "buff_debuff";
    const stat = row.stat;
    if (stat !== "attack" && stat !== "defense" && stat !== "speed") {
      continue;
    }
    const delta = typeof row.deltaPercent === "number" && Number.isFinite(row.deltaPercent) ? Math.trunc(row.deltaPercent) : 0;
    normalized.push({ id, stat, deltaPercent: delta });
  }
  return normalized;
}
function has_active_effect(state, slot_id, effect_id) {
  const effects = state.activeEffectsBySlot?.[slot_id];
  if (!Array.isArray(effects)) {
    return false;
  }
  return effects.some((row) => row?.id === effect_id);
}
function tooltip_total_percent_for_stat(state, slot_id, stat, entries) {
  let total = 100 + tooltip_stat_delta_sum(entries, stat);
  if (stat === "defense") {
    total += armor_stacks_for_slot(state, slot_id) * TOOLTIP_ARMOR_BONUS_PERCENT_PER_STACK;
  }
  return clamp_tooltip_total_percent(total);
}
function tooltip_stat_value_from_percent(base, total_percent) {
  return Math.max(0, mul_div_round(base, total_percent, 100));
}
function clamp_stage(value) {
  return Math.max(STAT_STAGE_MIN2, Math.min(STAT_STAGE_MAX2, Math.trunc(value)));
}
function attack_from_stage2(base_attack, stage) {
  const normalized = clamp_stage(stage);
  if (normalized >= 0) {
    return Math.max(0, mul_div_round(base_attack, 2 + normalized, 2));
  }
  return Math.max(0, mul_div_round(base_attack, 2, 2 - normalized));
}
function tooltip_from_config(monster_id) {
  const config = get_config2(monster_id);
  const base = base_stats_for(monster_id, config.stats.level, config.ev);
  const spec = MONSTER_BY_ID.get(monster_id);
  const type = spec?.type ?? "atk";
  return {
    id: monster_id,
    name: monster_label(monster_id),
    type,
    moves: config.moves.slice(0, LOBBY_MOVE_SLOTS),
    current: {
      attack: config.stats.attack,
      defense: config.stats.defense,
      speed: config.stats.speed
    },
    base,
    totalPercent: {
      attack: 100,
      defense: 100,
      speed: 100
    },
    stages: {
      attack: 0,
      defense: 0,
      speed: 0
    }
  };
}
function tooltip_from_state(state, slot_id, mon, options) {
  const fallback_base = base_stats_for(mon.id, mon.level);
  const base = {
    attack: Math.max(0, Number.isFinite(mon.baseAttack) ? Math.trunc(mon.baseAttack) : fallback_base.attack),
    defense: Math.max(0, Number.isFinite(mon.baseDefense) ? Math.trunc(mon.baseDefense) : fallback_base.defense),
    speed: Math.max(0, Number.isFinite(mon.baseSpeed) ? Math.trunc(mon.baseSpeed) : fallback_base.speed)
  };
  const preview_switch_in = options?.previewSwitchIn === true;
  const entries = active_buff_debuffs_for_slot(state, slot_id, {
    monsterId: mon.id,
    clearOnSwitchPreview: preview_switch_in
  });
  const attack_aggregate = stat_aggregate_for(entries, "attack");
  const attack_total_percent = tooltip_total_percent_for_stat(state, slot_id, "attack", entries);
  const defense_total_percent = tooltip_total_percent_for_stat(state, slot_id, "defense", entries);
  const speed_total_percent = tooltip_total_percent_for_stat(state, slot_id, "speed", entries);
  const weakness_active = has_active_effect(state, slot_id, "weakness");
  const defense_blocked = has_active_effect(state, slot_id, "deterioration");
  const speed_blocked = has_active_effect(state, slot_id, "paralyse");
  const attack_percented_base = tooltip_stat_value_from_percent(base.attack, attack_total_percent);
  const defense_percented_base = tooltip_stat_value_from_percent(base.defense, defense_total_percent);
  const speed_percented_base = tooltip_stat_value_from_percent(base.speed, speed_total_percent);
  const attack_stage_base = clamp_stage(Number.isFinite(mon.attackStage) ? mon.attackStage : 0);
  const attack_stage_with_buff_entries = clamp_stage(attack_stage_base + attack_aggregate.totalStageDelta);
  const defense_stage_base = clamp_stage(Number.isFinite(mon.defenseStage) ? mon.defenseStage : 0);
  const speed_stage_base = clamp_stage(Number.isFinite(mon.speedStage) ? mon.speedStage : 0);
  const attack_stage_for_display = weakness_active ? clamp_stage(attack_stage_with_buff_entries - 2) : attack_stage_with_buff_entries;
  const attack_value = attack_from_stage2(attack_percented_base, attack_stage_for_display);
  const defense_value = attack_from_stage2(defense_percented_base, defense_stage_base);
  const speed_value = attack_from_stage2(speed_percented_base, speed_stage_base);
  return {
    id: mon.id,
    name: monster_label(mon.id),
    type: mon.type,
    moves: mon.chosenMoves.slice(0, LOBBY_MOVE_SLOTS),
    current: {
      attack: attack_value,
      defense: defense_blocked ? 0 : defense_value,
      speed: speed_blocked ? 0 : speed_value
    },
    base,
    totalPercent: {
      attack: attack_total_percent,
      defense: defense_total_percent,
      speed: speed_total_percent
    },
    stages: {
      attack: attack_stage_for_display,
      defense: defense_stage_base,
      speed: speed_stage_base
    }
  };
}
function tooltip_value_state(current, base) {
  if (current > base)
    return "up";
  if (current < base)
    return "down";
  return "neutral";
}
function set_monster_tooltip(target, payload) {
  if (!target)
    return;
  tooltip_payload_by_element.delete(target);
  target.removeAttribute("data-monster-tooltip");
  target.removeAttribute("title");
  if (!payload) {
    return;
  }
  tooltip_payload_by_element.set(target, payload);
  target.dataset.monsterTooltip = "1";
}
function percent_value_state(percent) {
  if (percent > 100)
    return "up";
  if (percent < 100)
    return "down";
  return "neutral";
}
function tooltip_stat_row(label, current, base, stage, total_percent) {
  const row = document.createElement("div");
  row.className = "stat-tooltip-row";
  const label_el = document.createElement("span");
  label_el.className = "stat-tooltip-label";
  label_el.textContent = `${label} |`;
  const value_el = document.createElement("span");
  value_el.className = `stat-tooltip-value ${tooltip_value_state(current, base)}`;
  value_el.textContent = `${current} |`;
  const stage_el = document.createElement("span");
  stage_el.className = "stat-tooltip-stage";
  stage_el.textContent = `${format_tooltip_stage(stage)} |`;
  const percent_el = document.createElement("span");
  percent_el.className = `stat-tooltip-percent ${percent_value_state(total_percent)}`;
  percent_el.textContent = format_tooltip_percent(total_percent);
  row.appendChild(label_el);
  row.appendChild(value_el);
  row.appendChild(stage_el);
  row.appendChild(percent_el);
  return row;
}
function format_tooltip_stage(stage) {
  const normalized = clamp_stage(stage);
  return `stg ${normalized >= 0 ? `+${normalized}` : `${normalized}`}`;
}
function format_tooltip_percent(percent) {
  const delta = percent - 100;
  return `${delta >= 0 ? "+" : ""}${delta}%`;
}
function render_monster_tooltip(payload) {
  if (!stat_tooltip)
    return;
  stat_tooltip.innerHTML = "";
  const title = document.createElement("div");
  title.className = "stat-tooltip-title";
  title.textContent = payload.name;
  stat_tooltip.appendChild(title);
  const type_line = document.createElement("div");
  type_line.className = "stat-tooltip-passive";
  type_line.textContent = `Type: ${payload.type.toUpperCase()}`;
  stat_tooltip.appendChild(type_line);
  const stats_grid2 = document.createElement("div");
  stats_grid2.className = "stat-tooltip-grid";
  stats_grid2.appendChild(tooltip_stat_row("ATK", payload.current.attack, payload.base.attack, payload.stages.attack, payload.totalPercent.attack));
  stats_grid2.appendChild(tooltip_stat_row("DEF", payload.current.defense, payload.base.defense, payload.stages.defense, payload.totalPercent.defense));
  stats_grid2.appendChild(tooltip_stat_row("DEX", payload.current.speed, payload.base.speed, payload.stages.speed, payload.totalPercent.speed));
  stat_tooltip.appendChild(stats_grid2);
  const moves_box = document.createElement("div");
  moves_box.className = "stat-tooltip-moves";
  const moves = payload.moves.slice(0, LOBBY_MOVE_SLOTS);
  while (moves.length < LOBBY_MOVE_SLOTS) {
    moves.push("none");
  }
  moves.forEach((move, index) => {
    const row = document.createElement("div");
    row.textContent = `${index + 1}. ${move_label(move)}`;
    moves_box.appendChild(row);
  });
  stat_tooltip.appendChild(moves_box);
}
function position_tooltip(client_x, client_y) {
  if (!stat_tooltip)
    return;
  const offset = 14;
  const margin = 10;
  const rect = stat_tooltip.getBoundingClientRect();
  let left = client_x + offset;
  let top = client_y + offset;
  if (left + rect.width > window.innerWidth - margin) {
    left = client_x - rect.width - offset;
  }
  if (top + rect.height > window.innerHeight - margin) {
    top = client_y - rect.height - offset;
  }
  left = Math.max(margin, left);
  top = Math.max(margin, top);
  stat_tooltip.style.left = `${left}px`;
  stat_tooltip.style.top = `${top}px`;
}
function tooltip_target_from_event(target) {
  if (!(target instanceof HTMLElement))
    return null;
  const found = target.closest("[data-monster-tooltip='1']");
  return found instanceof HTMLElement ? found : null;
}
function open_tooltip(target, client_x, client_y) {
  if (!stat_tooltip)
    return;
  const payload = tooltip_payload_by_element.get(target);
  if (!payload)
    return;
  active_tooltip_target = target;
  render_monster_tooltip(payload);
  stat_tooltip.classList.add("is-open");
  stat_tooltip.setAttribute("aria-hidden", "false");
  position_tooltip(client_x, client_y);
}
function close_tooltip() {
  active_tooltip_target = null;
  if (!stat_tooltip)
    return;
  stat_tooltip.classList.remove("is-open");
  stat_tooltip.setAttribute("aria-hidden", "true");
}
function move_description(move_id) {
  return MOVE_TOOLTIP_DESCRIPTIONS[move_id] ?? "Sem descricao disponivel.";
}
function clear_move_tooltip_delay() {
  if (move_tooltip_delay_timer === null) {
    return;
  }
  window.clearTimeout(move_tooltip_delay_timer);
  move_tooltip_delay_timer = null;
}
function position_move_tooltip(client_x, client_y) {
  if (!move_tooltip)
    return;
  const offset = 14;
  const margin = 10;
  const rect = move_tooltip.getBoundingClientRect();
  let left = client_x + offset;
  let top = client_y + offset;
  if (left + rect.width > window.innerWidth - margin) {
    left = client_x - rect.width - offset;
  }
  if (top + rect.height > window.innerHeight - margin) {
    top = client_y - rect.height - offset;
  }
  left = Math.max(margin, left);
  top = Math.max(margin, top);
  move_tooltip.style.left = `${left}px`;
  move_tooltip.style.top = `${top}px`;
}
function open_move_tooltip(target) {
  if (!move_tooltip)
    return;
  const move_id = target.dataset.moveId;
  if (!move_id)
    return;
  const label = target.dataset.moveLabel || MOVE_LABELS[move_id] || move_id;
  move_tooltip.innerHTML = "";
  const title = document.createElement("div");
  title.className = "move-tooltip-title";
  title.textContent = label;
  const desc = document.createElement("div");
  desc.className = "move-tooltip-desc";
  desc.textContent = move_description(move_id);
  move_tooltip.append(title, desc);
  move_tooltip_target = target;
  move_tooltip.classList.add("is-open");
  move_tooltip.setAttribute("aria-hidden", "false");
  position_move_tooltip(move_tooltip_mouse_x, move_tooltip_mouse_y);
}
function close_move_tooltip() {
  clear_move_tooltip_delay();
  move_tooltip_pending_target = null;
  move_tooltip_target = null;
  if (!move_tooltip)
    return;
  move_tooltip.classList.remove("is-open");
  move_tooltip.setAttribute("aria-hidden", "true");
}
function schedule_move_tooltip(target, event) {
  if (!match_started) {
    return;
  }
  const move_id = target.dataset.moveId;
  if (!move_id) {
    return;
  }
  move_tooltip_mouse_x = event.clientX;
  move_tooltip_mouse_y = event.clientY;
  move_tooltip_pending_target = target;
  clear_move_tooltip_delay();
  move_tooltip_delay_timer = window.setTimeout(() => {
    move_tooltip_delay_timer = null;
    if (move_tooltip_pending_target !== target) {
      return;
    }
    open_move_tooltip(target);
  }, MOVE_TOOLTIP_DELAY_MS);
}
function handle_move_button_hover_position(target, event) {
  move_tooltip_mouse_x = event.clientX;
  move_tooltip_mouse_y = event.clientY;
  if (move_tooltip_target === target) {
    position_move_tooltip(event.clientX, event.clientY);
  }
}
function bind_move_button_tooltip(target) {
  target.addEventListener("mouseenter", (event) => {
    schedule_move_tooltip(target, event);
  });
  target.addEventListener("mousemove", (event) => {
    handle_move_button_hover_position(target, event);
  });
  target.addEventListener("mouseleave", () => {
    if (move_tooltip_pending_target === target) {
      move_tooltip_pending_target = null;
      clear_move_tooltip_delay();
    }
    if (move_tooltip_target === target) {
      close_move_tooltip();
    }
  });
  target.addEventListener("mousedown", () => {
    if (move_tooltip_target === target || move_tooltip_pending_target === target) {
      close_move_tooltip();
    }
  });
}
function append_log(line) {
  append_line(log_list, compact_slot_labels(line));
}
function append_chat(line, class_name) {
  append_line(chat_messages, line, class_name);
}
function append_chat_user(name, message) {
  append_line(chat_messages, `${name}: ${message}`, "log-user");
}
function append_turn_marker(turn) {
  append_line(log_list, `turno ${turn}`, "log-turn");
}
function append_match_start_marker(game_number) {
  append_line(log_list, `JOGO ${game_number}`, "log-match");
}
function append_match_end_marker() {
  append_line(log_list, "FIM DE JOGO", "log-match");
}
function compact_slot_labels(text) {
  return text.replace(/\bplayer1\b/g, "P1").replace(/\bplayer2\b/g, "P2");
}
function try_post(data) {
  try {
    post(room, data);
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    append_log(`send failed: ${reason}`);
    return false;
  }
}
function send_chat_message(message) {
  const trimmed = message.trim();
  if (!trimmed)
    return;
  try_post({ $: "chat", message: trimmed.slice(0, 200), from: player_name, player_id });
}
function setup_chat_input(input, button) {
  if (!input || !button)
    return;
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
function append_line(container, line, class_name) {
  if (!container)
    return;
  const p = document.createElement("p");
  if (class_name) {
    p.classList.add(class_name);
  }
  p.textContent = line;
  container.appendChild(p);
  container.scrollTop = container.scrollHeight;
}
function render_participants() {
  ensure_local_participant_visible();
  participants_list.innerHTML = "";
  const state = ensure_participants_state();
  const create_participant_item = (name, meta) => {
    const item = document.createElement("div");
    item.className = "participant";
    const name_span = document.createElement("span");
    name_span.textContent = name;
    const meta_span = document.createElement("span");
    meta_span.className = "participant-meta";
    meta_span.textContent = meta;
    item.append(name_span, meta_span);
    return item;
  };
  for (const slot_id of PLAYER_SLOTS2) {
    const name = state.players[slot_id];
    if (!name)
      continue;
    const meta = slot_id === "player1" ? "P1" : "P2";
    participants_list.appendChild(create_participant_item(name, meta));
  }
  const spectators = state.spectators.slice().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  for (const name of spectators) {
    participants_list.appendChild(create_participant_item(name, "spec"));
  }
}
function update_deadline() {
  if (deadline_at <= 0) {
    status_deadline.textContent = "--:--";
    return;
  }
  const remaining = Math.max(0, deadline_at - Date.now());
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor(remaining % 60000 / 1000);
  status_deadline.textContent = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}
function show_warning(message) {
  config_warning.textContent = message;
}
function clear_warning() {
  config_warning.textContent = "";
}
var profile = load_profile(profile_key, MONSTER_BY_ID);
var LOBBY_DEFAULT_MOVES_RESTORE_MIGRATION_V1 = "vibi_showdown_migration_restore_defaults_v1";
function restore_starter_default_moves_once() {
  const migration_key = `${LOBBY_DEFAULT_MOVES_RESTORE_MIGRATION_V1}:${profile_key}`;
  try {
    if (localStorage.getItem(migration_key) === "1") {
      return;
    }
  } catch {}
  let changed = false;
  for (const monster_id of STARTER_MONSTER_IDS) {
    const spec = MONSTER_BY_ID.get(monster_id);
    if (!spec) {
      continue;
    }
    const config = profile.monsters[monster_id];
    if (!config || !Array.isArray(config.moves)) {
      continue;
    }
    const moves = config.moves.slice(0, LOBBY_MOVE_SLOTS);
    while (moves.length < LOBBY_MOVE_SLOTS) {
      moves.push("none");
    }
    const all_none = moves.every((move_id) => move_id === "none");
    if (!all_none) {
      continue;
    }
    config.moves = default_lobby_moves_for_spec(spec, LOBBY_MOVE_SLOTS);
    changed = true;
  }
  if (changed) {
    save_profile(profile_key, profile);
  }
  try {
    localStorage.setItem(migration_key, "1");
  } catch {}
}
restore_starter_default_moves_once();
function save_profile2() {
  save_profile(profile_key, profile);
}
function load_team_selection2() {
  const loaded = load_team_selection(team_key, MONSTER_BY_ID, is_lobby_enabled_monster, 3);
  selected.splice(0, selected.length, ...loaded);
}
function save_team_selection2() {
  save_team_selection(team_key, selected);
}
function get_config2(monster_id) {
  return get_config({
    monster_id,
    roster_by_id: MONSTER_BY_ID,
    profile,
    profile_key,
    lobby_move_slots: LOBBY_MOVE_SLOTS
  });
}
function reset_profile_stats_to_defaults2() {
  const changed = reset_profile_stats_to_defaults({
    profile,
    profile_key,
    roster: MONSTER_ROSTER,
    lobby_move_slots: LOBBY_MOVE_SLOTS
  });
  clear_warning();
  if (changed) {
    append_log("status reset to default values");
  }
  render_roster();
  render_tabs();
  render_config();
  update_roster_count();
  update_slots();
  update_action_controls();
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
    set_monster_tooltip(card, null);
    img.classList.add("hidden");
    img.removeAttribute("src");
    img.alt = "";
    name_el.textContent = "empty";
    return;
  }
  card.classList.remove("empty");
  card.classList.toggle("active", id === active_tab);
  const tooltip = tooltip_from_config(id);
  set_monster_tooltip(card, tooltip);
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
function refresh_roster_tooltips() {
  const list = document.getElementById("roster-list");
  if (!list) {
    return;
  }
  const cards = list.querySelectorAll(".roster-card[data-monster-id]");
  for (const card of cards) {
    const monster_id = card.dataset.monsterId;
    if (!monster_id || !MONSTER_BY_ID.has(monster_id)) {
      set_monster_tooltip(card, null);
      continue;
    }
    set_monster_tooltip(card, tooltip_from_config(monster_id));
  }
}
function refresh_lobby_tooltips() {
  update_slots();
  refresh_roster_tooltips();
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
  render_lobby_config({
    active_tab,
    moves_grid,
    stats_grid,
    roster_by_id: MONSTER_BY_ID,
    get_config: get_config2,
    base_stats_from_spec,
    stats_from_base_level_ev,
    save_profile: save_profile2,
    clear_warning,
    show_warning,
    is_ready,
    match_started,
    lobby_move_slots: LOBBY_MOVE_SLOTS,
    move_labels: MOVE_LABELS,
    priority_move_ids: STARTER_DEFAULT_PRIORITY_MOVE_IDS,
    level_min: LEVEL_MIN,
    level_max: LEVEL_MAX,
    ev_per_stat_max: EV_PER_STAT_MAX,
    ev_total_max: EV_TOTAL_MAX,
    ev_total,
    calc_non_hp_stat,
    validate_ev_spread,
    refresh_lobby_tooltips,
    update_action_controls,
    rerender: render_config
  });
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
  if (!is_lobby_enabled_monster(id)) {
    show_warning("Monster desativado nesta fase.");
    return;
  }
  const index = selected.indexOf(id);
  if (index >= 0) {
    selected.splice(index, 1);
    if (active_tab === id) {
      active_tab = selected[0] || null;
    }
    save_team_selection2();
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
  save_team_selection2();
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
  for (const entry of MONSTER_ROSTER.filter((mon) => is_lobby_enabled_monster(mon.id))) {
    const card = document.createElement("div");
    const is_selected = selected.includes(entry.id);
    const is_disabled = !is_selected && selected.length >= 3 || is_ready && !match_started;
    const tooltip = tooltip_from_config(entry.id);
    card.className = `roster-card${is_selected ? " active" : ""}${is_disabled ? " disabled" : ""}`;
    card.dataset.monsterId = entry.id;
    set_monster_tooltip(card, tooltip);
    card.innerHTML = `
      <div class="sprite" style="width:24px;height:24px;">
        <img src="${icon_path(entry.id)}" alt="${entry.name}" />
      </div>
      <div>
        <h4>${entry.name}</h4>
        <p>${monster_type_description(entry.type)}</p>
      </div>
    `;
    card.addEventListener("click", () => {
      if (is_disabled)
        return;
      toggle_selection(entry.id);
    });
    list.appendChild(card);
  }
}
function set_bench_slot(slot2, mon, index, enabled, blocked_switch = false, tooltip = null) {
  if (!mon || index === null || index < 0) {
    slot2.btn.classList.add("empty");
    slot2.btn.classList.remove("blocked-switch");
    slot2.btn.disabled = true;
    slot2.btn.removeAttribute("data-index");
    set_monster_tooltip(slot2.btn, null);
    slot2.img.removeAttribute("src");
    slot2.img.alt = "";
    slot2.img.style.display = "none";
    return;
  }
  slot2.btn.classList.remove("empty");
  slot2.btn.classList.toggle("blocked-switch", blocked_switch);
  slot2.btn.dataset.index = `${index}`;
  set_monster_tooltip(slot2.btn, tooltip);
  slot2.btn.disabled = !enabled;
  slot2.img.src = icon_path(mon.id);
  slot2.img.alt = monster_label(mon.id);
  slot2.img.style.display = "";
}
function arena_trap_remaining_turns(state, target_slot) {
  const until_turn = state.arenaTrapUntilTurn?.[target_slot] ?? 0;
  if (until_turn <= 0 || until_turn < state.turn) {
    return 0;
  }
  return until_turn - state.turn + 1;
}
function is_slot_arena_trapped_for_ui(state, target_slot) {
  if (state.pendingSwitch?.[target_slot]) {
    return false;
  }
  const until_turn = state.arenaTrapUntilTurn?.[target_slot] ?? 0;
  return until_turn > 0 && until_turn >= state.turn;
}
function switch_block_reason_for_ui(state, target_slot) {
  if (is_slot_arena_trapped_for_ui(state, target_slot)) {
    return "arena trapped";
  }
  if ((state.tauntUntilTurn?.[target_slot] ?? 0) >= state.turn || has_active_effect(state, target_slot, "taunt")) {
    return "taunt";
  }
  if (has_active_effect(state, target_slot, "confuse")) {
    return "confuse";
  }
  if (has_active_effect(state, target_slot, "immobilize")) {
    return "immobilize";
  }
  return null;
}
function has_available_switch_target_for_ui(state, target_slot) {
  const player = state.players[target_slot];
  return player.team.some((mon, index) => index !== player.activeIndex && mon.hp > 0);
}
function run_block_reason_for_ui(state, target_slot) {
  if (has_available_switch_target_for_ui(state, target_slot) && has_active_effect(state, target_slot, "nocaute")) {
    return "nocaute";
  }
  if (has_active_effect(state, target_slot, "sleep")) {
    return "sleep";
  }
  if (has_active_effect(state, target_slot, "silence")) {
    return "silence";
  }
  if ((state.tauntUntilTurn?.[target_slot] ?? 0) >= state.turn || has_active_effect(state, target_slot, "taunt")) {
    return "taunt";
  }
  return null;
}
function run_block_label_for_ui(reason) {
  if (reason === "nocaute")
    return "nocaute";
  if (reason === "sleep")
    return "sleep";
  if (reason === "silence")
    return "silence";
  return "taunt";
}
function update_bench(state, viewer_slot) {
  const me = state.players[viewer_slot];
  const enemy_slot = viewer_slot === "player1" ? "player2" : "player1";
  const opp = state.players[enemy_slot];
  const my_bench = me.team.map((_, idx) => idx).filter((idx) => idx !== me.activeIndex);
  const opp_bench = opp.team.map((_, idx) => idx).filter((idx) => idx !== opp.activeIndex);
  const my_switch_blocked_reason = switch_block_reason_for_ui(state, viewer_slot);
  const my_switch_blocked = my_switch_blocked_reason !== null;
  const can_switch = !!slot && slot === viewer_slot && match_started && !is_spectator && (!!has_pending_switch() || current_turn > 0) && !my_switch_blocked;
  player_bench_slots.forEach((slot_el, i) => {
    const idx = my_bench[i] ?? null;
    const mon = idx !== null ? me.team[idx] : null;
    const tooltip = mon && idx !== null ? tooltip_from_state(state, viewer_slot, mon, { previewSwitchIn: true }) : null;
    set_bench_slot(slot_el, mon, idx, can_switch, my_switch_blocked, tooltip);
  });
  enemy_bench_slots.forEach((slot_el, i) => {
    const idx = opp_bench[i] ?? null;
    const mon = idx !== null ? opp.team[idx] : null;
    const tooltip = mon && idx !== null ? tooltip_from_state(state, enemy_slot, mon, { previewSwitchIn: true }) : null;
    set_bench_slot(slot_el, mon, idx, false, false, tooltip);
  });
}
function update_action_controls() {
  const has_team = selected.length === 3;
  const pending_switch = has_pending_switch();
  const controls_disabled = !match_started || !slot || is_spectator || current_turn <= 0 || pending_switch;
  if (!has_team) {
    move_buttons.forEach((btn, index) => {
      btn.textContent = `Move ${index + 1}`;
      btn.disabled = true;
      btn.classList.remove("selected-intent");
      delete btn.dataset.moveId;
      delete btn.dataset.moveLabel;
    });
    if (run_btn) {
      run_btn.textContent = "4. Run(+10% M.SPE)";
      run_btn.disabled = true;
      run_btn.classList.remove("selected-intent");
      delete run_btn.dataset.moveId;
      delete run_btn.dataset.moveLabel;
    }
    close_move_tooltip();
    return;
  }
  const active_id = selected[0];
  const config = get_config2(active_id);
  let guard_on_cooldown = false;
  let active_moves = config.moves;
  let self_switch_has_target = true;
  const run_blocked_reason = latest_state && slot ? run_block_reason_for_ui(latest_state, slot) : null;
  if (latest_state && slot) {
    const player_state = latest_state.players[slot];
    const fallback_active = player_state.team[player_state.activeIndex];
    const preview_active_index = pending_switch && has_forced_switch_target_for_current_turn() && typeof forced_switch_target_index === "number" ? forced_switch_target_index : player_state.activeIndex;
    const preview_active = pending_switch && has_forced_switch_target_for_current_turn() && typeof forced_switch_target_index === "number" ? player_state.team[forced_switch_target_index] ?? fallback_active : fallback_active;
    guard_on_cooldown = Math.max(preview_active.protectCooldownTurns, preview_active.endureCooldownTurns) > 0;
    active_moves = preview_active.chosenMoves;
    self_switch_has_target = player_state.team.some((mon, index) => index !== preview_active_index && mon.hp > 0);
  }
  move_buttons.forEach((btn, index) => {
    const move = active_moves[index] ?? "none";
    const label = MOVE_LABELS[move] || move;
    btn.dataset.moveId = move;
    btn.dataset.moveLabel = label;
    if (move === "protect" && guard_on_cooldown) {
      btn.textContent = `${index + 1}. Protect (cooldown)`;
      btn.disabled = true;
    } else if (move === "endure" && guard_on_cooldown) {
      btn.textContent = `${index + 1}. Endure (cooldown)`;
      btn.disabled = true;
    } else if (move === "switch_sovietico" && !self_switch_has_target) {
      btn.textContent = `${index + 1}. ${label} (no switch target)`;
      btn.disabled = true;
    } else {
      btn.textContent = `${index + 1}. ${label}`;
      btn.disabled = controls_disabled;
    }
    const is_selected_move = selected_intent_turn === current_turn && selected_intent?.action === "use_move" && selected_intent.moveIndex === index;
    btn.classList.toggle("selected-intent", is_selected_move && !btn.disabled);
  });
  if (run_btn) {
    const run_disabled = controls_disabled || !!run_blocked_reason;
    run_btn.dataset.moveId = "run";
    run_btn.dataset.moveLabel = "Run";
    if (run_blocked_reason) {
      run_btn.textContent = `4. Run(+10% M.SPE) (${run_block_label_for_ui(run_blocked_reason)})`;
    } else {
      run_btn.textContent = "4. Run(+10% M.SPE)";
    }
    run_btn.disabled = run_disabled;
    const is_selected_run = selected_intent_turn === current_turn && selected_intent?.action === "run";
    run_btn.classList.toggle("selected-intent", is_selected_run && !run_btn.disabled);
  }
  const show_surrender = match_started && !!slot && !is_spectator;
  surrender_btn.classList.toggle("hidden", !show_surrender);
  surrender_btn.disabled = !show_surrender;
  if (latest_state) {
    const viewer_slot = current_viewer_slot();
    if (viewer_slot) {
      update_bench(latest_state, viewer_slot);
    }
  }
}
function has_pending_switch() {
  return !!(latest_state && slot && latest_state.pendingSwitch?.[slot]);
}
function clear_forced_switch_target() {
  forced_switch_target_index = null;
  forced_switch_target_turn = 0;
}
function has_forced_switch_target_for_current_turn() {
  return has_pending_switch() && typeof forced_switch_target_index === "number" && forced_switch_target_turn === current_turn;
}
function has_pending_forced_choice_for_current_turn() {
  return has_pending_switch() && !has_forced_switch_target_for_current_turn();
}
function is_switch_modal_lock_active() {
  return switch_modal_mode === "forced" && has_pending_forced_choice_for_current_turn();
}
function current_active_monster_for_intent() {
  if (!latest_state || !slot) {
    return null;
  }
  const player_state = latest_state.players[slot];
  const fallback_active = player_state.team[player_state.activeIndex] ?? null;
  if (!fallback_active) {
    return null;
  }
  if (has_pending_switch() && has_forced_switch_target_for_current_turn() && typeof forced_switch_target_index === "number") {
    return player_state.team[forced_switch_target_index] ?? fallback_active;
  }
  return fallback_active;
}
function active_move_id_for_index(move_index) {
  const active = current_active_monster_for_intent();
  if (!active) {
    return null;
  }
  return active.chosenMoves[move_index] ?? null;
}
function post_turn_intent(intent) {
  if (!can_send_intent()) {
    return false;
  }
  const post_data = {
    $: "intent",
    turn: current_turn,
    intent,
    player_id
  };
  if (has_pending_switch()) {
    if (!has_forced_switch_target_for_current_turn()) {
      append_log("choose replacement first");
      return false;
    }
    post_data.forcedSwitchTargetIndex = forced_switch_target_index;
  }
  return try_post(post_data);
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
  return true;
}
function send_run_intent() {
  if (!post_turn_intent({ action: "run" })) {
    return;
  }
  const was_selected = selected_intent_turn === current_turn && selected_intent !== null;
  selected_intent = { action: "run" };
  selected_intent_turn = current_turn;
  update_action_controls();
  append_log(was_selected ? "intent updated (Run)" : "intent sent (Run)");
}
function send_move_intent(moveIndex) {
  const move_id = active_move_id_for_index(moveIndex);
  if (move_id === "run") {
    send_run_intent();
    return;
  }
  if (!post_turn_intent({ action: "use_move", moveIndex })) {
    return;
  }
  const was_selected = selected_intent_turn === current_turn && selected_intent !== null;
  selected_intent = { action: "use_move", moveIndex };
  selected_intent_turn = current_turn;
  update_action_controls();
  if (move_id === "switch_sovietico") {
    append_log(was_selected ? "intent updated (Switch Sovietico armed)" : "intent sent (Switch Sovietico armed)");
    return;
  }
  append_log(was_selected ? "intent updated" : "intent sent");
}
function send_switch_intent(targetIndex) {
  if (has_pending_switch()) {
    forced_switch_target_index = targetIndex;
    forced_switch_target_turn = current_turn;
    if (relay_runtime.is_server_managed() && !try_post({ $: "forced_switch", targetIndex, player_id })) {
      clear_forced_switch_target();
      return;
    }
    let lock_intent_sent = false;
    if (latest_state && slot) {
      const forced_preview = apply_forced_switch(latest_state, slot, targetIndex);
      if (!forced_preview.error) {
        const lock_intent = relay_runtime.default_intent(forced_preview.state, slot);
        if (post_turn_intent(lock_intent)) {
          selected_intent = lock_intent;
          selected_intent_turn = current_turn;
          lock_intent_sent = true;
        }
      }
    }
    close_switch_modal();
    append_log(lock_intent_sent ? "replacement selected; action locked (no move this turn)" : "replacement selected (no move this turn)");
    update_action_controls();
    return;
  }
  if (!post_turn_intent({ action: "switch", targetIndex })) {
    return;
  }
  const was_selected = selected_intent_turn === current_turn && selected_intent !== null;
  selected_intent = { action: "switch", targetIndex };
  selected_intent_turn = current_turn;
  update_action_controls();
  append_log(was_selected ? "intent updated" : "intent sent");
}
function send_surrender() {
  if (!match_started || is_spectator || !slot)
    return;
  try_post({ $: "surrender", player_id });
}
function close_switch_modal(force = false) {
  if (!force && is_switch_modal_lock_active()) {
    return;
  }
  switch_modal_mode = "intent";
  switch_close.disabled = false;
  if (switch_title) {
    switch_title.textContent = "Switch Pokemon";
  }
  switch_modal.classList.remove("open");
}
function open_switch_modal(mode = "intent") {
  if (!latest_state || !slot)
    return;
  if (mode === "intent" && !can_send_intent())
    return;
  close_move_tooltip();
  switch_modal_mode = mode;
  if (switch_title) {
    if (mode === "forced") {
      switch_title.textContent = "Forced Switch";
    } else {
      switch_title.textContent = "Switch Pokemon";
    }
  }
  const lock_modal = mode === "forced" && has_pending_forced_choice_for_current_turn();
  switch_close.disabled = lock_modal;
  switch_options.classList.add("switch-options-sovietico");
  switch_options.innerHTML = "";
  const player = latest_state.players[slot];
  const active_index = player.activeIndex;
  const options = player.team.map((mon, index) => ({ mon, index })).filter((entry) => entry.index !== active_index && entry.mon.hp > 0);
  if (options.length === 0) {
    const msg = document.createElement("div");
    msg.textContent = "No available swaps";
    msg.style.fontSize = "11px";
    msg.style.color = "#9aa5b1";
    switch_options.appendChild(msg);
  } else {
    for (const entry of options) {
      const button = document.createElement("button");
      button.type = "button";
      button.classList.add("switch-sovietico-option");
      button.disabled = false;
      const icon = document.createElement("img");
      icon.src = icon_path(entry.mon.id);
      icon.alt = monster_label(entry.mon.id);
      const label = document.createElement("span");
      label.textContent = monster_label(entry.mon.id);
      button.append(icon, label);
      button.addEventListener("click", () => {
        send_switch_intent(entry.index);
      });
      switch_options.appendChild(button);
    }
  }
  switch_modal.classList.add("open");
}
function build_team_selection2() {
  const result = build_team_selection({
    selected,
    roster_by_id: MONSTER_BY_ID,
    lobby_move_slots: LOBBY_MOVE_SLOTS,
    is_lobby_enabled_monster,
    monster_label,
    get_config: get_config2
  });
  if (!result.team) {
    if (result.warning) {
      show_warning(result.warning);
    }
    return null;
  }
  clear_warning();
  save_profile2();
  return result.team;
}
function send_ready(next_ready) {
  if (next_ready && match_started) {
    return;
  }
  if (next_ready) {
    const team = build_team_selection2();
    if (!team) {
      return;
    }
    try_post({ $: "ready", ready: true, team, player_id });
  } else {
    if (!slot) {
      return;
    }
    try_post({ $: "ready", ready: false, player_id });
  }
}
function update_ready_ui(should_refresh_lobby = true) {
  if (status_ready) {
    status_ready.textContent = is_ready ? "ready" : "not ready";
    status_ready.className = `status-pill ${is_ready ? "ok" : "off"}`;
  }
  ready_btn.textContent = is_ready ? "Unready" : "Ready";
  ready_btn.disabled = match_started;
  if (reset_status_btn) {
    reset_status_btn.disabled = match_started || is_ready;
  }
  update_turn_duration_input();
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
  if (!should_refresh_lobby) {
    return;
  }
  render_roster();
  render_tabs();
  render_config();
}
function update_opponent_ui(opponent_ready2, opponent_name2) {
  if (!status_opponent)
    return;
  status_opponent.textContent = opponent_ready2 ? "ready" : opponent_name2 ? "waiting" : "offline";
  status_opponent.className = `status-pill ${opponent_ready2 ? "ok" : opponent_name2 ? "warn" : "off"}`;
}
function show_match_end(state) {
  if (!match_end)
    return;
  const winner = state.winner;
  const end_reason = state.endReason;
  const slot_label = (slot_id) => slot_id === "player1" ? "P1" : "P2";
  if (end_reason === "mSPE_escape") {
    const evaded = Array.isArray(state.mSPESlots) ? state.mSPESlots.filter((slot_id) => slot_id === "player1" || slot_id === "player2") : [];
    if (evaded.length >= 2) {
      match_end_title.textContent = "Double Escape";
      match_end_sub.textContent = "Both players escaped technically.";
    } else if (evaded.length === 1) {
      const escaped = evaded[0];
      match_end_title.textContent = slot && slot === escaped ? "Escape" : "Match ended";
      match_end_sub.textContent = `${slot_label(escaped)} escaped technically.`;
    } else {
      match_end_title.textContent = "Match ended";
      match_end_sub.textContent = "Technical escape.";
    }
    match_end.classList.add("open");
    return;
  }
  const is_winner = winner && slot === winner;
  match_end_title.textContent = is_winner ? "Victory" : "Defeat";
  if (!winner) {
    match_end_title.textContent = "Match ended";
  }
  if (winner) {
    match_end_sub.textContent = `${winner} wins the match.`;
  } else if (end_reason === "turn_limit") {
    match_end_sub.textContent = "Match finished by turn limit.";
  } else {
    match_end_sub.textContent = "Match finished.";
  }
  match_end.classList.add("open");
}
function reset_to_lobby_view() {
  match_started = false;
  latest_state = null;
  current_turn = 0;
  deadline_at = 0;
  selected_intent = null;
  selected_intent_turn = 0;
  clear_forced_switch_target();
  close_switch_modal(true);
  close_move_tooltip();
  match_end.classList.remove("open");
  prematch.style.display = "";
  document.body.classList.add("prematch-open");
  status_turn.textContent = "0";
  update_rps_status(null);
  update_deadline();
  update_ready_ui();
  update_action_controls();
}
function handle_turn_start(data) {
  current_turn = data.turn;
  deadline_at = data.deadline_at;
  selected_intent = null;
  selected_intent_turn = 0;
  clear_forced_switch_target();
  close_move_tooltip();
  status_turn.textContent = `${current_turn}`;
  update_deadline();
  if (current_turn === 1) {
    room_game_count += 1;
    append_match_start_marker(room_game_count);
  }
  append_turn_marker(current_turn);
  if (!has_pending_switch()) {
    close_switch_modal();
  }
  if (!match_started) {
    match_started = true;
    prematch.style.display = "none";
    document.body.classList.remove("prematch-open");
  }
  update_action_controls();
  if (slot && has_pending_switch() && !switch_modal.classList.contains("open")) {
    open_switch_modal("forced");
  }
}
function log_events(log) {
  for (const entry of log) {
    if (entry.type === "clear_body_blocked") {
      append_chat(entry.summary, "log-clear-body");
      continue;
    }
    if (entry.type === "passive_trigger") {
      const data = entry.data;
      if (data?.passive === "type_def_armor_stack") {
        append_chat(entry.summary, "log-clear-body");
        continue;
      }
    }
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
    if (entry.type === "stat_mod") {
      append_log(stat_mod_feedback(entry) ?? entry.summary);
      continue;
    }
    append_log(entry.summary);
  }
}
function effect_chip(label, kind) {
  const chip = document.createElement("span");
  chip.className = `effect-chip ${kind}`;
  const dot = document.createElement("span");
  dot.className = "effect-dot";
  chip.appendChild(dot);
  chip.append(label);
  return chip;
}
var EFFECT_UI_LABELS = {
  confuse: "Confuse",
  sleep: "Sleep",
  stun: "Stun",
  happiness: "Happiness",
  taunt: "Taunt",
  frustration: "Frustration",
  nocaute: "Nocaute",
  immobilize: "Immobilize",
  weakness: "Weakness",
  deterioration: "Deterioration",
  paralyse: "Paralyse",
  silence: "Silence"
};
var CURSE_UI_LABELS = {
  madness: "Madness",
  leech_seed: "Leech Seed",
  destiny_bond: "Destiny Bond",
  endure: "Endure"
};
function stat_short_label(stat) {
  if (stat === "attack")
    return "ATK";
  if (stat === "defense")
    return "DEF";
  return "DEX";
}
function format_delta_percent(delta) {
  return `${delta >= 0 ? "+" : ""}${delta}%`;
}
function effect_kind_for_stat_aggregate(entry) {
  if (entry.totalStageDelta !== 0) {
    return entry.totalStageDelta > 0 ? "buff" : "debuff";
  }
  if (entry.totalDeltaPercent !== 0) {
    return entry.totalDeltaPercent > 0 ? "buff" : "debuff";
  }
  return "buff";
}
function active_curses_for_slot(state, slot_id) {
  const input = state.activeCursesBySlot?.[slot_id];
  if (!Array.isArray(input)) {
    return [];
  }
  return input.map((row) => ({
    id: typeof row.id === "string" ? row.id : "unknown",
    sourceSlot: row.sourceSlot === "player1" || row.sourceSlot === "player2" ? row.sourceSlot : null,
    stacks: typeof row.stacks === "number" && Number.isFinite(row.stacks) ? Math.max(1, Math.floor(row.stacks)) : 1,
    appliedTurn: typeof row.appliedTurn === "number" && Number.isFinite(row.appliedTurn) ? Math.floor(row.appliedTurn) : undefined
  }));
}
function active_effects_for_slot(state, slot_id) {
  const input = state.activeEffectsBySlot?.[slot_id];
  if (!Array.isArray(input)) {
    return [];
  }
  const normalized = [];
  for (const row of input) {
    const id = typeof row?.id === "string" && row.id.trim().length > 0 ? row.id : "unknown";
    const remaining_turns = typeof row?.remainingTurns === "number" && Number.isFinite(row.remainingTurns) ? Math.max(1, Math.floor(row.remainingTurns)) : 1;
    normalized.push({ id, remainingTurns: remaining_turns });
  }
  return normalized;
}
function tag_category_order(category) {
  if (category === "control")
    return 100;
  if (category === "stat")
    return 200;
  if (category === "sustain")
    return 300;
  if (category === "curse")
    return 400;
  return 500;
}
function dedupe_and_sort_tag_chips(chips) {
  const unique = new Map;
  for (const chip of chips) {
    const key = `${chip.id}|${chip.label}|${chip.kind}|${chip.category}|${chip.order}`;
    if (!unique.has(key)) {
      unique.set(key, chip);
    }
  }
  const sorted = Array.from(unique.values());
  sorted.sort((left, right) => {
    const category_diff = tag_category_order(left.category) - tag_category_order(right.category);
    if (category_diff !== 0) {
      return category_diff;
    }
    if (left.order !== right.order) {
      return left.order - right.order;
    }
    return left.label.localeCompare(right.label);
  });
  return sorted;
}
function stat_chip_label(entry) {
  const parts = [stat_short_label(entry.stat)];
  if (entry.totalStageDelta !== 0) {
    parts.push(`stg ${entry.totalStageDelta >= 0 ? "+" : ""}${entry.totalStageDelta}`);
  }
  if (entry.totalDeltaPercent !== 0) {
    parts.push(format_delta_percent(entry.totalDeltaPercent));
  }
  return parts.join(" | ");
}
function build_state_relation_chips(ctx) {
  const chips = [];
  const seeded = ctx.myCurses.some((curse) => curse.id === "leech_seed");
  const draining_enemy = ctx.enemyCurses.some((curse) => curse.id === "leech_seed" && curse.sourceSlot === ctx.slotId);
  if (seeded) {
    chips.push({
      id: "state_seeded",
      label: "Seeded",
      kind: "seeded",
      category: "curse",
      order: 400
    });
  }
  if (draining_enemy) {
    chips.push({
      id: "state_drain",
      label: "Leech+",
      kind: "drain",
      category: "sustain",
      order: 320
    });
  }
  return chips;
}
function build_passive_stat_chips(ctx) {
  const chips = [];
  const armor_stacks = Math.max(0, ctx.state.typePassiveArmorStacks?.[ctx.slotId] ?? 0);
  const regen_stacks = Math.max(0, ctx.state.typePassiveRegenStacks?.[ctx.slotId] ?? 0);
  const arena_trapped = is_slot_arena_trapped_for_ui(ctx.state, ctx.slotId);
  const arena_trap_turns = arena_trap_remaining_turns(ctx.state, ctx.slotId);
  if (armor_stacks > 0) {
    chips.push({
      id: "passive_armor",
      label: `Armor | +${armor_stacks * 10}%`,
      kind: "buff",
      category: "stat",
      order: 210
    });
  }
  if (regen_stacks > 0) {
    chips.push({
      id: "passive_regen",
      label: `Regen | +${regen_stacks * 5}/turn`,
      kind: "buff",
      category: "sustain",
      order: 330
    });
  }
  if (arena_trapped) {
    chips.push({
      id: "debuff_arena_trap",
      label: `Arena Trap | ${arena_trap_turns}t sem troca`,
      kind: "debuff",
      category: "control",
      order: 110
    });
  }
  return chips;
}
function build_stat_aggregate_chips(ctx) {
  const chips = [];
  for (const entry of ctx.statAggregates) {
    if (entry.totalStageDelta === 0 && entry.totalDeltaPercent === 0) {
      continue;
    }
    chips.push({
      id: `stat_${entry.stat}`,
      label: stat_chip_label(entry),
      kind: effect_kind_for_stat_aggregate(entry),
      category: "stat",
      order: entry.stat === "attack" ? 201 : entry.stat === "defense" ? 202 : 203
    });
  }
  return chips;
}
function effect_default_tag_builder(effect) {
  const label = EFFECT_UI_LABELS[effect.id] ?? effect.id;
  return [
    {
      id: `effect_${effect.id}`,
      label: `${label} | ${effect.remainingTurns}t`,
      kind: "debuff",
      category: "control",
      order: 120
    }
  ];
}
function effect_rejuvenation_tag_builder(_, ctx) {
  const raw_stack = ctx.state.rejuvenationStacks?.[ctx.slotId];
  const stack = typeof raw_stack === "number" && Number.isFinite(raw_stack) ? Math.max(1, Math.floor(raw_stack)) : 1;
  const regen_per_turn = stack * REJUVENATION_REGEN_PER_STACK;
  return [
    {
      id: "effect_rejuvenation",
      label: `Rejuv | +${regen_per_turn} HP/t`,
      kind: "buff",
      category: "sustain",
      order: 310
    }
  ];
}
var EFFECT_TAG_BUILDERS = {
  rejuvenation: effect_rejuvenation_tag_builder
};
function build_effect_chips(ctx) {
  const chips = [];
  const effects = active_effects_for_slot(ctx.state, ctx.slotId);
  for (const effect of effects) {
    const builder = EFFECT_TAG_BUILDERS[effect.id] ?? effect_default_tag_builder;
    chips.push(...builder(effect, ctx));
  }
  return chips;
}
function curse_default_tag_builder(curse) {
  const label = CURSE_UI_LABELS[curse.id] ?? curse.id;
  const suffix = curse.stacks > 1 ? ` | x${curse.stacks}` : "";
  return [
    {
      id: `curse_${curse.id}`,
      label: `${label}${suffix}`,
      kind: "debuff",
      category: "curse",
      order: 410
    }
  ];
}
function curse_leech_seed_tag_builder(curse, ctx) {
  const max_hp = Math.max(1, Math.floor(ctx.state.players[ctx.slotId]?.sharedHpMax ?? 1));
  const stacks = Math.max(1, Math.floor(curse.stacks));
  const hp_per_turn = Math.max(0, Math.floor(max_hp / LEECH_SEED_HP_DIVISOR) * stacks);
  return [
    {
      id: "curse_leech_seed",
      label: `Leech Seed | -${hp_per_turn} HP/t`,
      kind: "debuff",
      category: "curse",
      order: 405
    }
  ];
}
function curse_sekyps_tag_builder(curse, ctx) {
  const stacks = Math.max(1, Math.floor(curse.stacks));
  const state_turn = Number.isFinite(ctx.state.turn) ? Math.floor(ctx.state.turn) : 0;
  const applied_this_turn = typeof curse.appliedTurn === "number" && curse.appliedTurn === state_turn;
  const ticking_stacks = applied_this_turn ? Math.max(0, stacks - 1) : stacks;
  const hp_per_turn = Math.max(0, ticking_stacks * SEKYPS_DAMAGE_PER_STACK_UI);
  return [
    {
      id: "curse_sekyps",
      label: `Sekyps | -${hp_per_turn} HP/t`,
      kind: "debuff",
      category: "curse",
      order: 406
    }
  ];
}
var CURSE_TAG_BUILDERS = {
  leech_seed: curse_leech_seed_tag_builder,
  sekyps: curse_sekyps_tag_builder
};
function build_curse_chips(ctx) {
  const chips = [];
  for (const curse of ctx.myCurses) {
    const builder = CURSE_TAG_BUILDERS[curse.id] ?? curse_default_tag_builder;
    chips.push(...builder(curse, ctx));
  }
  return chips;
}
function build_tag_chips(ctx) {
  return dedupe_and_sort_tag_chips([
    ...build_state_relation_chips(ctx),
    ...build_passive_stat_chips(ctx),
    ...build_stat_aggregate_chips(ctx),
    ...build_effect_chips(ctx),
    ...build_curse_chips(ctx)
  ]);
}
function effect_chips_for_slot(state, slot_id, opponent_slot) {
  const buff_entries = active_buff_debuffs_for_slot(state, slot_id);
  const stat_aggregates = stat_aggregates_from_entries(buff_entries);
  const my_curses = active_curses_for_slot(state, slot_id);
  const enemy_curses = active_curses_for_slot(state, opponent_slot);
  const tag_chips = build_tag_chips({
    state,
    slotId: slot_id,
    opponentSlot: opponent_slot,
    statAggregates: stat_aggregates,
    myCurses: my_curses,
    enemyCurses: enemy_curses
  });
  return tag_chips.map((chip) => ({
    label: chip.label,
    kind: chip.kind
  }));
}
function render_effect_chip_list(container, chips) {
  if (!container) {
    return;
  }
  container.innerHTML = "";
  for (const chip of chips) {
    container.appendChild(effect_chip(chip.label, chip.kind));
  }
}
function render_effects(state, player_slot, enemy_slot) {
  const player_seeded = active_curses_for_slot(state, player_slot).some((curse) => curse.id === "leech_seed");
  const enemy_seeded = active_curses_for_slot(state, enemy_slot).some((curse) => curse.id === "leech_seed");
  player_sprite_wrap.classList.toggle("seeded", player_seeded);
  enemy_sprite_wrap.classList.toggle("seeded", enemy_seeded);
  render_effect_chip_list(player_effects, effect_chips_for_slot(state, player_slot, enemy_slot));
  render_effect_chip_list(enemy_effects, effect_chips_for_slot(state, enemy_slot, player_slot));
}
function panel_hp_percent(mon) {
  return Math.max(0, Math.min(1, mon.hp / mon.maxHp)) * 100;
}
function update_side_panel(side, state, slot_id, skip_meta, skip_bar, force_hidden = false) {
  const player = state.players[slot_id];
  const active = player.team[player.activeIndex];
  const pending_replacement = !!state.pendingSwitch?.[slot_id] && active.hp <= 0;
  const title = side === "player" ? player_title : enemy_title;
  const meta = side === "player" ? player_meta : enemy_meta;
  const hp_bar = side === "player" ? player_hp : enemy_hp;
  const sprite = side === "player" ? player_sprite : enemy_sprite;
  const sprite_wrap = side === "player" ? player_sprite_wrap : enemy_sprite_wrap;
  title.textContent = side === "player" ? player.name || player_name : player.name || "Opponent";
  if (!skip_meta) {
    meta.textContent = `Lv ${active.level} · HP ${active.hp}/${active.maxHp}`;
  }
  if (!skip_bar) {
    hp_bar.style.width = `${panel_hp_percent(active)}%`;
  }
  if (pending_replacement || force_hidden) {
    sprite.removeAttribute("src");
    sprite.alt = "";
    sprite.style.visibility = "hidden";
    set_monster_tooltip(sprite_wrap, null);
    return;
  }
  sprite.src = icon_path(active.id);
  sprite.alt = monster_label(active.id);
  sprite.style.visibility = "";
  set_monster_tooltip(sprite_wrap, tooltip_from_state(state, slot_id, active));
}
function update_panels(state, opts) {
  const viewer_slot = current_viewer_slot();
  if (!viewer_slot)
    return;
  const enemy_slot = viewer_slot === "player1" ? "player2" : "player1";
  const hide_panels_for_pending_choice = !!slot && !is_spectator && state.pendingSwitch?.[slot] && !(typeof forced_switch_target_index === "number" && forced_switch_target_turn === current_turn);
  update_side_panel("player", state, viewer_slot, !!opts?.skipMeta?.player, !!opts?.skipBar?.player, hide_panels_for_pending_choice);
  update_side_panel("enemy", state, enemy_slot, !!opts?.skipMeta?.enemy, !!opts?.skipBar?.enemy, hide_panels_for_pending_choice);
  render_effects(state, viewer_slot, enemy_slot);
  update_bench(state, viewer_slot);
}
function animate_hp_text(side, level, from, to, maxHp, delay = 180) {
  const target = side === "player" ? player_meta : enemy_meta;
  const start = performance.now();
  const duration = 340;
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
    target.textContent = `Lv ${level} · HP ${value}/${maxHp}`;
    if (t < 1) {
      hp_animation[raf_key] = requestAnimationFrame(tick);
    }
  };
  hp_animation[raf_key] = requestAnimationFrame(tick);
}
function clear_animation_timers() {
  while (animation_timers.length) {
    const id = animation_timers.pop();
    if (id !== undefined) {
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
      if (!data || !data.slot || typeof data.to !== "number")
        continue;
      temp.players[data.slot].activeIndex = data.to;
      continue;
    }
    if (entry.type === "protect") {
      const data = entry.data;
      if (!data?.slot)
        continue;
      const side = side_from_slot(viewer_slot, data.slot);
      steps.push({ kind: "shield_on", side });
      continue;
    }
    if (entry.type === "damage_blocked") {
      const data = entry.data;
      if (!data?.slot)
        continue;
      const defenderSide2 = side_from_slot(viewer_slot, data.slot);
      const attackerSide2 = defenderSide2 === "player" ? "enemy" : "player";
      steps.push({ kind: "shield_hit", attackerSide: attackerSide2, defenderSide: defenderSide2 });
      continue;
    }
    if (entry.type === "passive_heal" || entry.type === "wish_heal" || entry.type === "leech_heal") {
      const data = entry.data;
      if (!data?.slot)
        continue;
      const target_player = temp.players[data.slot];
      const target_mon = target_player.team[target_player.activeIndex];
      if (typeof data.after === "number") {
        target_mon.hp = data.after;
      } else if (typeof data.before === "number") {
        const fallback_after = typeof data.amount === "number" ? data.before + data.amount : data.before;
        target_mon.hp = Math.min(target_mon.maxHp, Math.max(0, fallback_after));
      } else if (typeof data.amount === "number") {
        target_mon.hp = Math.min(target_mon.maxHp, Math.max(0, target_mon.hp + data.amount));
      }
      const side = side_from_slot(viewer_slot, data.slot);
      steps.push({ kind: "heal", side });
      continue;
    }
    if (entry.type !== "damage" && entry.type !== "recoil" && entry.type !== "leech_drain" && entry.type !== "spikes_trigger") {
      continue;
    }
    const payload = entry.data;
    if (!payload || typeof payload.damage !== "number" || payload.damage <= 0 || !payload.slot) {
      continue;
    }
    let defender_slot;
    if (entry.type === "recoil") {
      defender_slot = payload.slot;
    } else if (entry.type === "leech_drain") {
      defender_slot = payload.targetSlot ?? (payload.slot === "player1" ? "player2" : "player1");
    } else if (entry.type === "spikes_trigger") {
      defender_slot = payload.targetSlot ?? payload.slot;
    } else {
      defender_slot = payload.slot === "player1" ? "player2" : "player1";
    }
    const defender_player = temp.players[defender_slot];
    const defender = defender_player.team[defender_player.activeIndex];
    const from = typeof payload.before === "number" ? payload.before : defender.hp;
    const to = typeof payload.after === "number" ? payload.after : Math.max(0, from - payload.damage);
    defender.hp = to;
    const defenderSide = side_from_slot(viewer_slot, defender_slot);
    let attackerSide;
    if (entry.type === "recoil") {
      attackerSide = defenderSide;
    } else {
      attackerSide = side_from_slot(viewer_slot, payload.slot);
    }
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
  bar.offsetWidth;
  bar.style.transition = "";
  bar.classList.add("hp-anim");
  bar.style.width = `${to}%`;
  window.setTimeout(() => {
    bar.classList.remove("hp-anim");
  }, 760);
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
  el.offsetWidth;
  el.classList.add(className);
  window.setTimeout(() => {
    el.classList.remove(className);
  }, duration);
}
function trigger_shield_on(el) {
  el.classList.remove("shield-hit");
  el.classList.remove("shield-on");
  el.offsetWidth;
  el.classList.add("shield-on");
}
function trigger_shield_hit(el, duration) {
  if (!el.classList.contains("shield-on")) {
    el.classList.add("shield-on");
  }
  el.classList.remove("shield-hit");
  el.offsetWidth;
  el.classList.add("shield-hit");
  window.setTimeout(() => {
    el.classList.remove("shield-hit");
    el.classList.remove("shield-on");
  }, duration);
}
function handle_state(data) {
  const prev_state = latest_state;
  clear_animation_timers();
  const viewer_slot = current_viewer_slot();
  const steps = prev_state ? build_visual_steps(prev_state, data.log, viewer_slot) : [];
  const hit_sides = new Set(steps.filter((step) => step.kind === "damage").map((step) => step.defenderSide));
  latest_state = data.state;
  update_rps_status(data.state);
  if (!(slot && data.state.pendingSwitch?.[slot])) {
    clear_forced_switch_target();
  }
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
    const min_step_duration = 500;
    const step_gap = 70;
    let cursor = 0;
    for (const step of steps) {
      const base_duration = step.kind === "damage" ? 720 : step.kind === "shield_hit" ? 760 : step.kind === "shield_on" ? 620 : 560;
      const duration = Math.max(min_step_duration, base_duration);
      schedule_animation(() => {
        if (step.kind === "damage") {
          const attacker_wrap = sprite_wrap(step.attackerSide);
          const defender_wrap = sprite_wrap(step.defenderSide);
          trigger_class(attacker_wrap, "jump", 420);
          trigger_class(defender_wrap, "hit", 520);
          const bar = step.defenderSide === "player" ? player_hp : enemy_hp;
          const from_percent = Math.max(0, Math.min(1, step.from / step.maxHp)) * 100;
          const to_percent = Math.max(0, Math.min(1, step.to / step.maxHp)) * 100;
          animate_hp_bar(bar, from_percent, to_percent);
          animate_hp_text(step.defenderSide, step.level, step.from, step.to, step.maxHp, 220);
          return;
        }
        if (step.kind === "shield_on") {
          const wrap = sprite_wrap(step.side);
          trigger_shield_on(wrap);
          return;
        }
        if (step.kind === "shield_hit") {
          const attacker_wrap = sprite_wrap(step.attackerSide);
          const defender_wrap = sprite_wrap(step.defenderSide);
          trigger_class(attacker_wrap, "jump", 420);
          trigger_shield_hit(defender_wrap, 820);
          return;
        }
        if (step.kind === "heal") {
          const wrap = sprite_wrap(step.side);
          trigger_class(wrap, "heal", 520);
        }
      }, cursor);
      cursor += duration + step_gap;
    }
    schedule_animation(() => {
      update_panels(data.state);
    }, cursor + 60);
  } else {
    update_panels(data.state);
  }
  if (data.state.status === "ended") {
    close_switch_modal(true);
  } else {
    close_switch_modal();
  }
  if (data.log.length) {
    log_events(data.log);
  }
  update_action_controls();
  if (data.state.status === "ended" && prev_state?.status !== "ended") {
    append_match_end_marker();
  }
  if (data.state.status === "ended") {
    show_match_end(data.state);
  }
}
function handle_post(message) {
  const data = message.data;
  switch (data.$) {
    case "assign":
      slot = data.slot;
      is_spectator = false;
      update_spec_view_controls();
      set_player_name(data.slot, data.name);
      if (status_slot)
        status_slot.textContent = data.slot === "player1" ? "P1" : "P2";
      if (status_conn)
        status_conn.textContent = "synced";
      player_meta.textContent = `Slot ${data.slot === "player1" ? "P1" : "P2"}`;
      append_log(`assigned ${data.slot}`);
      append_chat(`${data.name} assigned to ${data.slot === "player1" ? "P1" : "P2"}`);
      update_rps_status(latest_state);
      if (latest_state) {
        update_panels(latest_state);
        update_action_controls();
      }
      render_participants();
      return;
    case "ready_state": {
      const previous = last_ready_snapshot ?? { player1: false, player2: false };
      last_ready_snapshot = { ...data.ready };
      const was_ready = is_ready;
      participants = {
        players: { ...data.names },
        spectators: participants ? participants.spectators.slice() : []
      };
      if (match_started && !data.ready.player1 && !data.ready.player2) {
        reset_to_lobby_view();
      }
      if (Array.isArray(data.order)) {
        ready_order = data.order.slice();
      } else {
        PLAYER_SLOTS2.forEach((slot_id) => {
          const is_ready_now = data.ready[slot_id];
          const idx = ready_order.indexOf(slot_id);
          if (is_ready_now && idx === -1) {
            ready_order.push(slot_id);
          } else if (!is_ready_now && idx !== -1) {
            ready_order.splice(idx, 1);
          }
        });
      }
      PLAYER_SLOTS2.forEach((slot_id) => {
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
      } else {
        is_ready = false;
        opponent_ready = false;
        opponent_name = null;
        update_opponent_ui(false, null);
      }
      update_ready_ui(was_ready !== is_ready);
      render_participants();
      return;
    }
    case "turn_config":
      if (match_started) {
        return;
      }
      apply_turn_duration_seconds(data.turnDurationSeconds);
      return;
    case "turn_start":
      handle_turn_start(data);
      return;
    case "intent_locked":
      append_log(`${data.slot} locked intent for turn ${data.turn}`);
      update_action_controls();
      return;
    case "state":
      handle_state(data);
      return;
    case "surrender":
      if ("loser" in data) {
        append_chat(`${data.loser === "player1" ? "P1" : "P2"} surrendered`);
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
      append_chat(`${data.name} joined the room`);
      add_spectator(data.name);
      render_participants();
      return;
    case "spectator":
      slot = null;
      is_spectator = true;
      spectator_viewer_slot = "player1";
      update_spec_view_controls();
      is_ready = false;
      opponent_ready = false;
      opponent_name = null;
      add_spectator(data.name);
      if (status_slot)
        status_slot.textContent = "spectator";
      player_meta.textContent = "Spectator";
      update_rps_status(latest_state);
      if (latest_state) {
        update_panels(latest_state);
        update_action_controls();
      }
      update_opponent_ui(false, null);
      update_ready_ui();
      render_participants();
      return;
    case "chat":
      append_chat_user(data.from, data.message);
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
  bind_move_button_tooltip(btn);
});
if (spec_view_p1) {
  spec_view_p1.addEventListener("click", () => {
    set_spectator_viewer_slot("player1");
  });
}
if (spec_view_p2) {
  spec_view_p2.addEventListener("click", () => {
    set_spectator_viewer_slot("player2");
  });
}
if (run_btn) {
  run_btn.addEventListener("click", () => {
    send_run_intent();
  });
  bind_move_button_tooltip(run_btn);
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
if (turn_seconds_input) {
  const commit_turn_seconds = () => {
    if (match_started || is_ready) {
      update_turn_duration_input();
      return;
    }
    send_turn_duration_config(Number(turn_seconds_input.value));
  };
  turn_seconds_input.addEventListener("change", commit_turn_seconds);
  turn_seconds_input.addEventListener("blur", commit_turn_seconds);
}
if (reset_status_btn) {
  reset_status_btn.addEventListener("click", () => {
    if (match_started) {
      return;
    }
    if (is_ready) {
      show_warning("Click Unready before resetting status.");
      return;
    }
    reset_profile_stats_to_defaults2();
  });
}
match_end_btn.addEventListener("click", () => {
  if (slot && is_ready) {
    send_ready(false);
    is_ready = false;
  }
  reset_to_lobby_view();
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
    if (!Number.isFinite(index))
      return;
    send_switch_intent(index);
  });
});
document.addEventListener("mouseover", (event) => {
  const target = tooltip_target_from_event(event.target);
  if (!target) {
    return;
  }
  const mouse = event;
  open_tooltip(target, mouse.clientX, mouse.clientY);
});
document.addEventListener("mousemove", (event) => {
  if (!active_tooltip_target) {
    return;
  }
  const target = tooltip_target_from_event(event.target);
  if (target !== active_tooltip_target) {
    close_tooltip();
    return;
  }
  const mouse = event;
  position_tooltip(mouse.clientX, mouse.clientY);
});
document.addEventListener("mouseout", (event) => {
  if (!active_tooltip_target) {
    return;
  }
  const from_target = tooltip_target_from_event(event.target);
  if (from_target !== active_tooltip_target) {
    return;
  }
  const related_target = tooltip_target_from_event(event.relatedTarget);
  if (related_target === active_tooltip_target) {
    return;
  }
  close_tooltip();
});
window.addEventListener("blur", () => {
  close_tooltip();
  close_move_tooltip();
});
setInterval(update_deadline, 1000);
setInterval(() => {
  const rtt = ping();
  if (isFinite(rtt)) {
    status_ping.textContent = `${Math.round(rtt)} ms`;
  } else {
    status_ping.textContent = "--";
  }
}, 1000);
setInterval(() => {
  if (!join_sent || relay_runtime.is_server_managed()) {
    return;
  }
  try_post({ $: "join", name: player_name, player_id });
}, RELAY_JOIN_HEARTBEAT_MS);
setInterval(() => {
  if (relay_runtime.is_server_managed()) {
    return;
  }
  relay_runtime.prune_inactive(Date.now());
}, 5000);
load_team_selection2();
render_roster();
render_tabs();
render_config();
update_roster_count();
update_slots();
update_turn_duration_input();
update_action_controls();
update_rps_status(null);
render_participants();
update_spec_view_controls();
on_sync(() => {
  if (status_conn)
    status_conn.textContent = "synced";
  append_log(`connected: room=${room}`);
  append_log("sync complete");
  if (!chat_ready) {
    setup_chat_input(chat_input, chat_send);
    chat_ready = true;
  }
  if (!room_feed_started) {
    try {
      watch(room, consume_network_message);
      load(room, 0, consume_network_message);
      room_feed_started = true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      append_log(`sync setup failed: ${reason}`);
      return;
    }
  }
  if (!join_sent) {
    if (try_post({ $: "join", name: player_name, player_id })) {
      join_sent = true;
    }
  }
});
