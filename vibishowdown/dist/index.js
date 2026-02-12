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

// src/client.ts
var ROOM_POST_PACKER = { $: "String" };
var client = create_client();
var room_watchers = new Map;
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
function emit_if_valid(room, message) {
  if (!message || message.$ !== "info_post") {
    return;
  }
  const data = decode_room_post(message.data);
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
    name: message.name,
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

// src/game_default/moves.ts
var MOVE_CATALOG = [
  { id: "basic_attack", label: "Basic Attack", phaseId: "attack_01", attackMultiplier100: 100 },
  { id: "quick_attack", label: "Quick Attack", phaseId: "attack_01", attackMultiplier100: 66 },
  { id: "agility", label: "Agility", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "wish", label: "Wish", phaseId: "attack_01", attackMultiplier100: 0 },
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
    flatDamage: 35
  },
  { id: "leech_life", label: "Leech Life", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "focus_punch", label: "Focus Punch", phaseId: "attack_01", attackMultiplier100: 150 },
  { id: "pain_split", label: "Pain Split", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "screech", label: "Screech", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "taunt", label: "Taunt", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "endure", label: "Endure", phaseId: "guard", attackMultiplier100: 0 },
  { id: "protect", label: "Protect", phaseId: "guard", attackMultiplier100: 100 },
  { id: "none", label: "none", phaseId: "attack_01", attackMultiplier100: 100 }
];
var MOVE_OPTIONS = MOVE_CATALOG.map((entry) => entry.id);
var MOVE_ALIASES = {
  bells_drum: "belly_drum"
};
var MOVE_LABELS = Object.fromEntries(MOVE_CATALOG.map((entry) => [entry.id, entry.label]));
MOVE_LABELS.bells_drum = "Belly Drum";
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

// src/game_default/passives.ts
var PASSIVE_CATALOG = [
  { id: "none", label: "none" },
  { id: "leftovers", label: "Leftovers", aliases: ["regen_5pct"] },
  { id: "choice_band", label: "Choice Band" }
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
function normalize_passive_id(passive_id) {
  return PASSIVE_BY_ID_INTERNAL.get(passive_id)?.id ?? passive_id;
}
function passive_spec(passive_id) {
  return PASSIVE_BY_ID_INTERNAL.get(passive_id) ?? PASSIVE_BY_ID_INTERNAL.get("none");
}
function apply_leftovers(context) {
  const { monster } = context;
  const heal = mul_div_floor(monster.maxHp, 6, 100);
  if (heal <= 0) {
    return;
  }
  const before = monster.hp;
  monster.hp = Math.min(monster.maxHp, monster.hp + heal);
  const gained = monster.hp - before;
  if (gained <= 0) {
    return;
  }
  context.hp_changed.add(monster);
  context.log.push({
    type: "passive_heal",
    turn: context.turn,
    phase: context.phase,
    summary: `${context.slot} Leftovers +${gained} HP`,
    data: { slot: context.slot, amount: gained, passive: "leftovers" }
  });
}
var NOOP_PASSIVE = () => {};
var PASSIVE_TURN_EFFECTS = {
  none: NOOP_PASSIVE,
  leftovers: apply_leftovers,
  choice_band: NOOP_PASSIVE
};
function apply_passive_turn_effect(passive_id, context) {
  const normalized = passive_spec(passive_id).id;
  const effect = PASSIVE_TURN_EFFECTS[normalized] ?? NOOP_PASSIVE;
  effect(context);
}

// src/game_default/pokemon.ts
function all_move_options() {
  return MOVE_OPTIONS.slice();
}
function all_passive_options() {
  return PASSIVE_OPTIONS.slice();
}
var MONSTER_ROSTER = [
  {
    id: "babydragon",
    name: "Baby Dragon",
    role: "Snorlax",
    stats: { level: 100, maxHp: 575, attack: 438, defense: 250, speed: 105 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["return", "seismic_toss", "agility", "none"],
    defaultPassive: "leftovers"
  },
  {
    id: "croni",
    name: "Croni",
    role: "Ninjask",
    stats: { level: 100, maxHp: 163, attack: 355, defense: 167, speed: 646 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["return", "seismic_toss", "agility", "none"],
    defaultPassive: "leftovers"
  },
  {
    id: "harpy",
    name: "Harpy",
    role: "Absol",
    stats: { level: 100, maxHp: 180, attack: 521, defense: 230, speed: 292 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["return", "seismic_toss", "agility", "none"],
    defaultPassive: "leftovers"
  },
  {
    id: "hoof",
    name: "Hoof",
    role: "Chansey",
    stats: { level: 100, maxHp: 950, attack: 0, defense: 0, speed: 188 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["return", "seismic_toss", "agility", "none"],
    defaultPassive: "leftovers"
  },
  {
    id: "knight",
    name: "Knight",
    role: "Metagross",
    stats: { level: 100, maxHp: 242, attack: 542, defense: 521, speed: 271 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["return", "seismic_toss", "agility", "none"],
    defaultPassive: "leftovers"
  },
  {
    id: "miren",
    name: "Miren",
    role: "Celebi",
    stats: { level: 100, maxHp: 325, attack: 396, defense: 396, speed: 396 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["return", "seismic_toss", "agility", "none"],
    defaultPassive: "leftovers"
  },
  {
    id: "panda",
    name: "Panda",
    role: "Cloyster",
    stats: { level: 100, maxHp: 117, attack: 375, defense: 730, speed: 271 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["return", "seismic_toss", "agility", "none"],
    defaultPassive: "leftovers"
  },
  {
    id: "valkyria",
    name: "Valkyria",
    role: "Aerodactyl",
    stats: { level: 100, maxHp: 242, attack: 417, defense: 250, speed: 521 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["return", "seismic_toss", "agility", "none"],
    defaultPassive: "leftovers"
  }
];
var MONSTER_BY_ID = new Map(MONSTER_ROSTER.map((entry) => [entry.id, entry]));

// src/stats_calc.ts
var EV_PER_STAT_MAX = 252;
var EV_TOTAL_MAX = 508;
var LEVEL_MIN = 1;
var LEVEL_MAX = 100;
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
  return Math.floor((2 * base_hp + iv_hp + ev_bonus(ev_hp)) * level / 100) + level + 10;
}
function calc_non_hp_stat(base, level, ev, iv, nature) {
  const term = Math.floor((2 * base + iv + ev_bonus(ev)) * level / 100) + 5;
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

// src/game_default/integrity.ts
function ensure(condition, message) {
  if (!condition) {
    throw new Error(`[game_default] ${message}`);
  }
}
function ensure_int(value, message) {
  ensure(Number.isInteger(value), message);
}
function assert_monster_integrity(monsters) {
  const monster_ids = new Set;
  for (const monster of monsters) {
    ensure(monster.id.length > 0, "monster id is required");
    ensure(!monster_ids.has(monster.id), `duplicate monster id: ${monster.id}`);
    monster_ids.add(monster.id);
    ensure(monster.defaultMoves.length === 4, `${monster.id}: defaultMoves must contain exactly 4 entries`);
    const possible_moves = new Set(monster.possibleMoves);
    ensure(possible_moves.size > 0, `${monster.id}: possibleMoves cannot be empty`);
    for (const move_id of monster.possibleMoves) {
      ensure(MOVE_BY_ID.has(move_id), `${monster.id}: unknown move in possibleMoves: ${move_id}`);
    }
    const move_dedup = new Set;
    for (const move_id of monster.defaultMoves) {
      ensure(MOVE_BY_ID.has(move_id), `${monster.id}: unknown move in defaultMoves: ${move_id}`);
      ensure(possible_moves.has(move_id), `${monster.id}: default move not allowed: ${move_id}`);
      if (move_id !== "none") {
        ensure(!move_dedup.has(move_id), `${monster.id}: duplicate default move: ${move_id}`);
        move_dedup.add(move_id);
      }
    }
    ensure(monster.possiblePassives.length > 0, `${monster.id}: possiblePassives cannot be empty`);
    const possible_passives = new Set(monster.possiblePassives.map(normalize_passive_id));
    for (const passive_id of monster.possiblePassives) {
      ensure(PASSIVE_BY_ID.has(passive_id), `${monster.id}: unknown passive in possiblePassives: ${passive_id}`);
    }
    const normalized_default = normalize_passive_id(monster.defaultPassive);
    ensure(PASSIVE_BY_ID.has(monster.defaultPassive), `${monster.id}: unknown default passive: ${monster.defaultPassive}`);
    ensure(possible_passives.has(normalized_default), `${monster.id}: default passive not allowed: ${monster.defaultPassive}`);
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

// src/game_default/index.ts
assert_monster_integrity(MONSTER_ROSTER);

// src/engine.ts
var INITIATIVE_DEFAULT = ["speed", "attack", "hp", "defense"];
var PHASES = [
  { id: "switch", name: "Switch", order: 0, initiative: INITIATIVE_DEFAULT },
  { id: "guard", name: "Guard", order: 1, initiative: INITIATIVE_DEFAULT },
  { id: "attack_01", name: "Attack 01", order: 2, initiative: INITIATIVE_DEFAULT }
];
var END_PHASE_ID = "end_turn";
var SLOT_ORDER = ["player1", "player2"];
var END_TURN_EFFECT_ORDER = ["focus_punch", "wish", "leftovers", "leech_life"];
var TAUNT_BLOCKED_MOVE_IDS = new Set([
  "none",
  "agility",
  "wish",
  "belly_drum",
  "screech",
  "taunt",
  "pain_split",
  "leech_life"
]);
var INITIATIVE_WITHOUT_SPEED = ["attack", "hp", "defense"];
function compare_action_initiative(state, phase, a, b) {
  const a_active = active_monster(state.players[a.player]);
  const b_active = active_monster(state.players[b.player]);
  if (a.type === "move" && b.type === "move") {
    const a_quick = a.moveId === "quick_attack";
    const b_quick = b.moveId === "quick_attack";
    if (a_quick !== b_quick) {
      return a_quick ? 1 : -1;
    }
    if (a_quick && b_quick) {
      return compare_initiative(a_active, b_active, INITIATIVE_WITHOUT_SPEED);
    }
  }
  return compare_initiative(a_active, b_active, phase.initiative);
}
function action_type_order(action) {
  if (action.type === "move")
    return 0;
  return 1;
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
  return {
    id: monster.id,
    name: monster.name,
    hp: monster.hp,
    maxHp: monster.maxHp,
    level: monster.level,
    attack: monster.attack,
    defense: monster.defense,
    speed: monster.speed,
    possibleMoves: monster.possibleMoves.slice(),
    possiblePassives: monster.possiblePassives.slice(),
    chosenMoves: monster.chosenMoves.slice(),
    chosenPassive: monster.chosenPassive,
    protectActiveThisTurn: monster.protectActiveThisTurn,
    endureActiveThisTurn: monster.endureActiveThisTurn,
    choiceBandLockedMoveIndex: monster.choiceBandLockedMoveIndex,
    protectCooldownTurns: monster.protectCooldownTurns,
    endureCooldownTurns: monster.endureCooldownTurns
  };
}
function empty_pending() {
  return { player1: false, player2: false };
}
function empty_pending_wish() {
  return { player1: null, player2: null };
}
function empty_taunt_until_turn() {
  return { player1: 0, player2: 0 };
}
function empty_leech_seed_active() {
  return { player1: false, player2: false };
}
function empty_leech_seed_sources() {
  return { player1: null, player2: null };
}
function is_slot_taunted(state, slot) {
  return (state.tauntUntilTurn?.[slot] ?? 0) >= state.turn;
}
function is_attack_move(spec) {
  if (spec.phaseId !== "attack_01") {
    return false;
  }
  return !TAUNT_BLOCKED_MOVE_IDS.has(spec.id);
}
function clone_player(player) {
  return {
    slot: player.slot,
    name: player.name,
    team: player.team.map(clone_monster),
    activeIndex: player.activeIndex
  };
}
function clone_state(state) {
  return {
    turn: state.turn,
    status: state.status,
    winner: state.winner,
    players: {
      player1: clone_player(state.players.player1),
      player2: clone_player(state.players.player2)
    },
    pendingSwitch: { ...state.pendingSwitch },
    pendingWish: {
      player1: state.pendingWish?.player1 ?? null,
      player2: state.pendingWish?.player2 ?? null
    },
    tauntUntilTurn: {
      player1: state.tauntUntilTurn?.player1 ?? 0,
      player2: state.tauntUntilTurn?.player2 ?? 0
    },
    leechSeedActiveByTarget: {
      player1: state.leechSeedActiveByTarget?.player1 ?? false,
      player2: state.leechSeedActiveByTarget?.player2 ?? false
    },
    leechSeedSourceByTarget: {
      player1: state.leechSeedSourceByTarget?.player1 ?? null,
      player2: state.leechSeedSourceByTarget?.player2 ?? null
    }
  };
}
function active_monster(player) {
  return player.team[player.activeIndex];
}
function other_slot(slot) {
  return slot === "player1" ? "player2" : "player1";
}
function compare_initiative(a, b, stats) {
  for (const key of stats) {
    const diff = a[key] - b[key];
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}
function is_alive(monster) {
  return monster.hp > 0;
}
function any_alive(player) {
  return player.team.some((monster) => monster.hp > 0);
}
function first_alive_bench(player) {
  for (let i = 0;i < player.team.length; i++) {
    if (i === player.activeIndex)
      continue;
    if (player.team[i].hp > 0) {
      return i;
    }
  }
  return null;
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
function apply_passives(state, log, hp_changed) {
  for_each_player(state, (player) => {
    const active = active_monster(player);
    if (!is_alive(active))
      return;
    apply_passive_turn_effect(active.chosenPassive, {
      slot: player.slot,
      monster: active,
      turn: state.turn,
      phase: END_PHASE_ID,
      log,
      hp_changed
    });
  });
}
function apply_pending_wish(state, log, slot, hp_changed) {
  if ((state.pendingWish?.[slot] ?? null) !== state.turn) {
    return;
  }
  const player = state.players[slot];
  const target = active_monster(player);
  const before_hp = target.hp;
  const wish_heal = Math.max(0, mul_div_round(target.maxHp, 1, 2));
  const after_hp = Math.min(target.maxHp, Math.max(0, before_hp + wish_heal));
  state.pendingWish[slot] = null;
  if (after_hp !== before_hp) {
    target.hp = after_hp;
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
function clear_leech_seed_on_target_switch(state, log, target_slot) {
  const was_active = state.leechSeedActiveByTarget?.[target_slot] ?? false;
  const source = state.leechSeedSourceByTarget?.[target_slot] ?? null;
  if (!was_active && !source) {
    return;
  }
  state.leechSeedActiveByTarget[target_slot] = false;
  state.leechSeedSourceByTarget[target_slot] = null;
  log.push({
    type: "leech_end",
    turn: state.turn,
    summary: `Leech Life ended on ${target_slot} after switch`,
    data: { slot: target_slot, source }
  });
}
function apply_leech_seed_end_turn(state, log, hp_changed) {
  const active_targets = state.leechSeedActiveByTarget;
  const sources = state.leechSeedSourceByTarget;
  if (!active_targets) {
    return;
  }
  for (const target_slot of SLOT_ORDER) {
    if (!(active_targets[target_slot] ?? false)) {
      continue;
    }
    let source_slot = sources?.[target_slot] ?? null;
    if (!source_slot) {
      source_slot = other_slot(target_slot);
      if (sources) {
        sources[target_slot] = source_slot;
      }
    }
    const target_player = state.players[target_slot];
    const target = active_monster(target_player);
    if (!is_alive(target)) {
      state.leechSeedActiveByTarget[target_slot] = false;
      state.leechSeedSourceByTarget[target_slot] = null;
      continue;
    }
    const target_before = target.hp;
    const drained_from_max = mul_div_floor(target.maxHp, 1, 8);
    const drained = Math.min(target_before, Math.max(0, drained_from_max));
    const target_after = target_before - drained;
    if (drained <= 0) {
      continue;
    }
    target.hp = target_after;
    hp_changed.add(target);
    log.push({
      type: "leech_drain",
      turn: state.turn,
      phase: END_PHASE_ID,
      summary: `${target.name} lost ${drained} HP from Leech Life`,
      data: {
        slot: source_slot,
        targetSlot: target_slot,
        source: source_slot,
        target: target.id,
        damage: drained,
        before: target_before,
        after: target_after
      }
    });
    const source_player = state.players[source_slot];
    const receiver = active_monster(source_player);
    if (is_alive(receiver)) {
      const heal_before = receiver.hp;
      const heal_after = Math.min(receiver.maxHp, receiver.hp + drained);
      const healed = Math.max(0, heal_after - heal_before);
      if (healed > 0) {
        receiver.hp = heal_after;
        hp_changed.add(receiver);
        log.push({
          type: "leech_heal",
          turn: state.turn,
          phase: END_PHASE_ID,
          summary: `${receiver.name} healed ${healed} HP from Leech Life`,
          data: {
            slot: source_slot,
            source: source_slot,
            targetSlot: target_slot,
            target: target.id,
            heal: healed,
            before: heal_before,
            after: heal_after
          }
        });
      }
    }
    if (target_before > 0 && target_after === 0) {
      log.push({
        type: "faint",
        turn: state.turn,
        phase: END_PHASE_ID,
        summary: `${target.name} fainted`,
        data: { slot: target_slot, target: target.id }
      });
    }
    handle_faint(state, log, target_slot);
  }
}
function check_match_end(state, log) {
  if (!any_alive(state.players.player1)) {
    state.status = "ended";
    state.winner = "player2";
    log.push({
      type: "match_end",
      turn: state.turn,
      summary: "player2 wins (all monsters down)",
      data: { winner: "player2" }
    });
    return true;
  }
  if (!any_alive(state.players.player2)) {
    state.status = "ended";
    state.winner = "player1";
    log.push({
      type: "match_end",
      turn: state.turn,
      summary: "player1 wins (all monsters down)",
      data: { winner: "player1" }
    });
    return true;
  }
  return false;
}
function apply_focus_punch_end_turn(state, log, hp_changed, focus_punch_pending, took_damage_this_turn) {
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
    apply_damage_move(state, log, slot, spec, hp_changed, END_PHASE_ID, took_damage_this_turn);
  }
}
function apply_end_turn_effect(state, log, hp_changed, effect_id, focus_punch_pending, took_damage_this_turn) {
  if (effect_id === "focus_punch") {
    apply_focus_punch_end_turn(state, log, hp_changed, focus_punch_pending, took_damage_this_turn);
    return;
  }
  if (effect_id === "wish") {
    for (const slot of SLOT_ORDER) {
      apply_pending_wish(state, log, slot, hp_changed);
    }
    return;
  }
  if (effect_id === "leftovers") {
    apply_passives(state, log, hp_changed);
    return;
  }
  apply_leech_seed_end_turn(state, log, hp_changed);
}
function apply_end_turn_phase(state, log, hp_changed, focus_punch_pending, took_damage_this_turn) {
  for (const effect_id of END_TURN_EFFECT_ORDER) {
    if (state.status === "ended") {
      break;
    }
    apply_end_turn_effect(state, log, hp_changed, effect_id, focus_punch_pending, took_damage_this_turn);
    if (check_match_end(state, log)) {
      break;
    }
  }
}
function handle_faint(state, log, slot) {
  const player = state.players[slot];
  if (is_alive(active_monster(player))) {
    return;
  }
  const next_index = first_alive_bench(player);
  if (next_index === null) {
    return;
  }
  state.pendingSwitch[slot] = true;
  log.push({
    type: "forced_switch_pending",
    turn: state.turn,
    summary: `${slot} must choose a replacement`,
    data: { slot }
  });
}
function minimum_endure_hp(monster) {
  return Math.max(1, mul_div_ceil(monster.maxHp, 1, 100));
}
function apply_damage_with_endure(state, log, phase, slot, monster, attempted_damage, hp_changed, took_damage_this_turn) {
  const before = monster.hp;
  if (before <= 0 || attempted_damage <= 0) {
    return { before, after: before, applied: 0 };
  }
  let after = Math.max(0, before - attempted_damage);
  if (monster.endureActiveThisTurn) {
    const survive_hp = Math.min(before, minimum_endure_hp(monster));
    if (after < survive_hp) {
      const capped_damage = Math.max(0, before - survive_hp);
      after = survive_hp;
      monster.endureActiveThisTurn = false;
      const speed_before = monster.speed;
      monster.speed = Math.max(1, mul_div_round(speed_before, 3, 2));
      log.push({
        type: "endure_trigger",
        turn: state.turn,
        phase,
        summary: `${monster.name} endured the hit (${before} -> ${after})`,
        data: { slot, target: monster.id, before, after, attemptedDamage: attempted_damage, appliedDamage: capped_damage }
      });
      log.push({
        type: "stat_mod",
        turn: state.turn,
        phase,
        summary: `${monster.name} gained speed from Endure (${speed_before} -> ${monster.speed})`,
        data: { slot, target: monster.id, stat: "speed", multiplier: 1.5, before: speed_before, after: monster.speed }
      });
      log.push({
        type: "move_detail",
        turn: state.turn,
        phase,
        summary: `Endure: immortal trigger (HP floor 1% => ${after}); dmg capped ${attempted_damage} -> ${capped_damage}; SPE x1.5 (${speed_before} -> ${monster.speed})`,
        data: {
          move: "endure",
          slot,
          target: monster.id,
          hpBefore: before,
          hpAfter: after,
          damageAttempted: attempted_damage,
          damageApplied: capped_damage,
          speedBefore: speed_before,
          speedAfter: monster.speed
        }
      });
    }
  }
  monster.hp = after;
  const applied = before - after;
  if (applied > 0) {
    hp_changed.add(monster);
    took_damage_this_turn[slot] = true;
  }
  return { before, after, applied };
}
function apply_damage_move(state, log, player_slot, spec, hp_changed, phase_id, took_damage_this_turn) {
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
  const passive = passive_spec(attacker.chosenPassive);
  const choice_band_active = passive.id === "choice_band";
  const effective_attack = choice_band_active ? Math.max(0, mul_div_round(attacker.attack, 3, 2)) : attacker.attack;
  const multiplier100 = spec.attackMultiplier100 + (spec.attackMultiplierPerLevel100 ?? 0) * attacker.level;
  const damage_type = spec.damageType ?? "scaled";
  const effective_defense = defender.defense <= 0 ? 1 : defender.defense;
  const level_term = mul_div_floor(2, attacker.level, 5) + 2;
  let raw_damage = 0;
  if (damage_type === "flat") {
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
  const defender_result = apply_damage_with_endure(state, log, phase_id, opponent_slot, defender, damage, hp_changed, took_damage_this_turn);
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
  if (defender_result.before > 0 && defender_result.after === 0) {
    log.push({
      type: "faint",
      turn: state.turn,
      phase: phase_id,
      summary: `${defender.name} fainted`,
      data: { slot: opponent_slot, target: defender.id }
    });
  }
  const recoil_num = spec.recoilNumerator ?? 0;
  const recoil_den = spec.recoilDenominator ?? 1;
  let recoil_damage = 0;
  let recoil_before = attacker.hp;
  if (recoil_num > 0 && recoil_den > 0 && final_damage > 0) {
    const recoil_attempt = Math.max(0, mul_div_round(final_damage, recoil_num, recoil_den));
    recoil_damage = recoil_attempt;
    if (recoil_damage > 0) {
      const recoil_result = apply_damage_with_endure(state, log, phase_id, player_slot, attacker, recoil_damage, hp_changed, took_damage_this_turn);
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
      if (recoil_result.before > 0 && recoil_result.after === 0) {
        log.push({
          type: "faint",
          turn: state.turn,
          phase: phase_id,
          summary: `${attacker.name} fainted`,
          data: { slot: player_slot, target: attacker.id }
        });
      }
    }
  }
  const choice_band_detail = choice_band_active && damage_type !== "flat" ? `; Choice Band ATK boost: ${attacker.attack} -> ${effective_attack}` : "";
  if (spec.id === "return") {
    const detail = `Return: dmg = floor(((((2*L)/5)+2)*P*A/D)/50)+2 = floor(((${level_term}*${multiplier100}*${effective_attack}/${effective_defense})/50))+2 = ${raw_damage}; final=${final_damage}${was_blocked ? " (blocked by Protect)" : ""}${choice_band_detail}`;
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: phase_id,
      summary: detail,
      data: { move: spec.id, damage: final_damage, blocked: was_blocked }
    });
  } else if (spec.id === "double_edge") {
    const detail = `Double-Edge: dmg = floor(((((2*L)/5)+2)*P*A/D)/50)+2 = floor(((${level_term}*120*${effective_attack}/${effective_defense})/50))+2 = ${raw_damage}; final=${final_damage}${was_blocked ? " (blocked by Protect)" : ""}; recoil = round(final/3) = ${recoil_damage} (${recoil_before} -> ${attacker.hp})${choice_band_detail}`;
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
  } else if (spec.id === "quick_attack") {
    const detail = `Quick Attack: dmg = floor(((((2*L)/5)+2)*P*A/D)/50)+2 = floor(((${level_term}*66*${effective_attack}/${effective_defense})/50))+2 = ${raw_damage}; final=${final_damage}${was_blocked ? " (blocked by Protect)" : ""}; speed check ignored${choice_band_detail}`;
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: phase_id,
      summary: detail,
      data: { move: spec.id, damage: final_damage, blocked: was_blocked }
    });
  } else if (spec.id === "focus_punch") {
    const detail = `Focus Punch: dmg = floor(((((2*L)/5)+2)*P*A/D)/50)+2 = floor(((${level_term}*150*${effective_attack}/${effective_defense})/50))+2 = ${raw_damage}; final=${final_damage}${was_blocked ? " (blocked by Protect)" : ""}${choice_band_detail}`;
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: phase_id,
      summary: detail,
      data: { move: spec.id, damage: final_damage, blocked: was_blocked }
    });
  }
  handle_faint(state, log, opponent_slot);
  if (recoil_num > 0 && recoil_den > 0) {
    handle_faint(state, log, player_slot);
  }
}
function apply_move(state, log, player_slot, move_id, move_index, hp_changed, focus_punch_pending, took_damage_this_turn) {
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
  if (is_slot_taunted(state, player_slot) && !is_attack_move(spec)) {
    log.push({
      type: "taunt_blocked",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} is taunted and cannot use ${spec.label}`,
      data: {
        slot: player_slot,
        move: spec.id,
        untilTurn: state.tauntUntilTurn?.[player_slot] ?? state.turn
      }
    });
    return;
  }
  const passive = passive_spec(attacker.chosenPassive);
  const choice_band_active = passive.id === "choice_band";
  if (choice_band_active && attacker.choiceBandLockedMoveIndex === null && spec.id !== "none") {
    attacker.choiceBandLockedMoveIndex = move_index;
    const locked_move_id = attacker.chosenMoves[move_index] ?? "none";
    log.push({
      type: "choice_band_lock",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${attacker.name} is locked into ${locked_move_id} (slot ${move_index + 1})`,
      data: { slot: player_slot, moveIndex: move_index, move: locked_move_id, passive: passive.id }
    });
  }
  if (spec.id === "none") {
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
      summary: `Endure: HP floor this turn = ${floor_hp} (1% do maxHp); on trigger gain SPE x1.5`,
      data: { move: spec.id, slot: player_slot, target: attacker.id, floorHp: floor_hp }
    });
    return;
  }
  if (spec.id === "agility") {
    const before_speed = attacker.speed;
    attacker.speed = Math.max(1, mul_div_round(before_speed, 2, 1));
    log.push({
      type: "stat_mod",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} Agility success on ${attacker.name} (SPE ${before_speed} -> ${attacker.speed})`,
      data: {
        slot: player_slot,
        target: attacker.id,
        stat: "speed",
        multiplier: 2,
        before: before_speed,
        after: attacker.speed
      }
    });
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `Agility: user SPE x2 (${before_speed} -> ${attacker.speed})`,
      data: { move: spec.id, slot: player_slot, target: attacker.id, before: before_speed, after: attacker.speed }
    });
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
      summary: `Wish: no turno ${trigger_turn}, no inicio do end_turn, o ativo de ${player_slot} cura +50% do maxHp (clamp no max)`,
      data: { move: spec.id, slot: player_slot, triggerTurn: trigger_turn }
    });
    return;
  }
  if (spec.id === "belly_drum") {
    const before_hp = attacker.hp;
    const before_attack = attacker.attack;
    const hp_cost = Math.max(1, mul_div_floor(attacker.maxHp, 1, 2));
    const after_hp = Math.max(1, before_hp - hp_cost);
    const after_attack = Math.max(0, mul_div_round(before_attack, 2, 1));
    attacker.hp = after_hp;
    attacker.attack = after_attack;
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
        multiplier: 2,
        before: before_attack,
        after: after_attack
      }
    });
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `Belly Drum: user paga 50% do maxHp (${before_hp} -> ${after_hp}); ATK x2 (${before_attack} -> ${after_attack})`,
      data: {
        move: spec.id,
        slot: player_slot,
        target: attacker.id,
        hpBefore: before_hp,
        hpAfter: after_hp,
        hpCost: hp_cost,
        hpCostBasedOn: "maxHp",
        attackBefore: before_attack,
        attackAfter: after_attack
      }
    });
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
    state.leechSeedActiveByTarget[target_slot] = true;
    state.leechSeedSourceByTarget[target_slot] = player_slot;
    log.push({
      type: "leech_apply",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} seeded ${defender.name} with Leech Life`,
      data: { slot: player_slot, targetSlot: target_slot, source: player_slot, target: defender.id }
    });
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: "Leech Life: target drains 12.5% at end_turn; active on caster side heals same; seed ends when target switches",
      data: { move: spec.id, slot: player_slot, target: defender.id, targetSlot: target_slot }
    });
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
      summary: "Focus Punch: resolves at start of end_turn; fails if user took real damage before executing",
      data: { move: spec.id, slot: player_slot, target: defender.id }
    });
    return;
  }
  if (spec.id === "screech") {
    const before_defense = defender.defense;
    const after_defense = Math.max(1, mul_div_floor(before_defense, 1, 2));
    defender.defense = after_defense;
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
    return;
  }
  if (spec.id === "taunt") {
    const target_slot = other_slot(player_slot);
    const before_until = state.tauntUntilTurn?.[target_slot] ?? 0;
    const until_turn = Math.max(before_until, state.turn + 1);
    state.tauntUntilTurn[target_slot] = until_turn;
    log.push({
      type: "taunt",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} used Taunt on ${defender.name}`,
      data: { slot: player_slot, target: defender.id, targetSlot: target_slot, beforeUntil: before_until, untilTurn: until_turn }
    });
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `Taunt: ${target_slot} non-attack actions blocked on turns ${state.turn} and ${state.turn + 1}`,
      data: { move: spec.id, slot: player_slot, target: defender.id, targetSlot: target_slot, untilTurn: until_turn }
    });
    return;
  }
  if (spec.id === "pain_split") {
    const before_user_hp = attacker.hp;
    const before_target_hp = defender.hp;
    const shared_hp = Math.max(1, mul_div_floor(before_user_hp + before_target_hp, 1, 2));
    const after_user_hp = Math.min(attacker.maxHp, shared_hp);
    const after_target_hp = Math.min(defender.maxHp, shared_hp);
    attacker.hp = after_user_hp;
    defender.hp = after_target_hp;
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
    return;
  }
  apply_damage_move(state, log, player_slot, spec, hp_changed, spec.phaseId, took_damage_this_turn);
}
function apply_switch(state, log, player_slot, targetIndex) {
  const player = state.players[player_slot];
  const activeIndex = player.activeIndex;
  if (targetIndex < 0 || targetIndex >= player.team.length) {
    log.push({
      type: "switch_invalid",
      turn: state.turn,
      summary: `${player_slot} invalid switch`,
      data: { slot: player_slot, targetIndex }
    });
    return;
  }
  if (targetIndex === activeIndex) {
    log.push({
      type: "switch_invalid",
      turn: state.turn,
      summary: `${player_slot} already active`,
      data: { slot: player_slot, targetIndex }
    });
    return;
  }
  if (!is_alive(player.team[targetIndex])) {
    log.push({
      type: "switch_invalid",
      turn: state.turn,
      summary: `${player_slot} cannot switch to fainted`,
      data: { slot: player_slot, targetIndex }
    });
    return;
  }
  clear_leech_seed_on_target_switch(state, log, player_slot);
  player.team[activeIndex].choiceBandLockedMoveIndex = null;
  player.activeIndex = targetIndex;
  log.push({
    type: "switch",
    turn: state.turn,
    summary: `${player_slot} switched to ${player.team[targetIndex].name}`,
    data: { slot: player_slot, from: activeIndex, to: targetIndex }
  });
}
function build_actions(intents, state) {
  const actions = [];
  for (const slot of SLOT_ORDER) {
    const intent = intents[slot];
    if (!intent)
      continue;
    if (intent.action === "switch") {
      actions.push({ player: slot, type: "switch", phase: "switch", targetIndex: intent.targetIndex });
    } else {
      const player = state.players[slot];
      const active = active_monster(player);
      const moveId = active.chosenMoves[intent.moveIndex] ?? "none";
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
      return {
        id: monster.id,
        name: monster.id,
        hp: final_stats.hpMax,
        maxHp: final_stats.hpMax,
        level,
        attack: final_stats.atk,
        defense: final_stats.def,
        speed: final_stats.spe,
        possibleMoves: monster.moves.slice(),
        possiblePassives: [monster.passive],
        chosenMoves: monster.moves.slice(0, 4),
        chosenPassive: monster.passive,
        protectActiveThisTurn: false,
        endureActiveThisTurn: false,
        choiceBandLockedMoveIndex: null,
        protectCooldownTurns: 0,
        endureCooldownTurns: 0
      };
    });
    return {
      slot,
      name: names[slot],
      team,
      activeIndex: Math.min(Math.max(selection.activeIndex, 0), team.length - 1)
    };
  };
  return {
    turn: 0,
    status: "setup",
    players: {
      player1: build_player("player1"),
      player2: build_player("player2")
    },
    pendingSwitch: empty_pending(),
    pendingWish: empty_pending_wish(),
    tauntUntilTurn: empty_taunt_until_turn(),
    leechSeedActiveByTarget: empty_leech_seed_active(),
    leechSeedSourceByTarget: empty_leech_seed_sources()
  };
}
function resolve_turn(state, intents) {
  const next = clone_state(state);
  const log = [];
  const hp_changed_this_turn = new WeakSet;
  const focus_punch_pending = { player1: false, player2: false };
  const took_damage_this_turn = { player1: false, player2: false };
  if (next.status !== "running") {
    return { state: next, log };
  }
  if (!next.pendingSwitch) {
    next.pendingSwitch = empty_pending();
  }
  if (!next.pendingWish) {
    next.pendingWish = empty_pending_wish();
  }
  if (!next.tauntUntilTurn) {
    next.tauntUntilTurn = empty_taunt_until_turn();
  }
  if (!next.leechSeedActiveByTarget) {
    next.leechSeedActiveByTarget = empty_leech_seed_active();
  }
  if (!next.leechSeedSourceByTarget) {
    next.leechSeedSourceByTarget = empty_leech_seed_sources();
  }
  reset_protect_flags(next);
  const actions = build_actions(intents, next);
  const phases = [...PHASES].sort((a, b) => a.order - b.order);
  let match_ended_in_main_phases = false;
  for (const phase of phases) {
    const phase_actions = actions.filter((action) => action.phase === phase.id);
    if (phase_actions.length === 0) {
      continue;
    }
    if (phase_actions.length >= 2) {
      phase_actions.sort((a, b) => compare_actions_for_phase(next, phase, a, b));
      const first = phase_actions[0];
      const second = phase_actions[1];
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
        if (is_slot_taunted(next, action.player)) {
          log.push({
            type: "taunt_blocked",
            turn: next.turn,
            phase: phase.id,
            summary: `${action.player} is taunted and cannot switch`,
            data: { slot: action.player, action: "switch", untilTurn: next.tauntUntilTurn[action.player] }
          });
          continue;
        }
        apply_switch(next, log, action.player, action.targetIndex);
      } else {
        apply_move(next, log, action.player, action.moveId, action.moveIndex, hp_changed_this_turn, focus_punch_pending, took_damage_this_turn);
      }
      if (check_match_end(next, log)) {
        match_ended_in_main_phases = true;
        break;
      }
    }
    if (match_ended_in_main_phases) {
      break;
    }
  }
  if (!match_ended_in_main_phases) {
    apply_end_turn_phase(next, log, hp_changed_this_turn, focus_punch_pending, took_damage_this_turn);
  }
  decrement_cooldowns(next);
  reset_protect_flags(next);
  return { state: next, log };
}
function apply_forced_switch(state, slot, targetIndex) {
  const next = clone_state(state);
  const log = [];
  const player = next.players[slot];
  if (!next.pendingSwitch[slot]) {
    return { state: next, log, error: "no pending switch" };
  }
  if (targetIndex < 0 || targetIndex >= player.team.length) {
    return { state: next, log, error: "invalid switch target" };
  }
  if (targetIndex === player.activeIndex) {
    return { state: next, log, error: "already active" };
  }
  if (!is_alive(player.team[targetIndex])) {
    return { state: next, log, error: "target fainted" };
  }
  const from = player.activeIndex;
  clear_leech_seed_on_target_switch(next, log, slot);
  player.team[from].choiceBandLockedMoveIndex = null;
  player.activeIndex = targetIndex;
  next.pendingSwitch[slot] = false;
  log.push({
    type: "forced_switch",
    turn: next.turn,
    summary: `${slot} switched to ${player.team[targetIndex].name}`,
    data: { slot, from, to: targetIndex }
  });
  return { state: next, log };
}
function validate_intent(state, slot, intent) {
  const player = state.players[slot];
  if (!player) {
    return "unknown player";
  }
  if (state.pendingSwitch[slot]) {
    return "pending switch";
  }
  const active = active_monster(player);
  const taunted = is_slot_taunted(state, slot);
  if (intent.action === "switch") {
    if (taunted) {
      return "taunted: must use attack";
    }
    if (intent.targetIndex < 0 || intent.targetIndex >= player.team.length) {
      return "invalid switch target";
    }
    if (intent.targetIndex === player.activeIndex) {
      return "already active";
    }
    if (!is_alive(player.team[intent.targetIndex])) {
      return "target fainted";
    }
    return null;
  }
  if (intent.moveIndex < 0 || intent.moveIndex >= active.chosenMoves.length) {
    return "invalid move index";
  }
  const passive = passive_spec(active.chosenPassive);
  if (passive.id === "choice_band" && active.choiceBandLockedMoveIndex !== null && intent.moveIndex !== active.choiceBandLockedMoveIndex) {
    return "choice band locked";
  }
  const moveId = active.chosenMoves[intent.moveIndex] ?? "none";
  const guard_cooldown = Math.max(active.protectCooldownTurns, active.endureCooldownTurns);
  if (taunted && !is_attack_move(move_spec(moveId))) {
    return "taunted: must use attack";
  }
  if (moveId === "protect" && guard_cooldown > 0) {
    return "protect on cooldown";
  }
  if (moveId === "endure" && guard_cooldown > 0) {
    return "endure on cooldown";
  }
  return null;
}

// vibishowdown/index.ts
var EV_KEYS = ["hp", "atk", "def", "spe"];
var PLAYER_SLOTS = ["player1", "player2"];
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
var status_ready = document.getElementById("status-ready");
var status_opponent = document.getElementById("status-opponent");
var chat_messages = document.getElementById("chat-messages");
var log_list = document.getElementById("log-list") ?? chat_messages;
var chat_input = document.getElementById("chat-input");
var chat_send = document.getElementById("chat-send");
var participants_list = document.getElementById("participants-list");
var stat_tooltip = document.getElementById("stat-tooltip");
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
var selected_intent = null;
var selected_intent_turn = 0;
var hp_animation = {};
var animation_timers = [];
var sprite_fx_classes = ["jump", "hit", "heal", "shield-on", "shield-hit"];
var selected = [];
var active_tab = null;
var tooltip_payload_by_element = new WeakMap;
var active_tooltip_target = null;
var relay_server_managed = false;
var relay_ended = false;
var relay_turn = 0;
var relay_state = null;
var relay_local_role = null;
var RELAY_WATCHER_TTL_MS = 90000;
var RELAY_JOIN_HEARTBEAT_MS = 25000;
var relay_seen_indexes = new Set;
var relay_names_by_id = new Map;
var relay_last_seen_at = new Map;
var relay_slot_by_id = new Map;
var relay_ids_by_slot = { player1: null, player2: null };
var relay_join_order = [];
var relay_ready_order_ids = [];
var relay_team_by_id = new Map;
var relay_intents = { player1: null, player2: null };
var relay_forced_switch_intents = { player1: null, player2: null };
var join_sent = false;
var room_feed_started = false;
var chat_ready = false;
var forced_switch_target_index = null;
var forced_switch_target_turn = 0;
var room_game_count = 0;
function icon_path(id) {
  return `./icons/unit_${id}.png`;
}
function emit_local_post(data) {
  handle_post({ data });
}
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
function relay_name(id) {
  return relay_names_by_id.get(id) ?? id;
}
function relay_names_by_slot() {
  const p1 = relay_ids_by_slot.player1;
  const p2 = relay_ids_by_slot.player2;
  return {
    player1: p1 ? relay_name(p1) : null,
    player2: p2 ? relay_name(p2) : null
  };
}
function relay_spectator_names() {
  return relay_join_order.filter((id) => !relay_slot_by_id.has(id)).map(relay_name);
}
function relay_emit_snapshots() {
  const names = relay_names_by_slot();
  const ready = {
    player1: !!relay_ids_by_slot.player1,
    player2: !!relay_ids_by_slot.player2
  };
  const order = [];
  if (ready.player1) {
    order.push("player1");
  }
  if (ready.player2) {
    order.push("player2");
  }
  emit_local_post({
    $: "ready_state",
    ready,
    names,
    order
  });
  emit_local_post({
    $: "participants",
    players: names,
    spectators: relay_spectator_names()
  });
}
function relay_emit_local_role() {
  const local_slot = relay_slot_by_id.get(player_id);
  if (local_slot) {
    if (relay_local_role === local_slot) {
      return;
    }
    relay_local_role = local_slot;
    emit_local_post({ $: "assign", slot: local_slot, token: player_id, name: relay_name(player_id) });
    return;
  }
  if (relay_join_order.includes(player_id)) {
    if (relay_local_role === "spectator") {
      return;
    }
    relay_local_role = "spectator";
    emit_local_post({ $: "spectator", name: relay_name(player_id) });
    return;
  }
  relay_local_role = null;
}
function relay_recompute_slots_from_ready_order() {
  relay_slot_by_id.clear();
  const p1 = relay_ready_order_ids[0] ?? null;
  const p2 = relay_ready_order_ids[1] ?? null;
  relay_ids_by_slot.player1 = p1;
  relay_ids_by_slot.player2 = p2;
  if (p1) {
    relay_slot_by_id.set(p1, "player1");
  }
  if (p2) {
    relay_slot_by_id.set(p2, "player2");
  }
}
function relay_reset_match_to_lobby() {
  relay_state = null;
  relay_ended = false;
  relay_turn = 0;
  relay_intents.player1 = null;
  relay_intents.player2 = null;
  relay_forced_switch_intents.player1 = null;
  relay_forced_switch_intents.player2 = null;
  relay_team_by_id.clear();
  relay_ready_order_ids.length = 0;
  relay_recompute_slots_from_ready_order();
  relay_emit_local_role();
  relay_emit_snapshots();
}
function relay_remove_participant(id) {
  const join_idx = relay_join_order.indexOf(id);
  if (join_idx >= 0) {
    relay_join_order.splice(join_idx, 1);
  }
  relay_last_seen_at.delete(id);
  relay_names_by_id.delete(id);
  relay_team_by_id.delete(id);
  const ready_idx = relay_ready_order_ids.indexOf(id);
  if (ready_idx >= 0) {
    relay_ready_order_ids.splice(ready_idx, 1);
  }
  relay_recompute_slots_from_ready_order();
  relay_intents.player1 = null;
  relay_intents.player2 = null;
  relay_forced_switch_intents.player1 = null;
  relay_forced_switch_intents.player2 = null;
}
function relay_prune_inactive(now_ms) {
  let changed = false;
  for (let i = relay_join_order.length - 1;i >= 0; i--) {
    const id = relay_join_order[i];
    const seen_at = relay_last_seen_at.get(id);
    if (typeof seen_at !== "number") {
      relay_remove_participant(id);
      changed = true;
      continue;
    }
    if (now_ms - seen_at <= RELAY_WATCHER_TTL_MS) {
      continue;
    }
    const slot_id = relay_slot_by_id.get(id);
    if (slot_id && relay_state?.status === "running") {
      continue;
    }
    relay_remove_participant(id);
    changed = true;
  }
  if (!changed) {
    return;
  }
  relay_emit_local_role();
  relay_emit_snapshots();
}
function relay_start_turn() {
  if (!relay_state || relay_ended) {
    return;
  }
  relay_turn += 1;
  relay_state.turn = relay_turn;
  relay_intents.player1 = null;
  relay_intents.player2 = null;
  relay_forced_switch_intents.player1 = null;
  relay_forced_switch_intents.player2 = null;
  emit_local_post({
    $: "turn_start",
    turn: relay_turn,
    deadline_at: 0,
    intents: { player1: false, player2: false }
  });
}
function relay_start_match_if_ready() {
  if (relay_state || relay_ended) {
    return;
  }
  const p1 = relay_ids_by_slot.player1;
  const p2 = relay_ids_by_slot.player2;
  if (!p1 || !p2) {
    return;
  }
  const p1_team = relay_team_by_id.get(p1);
  const p2_team = relay_team_by_id.get(p2);
  if (!p1_team || !p2_team) {
    return;
  }
  const names = relay_names_by_slot();
  try {
    relay_state = create_initial_state({
      player1: p1_team,
      player2: p2_team
    }, {
      player1: names.player1 || "player1",
      player2: names.player2 || "player2"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid team";
    append_chat(`team error: ${message}`);
    return;
  }
  relay_state.status = "running";
  relay_turn = 0;
  emit_local_post({ $: "state", turn: 0, state: relay_state, log: [] });
  relay_start_turn();
}
function relay_handle_join(data) {
  const id = relay_identity(data);
  if (!id) {
    return;
  }
  const is_first_join = !relay_join_order.includes(id);
  relay_names_by_id.set(id, data.name);
  if (is_first_join) {
    relay_join_order.push(id);
    emit_local_post({ $: "join", name: data.name });
  }
  relay_emit_local_role();
  relay_emit_snapshots();
}
function relay_handle_ready(data) {
  if (relay_state?.status === "running") {
    return;
  }
  const id = relay_identity(data);
  if (!id) {
    return;
  }
  if (!data.ready) {
    relay_team_by_id.delete(id);
    const idx = relay_ready_order_ids.indexOf(id);
    if (idx >= 0) {
      relay_ready_order_ids.splice(idx, 1);
    }
    relay_recompute_slots_from_ready_order();
    relay_emit_local_role();
    relay_emit_snapshots();
    return;
  }
  if (!data.team) {
    return;
  }
  relay_team_by_id.set(id, data.team);
  if (!relay_ready_order_ids.includes(id)) {
    relay_ready_order_ids.push(id);
  }
  relay_recompute_slots_from_ready_order();
  relay_emit_local_role();
  relay_emit_snapshots();
  relay_start_match_if_ready();
}
function relay_handle_intent(data) {
  if (!relay_state || relay_ended) {
    return;
  }
  const id = relay_identity(data);
  if (!id) {
    return;
  }
  const slot_id = relay_slot_by_id.get(id);
  if (!slot_id) {
    return;
  }
  if (data.turn !== relay_turn) {
    return;
  }
  let validation_state = relay_state;
  if (relay_state.pendingSwitch[slot_id]) {
    const forced_target_candidate = Number.isInteger(data.forcedSwitchTargetIndex) ? data.forcedSwitchTargetIndex : relay_forced_switch_intents[slot_id];
    if (typeof forced_target_candidate !== "number" || !Number.isInteger(forced_target_candidate)) {
      return;
    }
    const forced_target = forced_target_candidate;
    const forced_preview = apply_forced_switch(relay_state, slot_id, forced_target);
    if (forced_preview.error) {
      return;
    }
    validation_state = forced_preview.state;
    relay_forced_switch_intents[slot_id] = forced_target;
  } else {
    relay_forced_switch_intents[slot_id] = null;
  }
  const validation = validate_intent(validation_state, slot_id, data.intent);
  if (validation) {
    return;
  }
  relay_intents[slot_id] = data.intent;
  if (!relay_intents.player1 || !relay_intents.player2) {
    return;
  }
  for (const slot_check of PLAYER_SLOTS) {
    if (relay_state.pendingSwitch[slot_check] && !Number.isInteger(relay_forced_switch_intents[slot_check])) {
      return;
    }
  }
  let turn_state = relay_state;
  const pre_turn_log = [];
  for (const slot_apply of PLAYER_SLOTS) {
    if (!turn_state.pendingSwitch[slot_apply]) {
      continue;
    }
    const target_candidate = relay_forced_switch_intents[slot_apply];
    if (typeof target_candidate !== "number" || !Number.isInteger(target_candidate)) {
      return;
    }
    const target_index = target_candidate;
    const switch_result = apply_forced_switch(turn_state, slot_apply, target_index);
    if (switch_result.error) {
      return;
    }
    turn_state = switch_result.state;
    pre_turn_log.push(...switch_result.log);
  }
  const { state, log } = resolve_turn(turn_state, {
    player1: relay_intents.player1,
    player2: relay_intents.player2
  });
  relay_state = state;
  emit_local_post({ $: "state", turn: relay_turn, state: relay_state, log: [...pre_turn_log, ...log] });
  if (relay_state.status === "ended") {
    relay_ended = true;
    relay_reset_match_to_lobby();
    return;
  }
  relay_start_turn();
}
function relay_handle_forced_switch(data) {
  if (!relay_state || relay_ended) {
    return;
  }
  const id = relay_identity(data);
  if (!id) {
    return;
  }
  const slot_id = relay_slot_by_id.get(id);
  if (!slot_id) {
    return;
  }
  if (!relay_state.pendingSwitch[slot_id]) {
    return;
  }
  const player = relay_state.players[slot_id];
  if (data.targetIndex < 0 || data.targetIndex >= player.team.length) {
    return;
  }
  if (data.targetIndex === player.activeIndex) {
    return;
  }
  if (player.team[data.targetIndex].hp <= 0) {
    return;
  }
  relay_forced_switch_intents[slot_id] = data.targetIndex;
}
function relay_handle_surrender(data) {
  if (!relay_state || relay_ended || "loser" in data) {
    return;
  }
  const id = relay_identity(data);
  if (!id) {
    return;
  }
  const loser = relay_slot_by_id.get(id);
  if (!loser) {
    return;
  }
  const winner = loser === "player1" ? "player2" : "player1";
  relay_state.status = "ended";
  relay_state.winner = winner;
  relay_ended = true;
  const log = [
    {
      type: "match_end",
      turn: relay_turn,
      summary: `${winner} wins (surrender)`,
      data: { winner }
    }
  ];
  emit_local_post({ $: "state", turn: relay_turn, state: relay_state, log });
  emit_local_post({ $: "surrender", turn: relay_turn, loser, winner });
  relay_reset_match_to_lobby();
}
function relay_consume_post(data, seen_at) {
  const id = relay_identity(data);
  if (id) {
    relay_last_seen_at.set(id, seen_at);
  }
  switch (data.$) {
    case "join":
      relay_handle_join(data);
      return;
    case "chat":
      emit_local_post(data);
      return;
    case "ready":
      relay_handle_ready(data);
      return;
    case "intent":
      relay_handle_intent(data);
      return;
    case "forced_switch":
      relay_handle_forced_switch(data);
      return;
    case "surrender":
      relay_handle_surrender(data);
      return;
    case "error":
      emit_local_post(data);
      return;
    default:
      return;
  }
}
function consume_network_message(message) {
  const seen_at = typeof message?.server_time === "number" ? message.server_time : Date.now();
  const index = typeof message?.index === "number" ? message.index : -1;
  if (index >= 0) {
    if (relay_seen_indexes.has(index)) {
      return;
    }
    relay_seen_indexes.add(index);
  }
  const data = message && typeof message === "object" ? message.data : null;
  if (!data || typeof data !== "object" || typeof data.$ !== "string") {
    return;
  }
  if (is_server_managed_post(data)) {
    relay_server_managed = true;
    emit_local_post(data);
    return;
  }
  if (relay_server_managed) {
    emit_local_post(data);
    return;
  }
  relay_consume_post(data, seen_at);
  relay_prune_inactive(seen_at);
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
function passive_label(id) {
  return PASSIVE_LABELS[id] || id;
}
function stat_label(value) {
  if (value === "attack")
    return "ATK";
  if (value === "defense")
    return "DEF";
  if (value === "speed")
    return "SPE";
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
function base_stats_for(monster_id, level) {
  const spec = MONSTER_BY_ID.get(monster_id);
  if (!spec) {
    return { maxHp: 1, attack: 0, defense: 0, speed: 0 };
  }
  const base_stats = normalize_stats(spec.stats, spec.stats);
  const resolved_level = normalize_stat_value("level", level, base_stats.level);
  const baseline = stats_from_base_level_ev(base_stats, resolved_level, empty_ev_spread());
  return {
    maxHp: baseline.maxHp,
    attack: baseline.attack,
    defense: baseline.defense,
    speed: baseline.speed
  };
}
function tooltip_from_config(monster_id) {
  const config = get_config(monster_id);
  const base = base_stats_for(monster_id, config.stats.level);
  return {
    id: monster_id,
    name: monster_label(monster_id),
    passive: config.passive,
    moves: config.moves.slice(0, 4),
    current: {
      hp: config.stats.maxHp,
      maxHp: config.stats.maxHp,
      attack: config.stats.attack,
      defense: config.stats.defense,
      speed: config.stats.speed
    },
    base
  };
}
function tooltip_from_state(mon) {
  const base = base_stats_for(mon.id, mon.level);
  return {
    id: mon.id,
    name: monster_label(mon.id),
    passive: mon.chosenPassive,
    moves: mon.chosenMoves.slice(0, 4),
    current: {
      hp: Math.max(0, mon.hp),
      maxHp: mon.maxHp,
      attack: mon.attack,
      defense: mon.defense,
      speed: mon.speed
    },
    base
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
function tooltip_stat_row(label, current, base) {
  const row = document.createElement("div");
  row.className = "stat-tooltip-row";
  const label_el = document.createElement("span");
  label_el.className = "stat-tooltip-label";
  label_el.textContent = label;
  const value_el = document.createElement("span");
  value_el.className = `stat-tooltip-value ${tooltip_value_state(current, base)}`;
  value_el.textContent = `${current}`;
  row.appendChild(label_el);
  row.appendChild(value_el);
  return row;
}
function render_monster_tooltip(payload) {
  if (!stat_tooltip)
    return;
  stat_tooltip.innerHTML = "";
  const title = document.createElement("div");
  title.className = "stat-tooltip-title";
  title.textContent = payload.name;
  stat_tooltip.appendChild(title);
  const stats_grid2 = document.createElement("div");
  stats_grid2.className = "stat-tooltip-grid";
  stats_grid2.appendChild(tooltip_stat_row("ATK", payload.current.attack, payload.base.attack));
  stats_grid2.appendChild(tooltip_stat_row("DEF", payload.current.defense, payload.base.defense));
  stats_grid2.appendChild(tooltip_stat_row("SPE", payload.current.speed, payload.base.speed));
  stats_grid2.appendChild(tooltip_stat_row("HP", payload.current.maxHp, payload.base.maxHp));
  stat_tooltip.appendChild(stats_grid2);
  const hp_line = document.createElement("div");
  hp_line.className = "stat-tooltip-hp";
  hp_line.textContent = `Vida atual: ${payload.current.hp}/${payload.current.maxHp}`;
  stat_tooltip.appendChild(hp_line);
  const passive_line = document.createElement("div");
  passive_line.className = "stat-tooltip-passive";
  passive_line.textContent = `Passive: ${passive_label(payload.passive)}`;
  stat_tooltip.appendChild(passive_line);
  const moves_box = document.createElement("div");
  moves_box.className = "stat-tooltip-moves";
  const moves = payload.moves.slice(0, 4);
  while (moves.length < 4) {
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
function append_log(line) {
  append_line(log_list, compact_slot_labels(line));
}
function append_chat(line) {
  append_line(chat_messages, line);
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
  for (const slot_id of PLAYER_SLOTS) {
    const name = state.players[slot_id];
    if (!name)
      continue;
    const item = document.createElement("div");
    item.className = "participant";
    const meta = slot_id === "player1" ? "P1" : "P2";
    item.innerHTML = `<span>${name}</span><span class="participant-meta">${meta}</span>`;
    participants_list.appendChild(item);
  }
  const spectators = state.spectators.slice().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
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
    selected.splice(0, selected.length, ...parsed.selected.filter((id) => MONSTER_BY_ID.has(id)));
  }
}
function save_team_selection() {
  save_json(team_key, { selected: selected.slice() });
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
function read_ev_value(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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
function stats_equal(left, right) {
  return left.level === right.level && left.maxHp === right.maxHp && left.attack === right.attack && left.defense === right.defense && left.speed === right.speed;
}
function ev_equal(left, right) {
  return left.hp === right.hp && left.atk === right.atk && left.def === right.def && left.spe === right.spe;
}
function coerce_config(spec, value) {
  const base_stats = normalize_stats(spec.stats, spec.stats);
  const base_level = normalize_stat_value("level", base_stats.level, 1);
  const base_ev = empty_ev_spread();
  const base = {
    moves: spec.defaultMoves.slice(0, 4),
    passive: spec.defaultPassive,
    stats: stats_from_base_level_ev(base_stats, base_level, base_ev),
    ev: base_ev
  };
  if (!value) {
    return base;
  }
  const moves = Array.isArray(value.moves) ? value.moves.slice(0, 4) : base.moves.slice();
  while (moves.length < 4) {
    moves.push("none");
  }
  const allowed = new Set(spec.possibleMoves);
  for (let i = 0;i < moves.length; i++) {
    if (moves[i] === "bells_drum") {
      moves[i] = "belly_drum";
    }
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
  const level = normalize_stat_value("level", value.stats?.level, base.stats.level);
  const legacy_ev = normalize_legacy_ev_from_stat_alloc(value.statAlloc);
  const ev = normalize_ev_spread(value.ev ?? legacy_ev ?? base.ev, base.ev);
  const stats = stats_from_base_level_ev(base_stats, level, ev);
  return {
    moves,
    passive,
    stats,
    ev
  };
}
function get_config(monster_id) {
  const spec = MONSTER_BY_ID.get(monster_id);
  if (!spec) {
    throw new Error(`Missing monster spec: ${monster_id}`);
  }
  const config = coerce_config(spec, profile.monsters[monster_id]);
  profile.monsters[monster_id] = config;
  save_profile();
  return config;
}
function reset_profile_stats_to_defaults() {
  let changed = false;
  for (const spec of MONSTER_ROSTER) {
    const config = coerce_config(spec, profile.monsters[spec.id]);
    const base_stats = normalize_stats(spec.stats, spec.stats);
    const default_ev = empty_ev_spread();
    const default_stats = stats_from_base_level_ev(base_stats, base_stats.level, default_ev);
    if (!stats_equal(config.stats, default_stats)) {
      changed = true;
    }
    if (!ev_equal(config.ev, default_ev)) {
      changed = true;
    }
    profile.monsters[spec.id] = {
      moves: config.moves.slice(0, 4),
      passive: config.passive,
      stats: default_stats,
      ev: default_ev
    };
  }
  save_profile();
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
  stats_grid.innerHTML = "";
  if (!active_tab) {
    show_warning("Select 3 monsters to configure.");
    return;
  }
  clear_warning();
  const spec = MONSTER_BY_ID.get(active_tab);
  if (!spec) {
    show_warning("Unknown monster.");
    return;
  }
  const config = get_config(active_tab);
  const base_stats = normalize_stats(spec.stats, spec.stats);
  config.stats = stats_from_base_level_ev(base_stats, config.stats.level, config.ev);
  for (let i = 0;i < 4; i++) {
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
  const level_label = document.createElement("label");
  level_label.textContent = "Lv";
  const level_input = document.createElement("input");
  level_input.type = "number";
  level_input.min = `${LEVEL_MIN}`;
  level_input.max = `${LEVEL_MAX}`;
  level_input.value = `${config.stats.level}`;
  level_input.disabled = is_ready && !match_started;
  level_input.addEventListener("change", () => {
    if (is_ready && !match_started)
      return;
    const value = Number(level_input.value);
    if (!Number.isFinite(value)) {
      level_input.value = `${config.stats.level}`;
      return;
    }
    const normalized = normalize_stat_value("level", value, config.stats.level);
    config.stats = stats_from_base_level_ev(base_stats, normalized, config.ev);
    level_input.value = `${normalized}`;
    clear_warning();
    save_profile();
    render_config();
  });
  level_label.appendChild(level_input);
  moves_grid.appendChild(level_label);
  const passive_label2 = document.createElement("label");
  passive_label2.textContent = "Passive";
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
    if (is_ready && !match_started)
      return;
    config.passive = passive_select.value;
    save_profile();
  });
  passive_label2.appendChild(passive_select);
  moves_grid.appendChild(passive_label2);
  const points_summary = document.createElement("div");
  points_summary.className = "stat-points-summary";
  stats_grid.appendChild(points_summary);
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
  stats_grid.appendChild(column_header);
  const update_points_summary = () => {
    const used = ev_total(config.ev);
    const remaining = EV_TOTAL_MAX - used;
    points_summary.textContent = `EVs: ${used}/${EV_TOTAL_MAX} (restante: ${Math.max(0, remaining)})`;
  };
  const stat_rows = [
    ["hp", "HP"],
    ["atk", "ATK"],
    ["def", "DEF"],
    ["spe", "SPE"]
  ];
  const stat_key_by_ev = {
    hp: "maxHp",
    atk: "attack",
    def: "defense",
    spe: "speed"
  };
  const calc_total_stat = (key) => {
    const base = base_stats[stat_key_by_ev[key]];
    const level = config.stats.level;
    const ev_quarter = Math.floor(config.ev[key] / 4);
    const scaled = Math.floor((2 * base + ev_quarter) * level / 100);
    if (key === "hp") {
      return scaled + level + 10;
    }
    return scaled + 5;
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
    alloc_input.max = `${EV_PER_STAT_MAX}`;
    alloc_input.step = "1";
    alloc_input.value = `${config.ev[key]}`;
    alloc_input.disabled = is_ready && !match_started;
    const alloc_slider = document.createElement("input");
    alloc_slider.type = "range";
    alloc_slider.className = "stat-alloc-slider";
    alloc_slider.min = "0";
    alloc_slider.max = `${EV_PER_STAT_MAX}`;
    alloc_slider.value = `${config.ev[key]}`;
    alloc_slider.disabled = is_ready && !match_started;
    const result_value = document.createElement("span");
    result_value.className = "stat-result-value";
    result_value.textContent = `${calc_total_stat(key)}`;
    const apply_allocation_value = (next_raw) => {
      const current = config.ev[key];
      if (!Number.isInteger(next_raw)) {
        show_warning(`EV ${key} must be integer.`);
        alloc_input.value = `${current}`;
        alloc_slider.value = `${current}`;
        return;
      }
      const candidate = { ...config.ev, [key]: next_raw };
      const ev_error = validate_ev_spread(candidate);
      if (ev_error) {
        show_warning(ev_error);
        alloc_input.value = `${current}`;
        alloc_slider.value = `${current}`;
        return;
      }
      config.ev = candidate;
      config.stats = stats_from_base_level_ev(base_stats, config.stats.level, config.ev);
      alloc_input.value = `${next_raw}`;
      alloc_slider.value = `${next_raw}`;
      result_value.textContent = `${calc_total_stat(key)}`;
      clear_warning();
      update_points_summary();
      save_profile();
    };
    alloc_input.addEventListener("change", () => {
      if (is_ready && !match_started)
        return;
      const value = Number(alloc_input.value);
      if (!Number.isFinite(value)) {
        alloc_input.value = `${config.ev[key]}`;
        return;
      }
      apply_allocation_value(value);
    });
    alloc_slider.addEventListener("input", () => {
      if (is_ready && !match_started)
        return;
      apply_allocation_value(Number(alloc_slider.value));
    });
    row.appendChild(stat_name);
    row.appendChild(base_value);
    row.appendChild(alloc_input);
    row.appendChild(alloc_slider);
    row.appendChild(result_value);
    stats_grid.appendChild(row);
  }
  update_points_summary();
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
  for (const entry of MONSTER_ROSTER) {
    const card = document.createElement("div");
    const is_selected = selected.includes(entry.id);
    const is_disabled = !is_selected && selected.length >= 3 || is_ready && !match_started;
    const tooltip = tooltip_from_config(entry.id);
    card.className = `roster-card${is_selected ? " active" : ""}${is_disabled ? " disabled" : ""}`;
    set_monster_tooltip(card, tooltip);
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
      if (is_disabled)
        return;
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
    set_monster_tooltip(slot2.btn, null);
    slot2.img.removeAttribute("src");
    slot2.img.alt = "";
    slot2.img.style.display = "none";
    return;
  }
  const tooltip = tooltip_from_state(mon);
  slot2.btn.classList.remove("empty");
  slot2.btn.dataset.index = `${index}`;
  set_monster_tooltip(slot2.btn, tooltip);
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
  const can_switch = !!slot && slot === viewer_slot && match_started && !is_spectator && (!!has_pending_switch() || current_turn > 0);
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
  const forced_switch_ready = !relay_server_managed && has_forced_switch_target_for_current_turn();
  const controls_disabled = !match_started || !slot || is_spectator || current_turn <= 0 || pending_switch && !forced_switch_ready;
  if (!has_team) {
    move_buttons.forEach((btn, index) => {
      btn.textContent = `Move ${index + 1}`;
      btn.disabled = true;
      btn.classList.remove("selected-intent");
    });
    if (switch_btn)
      switch_btn.disabled = true;
    return;
  }
  const active_id = selected[0];
  const config = get_config(active_id);
  let guard_on_cooldown = false;
  let choice_band_locked_move = null;
  let active_moves = config.moves;
  if (latest_state && slot) {
    const player_state = latest_state.players[slot];
    const fallback_active = player_state.team[player_state.activeIndex];
    const preview_active = pending_switch && has_forced_switch_target_for_current_turn() && typeof forced_switch_target_index === "number" ? player_state.team[forced_switch_target_index] ?? fallback_active : fallback_active;
    guard_on_cooldown = Math.max(preview_active.protectCooldownTurns, preview_active.endureCooldownTurns) > 0;
    active_moves = preview_active.chosenMoves;
    if (preview_active.chosenPassive === "choice_band") {
      choice_band_locked_move = typeof preview_active.choiceBandLockedMoveIndex === "number" ? preview_active.choiceBandLockedMoveIndex : null;
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
    } else if (move === "protect" && guard_on_cooldown) {
      btn.textContent = is_locked_slot ? `${index + 1}. Protect (cooldown, locked)` : `${index + 1}. Protect (cooldown)`;
      btn.disabled = true;
    } else if (move === "endure" && guard_on_cooldown) {
      btn.textContent = is_locked_slot ? `${index + 1}. Endure (cooldown, locked)` : `${index + 1}. Endure (cooldown)`;
      btn.disabled = true;
    } else {
      btn.textContent = is_locked_slot ? `${index + 1}. ${label} (locked)` : `${index + 1}. ${label}`;
      btn.disabled = controls_disabled;
    }
    const is_selected_move = selected_intent_turn === current_turn && selected_intent?.action === "use_move" && selected_intent.moveIndex === index;
    btn.classList.toggle("selected-intent", is_selected_move && !btn.disabled);
  });
  if (switch_btn) {
    const switch_disabled = !match_started || !slot || is_spectator || current_turn <= 0;
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
function clear_forced_switch_target() {
  forced_switch_target_index = null;
  forced_switch_target_turn = 0;
}
function has_forced_switch_target_for_current_turn() {
  return has_pending_switch() && typeof forced_switch_target_index === "number" && forced_switch_target_turn === current_turn;
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
    if (relay_server_managed) {
      append_log("pending switch");
      return false;
    }
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
function send_move_intent(moveIndex) {
  if (!post_turn_intent({ action: "use_move", moveIndex })) {
    return;
  }
  const was_selected = selected_intent_turn === current_turn && selected_intent !== null;
  selected_intent = { action: "use_move", moveIndex };
  selected_intent_turn = current_turn;
  update_action_controls();
  append_log(was_selected ? "intent updated" : "intent sent");
}
function send_switch_intent(targetIndex) {
  if (has_pending_switch()) {
    if (relay_server_managed) {
      if (try_post({ $: "forced_switch", targetIndex, player_id })) {
        close_switch_modal();
      }
      return;
    }
    forced_switch_target_index = targetIndex;
    forced_switch_target_turn = current_turn;
    append_log("replacement selected (hidden until turn resolves)");
    close_switch_modal();
    if (selected_intent_turn === current_turn && selected_intent) {
      const reposted = post_turn_intent(selected_intent);
      if (reposted) {
        append_log("intent updated");
      }
    }
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
function close_switch_modal() {
  switch_modal.classList.remove("open");
}
function open_switch_modal(mode = "intent") {
  if (!latest_state || !slot)
    return;
  if (mode === "intent" && !can_send_intent())
    return;
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
      const is_alive2 = entry.mon.hp > 0;
      button.disabled = !is_alive2;
      button.textContent = `${entry.mon.name}${is_alive2 ? "" : " (fainted)"}`;
      button.addEventListener("click", () => {
        if (mode === "intent") {
          send_switch_intent(entry.index);
          return;
        }
        send_switch_intent(entry.index);
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
  const monsters = [];
  for (const id of selected) {
    const spec = MONSTER_BY_ID.get(id);
    if (!spec) {
      show_warning(`Unknown monster: ${id}`);
      return null;
    }
    const base_stats = normalize_stats(spec.stats, spec.stats);
    const config = get_config(id);
    const ev_error = validate_ev_spread(config.ev);
    if (ev_error) {
      show_warning(`${monster_label(id)}: ${ev_error}`);
      return null;
    }
    const level = normalize_stat_value("level", config.stats.level, base_stats.level);
    const stats = stats_from_base_level_ev(base_stats, level, config.ev);
    config.stats = stats;
    monsters.push({
      id,
      moves: config.moves.slice(0, 4),
      passive: config.passive,
      stats: { ...stats },
      ev: { ...config.ev }
    });
  }
  clear_warning();
  save_profile();
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
    try_post({ $: "ready", ready: true, team, player_id });
  } else {
    if (!slot) {
      return;
    }
    try_post({ $: "ready", ready: false, player_id });
  }
}
function update_ready_ui() {
  if (status_ready) {
    status_ready.textContent = is_ready ? "ready" : "not ready";
    status_ready.className = `status-pill ${is_ready ? "ok" : "off"}`;
  }
  ready_btn.textContent = is_ready ? "Unready" : "Ready";
  ready_btn.disabled = match_started;
  if (reset_status_btn) {
    reset_status_btn.disabled = match_started || is_ready;
  }
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
  if (!status_opponent)
    return;
  status_opponent.textContent = opponent_ready2 ? "ready" : opponent_name2 ? "waiting" : "offline";
  status_opponent.className = `status-pill ${opponent_ready2 ? "ok" : opponent_name2 ? "warn" : "off"}`;
}
function show_match_end(winner) {
  if (!match_end)
    return;
  const is_winner = winner && slot === winner;
  match_end_title.textContent = is_winner ? "Victory" : "Defeat";
  if (!winner) {
    match_end_title.textContent = "Match ended";
  }
  match_end_sub.textContent = winner ? `${winner} wins the match.` : "Match finished.";
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
  close_switch_modal();
  match_end.classList.remove("open");
  prematch.style.display = "";
  document.body.classList.add("prematch-open");
  status_turn.textContent = "0";
  update_deadline();
  update_action_controls();
}
function handle_turn_start(data) {
  current_turn = data.turn;
  deadline_at = data.deadline_at;
  selected_intent = null;
  selected_intent_turn = 0;
  clear_forced_switch_target();
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
function render_effects(state, viewer_slot, player_slot, enemy_slot) {
  const player_seeded_by = state.leechSeedSourceByTarget?.[player_slot] ?? null;
  const enemy_seeded_by = state.leechSeedSourceByTarget?.[enemy_slot] ?? null;
  const player_seeded = state.leechSeedActiveByTarget?.[player_slot] ?? !!player_seeded_by;
  const enemy_seeded = state.leechSeedActiveByTarget?.[enemy_slot] ?? !!enemy_seeded_by;
  player_sprite_wrap.classList.toggle("seeded", player_seeded);
  enemy_sprite_wrap.classList.toggle("seeded", enemy_seeded);
  if (player_effects) {
    player_effects.innerHTML = "";
    if (player_seeded) {
      player_effects.appendChild(effect_chip("Seeded", "seeded"));
    }
    if (enemy_seeded_by === viewer_slot) {
      player_effects.appendChild(effect_chip("Leech+", "drain"));
    }
  }
  if (enemy_effects) {
    enemy_effects.innerHTML = "";
    if (enemy_seeded) {
      enemy_effects.appendChild(effect_chip("Seeded", "seeded"));
    }
    if (player_seeded_by === enemy_slot) {
      enemy_effects.appendChild(effect_chip("Leech+", "drain"));
    }
  }
}
function update_panels(state, opts) {
  const viewer_slot = slot ?? (is_spectator ? "player1" : null);
  if (!viewer_slot)
    return;
  const enemy_slot = viewer_slot === "player1" ? "player2" : "player1";
  const me = state.players[viewer_slot];
  const opp = state.players[enemy_slot];
  const my_active = me.team[me.activeIndex];
  const opp_active = opp.team[opp.activeIndex];
  player_title.textContent = me.name || player_name;
  if (!opts?.skipMeta?.player) {
    player_meta.textContent = `Lv ${my_active.level} · HP ${my_active.hp}/${my_active.maxHp}`;
  }
  if (!opts?.skipBar?.player) {
    player_hp.style.width = `${Math.max(0, Math.min(1, my_active.hp / my_active.maxHp)) * 100}%`;
  }
  player_sprite.src = icon_path(my_active.id);
  player_sprite.alt = monster_label(my_active.id);
  set_monster_tooltip(player_sprite_wrap, tooltip_from_state(my_active));
  enemy_title.textContent = opp.name || "Opponent";
  if (!opts?.skipMeta?.enemy) {
    enemy_meta.textContent = `Lv ${opp_active.level} · HP ${opp_active.hp}/${opp_active.maxHp}`;
  }
  if (!opts?.skipBar?.enemy) {
    enemy_hp.style.width = `${Math.max(0, Math.min(1, opp_active.hp / opp_active.maxHp)) * 100}%`;
  }
  enemy_sprite.src = icon_path(opp_active.id);
  enemy_sprite.alt = monster_label(opp_active.id);
  set_monster_tooltip(enemy_sprite_wrap, tooltip_from_state(opp_active));
  render_effects(state, viewer_slot, viewer_slot, enemy_slot);
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
    if (entry.type !== "damage" && entry.type !== "recoil" && entry.type !== "leech_drain")
      continue;
    const payload = entry.data;
    if (!payload || typeof payload.damage !== "number" || payload.damage <= 0 || !payload.slot) {
      continue;
    }
    let defender_slot;
    if (entry.type === "recoil") {
      defender_slot = payload.slot;
    } else if (entry.type === "leech_drain") {
      defender_slot = payload.targetSlot ?? (payload.slot === "player1" ? "player2" : "player1");
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
  el.offsetWidth;
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
  const hit_sides = new Set(steps.filter((step) => step.kind === "damage").map((step) => step.defenderSide));
  latest_state = data.state;
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
  if (data.state.status === "ended" && prev_state?.status !== "ended") {
    append_match_end_marker();
  }
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
      set_player_name(data.slot, data.name);
      if (status_slot)
        status_slot.textContent = data.slot === "player1" ? "P1" : "P2";
      if (status_conn)
        status_conn.textContent = "synced";
      player_meta.textContent = `Slot ${data.slot === "player1" ? "P1" : "P2"}`;
      append_log(`assigned ${data.slot}`);
      append_chat(`${data.name} assigned to ${data.slot === "player1" ? "P1" : "P2"}`);
      render_participants();
      return;
    case "ready_state": {
      const previous = last_ready_snapshot ?? { player1: false, player2: false };
      last_ready_snapshot = { ...data.ready };
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
      } else {
        is_ready = false;
        opponent_ready = false;
        opponent_name = null;
        update_opponent_ui(false, null);
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
      is_ready = false;
      opponent_ready = false;
      opponent_name = null;
      add_spectator(data.name);
      if (status_slot)
        status_slot.textContent = "spectator";
      player_meta.textContent = "Spectator";
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
if (reset_status_btn) {
  reset_status_btn.addEventListener("click", () => {
    if (match_started) {
      return;
    }
    if (is_ready) {
      show_warning("Click Unready before resetting status.");
      return;
    }
    reset_profile_stats_to_defaults();
  });
}
match_end_btn.addEventListener("click", () => {
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
  if (!join_sent || relay_server_managed) {
    return;
  }
  try_post({ $: "join", name: player_name, player_id });
}, RELAY_JOIN_HEARTBEAT_MS);
setInterval(() => {
  if (relay_server_managed) {
    return;
  }
  relay_prune_inactive(Date.now());
}, 5000);
load_team_selection();
render_roster();
render_tabs();
render_config();
update_roster_count();
update_slots();
update_action_controls();
render_participants();
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
      append_log(`join request: ${player_name}`);
      join_sent = true;
    }
  }
});
